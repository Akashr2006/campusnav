import { prisma } from "../../../lib/db";
import { getActivePublishedGraph } from "../../../lib/services/publish-service";

export interface NavigationPoint {
  lat: number;
  lng: number;
  floorId?: string;
}

export interface RouteRequest {
  fromNodeId?: string;
  toNodeId?: string;
  startPoint?: NavigationPoint;
  endPoint?: NavigationPoint;
  accessibleOnly?: boolean;
  maxWalkingDistance?: number;
  travelMode?: "WALK" | "EV";
}

export interface RouteStep {
  instruction: string;
  distance: number;
  type: "STRAIGHT" | "TURN_LEFT" | "TURN_RIGHT" | "SLIGHT_LEFT" | "SLIGHT_RIGHT" | "U_TURN" | "STAIRS" | "ELEVATOR" | "ARRIVE";
  fromNodeId: string;
  toNodeId: string;
  floorId?: string;
}

export interface RouteResult {
  success: boolean;
  totalDistance: number;
  estimatedTimeSeconds: number;
  nodes: Array<{ id: string; name?: string; x: number; y: number; lat?: number; lng?: number; floorId?: string }>;
  edges: Array<{ id: string; from: string; to: string; distance: number; type?: string }>;
  steps: RouteStep[];
  error?: string;
}

/**
 * Service handling campus pathfinding, routing calculations, and navigation steps.
 */
