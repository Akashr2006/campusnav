import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyPilotStructure, AERO_BLOCK_ID } from "../shared/data/pilot-structure";
import { buildCampus3D } from "../features/navigation-3d/lib/campus-3d";
import {
  frameFor,
  gridPointOnSlab,
  distanceToPolygonEdge,
  isolateStorey,
} from "../features/navigation-3d/lib/building-structure";

function aeroFrame() {
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
  const campus = buildCampus3D(applyPilotStructure(raw.snapshot ?? raw));
  const b = campus.buildings.find((x) => x.id === AERO_BLOCK_ID);
  if (!b) throw new Error("Aero Block missing from the published graph");
  const fr = frameFor(b);
  if (!fr) throw new Error("Aero Block has no frame");
  return fr;
}

const key = (x: number, z: number) => `${x.toFixed(2)},${z.toFixed(2)}`;

describe("Aeronautical Block — frame alignment", () => {
  const fr = aeroFrame();

  it("keeps one continuous column grid through every storey", () => {
    // Columns in an RC frame are continuous: an upper storey may have fewer,
    // never ones at new positions.
    const ground = fr.slabs[0].top;
    const groundKeys = new Set(
      fr.columns.filter((c) => Math.abs(c.base - ground) < 1e-6).map((c) => key(c.x, c.z))
    );
    for (const c of fr.columns) {
      expect(groundKeys.has(key(c.x, c.z))).toBe(true);
    }
  });

  it("gives the stepped-back top storey its full east column line", () => {
    const top = fr.slabs.find((s) => s.ordinal === 3)!;
    const cols = fr.columns.filter((c) => Math.abs(c.base - top.top) < 1e-6);
    const slabMaxX = Math.max(...top.outline.map((p) => p.x));
    const colMaxX = Math.max(...cols.map((c) => c.x));
    // The slab runs to its east edge; so must the columns holding it up.
    expect(slabMaxX - colMaxX).toBeLessThan(1);
    const xLines = new Set(cols.map((c) => c.x.toFixed(1))).size;
    const groundXLines = new Set(
      fr.columns.filter((c) => Math.abs(c.base - fr.slabs[0].top) < 1e-6).map((c) => c.x.toFixed(1))
    ).size;
    expect(xLines).toBe(groundXLines);
  });

  it("drops only the grid lines genuinely outside the stepped slab", () => {
    const top = fr.slabs.find((s) => s.ordinal === 3)!;
    const cols = fr.columns.filter((c) => Math.abs(c.base - top.top) < 1e-6);
    const zMin = Math.min(...top.outline.map((p) => p.z));
    const zMax = Math.max(...top.outline.map((p) => p.z));
    for (const c of cols) {
      expect(c.z).toBeGreaterThanOrEqual(zMin - 1);
      expect(c.z).toBeLessThanOrEqual(zMax + 1);
    }
    // The ground storey has lines the stepped slab does not; those must go.
    const groundCount = fr.columns.filter((c) => Math.abs(c.base - fr.slabs[0].top) < 1e-6).length;
    expect(cols.length).toBeLessThan(groundCount);
  });

  it("isolating the surveyed storey keeps its rooms, columns and both stair cores", () => {
    const one = isolateStorey(fr, 3);
    expect(one.slabs).toHaveLength(2);
    expect(one.rooms.length).toBeGreaterThan(0);
    expect(one.columns.length).toBeGreaterThan(0);
    expect(one.cores).toHaveLength(2);
    for (const c of one.cores) {
      expect(c.base).toBeCloseTo(one.slabs[0].top, 6);
      expect(c.top).toBeCloseTo(one.slabs[1].top, 6);
    }
  });

  it("every room, column and wall base lands exactly on a slab top", () => {
    const tops = fr.slabs.map((s) => s.top);
    const onSlab = (y: number) => tops.some((t) => Math.abs(t - y) < 1e-6);
    for (const r of fr.rooms) expect(onSlab(r.base)).toBe(true);
    for (const c of fr.columns) expect(onSlab(c.base)).toBe(true);
    for (const w of fr.walls) expect(onSlab(w.base)).toBe(true);
  });
});

describe("gridPointOnSlab", () => {
  const square = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
  ];

  it("accepts points on every edge and corner, not just the ones the ray-cast likes", () => {
    for (const p of [
      { x: 0, z: 5 },
      { x: 10, z: 5 },
      { x: 5, z: 0 },
      { x: 5, z: 10 },
      { x: 10, z: 10 },
      { x: 0, z: 0 },
    ]) {
      expect(gridPointOnSlab(p, square, 0.75)).toBe(true);
    }
  });

  it("accepts interior points and rejects points clearly outside", () => {
    expect(gridPointOnSlab({ x: 5, z: 5 }, square, 0.75)).toBe(true);
    expect(gridPointOnSlab({ x: 12, z: 5 }, square, 0.75)).toBe(false);
    expect(gridPointOnSlab({ x: 5, z: -3 }, square, 0.75)).toBe(false);
  });

  it("measures edge distance correctly", () => {
    expect(distanceToPolygonEdge({ x: 5, z: 5 }, square)).toBeCloseTo(5, 9);
    expect(distanceToPolygonEdge({ x: 12, z: 5 }, square)).toBeCloseTo(2, 9);
    expect(distanceToPolygonEdge({ x: 10, z: 5 }, square)).toBeCloseTo(0, 9);
  });
});
