/**
 * Derives a believable interior from a floor's room schedule: walls with real
 * openings, and the furniture, fans and light fittings that make a space read as
 * the room it actually is.
 *
 * All of it is *derived*, like everything else in this pipeline — there is no
 * hand-placed geometry. Give a room an outline and a category and this produces
 * its enclosure and its fit-out. Change the schedule and the interior follows.
 *
 * Every detail here was chosen from the photographs of the Aeronautical Block's
 * third floor rather than from a generic idea of a classroom:
 *  - Unglazed square openings in both corridor walls, sill about waist height.
 *  - Internal glazed windows between the drawing halls and the corridor.
 *  - Large grilled windows on the facade, sill low, head near the ceiling.
 *  - Twin fluorescent tube fittings in rows, and ceiling fans on long down-rods.
 *  - Tiered desk-and-bench pairs in the classrooms; drafting tables with wire
 *    baskets beneath in the drawing halls.
 *  - A dark teal-grey used on every skirting, door frame and window frame.
 *
 * Nothing here imports three.js: it answers "what is in the room and where",
 * and the renderer turns that into meshes.
 */
import type { RoomCategory } from "@/shared/data/campus";
import type { BuildingFrame, Room } from "./building-structure";
import type { Vec2 } from "./campus-3d";

/* ------------------------------------------------------------------ palette */

/**
 * Sampled from the walkthrough photographs, not invented. The teal-grey is the
 * single most recognisable thing about this building's interior — it is on every
 * skirting, door frame and window frame in every shot.
 */
export const INTERIOR = {
  wall: "#E8E4DC",
  wallGrubby: "#DED9CF",
  ceiling: "#F1EFE9",
  skirting: "#33505A",
  frame: "#2E4A52",
  doorLeaf: "#DCDCD6",
  floorCement: "#918D86",
  floorCorridor: "#83807A",
  concrete: "#B4AEA4",
  deskTop: "#A96A33",
  deskTopLight: "#C08B4E",
  steel: "#A8A096",
  laminate: "#E4E0D6",
  fan: "#EFEDE7",
  tube: "#FFF6E2",
  glass: "#AFC6D2",
  granite: "#AE8275",
} as const;

/* -------------------------------------------------------------------- walls */

export type OpeningKind = "DOOR" | "WINDOW" | "HATCH" | "GLAZED";

/** An opening, positioned by distance along the wall from its start. */
export type Opening = {
  kind: OpeningKind;
  /** Metres from the wall's start point. */
  at: number;
  width: number;
  /** Metres above the floor. */
  sill: number;
  head: number;
};

export type WallKind = "EXTERIOR" | "CORRIDOR" | "PARTITION";

export type InteriorWall = {
  id: string;
  from: Vec2;
  to: Vec2;
  length: number;
  angleRad: number;
  thickness: number;
  base: number;
  top: number;
  kind: WallKind;
  openings: Opening[];
};

const DOOR = { width: 1.05, head: 2.1 };
/** The corridor hatches: waist-high sill, roughly square. */
const HATCH = { width: 1.6, sill: 1.0, head: 2.2 };
const FACADE_WINDOW = { width: 2.1, sill: 0.95, pitch: 4.2 };
const T = { EXTERIOR: 0.23, CORRIDOR: 0.23, PARTITION: 0.15 } as const;

function key(a: Vec2, b: Vec2) {
  // Canonical, so a shared partition is not built twice — once from each room.
  const r = (n: number) => Math.round(n * 100) / 100;
  const p = `${r(a.x)},${r(a.z)}`;
  const q = `${r(b.x)},${r(b.z)}`;
  return p < q ? `${p}|${q}` : `${q}|${p}`;
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
}

function dist(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Distance from a point to a segment, for deciding if an edge faces a room. */
function pointToSegment(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-9) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2));
  return dist(p, { x: a.x + t * dx, z: a.z + t * dz });
}

/** Rooms whose enclosure is implied by their neighbours, not built. */
const UNWALLED: RoomCategory[] = ["CORRIDOR"];

