import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cardinal,
  createPathRouter,
  roundDistance,
  turnAngle,
  type PathNetworkFile,
  type RoutePlace,
} from "../features/navigation/lib/path-network";
import { buildCampus3D, type Vec2 } from "../features/navigation-3d/lib/campus-3d";
import { placeKind } from "../features/navigation/lib/place-kind";

/** A box outline centred on (x, z). */
const box = (x: number, z: number, w = 10, d = 10): Vec2[] => [
  { x: x - w / 2, z: z - d / 2 },
  { x: x + w / 2, z: z - d / 2 },
  { x: x + w / 2, z: z + d / 2 },
  { x: x - w / 2, z: z + d / 2 },
];
const place = (key: string, name: string, x: number, z: number, w = 10, d = 10): RoutePlace => ({
  key,
  name,
  polygons: [box(x, z, w, d)],
  centre: { x, z },
});

/**
 * An L of road: west to east along z = 0, then north (to -z) up x = 100.
 *   A sits south of the road's west end, B west of its north end, C at the corner.
 */
const L: PathNetworkFile = {
  nodes: [
    [0, 0],
    [100, 0],
    [100, -100],
  ],
  edges: [
    { a: 0, b: 1, kind: "road", w: 6, len: 100, pts: [50, 0] },
    { a: 1, b: 2, kind: "road", w: 6, len: 100, pts: [] },
  ],
};

describe("path network geometry helpers", () => {
  it("names compass headings with north as -Z", () => {
    expect(cardinal({ x: 0, z: -1 })).toBe("north");
    expect(cardinal({ x: 1, z: 0 })).toBe("east");
    expect(cardinal({ x: 0, z: 1 })).toBe("south");
    expect(cardinal({ x: -1, z: -1 })).toBe("north-west");
  });

  it("calls a turn from east to north a left turn", () => {
    expect(turnAngle({ x: 1, z: 0 }, { x: 0, z: -1 })).toBeCloseTo(-90);
    expect(turnAngle({ x: 1, z: 0 }, { x: 0, z: 1 })).toBeCloseTo(90);
  });

  it("rounds distances the way people say them", () => {
    expect(roundDistance(3)).toBe(5);
    expect(roundDistance(42)).toBe(40);
    expect(roundDistance(143)).toBe(140);
  });
});

describe("routing over a path network", () => {
  const places = [place("a", "Alpha Block", 10, 12), place("b", "Beta Block", 88, -90), place("c", "Corner Hall", 118, 14)];
  const router = createPathRouter(L, places);

  it("follows the roads between two places and turns left at the corner", () => {
    const r = router.route({ place: "a" }, { place: "b" })!;
    expect(r).not.toBeNull();
    // Along the L, not straight across: about 90 + 90 m plus the two doors.
    expect(r.distance).toBeGreaterThan(170);
    expect(r.distance).toBeLessThan(200);
    // The line stays on the road except for the doors at the ends.
    const offRoad = r.path.filter((p) => Math.abs(p.z) > 8 && Math.abs(p.x - 100) > 8);
    expect(offRoad.length).toBeLessThanOrEqual(2);
    const texts = r.steps.map((s) => s.text);
    expect(texts[0]).toMatch(/^Head east from Alpha Block along the road/);
    expect(texts.some((t) => /^Turn left at Corner Hall/.test(t))).toBe(true);
    expect(texts[texts.length - 1]).toBe("Arrive at Beta Block, on your left");
  });

  it("says which side the destination is on, as seen walking along the road", () => {
    // Coming back west along z = 0, Alpha Block (south of the road) is on the left...
    const back = router.route({ place: "b" }, { place: "a" })!;
    expect(back.steps.map((s) => s.text).some((t) => /^Turn right at Corner Hall/.test(t))).toBe(true);
    expect(back.steps[back.steps.length - 1].text).toBe("Arrive at Alpha Block, on your left");
    // ...and walking east to Corner Hall, which is south-east of the corner, it is on the right.
    const east = router.route({ place: "a" }, { place: "c" })!;
    expect(east.steps[east.steps.length - 1].text).toBe("Arrive at Corner Hall, on your right");
  });

  it("routes from a point that is not a place, such as a GPS fix", () => {
    const r = router.route({ point: { x: 40, z: 6 }, name: "Your location" }, { place: "b" })!;
    expect(r.steps[0].text).toMatch(/^Head .* from Your location/);
    expect(r.path[0]).toEqual({ x: 40, z: 6 });
  });

  it("rides the shuttle on the road and walks the rest when asked", () => {
    const walk = router.route({ place: "a" }, { place: "b" }, "WALK")!;
    const ride = router.route({ place: "a" }, { place: "b" }, "EV")!;
    expect(ride.rideDistance).toBeGreaterThan(150);
    expect(ride.durationSec).toBeLessThan(walk.durationSec / 2);
    expect(ride.steps.some((s) => s.icon === "shuttle")).toBe(true);
  });

  it("returns null for a place it does not know", () => {
    expect(router.route({ place: "nowhere" }, { place: "a" })).toBeNull();
  });
});

