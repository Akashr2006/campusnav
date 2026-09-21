/**
 * Derives a building's structural frame from its floor records.
 *
 * The frame is *generated*, never imported: slabs, columns, beams and cores are
 * a pure function of the campus graph, the same way `buildCampus3D` already is
 * for footprints. That is what keeps 48 buildings maintainable — rename a floor
 * or move a core and the geometry follows, and every element stays tied to the
 * row it came from so the frame doubles as a navigation surface.
 *
 * Nothing here imports three.js. This module answers "where is the structure";
 * turning that into meshes is the renderer's job (see building-frame.tsx), which
 * keeps the geometry testable in plain node.
 *
 * Frames of reference, and why there are two:
 *  - **World metres** — the `Vec2` space `campus-3d.ts` projects to (X east,
 *    Z south). Everything returned from here is in world metres.
 *  - **Local metres** — the building rotated so its longest wall runs along X,
 *    centred on its own centroid. The bay grid is laid out here, then rotated
 *    back, so a building that does not sit square to north still gets a grid
 *    parallel to its own walls. Traced `columns` and `cores` are authored in
 *    this frame too.
 */
import type {
  BuildingLod,
  ColumnSpec,
  CoreSpec,
  RoomCategory,
  RoomSpec,
  StructureType,
  WallSpec,
} from "@/shared/data/campus";
import { METRES_PER_STOREY, type Vec2 } from "./campus-3d";

/** Typical RC bay for an academic block, metres. Overridden per building. */
export const DEFAULT_BAY = 7.5;
export const DEFAULT_COLUMN_SIZE = 0.5;
export const DEFAULT_SLAB_THICKNESS = 0.25;
export const DEFAULT_BEAM_DEPTH = 0.6;

/** One storey's slab. `top` is the walking surface; the slab hangs below it. */
export type Slab = {
  floorId: string;
  name: string;
  ordinal: number;
  outline: Vec2[];
  /** Metres above site datum of the walking surface. */
  top: number;
  thickness: number;
  /** Floor-to-floor height of the storey this slab starts. */
  storeyHeight: number;
  /** True for the cap generated above the topmost floor. */
  isRoof: boolean;
};

export type Column = {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Bottom and top of the shaft, metres above datum. */
  base: number;
  top: number;
  /** Grid reference, e.g. "C/4" — real drawings label columns, so ours do too. */
  ref: string;
};

export type Beam = {
  from: Vec2;
  to: Vec2;
  /** Centreline height of the beam, metres above datum. */
  y: number;
  width: number;
  depth: number;
};

/**
 * A traced wall, standing on one storey. Only ever comes from a real plan —
 * there is no sensible way to infer where a partition goes from a footprint, so
 * walls are what separate a surveyed floor (LOD 300+) from an inferred one.
 */
export type Wall = {
  from: Vec2;
  to: Vec2;
  thickness: number;
  /** Structural walls run slab to slab; partitions stop short of the soffit. */
  type: NonNullable<WallSpec["type"]>;
  /** Bottom and top, metres above datum. */
  base: number;
  top: number;
  angleRad: number;
};

/** An enclosed space, ready to extrude and label. */
export type Room = {
  id: string;
  floorId: string;
  code?: string;
  name: string;
  category: RoomCategory;
  /** World metres. */
  outline: Vec2[];
  centre: Vec2;
  doors: Vec2[];
  destinationId?: string;
  /** Floor level and ceiling, metres above datum. */
  base: number;
  top: number;
  /** Plan area, m^2 — the figure a room schedule is checked against. */
  areaM2: number;
};

export type Core = {
  id: string;
  kind: CoreSpec["kind"];
  centre: Vec2;
  width: number;
  depth: number;
  /** Degrees the core is rotated, matching the building's grid angle. */
  angleRad: number;
  base: number;
  top: number;
};