/**
 * Builds the enclosure for one storey.
 *
 * Each room contributes its outline edges; shared edges are built once. An edge
 * is EXTERIOR when it sits on the slab's own boundary, CORRIDOR when it faces the
 * corridor room, and PARTITION otherwise — and each kind gets the openings that
 * kind of wall really has.
 */
export function buildInteriorWalls(
  rooms: Room[],
  slabOutline: Vec2[],
  base: number,
  top: number
): InteriorWall[] {
  const corridor = rooms.find((r) => r.category === "CORRIDOR");
  const seen = new Set<string>();
  const walls: InteriorWall[] = [];

  const onSlabEdge = (a: Vec2, b: Vec2) => {
    const m = midpoint(a, b);
    for (let i = 0; i < slabOutline.length; i++) {
      const p = slabOutline[i];
      const q = slabOutline[(i + 1) % slabOutline.length];
      if (pointToSegment(m, p, q) < 0.6) return true;
    }
    return false;
  };

  const facesCorridor = (a: Vec2, b: Vec2) => {
    if (!corridor) return false;
    const m = midpoint(a, b);
    for (let i = 0; i < corridor.outline.length; i++) {
      const p = corridor.outline[i];
      const q = corridor.outline[(i + 1) % corridor.outline.length];
      if (pointToSegment(m, p, q) < 0.6) return true;
    }
    return false;
  };

  for (const room of rooms) {
    if (UNWALLED.includes(room.category)) continue;

    for (let i = 0; i < room.outline.length; i++) {
      const a = room.outline[i];
      const b = room.outline[(i + 1) % room.outline.length];
      const length = dist(a, b);
      if (length < 0.4) continue;

      const k = key(a, b);
      if (seen.has(k)) continue;
      seen.add(k);

      const kind: WallKind = onSlabEdge(a, b)
        ? "EXTERIOR"
        : facesCorridor(a, b)
          ? "CORRIDOR"
          : "PARTITION";

      const openings: Opening[] = [];

      if (kind === "CORRIDOR") {
        // The door this room's schedule already records, projected onto the wall.
        const door = room.doors[0];
        const along = door
          ? Math.max(
              0.8,
              Math.min(
                length - 0.8 - DOOR.width,
                ((door.x - a.x) * (b.x - a.x) + (door.z - a.z) * (b.z - a.z)) / length
              )
            )
          : length / 2 - DOOR.width / 2;
        openings.push({ kind: "DOOR", at: along, width: DOOR.width, sill: 0, head: DOOR.head });

        // Then the openings the photographs show in the corridor walls: unglazed
        // in the teaching rooms, glazed where a hall is supervised from outside.
        const glazed = room.category === "DRAWING_HALL" || room.category === "LAB";
        const gap = 0.9;
        let x = gap;
        while (x + HATCH.width < length - gap) {
          const clashesWithDoor = x < along + DOOR.width + 0.6 && x + HATCH.width > along - 0.6;
          if (!clashesWithDoor) {
            openings.push({
              kind: glazed ? "GLAZED" : "HATCH",
              at: x,
              width: HATCH.width,
              sill: HATCH.sill,
              head: HATCH.head,
            });
          }
          x += HATCH.width + 1.5;
        }
      }

      if (kind === "EXTERIOR" && room.category !== "WASHROOM") {
        // Grilled windows at a regular pitch, head just under the ceiling.
        const head = Math.min(top - base - 0.5, 2.55);
        const count = Math.max(1, Math.floor((length - 1.6) / FACADE_WINDOW.pitch));
        const spacing = (length - 1.6) / count;
        for (let n = 0; n < count; n++) {
          const at = 0.8 + n * spacing + (spacing - FACADE_WINDOW.width) / 2;
          if (at > 0.4 && at + FACADE_WINDOW.width < length - 0.4) {
            openings.push({
              kind: "WINDOW",
              at,
              width: FACADE_WINDOW.width,
              sill: FACADE_WINDOW.sill,
              head,
            });
          }
        }
      }

      openings.sort((p, q) => p.at - q.at);

      walls.push({
        id: `${room.id}-w${i}`,
        from: a,
        to: b,
        length,
        angleRad: Math.atan2(b.z - a.z, b.x - a.x),
        thickness: T[kind],
        base,
        top,
        kind,
        openings,
      });
    }
  }

  return walls;
}

