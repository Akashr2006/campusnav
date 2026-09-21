/**
 * Turns the published campus graph into metric geometry for the 3D scene.
 *
 * The 2D map works in canvas pixels (`PIXELS_PER_METER = 4`) and rounds to whole
 * pixels, which is invisible in SVG but shows up as ragged walls once a polygon
 * is extruded. So the 3D view projects straight to metres, unrounded, from the
 * same MAP_ORIGIN — both views therefore agree on where everything is.
 *
 * Three.js convention here: X = east, Z = south, Y = up.
 */
import { MAP_ORIGIN } from "@/lib/geo/projection";
import type {
  BuildingLod,
  ColumnSpec,
  CoreSpec,
  RoomSpec,
  StructureType,
  WallSpec,
} from "@/shared/data/campus";

/** Storey height the campus data is built around; see HANDOFF.md. */
export const METRES_PER_STOREY = 3.5;

export type LatLng = { lat: number; lng: number };
export type Vec2 = { x: number; z: number };

/** A storey, carried through to the frame generator. */
export type Floor3D = {
  id: string;
  name: string;
  ordinal: number;
  elevation?: number;
  heightMetres?: number;
  /** Projected to metres here, so the generator never touches GPS. */
  slabOutline?: Vec2[];
  columns?: ColumnSpec[];
  walls?: WallSpec[];
  rooms?: RoomSpec[];
};

export type Building3D = {
  id: string;
  name: string;
  shortCode?: string;
  /** Footprint in metres, centred on the campus origin. */
  outline: Vec2[];
  /** Centroid, for labels and camera framing. */
  centre: Vec2;
  storeys: number;
  heightMetres: number;

  // --- Phase 0 structural fields. `lod` decides what the renderer may draw.
  lod: BuildingLod;
  structureType?: StructureType;
  /** Sorted by ordinal, basements first. Empty when the graph has no floors. */
  floors: Floor3D[];
  gridSpacingX?: number;
  gridSpacingZ?: number;
  columnSize?: number;
  slabThickness?: number;
  beamDepth?: number;
  cores?: CoreSpec[];
  /** Grounds, ponds and courts, which must not be extruded as a storey. */
  isSiteFeature: boolean;
};

export type Node3D = {
  id: string;
  name?: string;
  type?: string;
  position: Vec2;
};

export type Edge3D = { id: string; from: Vec2; to: Vec2 };

export type Campus3D = {
  buildings: Building3D[];
  nodes: Node3D[];
  nodeById: Map<string, Node3D>;
  edges: Edge3D[];
  boundary: Vec2[];
  /** Centre of the campus bounds. MAP_ORIGIN is the south-west corner, not the
   *  middle, so the camera and ground must be placed against this instead. */
  centre: Vec2;
  /** Half-diagonal of the campus bounds in metres, for camera and ground sizing. */
  radius: number;
};

function metresPerDegree(lat: number) {
  const latRad = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad),
    lng: 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad),
  };
}

/** Metres east/south of MAP_ORIGIN. North is -Z, matching the 2D map's north-up. */
export function gpsToMetres(lat: number, lng: number): Vec2 {
  const per = metresPerDegree(MAP_ORIGIN.lat);
  return {
    x: (lng - MAP_ORIGIN.lng) * per.lng,
    z: -(lat - MAP_ORIGIN.lat) * per.lat,
  };
}

