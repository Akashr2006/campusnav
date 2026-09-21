import { describe, it, expect } from "vitest";
import {
  checkPlanAgainstFootprint,
  controlPointResidual,
  gpsToMetres,
  metresToGps,
  metresToPlanPixel,
  MIN_CONTROL_SEPARATION_PX,
  normaliseDegrees,
  planPixelToMetres,
  solvePlanTransform,
  type ControlPoint,
  type PlanTransform,
} from "../lib/geo/plan-georeference";
import { gpsToMetres as sceneGpsToMetres } from "../features/navigation-3d/lib/campus-3d";
import { MAP_ORIGIN } from "../lib/geo/projection";

/** Builds a control point from a pixel and a point given in metres. */
function cp(px: { x: number; y: number }, m: { x: number; z: number }): ControlPoint {
  return { px, gps: metresToGps(m) };
}

const solved = (a: ControlPoint, b: ControlPoint): PlanTransform => {
  const r = solvePlanTransform(a, b);
  if (!r.ok) throw new Error(r.error);
  return r.transform;
};

describe("plan georeferencing", () => {
  describe("shared projection", () => {
    it("agrees exactly with the 3D scene's own projection", () => {
      // Traced geometry has to land in the same frame as the footprint it sits
      // inside. If these two ever diverge, plans drift off their buildings.
      const lat = 11.4933361;
      const lng = 77.2743687;
      const mine = gpsToMetres(lat, lng);
      const scene = sceneGpsToMetres(lat, lng);
      expect(mine.x).toBeCloseTo(scene.x, 9);
      expect(mine.z).toBeCloseTo(scene.z, 9);
    });

    it("round-trips GPS through metres", () => {
      const original = { lat: 11.4928208, lng: 77.2749187 };
      const back = metresToGps(gpsToMetres(original.lat, original.lng));
      expect(back.lat).toBeCloseTo(original.lat, 9);
      expect(back.lng).toBeCloseTo(original.lng, 9);
    });

    it("puts the map origin at zero", () => {
      const o = gpsToMetres(MAP_ORIGIN.lat, MAP_ORIGIN.lng);
      expect(Math.abs(o.x)).toBeLessThan(1e-6);
      expect(Math.abs(o.z)).toBeLessThan(1e-6);
    });
  });

  describe("solvePlanTransform", () => {
    it("recovers scale from a north-up plan", () => {
      // 200 px apart on the plan, 50 m apart on the ground: 0.25 m per pixel.
      const t = solved(cp({ x: 0, y: 0 }, { x: 0, z: 0 }), cp({ x: 200, y: 0 }, { x: 50, z: 0 }));
      expect(t.scale).toBeCloseTo(0.25, 9);
      expect(t.rotation).toBeCloseTo(0, 9);
    });

    it("puts the origin at the raster's top-left, not the first pin", () => {
      // The first pin is 100 px in, so the origin sits 25 m west of it.
      const t = solved(
        cp({ x: 100, y: 0 }, { x: 100, z: 0 }),
        cp({ x: 300, y: 0 }, { x: 150, z: 0 })
      );
      const origin = gpsToMetres(t.originLat, t.originLng);
      expect(origin.x).toBeCloseTo(75, 6);
      expect(origin.z).toBeCloseTo(0, 6);
    });

    it("maps plan-down to south when the plan is north-up", () => {
      const t = solved(cp({ x: 0, y: 0 }, { x: 0, z: 0 }), cp({ x: 0, y: 100 }, { x: 0, z: 25 }));
      expect(t.rotation).toBeCloseTo(0, 9);
      // +y on the plan must come out as +z, i.e. south.
      const m = planPixelToMetres({ x: 0, y: 200 }, t);
      expect(m.z).toBeCloseTo(50, 6);
      expect(m.x).toBeCloseTo(0, 6);
    });

    it("reads a quarter-turned plan as 90 degrees clockwise", () => {
      // The plan's +x axis points due south on the ground.
      const t = solved(cp({ x: 0, y: 0 }, { x: 0, z: 0 }), cp({ x: 100, y: 0 }, { x: 0, z: 25 }));
      expect(t.rotation).toBeCloseTo(90, 6);
      expect(t.scale).toBeCloseTo(0.25, 9);
    });

    it("reads a plan turned the other way as minus 90", () => {
      // The plan's +x axis points due north.
      const t = solved(cp({ x: 0, y: 0 }, { x: 0, z: 0 }), cp({ x: 100, y: 0 }, { x: 0, z: -25 }));
      expect(t.rotation).toBeCloseTo(-90, 6);
    });

    it("places both pins exactly, whatever the rotation", () => {
      for (const deg of [0, 17, 45, 90, 123, 180, -30, -90]) {
        const rad = (deg * Math.PI) / 180;
        const s = 0.3;
        // Synthesise a plan rotated by `deg` and check the solver inverts it.
        const pxA = { x: 40, y: 90 };
        const pxB = { x: 260, y: 310 };
        const place = (px: { x: number; y: number }) => ({
          x: 500 + s * (px.x * Math.cos(rad) - px.y * Math.sin(rad)),
          z: -200 + s * (px.x * Math.sin(rad) + px.y * Math.cos(rad)),
        });
        const a = cp(pxA, place(pxA));
        const b = cp(pxB, place(pxB));
        const t = solved(a, b);
        expect(t.scale, `scale at ${deg}deg`).toBeCloseTo(s, 6);
        expect(normaliseDegrees(t.rotation - deg), `rotation at ${deg}deg`).toBeCloseTo(0, 4);
        expect(controlPointResidual([a, b], t), `residual at ${deg}deg`).toBeLessThan(0.01);
      }
    });

    it("round-trips pixels through metres and back", () => {
      const t = solved(cp({ x: 10, y: 20 }, { x: 300, z: -100 }), cp({ x: 410, y: 320 }, { x: 380, z: -20 }));
      for (const px of [
        { x: 0, y: 0 },
        { x: 123, y: 456 },
        { x: 800, y: 40 },
      ]) {
        const back = metresToPlanPixel(planPixelToMetres(px, t), t);
        expect(back.x).toBeCloseTo(px.x, 4);
        expect(back.y).toBeCloseTo(px.y, 4);
      }
    });

    it("refuses pins that are too close together on the plan", () => {
      const r = solvePlanTransform(
        cp({ x: 100, y: 100 }, { x: 0, z: 0 }),
        cp({ x: 105, y: 100 }, { x: 40, z: 0 })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain(String(MIN_CONTROL_SEPARATION_PX));
    });

    it("refuses two pins on the same map point", () => {
      const r = solvePlanTransform(
        cp({ x: 0, y: 0 }, { x: 10, z: 10 }),
        cp({ x: 400, y: 0 }, { x: 10, z: 10 })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/0.5 m apart/);
    });
  });

  describe("normaliseDegrees", () => {
    it("folds into (-180, 180]", () => {
      expect(normaliseDegrees(0)).toBe(0);
      expect(normaliseDegrees(370)).toBeCloseTo(10, 9);
      expect(normaliseDegrees(-190)).toBeCloseTo(170, 9);
      expect(normaliseDegrees(180)).toBeCloseTo(180, 9);
      expect(normaliseDegrees(-180)).toBeCloseTo(180, 9);
    });
  });

  describe("checkPlanAgainstFootprint", () => {
    const footprint = [
      { lat: 11.4933361, lng: 77.2743687 },
      { lat: 11.4933361, lng: 77.2749187 },
      { lat: 11.4928208, lng: 77.2749187 },
      { lat: 11.4928208, lng: 77.2743687 },
    ]; // Academic Block W, about 60 x 57 m.

    it("passes a plan whose scale matches the footprint", () => {
      // 1000 px across a 60 m building: 0.06 m per pixel.
      const t: PlanTransform = {
        originLat: 11.4933361,
        originLng: 77.2743687,
        scale: 0.06,
        rotation: 0,
      };
      expect(checkPlanAgainstFootprint(t, { width: 1000, height: 950 }, footprint)).toEqual([]);
    });

    it("warns when the plan works out far bigger than the footprint", () => {
      const t: PlanTransform = {
        originLat: 11.4933361,
        originLng: 77.2743687,
        scale: 0.6,
        rotation: 0,
      };
      const w = checkPlanAgainstFootprint(t, { width: 1000, height: 950 }, footprint);
      expect(w.length).toBeGreaterThan(0);
      expect(w[0]).toMatch(/footprint is 6[01] m/);
    });

    it("warns on an implausibly coarse or fine scale", () => {
      const coarse = checkPlanAgainstFootprint(
        { originLat: 11.49, originLng: 77.27, scale: 5, rotation: 0 },
        { width: 12, height: 12 },
        footprint
      );
      expect(coarse.some((m) => m.includes("per pixel is very coarse"))).toBe(true);

      const fine = checkPlanAgainstFootprint(
        { originLat: 11.49, originLng: 77.27, scale: 0.001, rotation: 0 },
        { width: 60000, height: 57000 },
        footprint
      );
      expect(fine.some((m) => m.includes("per pixel is very fine"))).toBe(true);
    });

    it("says nothing without a footprint to compare against", () => {
      const t: PlanTransform = { originLat: 11.49, originLng: 77.27, scale: 0.06, rotation: 0 };
      expect(checkPlanAgainstFootprint(t, { width: 1000, height: 950 }, [])).toEqual([]);
    });
  });
});