export type BuildingFrame = {
  buildingId: string;
  lod: BuildingLod;
  structureType: StructureType;
  slabs: Slab[];
  columns: Column[];
  beams: Beam[];
  walls: Wall[];
  rooms: Room[];
  cores: Core[];
  /** Grid rotation, radians, for orienting box meshes along the building. */
  angleRad: number;
  /** Bay spacings actually used after fitting to the footprint. */
  bay: { x: number; z: number };
  /** Mesh counts, so the performance budget can be asserted in tests. */
  stats: {
    slabs: number;
    columns: number;
    beams: number;
    walls: number;
    rooms: number;
    cores: number;
  };
};

/* ------------------------------------------------------------------ helpers */

function rotate(p: Vec2, angle: number, about: Vec2): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - about.x;
  const dz = p.z - about.z;
  return { x: about.x + dx * c - dz * s, z: about.z + dx * s + dz * c };
}

/**
 * World metres to a building's local frame — the inverse of how traced `columns`,
 * `walls` and `cores` are read back. The editor traces in world metres (that is
 * what a georeferenced plan yields), so it needs this to store them.
 */
export function toLocalFrame(world: Vec2, centre: Vec2, angleRad: number): Vec2 {
  const unrotated = rotate(world, -angleRad, centre);
  return { x: unrotated.x - centre.x, z: unrotated.z - centre.z };
}

/** Local frame back to world metres, for drawing stored geometry. */
export function toWorldFrame(local: Vec2, centre: Vec2, angleRad: number): Vec2 {
  return rotate({ x: centre.x + local.x, z: centre.z + local.z }, angleRad, centre);
}

/** Ray-casting point-in-polygon. Points exactly on an edge count as inside. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** Shortest distance from `p` to the polygon's boundary. */
export function distanceToPolygonEdge(p: Vec2, poly: Vec2[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

/**
 * Whether a grid point belongs to a slab. Perimeter columns sit exactly on the
 * slab edge by construction, and a ray-cast is ambiguous there: it admitted the
 * west edge of a stepped-back storey and rejected the east one, so the top floor
 * lost a whole column line and stopped lining up with the floors below. A point
 * within `tolerance` of the boundary counts as on the slab.
 */
export function gridPointOnSlab(p: Vec2, poly: Vec2[], tolerance: number): boolean {
  return pointInPolygon(p, poly) || distanceToPolygonEdge(p, poly) <= tolerance;
}

/**
 * The angle of the polygon's longest edge, which for a rectangular block is the
 * direction its structural grid runs. Normalised to a quarter turn: a grid is
 * symmetric under 90 degree rotation, so this keeps the returned angle small
 * and stops a building flipping its X and Z bays on a whim.
 */
export function gridAngleOf(outline: Vec2[]): number {
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len > bestLen) {
      bestLen = len;
      best = Math.atan2(b.z - a.z, b.x - a.x);
    }
  }
  // Fold into [-45deg, +45deg).
  const quarter = Math.PI / 2;
  let a = best % quarter;
  if (a >= quarter / 2) a -= quarter;
  if (a < -quarter / 2) a += quarter;
  return a;
}

function centroidOf(pts: Vec2[]): Vec2 {
  let area = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const cross = a.x * b.z - b.x * a.z;
    area += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
    };
  }
  return { x: cx / (6 * area), z: cz / (6 * area) };
}

/** Unsigned polygon area, m^2. */
export function areaOf(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a / 2);
}

/**
 * Divides a span into whole bays as near the target as possible, so columns land
 * exactly on both ends. A real frame has no half bay left over at one edge.
 */
function fitBays(span: number, target: number): { count: number; spacing: number } {
  if (span <= 0.01) return { count: 1, spacing: span };
  const count = Math.max(1, Math.round(span / target));
  return { count, spacing: span / count };
}

/* ---------------------------------------------------------------- elevations */

export type FloorInput = {
  id: string;
  name: string;
  ordinal: number;
  elevation?: number;
  heightMetres?: number;
  /** Already projected to world metres by the caller. */
  slabOutline?: Vec2[];
  columns?: ColumnSpec[];
  walls?: WallSpec[];
  rooms?: RoomSpec[];
};

