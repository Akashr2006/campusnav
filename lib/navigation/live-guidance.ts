import type { Node, Edge } from "../../shared/data/campus";
import type { Route, RouteInstruction } from "../../features/navigation/services/graph";
import {
  getNodeVector,
  calculateTurnAngle,
  turnIconFromAngle,
  formatInstructionText,
  cleanLandmarkName,
  type DirectionIcon,
} from "../routing/directions";
import {
  calculateGeographicDistance,
} from "../geo/haversine";
import { PIXELS_PER_METER, canvasToGps, gpsToCanvas } from "../geo/projection";

export interface LiveUserPosition {
  x: number;
  y: number;
  lat?: number;
  lng?: number;
  floorId?: string;
  accuracy?: number;
  speed?: number | null;
  heading?: number;
  movementHeading?: number | null;
  deviceHeading?: number | null;
}

export interface RouteProjectionResult {
  currentSegmentIndex: number;
  projectionPoint: { x: number; y: number; lat?: number; lng?: number };
  distanceFromSegment: number; // perpendicular distance in meters
  progressAlongSegment: number; // t from 0 to 1
  distanceToSegmentEnd: number; // distance from projection point to next node in meters
  isDeviated: boolean;
  distanceRemaining: number; // total remaining meters to destination along route
}

export interface LiveGuidanceResult {
  currentInstruction: RouteInstruction | null;
  nextInstruction: RouteInstruction | null;
  currentSegmentIndex: number;
  distanceRemaining: number;
  distanceToManeuver: number;
  turnAngle: number;
  travelVector: { dx: number; dy: number };
  upcomingVector: { dx: number; dy: number } | null;
  isOffRoute: boolean;
  isArrived: boolean;
}

export interface RouteProjectionOptions {
  outdoorThresholdMeters?: number; // default: 25m
  indoorThresholdMeters?: number;  // default: 10m
  arrivalThresholdMeters?: number; // default: 12m
  matchedNodeId?: string | null;
  isInitialSessionStart?: boolean;
}

/**
 * Calculates perpendicular distance and projection point from point P to line segment AB in Cartesian space.
 */
function projectPointToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): { projX: number; projY: number; t: number; dist: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return {
      projX: ax,
      projY: ay,
      t: 0,
      dist: Math.hypot(px - ax, py - ay),
    };
  }

  const rawT = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  const t = Math.max(0, Math.min(1, rawT));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const dist = Math.hypot(px - projX, py - projY);

  return { projX, projY, t, dist };
}

/**
 * Projects the user's live physical location onto the active route segments.
 * Separates physical GPS position from graph nodes.
 */
