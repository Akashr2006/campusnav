import { campusStore } from "../../../shared/lib/campus-store";
import type { Edge, Node, Obstacle } from "../../../shared/data/campus";
import { buildAdjacencyGraph } from "../../../lib/routing/graph";
import { findShortestPath } from "../../../lib/routing/dijkstra";
import { calculateTurnAngle, turnIconFromAngle, getNodeVector, cleanLandmarkName, formatInstructionText, type DirectionIcon } from "../../../lib/routing/directions";
import { calculateGeographicDistance, getNodeGeographicCoordinates, findContextAwareNearestNodes } from "../../../lib/geo/haversine";

import { WALK_SPEED, EV_SPEED, type TravelMode } from "../../../lib/routing/edge-accessibility";
import { validateCampusGraph } from "../../../shared/lib/graph-validator";

import { isPointInsideBuilding } from "../../../lib/geo/building-geometry";
import { gpsToCanvas } from "../../../lib/geo/projection";

export type RouteInstruction = {
  text: string;
  distance: number;
  icon?: DirectionIcon | "parking" | "ev-drive" | "walk";
  floor?: string;
  building?: string;
  transition?: "outdoor->indoor" | "indoor->outdoor" | "floor" | "arrive" | "ev->walk" | "walk->ev";
  mode?: "WALK" | "EV";
  targetNodeId?: string;
  targetNodeName?: string;
  photoUrl?: string;
};

export type Route = {
  id: string;
  nodes: Node[];
  edges: Edge[];
  distance: number;
  durationSec: number;
  instructions: RouteInstruction[];
  hasObstacles?: boolean;
  obstacleWarning?: string;
  travelMode?: TravelMode | "MULTIMODAL";
  evDistance?: number;
  walkDistance?: number;
  transferNodeId?: string;
  transferNodeName?: string;
  isFallbackWalk?: boolean;
  fallbackReason?: string;
};

export type ShortestPathOptions = {
  isDraftMode?: boolean;
  travelMode?: TravelMode;
  graphData?: any;
  userLocation?: { lat?: number; lng?: number; latitude?: number; longitude?: number; x?: number; y?: number };
};

export function shortestPath(
  startId: string,
  endId: string,
  options?: ShortestPathOptions
): Route | null {
  if (!startId || !endId) return null;

  const travelMode = options?.travelMode ?? "WALK";

  if (options?.graphData) {
    return computeShortestPathForData(options.graphData, startId, endId, travelMode, options);
  }

  const isDraft = options?.isDraftMode ?? false;
  const work = campusStore.getWorkingData();

  if (isDraft) {
    // Admin Draft Mode: Stay strictly in draft context to display exact error diagnostics
    if (work.nodes.length > 0) {
      return computeShortestPathForData(work, startId, endId, travelMode, options);
    }
    return null;
  }

  // User Published Mode: Route on the published map snapshot from database
  const pub = campusStore.getPublishedData();
  if (pub.nodes.length > 0) {
    const pubResult = computeShortestPathForData(pub, startId, endId, travelMode, options);
    if (pubResult) return pubResult;
  }

  // Fallback to working data if published snapshot is empty
  if (work.nodes.length > 0) {
    return computeShortestPathForData(work, startId, endId, travelMode, options);
  }

  return null;
}