const PATHS = resolve(__dirname, "../public/drone/paths.json");
// The network is generated data (tools/drone/build-paths.mjs); test it wherever it has been built.
if (existsSync(PATHS)) describe("the detected campus network (public/drone/paths.json)", () => {
  const file = JSON.parse(readFileSync(PATHS, "utf-8")) as PathNetworkFile;
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
  const campus = buildCampus3D(raw.snapshot ?? raw);
  const footprints = JSON.parse(readFileSync(resolve(__dirname, "../public/drone/footprints.json"), "utf-8")).footprints as {
    outline: [number, number][];
    buildingId: string | null;
  }[];
  // Places as the app builds them: a building's surveyed roofs, else its traced outline.
  const places: RoutePlace[] = campus.buildings.map((b) => {
    const roofs = footprints.filter((f) => f.buildingId === b.id).map((f) => f.outline.map(([x, z]) => ({ x, z })));
    const kind = placeKind(b.name);
    return { key: b.id, name: b.name, polygons: roofs.length ? roofs : [b.outline], centre: b.centre, land: b.isSiteFeature, walkThrough: kind === "academic" || kind === "lab" };
  });
  const router = createPathRouter(file, places);
  const buildings = places.filter((p) => !p.land);
  const perimeter = (o: Vec2[]) => o.reduce((s, p, i) => s + Math.hypot(p.x - o[(i + 1) % o.length].x, p.z - o[(i + 1) % o.length].z), 0);
  const area = (o: Vec2[]) => Math.abs(o.reduce((s, p, i) => s + p.x * o[(i + 1) % o.length].z - o[(i + 1) % o.length].x * p.z, 0)) / 2;
  // Solid roofs only: a canopy over a walkway (under 6 m across on average, or
  // a long unnamed strip) is walked under, not round.
  const roofs = footprints
    .map((f) => ({ poly: f.outline.map(([x, z]) => ({ x, z })), building: f.buildingId }))
    .filter((r) => {
      const meanWidth = (2 * area(r.poly)) / perimeter(r.poly);
      return meanWidth >= 6 && (r.building || meanWidth >= 10);
    });
  const inside = (p: Vec2, poly: Vec2[]) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
    }
    return c;
  };
  // Hand-traced ways (tools/drone/paths-edits.json) are drawn where the photo
  // shows a walkway that a roof outline happens to cover (canopies, overhangs).
  const traces = (
    JSON.parse(readFileSync(resolve(__dirname, "../tools/drone/paths-edits.json"), "utf-8")).add as { pts: [number, number][] }[]
  ).map((t) => t.pts.map(([x, z]) => ({ x, z })));
  const onTrace = (p: Vec2) =>
    traces.some((t) =>
      t.some((a, i) => {
        const b = t[i + 1];
        if (!b) return false;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(a.x + u * dx - p.x, a.z + u * dz - p.z) < 4;
      })
    );
  /** Well inside: more than 3 m from every edge (roofs overhang the ground they were traced over). */
  const deepInside = (p: Vec2, poly: Vec2[]) => {
    if (!inside(p, poly)) return false;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(a.x + t * dx - p.x, a.z + t * dz - p.z) < 3) return false;
    }
    return true;
  };

  it("reaches every building from every other", () => {
    const failed: string[] = [];
    for (const a of buildings) for (const b of buildings) if (a !== b && !router.route({ place: a.key }, { place: b.key })) failed.push(`${a.name} -> ${b.name}`);
    expect(failed).toEqual([]);
  });

  it("keeps routes off roofs (but through academic blocks) and close to the straight-line distance", () => {
    let worst = 0;
    const roofHits: string[] = [];
    for (const a of buildings) {
      for (const b of buildings) {
        if (a === b) continue;
        const r = router.route({ place: a.key }, { place: b.key })!;
        const straight = Math.hypot(a.centre.x - b.centre.x, a.centre.z - b.centre.z);
        if (straight > 150) worst = Math.max(worst, r.distance / straight);
        // Roofs it may cross: its own ends, and the blocks it says it goes through.
        const through = new Set(r.steps.flatMap((s) => /^Go through (.+?)(,|$)/.exec(s.text)?.[1] ?? []));
        const allowed = new Set([a.key, b.key, ...buildings.filter((x) => through.has(x.name ?? "")).map((x) => x.key)]);
        const inner = r.path.slice(2, -2);
        for (let i = 1; i < inner.length; i++) {
          const p = { x: (inner[i - 1].x + inner[i].x) / 2, z: (inner[i - 1].z + inner[i].z) / 2 };
          if (!onTrace(p) && roofs.some((r) => !(r.building && allowed.has(r.building)) && deepInside(p, r.poly))) {
            roofHits.push(`${a.name} -> ${b.name}`);
            break;
          }
        }
      }
    }
    expect(worst).toBeLessThan(2.8);
    expect(roofHits).toEqual([]);
  });

  it("gives landmark directions on a real route", () => {
    const as = buildings.find((b) => b.name === "AS Block")!;
    const hall = buildings.find((b) => b.name === "Central Hall")!;
    const r = router.route({ place: as.key }, { place: hall.key })!;
    expect(r.steps[0].text).toMatch(/^Head \S+ from AS Block/);
    expect(r.steps[r.steps.length - 1].text).toMatch(/^Arrive at Central Hall/);
    expect(r.steps.length).toBeGreaterThanOrEqual(3);
    expect(r.steps.length).toBeLessThan(14);
  });
});
