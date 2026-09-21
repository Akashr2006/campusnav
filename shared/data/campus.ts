export type NodeType =
  | "ENTRANCE"
  | "EXIT"
  | "RECEPTION"
  | "CORRIDOR"
  | "JUNCTION"
  | "ROOM"
  | "LABORATORY"
  | "OFFICE"
  | "LIFT"
  | "STAIR"
  | "OUTDOOR"
  | "PARKING"
  | "WASHROOM"
  | "ESCALATOR"
  | "FACILITY"
  | "BUILDING_ENTRANCE"
  | "ROOM_ENTRANCE"
  | "OUTDOOR_PATH"
  | "ROAD_JUNCTION"
  | "GATE"
  | "DESTINATION_NODE";

export type EdgeType = "WALK" | "ROAD" | "STAIRS" | "LIFT" | "RAMP" | "ESCALATOR";

export type PathType = "EV" | "WALK";

export type Node = {
  id: string;
  campusId?: string;
  type: NodeType;
  name?: string;
  floorId: string;
  x: number;
  y: number;
  lat?: number;
  lng?: number;
  searchable?: boolean;
  stairGroupId?: string;
  liftGroupId?: string;
  isEntranceNode?: boolean;
  outdoorNodeId?: string;
  accessible?: boolean;
  visibleToUser?: boolean;
  photoUrl?: string;
  photoUploadedAt?: string;
  physicalVerified?: boolean;
};

export type Edge = {
  id: string;
  from: string;
  to: string;
  fromNodeId?: string;
  toNodeId?: string;
  type: EdgeType;
  pathType?: PathType;
  distance: number;
  bidirectional?: boolean;
  stairGroupId?: string;
  liftGroupId?: string;
};

/**
 * How much is actually known about a building's geometry, on the AIA Level of
 * Development scale. This is the renderer's contract: it draws only what the LOD
 * claims is real, so an approximation is never passed off as a survey.
 *
 * - `MASSING` (LOD 100): footprint plus a floor count. Extruded box only.
 * - `GENERIC` (LOD 200): frame inferred from the footprint and a nominal bay
 *   grid. Slab and column positions are plausible, not measured.
 * - `SPECIFIC` (LOD 300): slab outlines, columns and storey heights taken from
 *   a real plan.
 * - `INTERFACES` (LOD 350): adds cores, walls and the connections between them.
 */
export type BuildingLod = "MASSING" | "GENERIC" | "SPECIFIC" | "INTERFACES";

export type RoofType = "FLAT" | "PITCHED" | "SAWTOOTH" | "VAULT";

/**
 * Drives how the frame is generated. A hall is not a smaller academic block:
 * `LONG_SPAN` deliberately carries no interior columns, which is the whole
 * structural point of that building type.
 */
export type StructureType = "RC_FRAME" | "STEEL_FRAME" | "LOAD_BEARING" | "LONG_SPAN";

/** A column, in metres, positioned in the building's own local frame. */
export type ColumnSpec = { x: number; z: number; width?: number; depth?: number };

/** A wall run, in metres, in the building's own local frame. */
export type WallSpec = {
  from: { x: number; z: number };
  to: { x: number; z: number };
  thickness?: number;
  /** Stops short of the slab above where a wall is a partition, not structure. */
  type?: "STRUCTURAL" | "PARTITION" | "GLAZING";
};

/**
 * An enclosed space on one storey, as a polygon in the building's own local
 * frame. This is the layer a wayfinding app actually needs: a person looks for
 * "AE301", not for a wall.
 *
 * Distinct from `Destination`, which is a *point* pinned to a graph node for
 * routing. A room is the volume; a destination is the pin inside it. Linking
 * them via `destinationId` keeps the router working exactly as it does now while
 * letting the 3D view draw and label the space itself.
 */
export type RoomSpec = {
  id: string;
  /** Signed room code, e.g. "AE301". Empty for unnamed service spaces. */
  code?: string;
  name: string;
  category?: RoomCategory;
  /** Closed ring, metres, in the building's local frame. */
  outline: { x: number; z: number }[];
  /** Doors onto the corridor, as points on the ring. */
  doors?: { x: number; z: number }[];
  /** The routing pin inside this room, if one exists. */
  destinationId?: string;
  /** Ceiling height if it differs from the storey. */
  heightMetres?: number;
};

export type RoomCategory =
  | "CLASSROOM"
  | "LAB"
  | "DRAWING_HALL"
  | "OFFICE"
  | "STAFF_ROOM"
  | "WASHROOM"
  | "CORRIDOR"
  | "STAIR"
  | "LIFT"
  | "STORE"
  | "SERVICE"
  | "OTHER";

/** A stair or lift shaft, as a rectangle rising through a run of storeys. */
export type CoreSpec = {
  id: string;
  kind: "STAIR" | "LIFT" | "SERVICE";
  /** Centre, metres, in the building's own local frame. */
  x: number;
  z: number;
  width: number;
  depth: number;
  /** Floor ordinals the core reaches. Empty means every storey. */
  ordinals?: number[];
};

