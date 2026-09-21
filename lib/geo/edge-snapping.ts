import { canvasToGps } from "./projection";
import { calculateGeographicDistance } from "./haversine";
import { buildAdjacencyGraph, type AdjacencyEdge } from "../routing/graph";
import { findShortestPath, type PathResult } from "../routing/dijkstra";
import type { Node, Edge, Obstacle } from "../../shared/data/campus";
import type { TravelMode } from "../routing/edge-accessibility";

export interface EdgeProjectionResult {
  edge: Edge;
  fromNode: Node;
  toNode: Node;
  projX: number;
  projY: number;
  projLat: number;
  projLng: number;
  t: number; // 0 to 1
  distanceToEdgeMeters: number;
  distToFromMeters: number;
  distToToMeters: number;
}

export interface SnappedRouteResult {
  matchedNode: Node;
  matchedDistanceMeters: number;
  routeResult: PathResult | null;
  snappedToEdge?: boolean;
  projectionPoint?: { x: number; y: number; lat: number; lng: number };
}

/**
 * Calculates perpendicular projection from point (px, py) onto line segment AB.
 */
export function projectPointToEdge(
  px: number,
  py: number,
  nodeA: Node,
  nodeB: Node,
  edge: Edge,
  userLat?: number,
  userLng?: number
): EdgeProjectionResult {
  const ax = nodeA.x;
  const ay = nodeA.y;
  const bx = nodeB.x;
  const by = nodeB.y;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  let t = 0;
  if (lenSq > 0) {
    const rawT = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, rawT));
  }

  const projX = Math.round((ax + t * dx) * 10) / 10;
  const projY = Math.round((ay + t * dy) * 10) / 10;

  const gps = canvasToGps(projX, projY);
  const projLat = gps.lat;
  const projLng = gps.lng;

  let distanceToEdgeMeters = 0;
  if (userLat && userLng && projLat && projLng) {
    distanceToEdgeMeters = calculateGeographicDistance(userLat, userLng, projLat, projLng);
  } else {
    const distPx = Math.hypot(px - projX, py - projY);
    distanceToEdgeMeters = Math.round(distPx * 0.4 * 10) / 10;
  }

  const totalEdgeDist = edge.distance || Math.max(1, Math.round(Math.hypot(dx, dy) * 0.4));
  const distToFromMeters = Math.round(t * totalEdgeDist * 10) / 10;
  const distToToMeters = Math.round((1 - t) * totalEdgeDist * 10) / 10;

  return {
    edge,
    fromNode: nodeA,
    toNode: nodeB,
    projX,
    projY,
    projLat,
    projLng,
    t,
    distanceToEdgeMeters: Math.round(distanceToEdgeMeters * 10) / 10,
    distToFromMeters,
    distToToMeters,
  };
}

/**
 * Finds the nearest edge segment to a user's location on the active floor.
 */
export function findNearestEdgeProjection(
  px: number,
  py: number,
  edges: Edge[],
  nodeMap: Map<string, Node>,
  activeFloorId?: string,
  userLat?: number,
  userLng?: number
): EdgeProjectionResult | null {
  if (!edges || edges.length === 0) return null;

  let bestProj: EdgeProjectionResult | null = null;
  let minDistance = Infinity;

  for (const edge of edges) {
    const nodeA = nodeMap.get(edge.from);
    const nodeB = nodeMap.get(edge.to);
    if (!nodeA || !nodeB) continue;

    // Filter by floor if specified
    if (activeFloorId && activeFloorId !== "f-out" && activeFloorId !== "f-all") {
      if (nodeA.floorId !== activeFloorId && nodeB.floorId !== activeFloorId) {
        continue;
      }
    }

    const proj = projectPointToEdge(px, py, nodeA, nodeB, edge, userLat, userLng);
    if (proj.distanceToEdgeMeters < minDistance) {
      minDistance = proj.distanceToEdgeMeters;
      bestProj = proj;
    }
  }

  return bestProj;
}

/**
 * Computes shortest path from a physical location, allowing direct orthogonal
 * connection anywhere along an edge (not just snapping backwards to endpoints).
 */
