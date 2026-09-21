import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planPixelToGps,
  planPixelToMetres,
  solvePlanTransform,
  type Px,
} from "../lib/geo/plan-georeference";
import { buildCampus3D, gpsToMetres } from "../features/navigation-3d/lib/campus-3d";
import {
  frameFor,
  gridAngleOf,
  toLocalFrame,
} from "../features/navigation-3d/lib/building-structure";
import { applyPilotStructure } from "../shared/data/pilot-structure";

/**
 * The whole Phase 2 pipeline, end to end, with no renderer and no browser.
 *
 * This is the test that matters: it walks a click on a plan scan all the way
 * through to a wall standing in the 3D scene, and asserts it lands within
 * centimetres of where it was drawn. Every step in between — solving the
 * transform, converting to the building's local frame, storing it on the floor,
 * reprojecting it through `buildCampus3D`, regenerating the frame — is a place
 * a sign flip or a missing rotation would put geometry metres away while still
 * looking perfectly plausible on screen.
 */
function publishedGraph(): Record<string, any> {
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
  return raw.snapshot ?? raw;
}

const PILOT = "b-acad-w";

/** A synthetic north-up plan of Academic Block W at 0.06 m per pixel. */
const PLAN = { width: 1000, height: 950 };

function setup() {
  const graph = applyPilotStructure(publishedGraph());
  const building = graph.buildings.find((b: any) => b.id === PILOT);
  const footprint = building.footprint as { lat: number; lng: number }[];
  expect(footprint.length).toBe(4);

  // The operator pins the plan's top-left to the north-west footprint corner and
  // its bottom-right to the south-east one — the everyday case.
  const nw = footprint[0];
  const se = footprint[2];
  const solved = solvePlanTransform(
    { px: { x: 0, y: 0 }, gps: nw },
    { px: { x: PLAN.width, y: PLAN.height }, gps: se }
  );
  if (!solved.ok) throw new Error(solved.error);

  const pts = footprint.map((p) => gpsToMetres(p.lat, p.lng));
  const centre = {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
  };
  return { graph, footprint, transform: solved.transform, centre, angleRad: gridAngleOf(pts) };
}

/** Exactly what the tracer does on save. */
function traceToLocal(px: Px, ctx: ReturnType<typeof setup>) {
  return toLocalFrame(planPixelToMetres(px, ctx.transform), ctx.centre, ctx.angleRad);
}

