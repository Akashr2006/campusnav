import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCampus3D, gpsToMetres, METRES_PER_STOREY } from "../features/navigation-3d/lib/campus-3d";
import { MAP_ORIGIN, gpsToCanvas, PIXELS_PER_METER } from "../lib/geo/projection";

/** The real published campus, so the 3D conversion is tested against live data. */
function publishedGraph(): Record<string, any> {
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
  return raw.snapshot ?? raw;
}

describe("3D campus geometry", () => {
  describe("gpsToMetres", () => {
    it("puts the map origin at 0,0", () => {
      const o = gpsToMetres(MAP_ORIGIN.lat, MAP_ORIGIN.lng);
      expect(Math.abs(o.x)).toBeLessThan(1e-6);
      expect(Math.abs(o.z)).toBeLessThan(1e-6);
    });

    it("puts north at -Z, matching the 2D map's north-up convention", () => {
      const north = gpsToMetres(MAP_ORIGIN.lat + 0.001, MAP_ORIGIN.lng);
      expect(north.z).toBeLessThan(0);
    });

    it("puts east at +X", () => {
      const east = gpsToMetres(MAP_ORIGIN.lat, MAP_ORIGIN.lng + 0.001);
      expect(east.x).toBeGreaterThan(0);
    });

    it("agrees with the 2D canvas projection to within its rounding", () => {
      // gpsToCanvas rounds to whole pixels at 4 px/m, so the two can differ by
      // up to 0.25 m. Anything larger means the projections have diverged.
      const lat = 11.4933353;
      const lng = 77.2747689;
      const metres = gpsToMetres(lat, lng);
      const canvas = gpsToCanvas(lat, lng);
      expect(Math.abs(metres.x - canvas.x / PIXELS_PER_METER)).toBeLessThan(0.26);
      expect(Math.abs(metres.z - canvas.y / PIXELS_PER_METER)).toBeLessThan(0.26);
    });
  });

  describe("buildCampus3D", () => {
    const campus = buildCampus3D(publishedGraph());

    it("converts every published building", () => {
      expect(campus.buildings).toHaveLength(publishedGraph().buildings.length);
    });

    it("gives every building a closed polygon and a positive height", () => {
      for (const b of campus.buildings) {
        expect(b.outline.length).toBeGreaterThanOrEqual(3);
        expect(b.heightMetres).toBeGreaterThan(0);
        expect(Number.isFinite(b.heightMetres)).toBe(true);
      }
    });

    it("derives height from storey count", () => {
      for (const b of campus.buildings) {
        expect(b.heightMetres).toBeCloseTo(b.storeys * METRES_PER_STOREY, 6);
      }
    });

    it("keeps every centroid inside its own bounding box", () => {
      for (const b of campus.buildings) {
        const xs = b.outline.map((p) => p.x);
        const zs = b.outline.map((p) => p.z);
        expect(b.centre.x).toBeGreaterThanOrEqual(Math.min(...xs) - 1e-6);
        expect(b.centre.x).toBeLessThanOrEqual(Math.max(...xs) + 1e-6);
        expect(b.centre.z).toBeGreaterThanOrEqual(Math.min(...zs) - 1e-6);
        expect(b.centre.z).toBeLessThanOrEqual(Math.max(...zs) + 1e-6);
      }
    });

    it("drops edges whose endpoints are missing rather than emitting NaN", () => {
      for (const e of campus.edges) {
        expect(Number.isFinite(e.from.x)).toBe(true);
        expect(Number.isFinite(e.to.z)).toBe(true);
      }
    });

    it("reports a centre inside the campus and a usable radius", () => {
      // MAP_ORIGIN is the south-west corner, so a centre at the origin would
      // mean the camera framing is wrong.
      expect(campus.radius).toBeGreaterThan(60);
      expect(Math.hypot(campus.centre.x, campus.centre.z)).toBeGreaterThan(0);
      expect(Number.isFinite(campus.centre.x)).toBe(true);
    });

    it("survives an empty or malformed graph", () => {
      for (const input of [null, undefined, {}, { buildings: null, nodes: 5 }]) {
        const empty = buildCampus3D(input as any);
        expect(empty.buildings).toEqual([]);
        expect(empty.edges).toEqual([]);
        expect(empty.radius).toBeGreaterThan(0);
      }
    });

    it("falls back to the width/height box when a footprint is missing", () => {
      const built = buildCampus3D({
        buildings: [{ id: "b1", name: "Boxy", x: 0, y: 0, width: 40, height: 20, floorsCount: 2 }],
      });
      expect(built.buildings).toHaveLength(1);
      expect(built.buildings[0].outline).toHaveLength(4);
      expect(built.buildings[0].heightMetres).toBeCloseTo(2 * METRES_PER_STOREY, 6);
    });

    it("skips buildings with neither a footprint nor a box", () => {
      const built = buildCampus3D({ buildings: [{ id: "ghost", name: "No geometry" }] });
      expect(built.buildings).toEqual([]);
    });
  });
});