/* ---------------------------------------------------------------- fit-out */

export type FurnitureKind =
  | "DESK"
  | "BENCH"
  | "DRAFTING_TABLE"
  | "DRAFTING_BASKET"
  | "SHELF";

export type FurnitureItem = {
  kind: FurnitureKind;
  /** Centre, world metres. */
  at: Vec2;
  y: number;
  width: number;
  depth: number;
  height: number;
  angleRad: number;
};

export type Fitting = {
  kind: "FAN" | "TUBE";
  at: Vec2;
  /** Height of the fitting itself, metres above the floor. */
  y: number;
  angleRad: number;
};

/** Rotate about the origin — consistent for both directions, no centroid needed. */
function rot(p: Vec2, a: number): Vec2 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c };
}

/** A room's extents in the building's own axes, so a grid lines up with its walls. */
function localBox(outline: Vec2[], angleRad: number) {
  const pts = outline.map((p) => rot(p, -angleRad));
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minZ: Math.min(...pts.map((p) => p.z)),
    maxZ: Math.max(...pts.map((p) => p.z)),
  };
}

/** Desk-and-bench pairs in rows with a centre aisle, as the photographs show. */
const DESK = { width: 1.25, depth: 0.5, height: 0.76, pitch: 1.35, gap: 0.25 };
const DRAFT = { width: 1.0, depth: 0.72, height: 0.88, pitch: 1.5 };

/**
 * Lays out furniture for one room.
 *
 * Rows run along the building's long axis and stop clear of the walls, which is
 * both how the photographs look and what keeps a desk from poking through a
 * window. Rooms with no fit-out worth modelling return nothing rather than being
 * filled with something generic.
 */
export function furnishRoom(room: Room, angleRad: number): FurnitureItem[] {
  const out: FurnitureItem[] = [];
  const box = localBox(room.outline, angleRad);
  const margin = 1.3;
  const x0 = box.minX + margin;
  const x1 = box.maxX - margin;
  const z0 = box.minZ + margin;
  const z1 = box.maxZ - margin;
  if (x1 - x0 < 2 || z1 - z0 < 2) return out;

  const place = (kind: FurnitureKind, lx: number, lz: number, d: typeof DESK | typeof DRAFT, h: number) => {
    const w = rot({ x: lx, z: lz }, angleRad);
    out.push({
      kind,
      at: w,
      y: room.base,
      width: d.width,
      depth: d.depth,
      height: h,
      angleRad,
    });
  };

  if (room.category === "CLASSROOM") {
    // Columns of desks with an aisle every third one — the arrangement in the
    // AE301 photographs, where the room reads as blocks of seating.
    const colPitch = DESK.width + 0.45;
    const cols = Math.floor((x1 - x0) / colPitch);
    const rows = Math.floor((z1 - z0) / DESK.pitch);
    const xPad = (x1 - x0 - cols * colPitch) / 2;
    for (let r = 0; r < rows; r++) {
      const lz = z0 + r * DESK.pitch + DESK.depth / 2;
      for (let c = 0; c < cols; c++) {
        // Aisle: skip a column every fourth.
        if (c % 4 === 3) continue;
        const lx = x0 + xPad + c * colPitch + DESK.width / 2;
        place("DESK", lx, lz, DESK, DESK.height);
        place("BENCH", lx, lz + DESK.depth + DESK.gap, DESK, 0.46);
      }
    }
    return out;
  }

  if (room.category === "DRAWING_HALL" || room.category === "LAB") {
    const colPitch = DRAFT.width + 0.5;
    const cols = Math.floor((x1 - x0) / colPitch);
    const rows = Math.floor((z1 - z0) / DRAFT.pitch);
    const xPad = (x1 - x0 - cols * colPitch) / 2;
    for (let r = 0; r < rows; r++) {
      const lz = z0 + r * DRAFT.pitch + DRAFT.depth / 2;
      for (let c = 0; c < cols; c++) {
        if (c % 5 === 4) continue;
        const lx = x0 + xPad + c * colPitch + DRAFT.width / 2;
        place("DRAFTING_TABLE", lx, lz, DRAFT, DRAFT.height);
        // The wire basket slung under every drafting table in the photographs.
        place("DRAFTING_BASKET", lx, lz, DRAFT, 0.22);
      }
    }
    return out;
  }

  if (room.category === "STORE") {
    // Shelving along the long walls only, leaving the middle clear.
    const rows = Math.floor((x1 - x0) / 1.1);
    for (let i = 0; i < rows; i++) {
      const lx = x0 + i * 1.1 + 0.5;
      place("SHELF", lx, z0 + 0.35, DRAFT, 1.9);
    }
    return out;
  }

  return out;
}

