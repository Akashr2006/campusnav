import type { Node, EdgeType } from "@/shared/data/campus";
import { calculateHaversineDistance } from "./haversine";
import { canvasToGps } from "./projection";

export interface PathSplitResult {
  hasIntermediates: boolean;
  intermediates: Node[];
  edgesToCreate: Array<{
    fromNode: Node;
    toNode: Node;
    distance: number;
    type: EdgeType;
  }>;
}

/**
 * Checks if a candidate node P lies on the straight path segment between Node A and Node B.
 * Uses perpendicular distance projection and parameter t (0 < t < 1).
 */
export function isNodeOnPathSegment(
  nodeA: Node,
  nodeB: Node,
  candidate: Node,
  toleranceMeters = 5
): { isOnPath: boolean; projectionFactor: number; perpDistanceMeters: number } {
  if (candidate.id === nodeA.id || candidate.id === nodeB.id) {
    return { isOnPath: false, projectionFactor: 0, perpDistanceMeters: Infinity };
  }

  // Use x, y coordinates or lat/lng if available
  const ax = nodeA.x;
  const ay = nodeA.y;
  const bx = nodeB.x;
  const by = nodeB.y;
  const cx = candidate.x;
  const cy = candidate.y;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    return { isOnPath: false, projectionFactor: 0, perpDistanceMeters: Infinity };
  }

  // Dot product to find parameter t where projection P = A + t * (B - A)
  const t = ((cx - ax) * dx + (cy - ay) * dy) / lenSq;

  // Candidate must lie strictly between A and B (t strictly in (0.05, 0.95))
  if (t <= 0.05 || t >= 0.95) {
    return { isOnPath: false, projectionFactor: t, perpDistanceMeters: Infinity };
  }

  // Projection point coordinates
  const px = ax + t * dx;
  const py = ay + t * dy;

  // Perpendicular distance in canvas pixels
  const perpDistCanvas = Math.hypot(cx - px, cy - py);

  // Convert canvas distance to approximate meters (1 canvas unit ~ 0.25 meters)
  const perpDistMeters = perpDistCanvas * 0.25;

  // Also check GPS perpendicular distance if lat/lng are available
  let isWithinTolerance = perpDistMeters <= toleranceMeters;

  if (nodeA.lat && nodeA.lng && nodeB.lat && nodeB.lng && candidate.lat && candidate.lng) {
    // Haversine distance check from candidate to line segment projection
    const pGps = canvasToGps(px, py);
    const candidateToProjDist = calculateHaversineDistance(
      candidate.lat,
      candidate.lng,
      pGps.lat,
      pGps.lng
    );
    isWithinTolerance = candidateToProjDist <= toleranceMeters || perpDistMeters <= toleranceMeters;
  }

  return {
    isOnPath: isWithinTolerance,
    projectionFactor: t,
    perpDistanceMeters: perpDistMeters,
  };
}

/**
 * Finds all intermediate nodes lying on the straight line segment between Node A and Node B,
 * and generates the split edge sequence: Node A -> Int 1 -> Int 2 -> ... -> Node B.
 */
export function calculateEdgePathSplit(
  nodeA: Node,
  nodeB: Node,
  allNodes: Node[],
  edgeType: EdgeType = "WALK",
  toleranceMeters = 5
): PathSplitResult {
  // Only consider candidate nodes on the same floor, or outdoor nodes
  const candidateScope = allNodes.filter((n) => {
    if (n.id === nodeA.id || n.id === nodeB.id) return false;
    if (nodeA.floorId === nodeB.floorId) {
      return n.floorId === nodeA.floorId;
    }
    return n.floorId === nodeA.floorId || n.floorId === nodeB.floorId || n.floorId === "f-out";
  });

  const matchingIntermediates: { node: Node; t: number }[] = [];

  candidateScope.forEach((candidate) => {
    const res = isNodeOnPathSegment(nodeA, nodeB, candidate, toleranceMeters);
    if (res.isOnPath) {
      matchingIntermediates.push({ node: candidate, t: res.projectionFactor });
    }
  });

  // Sort intermediate nodes by projection factor t (from Node A towards Node B)
  matchingIntermediates.sort((a, b) => a.t - b.t);

  const intermediateNodes = matchingIntermediates.map((item) => item.node);

  // Construct node sequence: [Node A, ...intermediates, Node B]
  const sequence = [nodeA, ...intermediateNodes, nodeB];
  const edgesToCreate: PathSplitResult["edgesToCreate"] = [];

  for (let i = 0; i < sequence.length - 1; i++) {
    const fromNode = sequence[i];
    const toNode = sequence[i + 1];

    const fnGps = fromNode.lat && fromNode.lng ? { lat: fromNode.lat, lng: fromNode.lng } : canvasToGps(fromNode.x, fromNode.y);
    const tnGps = toNode.lat && toNode.lng ? { lat: toNode.lat, lng: toNode.lng } : canvasToGps(toNode.x, toNode.y);
    const dist = calculateHaversineDistance(fnGps.lat, fnGps.lng, tnGps.lat, tnGps.lng);

    edgesToCreate.push({
      fromNode,
      toNode,
      distance: dist,
      type: edgeType,
    });
  }

  return {
    hasIntermediates: intermediateNodes.length > 0,
    intermediates: intermediateNodes,
    edgesToCreate,
  };
}