/** Canvas-pixel coordinates (the 2D map's space) to metres. */
function canvasToMetres(x: number, y: number): Vec2 {
  return { x: x / 4, z: y / 4 };
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Nodes carry lat/lng and canvas x/y and the two do not always agree; lat/lng is
 * the surveyed value, so it wins where present.
 */
function nodePosition(n: Record<string, unknown>): Vec2 | null {
  const lat = num(n.lat);
  const lng = num(n.lng);
  if (lat !== null && lng !== null) return gpsToMetres(lat, lng);
  const x = num(n.x);
  const y = num(n.y);
  if (x !== null && y !== null) return canvasToMetres(x, y);
  return null;
}

/** Shoelace centroid; falls back to the vertex mean for degenerate rings. */
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

/** Buildings without a traced footprint fall back to their width/height box. */
function outlineOf(b: Record<string, any>): Vec2[] | null {
  const fp = b.footprint;
  if (Array.isArray(fp) && fp.length >= 3) {
    const pts = fp
      .map((p: any) => {
        const lat = num(p?.lat);
        const lng = num(p?.lng);
        return lat !== null && lng !== null ? gpsToMetres(lat, lng) : null;
      })
      .filter((p): p is Vec2 => p !== null);
    if (pts.length >= 3) return pts;
  }

  const x = num(b.x);
  const y = num(b.y);
  const w = num(b.width);
  const h = num(b.height);
  if (x !== null && y !== null && w !== null && h !== null) {
    const a = canvasToMetres(x, y);
    const s = canvasToMetres(x + w, y + h);
    return [
      { x: a.x, z: a.z },
      { x: s.x, z: a.z },
      { x: s.x, z: s.z },
      { x: a.x, z: s.z },
    ];
  }
  return null;
}

export function buildCampus3D(graph: Record<string, any> | null | undefined): Campus3D {
  const g = graph ?? {};
  const rawBuildings: any[] = Array.isArray(g.buildings) ? g.buildings : [];
  const rawNodes: any[] = Array.isArray(g.nodes) ? g.nodes : [];
  const rawEdges: any[] = Array.isArray(g.edges) ? g.edges : [];
  const rawFloors: any[] = Array.isArray(g.floors) ? g.floors : [];

  const floorsByBuilding = new Map<string, any[]>();
  for (const f of rawFloors) {
    if (!f?.buildingId) continue;
    const list = floorsByBuilding.get(f.buildingId) ?? [];
    list.push(f);
    floorsByBuilding.set(f.buildingId, list);
  }

  const buildings: Building3D[] = [];
  for (const b of rawBuildings) {
    const outline = outlineOf(b);
    if (!outline) continue;
    const rawFloorList = floorsByBuilding.get(b.id) ?? [];
    // Prefer the building's own floor records over the denormalised count, the
    // same precedence the 2D map uses, so both views stand blocks at one height.
    const storeys = Math.max(1, rawFloorList.length || num(b.floorsCount) || 1);

    const floors: Floor3D[] = rawFloorList
      .map((f: any) => ({
        id: String(f.id),
        name: String(f.name ?? f.id),
        ordinal: num(f.ordinal) ?? 0,
        elevation: num(f.elevation) ?? undefined,
        heightMetres: num(f.heightMetres) ?? undefined,
        slabOutline: Array.isArray(f.slabOutline)
          ? f.slabOutline
              .map((p: any) => {
                const lat = num(p?.lat);
                const lng = num(p?.lng);
                return lat !== null && lng !== null ? gpsToMetres(lat, lng) : null;
              })
              .filter((p: Vec2 | null): p is Vec2 => p !== null)
          : undefined,
        columns: Array.isArray(f.columns) ? (f.columns as ColumnSpec[]) : undefined,
        walls: Array.isArray(f.walls) ? (f.walls as WallSpec[]) : undefined,
        rooms: Array.isArray(f.rooms) ? (f.rooms as RoomSpec[]) : undefined,
      }))
      .sort((x: Floor3D, y: Floor3D) => x.ordinal - y.ordinal);

    // A surveyed height wins; otherwise the nominal storey stack, unchanged.
    const surveyed = num(b.heightMetres);

    buildings.push({
      id: String(b.id),
      name: String(b.name ?? b.id),
      shortCode: b.shortCode ? String(b.shortCode) : undefined,
      outline,
      centre: centroidOf(outline),
      storeys,
      heightMetres: surveyed ?? storeys * METRES_PER_STOREY,
      // Any real building with floor records earns an inferred frame, so every
      // block on campus opens to its storeys rather than only the pilots. The
      // badge still says "Inferred" until a plan is traced; site features
      // (grounds, ponds, sheds with no floors) stay as massing.
      lod:
        (b.lod as BuildingLod) ??
        (b.isSiteFeature === true || rawFloorList.length === 0 ? "MASSING" : "GENERIC"),
      structureType: (b.structureType as StructureType) ?? (rawFloorList.length > 0 ? "RC_FRAME" : undefined),
      floors,
      gridSpacingX: num(b.gridSpacingX) ?? undefined,
      gridSpacingZ: num(b.gridSpacingZ) ?? undefined,
      columnSize: num(b.columnSize) ?? undefined,
      slabThickness: num(b.slabThickness) ?? undefined,
      beamDepth: num(b.beamDepth) ?? undefined,
      cores: Array.isArray(b.cores) ? (b.cores as CoreSpec[]) : undefined,
      // Grounds, ponds and courts carry no floor records at all. Flagged rather
      // than resized, so the existing massing view is unchanged.
      isSiteFeature: b.isSiteFeature === true || rawFloorList.length === 0,
    });
  }

  const nodes: Node3D[] = [];
  for (const n of rawNodes) {
    const position = nodePosition(n);
    if (!position) continue;
    nodes.push({
      id: String(n.id),
      name: n.name ? String(n.name) : undefined,
      type: n.type ? String(n.type) : undefined,
      position,
    });
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const edges: Edge3D[] = [];
  for (const e of rawEdges) {
    const from = nodeById.get(String(e.fromNodeId ?? e.from));
    const to = nodeById.get(String(e.toNodeId ?? e.to));
    if (!from || !to) continue;
    edges.push({ id: String(e.id), from: from.position, to: to.position });
  }

  const boundary: Vec2[] = Array.isArray(g.boundary)
    ? g.boundary
        .map((p: any) => {
          const lat = num(p?.lat);
          const lng = num(p?.lng);
          return lat !== null && lng !== null ? gpsToMetres(lat, lng) : null;
        })
        .filter((p: Vec2 | null): p is Vec2 => p !== null)
    : [];

  const spread = [...buildings.flatMap((b) => b.outline), ...boundary, ...nodes.map((n) => n.position)];
  let centre: Vec2 = { x: 0, z: 0 };
  let radius = 300;
  if (spread.length) {
    const minX = Math.min(...spread.map((p) => p.x));
    const maxX = Math.max(...spread.map((p) => p.x));
    const minZ = Math.min(...spread.map((p) => p.z));
    const maxZ = Math.max(...spread.map((p) => p.z));
    centre = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
    radius = Math.max(60, Math.hypot(maxX - minX, maxZ - minZ) / 2);
  }

  return { buildings, nodes, nodeById, edges, boundary, centre, radius };
}
