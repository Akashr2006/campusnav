/**
 * Aeronautical Block, third floor — schematic room schedule.
 *
 * WHAT IS REAL HERE, AND WHAT IS NOT. Everything about *identity and order* came
 * from photographs and a walkthrough video of the floor: which rooms exist, their
 * signed codes and names, what each is used for, which side of the corridor they
 * sit on, and the sequence you pass them walking east from the stair. That is a
 * genuine survey of the schedule and the topology.
 *
 * Every *dimension* is provisional. Photographs carry no scale, so room widths,
 * the corridor width and the depth of the range are estimates laid along the
 * building's real 71.0 m frontage. The floor is therefore published at LOD
 * GENERIC and badged as inferred; it must not be read as measured.
 *
 * Which is why the schedule below is a table of widths rather than a list of
 * polygons: replacing an estimate with a tape measurement is editing one number,
 * and `buildAeroThirdFloorRooms` re-derives every polygon from it. Swapping in
 * the real survey is a data edit, not a rebuild.
 *
 * Evidence, for whoever checks this later:
 *  - `AE301` signed on both door and wall, captioned "DESIGN SERIES".
 *  - "AERO DRAWING HALL" signed on double doors off the stair lobby.
 *  - Two "REST ROOM" signs at the far end of the corridor.
 *  - A double-loaded corridor with unglazed square openings in both walls.
 *  - Downstand beams across the classroom ceilings, confirming the RC frame.
 *  - A dog-leg stair with a mid-landing arriving at the corridor's west end.
 */
import type { RoomCategory, RoomSpec } from "./campus";

/** One space in the schedule. `width` runs along the corridor. */
export type ScheduleEntry = {
  id: string;
  code?: string;
  name: string;
  category: RoomCategory;
  /** Metres along the corridor. PROVISIONAL — replace with a measurement. */
  width: number;
};

export type FloorSchedule = {
  /** Real: the surveyed footprint's 71 m frontage. */
  plateLength: number;
  /** PROVISIONAL: the depth of the range this storey occupies, not the footprint. */
  plateDepth: number;
  /** PROVISIONAL. */
  corridorWidth: number;
  /** PROVISIONAL. Stair core at the west end, excluded from the room runs. */
  stairBay: number;
  /** North of the corridor, west to east. */
  north: ScheduleEntry[];
  /** South of the corridor, west to east. */
  south: ScheduleEntry[];
};

export const AERO_3F_SCHEDULE: FloorSchedule = {
  plateLength: 71,
  // The range this floor occupies, not the whole footprint — see the note above.
  plateDepth: 24,
  corridorWidth: 3,
  stairBay: 7,
  north: [
    { id: "ae3-dh1", code: "AE305", name: "Aero Drawing Hall", category: "DRAWING_HALL", width: 22 },
    { id: "ae3-lab1", code: "AE306", name: "Aero Drawing Hall 2", category: "DRAWING_HALL", width: 20 },
    { id: "ae3-store", code: "AE307", name: "Aero Lab Store", category: "STORE", width: 14 },
    { id: "ae3-wc-m", name: "Rest Room (Men)", category: "WASHROOM", width: 8 },
  ],
  south: [
    { id: "ae3-301", code: "AE301", name: "Design Series", category: "CLASSROOM", width: 22 },
    { id: "ae3-302", code: "AE302", name: "Classroom", category: "CLASSROOM", width: 20 },
    { id: "ae3-303", code: "AE303", name: "Classroom", category: "CLASSROOM", width: 14 },
    { id: "ae3-wc-w", name: "Rest Room (Women)", category: "WASHROOM", width: 8 },
  ],
};

/** Wall thickness assumed between rooms, metres. Provisional. */
const PARTITION = 0.15;

/**
 * Turns the schedule into room polygons in the building's local frame.
 *
 * The local frame is centred on the footprint centroid with X along the longest
 * wall — the frame `building-structure.ts` reads traced geometry in. For this
 * block that puts X east-west across the 71 m frontage and Z north-south across
 * the range's depth, with north at negative Z (world Z runs south).
 *
 * Rooms are inset by half a partition so neighbours do not share a face and
 * z-fight where they meet.
 */
export function buildAeroThirdFloorRooms(s: FloorSchedule = AERO_3F_SCHEDULE): RoomSpec[] {
  const halfLength = s.plateLength / 2;
  const halfDepth = s.plateDepth / 2;
  const halfCorridor = s.corridorWidth / 2;
  const inset = PARTITION / 2;

  const rooms: RoomSpec[] = [];

  const run = (entries: ScheduleEntry[], side: "north" | "south") => {
    // Rooms start after the stair core at the west end.
    let x = -halfLength + s.stairBay;
    for (const e of entries) {
      const x0 = x + inset;
      const x1 = x + e.width - inset;
      // North is -Z; both runs go from the corridor edge out to the facade.
      const zNear = side === "north" ? -halfCorridor - inset : halfCorridor + inset;
      const zFar = side === "north" ? -halfDepth + inset : halfDepth - inset;
      const zLo = Math.min(zNear, zFar);
      const zHi = Math.max(zNear, zFar);

      rooms.push({
        id: e.id,
        code: e.code,
        name: e.name,
        category: e.category,
        outline: [
          { x: x0, z: zLo },
          { x: x1, z: zLo },
          { x: x1, z: zHi },
          { x: x0, z: zHi },
        ],
        // One door, centred on the room's corridor edge.
        doors: [{ x: (x0 + x1) / 2, z: zNear }],
      });
      x += e.width;
    }
  };

  run(s.north, "north");
  run(s.south, "south");

  // The corridor is a room too: it is the space people actually walk, and the
  // one a route through this floor is drawn along.
  rooms.push({
    id: "ae3-corridor",
    name: "Corridor",
    category: "CORRIDOR",
    outline: [
      { x: -halfLength + inset, z: -halfCorridor + inset },
      { x: halfLength - inset, z: -halfCorridor + inset },
      { x: halfLength - inset, z: halfCorridor - inset },
      { x: -halfLength + inset, z: halfCorridor - inset },
    ],
  });

  // The stair lobby at the west end, where the walkthrough arrives.
  rooms.push({
    id: "ae3-lobby",
    name: "Stair Lobby",
    category: "STAIR",
    outline: [
      { x: -halfLength + inset, z: -halfDepth + inset },
      { x: -halfLength + s.stairBay - inset, z: -halfDepth + inset },
      { x: -halfLength + s.stairBay - inset, z: halfDepth - inset },
      { x: -halfLength + inset, z: halfDepth - inset },
    ],
  });

  return rooms;
}

/**
 * The third floor's own slab, stepped back from the footprint below.
 *
 * Derived from the surveyed corner latitudes by insetting 7 m north and south,
 * which at this latitude is 0.00006328 degrees (7 m over 110618.46 m/degree).
 * Longitudes are unchanged: the step-back is in depth only.
 */
export const AERO_3F_SLAB_OUTLINE: { lat: number; lng: number }[] = [
  { lat: 11.49774762, lng: 77.278365 },
  { lat: 11.49774762, lng: 77.2790158 },
  { lat: 11.49753068, lng: 77.2790158 },
  { lat: 11.49753068, lng: 77.278365 },
];

/** Total room area, m². A check against the plate: it must not exceed it. */
export function scheduleArea(s: FloorSchedule = AERO_3F_SCHEDULE): number {
  return buildAeroThirdFloorRooms(s).reduce((sum, r) => {
    let a = 0;
    const p = r.outline;
    for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length];
      a += p[i].x * q.z - q.x * p[i].z;
    }
    return sum + Math.abs(a / 2);
  }, 0);
}