function computeShortestPathForData(
  data: ReturnType<typeof campusStore.getWorkingData> | ReturnType<typeof campusStore.getPublishedData>,
  startId: string,
  endId: string,
  travelMode: TravelMode = "WALK",
  options?: ShortestPathOptions
): Route | null {
  if (data.nodes.length === 0) return null;

  const obstacles = data.obstacles || [];

  // Pass 1: Primary strict graph — hard-blocks all obstacle edges to guarantee obstacle avoidance
  const { graph: primaryGraph, nodeMap } = buildAdjacencyGraph(data.nodes, data.edges, {
    obstacles,
    floors: data.floors,
    allowObstaclePenalties: false,
    travelMode,
  });

  // Aggregating helper to collect candidate node IDs for a location query
  const resolveNodeIds = (paramId: string): string[] => {
    if (!paramId) return [];
    const normalized = paramId.trim().toLowerCase();
    const candidateIds = new Set<string>();

    // 1. Direct node ID match
    if (nodeMap.has(paramId)) {
      return [paramId];
    }

    // Live Location query identifier fallback
    if (
      normalized === "dest-live-user-location" ||
      normalized === "n-live-user" ||
      normalized === "your location"
    ) {
      const userLoc = options?.userLocation;
      const uLat = userLoc?.lat ?? (userLoc as any)?.latitude;
      const uLng = userLoc?.lng ?? (userLoc as any)?.longitude;
      const uX = (userLoc as any)?.x;
      const uY = (userLoc as any)?.y;
      const userCanvasPos = (typeof uX === "number" && typeof uY === "number" && !isNaN(uX) && !isNaN(uY))
        ? { x: uX, y: uY }
        : (uLat && uLng ? gpsToCanvas(uLat, uLng) : null);

      // Check if user's live position is physically inside any building (strict polygon boundary, 0 margin)
      let userBuilding: any = null;
      if (userCanvasPos && data.buildings && data.buildings.length > 0) {
        userBuilding = data.buildings.find((b: any) => isPointInsideBuilding(userCanvasPos.x, userCanvasPos.y, b, 0)) || null;
      }

      const ranked = findContextAwareNearestNodes(uLat || 0, uLng || 0, data.nodes, {
        isInside: Boolean(userBuilding),
        buildingId: userBuilding?.id,
        buildingName: userBuilding?.name,
        floors: data.floors,
        userCanvasPos,
      });

      if (ranked.length > 0) {
        return ranked.map((n) => n.id);
      }

      const outdoorNodes = data.nodes.filter(
        (n: Node) =>
          n.floorId === "f-out" ||
          n.floorId === "outdoor" ||
          n.type === "OUTDOOR" ||
          n.type === "OUTDOOR_PATH" ||
          n.type === "BUILDING_ENTRANCE" ||
          n.type === "GATE" ||
          n.type === "CORRIDOR" ||
          n.isEntranceNode
      );

      if (outdoorNodes.length > 0) return outdoorNodes.map((n) => n.id);
      if (data.nodes.length > 0) return [data.nodes[0].id];
    }

    // 2. Direct exact node name match (Ground / Entrance node priority)
    const exactNameNodes = data.nodes.filter(
      (n) => n.name && n.name.trim().toLowerCase() === normalized
    );
    if (exactNameNodes.length > 0) {
      const groundOrEntrance = exactNameNodes.filter((n) => {
        const floor = data.floors.find((f) => f.id === n.floorId);
        return (floor && floor.ordinal === 0) || n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode;
      });
      if (groundOrEntrance.length > 0) {
        return groundOrEntrance.map((n) => n.id);
      }
      return exactNameNodes.map((n) => n.id);
    }

    // 3. Destination match (by ID, exact name, or alias)
    const exactDest = data.destinations.find(
      (d) => d.id === paramId || d.name.trim().toLowerCase() === normalized
    );
    if (exactDest) {
      if (exactDest.nodeId && nodeMap.has(exactDest.nodeId)) {
        return [exactDest.nodeId];
      }
      const matchingGroundNode = data.nodes.find((n) => {
        const isSameName = n.name && n.name.trim().toLowerCase() === exactDest.name.trim().toLowerCase();
        const floor = data.floors.find((f) => f.id === n.floorId);
        return isSameName && ((floor && floor.ordinal === 0) || n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode);
      });
      if (matchingGroundNode) {
        return [matchingGroundNode.id];
      }
      if (exactDest.x !== undefined && exactDest.y !== undefined && data.nodes.length > 0) {
        const sorted = data.nodes
          .slice()
          .sort((a, b) => Math.hypot(a.x - exactDest.x!, a.y - exactDest.y!) - Math.hypot(b.x - exactDest.x!, b.y - exactDest.y!));
        if (sorted[0]) return [sorted[0].id];
      }
    }

    const matchingDests = data.destinations.filter((d) => {
      const matchName = d.name.trim().toLowerCase() === normalized;
      const matchAlias = d.aliases && d.aliases.some((a) => a.trim().toLowerCase() === normalized);
      return (matchName || matchAlias) && d.nodeId && nodeMap.has(d.nodeId);
    });
    if (matchingDests.length > 0) {
      return matchingDests.map((d) => d.nodeId).filter((id): id is string => Boolean(id));
    }

    // 4. Strict Building match (ONLY for exact building code or exact building name)
    const building = data.buildings.find(
      (b) =>
        b.id === paramId ||
        b.name.trim().toLowerCase() === normalized ||
        (b.shortCode && b.shortCode.trim().toLowerCase() === normalized)
    );

    if (building) {
      const buildingFloorIds = new Set(
        data.floors.filter((f) => f.buildingId === building.id).map((f) => f.id)
      );
      // Prefer entrance nodes or ground floor nodes of the building
      const entranceNodes = data.nodes.filter(
        (n) =>
          buildingFloorIds.has(n.floorId) &&
          (n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode)
      );
      if (entranceNodes.length > 0) {
        return entranceNodes.map((n) => n.id);
      }

      data.nodes.forEach((n) => {
        if (buildingFloorIds.has(n.floorId)) {
          candidateIds.add(n.id);
        }
      });
      if (candidateIds.size > 0) return Array.from(candidateIds);
    }

    // 5. Fallback: partial name match on nodes
    const partialNodes = data.nodes.filter(
      (n) => n.name && n.name.trim().toLowerCase().includes(normalized)
    );
    if (partialNodes.length > 0) {
      return partialNodes.map((n) => n.id);
    }

    return [];
  };

  const startNodeIds = resolveNodeIds(startId);
  const endNodeIds = resolveNodeIds(endId);

  if (startNodeIds.length === 0 || endNodeIds.length === 0) return null;

  // Primary search: Evaluate candidate node combinations in ascending distance order
  let bestResult: ReturnType<typeof findShortestPath> = null;
  let bestTotalTripDistance = Infinity;
  let isObstacleFree = false;

  const isStartingFromLiveLocation =
    startId.trim().toLowerCase() === "dest-live-user-location" ||
    startId.trim().toLowerCase() === "n-live-user" ||
    startId.trim().toLowerCase() === "your location";

  for (const sId of startNodeIds) {
    for (const eId of endNodeIds) {
      // Prevent routing from node to itself if alternate start nodes exist
      if (sId === eId && startNodeIds.length > 1) {
        continue;
      }

      const sNode = nodeMap.get(sId);
      const uLoc = options?.userLocation;
      if (uLoc && sNode) {
        const sCoord = getNodeGeographicCoordinates(sNode);
        const uLat = uLoc.lat ?? (uLoc as any).latitude;
        const uLng = uLoc.lng ?? (uLoc as any).longitude;
        if (typeof uLat === "number" && typeof uLng === "number" && uLat !== 0 && uLng !== 0) {
          const candDist = calculateGeographicDistance(uLat, uLng, sCoord.lat, sCoord.lng);
          console.debug(`[NearestNode] Evaluating start candidate ${sId} (${sNode.name || "unnamed"}) at ${candDist}m to ${eId}`);
        }
      }

      const res = findShortestPath(primaryGraph, nodeMap, sId, eId);
      if (res && res.edges.length > 0) {
        // If starting from Live Location, startNodeIds are already ranked in order of distance to the user!
        // The first candidate that can reach the destination is the closest routable node to the user.
        if (isStartingFromLiveLocation) {
          bestResult = res;
          isObstacleFree = true;
          break;
        } else if (!bestResult || res.totalDistance < bestResult.totalDistance) {
          bestResult = res;
          isObstacleFree = true;
        }
      } else {
        console.debug(`[NearestNode] Candidate start node ${sId} is disconnected from destination ${eId}; trying next candidate...`);
      }
    }
    if (isStartingFromLiveLocation && bestResult) {
      break;
    }
  }

  if (!bestResult) {
    if (travelMode === "EV") {
      const multimodalRoute = computeMultimodalEVRouteForData(
        data,
        startNodeIds,
        endNodeIds,
        obstacles
      );
      if (multimodalRoute && (multimodalRoute.evDistance ?? 0) > 0) {
        return multimodalRoute;
      }
    }

    const { graph: fallbackGraph } = buildAdjacencyGraph(data.nodes, data.edges, {
      obstacles,
      floors: data.floors,
      allowObstaclePenalties: true,
      travelMode,
    });

    for (const sId of startNodeIds) {
      for (const eId of endNodeIds) {
        const res = findShortestPath(fallbackGraph, nodeMap, sId, eId);
        if (res && res.edges.length > 0) {
          if (isStartingFromLiveLocation) {
            bestResult = res;
            isObstacleFree = false;
            break;
          } else if (!bestResult || res.totalDistance < bestResult.totalDistance) {
            bestResult = res;
            isObstacleFree = false;
          }
        }
      }
      if (isStartingFromLiveLocation && bestResult) {
        break;
      }
    }
  }

  // If EV mode requested but no valid EV route exists, automatically fall back to the shortest walkable route
  if (!bestResult && travelMode === "EV") {
    const walkFallback = computeShortestPathForData(data, startId, endId, "WALK", options);
    if (walkFallback) {
      return {
        ...walkFallback,
        isFallbackWalk: true,
        fallbackReason: "EV path not available, Showing walkable route",
      };
    }
  }

  if (!bestResult) return null;

  const floorById = (id: string) => data.floors.find((f) => f.id === id);
  const buildingById = (id: string) => data.buildings.find((b) => b.id === id);

  // Preserve exact traversal orientation (adj.from -> adj.to) for path rendering
  const rawEdges: Edge[] = bestResult.edges.map((adj) => {
    const original = data.edges.find(
      (e) => e.id === adj.edgeId || `${e.id}_rev` === adj.edgeId
    );
    return {
      id: original?.id ?? adj.edgeId,
      from: adj.from,
      to: adj.to,
      type: adj.type,
      pathType: adj.pathType ?? original?.pathType ?? (travelMode === "EV" ? "EV" : "WALK"),
      distance: adj.distance,
      bidirectional: adj.bidirectional,
    };
  });

  const routeEdgeIds = new Set(rawEdges.map((e) => e.id));
  const hasObstacleSegment = !isObstacleFree || obstacles.some((obs) => {
    return obs.edgeIds && obs.edgeIds.some((eId) => routeEdgeIds.has(eId) || routeEdgeIds.has(`${eId}_rev`));
  });

  const speed = travelMode === "EV" ? EV_SPEED : WALK_SPEED;

  return {
    id: `${startId}->${endId}`,
    nodes: bestResult.nodes,
    edges: rawEdges,
    distance: bestResult.totalDistance,
    durationSec: Math.round(bestResult.totalDistance / speed),
    travelMode,
    evDistance: travelMode === "EV" ? bestResult.totalDistance : 0,
    walkDistance: travelMode === "WALK" ? bestResult.totalDistance : 0,
    hasObstacles: hasObstacleSegment,
    obstacleWarning: hasObstacleSegment
      ? "⚠ Route passes through active hazard / construction zones. Exercise caution while navigating."
      : undefined,
    instructions: buildInstructions(
      bestResult.nodes,
      rawEdges,
      floorById,
      buildingById,
      travelMode
    ),
  };
}

