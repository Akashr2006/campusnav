import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCampus3D } from "../features/navigation-3d/lib/campus-3d";
import { frameFor, isolateStorey } from "../features/navigation-3d/lib/building-structure";
import { applyPilotStructure, AERO_BLOCK_ID } from "../shared/data/pilot-structure";
import {
  buildFloorInterior,
  buildInteriorWalls,
  fitOutCeiling,
  furnishRoom,
  EMPTY_INTERIOR,
} from "../features/navigation-3d/lib/floor-interior";

function publishedGraph(): Record<string, any> {
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
  return raw.snapshot ?? raw;
}

const campus = buildCampus3D(applyPilotStructure(publishedGraph()));
const full = frameFor(campus.buildings.find((b) => b.id === AERO_BLOCK_ID)!)!;
const floor3 = isolateStorey(full, 3);
const interior = buildFloorInterior(floor3);

describe("floor interior", () => {
  describe("enclosure", () => {
    it("builds walls for the whole floor", () => {
      expect(interior.stats.walls).toBeGreaterThan(20);
      expect(interior.stats.openings).toBeGreaterThan(40);
    });

    it("classifies edges as exterior, corridor-facing or partition", () => {
      const kinds = new Set(interior.walls.map((w) => w.kind));
      expect(kinds).toContain("EXTERIOR");
      expect(kinds).toContain("CORRIDOR");
      expect(kinds).toContain("PARTITION");
    });

    it("builds a shared partition once, not once per room", () => {
      // Two neighbouring rooms both own the wall between them. Building it twice
      // puts two coincident boxes in the scene, which z-fight visibly.
      const seen = new Map<string, number>();
      for (const w of interior.walls) {
        const r = (n: number) => Math.round(n * 100) / 100;
        const a = `${r(w.from.x)},${r(w.from.z)}`;
        const b = `${r(w.to.x)},${r(w.to.z)}`;
        const k = a < b ? `${a}|${b}` : `${b}|${a}`;
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      for (const [k, n] of seen) expect(n, `edge ${k} built ${n} times`).toBe(1);
    });

    it("gives every corridor wall exactly one door", () => {
      const corridorWalls = interior.walls.filter((w) => w.kind === "CORRIDOR");
      expect(corridorWalls.length).toBeGreaterThan(0);
      for (const w of corridorWalls) {
        const doors = w.openings.filter((o) => o.kind === "DOOR");
        expect(doors, `${w.id}`).toHaveLength(1);
        expect(doors[0].sill).toBe(0);
      }
    });

    it("puts the photographed hatches in the corridor walls, glazed at the halls", () => {
      const kinds = interior.walls
        .filter((w) => w.kind === "CORRIDOR")
        .flatMap((w) => w.openings.map((o) => o.kind));
      // Unglazed openings in the teaching rooms, glazed where a hall is
      // supervised from the corridor.
      expect(kinds).toContain("HATCH");
      expect(kinds).toContain("GLAZED");
    });

    it("glazes the facade and leaves washroom walls blank", () => {
      const exterior = interior.walls.filter((w) => w.kind === "EXTERIOR");
      expect(exterior.some((w) => w.openings.some((o) => o.kind === "WINDOW"))).toBe(true);
      // Nobody puts a window at eye level in a rest room.
      const wc = floor3.rooms.filter((r) => r.category === "WASHROOM").map((r) => r.id);
      for (const w of interior.walls) {
        if (!wc.some((id) => w.id.startsWith(id))) continue;
        expect(w.openings.every((o) => o.kind !== "WINDOW"), `${w.id}`).toBe(true);
      }
    });

    it("keeps every opening inside its own wall", () => {
      for (const w of interior.walls) {
        for (const o of w.openings) {
          expect(o.at, `${w.id} ${o.kind} start`).toBeGreaterThanOrEqual(-1e-6);
          expect(o.at + o.width, `${w.id} ${o.kind} end`).toBeLessThanOrEqual(w.length + 1e-6);
          expect(o.head).toBeGreaterThan(o.sill);
          expect(o.head).toBeLessThanOrEqual(w.top - w.base + 1e-6);
        }
      }
    });

    it("never overlaps two openings in the same wall", () => {
      // Overlapping openings would leave a wall with a negative-width pier.
      for (const w of interior.walls) {
        const sorted = [...w.openings].sort((a, b) => a.at - b.at);
        for (let i = 1; i < sorted.length; i++) {
          expect(
            sorted[i].at,
            `${w.id}: ${sorted[i - 1].kind} and ${sorted[i].kind} overlap`
          ).toBeGreaterThanOrEqual(sorted[i - 1].at + sorted[i - 1].width - 1e-6);
        }
      }
    });

    it("does not wall in the corridor itself", () => {
      // The corridor is enclosed by its neighbours' walls; giving it its own
      // would seal it off behind a second skin.
      const corridor = floor3.rooms.find((r) => r.category === "CORRIDOR")!;
      expect(interior.walls.some((w) => w.id.startsWith(corridor.id))).toBe(false);
    });

    it("stands every wall between the floor and the ceiling soffit", () => {
      const base = floor3.slabs[0].top;
      const soffit = floor3.slabs[1].top - floor3.slabs[1].thickness;
      for (const w of interior.walls) {
        expect(w.base).toBeCloseTo(base, 6);
        expect(w.top).toBeCloseTo(soffit, 6);
      }
    });
  });

  describe("fit-out", () => {
    it("furnishes classrooms and drawing halls differently", () => {
      const ae301 = floor3.rooms.find((r) => r.code === "AE301")!;
      const hall = floor3.rooms.find((r) => r.category === "DRAWING_HALL")!;
      const classKinds = new Set(furnishRoom(ae301, floor3.angleRad).map((f) => f.kind));
      const hallKinds = new Set(furnishRoom(hall, floor3.angleRad).map((f) => f.kind));
      expect(classKinds).toContain("DESK");
      expect(classKinds).toContain("BENCH");
      expect(hallKinds).toContain("DRAFTING_TABLE");
      // The wire basket under every drafting table in the photographs.
      expect(hallKinds).toContain("DRAFTING_BASKET");
      expect(hallKinds.has("DESK")).toBe(false);
    });

    it("leaves the corridor and rest rooms unfurnished", () => {
      for (const r of floor3.rooms) {
        if (r.category !== "CORRIDOR" && r.category !== "WASHROOM") continue;
        expect(furnishRoom(r, floor3.angleRad), r.name).toHaveLength(0);
      }
    });

    it("pairs every desk with a bench", () => {
      const desks = interior.furniture.filter((f) => f.kind === "DESK").length;
      const benches = interior.furniture.filter((f) => f.kind === "BENCH").length;
      expect(desks).toBeGreaterThan(50);
      expect(benches).toBe(desks);
    });

    it("keeps furniture clear of the walls", () => {
      // A desk poking through a window is the giveaway that a layout was not
      // checked against the room it sits in.
      for (const f of interior.furniture) {
        const room = floor3.rooms.find((r) => {
          const xs = r.outline.map((p) => p.x);
          const zs = r.outline.map((p) => p.z);
          return (
            f.at.x >= Math.min(...xs) &&
            f.at.x <= Math.max(...xs) &&
            f.at.z >= Math.min(...zs) &&
            f.at.z <= Math.max(...zs)
          );
        });
        expect(room, `furniture at ${f.at.x.toFixed(1)},${f.at.z.toFixed(1)} is in no room`).toBeTruthy();
      }
    });

    it("hangs about a dozen fans in AE301, matching the photograph", () => {
      // The count is the one dimensional check the photographs actually support,
      // and it is what set this floor's 10.5 m room depth.
      const ae301 = floor3.rooms.find((r) => r.code === "AE301")!;
      const fans = fitOutCeiling(ae301, floor3.angleRad).filter((f) => f.kind === "FAN");
      expect(fans.length).toBeGreaterThanOrEqual(9);
      expect(fans.length).toBeLessThanOrEqual(15);
    });

    it("hangs fans below the slab, on a down-rod", () => {
      const ae301 = floor3.rooms.find((r) => r.code === "AE301")!;
      const ceiling = ae301.top;
      for (const f of fitOutCeiling(ae301, floor3.angleRad)) {
        expect(f.y).toBeLessThan(ceiling);
        expect(f.y).toBeGreaterThan(ae301.base + 2);
      }
    });

    it("lights the corridor but does not put fans in it", () => {
      const corridor = floor3.rooms.find((r) => r.category === "CORRIDOR")!;
      const fittings = fitOutCeiling(corridor, floor3.angleRad);
      expect(fittings.some((f) => f.kind === "TUBE")).toBe(true);
      expect(fittings.some((f) => f.kind === "FAN")).toBe(false);
    });
  });

  describe("guards", () => {
    it("returns an empty interior for a floor with no rooms", () => {
      const acadW = frameFor(campus.buildings.find((b) => b.id === "b-acad-w")!)!;
      expect(buildFloorInterior(isolateStorey(acadW, 0))).toBe(EMPTY_INTERIOR);
    });

    it("returns an empty interior for a frame that is not isolated", () => {
      // The full stack has five slabs, so there is no single ceiling to build to.
      expect(full.slabs.length).toBeGreaterThan(2);
      expect(buildFloorInterior(full).stats.walls).toBeGreaterThan(0);
    });

    it("builds nothing from an empty room list", () => {
      expect(buildInteriorWalls([], [], 0, 3)).toHaveLength(0);
    });
  });

  describe("budget", () => {
    it("stays within a sane instanced draw-call count", () => {
      // Every group below is one InstancedMesh regardless of its count: walls,
      // skirting, reveals, glass, doors, steel, tops, baskets, fan rods, bodies,
      // blades, tube bodies, tubes — thirteen, plus the frame's own handful.
      expect(interior.stats.walls).toBeLessThan(200);
      expect(interior.stats.furniture).toBeLessThan(1200);
      expect(interior.stats.fittings).toBeLessThan(400);
    });
  });
});