export type BuildingInput = {
  id: string;
  outline: Vec2[];
  floors: FloorInput[];
  lod?: BuildingLod;
  structureType?: StructureType;
  heightMetres?: number;
  gridSpacingX?: number;
  gridSpacingZ?: number;
  columnSize?: number;
  slabThickness?: number;
  beamDepth?: number;
  cores?: CoreSpec[];
};

/**
 * Walking-surface height of every floor. Ordinal 0 sits at datum; storeys stack
 * upward from there and basements hang below it, so a building with a basement
 * does not lift its ground floor off the terrain.
 */
export function elevationsOf(floors: FloorInput[], fallbackHeight: number): Map<number, number> {
  const sorted = [...floors].sort((a, b) => a.ordinal - b.ordinal);
  const heightOf = (f: FloorInput) => f.heightMetres ?? fallbackHeight;
  const out = new Map<number, number>();

  // Upward from datum.
  let y = 0;
  for (const f of sorted.filter((f) => f.ordinal >= 0)) {
    out.set(f.ordinal, f.elevation ?? y);
    y = (out.get(f.ordinal) as number) + heightOf(f);
  }
  // Downward from datum, deepest last.
  let below = 0;
  for (const f of [...sorted.filter((f) => f.ordinal < 0)].reverse()) {
    below -= heightOf(f);
    out.set(f.ordinal, f.elevation ?? below);
  }
  return out;
}

/* -------------------------------------------------------------------- build */

/**
 * Builds the frame. Returns `null` for a building with no usable outline rather
 * than inventing one.
 */