/**
 * Fans and tube lights on a room's ceiling.
 *
 * Fan pitch comes straight off the photographs — roughly three and a half metres,
 * which for AE301 lands about a dozen fans, matching what is visible in the shot.
 */
export function fitOutCeiling(room: Room, angleRad: number): Fitting[] {
  if (room.category === "WASHROOM" || room.category === "STORE") return [];
  const out: Fitting[] = [];
  const box = localBox(room.outline, angleRad);
  const ceiling = room.top - room.base;

  const isCorridor = room.category === "CORRIDOR";
  const fanPitch = 3.6;
  const tubePitch = isCorridor ? 5.5 : 3.6;

  const spanX = box.maxX - box.minX;
  const spanZ = box.maxZ - box.minZ;

  if (!isCorridor && spanX > 3 && spanZ > 3) {
    const nx = Math.max(1, Math.round((spanX - 2) / fanPitch));
    const nz = Math.max(1, Math.round((spanZ - 2) / fanPitch));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const lx = box.minX + ((i + 0.5) * spanX) / nx;
        const lz = box.minZ + ((j + 0.5) * spanZ) / nz;
        out.push({
          kind: "FAN",
          at: rot({ x: lx, z: lz }, angleRad),
          // Hung on a down-rod, well below the slab.
          y: room.base + ceiling - 0.55,
          angleRad,
        });
      }
    }
  }

  const nt = Math.max(1, Math.round((spanX - 1.5) / tubePitch));
  const rowsZ = isCorridor ? 1 : Math.max(1, Math.round((spanZ - 2) / 5));
  for (let i = 0; i < nt; i++) {
    for (let j = 0; j < rowsZ; j++) {
      const lx = box.minX + ((i + 0.5) * spanX) / nt;
      const lz = box.minZ + ((j + 0.5) * spanZ) / rowsZ;
      out.push({
        kind: "TUBE",
        at: rot({ x: lx, z: lz }, angleRad),
        y: room.base + ceiling - 0.12,
        angleRad,
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ bundle */

export type FloorInterior = {
  walls: InteriorWall[];
  furniture: FurnitureItem[];
  fittings: Fitting[];
  stats: { walls: number; openings: number; furniture: number; fittings: number };
};

/** Empty interior, so callers never branch on null. */
export const EMPTY_INTERIOR: FloorInterior = {
  walls: [],
  furniture: [],
  fittings: [],
  stats: { walls: 0, openings: 0, furniture: 0, fittings: 0 },
};

/**
 * The full interior for whichever storey the frame currently holds. Expects an
 * already-isolated frame: an interior only makes sense one floor at a time, and
 * furnishing four storeys nobody is looking at is wasted geometry.
 */
export function buildFloorInterior(frame: BuildingFrame): FloorInterior {
  if (!frame.rooms.length || frame.slabs.length < 2) return EMPTY_INTERIOR;

  const base = frame.slabs[0].top;
  const ceilingSlab = frame.slabs[1];
  const top = ceilingSlab.top - ceilingSlab.thickness;

  const walls = buildInteriorWalls(frame.rooms, frame.slabs[0].outline, base, top);
  const furniture = frame.rooms.flatMap((r) => furnishRoom(r, frame.angleRad));
  const fittings = frame.rooms.flatMap((r) => fitOutCeiling(r, frame.angleRad));

  return {
    walls,
    furniture,
    fittings,
    stats: {
      walls: walls.length,
      openings: walls.reduce((n, w) => n + w.openings.length, 0),
      furniture: furniture.length,
      fittings: fittings.length,
    },
  };
}