describe("floor plan tracing round-trip", () => {
  const ctx = setup();

  it("recovers the drawing's real scale from two footprint corners", () => {
    // 60 m across 1000 px.
    expect(ctx.transform.scale).toBeCloseTo(0.06, 3);
    // Not exactly zero, and that is correct: the footprint is 60.006 x 57.002 m
    // and this synthetic plan is 1000 x 950 px, a 70 ppm aspect mismatch. Pinning
    // two DIAGONAL corners cannot satisfy both unless the aspects agree exactly,
    // so the similarity fit absorbs the error as a hair of rotation. Pinning two
    // corners along the same wall avoids it — which is what the UI recommends.
    expect(Math.abs(ctx.transform.rotation)).toBeLessThan(0.01);
  });

  it("pins along one wall instead, decoupling rotation from aspect", () => {
    // Both pins on the north wall: the angle now comes from one edge alone, so
    // an aspect mismatch cannot leak into it.
    const alongWall = solvePlanTransform(
      { px: { x: 0, y: 0 }, gps: ctx.footprint[0] },
      { px: { x: PLAN.width, y: 0 }, gps: ctx.footprint[1] }
    );
    if (!alongWall.ok) throw new Error(alongWall.error);
    expect(alongWall.transform.rotation).toBeCloseTo(0, 9);
    expect(alongWall.transform.scale).toBeCloseTo(0.06, 4);
  });

  it("puts the plan's four corners on the footprint's four corners", () => {
    const corners: [Px, number][] = [
      [{ x: 0, y: 0 }, 0],
      [{ x: PLAN.width, y: 0 }, 1],
      [{ x: PLAN.width, y: PLAN.height }, 2],
      [{ x: 0, y: PLAN.height }, 3],
    ];
    for (const [px, ci] of corners) {
      const got = planPixelToMetres(px, ctx.transform);
      const want = gpsToMetres(ctx.footprint[ci].lat, ctx.footprint[ci].lng);
      expect(Math.hypot(got.x - want.x, got.z - want.z), `corner ${ci + 1}`).toBeLessThan(0.05);
    }
  });

  it("puts the plan's centre at the building's local origin", () => {
    const l = traceToLocal({ x: PLAN.width / 2, y: PLAN.height / 2 }, ctx);
    expect(Math.hypot(l.x, l.z)).toBeLessThan(0.05);
  });

  it("lands a traced column in the 3D scene where it was drawn", () => {
    // Three column centres picked off the drawing, at a 125 px (7.5 m) grid.
    const picked: Px[] = [
      { x: 125, y: 125 },
      { x: 500, y: 475 },
      { x: 875, y: 712 },
    ];
    const columns = picked.map((p) => {
      const l = traceToLocal(p, ctx);
      return { x: l.x, z: l.z };
    });

    // Save them onto the ground floor, the way the tracer does.
    const graph = {
      ...ctx.graph,
      floors: ctx.graph.floors.map((f: any) =>
        f.buildingId === PILOT && f.ordinal === 0 ? { ...f, columns } : f
      ),
    };

    const campus = buildCampus3D(graph);
    const building = campus.buildings.find((b) => b.id === PILOT)!;
    const frame = frameFor(building)!;

    // Tracing one storey is not enough to promote the whole building.
    expect(frame.lod).toBe("GENERIC");

    const ground = frame.columns.filter((c) => Math.abs(c.base) < 1e-6);
    expect(ground).toHaveLength(picked.length);
    expect(ground.every((c) => c.ref.startsWith("T/"))).toBe(true);

    // Every traced column must come back out at the world point it was drawn at.
    for (const p of picked) {
      const want = planPixelToMetres(p, ctx.transform);
      const closest = Math.min(
        ...ground.map((c) => Math.hypot(c.x - want.x, c.z - want.z))
      );
      expect(closest, `column drawn at ${p.x},${p.y}`).toBeLessThan(0.02);
    }
  });

  it("lands a traced wall at the right place, length and bearing", () => {
    // A 500 px run across the middle of the plan: 30 m, due east.
    const from: Px = { x: 250, y: 475 };
    const to: Px = { x: 750, y: 475 };
    const a = traceToLocal(from, ctx);
    const b = traceToLocal(to, ctx);

    const graph = {
      ...ctx.graph,
      floors: ctx.graph.floors.map((f: any) =>
        f.buildingId === PILOT && f.ordinal === 0
          ? { ...f, walls: [{ from: a, to: b, type: "STRUCTURAL" }] }
          : f
      ),
    };

    const frame = frameFor(buildCampus3D(graph).buildings.find((b) => b.id === PILOT)!)!;
    expect(frame.walls).toHaveLength(1);
    const wall = frame.walls[0];

    const wantA = planPixelToMetres(from, ctx.transform);
    const wantB = planPixelToMetres(to, ctx.transform);
    expect(Math.hypot(wall.from.x - wantA.x, wall.from.z - wantA.z)).toBeLessThan(0.02);
    expect(Math.hypot(wall.to.x - wantB.x, wall.to.z - wantB.z)).toBeLessThan(0.02);

    // 500 px at 0.06 m/px.
    expect(Math.hypot(wall.to.x - wall.from.x, wall.to.z - wall.from.z)).toBeCloseTo(30, 1);
    // Due east, so no southward component.
    expect(Math.abs(Math.sin(wall.angleRad))).toBeLessThan(0.01);
    // It stands on the ground slab and reaches the first-floor soffit.
    expect(wall.base).toBe(0);
    expect(wall.top).toBeGreaterThan(3);
  });

  it("uses a traced slab outline instead of the footprint for that storey", () => {
    // A stepped-back upper floor: the plan's right-hand quarter is not built on.
    const ring: Px[] = [
      { x: 0, y: 0 },
      { x: 750, y: 0 },
      { x: 750, y: PLAN.height },
      { x: 0, y: PLAN.height },
    ];
    const slabOutline = ring.map((p) => planPixelToGps(p, ctx.transform));

    const graph = {
      ...ctx.graph,
      floors: ctx.graph.floors.map((f: any) =>
        f.buildingId === PILOT && f.ordinal === 3 ? { ...f, slabOutline } : f
      ),
    };

    const frame = frameFor(buildCampus3D(graph).buildings.find((b) => b.id === PILOT)!)!;
    const top = frame.slabs.find((s) => s.ordinal === 3)!;
    const groundSlab = frame.slabs.find((s) => s.ordinal === 0)!;

    // The stepped storey is narrower than the one below it.
    const spanOf = (pts: { x: number; z: number }[]) =>
      Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    expect(spanOf(top.outline)).toBeLessThan(spanOf(groundSlab.outline) - 10);
    // 750 px at 0.06 m/px.
    expect(spanOf(top.outline)).toBeCloseTo(45, 0);
  });

  it("promotes the building once every storey is traced", () => {
    const columns = [{ x: 0, z: 0 }];
    const walls = [{ from: { x: -5, z: 0 }, to: { x: 5, z: 0 }, type: "STRUCTURAL" as const }];

    const tracedAll = {
      ...ctx.graph,
      floors: ctx.graph.floors.map((f: any) =>
        f.buildingId === PILOT ? { ...f, columns, walls } : f
      ),
    };
    const frame = frameFor(buildCampus3D(tracedAll).buildings.find((b) => b.id === PILOT)!)!;
    // Walls plus the pilot's cores earns INTERFACES.
    expect(frame.lod).toBe("INTERFACES");
    // Every storey carries its wall, basement included — five for this pilot.
    const storeys = ctx.graph.floors.filter((f: any) => f.buildingId === PILOT).length;
    expect(storeys).toBe(5);
    expect(frame.stats.walls).toBe(storeys);
  });

  it("survives a plan pinned at an angle", () => {
    // Pin the plan's top-left to the NORTH-EAST corner instead, turning the
    // drawing a quarter turn. The traced geometry must still land correctly.
    const turned = solvePlanTransform(
      { px: { x: 0, y: 0 }, gps: ctx.footprint[1] },
      { px: { x: PLAN.width, y: PLAN.height }, gps: ctx.footprint[3] }
    );
    if (!turned.ok) throw new Error(turned.error);
    expect(Math.abs(turned.transform.rotation)).toBeGreaterThan(30);

    const px: Px = { x: 400, y: 300 };
    const world = planPixelToMetres(px, turned.transform);
    const local = toLocalFrame(world, ctx.centre, ctx.angleRad);

    const graph = {
      ...ctx.graph,
      floors: ctx.graph.floors.map((f: any) =>
        f.buildingId === PILOT && f.ordinal === 0 ? { ...f, columns: [local] } : f
      ),
    };
    const frame = frameFor(buildCampus3D(graph).buildings.find((b) => b.id === PILOT)!)!;
    const traced = frame.columns.find((c) => c.ref.startsWith("T/"))!;
    expect(Math.hypot(traced.x - world.x, traced.z - world.z)).toBeLessThan(0.02);
  });
});