function computeMultimodalEVRouteForData(
  data: ReturnType<typeof campusStore.getWorkingData> | ReturnType<typeof campusStore.getPublishedData>,
  startNodeIds: string[],
  endNodeIds: string[],
  obstacles: Obstacle[] = []
): Route | null {
  const { graph: walkGraph, nodeMap } = buildAdjacencyGraph(data.nodes, data.edges, {
    obstacles,
    floors: data.floors,
    allowObstaclePenalties: false,
    travelMode: "WALK",
  });

  const { graph: evGraph } = buildAdjacencyGraph(data.nodes, data.edges, {
    obstacles,
    floors: data.floors,
    allowObstaclePenalties: false,
    travelMode: "EV",
  });

  // Collect all nodes that have at least one EV edge
  const evNodeIds = new Set<string>();
  for (const [nodeId, edges] of evGraph.entries()) {
    if (edges && edges.length > 0) {
      evNodeIds.add(nodeId);
    }
  }

  // If no EV roads exist in campus, fallback
  if (evNodeIds.size === 0) {
    return null;
  }

  const evNodeList = Array.from(evNodeIds);

  interface MultimodalCandidate {
    startId: string;
    startEvId: string;
    endEvId: string;
    endId: string;
    walkStartRes: ReturnType<typeof findShortestPath>;
    evDriveRes: ReturnType<typeof findShortestPath>;
    walkEndRes: ReturnType<typeof findShortestPath>;
    totalTravelCost: number;
    totalDistance: number;
    evDistance: number;
    walkDistance: number;
  }

  let bestCandidate: MultimodalCandidate | null = null;

  for (const sId of startNodeIds) {
    const isStartEv = evNodeIds.has(sId);
    const candidateStartEvs = isStartEv ? [sId] : evNodeList;

    for (const eId of endNodeIds) {
      const isEndEv = evNodeIds.has(eId);
      const candidateEndEvs = isEndEv ? [eId] : evNodeList;

      for (const pStart of candidateStartEvs) {
        let walkStartRes: ReturnType<typeof findShortestPath> = null;
        let walkStartDist = 0;
        if (sId !== pStart) {
          walkStartRes = findShortestPath(walkGraph, nodeMap, sId, pStart);
          if (!walkStartRes) continue;
          walkStartDist = walkStartRes.totalDistance;
        }

        for (const pEnd of candidateEndEvs) {
          // Multimodal EV route MUST include an actual EV driving segment between different EV nodes
          if (pStart === pEnd) continue;

          let walkEndRes: ReturnType<typeof findShortestPath> = null;
          let walkEndDist = 0;
          if (pEnd !== eId) {
            walkEndRes = findShortestPath(walkGraph, nodeMap, pEnd, eId);
            if (!walkEndRes) continue;
            walkEndDist = walkEndRes.totalDistance;
          }

          let evDriveRes: ReturnType<typeof findShortestPath> = null;
          evDriveRes = findShortestPath(evGraph, nodeMap, pStart, pEnd);
          if (!evDriveRes || evDriveRes.totalDistance <= 0) continue;
          const evDriveDist = evDriveRes.totalDistance;

          const walkTime = (walkStartDist + walkEndDist) / WALK_SPEED;
          const evTime = evDriveDist / EV_SPEED;
          const totalTravelCost = walkTime + evTime;
          const totalDistance = walkStartDist + evDriveDist + walkEndDist;

          if (!bestCandidate || totalTravelCost < bestCandidate.totalTravelCost) {
            bestCandidate = {
              startId: sId,
              startEvId: pStart,
              endEvId: pEnd,
              endId: eId,
              walkStartRes,
              evDriveRes,
              walkEndRes,
              totalTravelCost,
              totalDistance,
              evDistance: evDriveDist,
              walkDistance: walkStartDist + walkEndDist,
            };
          }
        }
      }
    }
  }

  if (!bestCandidate || bestCandidate.evDistance <= 0) return null;

  // Stitch combined nodes and edges
  const combinedNodes: Node[] = [];
  const combinedEdges: Edge[] = [];

  const appendSegment = (res: ReturnType<typeof findShortestPath>, mode: "WALK" | "EV") => {
    if (!res) return;
    for (let i = 0; i < res.nodes.length; i++) {
      if (combinedNodes.length === 0 || combinedNodes[combinedNodes.length - 1].id !== res.nodes[i].id) {
        combinedNodes.push(res.nodes[i]);
      }
    }
    for (const adj of res.edges) {
      const original = data.edges.find((e) => e.id === adj.edgeId || `${e.id}_rev` === adj.edgeId);
      combinedEdges.push({
        id: original?.id ?? adj.edgeId,
        from: adj.from,
        to: adj.to,
        type: adj.type,
        pathType: mode,
        distance: adj.distance,
        bidirectional: adj.bidirectional,
      });
    }
  };

  appendSegment(bestCandidate.walkStartRes, "WALK");
  appendSegment(bestCandidate.evDriveRes, "EV");
  appendSegment(bestCandidate.walkEndRes, "WALK");

  const floorById = (id: string) => data.floors.find((f) => f.id === id);
  const buildingById = (id: string) => data.buildings.find((b) => b.id === id);

  const transferNode = nodeMap.get(bestCandidate.endEvId);
  const totalDurationSec = Math.round(
    bestCandidate.evDistance / EV_SPEED + bestCandidate.walkDistance / WALK_SPEED
  );

  return {
    id: `${startNodeIds[0]}->${endNodeIds[0]}`,
    nodes: combinedNodes,
    edges: combinedEdges,
    distance: bestCandidate.totalDistance,
    durationSec: totalDurationSec,
    travelMode: bestCandidate.evDistance > 0 && bestCandidate.walkDistance > 0 ? "MULTIMODAL" : "EV",
    evDistance: bestCandidate.evDistance,
    walkDistance: bestCandidate.walkDistance,
    transferNodeId: bestCandidate.walkDistance > 0 && bestCandidate.evDistance > 0 ? bestCandidate.endEvId : undefined,
    transferNodeName: transferNode?.name || undefined,
    instructions: buildInstructions(
      combinedNodes,
      combinedEdges,
      floorById,
      buildingById,
      "MULTIMODAL"
    ),
  };
}

