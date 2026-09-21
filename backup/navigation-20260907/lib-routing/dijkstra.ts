import type { Node } from "@/shared/data/campus";
import type { AdjacencyEdge, GraphAdjacencyMap } from "./graph";

class MinHeap<T> {
  private heap: { key: number; value: T }[] = [];

  public push(key: number, value: T): void {
    this.heap.push({ key, value });
    this.bubbleUp(this.heap.length - 1);
  }

  public pop(): T | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0].value;
    const bottom = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = bottom;
      this.bubbleDown(0);
    }
    return top;
  }

  public size(): number {
    return this.heap.length;
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.heap[idx].key >= this.heap[parentIdx].key) break;
      [this.heap[idx], this.heap[parentIdx]] = [this.heap[parentIdx], this.heap[idx]];
      idx = parentIdx;
    }
  }

  private bubbleDown(idx: number): void {
    const length = this.heap.length;
    while (true) {
      const leftIdx = 2 * idx + 1;
      const rightIdx = 2 * idx + 2;
      let smallest = idx;

      if (leftIdx < length && this.heap[leftIdx].key < this.heap[smallest].key) {
        smallest = leftIdx;
      }
      if (rightIdx < length && this.heap[rightIdx].key < this.heap[smallest].key) {
        smallest = rightIdx;
      }
      if (smallest === idx) break;
      [this.heap[idx], this.heap[smallest]] = [this.heap[smallest], this.heap[idx]];
      idx = smallest;
    }
  }
}

export interface PathResult {
  nodes: Node[];
  edges: AdjacencyEdge[];
  totalDistance: number;
  totalWeight: number;
}

export function findShortestPath(
  graph: GraphAdjacencyMap,
  nodeMap: Map<string, Node>,
  startNodeId: string,
  endNodeId: string
): PathResult | null {
  if (!nodeMap.has(startNodeId) || !nodeMap.has(endNodeId)) return null;
  if (startNodeId === endNodeId) {
    const startNode = nodeMap.get(startNodeId)!;
    return { nodes: [startNode], edges: [], totalDistance: 0, totalWeight: 0 };
  }

  const dist = new Map<string, number>();
  const prev = new Map<string, { nodeId: string; edge: AdjacencyEdge } | null>();
  const heap = new MinHeap<string>();

  dist.set(startNodeId, 0);
  heap.push(0, startNodeId);

  const visited = new Set<string>();

  while (heap.size() > 0) {
    const current = heap.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);

    if (current === endNodeId) break;

    const currentDist = dist.get(current)!;
    const neighbors = graph.get(current) ?? [];

    for (const edge of neighbors) {
      if (visited.has(edge.to)) continue;
      const alt = currentDist + edge.weight;
      if (alt < (dist.get(edge.to) ?? Infinity)) {
        dist.set(edge.to, alt);
        prev.set(edge.to, { nodeId: current, edge });
        heap.push(alt, edge.to);
      }
    }
  }

  if (!dist.has(endNodeId) || !isFinite(dist.get(endNodeId)!)) return null;

  const pathNodes: Node[] = [];
  const pathEdges: AdjacencyEdge[] = [];
  let curr: string | null = endNodeId;

  while (curr) {
    const n = nodeMap.get(curr);
    if (n) pathNodes.unshift(n);
    const p = prev.get(curr);
    if (!p) break;
    pathEdges.unshift(p.edge);
    curr = p.nodeId;
  }

  const totalDistance = pathEdges.reduce((sum, e) => sum + e.distance, 0);
  const totalWeight = dist.get(endNodeId)!;

  return {
    nodes: pathNodes,
    edges: pathEdges,
    totalDistance,
    totalWeight,
  };
}

export function findMultiDestinationPath(
  graph: GraphAdjacencyMap,
  nodeMap: Map<string, Node>,
  startNodeId: string,
  destinationNodeIds: string[]
): PathResult | null {
  if (destinationNodeIds.length === 0) return null;
  if (destinationNodeIds.length === 1) {
    return findShortestPath(graph, nodeMap, startNodeId, destinationNodeIds[0]);
  }

  let currentStart = startNodeId;
  const remaining = new Set(destinationNodeIds);
  const fullNodes: Node[] = [];
  const fullEdges: AdjacencyEdge[] = [];
  let totalDist = 0;
  let totalW = 0;

  while (remaining.size > 0) {
    let nearestDest: string | null = null;
    let shortestSegment: PathResult | null = null;

    for (const destId of Array.from(remaining)) {
      const seg = findShortestPath(graph, nodeMap, currentStart, destId);
      if (seg) {
        if (!shortestSegment || seg.totalWeight < shortestSegment.totalWeight) {
          shortestSegment = seg;
          nearestDest = destId;
        }
      }
    }

    if (!shortestSegment || !nearestDest) return null;

    if (fullNodes.length === 0) {
      fullNodes.push(...shortestSegment.nodes);
    } else {
      fullNodes.push(...shortestSegment.nodes.slice(1));
    }

    fullEdges.push(...shortestSegment.edges);
    totalDist += shortestSegment.totalDistance;
    totalW += shortestSegment.totalWeight;

    remaining.delete(nearestDest);
    currentStart = nearestDest;
  }

  return {
    nodes: fullNodes,
    edges: fullEdges,
    totalDistance: totalDist,
    totalWeight: totalW,
  };
}

/**
 * Calculates a sequential multi-stop route through an ordered list of waypoint node IDs.
 * Waypoints: [Start, Stop 1, Stop 2, ..., End Destination]
 */
export function findMultiWaypointPath(
  graph: GraphAdjacencyMap,
  nodeMap: Map<string, Node>,
  waypointIds: string[]
): PathResult | null {
  const validWaypoints = waypointIds.filter(Boolean);
  if (validWaypoints.length < 2) return null;

  const fullNodes: Node[] = [];
  const fullEdges: AdjacencyEdge[] = [];
  let totalDist = 0;
  let totalW = 0;

  for (let i = 0; i < validWaypoints.length - 1; i++) {
    const seg = findShortestPath(graph, nodeMap, validWaypoints[i], validWaypoints[i + 1]);
    if (!seg) return null;

    if (i === 0) {
      fullNodes.push(...seg.nodes);
    } else {
      fullNodes.push(...seg.nodes.slice(1));
    }
    fullEdges.push(...seg.edges);
    totalDist += seg.totalDistance;
    totalW += seg.totalWeight;
  }

  return {
    nodes: fullNodes,
    edges: fullEdges,
    totalDistance: totalDist,
    totalWeight: totalW,
  };
}

