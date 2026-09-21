import type { Node, Floor } from "../../shared/data/campus";
import { canvasToGps } from "./projection";

const METERS_PER_DEGREE_LAT = 111320;

/**
 * Calculates the real-world geographic distance in meters between two (latitude, longitude) coordinates
 * using the formula:
 * Distance ≈ √((Δlat × 111320)² + (Δlon × 111320 × cos(averageLatitude))²)
 */
export function calculateGeographicDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
    return 10; // Fallback distance
  }

  const dLat = lat2 - lat1;
  const dLon = lng2 - lng1;

  const averageLatitudeRad = (((lat1 + lat2) / 2) * Math.PI) / 180;

  const latDistanceMeters = dLat * METERS_PER_DEGREE_LAT;
  const lonDistanceMeters = dLon * METERS_PER_DEGREE_LAT * Math.cos(averageLatitudeRad);

  const distanceMeters = Math.sqrt(
    latDistanceMeters * latDistanceMeters + lonDistanceMeters * lonDistanceMeters
  );

  return Math.max(1, Math.round(distanceMeters));
}

// Export alias for backwards compatibility across existing imports
export const calculateHaversineDistance = calculateGeographicDistance;

/**
 * Calculates real-world geographic forward bearing in degrees (0..360) from (lat1, lng1) to (lat2, lng2).
 * 0° = North, 90° = East, 180° = South, 270° = West
 */
export function calculateGeographicBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) return 0;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

/**
 * Calculates the shortest angular difference in degrees (-180..180) from currentAngle to targetAngle.
 * Correctly handles 359° -> 1° (+2°) and 1° -> 359° (-2°) boundary wrap-arounds.
 */
export function calculateShortestAngleDelta(currentAngle: number, targetAngle: number): number {
  return (((targetAngle - currentAngle + 540) % 360) - 180);
}

/**
 * Resolves reliable geographic coordinates for a campus node.
 * Automatically falls back to canvas-to-GPS projection if lat/lng is 0, missing, or invalid.
 */
export function getNodeGeographicCoordinates(n: Node): { lat: number; lng: number } {
  const extNode = n as Node & { latitude?: number; longitude?: number };
  let nLat = typeof n.lat === "number" ? n.lat : (typeof extNode.latitude === "number" ? extNode.latitude : undefined);
  let nLng = typeof n.lng === "number" ? n.lng : (typeof extNode.longitude === "number" ? extNode.longitude : undefined);

  const isLatValid = typeof nLat === "number" && !isNaN(nLat) && nLat !== 0 && Math.abs(nLat) >= 1 && Math.abs(nLat) <= 90;
  const isLngValid = typeof nLng === "number" && !isNaN(nLng) && nLng !== 0 && Math.abs(nLng) <= 180;

  if (!isLatValid || !isLngValid) {
    if (typeof n.x === "number" && typeof n.y === "number" && !isNaN(n.x) && !isNaN(n.y)) {
      const coords = canvasToGps(n.x, n.y);
      nLat = coords.lat;
      nLng = coords.lng;
    }
  }

  return {
    lat: typeof nLat === "number" && !isNaN(nLat) ? nLat : 0,
    lng: typeof nLng === "number" && !isNaN(nLng) ? nLng : 0,
  };
}

/**
 * Resolves reliable geographic coordinates for a user location.
 * Automatically falls back to canvas-to-GPS projection if live GPS lat/lng is uninitialized (0 or NaN).
 */
export function getUserGeographicCoordinates(
  lat?: number | null,
  lng?: number | null,
  canvasPos?: { x: number; y: number } | null
): { lat: number; lng: number } {
  const isLatValid = typeof lat === "number" && !isNaN(lat) && lat !== 0 && Math.abs(lat) >= 1 && Math.abs(lat) <= 90;
  const isLngValid = typeof lng === "number" && !isNaN(lng) && lng !== 0 && Math.abs(lng) <= 180;

  if (isLatValid && isLngValid) {
    return { lat: lat!, lng: lng! };
  }

  if (canvasPos && typeof canvasPos.x === "number" && typeof canvasPos.y === "number" && !isNaN(canvasPos.x) && !isNaN(canvasPos.y)) {
    const coords = canvasToGps(canvasPos.x, canvasPos.y);
    return { lat: coords.lat, lng: coords.lng };
  }

  return { lat: 0, lng: 0 };
}

/**
 * Finds the nearest navigation node to a given (latitude, longitude) coordinate
 * matching the active floor or outdoor area.
 */
