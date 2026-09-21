/**
 * Phase 1 structural data for the three pilot buildings.
 *
 * IMPORTANT — these are *engineering estimates*, not survey. Bay spacings,
 * storey heights and core positions are typical values for each building type,
 * chosen so the frame generator can be exercised against real footprints before
 * anyone traces a plan or flies a drone. Every pilot is therefore marked
 * `GENERIC` (LOD 200), never `SPECIFIC`: the renderer badges it as inferred so
 * an estimate is never shown to a user as a measurement.
 *
 * Phase 2 replaces this file. Once floor plans are traced in the admin editor
 * the data lives in the campus graph like everything else, and this overlay is
 * deleted rather than grown — so resist adding the other 45 buildings here.
 *
 * The three pilots deliberately cover three different structural problems:
 *  - `b-acad-w`  near-square RC frame, four storeys **plus a basement**, so
 *                negative floor ordinals are exercised.
 *  - `b-east`    96 x 60 m elongated plate with unequal bays in X and Z.
 *  - `b-hall`    a hall: `LONG_SPAN`, so the generator must produce a clear
 *                interior with no columns landing in the middle of the room.
 *
 * Core positions are metres from the building centroid in its own local frame
 * (X along the longest wall) — see building-structure.ts.
 */
import { AERO_3F_SLAB_OUTLINE, buildAeroThirdFloorRooms } from "./aero-block-3f";
import type { Building, CoreSpec, Floor } from "./campus";

export type PilotStructure = {
  building: Partial<Building>;
  /** Extra storeys to add, e.g. a basement the published graph does not carry. */
  addFloors?: Floor[];
  /** Per-floor overrides, keyed by ordinal. */
  floors?: Record<number, Partial<Floor>>;
};

const ACADEMIC_CORES: CoreSpec[] = [
  { id: "aw-stair-w", kind: "STAIR", x: -24, z: 0, width: 5.5, depth: 7 },
  { id: "aw-stair-e", kind: "STAIR", x: 24, z: 0, width: 5.5, depth: 7 },
  { id: "aw-lift", kind: "LIFT", x: -24, z: 10.5, width: 3.2, depth: 5 },
];

const EAST_CORES: CoreSpec[] = [
  { id: "eb-stair-w", kind: "STAIR", x: -38, z: 0, width: 6, depth: 7 },
  // A 96 m plate needs a third stair mid-length to keep travel distances sane.
  { id: "eb-stair-m", kind: "STAIR", x: 0, z: 0, width: 6, depth: 7 },
  { id: "eb-stair-e", kind: "STAIR", x: 38, z: 0, width: 6, depth: 7 },
  { id: "eb-lift", kind: "LIFT", x: -32, z: 9, width: 3.2, depth: 5 },
];

const HALL_CORES: CoreSpec[] = [
  { id: "ch-stair-w", kind: "STAIR", x: -28, z: -17, width: 5, depth: 6 },
  { id: "ch-stair-e", kind: "STAIR", x: 28, z: -17, width: 5, depth: 6 },
];

/**
 * Aeronautical Block. The stair sits at the west end of the corridor, which is
 * where the walkthrough video arrives on the third floor.
 */
const AERO_CORES: CoreSpec[] = [
  { id: "ab-stair-w", kind: "STAIR", x: -32, z: 0, width: 6, depth: 7.5 },
  { id: "ab-stair-e", kind: "STAIR", x: 32, z: 0, width: 5.5, depth: 7 },
];

export const PILOT_BUILDING_IDS = ["b-acad-w", "b-east", "b-hall", "n-blk-ne2"] as const;

/** The building and storey the room-level survey covers so far. */
export const AERO_BLOCK_ID = "n-blk-ne2";
export const AERO_THIRD_FLOOR_ORDINAL = 3;