export function computeEdgeSnappedShortestPath(
  px: number,
  py: number,
  targetNodeId: string,
  nodes: Node[],
  edges: Edge[],
  obstacles: Obstacle[] = [],
  travelMode: TravelMode = "WALK",
  activeFloorId?: string,
  userLat?: number,
  userLng?: number
): SnappedRouteResult {
  const nodeMap = new Map<string, Node>(nodes.map((n) => [n.id, n]));

  // 1. Evaluate closest standalone node
  let closestNode: Node | null = null;
  let minNodeDistance = Infinity;

  for (const n of nodes) {
    if (n.accessible === false) continue;
    let dist = 0;
    if (userLat && userLng && n.lat && n.lng) {
      dist = calculateGeographicDistance(userLat, userLng, n.lat, n.lng);
    } else {
      dist = Math.hypot(px - n.x, py - n.y) * 0.4;
    }
    if (dist < minNodeDistance) {
      minNodeDistance = dist;
      closestNode = n;
    }
  }

  // 2. Evaluate closest point on any edge segment
  const edgeProj = findNearestEdgeProjection(px, py, edges, nodeMap, activeFloorId, userLat, userLng);

  const { graph } = buildAdjacencyGraph(nodes, edges, {
    obstacles,
    allowObstaclePenalties: true,
    travelMode,
  });

  // If no target destination selected, just return the anchor point
  if (!targetNodeId) {
    if (edgeProj && (edgeProj.distanceToEdgeMeters < minNodeDistance || !closestNode)) {
      const virtualNode: Node = {
        id: `virtual-edge-${edgeProj.edge.id}`,
        name: `Walkway (${edgeProj.edge.from} ↔ ${edgeProj.edge.to})`,
        x: edgeProj.projX,
        y: edgeProj.projY,
        lat: edgeProj.projLat,
        lng: edgeProj.projLng,
        floorId: edgeProj.fromNode.floorId || "f-out",
        type: "CORRIDOR",
      };
      return {
        matchedNode: virtualNode,
        matchedDistanceMeters: edgeProj.distanceToEdgeMeters,
        routeResult: null,
        snappedToEdge: true,
        projectionPoint: { x: edgeProj.projX, y: edgeProj.projY, lat: edgeProj.projLat, lng: edgeProj.projLng },
      };
    }

    return {
      matchedNode: closestNode || nodes[0],
      matchedDistanceMeters: Math.round(minNodeDistance * 10) / 10,
      routeResult: null,
      snappedToEdge: false,
    };
  }

  // Target destination is set: Determine if edge projection provides a direct, non-backtracking entry point
  if (
    edgeProj &&
    (edgeProj.distanceToEdgeMeters <= minNodeDistance + 8 || !closestNode) &&
    edgeProj.t > 0.04 &&
    edgeProj.t < 0.96
  ) {
    // Evaluate path continuing forward through toNode vs backward through fromNode
    const pathViaFrom = findShortestPath(graph, nodeMap, edgeProj.fromNode.id, targetNodeId);
    const pathViaTo = findShortestPath(graph, nodeMap, edgeProj.toNode.id, targetNodeId);

    const costViaFrom = pathViaFrom ? edgeProj.distToFromMeters + pathViaFrom.totalDistance : Infinity;
    const costViaTo = pathViaTo ? edgeProj.distToToMeters + pathViaTo.totalDistance : Infinity;

    if (costViaFrom < Infinity || costViaTo < Infinity) {
      const isViaToBetter = costViaTo <= costViaFrom;
      const chosenPath = isViaToBetter ? pathViaTo! : pathViaFrom!;
      const chosenDistOnEdge = isViaToBetter ? edgeProj.distToToMeters : edgeProj.distToFromMeters;
      const nextNode = isViaToBetter ? edgeProj.toNode : edgeProj.fromNode;

      const virtualStartNode: Node = {
        id: `v-start-${edgeProj.edge.id}`,
        name: "Current Location",
        x: edgeProj.projX,
        y: edgeProj.projY,
        lat: edgeProj.projLat,
        lng: edgeProj.projLng,
        floorId: edgeProj.fromNode.floorId || "f-out",
        type: "CORRIDOR",
      };

      // Construct continuous route starting at exact edge projection point
      const combinedNodes = [virtualStartNode, ...chosenPath.nodes];
      const virtualEdge: AdjacencyEdge = {
        from: virtualStartNode.id,
        to: nextNode.id,
        edgeId: `v-edge-${edgeProj.edge.id}`,
        distance: chosenDistOnEdge,
        weight: chosenDistOnEdge,
        bidirectional: true,
        type: edgeProj.edge.type,
      };
      const combinedEdges = [virtualEdge, ...chosenPath.edges];

      const synthesizedPath: PathResult = {
        nodes: combinedNodes,
        edges: combinedEdges,
        totalDistance: Math.round((chosenDistOnEdge + chosenPath.totalDistance) * 10) / 10,
        totalWeight: Math.round((chosenDistOnEdge + chosenPath.totalWeight) * 10) / 10,
      };

      return {
        matchedNode: virtualStartNode,
        matchedDistanceMeters: edgeProj.distanceToEdgeMeters,
        routeResult: synthesizedPath,
        snappedToEdge: true,
        projectionPoint: { x: edgeProj.projX, y: edgeProj.projY, lat: edgeProj.projLat, lng: edgeProj.projLng },
      };
    }
  }

  // Fallback to standard node candidate path
  if (closestNode) {
    const nodePath = findShortestPath(graph, nodeMap, closestNode.id, targetNodeId);
    return {
      matchedNode: closestNode,
      matchedDistanceMeters: Math.round(minNodeDistance * 10) / 10,
      routeResult: nodePath,
      snappedToEdge: false,
    };
  }

  return {
    matchedNode: nodes[0],
    matchedDistanceMeters: 0,
    routeResult: null,
    snappedToEdge: false,
  };
}