export function buildBuildingFrame(b: BuildingInput): BuildingFrame | null {
  if (!b.outline || b.outline.length < 3) return null;

  const lod: BuildingLod = b.lod ?? "MASSING";
  const structureType: StructureType = b.structureType ?? "RC_FRAME";
  const columnSize = b.columnSize ?? DEFAULT_COLUMN_SIZE;
  const slabThickness = b.slabThickness ?? DEFAULT_SLAB_THICKNESS;
  const beamDepth = b.beamDepth ?? DEFAULT_BEAM_DEPTH;

  const floors = [...b.floors].sort((a, c) => a.ordinal - c.ordinal);
  if (!floors.length) return null;

  // A surveyed overall height divides evenly across the storeys; otherwise fall
  // back to the nominal storey height the campus data is built around.
  const fallbackStoreyHeight = b.heightMetres
    ? b.heightMetres / Math.max(1, floors.length)
    : METRES_PER_STOREY;

  const elevations = elevationsOf(floors, fallbackStoreyHeight);
  const centre = centroidOf(b.outline);
  const angleRad = gridAngleOf(b.outline);

  /* ---- slabs, one per floor plus a roof cap ---- */
  const slabs: Slab[] = [];
  for (const f of floors) {
    const top = elevations.get(f.ordinal) ?? 0;
    slabs.push({
      floorId: f.id,
      name: f.name,
      ordinal: f.ordinal,
      outline: f.slabOutline && f.slabOutline.length >= 3 ? f.slabOutline : b.outline,
      top,
      thickness: slabThickness,
      storeyHeight: f.heightMetres ?? fallbackStoreyHeight,
      isRoof: false,
    });
  }
  const topFloor = floors[floors.length - 1];
  const topSlab = slabs[slabs.length - 1];
  slabs.push({
    floorId: `${topFloor.id}-roof`,
    name: "Roof",
    ordinal: topFloor.ordinal + 1,
    outline: topSlab.outline,
    top: topSlab.top + topSlab.storeyHeight,
    thickness: slabThickness,
    storeyHeight: 0,
    isRoof: true,
  });

  /* ---- bay grid, laid out in the building's own local frame ---- */
  const local = b.outline.map((p) => rotate(p, -angleRad, centre));
  const minX = Math.min(...local.map((p) => p.x));
  const maxX = Math.max(...local.map((p) => p.x));
  const minZ = Math.min(...local.map((p) => p.z));
  const maxZ = Math.max(...local.map((p) => p.z));

  const baysX = fitBays(maxX - minX, b.gridSpacingX ?? DEFAULT_BAY);
  const baysZ = fitBays(maxZ - minZ, b.gridSpacingZ ?? DEFAULT_BAY);

  // Inset the containment test by half a column so perimeter columns, whose
  // centres sit exactly on the outline, are not culled by the edge case.
  const inset = columnSize;

  type GridPoint = { world: Vec2; ref: string; onPerimeter: boolean };
  const grid: GridPoint[] = [];
  for (let i = 0; i <= baysX.count; i++) {
    for (let j = 0; j <= baysZ.count; j++) {
      const lp = { x: minX + i * baysX.spacing, z: minZ + j * baysZ.spacing };
      const world = rotate(lp, angleRad, centre);
      const onPerimeter = i === 0 || i === baysX.count || j === 0 || j === baysZ.count;
      // Nudge inward before testing, so a point sitting on the boundary counts.
      const probe = {
        x: lp.x + (i === 0 ? inset : i === baysX.count ? -inset : 0),
        z: lp.z + (j === 0 ? inset : j === baysZ.count ? -inset : 0),
      };
      if (!pointInPolygon(rotate(probe, angleRad, centre), b.outline)) continue;
      // A long-span roof is the point of a hall: no columns land inside it.
      if (structureType === "LONG_SPAN" && !onPerimeter) continue;
      grid.push({
        world,
        // Letters across, numbers up — the convention on a real column layout.
        ref: `${String.fromCharCode(65 + (i % 26))}/${j + 1}`,
        onPerimeter,
      });
    }
  }

  /* ---- columns: one shaft per storey, per grid point inside that slab ---- */
  const columns: Column[] = [];
  for (let s = 0; s < slabs.length - 1; s++) {
    const from = slabs[s];
    const to = slabs[s + 1];
    const base = from.top;
    const shaftTop = to.top - to.thickness;
    if (shaftTop <= base) continue;
    for (const g of grid) {
      // Re-test against this storey's own outline, so a stepped-back upper floor
      // simply has fewer columns rather than columns hanging in open air. The
      // grid itself is shared by every storey: columns are continuous top to
      // bottom in a frame, so only the set present changes, never the positions.
      if (from.outline !== b.outline && !gridPointOnSlab(g.world, from.outline, columnSize * 1.5)) continue;
      columns.push({
        x: g.world.x,
        z: g.world.z,
        width: columnSize,
        depth: columnSize,
        base,
        top: shaftTop,
        ref: g.ref,
      });
    }
  }

  /* ---- traced columns override the inferred grid for that storey ---- */
  const tracedByOrdinal = new Map<number, ColumnSpec[]>();
  for (const f of floors) {
    if (f.columns && f.columns.length) tracedByOrdinal.set(f.ordinal, f.columns);
  }
  if (tracedByOrdinal.size) {
    for (const [ordinal, specs] of tracedByOrdinal) {
      const s = slabs.findIndex((x) => x.ordinal === ordinal);
      if (s < 0 || s >= slabs.length - 1) continue;
      const base = slabs[s].top;
      const shaftTop = slabs[s + 1].top - slabs[s + 1].thickness;
      // Drop the inferred shafts for this storey, then add the traced ones.
      for (let i = columns.length - 1; i >= 0; i--) {
        if (Math.abs(columns[i].base - base) < 1e-6) columns.splice(i, 1);
      }
      specs.forEach((c, i) => {
        const world = rotate({ x: centre.x + c.x, z: centre.z + c.z }, angleRad, centre);
        columns.push({
          x: world.x,
          z: world.z,
          width: c.width ?? columnSize,
          depth: c.depth ?? columnSize,
          base,
          top: shaftTop,
          ref: `T/${i + 1}`,
        });
      });
    }
  }

  /* ---- beams: grid lines between adjacent columns, under each slab ---- */
  const beams: Beam[] = [];
  const key = (i: number, j: number) => `${i}:${j}`;
  const present = new Set<string>();
  const byIndex = new Map<string, Vec2>();
  for (let i = 0; i <= baysX.count; i++) {
    for (let j = 0; j <= baysZ.count; j++) {
      const lp = { x: minX + i * baysX.spacing, z: minZ + j * baysZ.spacing };
      const world = rotate(lp, angleRad, centre);
      const probe = {
        x: lp.x + (i === 0 ? inset : i === baysX.count ? -inset : 0),
        z: lp.z + (j === 0 ? inset : j === baysZ.count ? -inset : 0),
      };
      if (!pointInPolygon(rotate(probe, angleRad, centre), b.outline)) continue;
      present.add(key(i, j));
      byIndex.set(key(i, j), world);
    }
  }
  // Skip the lowest slab: beams belong under the slab they support.
  for (let s = 1; s < slabs.length; s++) {
    const y = slabs[s].top - slabs[s].thickness - beamDepth / 2;
    for (let i = 0; i <= baysX.count; i++) {
      for (let j = 0; j <= baysZ.count; j++) {
        if (!present.has(key(i, j))) continue;
        if (present.has(key(i + 1, j))) {
          beams.push({
            from: byIndex.get(key(i, j)) as Vec2,
            to: byIndex.get(key(i + 1, j)) as Vec2,
            y,
            width: columnSize * 0.5,
            depth: beamDepth,
          });
        }
        if (present.has(key(i, j + 1))) {
          beams.push({
            from: byIndex.get(key(i, j)) as Vec2,
            to: byIndex.get(key(i, j + 1)) as Vec2,
            y,
            width: columnSize * 0.5,
            depth: beamDepth,
          });
        }
      }
    }
  }

  /* ---- walls: traced per storey, standing on their own slab ---- */
  const walls: Wall[] = [];
  for (const f of floors) {
    if (!f.walls?.length) continue;
    const s = slabs.findIndex((x) => x.ordinal === f.ordinal);
    if (s < 0 || s >= slabs.length - 1) continue;
    const base = slabs[s].top;
    const soffit = slabs[s + 1].top - slabs[s + 1].thickness;
    for (const w of f.walls) {
      const from = toWorldFrame(w.from, centre, angleRad);
      const to = toWorldFrame(w.to, centre, angleRad);
      if (Math.hypot(to.x - from.x, to.z - from.z) < 0.05) continue;
      const type = w.type ?? "PARTITION";
      walls.push({
        from,
        to,
        thickness: w.thickness ?? (type === "STRUCTURAL" ? 0.23 : 0.115),
        type,
        base,
        // A partition stops at ceiling level and a glazed run at head height;
        // only a structural wall actually reaches the slab above.
        top:
          type === "STRUCTURAL"
            ? soffit
            : type === "GLAZING"
              ? base + Math.min(2.4, (soffit - base) * 0.75)
              : base + Math.min(3, (soffit - base) * 0.92),
        angleRad: Math.atan2(to.z - from.z, to.x - from.x),
      });
    }
  }

  /* ---- rooms: enclosed spaces, one storey each ---- */
  const rooms: Room[] = [];
  for (const f of floors) {
    if (!f.rooms?.length) continue;
    const si = slabs.findIndex((x) => x.ordinal === f.ordinal);
    if (si < 0 || si >= slabs.length - 1) continue;
    const base = slabs[si].top;
    const soffit = slabs[si + 1].top - slabs[si + 1].thickness;
    for (const r of f.rooms) {
      if (!r.outline || r.outline.length < 3) continue;
      const outline = r.outline.map((p) => toWorldFrame(p, centre, angleRad));
      rooms.push({
        id: r.id,
        floorId: f.id,
        code: r.code,
        name: r.name,
        category: r.category ?? "OTHER",
        outline,
        centre: centroidOf(outline),
        doors: (r.doors ?? []).map((p) => toWorldFrame(p, centre, angleRad)),
        destinationId: r.destinationId,
        base,
        // A room's ceiling stops at the slab soffit unless it says otherwise.
        top: r.heightMetres ? Math.min(soffit, base + r.heightMetres) : soffit,
        areaM2: areaOf(outline),
      });
    }
  }

  /* ---- cores rise through the storeys they serve ---- */
  const cores: Core[] = [];
  for (const c of b.cores ?? []) {
    const served = c.ordinals?.length ? c.ordinals : floors.map((f) => f.ordinal);
    const tops = served
      .map((o) => elevations.get(o))
      .filter((v): v is number => typeof v === "number");
    if (!tops.length) continue;
    const lowest = Math.min(...tops);
    // A core must break through the slab above the highest storey it serves.
    const highestOrdinal = Math.max(...served);
    const above = slabs.find((s) => s.ordinal === highestOrdinal + 1);
    const highest = above ? above.top : Math.max(...tops) + fallbackStoreyHeight;
    cores.push({
      id: c.id,
      kind: c.kind,
      centre: rotate({ x: centre.x + c.x, z: centre.z + c.z }, angleRad, centre),
      width: c.width,
      depth: c.depth,
      angleRad,
      base: lowest,
      top: highest,
    });
  }

  return {
    buildingId: b.id,
    lod,
    structureType,
    slabs,
    columns,
    beams,
    walls,
    rooms,
    cores,
    angleRad,
    bay: { x: baysX.spacing, z: baysZ.spacing },
    stats: {
      slabs: slabs.length,
      columns: columns.length,
      beams: beams.length,
      walls: walls.length,
      rooms: rooms.length,
      cores: cores.length,
    },
  };
}