export const PILOT_STRUCTURE: Record<string, PilotStructure> = {
  /* ---- Pilot 1: near-square academic block, with a basement ---- */
  "b-acad-w": {
    building: {
      lod: "GENERIC",
      structureType: "RC_FRAME",
      roofType: "FLAT",
      gridSpacingX: 7.5,
      gridSpacingZ: 7.5,
      columnSize: 0.5,
      slabThickness: 0.25,
      beamDepth: 0.6,
      basementsCount: 1,
      cores: ACADEMIC_CORES,
    },
    addFloors: [
      {
        id: "b-acad-w-b1",
        buildingId: "b-acad-w",
        name: "Basement",
        ordinal: -1,
        code: "B1",
      },
    ],
    floors: {
      // Parking headroom needs more than a classroom storey.
      [-1]: { heightMetres: 3.2 },
      // A taller ground floor with the entrance foyer, then a regular stack.
      0: { heightMetres: 4.2 },
      1: { heightMetres: 3.5 },
      2: { heightMetres: 3.5 },
      3: { heightMetres: 3.5 },
    },
  },

  /* ---- Pilot 2: elongated plate, unequal bays ---- */
  "b-east": {
    building: {
      lod: "GENERIC",
      structureType: "RC_FRAME",
      roofType: "FLAT",
      // 96 m divides into 12 bays of exactly 8 m; 60 m into 8 of 7.5 m.
      gridSpacingX: 8,
      gridSpacingZ: 7.5,
      columnSize: 0.55,
      slabThickness: 0.25,
      beamDepth: 0.7,
      cores: EAST_CORES,
    },
    floors: {
      0: { heightMetres: 4 },
      1: { heightMetres: 3.6 },
      2: { heightMetres: 3.6 },
    },
  },

  /* ---- Pilot 3: the hall — long span, clear interior ---- */
  "b-hall": {
    building: {
      lod: "GENERIC",
      structureType: "LONG_SPAN",
      roofType: "PITCHED",
      // Wide bays: a long-span roof carries onto perimeter columns only, so the
      // spacing describes the truss pitch rather than an internal grid.
      gridSpacingX: 9.5,
      gridSpacingZ: 8.5,
      columnSize: 0.7,
      slabThickness: 0.3,
      beamDepth: 1.2,
      cores: HALL_CORES,
    },
    floors: {
      // Foyer and support rooms under a double-height auditorium volume.
      0: { heightMetres: 4.5 },
      1: { heightMetres: 7.5 },
    },
  },

  /* ---- Pilot 4: Aeronautical Block, with a surveyed third-floor schedule ---- */
  [AERO_BLOCK_ID]: {
    building: {
      lod: "GENERIC",
      structureType: "RC_FRAME",
      roofType: "FLAT",
      // 71 m divides into 9 bays of 7.89 m; 38 m into 5 of 7.6 m.
      gridSpacingX: 7.9,
      gridSpacingZ: 7.6,
      columnSize: 0.5,
      slabThickness: 0.25,
      beamDepth: 0.6,
      floorsCount: 4,
      cores: AERO_CORES,
    },
    // The published graph has only Ground and Floor 1 for this block. The
    // photographs are of a third floor, so the record is simply incomplete —
    // these two storeys are added so the floor that exists can be modelled.
    // Delete them from here once the graph itself is corrected.
    addFloors: [
      { id: "n-blk-ne2-f2", buildingId: AERO_BLOCK_ID, name: "Floor 2", ordinal: 2, code: "2" },
      { id: "n-blk-ne2-f3", buildingId: AERO_BLOCK_ID, name: "Floor 3", ordinal: 3, code: "3" },
    ],
    floors: {
      0: { heightMetres: 3.9 },
      1: { heightMetres: 3.6 },
      2: { heightMetres: 3.6 },
      // The only storey with a room schedule. Its slab is stepped back from the
      // footprint below — see the note in aero-block-3f.ts.
      3: {
        heightMetres: 3.6,
        slabOutline: AERO_3F_SLAB_OUTLINE,
        rooms: buildAeroThirdFloorRooms(),
      },
    },
  },
};

/**
 * Merges the pilot overlay into a campus graph, returning a new graph. Buildings
 * outside the pilot set are passed through untouched, so the campus keeps
 * rendering exactly as it did at LOD MASSING.
 */
export function applyPilotStructure<T extends Record<string, any>>(graph: T): T {
  if (!graph || !Array.isArray(graph.buildings)) return graph;

  const buildings = graph.buildings.map((b: any) => {
    const pilot = PILOT_STRUCTURE[String(b?.id)];
    return pilot ? { ...b, ...pilot.building } : b;
  });

  const floors: any[] = Array.isArray(graph.floors) ? [...graph.floors] : [];

  for (const [buildingId, pilot] of Object.entries(PILOT_STRUCTURE)) {
    for (const extra of pilot.addFloors ?? []) {
      if (!floors.some((f) => f?.id === extra.id)) floors.push(extra);
    }
    if (!pilot.floors) continue;
    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      if (f?.buildingId !== buildingId) continue;
      const override = pilot.floors[Number(f.ordinal)];
      if (override) floors[i] = { ...f, ...override };
    }
  }

  return { ...graph, buildings, floors };
}
