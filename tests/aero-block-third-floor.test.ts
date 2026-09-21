import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCampus3D } from "../features/navigation-3d/lib/campus-3d";
import {
  areaOf,
  defaultIsolatedStorey,
  frameFor,
  isolateStorey,
} from "../features/navigation-3d/lib/building-structure";
import {
  applyPilotStructure,
  AERO_BLOCK_ID,
  AERO_THIRD_FLOOR_ORDINAL,
} from "../shared/data/pilot-structure";
import {
  AERO_3F_SCHEDULE,
  buildAeroThirdFloorRooms,
  scheduleArea,
} from "../shared/data/aero-block-3f";

function publishedGraph(): Record<string, any> {
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
  return raw.snapshot ?? raw;
}

const campus = buildCampus3D(applyPilotStructure(publishedGraph()));
const aero = campus.buildings.find((b) => b.id === AERO_BLOCK_ID)!;
const frame = frameFor(aero)!;

describe("Aeronautical Block third floor", () => {
  describe("the schedule", () => {
    it("fills the plate exactly, leaving no gap or overlap along the corridor", () => {
      // Room widths plus the stair bay must account for the whole 71 m length,
      // or the floor reads as unfinished at one end.
      for (const side of ["north", "south"] as const) {
        const total =
          AERO_3F_SCHEDULE[side].reduce((s, e) => s + e.width, 0) + AERO_3F_SCHEDULE.stairBay;
        expect(total, `${side} run`).toBeCloseTo(AERO_3F_SCHEDULE.plateLength, 6);
      }
    });

    it("steps the third-floor slab back from the footprint below", () => {
      // The range is modelled 24 m deep, not the footprint's 38 m — the fan
      // count in the AE301 photograph rules out 17.5 m deep teaching rooms.
      const third = frame.slabs.find((s) => s.ordinal === 3)!;
      const ground = frame.slabs.find((s) => s.ordinal === 0)!;
      const depth = (pts: { z: number }[]) =>
        Math.max(...pts.map((p) => p.z)) - Math.min(...pts.map((p) => p.z));
      expect(depth(ground.outline)).toBeCloseTo(38, 0);
      expect(depth(third.outline)).toBeCloseTo(24, 0);
      // The frontage is unchanged: the step-back is in depth only.
      const width = (pts: { x: number }[]) =>
        Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
      expect(width(third.outline)).toBeCloseTo(width(ground.outline), 1);
    });

    it("keeps every room inside the range it occupies", () => {
      const halfL = AERO_3F_SCHEDULE.plateLength / 2;
      const halfD = AERO_3F_SCHEDULE.plateDepth / 2;
      for (const r of buildAeroThirdFloorRooms()) {
        for (const p of r.outline) {
          expect(Math.abs(p.x), `${r.id} x`).toBeLessThanOrEqual(halfL + 1e-6);
          expect(Math.abs(p.z), `${r.id} z`).toBeLessThanOrEqual(halfD + 1e-6);
        }
      }
    });

    it("never claims more floor area than the plate has", () => {
      const plate = AERO_3F_SCHEDULE.plateLength * AERO_3F_SCHEDULE.plateDepth;
      expect(scheduleArea()).toBeLessThan(plate);
      // But it should use most of it — a double-loaded corridor is efficient.
      expect(scheduleArea()).toBeGreaterThan(plate * 0.9);
    });

    it("puts no room across the corridor", () => {
      const half = AERO_3F_SCHEDULE.corridorWidth / 2;
      for (const r of buildAeroThirdFloorRooms()) {
        if (r.category === "CORRIDOR" || r.category === "STAIR") continue;
        const zs = r.outline.map((p) => p.z);
        const crosses = Math.min(...zs) < -half + 1e-9 && Math.max(...zs) > half - 1e-9;
        expect(crosses, `${r.id} straddles the corridor`).toBe(false);
      }
    });

    it("gives every enclosed room a door on its corridor edge", () => {
      const half = AERO_3F_SCHEDULE.corridorWidth / 2;
      for (const r of buildAeroThirdFloorRooms()) {
        if (r.category === "CORRIDOR" || r.category === "STAIR") continue;
        expect(r.doors, `${r.id} has no door`).toHaveLength(1);
        // The door sits on the corridor face, not out on the facade.
        expect(Math.abs(Math.abs(r.doors![0].z) - half)).toBeLessThan(0.2);
      }
    });

    it("carries the signed room codes from the photographs", () => {
      const codes = buildAeroThirdFloorRooms()
        .map((r) => r.code)
        .filter(Boolean);
      expect(codes).toContain("AE301");
    });

    it("re-derives every polygon when a measurement changes", () => {
      // The whole point of a schedule of widths: a tape measurement is one edit.
      const measured = {
        ...AERO_3F_SCHEDULE,
        corridorWidth: 2.4,
        south: AERO_3F_SCHEDULE.south.map((e) =>
          e.code === "AE301" ? { ...e, width: 18 } : e
        ),
      };
      const before = buildAeroThirdFloorRooms().find((r) => r.code === "AE301")!;
      const after = buildAeroThirdFloorRooms(measured).find((r) => r.code === "AE301")!;
      expect(areaOf(after.outline)).not.toBeCloseTo(areaOf(before.outline), 1);
      // A narrower corridor makes the rooms deeper, not shallower.
      const depth = (o: { z: number }[]) => Math.max(...o.map((p) => p.z)) - Math.min(...o.map((p) => p.z));
      expect(depth(after.outline)).toBeGreaterThan(depth(before.outline));
    });
  });

  describe("in the 3D frame", () => {
    it("is a pilot with four storeys, two of them added over the graph", () => {
      // The published graph records only Ground and Floor 1 for this block.
      const raw = publishedGraph();
      expect(raw.floors.filter((f: any) => f.buildingId === AERO_BLOCK_ID)).toHaveLength(2);
      expect(aero.floors).toHaveLength(4);
      expect(aero.floors.map((f) => f.ordinal)).toEqual([0, 1, 2, 3]);
    });

    it("puts the rooms on the third floor and nowhere else", () => {
      const thirdTop = frame.slabs.find((s) => s.ordinal === AERO_THIRD_FLOOR_ORDINAL)!.top;
      expect(frame.rooms.length).toBeGreaterThan(8);
      for (const r of frame.rooms) {
        expect(r.base).toBeCloseTo(thirdTop, 6);
      }
    });

    it("stacks the third floor at the right height", () => {
      // 3.9 + 3.6 + 3.6 for the storeys below it.
      expect(frame.slabs.find((s) => s.ordinal === 3)!.top).toBeCloseTo(11.1, 6);
    });

    it("reports room areas in the right ballpark for a 22 x 10.5 m classroom", () => {
      const ae301 = frame.rooms.find((r) => r.code === "AE301")!;
      // 22 m x 10.5 m, less partitions.
      expect(ae301.areaM2).toBeGreaterThan(200);
      expect(ae301.areaM2).toBeLessThan(250);
      expect(ae301.name).toBe("Design Series");
      expect(ae301.category).toBe("CLASSROOM");
    });

    it("opens on the third floor, since it is the only surveyed storey", () => {
      expect(defaultIsolatedStorey(frame)).toBe(AERO_THIRD_FLOOR_ORDINAL);
    });
  });

  describe("storey isolation", () => {
    const only3 = isolateStorey(frame, AERO_THIRD_FLOOR_ORDINAL);

    it("keeps the floor slab and the ceiling above it, and nothing else", () => {
      expect(only3.slabs).toHaveLength(2);
      expect(only3.slabs[0].ordinal).toBe(3);
      expect(only3.slabs[1].ordinal).toBe(4); // the roof cap
    });

    it("keeps only that storey's columns and rooms", () => {
      const base = only3.slabs[0].top;
      for (const c of only3.columns) expect(c.base).toBeCloseTo(base, 6);
      expect(only3.rooms).toHaveLength(frame.rooms.length);
      expect(only3.columns.length).toBeLessThan(frame.columns.length);
    });

    it("clips the stair cores to the isolated storey", () => {
      for (const c of only3.cores) {
        expect(c.base).toBeCloseTo(only3.slabs[0].top, 6);
        expect(c.top).toBeCloseTo(only3.slabs[1].top, 6);
      }
    });

    it("reports stats for what is actually drawn", () => {
      expect(only3.stats.slabs).toBe(2);
      expect(only3.stats.rooms).toBe(only3.rooms.length);
      expect(only3.stats.columns).toBe(only3.columns.length);
      expect(only3.stats.walls).toBe(only3.walls.length);
    });

    it("stays inside the draw-call budget for one storey", () => {
      // Slabs, rooms and cores are individual meshes; columns, beams and each
      // wall type are instanced.
      const drawCalls = only3.stats.slabs + only3.stats.rooms + only3.stats.cores + 3;
      expect(drawCalls).toBeLessThan(150);
    });

    it("hands back the whole frame for a null ordinal or an unknown storey", () => {
      expect(isolateStorey(frame, null)).toBe(frame);
      expect(isolateStorey(frame, 99)).toBe(frame);
    });

    it("suggests nothing when no single storey is surveyed", () => {
      const acadW = campus.buildings.find((b) => b.id === "b-acad-w")!;
      expect(defaultIsolatedStorey(frameFor(acadW)!)).toBeNull();
    });
  });
});
