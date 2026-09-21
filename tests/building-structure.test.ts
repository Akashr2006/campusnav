import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildCampus3D, METRES_PER_STOREY } from "../features/navigation-3d/lib/campus-3d";
import {
  areaOf,
  buildBuildingFrame,
  earnedLod,
  elevationsOf,
  frameFor,
  gridAngleOf,
  pointInPolygon,
  toLocalFrame,
  toWorldFrame,
  type BuildingInput,
} from "../features/navigation-3d/lib/building-structure";
import { applyPilotStructure, PILOT_BUILDING_IDS } from "../shared/data/pilot-structure";

/** The real published campus, so the frame is tested against live footprints. */
function publishedGraph(): Record<string, any> {
  const raw = JSON.parse(readFileSync(resolve(__dirname, "../.data/published_graph.json"), "utf-8"));
  return raw.snapshot ?? raw;
}

const campus = buildCampus3D(applyPilotStructure(publishedGraph()));
const byId = (id: string) => {
  const b = campus.buildings.find((x) => x.id === id);
  if (!b) throw new Error(`missing pilot building ${id}`);
  return b;
};

/** A 40 x 20 m rectangle, axis-aligned, for the unit-level cases. */
const RECT = [
  { x: 0, z: 0 },
  { x: 40, z: 0 },
  { x: 40, z: 20 },
  { x: 0, z: 20 },
];

function simpleInput(over: Partial<BuildingInput> = {}): BuildingInput {
  return {
    id: "t",
    outline: RECT,
    lod: "GENERIC",
    floors: [
      { id: "f0", name: "Ground", ordinal: 0 },
      { id: "f1", name: "First", ordinal: 1 },
    ],
    ...over,
  };
}