export function multiStopShortestPath(
  waypointIds: string[],
  options?: { isDraftMode?: boolean; travelMode?: TravelMode; graphData?: any }
): Route | null {
  const validWaypoints = waypointIds.filter(Boolean);
  if (validWaypoints.length < 2) return null;

  let totalDistance = 0;
  let totalDurationSec = 0;
  let combinedNodes: Node[] = [];
  let combinedEdges: Edge[] = [];
  let combinedInstructions: RouteInstruction[] = [];
  let hasObstacles = false;

  for (let i = 0; i < validWaypoints.length - 1; i++) {
    const segStart = validWaypoints[i];
    const segEnd = validWaypoints[i + 1];
    const segRoute = shortestPath(segStart, segEnd, options);
    if (!segRoute) return null;

    totalDistance += segRoute.distance;
    totalDurationSec += segRoute.durationSec;
    if (segRoute.hasObstacles) hasObstacles = true;

    if (i === 0) {
      combinedNodes = [...segRoute.nodes];
      combinedEdges = [...segRoute.edges];
    } else {
      combinedNodes = [...combinedNodes, ...segRoute.nodes.slice(1)];
      combinedEdges = [...combinedEdges, ...segRoute.edges];
    }

    if (validWaypoints.length > 2 && i > 0) {
      const stopNodeName = segRoute.nodes[0]?.name || `Stop ${i}`;
      combinedInstructions.push({
        text: `Via ${stopNodeName}`,
        distance: 0,
        transition: "arrive",
      });
    }
    combinedInstructions = combinedInstructions.concat(segRoute.instructions || []);
  }

  const isAnyFallback = options?.travelMode === "EV" && combinedEdges.some((e) => e.pathType !== "EV");

  return {
    id: `multi-${Date.now()}`,
    nodes: combinedNodes,
    edges: combinedEdges,
    distance: totalDistance,
    durationSec: totalDurationSec,
    instructions: combinedInstructions,
    hasObstacles,
    isFallbackWalk: isAnyFallback,
    fallbackReason: isAnyFallback ? "EV path not available, Showing walkable route" : undefined,
    obstacleWarning: hasObstacles
      ? "⚠ Route passes through active hazard / construction zones. Exercise caution while navigating."
      : undefined,
  };
}