export function projectUserOntoRoute(
  userPos: LiveUserPosition,
  routeNodes: Node[],
  routeEdges: Edge[] = [],
  previousSegmentIndex = 0,
  options: RouteProjectionOptions = {}
): RouteProjectionResult {
  const outdoorThreshold = options.outdoorThresholdMeters ?? 25.0;
  const indoorThreshold = options.indoorThresholdMeters ?? 10.0;

  if (!routeNodes || routeNodes.length === 0) {
    return {
      currentSegmentIndex: 0,
      projectionPoint: { x: userPos.x, y: userPos.y, lat: userPos.lat, lng: userPos.lng },
      distanceFromSegment: 0,
      progressAlongSegment: 0,
      distanceToSegmentEnd: 0,
      isDeviated: false,
      distanceRemaining: 0,
    };
  }

  if (routeNodes.length === 1) {
    const singleNode = routeNodes[0];
    let distMeters = 0;
    if (userPos.lat && userPos.lng && singleNode.lat && singleNode.lng) {
      distMeters = calculateGeographicDistance(userPos.lat, userPos.lng, singleNode.lat, singleNode.lng);
    } else {
      distMeters = Math.hypot(userPos.x - singleNode.x, userPos.y - singleNode.y) / PIXELS_PER_METER;
    }
    return {
      currentSegmentIndex: 0,
      projectionPoint: { x: singleNode.x, y: singleNode.y, lat: singleNode.lat, lng: singleNode.lng },
      distanceFromSegment: distMeters,
      progressAlongSegment: 1,
      distanceToSegmentEnd: 0,
      isDeviated: distMeters > (userPos.floorId === "f-out" ? outdoorThreshold : indoorThreshold),
      distanceRemaining: distMeters,
    };
  }

  const hasGeoCoords = Boolean(
    typeof userPos.lat === "number" &&
    typeof userPos.lng === "number" &&
    !isNaN(userPos.lat) &&
    !isNaN(userPos.lng) &&
    userPos.lat !== 0 &&
    userPos.lng !== 0 &&
    routeNodes.some((n) => typeof n.lat === "number" && n.lat !== 0)
  );

  let ux = userPos.x;
  let uy = userPos.y;
  if ((ux === undefined || uy === undefined || isNaN(ux) || isNaN(uy)) && userPos.lat && userPos.lng) {
    const canvas = gpsToCanvas(userPos.lat, userPos.lng);
    ux = canvas.x;
    uy = canvas.y;
  }

  const numSegments = routeNodes.length - 1;
  let bestSegmentIndex = Math.min(Math.max(0, previousSegmentIndex), numSegments - 1);
  let minScore = Infinity;
  let bestProjX = ux;
  let bestProjY = uy;
  let bestT = 0;
  let bestActualDistMeters = 0;

  // If initial session start, evaluate across all route segments to align to user's current mid-route location (e.g. at D in A->F)
  const isInitialStart = options.isInitialSessionStart || previousSegmentIndex < 0;
  const startIndex = isInitialStart ? 0 : Math.max(0, previousSegmentIndex);
  const endIndex = isInitialStart ? numSegments - 1 : Math.min(numSegments - 1, previousSegmentIndex + 1);

  for (let i = startIndex; i <= endIndex; i++) {
    const n1 = routeNodes[i];
    const n2 = routeNodes[i + 1];

    if (userPos.floorId && userPos.floorId !== "f-out" && n1.floorId && n2.floorId) {
      if (n1.floorId !== userPos.floorId && n2.floorId !== userPos.floorId) {
        continue;
      }
    }

    let distMeters = 0;
    let t = 0;
    let projCanvasX = n1.x;
    let projCanvasY = n1.y;

    if (hasGeoCoords && n1.lat && n1.lng && n2.lat && n2.lng) {
      const latRad = (((n1.lat + n2.lat) / 2) * Math.PI) / 180;
      const metersPerLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
      const metersPerLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);

      const bx = (n2.lng - n1.lng) * metersPerLng;
      const by = -(n2.lat - n1.lat) * metersPerLat;
      const px = (userPos.lng! - n1.lng) * metersPerLng;
      const py = -(userPos.lat! - n1.lat) * metersPerLat;

      const proj = projectPointToSegment(px, py, 0, 0, bx, by);
      distMeters = proj.dist;
      t = proj.t;
      projCanvasX = n1.x + t * (n2.x - n1.x);
      projCanvasY = n1.y + t * (n2.y - n1.y);
    } else {
      const proj = projectPointToSegment(ux, uy, n1.x, n1.y, n2.x, n2.y);
      distMeters = proj.dist / PIXELS_PER_METER;
      t = proj.t;
      projCanvasX = proj.projX;
      projCanvasY = proj.projY;
    }

    // Hysteresis penalty: past segments heavily penalized, future segments require affirmative proximity
    const penalty = i < previousSegmentIndex ? 5.0 : (i === previousSegmentIndex ? 0 : 2.0);
    const score = distMeters + penalty;

    if (score < minScore) {
      minScore = score;
      bestSegmentIndex = i;
      bestProjX = projCanvasX;
      bestProjY = projCanvasY;
      bestT = t;
      bestActualDistMeters = distMeters;
    }
  }

  // Advance segment if user is physically at or past junction (t >= 0.96) and closer to next segment
  if (bestT >= 0.96 && bestSegmentIndex < numSegments - 1) {
    bestSegmentIndex += 1;
    bestT = 0;
    bestProjX = routeNodes[bestSegmentIndex].x;
    bestProjY = routeNodes[bestSegmentIndex].y;
  }

  const fromNode = routeNodes[bestSegmentIndex];
  const toNode = routeNodes[bestSegmentIndex + 1];

  let segTotalDistanceMeters = 0;
  if (routeEdges[bestSegmentIndex]?.distance) {
    segTotalDistanceMeters = routeEdges[bestSegmentIndex].distance;
  } else if (fromNode.lat && fromNode.lng && toNode.lat && toNode.lng) {
    segTotalDistanceMeters = calculateGeographicDistance(fromNode.lat, fromNode.lng, toNode.lat, toNode.lng);
  } else {
    segTotalDistanceMeters = Math.hypot(toNode.x - fromNode.x, toNode.y - fromNode.y) / PIXELS_PER_METER;
  }

  const distanceToSegmentEnd = Math.max(0, (1 - bestT) * segTotalDistanceMeters);

  let remainingRouteDistance = distanceToSegmentEnd;
  for (let j = bestSegmentIndex + 1; j < numSegments; j++) {
    if (routeEdges[j]?.distance) {
      remainingRouteDistance += routeEdges[j].distance;
    } else {
      const a = routeNodes[j];
      const b = routeNodes[j + 1];
      if (a.lat && a.lng && b.lat && b.lng) {
        remainingRouteDistance += calculateGeographicDistance(a.lat, a.lng, b.lat, b.lng);
      } else {
        remainingRouteDistance += Math.hypot(b.x - a.x, b.y - a.y) / PIXELS_PER_METER;
      }
    }
  }

  const isIndoor = userPos.floorId && userPos.floorId !== "f-out";
  const threshold = isIndoor ? indoorThreshold : outdoorThreshold;
  const isDeviated = bestActualDistMeters > threshold;
  const projGps = canvasToGps(bestProjX, bestProjY);

  return {
    currentSegmentIndex: bestSegmentIndex,
    projectionPoint: {
      x: Math.round(bestProjX),
      y: Math.round(bestProjY),
      lat: projGps.lat,
      lng: projGps.lng,
    },
    distanceFromSegment: Math.round(bestActualDistMeters * 10) / 10,
    progressAlongSegment: bestT,
    distanceToSegmentEnd: Math.round(distanceToSegmentEnd * 10) / 10,
    isDeviated,
    distanceRemaining: Math.round(remainingRouteDistance * 10) / 10,
  };
}