export function findNearestNodeByGps(
  lat: number,
  lng: number,
  nodes: Node[],
  floorId = "f-out",
  maxDistanceMeters = 300,
  userCanvasPos?: { x: number; y: number } | null
): { node: Node | null; distanceMeters: number } {
  const userCoords = getUserGeographicCoordinates(lat, lng, userCanvasPos);

  const eligibleNodes = nodes.filter((n) => {
    if (floorId === "f-out") {
      return (
        n.floorId === "f-out" ||
        n.floorId === "outdoor" ||
        n.type === "BUILDING_ENTRANCE" ||
        n.type === "OUTDOOR_PATH" ||
        n.type === "OUTDOOR" ||
        n.type === "GATE" ||
        n.type === "CORRIDOR" ||
        n.isEntranceNode
      );
    }
    return n.floorId === floorId;
  });

  if (!nodes || nodes.length === 0 || eligibleNodes.length === 0) {
    return { node: null, distanceMeters: Infinity };
  }

  let nearestNode: Node | null = null;
  let minDistance = Infinity;

  eligibleNodes.forEach((n) => {
    const nCoords = getNodeGeographicCoordinates(n);
    if (nCoords.lat !== 0 && nCoords.lng !== 0) {
      const dist = calculateGeographicDistance(userCoords.lat, userCoords.lng, nCoords.lat, nCoords.lng);
      if (dist < minDistance) {
        minDistance = dist;
        nearestNode = n;
      }
    }
  });

  return {
    node: nearestNode,
    distanceMeters: minDistance <= maxDistanceMeters ? minDistance : minDistance,
  };
}

export interface ContextAwareNearestNodeOptions {
  isInside: boolean;
  buildingId?: string | null;
  buildingName?: string | null;
  floorId?: string | null;
  floors?: Floor[];
  userCanvasPos?: { x: number; y: number } | null;
}

export interface NearestNodeResult {
  node: Node | null;
  distanceMeters: number;
  floorId: string;
  buildingId: string | null;
  isIndoor: boolean;
  error?: string;
}

/**
 * Context-aware nearest navigation node finder.
 *
 * INDOOR (User physically inside a building):
 * 1. Prioritizes nodes on the selected floor of that building.
 * 2. Prioritizes building entrance nodes for that building to guarantee exiting via the entrance instead of crossing exterior walls.
 * 3. Prioritizes all other indoor nodes belonging to that building.
 *
 * OUTDOOR:
 * Filters for valid outdoor paths, gates, and building entrance nodes.
 *
 * Ranks all eligible candidates in strictly ascending spatial distance order.
 */