function buildInstructions(
  ns: Node[],
  es: Edge[],
  floorById: (id: string) => ReturnType<typeof campusStore.getWorkingData>["floors"][0] | undefined,
  buildingById: (id: string) => ReturnType<typeof campusStore.getWorkingData>["buildings"][0] | undefined,
  // Road edges are walkable, so a walking route can cross them. Only an EV
  // route should be told to board or park a vehicle.
  travelMode: TravelMode | "MULTIMODAL" = "WALK"
): RouteInstruction[] {
  if (ns.length < 2 || es.length === 0) {
    const lastNode = ns[0];
    const landmark = cleanLandmarkName(lastNode?.name);
    return [
      {
        text: landmark ? `Arrived at ${landmark}` : "Arrived",
        distance: 0,
        transition: "arrive",
      },
    ];
  }

  const out: RouteInstruction[] = [];
  let lastFloor = ns[0]?.floorId;
  let prevVector: { dx: number; dy: number } | null = null;

  for (let i = 0; i < es.length; i++) {
    const edge = es[i];
    const prevEdge = i > 0 ? es[i - 1] : null;
    const fromNode = ns[i];
    const to = ns[i + 1];
    if (!to || !fromNode) continue;

    const floor = floorById(to.floorId);
    const bld = floor ? buildingById(floor.buildingId) : undefined;
    const isFloorTransition = to.floorId !== lastFloor;

    const currentVector = getNodeVector(fromNode, to);
    let icon = "straight" as any;

    if (prevVector !== null && !isFloorTransition && edge.type !== "LIFT" && edge.type !== "STAIRS") {
      const angleDeg = calculateTurnAngle(prevVector, currentVector);
      icon = turnIconFromAngle(angleDeg);
    }

    let text = "";
    let transitionType: RouteInstruction["transition"] = undefined;

    const isFromOutdoor = fromNode.floorId === "f-out" || fromNode.floorId === "outdoor";
    const isToOutdoor = to.floorId === "f-out" || to.floorId === "outdoor";
    const isOutdoorToIndoor = isFromOutdoor && !isToOutdoor;
    const isIndoorToOutdoor = !isFromOutdoor && isToOutdoor;

    // Check for EV <-> Walk mode transition
    const usesVehicle = travelMode !== "WALK";
    const isEvToWalk = usesVehicle && prevEdge && prevEdge.pathType === "EV" && edge.pathType === "WALK";
    const isWalkToEv = usesVehicle && prevEdge && prevEdge.pathType === "WALK" && edge.pathType === "EV";

    if (isEvToWalk) {
      text = `Park EV at ${fromNode.name || "drop-off point"} · Continue on foot`;
      transitionType = "ev->walk";
      icon = "parking";
      prevVector = currentVector;
    } else if (isWalkToEv) {
      text = `Board EV at ${fromNode.name || "pickup point"} · Drive along road`;
      transitionType = "walk->ev";
      icon = "ev-drive";
      prevVector = currentVector;
    } else if (edge.type === "LIFT") {
      text = `Take lift to ${floor?.name ?? "next floor"}`;
      transitionType = "floor";
      icon = "lift";
      prevVector = null;
    } else if (edge.type === "STAIRS") {
      text = `Take stairs to ${floor?.name ?? "next floor"}`;
      transitionType = "floor";
      icon = "stairs-up";
      prevVector = null;
    } else if (isFloorTransition && edge.type === "RAMP") {
      text = `Take ramp to ${floor?.name ?? "next floor"}`;
      transitionType = "floor";
      icon = "straight";
      prevVector = currentVector;
    } else if ((to.type === "ENTRANCE" || to.type === "BUILDING_ENTRANCE" || to.isEntranceNode) && isOutdoorToIndoor) {
      text = `Enter ${bld?.name ?? "the building"}`;
      transitionType = "outdoor->indoor";
      icon = "straight";
      prevVector = currentVector;
    } else if (isIndoorToOutdoor) {
      text = "Exit the building";
      transitionType = "indoor->outdoor";
      icon = "straight";
      prevVector = currentVector;
    } else if (isFloorTransition) {
      text = `Go to ${floor?.name ?? "next floor"}`;
      transitionType = "floor";
      icon = "straight";
      prevVector = currentVector;
    } else {
      const targetLandmarkName = to.visibleToUser === false ? undefined : to.name;
      text = formatInstructionText(icon, targetLandmarkName);
      prevVector = currentVector;
    }

    out.push({
      text,
      distance: edge.distance,
      icon,
      floor: floor?.name,
      building: bld?.name,
      transition: transitionType,
      mode: edge.pathType === "EV" ? "EV" : "WALK",
      targetNodeId: to.id,
      targetNodeName: to.visibleToUser === false ? undefined : to.name,
      photoUrl: to.photoUrl,
    });
    lastFloor = to.floorId;
  }

  const last = ns[ns.length - 1];
  const lastLandmark = last?.visibleToUser === false ? null : cleanLandmarkName(last?.name);
  out.push({
    text: lastLandmark ? `You have arrived at ${lastLandmark}` : "You have arrived",
    distance: 0,
    icon: "arrive",
    transition: "arrive",
    targetNodeId: last?.id,
    targetNodeName: last?.visibleToUser === false ? undefined : last?.name,
    photoUrl: last?.photoUrl,
  });

  // Combine consecutive "Go straight" / straight steps into one clean step with summed distance
  const merged: RouteInstruction[] = [];
  for (let i = 0; i < out.length; i++) {
    const current = out[i];
    const prev = merged[merged.length - 1];

    const isStraight = current.icon === "straight" && (!current.transition || current.transition === "outdoor->indoor");
    const prevIsStraight = prev && prev.icon === "straight" && (!prev.transition || prev.transition === "outdoor->indoor");

    const sameFloor = prev && (prev.floor === current.floor);
    const sameBuilding = prev && (prev.building === current.building);
    const sameMode = prev && (prev.mode === current.mode);

    if (prev && prevIsStraight && isStraight && sameFloor && sameBuilding && sameMode && current.icon !== "arrive") {
      // Sum distance into previous instruction
      prev.distance = Math.round(prev.distance + current.distance);
      prev.targetNodeId = current.targetNodeId || prev.targetNodeId;
      prev.targetNodeName = current.targetNodeName || prev.targetNodeName;
      if (current.photoUrl) prev.photoUrl = current.photoUrl;
      if (current.text && current.text !== "Go straight" && prev.text === "Go straight") {
        prev.text = current.text;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

export function findAlternativeRoutes(
  startId: string,
  endId: string,
  options?: ShortestPathOptions
): { primary: Route | null; alternative: Route | null } {
  const primary = shortestPath(startId, endId, options);
  if (!primary || primary.edges.length === 0) {
    return { primary, alternative: null };
  }

  const primaryEdgeIds = new Set(primary.edges.map((e) => e.id));
  const data = options?.graphData || campusStore.getPublishedData();
  if (!data || !data.edges || data.edges.length === 0) {
    return { primary, alternative: null };
  }

  const penalizedEdges: Edge[] = data.edges.map((e: Edge) => {
    if (primaryEdgeIds.has(e.id) || primaryEdgeIds.has(e.id.replace(/_rev$/, ""))) {
      return { ...e, distance: e.distance * 2.5 };
    }
    return e;
  });

  const altData = { ...data, edges: penalizedEdges };
  const altRouteRaw = shortestPath(startId, endId, {
    ...options,
    graphData: altData,
  });

  if (!altRouteRaw || altRouteRaw.nodes.length === 0) {
    return { primary, alternative: null };
  }

  const primaryNodeKey = primary.nodes.map((n) => n.id).join("->");
  const altNodeKey = altRouteRaw.nodes.map((n) => n.id).join("->");
  if (primaryNodeKey === altNodeKey) {
    return { primary, alternative: null };
  }

  const originalEdgeMap = new Map(data.edges.map((e: Edge) => [e.id, e]));
  let trueDistance = 0;
  const trueEdges: Edge[] = [];

  for (const e of altRouteRaw.edges) {
    const orig = (originalEdgeMap.get(e.id) || originalEdgeMap.get(e.id.replace(/_rev$/, "")) || e) as Edge;
    trueDistance += orig.distance;
    trueEdges.push({ ...orig, pathType: e.pathType });
  }

  const trueDurationSec = Math.round(trueDistance / (altRouteRaw.travelMode === "EV" ? EV_SPEED : WALK_SPEED));

  const alternative: Route = {
    ...altRouteRaw,
    id: `alt-${Date.now()}`,
    distance: Math.round(trueDistance),
    durationSec: Math.max(1, trueDurationSec),
    edges: trueEdges,
  };

  if (alternative.distance > primary.distance * 2.2) {
    return { primary, alternative: null };
  }

  return { primary, alternative };
}