/**
 * Computes live turn-by-turn guidance, dynamic turn angles, maneuver distances,
 * and next-step previews from live physical coordinates and movement direction.
 */
export function computeLiveTurnGuidance(
  userPos: LiveUserPosition,
  activeRoute: Route,
  projection: RouteProjectionResult,
  options?: {
    floorNames?: Map<string, string>;
    buildingNames?: Map<string, string>;
    arrivalThresholdMeters?: number;
    matchedNodeId?: string | null;
  }
): LiveGuidanceResult {
  const arrivalThreshold = options?.arrivalThresholdMeters ?? 12.0;
  const nodes = activeRoute.nodes;
  const segIndex = projection.currentSegmentIndex;

  // 1. ARRIVAL CHECK
  const lastNode = nodes[nodes.length - 1];
  let distToFinalDest = projection.distanceRemaining;

  let ux = userPos.x;
  let uy = userPos.y;
  if ((ux === undefined || uy === undefined || isNaN(ux) || isNaN(uy)) && userPos.lat && userPos.lng) {
    const canvas = gpsToCanvas(userPos.lat, userPos.lng);
    ux = canvas.x;
    uy = canvas.y;
  }

  if (lastNode && userPos.lat && userPos.lng && lastNode.lat && lastNode.lng) {
    distToFinalDest = calculateGeographicDistance(userPos.lat, userPos.lng, lastNode.lat, lastNode.lng);
  } else if (lastNode && ux !== undefined && uy !== undefined && !isNaN(ux) && !isNaN(uy)) {
    distToFinalDest = Math.hypot(lastNode.x - ux, lastNode.y - uy) / PIXELS_PER_METER;
  }

  const isMatchedAtDest = Boolean(
    options?.matchedNodeId && lastNode && options.matchedNodeId === lastNode.id
  );

  // Arrival is ONLY possible when the user has traversed to the final segment (or near end) AND is on the destination's floor
  const isNearEndOfRoute = segIndex >= Math.max(0, nodes.length - 2);
  const isSameFloorAsDest = !lastNode?.floorId || !userPos.floorId || userPos.floorId === lastNode.floorId || userPos.floorId === "f-out";

  const isPhysicallyAtDest = Boolean(
    isNearEndOfRoute &&
    isSameFloorAsDest &&
    lastNode &&
    (distToFinalDest <= arrivalThreshold || isMatchedAtDest)
  );

  if (isPhysicallyAtDest) {
    const landmark = cleanLandmarkName(lastNode?.name);
    return {
      currentInstruction: {
        text: landmark ? `Arrived at ${landmark}` : "You have arrived",
        distance: 0,
        transition: "arrive",
        icon: "arrive",
        targetNodeId: lastNode?.id,
        targetNodeName: lastNode?.name,
        photoUrl: lastNode?.photoUrl,
      },
      nextInstruction: null,
      currentSegmentIndex: Math.max(0, nodes.length - 1),
      distanceRemaining: 0,
      distanceToManeuver: 0,
      turnAngle: 0,
      travelVector: { dx: 0, dy: 0 },
      upcomingVector: null,
      isOffRoute: false,
      isArrived: true,
    };
  }

  // 2. SEGMENT NODES & VECTORS
  const fromNode = nodes[segIndex];
  const toNode = nodes[segIndex + 1] ?? lastNode;
  const nextTargetNode = nodes[segIndex + 2] ?? null;

  if ((ux === undefined || uy === undefined || isNaN(ux) || isNaN(uy)) && userPos.lat && userPos.lng) {
    const canvas = gpsToCanvas(userPos.lat, userPos.lng);
    ux = canvas.x;
    uy = canvas.y;
  }

  const distToToNode = Math.hypot(toNode.x - ux, toNode.y - uy);
  let travelVector: { dx: number; dy: number };

  if (distToToNode > 2) {
    travelVector = { dx: toNode.x - ux, dy: toNode.y - uy };
  } else {
    travelVector = getNodeVector(fromNode, toNode);
  }

  let upcomingVector: { dx: number; dy: number } | null = null;
  if (nextTargetNode) {
    upcomingVector = getNodeVector(toNode, nextTargetNode);
  }

  // 3. TURN ANGLE & MANEUVER CALCULATION
  let turnAngle = 0;
  let icon: DirectionIcon = "straight";

  if (upcomingVector) {
    turnAngle = calculateTurnAngle(travelVector, upcomingVector);
    icon = turnIconFromAngle(turnAngle);
  }

  const baseInstruction = activeRoute.instructions?.[segIndex];
  const nextBaseInstruction = activeRoute.instructions?.[segIndex + 1];

  let instructionIcon = icon;
  const transitionType = baseInstruction?.transition;

  if (baseInstruction?.icon && ["lift", "stairs-up", "stairs-down", "parking", "ev-drive"].includes(baseInstruction.icon)) {
    instructionIcon = baseInstruction.icon;
  }

  let distanceToManeuver = Math.round(projection.distanceToSegmentEnd);
  if (userPos.lat && userPos.lng && toNode.lat && toNode.lng) {
    distanceToManeuver = calculateGeographicDistance(userPos.lat, userPos.lng, toNode.lat, toNode.lng);
  } else if (toNode.x !== undefined && toNode.y !== undefined) {
    distanceToManeuver = Math.round(Math.hypot(toNode.x - ux, toNode.y - uy) / PIXELS_PER_METER);
  }

  // 4. GENERATE INSTRUCTION TEXT
  let text = baseInstruction?.text || "";

  if (!transitionType || transitionType === "outdoor->indoor" || transitionType === "indoor->outdoor") {
    const isEntrance = (toNode.type === "ENTRANCE" || toNode.type === "BUILDING_ENTRANCE" || toNode.isEntranceNode);
    const isExit = (fromNode.floorId !== "f-out" && toNode.floorId === "f-out");
    const targetLandmark = toNode.visibleToUser === false ? undefined : toNode.name;
    const bldName = options?.buildingNames?.get(toNode.floorId ?? "");

    text = formatInstructionText(
      instructionIcon,
      targetLandmark,
      undefined,
      isEntrance,
      bldName,
      isExit
    );
  }

  const currentInstruction: RouteInstruction = {
    text,
    distance: distanceToManeuver,
    icon: instructionIcon,
    transition: transitionType,
    mode: baseInstruction?.mode ?? "WALK",
    floor: baseInstruction?.floor,
    building: baseInstruction?.building,
    targetNodeId: toNode.id,
    targetNodeName: toNode.visibleToUser === false ? undefined : toNode.name,
    photoUrl: toNode.photoUrl,
  };

  const nextInstruction: RouteInstruction | null = nextBaseInstruction
    ? {
        ...nextBaseInstruction,
        distance: Math.round(nextBaseInstruction.distance),
      }
    : null;

  return {
    currentInstruction,
    nextInstruction,
    currentSegmentIndex: segIndex,
    distanceRemaining: projection.distanceRemaining,
    distanceToManeuver,
    turnAngle,
    travelVector,
    upcomingVector,
    isOffRoute: projection.isDeviated,
    isArrived: false,
  };
}