/**
 * Adapts a `Building3D` from the campus projection into frame input.
 *
 * Returns `null` unless the building has claimed at least LOD GENERIC. That is
 * the geometry contract in one line: a building the survey has not reached gets
 * no frame invented for it, and site features never get one at all.
 */
export function frameFor(b: {
  id: string;
  outline: Vec2[];
  floors: Array<{
    id: string;
    name: string;
    ordinal: number;
    elevation?: number;
    heightMetres?: number;
    slabOutline?: Vec2[];
    columns?: ColumnSpec[];
    walls?: WallSpec[];
    rooms?: RoomSpec[];
  }>;
  lod: BuildingLod;
  structureType?: StructureType;
  heightMetres?: number;
  gridSpacingX?: number;
  gridSpacingZ?: number;
  columnSize?: number;
  slabThickness?: number;
  beamDepth?: number;
  cores?: CoreSpec[];
  isSiteFeature?: boolean;
}): BuildingFrame | null {
  if (b.isSiteFeature) return null;
  const lod = earnedLod(b);
  if (lod === "MASSING") return null;
  return buildBuildingFrame({
    id: b.id,
    outline: b.outline,
    floors: b.floors,
    lod,
    structureType: b.structureType,
    // `heightMetres` on Building3D is always populated (storeys x 3.5 fallback),
    // so pass it only when the storey heights are not themselves authoritative.
    heightMetres: b.floors.some((f) => f.heightMetres) ? undefined : b.heightMetres,
    gridSpacingX: b.gridSpacingX,
    gridSpacingZ: b.gridSpacingZ,
    columnSize: b.columnSize,
    slabThickness: b.slabThickness,
    beamDepth: b.beamDepth,
    cores: b.cores,
  });
}

