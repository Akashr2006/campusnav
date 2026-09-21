import type { Node, Edge, Obstacle, Floor, PathType } from "../../shared/data/campus";
import { calculateHaversineDistance } from "../geo/haversine";
import { canvasToGps } from "../geo/projection";
import { canTraverseEdge, getEdgePathType, type TravelMode } from "./edge-accessibility";

export type AdjacencyEdge = {
  edgeId: string;
  from: string;
  to: string;
  type: Edge["type"];
  pathType?: PathType;
  distance: number;
  bidirectional: boolean;
  weight: number;
};

export type GraphAdjacencyMap = Map<string, AdjacencyEdge[]>;



export interface BuildGraphOptions {
  obstacles?: Obstacle[];
  floors?: Floor[];
  activeEdgeIds?: Set<string>;
  allowObstaclePenalties?: boolean;
  travelMode?: TravelMode;
}

export function getObstructedEdgeIds(
  nodes: Node[],
  edges: Edge[],
  obstacles: Obstacle[] = []
): Set<string> {
  const nodeMap = new Map<string, Node>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const activeObstacles = (obstacles ?? []).filter((obs) => {
    if (!obs.expiresAt) return true;
    return new Date(obs.expiresAt).getTime() > Date.now();
  });

  const blockedEdgeIds = new Set<string>();

  edges.forEach((e) => {
    const fromId = e.fromNodeId ?? e.from;
    const toId = e.toNodeId ?? e.to;
    if (!fromId || !toId || !nodeMap.has(fromId) || !nodeMap.has(toId)) return;

    const fromNode = nodeMap.get(fromId)!;
    const toNode = nodeMap.get(toId)!;
    const baseEdgeId = e.id.replace(/_rev$/, "");

    for (const obs of activeObstacles) {
      // 1. Explicit edgeIds match: if specified, ONLY block matching edgeIds and skip spatial check
      if (obs.edgeIds && obs.edgeIds.length > 0) {
        if (
          obs.edgeIds.includes(e.id) ||
          obs.edgeIds.includes(baseEdgeId) ||
          obs.edgeIds.includes(`${baseEdgeId}_rev`)
        ) {
          blockedEdgeIds.add(e.id);
          blockedEdgeIds.add(`${e.id}_rev`);
          break;
        }
        continue; // Skip spatial check if explicit edgeIds are set
      }

      // 2. Spatial area hazard: check radius against line segment
      if (
        obs.floorId &&
        obs.floorId !== "f-out" &&
        fromNode.floorId !== obs.floorId &&
        toNode.floorId !== obs.floorId
      ) {
        continue;
      }

      const radius = obs.radius ?? 20;
      const dx = toNode.x - fromNode.x;
      const dy = toNode.y - fromNode.y;
      const lenSq = dx * dx + dy * dy;
      if (lenSq === 0) {
        // Vertical shaft / coincident nodes: check circular radial distance directly to node point
        const ptDist = Math.hypot(obs.x - fromNode.x, obs.y - fromNode.y);
        if (ptDist <= radius) {
          blockedEdgeIds.add(e.id);
          blockedEdgeIds.add(`${e.id}_rev`);
          break;
        }
        continue;
      }

      let t = ((obs.x - fromNode.x) * dx + (obs.y - fromNode.y) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = fromNode.x + t * dx;
      const projY = fromNode.y + t * dy;
      const dist = Math.hypot(obs.x - projX, obs.y - projY);

      if (dist <= radius) {
        // Endpoint bleed protection: if projection falls near segment ends, require tighter radius
        if ((t < 0.15 || t > 0.85) && dist > radius * 0.5) {
          continue;
        }
        blockedEdgeIds.add(e.id);
        blockedEdgeIds.add(`${e.id}_rev`);
        break;
      }
    }
  });

  return blockedEdgeIds;
}

export function buildAdjacencyGraph(
  nodes: Node[],
  edges: Edge[],
  options: BuildGraphOptions = {}
): { graph: GraphAdjacencyMap; nodeMap: Map<string, Node> } {
  const nodeMap = new Map<string, Node>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const blockedEdgeIds = getObstructedEdgeIds(nodes, edges, options.obstacles ?? []);

  const graph: GraphAdjacencyMap = new Map();
  nodes.forEach((n) => graph.set(n.id, []));

  const travelMode: TravelMode = options.travelMode ?? "WALK";

  // Track directed adjacency entries to avoid duplicates.
  // Key: "fromId->toId" — only skip if the exact same directed link was already added.
  const addedDirected = new Set<string>();

  const addDirectedEdge = (
    from: string,
    to: string,
    edgeId: string,
    type: Edge["type"],
    dist: number,
    weight: number,
    force = false,
    pathType?: PathType
  ) => {
    if (!graph.has(from)) graph.set(from, []);
    if (!graph.has(to)) graph.set(to, []);

    const dirKey = `${from}->${to}:${type}:${dist}:${pathType ?? ""}`;
    if (addedDirected.has(dirKey) && !force) return;
    addedDirected.add(dirKey);

    const adj: AdjacencyEdge = {
      edgeId,
      from,
      to,
      type,
      pathType,
      distance: dist,
      bidirectional: true,
      weight,
    };
    const out = graph.get(from)!;
    const existingIdx = out.findIndex((item) => item.to === to);
    if (existingIdx !== -1) {
      if (!force) {
        out[existingIdx] = adj;
      }
    } else {
      out.push(adj);
    }
  };

  // Helper Floor Ordinals & Stair Canonical Key Normalization
  const floors = options.floors;
  const floorOrdinalMap = new Map<string, number>();
  if (floors && Array.isArray(floors)) {
    floors.forEach((f) => floorOrdinalMap.set(f.id, f.ordinal));
  }

  function getCanonicalStairKey(node: Node): string {
    // 1. stairGroupId (primary)
    if (node.stairGroupId) return `sg_${node.stairGroupId}`;

    // 2. Stable internal connector ID
    const ext = node as Node & { connectorId?: string };
    if (ext.connectorId) return `conn_${ext.connectorId}`;

    // 3. Canonical name (legacy compatibility fallback only)
    const rawName = (node.name || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
    const cleaned = rawName
      .replace(/\b(staircases|staircase|stairs|stair|st)\b/gi, "")
      .replace(/[^a-z0-9]/gi, "")
      .trim();

    if (cleaned.length > 0) {
      return `stair_${cleaned}`;
    }

    if (!rawName) return "";
    return `stair_${rawName.replace(/[\s\-_]+/g, "_")}`;
  }

  function getNodeFloorRank(node: Node): number {
    if (floorOrdinalMap.has(node.floorId)) {
      return floorOrdinalMap.get(node.floorId)!;
    }
    const nameLower = (node.name || "").toLowerCase();
    const fIdLower = (node.floorId || "").toLowerCase();

    if (
      nameLower.includes("ground") ||
      nameLower.includes("gnd") ||
      fIdLower.includes("ground") ||
      fIdLower.endsWith("-g") ||
      fIdLower.endsWith("-gnd") ||
      fIdLower.endsWith("-0")
    ) {
      return 0;
    }

    if (nameLower.includes("base") || fIdLower.includes("base") || fIdLower.includes("b-")) {
      return -1;
    }

    const floorMatch = nameLower.match(/(?:floor|fl|f)\s*(\d+)/i) || fIdLower.match(/(?:floor|fl|f|-)\s*(\d+)/i);
    if (floorMatch) {
      return parseInt(floorMatch[1], 10);
    }

    return 0;
  }

  edges.forEach((e) => {
    const fromId = e.fromNodeId ?? e.from;
    const toId = e.toNodeId ?? e.to;

    // Ignore edges with invalid or non-existent nodes
    if (!fromId || !toId || !nodeMap.has(fromId) || !nodeMap.has(toId)) return;

    const fn = nodeMap.get(fromId)!;
    const tn = nodeMap.get(toId)!;

    // Exclude explicitly closed edges (runtime-only extended fields)
    const extEdge = e as Edge & { closed?: boolean; closedUntil?: string | Date; speedModifier?: number };
    if (extEdge.closed) return;
    if (extEdge.closedUntil && new Date(extEdge.closedUntil).getTime() > Date.now()) return;

    // Check if edge or its reverse twin is blocked by an obstacle
    const isBlocked =
      blockedEdgeIds.has(e.id) ||
      blockedEdgeIds.has(`${e.id}_rev`) ||
      (e.id.endsWith("_rev") && blockedEdgeIds.has(e.id.replace(/_rev$/, ""))) ||
      blockedEdgeIds.has(`e-${toId}-${fromId}`);

    if (isBlocked && !options.allowObstaclePenalties) {
      return;
    }

    // Type penalty: very small for stairs/lifts so direct stair routes are always preferred
    let modePenalty = 0;
    if (e.type === "STAIRS") modePenalty = 2;
    if (e.type === "LIFT") modePenalty = 1;

    // Filter out direct non-adjacent multi-floor stair shortcuts (e.g. Ground -> Floor 2 directly)
    if (e.type === "STAIRS") {
      const rankA = getNodeFloorRank(fn);
      const rankB = getNodeFloorRank(tn);
      if (Math.abs(rankA - rankB) > 1) {
        return; // Skip direct non-adjacent jump; sequential floor-by-floor stair builder below handles r -> r+1 -> r+2
      }
    }

    // Exclude edges not traversable in current travel mode (e.g. EV cannot traverse Only Walk Path)
    if (!canTraverseEdge(e, travelMode)) {
      return;
    }

    const isVerticalTransition = e.type === "STAIRS" || e.type === "LIFT" || (fn && tn && fn.floorId !== tn.floorId);

    let computedDist = 0;
    if (typeof e.distance === "number" && e.distance > 0) {
      computedDist = e.distance;
    } else if (isVerticalTransition) {
      // Vertical transitions across floors default to 15m if no explicit distance provided
      computedDist = 15;
    } else if (fn && tn) {
      const fnGps = fn.lat && fn.lng ? { lat: fn.lat, lng: fn.lng } : canvasToGps(fn.x, fn.y);
      const tnGps = tn.lat && tn.lng ? { lat: tn.lat, lng: tn.lng } : canvasToGps(tn.x, tn.y);
      computedDist = calculateHaversineDistance(fnGps.lat, fnGps.lng, tnGps.lat, tnGps.lng);
    }

    const dist = Math.max(1, Math.round(computedDist || 1));
    const weight = Math.max(1, dist * (extEdge.speedModifier ?? 1.0) + modePenalty);
    const edgePathType = getEdgePathType(e);

    // ALWAYS add both forward AND backward — every campus edge is walkable in both directions
    addDirectedEdge(fromId, toId, e.id, e.type, dist, weight, false, edgePathType);
    addDirectedEdge(toId, fromId, `${e.id}_rev`, e.type, dist, weight, false, edgePathType);
  });

  // Ensure consecutive vertical STAIRS edges link stair nodes in exact floor order
  const stairGroupNodesMap = new Map<string, Node[]>();

  // 1. Group by explicit stairGroupId or canonical normalized stair key
  nodes.forEach((n) => {
    if (n.type === "STAIR" || n.stairGroupId) {
      const baseKey = getCanonicalStairKey(n);
      if (baseKey) {
        const list = stairGroupNodesMap.get(baseKey) || [];
        list.push(n);
        stairGroupNodesMap.set(baseKey, list);
      }
    }
  });

  // 2. Spatial proximity fallback: merge stair nodes on different floors within 150px 2D distance column
  const allStairNodes = nodes.filter((n) => n.type === "STAIR" || n.stairGroupId);
  for (let i = 0; i < allStairNodes.length; i++) {
    for (let j = i + 1; j < allStairNodes.length; j++) {
      const n1 = allStairNodes[i];
      const n2 = allStairNodes[j];
      if (n1.floorId === n2.floorId) continue;

      const dist2D = Math.hypot(n1.x - n2.x, n1.y - n2.y);
      if (dist2D <= 150) {
        const k1 = getCanonicalStairKey(n1) || `pos_${Math.round(n1.x / 40)}_${Math.round(n1.y / 40)}`;
        const k2 = getCanonicalStairKey(n2) || `pos_${Math.round(n2.x / 40)}_${Math.round(n2.y / 40)}`;
        if (k1 && k2 && k1 !== k2) {
          const list1 = stairGroupNodesMap.get(k1) || [n1];
          const list2 = stairGroupNodesMap.get(k2) || [n2];
          const merged = Array.from(new Set([...list1, ...list2]));
          stairGroupNodesMap.set(k1, merged);
          stairGroupNodesMap.delete(k2);
        }
      }
    }
  }

  stairGroupNodesMap.forEach((groupNodes) => {
    if (groupNodes.length >= 1) {
      groupNodes.sort((a, b) => getNodeFloorRank(a) - getNodeFloorRank(b));

      const minRank = getNodeFloorRank(groupNodes[0]);
      const maxRank = getNodeFloorRank(groupNodes[groupNodes.length - 1]);

      const sequentialNodes: Node[] = [];
      for (let r = minRank; r <= maxRank; r++) {
        let nodeOnRank = groupNodes.find((n) => getNodeFloorRank(n) === r);
        if (!nodeOnRank) {
          const targetFloor = floors?.find((f) => f.ordinal === r);
          const refNode = groupNodes[0];
          const virtualId = `stair-auto-inter-${refNode.id}-r${r}`;
          nodeOnRank = nodeMap.get(virtualId);
          if (!nodeOnRank) {
            nodeOnRank = {
              id: virtualId,
              type: "STAIR",
              name: `${refNode.name || "Stairs"} (Floor ${r})`,
              floorId: targetFloor?.id ?? `f-auto-r${r}`,
              x: refNode.x,
              y: refNode.y,
            };
            nodeMap.set(virtualId, nodeOnRank);
            if (!graph.has(virtualId)) graph.set(virtualId, []);
          }
        }
        sequentialNodes.push(nodeOnRank);
      }

      if (travelMode === "WALK") {
        for (let i = 0; i < sequentialNodes.length - 1; i++) {
          const fn = sequentialNodes[i];
          const tn = sequentialNodes[i + 1];
          if (fn.floorId !== tn.floorId) {
            const autoStairEdgeId = `e-stair-seq-${fn.id}-${tn.id}`;
            const dist = 15;
            const weight = 17; // 15m + 2 penalty for STAIRS
            addDirectedEdge(fn.id, tn.id, autoStairEdgeId, "STAIRS", dist, weight, true, "WALK");
            addDirectedEdge(tn.id, fn.id, `${autoStairEdgeId}_rev`, "STAIRS", dist, weight, true, "WALK");
          }
        }
      }
    }
  });

  // Auto-Bridge Isolated / Unconnected Nodes to Nearest Adjacent Node on same floor/campus
  if (travelMode === "WALK") {
    nodes.forEach((n) => {
      const currentEdges = graph.get(n.id) || [];
      if (currentEdges.length === 0) {
        // Find nearest candidate nodes on same floor or outdoor
        const candidates = nodes.filter((m) => {
          if (m.id === n.id) return false;
          const sameFloor = m.floorId === n.floorId;
          const bothGroundOrOutdoor =
            (m.floorId === "f-out" || m.floorId === "outdoor" || getNodeFloorRank(m) === 0) &&
            (n.floorId === "f-out" || n.floorId === "outdoor" || getNodeFloorRank(n) === 0);
          return sameFloor || bothGroundOrOutdoor;
        });

        const pool = candidates.length > 0 ? candidates : nodes.filter((m) => m.id !== n.id);
        if (pool.length > 0) {
          const sorted = pool
            .map((m) => {
              const dist = Math.hypot(m.x - n.x, m.y - n.y);
              return { node: m, dist };
            })
            .sort((a, b) => a.dist - b.dist);

          const nearestNeighbors = sorted.slice(0, 1);
          nearestNeighbors.forEach(({ node: target, dist: canvasDist }) => {
            const nGps = n.lat && n.lng ? { lat: n.lat, lng: n.lng } : canvasToGps(n.x, n.y);
            const tGps = target.lat && target.lng ? { lat: target.lat, lng: target.lng } : canvasToGps(target.x, target.y);
            const geoDist = calculateHaversineDistance(nGps.lat, nGps.lng, tGps.lat, tGps.lng);
            const dist = Math.max(1, Math.round(geoDist || canvasDist / 10 || 5));
            const bridgeId = `e-auto-bridge-${n.id}-${target.id}`;

            addDirectedEdge(n.id, target.id, bridgeId, "WALK", dist, dist, true, "WALK");
            addDirectedEdge(target.id, n.id, `${bridgeId}_rev`, "WALK", dist, dist, true, "WALK");
          });
        }
      }
    });
  }

  return { graph, nodeMap };
}

export function optimizeMultiStopRoute(
  graph: GraphAdjacencyMap,
  nodeMap: Map<string, Node>,
  startNodeId: string,
  intermediateNodeIds: string[],
  endNodeId?: string
): string[] {
  if (intermediateNodeIds.length <= 1) {
    return [startNodeId, ...intermediateNodeIds, ...(endNodeId ? [endNodeId] : [])];
  }

  // Nearest Neighbor TSP heuristic for multi-stop order optimization
  const unvisited = [...intermediateNodeIds];
  const ordered: string[] = [startNodeId];
  let current = startNodeId;

  while (unvisited.length > 0) {
    let nearestIdx = 0;
    let minDistance = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const target = unvisited[i];
      const fromN = nodeMap.get(current);
      const toN = nodeMap.get(target);
      const dist = fromN && toN ? Math.hypot(fromN.x - toN.x, fromN.y - toN.y) : 100;
      if (dist < minDistance) {
        minDistance = dist;
        nearestIdx = i;
      }
    }

    current = unvisited[nearestIdx];
    ordered.push(current);
    unvisited.splice(nearestIdx, 1);
  }

  if (endNodeId) {
    ordered.push(endNodeId);
  }

  return ordered;
}