export function findContextAwareNearestNodes(
  lat: number,
  lng: number,
  nodes: Node[],
  context: ContextAwareNearestNodeOptions
): Node[] {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  const userCoords = getUserGeographicCoordinates(lat, lng, context.userCanvasPos);
  if (userCoords.lat === 0 && userCoords.lng === 0 && !context.userCanvasPos) {
    return [];
  }

  // Exclude explicitly non-accessible or closed nodes from candidate selection
  const validNodes = nodes.filter((n) => n.accessible !== false);
  if (validNodes.length === 0) {
    return [];
  }

  const getDistance = (n: Node) => {
    // 1. If we have canvas coordinates for both user and node, prioritize high-precision canvas distance
    if (context.userCanvasPos && typeof n.x === "number" && typeof n.y === "number") {
      const isSameFloor =
        !context.floorId ||
        context.floorId === n.floorId ||
        ((context.floorId === "f-out" || context.floorId === "outdoor") && (!n.floorId || n.floorId === "f-out" || n.floorId === "outdoor"));
      const floorPenalty = isSameFloor ? 0 : 500;
      return Math.hypot(context.userCanvasPos.x - n.x, context.userCanvasPos.y - n.y) + floorPenalty;
    }
    // 2. Geographic coordinates fallback
    const g = getNodeGeographicCoordinates(n);
    if (userCoords.lat !== 0 && userCoords.lng !== 0 && g.lat !== 0 && g.lng !== 0) {
      return calculateGeographicDistance(userCoords.lat, userCoords.lng, g.lat, g.lng);
    }
    return Infinity;
  };

  const candidatePool: Node[] = [];

  if (context.isInside && context.buildingId) {
    const bldId = context.buildingId;
    const bldName = (context.buildingName || "").trim().toLowerCase();
    const bldFloorIds = new Set((context.floors || []).filter((f) => f.buildingId === bldId).map((f) => f.id));

    // Priority 1: Same indoor floor nodes (when on a specific indoor level)
    if (context.floorId && context.floorId !== "f-out") {
      const sameFloorNodes = validNodes.filter((n) => n.floorId === context.floorId);
      if (sameFloorNodes.length > 0) {
        candidatePool.push(...sameFloorNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
      }
    }

    // Priority 2: All indoor nodes of this building sorted by true distance
    const buildingNodes = validNodes.filter((n) => {
      const nodeFloor = context.floors?.find((f) => f.id === n.floorId);
      const extNode = n as Node & { buildingId?: string };
      return nodeFloor?.buildingId === bldId || (n.floorId && bldFloorIds.has(n.floorId)) || extNode.buildingId === bldId;
    });
    if (buildingNodes.length > 0) {
      candidatePool.push(...buildingNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
    }

    // Priority 3: Direct building entrance nodes
    const buildingEntranceNodes = validNodes.filter((n) => {
      const isEnt = n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode;
      if (!isEnt) return false;
      const nodeFloor = context.floors?.find((f) => f.id === n.floorId);
      const isFloorMatch = nodeFloor?.buildingId === bldId || (n.floorId && bldFloorIds.has(n.floorId));
      const isNameMatch = bldName.length > 0 && n.name && n.name.toLowerCase().includes(bldName);
      const extNode = n as Node & { buildingId?: string };
      const isIdMatch = extNode.buildingId === bldId;
      return isFloorMatch || isNameMatch || isIdMatch;
    });
    if (buildingEntranceNodes.length > 0) {
      candidatePool.push(...buildingEntranceNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
    }

    if (candidatePool.length > 0) {
      const uniqueIds = new Set<string>();
      const result: Node[] = [];
      for (const n of candidatePool) {
        if (!uniqueIds.has(n.id)) {
          uniqueIds.add(n.id);
          result.push(n);
        }
      }
      return result;
    }
  }

  // Priority 4: Outdoor / Campus walkway nodes
  const outdoorNodes = validNodes.filter((n) =>
    n.floorId === "f-out" ||
    n.floorId === "outdoor" ||
    !n.floorId ||
    n.type === "OUTDOOR" ||
    n.type === "OUTDOOR_PATH" ||
    n.type === "ROAD_JUNCTION" ||
    n.type === "BUILDING_ENTRANCE" ||
    n.type === "GATE" ||
    n.type === "CORRIDOR" ||
    n.type === "JUNCTION" ||
    n.type === "ENTRANCE" ||
    n.type === "EXIT" ||
    n.isEntranceNode
  );
  if (outdoorNodes.length > 0) {
    candidatePool.push(...outdoorNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
    const uniqueIds = new Set<string>();
    const result: Node[] = [];
    for (const n of candidatePool) {
      if (!uniqueIds.has(n.id)) {
        uniqueIds.add(n.id);
        result.push(n);
      }
    }
    return result;
  }

  // Priority 5: Fallback to all remaining nodes sorted by geographic distance if no outdoor nodes exist
  candidatePool.push(...validNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));

  // Deduplicate candidate list preserving priority order
  const uniqueCandidateIds = new Set<string>();
  const result: Node[] = [];
  for (const n of candidatePool) {
    if (!uniqueCandidateIds.has(n.id)) {
      uniqueCandidateIds.add(n.id);
      result.push(n);
    }
  }

  return result;
}

export function findContextAwareNearestNode(
  lat: number,
  lng: number,
  nodes: Node[],
  context: ContextAwareNearestNodeOptions
): NearestNodeResult {
  if (!nodes || nodes.length === 0) {
    return {
      node: null,
      distanceMeters: Infinity,
      floorId: context.floorId || "f-out",
      buildingId: context.buildingId || null,
      isIndoor: Boolean(context.isInside),
      error: "Empty node graph",
    };
  }

  const userCoords = getUserGeographicCoordinates(lat, lng, context.userCanvasPos);
  if (userCoords.lat === 0 && userCoords.lng === 0) {
    return {
      node: null,
      distanceMeters: Infinity,
      floorId: context.floorId || "f-out",
      buildingId: context.buildingId || null,
      isIndoor: Boolean(context.isInside),
      error: "Invalid or uninitialized GPS coordinates",
    };
  }

  if (context.isInside && context.buildingId && context.floorId && context.floorId !== "f-out") {
    const targetFloorId = context.floorId;
    const indoorFloorNodes = nodes.filter((n) => n.floorId === targetFloorId);

    if (indoorFloorNodes.length === 0) {
      return {
        node: null,
        distanceMeters: Infinity,
        floorId: targetFloorId,
        buildingId: context.buildingId,
        isIndoor: true,
        error: "No navigation nodes are available on this floor.",
      };
    }
  }

  const candidates = findContextAwareNearestNodes(userCoords.lat, userCoords.lng, nodes, context);
  if (candidates.length === 0) {
    return {
      node: null,
      distanceMeters: Infinity,
      floorId: context.floorId || "f-out",
      buildingId: context.buildingId || null,
      isIndoor: Boolean(context.isInside),
      error: "No eligible navigation candidates found",
    };
  }

  const bestNode = candidates[0];
  const nCoords = getNodeGeographicCoordinates(bestNode);
  const distanceMeters = calculateGeographicDistance(userCoords.lat, userCoords.lng, nCoords.lat, nCoords.lng);

  return {
    node: bestNode,
    distanceMeters,
    floorId: bestNode.floorId || context.floorId || "f-out",
    buildingId: context.buildingId || null,
    isIndoor: Boolean(context.isInside),
  };
}