describe("structural frame generation", () => {
  describe("helpers", () => {
    it("finds points inside and outside a polygon", () => {
      expect(pointInPolygon({ x: 20, z: 10 }, RECT)).toBe(true);
      expect(pointInPolygon({ x: 41, z: 10 }, RECT)).toBe(false);
      expect(pointInPolygon({ x: -1, z: 10 }, RECT)).toBe(false);
    });

    it("reads the grid angle off the longest edge", () => {
      // RECT's longest edge runs along +X, so the grid is unrotated.
      expect(Math.abs(gridAngleOf(RECT))).toBeLessThan(1e-9);
    });

    it("folds the grid angle into a quarter turn", () => {
      // A rectangle rotated 30 degrees. A grid is 90-degree symmetric, so the
      // angle must stay small rather than flipping the bays.
      const a = (30 * Math.PI) / 180;
      const rot = RECT.map((p) => ({
        x: p.x * Math.cos(a) - p.z * Math.sin(a),
        z: p.x * Math.sin(a) + p.z * Math.cos(a),
      }));
      expect(gridAngleOf(rot)).toBeCloseTo(a, 6);
      expect(Math.abs(gridAngleOf(rot))).toBeLessThanOrEqual(Math.PI / 4);
    });
  });

  describe("elevations", () => {
    it("puts the ground floor at datum and stacks upward", () => {
      const e = elevationsOf(
        [
          { id: "a", name: "G", ordinal: 0 },
          { id: "b", name: "1", ordinal: 1 },
          { id: "c", name: "2", ordinal: 2 },
        ],
        3.5
      );
      expect(e.get(0)).toBe(0);
      expect(e.get(1)).toBe(3.5);
      expect(e.get(2)).toBe(7);
    });

    it("hangs basements below datum without lifting the ground floor", () => {
      const e = elevationsOf(
        [
          { id: "b1", name: "B1", ordinal: -1, heightMetres: 3 },
          { id: "g", name: "G", ordinal: 0, heightMetres: 4 },
          { id: "f1", name: "1", ordinal: 1 },
        ],
        3.5
      );
      expect(e.get(0)).toBe(0);
      expect(e.get(-1)).toBe(-3);
      expect(e.get(1)).toBe(4);
    });

    it("respects per-storey heights over the nominal 3.5 m", () => {
      const e = elevationsOf(
        [
          { id: "g", name: "G", ordinal: 0, heightMetres: 4.5 },
          { id: "f1", name: "1", ordinal: 1 },
        ],
        METRES_PER_STOREY
      );
      expect(e.get(1)).toBe(4.5);
    });
  });

  describe("buildBuildingFrame", () => {
    it("returns null without a usable outline or floors", () => {
      expect(buildBuildingFrame(simpleInput({ outline: [{ x: 0, z: 0 }] }))).toBeNull();
      expect(buildBuildingFrame(simpleInput({ floors: [] }))).toBeNull();
    });

    it("caps the stack with a roof slab above the topmost floor", () => {
      const f = buildBuildingFrame(simpleInput())!;
      expect(f.slabs).toHaveLength(3); // ground, first, roof
      const roof = f.slabs[f.slabs.length - 1];
      expect(roof.isRoof).toBe(true);
      expect(roof.top).toBeCloseTo(2 * METRES_PER_STOREY, 6);
    });

    it("fits whole bays so columns land on both edges", () => {
      // 40 m at a 7.5 m target divides into 5 bays of exactly 8 m.
      const f = buildBuildingFrame(simpleInput())!;
      expect(f.bay.x).toBeCloseTo(8, 6);
      // 20 m divides into 3 bays of 6.67 m.
      expect(f.bay.z).toBeCloseTo(20 / 3, 6);
    });

    it("keeps every column inside the footprint", () => {
      const f = buildBuildingFrame(simpleInput())!;
      expect(f.columns.length).toBeGreaterThan(0);
      for (const c of f.columns) {
        expect(c.x).toBeGreaterThanOrEqual(-0.001);
        expect(c.x).toBeLessThanOrEqual(40.001);
        expect(c.z).toBeGreaterThanOrEqual(-0.001);
        expect(c.z).toBeLessThanOrEqual(20.001);
      }
    });

    it("stops every column short of the slab it supports", () => {
      const f = buildBuildingFrame(simpleInput())!;
      for (const c of f.columns) {
        expect(c.top).toBeGreaterThan(c.base);
        const slabAbove = f.slabs.find((s) => Math.abs(s.top - s.thickness - c.top) < 1e-6);
        expect(slabAbove, `column at ${c.ref} does not meet a slab soffit`).toBeTruthy();
      }
    });

    it("drops interior columns for a long-span structure", () => {
      const rc = buildBuildingFrame(simpleInput({ structureType: "RC_FRAME" }))!;
      const hall = buildBuildingFrame(simpleInput({ structureType: "LONG_SPAN" }))!;
      expect(hall.columns.length).toBeLessThan(rc.columns.length);
      // Check the interior explicitly: nothing may stand mid-room.
      const interior = hall.columns.filter(
        (c) => c.x > 1 && c.x < 39 && c.z > 1 && c.z < 19
      );
      expect(interior).toHaveLength(0);
    });

    it("omits columns outside a non-convex slab outline", () => {
      // An L: the top-right quadrant is cut away.
      const L = [
        { x: 0, z: 0 },
        { x: 40, z: 0 },
        { x: 40, z: 10 },
        { x: 20, z: 10 },
        { x: 20, z: 20 },
        { x: 0, z: 20 },
      ];
      const f = buildBuildingFrame(simpleInput({ outline: L }))!;
      const inNotch = f.columns.filter((c) => c.x > 21 && c.z > 11);
      expect(inNotch).toHaveLength(0);
      expect(f.columns.length).toBeGreaterThan(0);
    });

    it("lets traced columns replace the inferred grid for that storey", () => {
      const f = buildBuildingFrame(
        simpleInput({
          floors: [
            {
              id: "f0",
              name: "Ground",
              ordinal: 0,
              columns: [
                { x: 0, z: 0 },
                { x: 5, z: 5 },
              ],
            },
            { id: "f1", name: "First", ordinal: 1 },
          ],
        })
      )!;
      const ground = f.columns.filter((c) => Math.abs(c.base - 0) < 1e-6);
      expect(ground).toHaveLength(2);
      expect(ground.every((c) => c.ref.startsWith("T/"))).toBe(true);
      // The storey above still uses the inferred grid.
      expect(f.columns.filter((c) => c.base > 1).length).toBeGreaterThan(2);
    });

    it("raises cores through the slab above the highest storey they serve", () => {
      const f = buildBuildingFrame(
        simpleInput({
          cores: [{ id: "c1", kind: "STAIR", x: 0, z: 0, width: 4, depth: 5, ordinals: [0] }],
        })
      )!;
      expect(f.cores).toHaveLength(1);
      // Serving only the ground floor, the core must still break the first-floor
      // slab — otherwise the stair has no opening to arrive through.
      expect(f.cores[0].base).toBe(0);
      expect(f.cores[0].top).toBeCloseTo(METRES_PER_STOREY, 6);
    });
  });

  describe("the LOD contract", () => {
    it("refuses to invent a frame at LOD MASSING", () => {
      const b = byId("b-acad-c"); // not a pilot
      expect(frameFor({ ...b, lod: "MASSING" })).toBeNull();
    });

    it("never frames a site feature", () => {
      const pond = campus.buildings.find((b) => b.id === "f-pond-1");
      expect(pond?.isSiteFeature).toBe(true);
      expect(frameFor({ ...pond!, lod: "GENERIC" })).toBeNull();
    });

    it("frames every real building, so each one opens to its storeys", () => {
      const real = campus.buildings.filter((b) => !b.isSiteFeature);
      const framed = real.filter((b) => frameFor(b) !== null);
      expect(framed.length).toBe(real.length);
      // Non-pilots are inferred: they must say so, never claim a survey.
      for (const b of real) {
        if (!(PILOT_BUILDING_IDS as readonly string[]).includes(b.id)) expect(b.lod).toBe("GENERIC");
      }
      // Site features stay as massing and stay unframed.
      for (const b of campus.buildings.filter((b) => b.isSiteFeature)) expect(frameFor(b)).toBeNull();
    });
  });

  describe("the three pilot buildings", () => {
    it("gives Academic Block W a basement below datum", () => {
      const f = frameFor(byId("b-acad-w"))!;
      const basement = f.slabs.find((s) => s.ordinal === -1);
      expect(basement).toBeTruthy();
      expect(basement!.top).toBeCloseTo(-3.2, 6);
      // The ground floor stays on the terrain.
      expect(f.slabs.find((s) => s.ordinal === 0)!.top).toBe(0);
      // 4.2 m entrance storey, then 3.5 m classrooms.
      expect(f.slabs.find((s) => s.ordinal === 1)!.top).toBeCloseTo(4.2, 6);
      expect(f.slabs.find((s) => s.ordinal === 2)!.top).toBeCloseTo(7.7, 6);
    });

    it("gives East Block unequal bays on its elongated plate", () => {
      const f = frameFor(byId("b-east"))!;
      // 96 m into 12 bays of 8 m; 60 m into 8 of 7.5 m.
      expect(f.bay.x).toBeCloseTo(8, 1);
      expect(f.bay.z).toBeCloseTo(7.5, 1);
      expect(f.bay.x).not.toBeCloseTo(f.bay.z, 2);
      expect(f.cores).toHaveLength(4);
    });

    it("leaves Central Hall's interior clear", () => {
      const b = byId("b-hall");
      const f = frameFor(b)!;
      expect(f.structureType).toBe("LONG_SPAN");
      // No column may stand more than one bay inside the perimeter.
      const xs = f.columns.map((c) => c.x);
      const zs = f.columns.map((c) => c.z);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const interior = f.columns.filter(
        (c) =>
          c.x > minX + f.bay.x * 0.5 &&
          c.x < maxX - f.bay.x * 0.5 &&
          c.z > minZ + f.bay.z * 0.5 &&
          c.z < maxZ - f.bay.z * 0.5
      );
      expect(interior).toHaveLength(0);
    });

    it("keeps each pilot inside the performance budget", () => {
      for (const id of PILOT_BUILDING_IDS) {
        const f = frameFor(byId(id))!;
        // Columns and beams are instanced (2 calls); slabs and cores are not.
        const drawCalls = f.stats.slabs + f.stats.cores + 2;
        expect(drawCalls, `${id} draw calls`).toBeLessThan(150);

        // 12 tris a box, 2 per slab triangulation pass — a generous estimate.
        const tris = (f.stats.columns + f.stats.beams + f.stats.cores) * 12 + f.stats.slabs * 64;
        expect(tris, `${id} triangles`).toBeLessThan(60_000);
      }
    });

    it("agrees with the massing height it replaces", () => {
      // The frame must not silently change how tall a building is: the roof slab
      // should land near the extruded box's top, or the 2D and 3D views diverge.
      for (const id of PILOT_BUILDING_IDS) {
        const b = byId(id);
        const f = frameFor(b)!;
        const roof = f.slabs[f.slabs.length - 1].top;
        // Pilot storey heights are deliberately taller than the nominal 3.5 m,
        // so allow the difference but require the same order of magnitude.
        expect(roof, `${id} roof height`).toBeGreaterThan(b.storeys * 2);
        expect(roof, `${id} roof height`).toBeLessThan(b.storeys * 8);
      }
    });
  });

  describe("local frame round-trip (Phase 2 tracing)", () => {
    it("returns a traced point to exactly where it was picked", () => {
      const centre = { x: 120, z: -340 };
      for (const angle of [0, 0.3, -0.7, Math.PI / 5]) {
        for (const world of [
          { x: 120, z: -340 },
          { x: 155, z: -312 },
          { x: 98.25, z: -377.5 },
        ]) {
          const local = toLocalFrame(world, centre, angle);
          const back = toWorldFrame(local, centre, angle);
          expect(back.x).toBeCloseTo(world.x, 9);
          expect(back.z).toBeCloseTo(world.z, 9);
        }
      }
    });

    it("puts the centroid at the local origin", () => {
      const centre = { x: 10, z: 20 };
      const local = toLocalFrame(centre, centre, 0.9);
      expect(local.x).toBeCloseTo(0, 9);
      expect(local.z).toBeCloseTo(0, 9);
    });
  });

  describe("traced walls", () => {
    const withWalls = (over: Partial<BuildingInput> = {}) =>
      buildBuildingFrame(
        simpleInput({
          floors: [
            {
              id: "f0",
              name: "Ground",
              ordinal: 0,
              walls: [
                { from: { x: -10, z: 0 }, to: { x: 10, z: 0 }, type: "STRUCTURAL" },
                { from: { x: 0, z: -5 }, to: { x: 0, z: 5 }, type: "PARTITION" },
                { from: { x: -10, z: 8 }, to: { x: 10, z: 8 }, type: "GLAZING" },
              ],
            },
            { id: "f1", name: "First", ordinal: 1 },
          ],
          ...over,
        })
      )!;

    it("stands walls on their own storey's slab", () => {
      const f = withWalls();
      expect(f.walls).toHaveLength(3);
      for (const w of f.walls) expect(w.base).toBe(0);
    });

    it("runs a structural wall to the soffit and stops the others short", () => {
      const f = withWalls();
      const soffit = f.slabs[1].top - f.slabs[1].thickness;
      const structural = f.walls.find((w) => w.type === "STRUCTURAL")!;
      const partition = f.walls.find((w) => w.type === "PARTITION")!;
      const glazing = f.walls.find((w) => w.type === "GLAZING")!;
      expect(structural.top).toBeCloseTo(soffit, 6);
      expect(partition.top).toBeLessThan(soffit);
      expect(glazing.top).toBeLessThan(partition.top);
      for (const w of f.walls) expect(w.top).toBeGreaterThan(w.base);
    });

    it("gives structural walls more thickness than partitions by default", () => {
      const f = withWalls();
      const structural = f.walls.find((w) => w.type === "STRUCTURAL")!;
      const partition = f.walls.find((w) => w.type === "PARTITION")!;
      expect(structural.thickness).toBeGreaterThan(partition.thickness);
    });

    it("records each wall's own bearing", () => {
      const f = withWalls();
      const eastWest = f.walls.find((w) => w.type === "STRUCTURAL")!;
      const northSouth = f.walls.find((w) => w.type === "PARTITION")!;
      expect(Math.abs(Math.sin(eastWest.angleRad))).toBeCloseTo(0, 6);
      expect(Math.abs(Math.cos(northSouth.angleRad))).toBeCloseTo(0, 6);
    });

    it("drops a zero-length wall rather than emitting a degenerate box", () => {
      const f = buildBuildingFrame(
        simpleInput({
          floors: [
            {
              id: "f0",
              name: "Ground",
              ordinal: 0,
              walls: [{ from: { x: 3, z: 3 }, to: { x: 3.01, z: 3 } }],
            },
            { id: "f1", name: "First", ordinal: 1 },
          ],
        })
      )!;
      expect(f.walls).toHaveLength(0);
    });

    it("has no walls at all without traced data", () => {
      const f = buildBuildingFrame(simpleInput())!;
      expect(f.walls).toHaveLength(0);
      expect(f.stats.walls).toBe(0);
    });
  });

  describe("earned LOD", () => {
    const floor = (over: Record<string, unknown> = {}) => ({ ...over });

    it("leaves an untraced building where it was claimed", () => {
      expect(earnedLod({ lod: "GENERIC", floors: [floor(), floor()] })).toBe("GENERIC");
      expect(earnedLod({ floors: [floor()] })).toBe("MASSING");
    });

    it("promotes to SPECIFIC once every storey is traced", () => {
      const traced = floor({ columns: [{ x: 0, z: 0 }] });
      expect(earnedLod({ lod: "GENERIC", floors: [traced, traced] })).toBe("SPECIFIC");
    });

    it("accepts a slab outline as tracing, not just columns", () => {
      const traced = floor({
        slabOutline: [
          { x: 0, z: 0 },
          { x: 1, z: 0 },
          { x: 1, z: 1 },
        ],
      });
      expect(earnedLod({ lod: "GENERIC", floors: [traced] })).toBe("SPECIFIC");
    });

    it("refuses to promote a part-traced building", () => {
      // The badge has to mean one thing, so one untraced storey holds it back.
      const traced = floor({ columns: [{ x: 0, z: 0 }] });
      expect(earnedLod({ lod: "GENERIC", floors: [traced, floor()] })).toBe("GENERIC");
    });

    it("reaches INTERFACES only with walls and cores together", () => {
      const traced = floor({ columns: [{ x: 0, z: 0 }] });
      const walled = floor({ columns: [{ x: 0, z: 0 }], walls: [{ from: { x: 0, z: 0 }, to: { x: 1, z: 0 } }] });
      expect(earnedLod({ lod: "GENERIC", floors: [walled] })).toBe("SPECIFIC");
      expect(
        earnedLod({
          lod: "GENERIC",
          floors: [walled],
          cores: [{ id: "c", kind: "STAIR", x: 0, z: 0, width: 4, depth: 5 }],
        })
      ).toBe("INTERFACES");
      expect(
        earnedLod({
          lod: "GENERIC",
          floors: [traced],
          cores: [{ id: "c", kind: "STAIR", x: 0, z: 0, width: 4, depth: 5 }],
        })
      ).toBe("SPECIFIC");
    });

    it("never lowers a surveyor's recorded claim", () => {
      // Only a person may retract a claim about the real world.
      expect(earnedLod({ lod: "INTERFACES", floors: [floor()] })).toBe("INTERFACES");
      expect(earnedLod({ lod: "SPECIFIC", floors: [floor(), floor()] })).toBe("SPECIFIC");
    });

    it("leaves the three pilots at GENERIC, since none are traced yet", () => {
      for (const id of PILOT_BUILDING_IDS) {
        expect(earnedLod(byId(id)), id).toBe("GENERIC");
      }
    });
  });


  describe("rooms", () => {
    /** A 10 x 8 m classroom off a corridor, in the building's local frame. */
    const CLASSROOM = [
      { x: -10, z: -4 },
      { x: 0, z: -4 },
      { x: 0, z: 4 },
      { x: -10, z: 4 },
    ];

    const withRooms = () =>
      buildBuildingFrame(
        simpleInput({
          floors: [
            {
              id: "f0",
              name: "Ground",
              ordinal: 0,
              rooms: [
                {
                  id: "r1",
                  code: "AE301",
                  name: "Design Series",
                  category: "CLASSROOM",
                  outline: CLASSROOM,
                  doors: [{ x: 0, z: 0 }],
                  destinationId: "d1",
                },
                {
                  id: "r2",
                  name: "Rest Room",
                  category: "WASHROOM",
                  outline: [
                    { x: 2, z: -3 },
                    { x: 6, z: -3 },
                    { x: 6, z: 1 },
                    { x: 2, z: 1 },
                  ],
                },
              ],
            },
            { id: "f1", name: "First", ordinal: 1 },
          ],
        })
      )!;

    it("computes polygon area for the room schedule", () => {
      expect(areaOf(CLASSROOM)).toBeCloseTo(80, 6);
      // Winding direction must not flip the sign.
      expect(areaOf([...CLASSROOM].reverse())).toBeCloseTo(80, 6);
    });

    it("stands rooms between their floor and the soffit above", () => {
      const f = withRooms();
      expect(f.rooms).toHaveLength(2);
      const soffit = f.slabs[1].top - f.slabs[1].thickness;
      for (const r of f.rooms) {
        expect(r.base).toBe(0);
        expect(r.top).toBeCloseTo(soffit, 6);
      }
    });

    it("carries the room schedule through: code, name, category, area", () => {
      const f = withRooms();
      const room = f.rooms.find((r) => r.id === "r1")!;
      expect(room.code).toBe("AE301");
      expect(room.name).toBe("Design Series");
      expect(room.category).toBe("CLASSROOM");
      expect(room.areaM2).toBeCloseTo(80, 3);
      expect(room.destinationId).toBe("d1");
    });

    it("defaults an uncategorised room to OTHER rather than guessing", () => {
      const f = buildBuildingFrame(
        simpleInput({
          floors: [
            {
              id: "f0",
              name: "Ground",
              ordinal: 0,
              rooms: [{ id: "r", name: "Store", outline: CLASSROOM }],
            },
            { id: "f1", name: "First", ordinal: 1 },
          ],
        })
      )!;
      expect(f.rooms[0].category).toBe("OTHER");
    });

    it("caps a room's ceiling at the soffit even if it asks for more", () => {
      const f = buildBuildingFrame(
        simpleInput({
          floors: [
            {
              id: "f0",
              name: "Ground",
              ordinal: 0,
              rooms: [{ id: "r", name: "Hall", outline: CLASSROOM, heightMetres: 99 }],
            },
            { id: "f1", name: "First", ordinal: 1 },
          ],
        })
      )!;
      const soffit = f.slabs[1].top - f.slabs[1].thickness;
      expect(f.rooms[0].top).toBeCloseTo(soffit, 6);
    });

    it("moves rooms into world metres, doors included", () => {
      const f = withRooms();
      const room = f.rooms.find((r) => r.id === "r1")!;
      // simpleInput's RECT is centred on (20, 10), so the local origin maps there.
      expect(room.centre.x).toBeCloseTo(15, 6);
      expect(room.centre.z).toBeCloseTo(10, 6);
      expect(room.doors).toHaveLength(1);
      expect(room.doors[0].x).toBeCloseTo(20, 6);
      expect(room.doors[0].z).toBeCloseTo(10, 6);
    });

    it("skips a degenerate room outline", () => {
      const f = buildBuildingFrame(
        simpleInput({
          floors: [
            {
              id: "f0",
              name: "Ground",
              ordinal: 0,
              rooms: [{ id: "bad", name: "Sliver", outline: [{ x: 0, z: 0 }, { x: 1, z: 0 }] }],
            },
            { id: "f1", name: "First", ordinal: 1 },
          ],
        })
      )!;
      expect(f.rooms).toHaveLength(0);
      expect(f.stats.rooms).toBe(0);
    });

    it("has no rooms on an untraced building", () => {
      const f = buildBuildingFrame(simpleInput())!;
      expect(f.rooms).toHaveLength(0);
    });
  });

});