export class NavigationService {
  /**
   * Calculates shortest path route between two nodes or GPS points.
   */
  static async calculateRoute(request: RouteRequest): Promise<RouteResult> {
    try {
      const activeGraph = await getActivePublishedGraph(true);
      const snapshot = activeGraph?.snapshot || { nodes: [], edges: [], buildings: [], floors: [] };
      const nodes = snapshot.nodes || [];
      const edges = snapshot.edges || [];

      if (nodes.length === 0) {
        return {
          success: false,
          totalDistance: 0,
          estimatedTimeSeconds: 0,
          nodes: [],
          edges: [],
          steps: [],
          error: "Campus graph contains no nodes for navigation.",
        };
      }

      // 1. Resolve start node
      let startId = request.fromNodeId;
      if (!startId && request.startPoint) {
        const nearest = this.findNearestNode(request.startPoint, nodes);
        if (nearest) startId = nearest.id;
      }

      // 2. Resolve end node
      let endId = request.toNodeId;
      if (!endId && request.endPoint) {
        const nearest = this.findNearestNode(request.endPoint, nodes);
        if (nearest) endId = nearest.id;
      }

      if (!startId || !endId) {
        return {
          success: false,
          totalDistance: 0,
          estimatedTimeSeconds: 0,
          nodes: [],
          edges: [],
          steps: [],
          error: "Invalid start or destination node.",
        };
      }

      if (startId === endId) {
        const nodeObj = nodes.find((n) => n.id === startId);
        return {
          success: true,
          totalDistance: 0,
          estimatedTimeSeconds: 0,
          nodes: nodeObj ? [nodeObj] : [],
          edges: [],
          steps: [
            {
              instruction: "You are already at your destination.",
              distance: 0,
              type: "ARRIVE",
              fromNodeId: startId,
              toNodeId: endId,
            },
          ],
        };
      }

      // 3. Filter accessible edges if requested
      const validEdges = request.accessibleOnly
        ? edges.filter((e) => e.type !== "STAIRS" && (e.pathType as string) !== "STAIRS")
        : edges;

      // 4. Run Dijkstra Pathfinding
      let pathResult = this.dijkstra(startId, endId, nodes, validEdges);

      if (request.travelMode === "EV") {
        const evEdges = validEdges.filter((e) => (e.pathType === "EV" || e.type === "ROAD"));
        const directEvResult = this.dijkstra(startId, endId, nodes, evEdges);
        if (directEvResult && directEvResult.pathNodes.length > 0) {
          pathResult = directEvResult;
        } else {
          // Multimodal EV + Walk
          const evNodeIds = new Set<string>();
          evEdges.forEach((e) => {
            evNodeIds.add(e.from);
            evNodeIds.add(e.to);
          });

          if (evNodeIds.size > 0) {
            let bestTransfer: { pStart: string; pEnd: string; totalCost: number } | null = null;
            const evNodeArr = Array.from(evNodeIds);
            const startEvs = evNodeIds.has(startId) ? [startId] : evNodeArr;
            const endEvs = evNodeIds.has(endId) ? [endId] : evNodeArr;

            for (const pStart of startEvs) {
              const dWalkStart = pStart === startId ? 0 : (this.dijkstra(startId, pStart, nodes, validEdges)?.totalDistance ?? Infinity);
              if (dWalkStart === Infinity) continue;

              for (const pEnd of endEvs) {
                const dWalkEnd = pEnd === endId ? 0 : (this.dijkstra(pEnd, endId, nodes, validEdges)?.totalDistance ?? Infinity);
                if (dWalkEnd === Infinity) continue;

                const dEv = pStart === pEnd ? 0 : (this.dijkstra(pStart, pEnd, nodes, evEdges)?.totalDistance ?? Infinity);
                if (dEv === Infinity) continue;

                const cost = (dWalkStart + dWalkEnd) / 1.3 + dEv / 5.5;
                if (!bestTransfer || cost < bestTransfer.totalCost) {
                  bestTransfer = { pStart, pEnd, totalCost: cost };
                }
              }
            }

            if (bestTransfer) {
              const seg1 = bestTransfer.pStart === startId ? null : this.dijkstra(startId, bestTransfer.pStart, nodes, validEdges);
              const seg2 = bestTransfer.pStart === bestTransfer.pEnd ? null : this.dijkstra(bestTransfer.pStart, bestTransfer.pEnd, nodes, evEdges);
              const seg3 = bestTransfer.pEnd === endId ? null : this.dijkstra(bestTransfer.pEnd, endId, nodes, validEdges);

              const stitchedNodes: Array<{ id: string; name?: string; x: number; y: number; lat?: number; lng?: number; floorId?: string }> = [];
              const stitchedEdges: Array<{ id: string; from: string; to: string; distance: number; type?: string }> = [];

              [seg1, seg2, seg3].forEach((seg) => {
                if (!seg) return;
                seg.pathNodes.forEach((n) => {
                  if (stitchedNodes.length === 0 || stitchedNodes[stitchedNodes.length - 1].id !== n.id) {
                    stitchedNodes.push(n);
                  }
                });
                stitchedEdges.push(...seg.pathEdges);
              });

              if (stitchedNodes.length > 0) {
                pathResult = {
                  pathNodes: stitchedNodes,
                  pathEdges: stitchedEdges,
                  totalDistance: stitchedEdges.reduce((acc, e) => acc + e.distance, 0),
                };
              }
            }
          }
        }
      }

      if (!pathResult || pathResult.pathNodes.length === 0) {
        return {
          success: false,
          totalDistance: 0,
          estimatedTimeSeconds: 0,
          nodes: [],
          edges: [],
          steps: [],
          error: "No navigation path found between the selected points.",
        };
      }

      const pathNodes = pathResult.pathNodes;
      const pathEdges = pathResult.pathEdges;
      const totalDistance = Math.round(pathResult.totalDistance);
      const estimatedTimeSeconds = Math.ceil(totalDistance / 1.35);

      const steps = this.generateNavigationSteps(pathNodes, pathEdges);

      return {
        success: true,
        totalDistance,
        estimatedTimeSeconds,
        nodes: pathNodes,
        edges: pathEdges,
        steps,
      };
    } catch (err: unknown) {
      console.error("[NavigationService] Route calculation error:", err);
      return {
        success: false,
        totalDistance: 0,
        estimatedTimeSeconds: 0,
        nodes: [],
        edges: [],
        steps: [],
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Finds the nearest node to a given GPS coordinate point.
   */
  static findNearestNode(
    point: NavigationPoint,
    nodes: Array<{ id: string; lat?: number; lng?: number; x: number; y: number; floorId?: string }>
  ) {
    let bestNode = null;
    let minDistance = Infinity;

    for (const n of nodes) {
      if (point.floorId && n.floorId && point.floorId !== n.floorId) {
        continue;
      }
      let dist = Infinity;
      if (point.lat && point.lng && n.lat && n.lng) {
        dist = this.haversineDistance(point.lat, point.lng, n.lat, n.lng);
      } else {
        const dx = point.lat - n.x;
        const dy = point.lng - n.y;
        dist = Math.sqrt(dx * dx + dy * dy);
      }

      if (dist < minDistance) {
        minDistance = dist;
        bestNode = n;
      }
    }

    return bestNode || nodes[0] || null;
  }

  /**
   * Dijkstra shortest path algorithm implementation.
   */
  private static dijkstra(
    startId: string,
    endId: string,
    nodes: any[],
    edges: any[]
  ) {
    const nodeMap = new Map<string, any>();
    nodes.forEach((n) => nodeMap.set(n.id, n));

    const adj = new Map<string, Array<{ to: string; dist: number; edge: any }>>();
    nodes.forEach((n) => adj.set(n.id, []));

    edges.forEach((e) => {
      const from = e.fromNodeId || e.from;
      const to = e.toNodeId || e.to;
      const dist = typeof e.distance === "number" && !isNaN(e.distance) ? e.distance : 1;

      if (adj.has(from) && adj.has(to)) {
        adj.get(from)!.push({ to, dist, edge: e });
        if (e.bidirectional !== false) {
          adj.get(to)!.push({ to: from, dist, edge: e });
        }
      }
    });

    const distances = new Map<string, number>();
    const previous = new Map<string, { node: string; edge: any } | null>();
    const unvisited = new Set<string>();

    nodes.forEach((n) => {
      distances.set(n.id, Infinity);
      previous.set(n.id, null);
      unvisited.add(n.id);
    });

    distances.set(startId, 0);

    while (unvisited.size > 0) {
      let currentId: string | null = null;
      let smallestDist = Infinity;

      for (const id of unvisited) {
        const d = distances.get(id)!;
        if (d < smallestDist) {
          smallestDist = d;
          currentId = id;
        }
      }

      if (!currentId || smallestDist === Infinity) break;
      if (currentId === endId) break;

      unvisited.delete(currentId);

      const neighbors = adj.get(currentId) || [];
      for (const neighbor of neighbors) {
        if (!unvisited.has(neighbor.to)) continue;

        const alt = distances.get(currentId)! + neighbor.dist;
        if (alt < distances.get(neighbor.to)!) {
          distances.set(neighbor.to, alt);
          previous.set(neighbor.to, { node: currentId, edge: neighbor.edge });
        }
      }
    }

    if (distances.get(endId) === Infinity) {
      return null;
    }

    const pathNodes: any[] = [];
    const pathEdges: any[] = [];
    let curr: string | null = endId;

    while (curr) {
      const nObj = nodeMap.get(curr);
      if (nObj) pathNodes.unshift(nObj);

      const prev = previous.get(curr);
      if (prev) {
        pathEdges.unshift(prev.edge);
        curr = prev.node;
      } else {
        curr = null;
      }
    }

    return {
      pathNodes,
      pathEdges,
      totalDistance: distances.get(endId)!,
    };
  }

  /**
   * Generates step-by-step guidance instructions.
   */
  private static generateNavigationSteps(nodes: any[], edges: any[]): RouteStep[] {
    const steps: RouteStep[] = [];
    if (nodes.length < 2) return steps;

    for (let i = 0; i < nodes.length - 1; i++) {
      const from = nodes[i];
      const to = nodes[i + 1];
      const edge = edges[i] || {};
      const dist = Math.round(edge.distance || 1);

      let type: RouteStep["type"] = "STRAIGHT";
      let text = `Walk ${dist}m towards ${to.name || "next point"}.`;

      if (edge.type === "STAIRS" || edge.pathType === "STAIRS") {
        type = "STAIRS";
        text = `Take stairs to floor ${to.floorId || "target level"}.`;
      } else if (edge.type === "ELEVATOR" || edge.pathType === "ELEVATOR") {
        type = "ELEVATOR";
        text = `Take elevator to floor ${to.floorId || "target level"}.`;
      } else if (i === nodes.length - 2) {
        type = "ARRIVE";
        text = `Arrive at ${to.name || "your destination"}.`;
      }

      steps.push({
        instruction: text,
        distance: dist,
        type,
        fromNodeId: from.id,
        toNodeId: to.id,
        floorId: from.floorId,
      });
    }

    return steps;
  }

  /**
   * Computes Haversine distance in meters between two lat/lng coordinates.
   */
  private static haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}