/* ------------------------------------------------------------ LOD promotion */

/**
 * The LOD a building's data actually earns, which may be higher than the LOD
 * recorded against it.
 *
 * Phase 2 fills geometry in one floor at a time, and an operator who has just
 * traced three storeys should not also have to remember to bump a field. So the
 * claimed LOD is a floor, and evidence raises it:
 *
 *  - traced columns or slab outlines on every storey -> SPECIFIC (LOD 300)
 *  - and walls as well, plus cores -> INTERFACES (LOD 350)
 *
 * It never *lowers* a recorded LOD. A building marked SPECIFIC by a surveyor
 * stays there even if its floors carry no geometry yet — that is a claim about
 * the real world, and only a person may retract it.
 */
export function earnedLod(b: {
  lod?: BuildingLod;
  floors: Array<{ columns?: ColumnSpec[]; walls?: WallSpec[]; slabOutline?: Vec2[] }>;
  cores?: CoreSpec[];
}): BuildingLod {
  const claimed: BuildingLod = b.lod ?? "MASSING";
  const order: BuildingLod[] = ["MASSING", "GENERIC", "SPECIFIC", "INTERFACES"];
  const at = (l: BuildingLod) => order.indexOf(l);

  if (!b.floors.length) return claimed;

  const traced = (f: { columns?: ColumnSpec[]; slabOutline?: Vec2[] }) =>
    Boolean(f.columns?.length || (f.slabOutline && f.slabOutline.length >= 3));

  // Every storey must be traced: a part-traced building is still an inference
  // wherever the plan has not reached, and the badge has to mean one thing.
  const allTraced = b.floors.every(traced);
  if (!allTraced) return claimed;

  const hasWalls = b.floors.some((f) => f.walls?.length);
  const earned: BuildingLod = hasWalls && b.cores?.length ? "INTERFACES" : "SPECIFIC";

  return at(earned) > at(claimed) ? earned : claimed;
}