export type Building = {
  id: string;
  campusId: string;
  name: string;
  shortCode?: string;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  lat?: number;
  lng?: number;
  description?: string;
  floorsCount?: number;
  basementsCount?: number;
  corner1Lat?: number;
  corner1Lng?: number;
  corner2Lat?: number;
  corner2Lng?: number;
  corner3Lat?: number;
  corner3Lng?: number;
  corner4Lat?: number;
  corner4Lng?: number;
  centerLat?: number;
  centerLng?: number;
  footprint?: { lat: number; lng: number }[];

  // --- Structural twin (Phase 0). All optional: a building without any of these
  // --- keeps behaving exactly as it did, at LOD MASSING.
  /** Defaults to MASSING when absent, so untouched buildings never over-claim. */
  lod?: BuildingLod;
  /** Surveyed overall height. Overrides `storeys × METRES_PER_STOREY`. */
  heightMetres?: number;
  roofType?: RoofType;
  structureType?: StructureType;
  /** Nominal column bay, metres. Used to infer a grid at LOD GENERIC. */
  gridSpacingX?: number;
  gridSpacingZ?: number;
  /** Square column side, metres, when the grid is inferred rather than traced. */
  columnSize?: number;
  slabThickness?: number;
  /** Depth of the downstand beams under each slab, metres. */
  beamDepth?: number;
  /** glTF exterior shell from photogrammetry (Phase 3). Not read yet. */
  shellMeshUrl?: string;
  /** Cores rising through the building, in its own local frame. */
  cores?: CoreSpec[];
  /** True for grounds, ponds and courts: site features that must not be extruded. */
  isSiteFeature?: boolean;
};

export type Floor = {
  id: string;
  buildingId: string;
  name: string;
  ordinal: number;
  code?: string;
  svgMapUrl?: string;
  blueprintUrl?: string;

  // --- Per-storey geometry (Phase 0).
  /**
   * This storey's own slab outline in GPS, which is NOT the building footprint
   * once a block steps back or cantilevers. Falls back to the footprint.
   */
  slabOutline?: { lat: number; lng: number }[];
  /** Metres of the slab's top surface above site datum. Negative for basements. */
  elevation?: number;
  /** This storey's floor-to-floor height. Falls back to METRES_PER_STOREY. */
  heightMetres?: number;
  /** Traced columns. Beats the inferred grid where present. */
  columns?: ColumnSpec[];
  walls?: WallSpec[];
  /** Enclosed spaces on this storey. */
  rooms?: RoomSpec[];
  /** Georeferenced plan scan, for tracing in the editor (Phase 2). */
  planImageUrl?: string;
  planTransform?: {
    originLat: number;
    originLng: number;
    /** Metres per pixel of the source raster. */
    scale: number;
    /** Degrees clockwise from north. */
    rotation: number;
  };
};

export type StairGroup = {
  id: string;
  buildingId: string;
  name: string;
  connectedFloorIds: string[];
  notes?: string;
  width?: number;
};

export type LiftGroup = {
  id: string;
  buildingId: string;
  name: string;
  servedFloorIds: string[];
  isAccessible?: boolean;
  notes?: string;
};



export type DoorType = "ROOM_DOOR" | "BUILDING_ENTRANCE" | "EMERGENCY_DOOR";

export type Door = {
  id: string;
  floorId: string;
  type: DoorType;
  name?: string;
  x: number;
  y: number;
  roomId?: string;
  connectedNodeId?: string;
};

export type SuggestedNode = {
  id: string;
  floorId: string;
  type: NodeType;
  name?: string;
  x: number;
  y: number;
  sourceEntityId: string;
  reason: string;
};

export type SuggestedEdge = {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  distance: number;
  sourceEntityId: string;
  reason: string;
};

export function getFloorCode(ordinal: number, name?: string): string {
  if (ordinal < 0) return `B${Math.abs(ordinal)}`;
  if (ordinal === 0) return "G";
  return `${ordinal}`;
}

export type Campus = {
  id: string;
  name: string;
  slug: string;
  lat: number;
  lng: number;
};

export type DestinationCategory =
  | "Classroom"
  | "Laboratory"
  | "Office"
  | "Staff Room"
  | "Seminar Hall"
  | "Library"
  | "Washroom"
  | "Store Room"
  | "Electrical Room"
  | "Custom"
  | "Academic";

export type Destination = {
  id: string;
  nodeId?: string;
  name: string;
  category: DestinationCategory | string;
  aliases: string[];
  description?: string;
  roomNumber?: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  floorId?: string;
  doorId?: string;
  buildingId?: string;
  photoUrl?: string;
};

export type Obstacle = {
  id: string;
  campusId: string;
  floorId?: string;
  x: number;
  y: number;
  radius: number;
  edgeIds?: string[];
  nodeId?: string;
  reason?: string;
  expiresAt?: string | null;
  severity?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
};

export type Event = {
  id: string;
  campusId: string;
  title: string;
  nodeId?: string;
  buildingId?: string;
  startsAt: string;
  endsAt: string;
  description?: string;
  color?: string;
  x?: number;
  y?: number;
};

export type GeoCalibration = {
  id: string;
  campusId: string;
  floorId?: string;
  canvasX: number;
  canvasY: number;
  lat: number;
  lng: number;
};

export const campus: Campus = {
  id: "c1",
  name: "Main Campus",
  slug: "main",
  lat: 11.4965,
  lng: 77.2774,
};

// Clean & Fresh Campus Graph Dataset

export const buildings: Building[] = [];
export const floors: Floor[] = [];
export const stairGroups: StairGroup[] = [];
export const nodes: Node[] = [];
export const edges: Edge[] = [];
export const destinations: Destination[] = [];
export const obstacles: Obstacle[] = [];