/* -------------------------------------------------------- floor isolation */

/**
 * Narrows a frame to a single storey: its floor slab, the slab above as a
 * ceiling, and only the columns, walls and rooms that belong to it.
 *
 * This is how you actually look at one floor. Exploding a four-storey stack
 * spreads it over 40 m and the storey you care about is one layer among four;
 * isolating first means the explode does the useful thing instead — it lifts the
 * ceiling off one floor so the rooms inside are plainly visible.
 *
 * Returns the frame unchanged when the ordinal is null or unknown, so callers
 * never have to special-case "no isolation".
 */
export function isolateStorey(frame: BuildingFrame, ordinal: number | null): BuildingFrame {
  if (ordinal === null) return frame;

  const floorSlab = frame.slabs.find((s) => s.ordinal === ordinal);
  if (!floorSlab) return frame;
  const ceiling = frame.slabs.find((s) => s.ordinal === ordinal + 1);

  const base = floorSlab.top;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  // A ceiling-level element (a beam, or the slab above) belongs to this storey.
  const ceilingY = ceiling ? ceiling.top : Infinity;

  const slabs = [floorSlab, ...(ceiling ? [ceiling] : [])];

  return {
    ...frame,
    slabs,
    columns: frame.columns.filter((c) => near(c.base, base)),
    // Beams sit just under the slab they support, so keep the ones under the
    // ceiling — they are what makes a floor read as a built thing, not a tray.
    beams: ceiling ? frame.beams.filter((b) => b.y < ceilingY && b.y > base) : [],
    walls: frame.walls.filter((w) => near(w.base, base)),
    rooms: frame.rooms.filter((r) => near(r.base, base)),
    // Cores pass through every storey; clip them to this one so an isolated
    // floor does not trail a stair shaft above and below it.
    cores: frame.cores
      .filter((c) => c.base <= base + 0.01 && c.top >= (ceiling ? ceiling.top : base) - 0.01)
      .map((c) => ({ ...c, base, top: ceiling ? ceiling.top : c.top })),
    stats: {
      slabs: slabs.length,
      columns: frame.columns.filter((c) => near(c.base, base)).length,
      beams: ceiling ? frame.beams.filter((b) => b.y < ceilingY && b.y > base).length : 0,
      walls: frame.walls.filter((w) => near(w.base, base)).length,
      rooms: frame.rooms.filter((r) => near(r.base, base)).length,
      cores: frame.cores.filter(
        (c) => c.base <= base + 0.01 && c.top >= (ceiling ? ceiling.top : base) - 0.01
      ).length,
    },
  };
}

/**
 * The storey worth opening on: the only one with a room schedule, if exactly one
 * has. With several surveyed floors there is no basis for picking, so the whole
 * stack is shown and the choice stays with the user.
 */
export function defaultIsolatedStorey(frame: BuildingFrame): number | null {
  const withRooms = new Set(frame.rooms.map((r) => r.base));
  if (withRooms.size !== 1) return null;
  const base = [...withRooms][0];
  return frame.slabs.find((s) => Math.abs(s.top - base) < 1e-6)?.ordinal ?? null;
}
