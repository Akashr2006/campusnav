import type { Node, Destination } from "@/shared/data/campus";
import { buildAdjacencyGraph, type GraphAdjacencyMap } from "@/lib/routing/graph";
import { findShortestPath, type PathResult } from "@/lib/routing/dijkstra";

export interface RouteVerificationIssue {
  startNodeId: string;
  endNodeId: string;
  startName: string;
  endName: string;
  issueType: "STAIR_HOPPING" | "SUSPICIOUS_DETOUR" | "REPEATED_NODE" | "LOOP_DETECTED";
  message: string;
  actualDistance: number;
  expectedMaxDistance?: number;
}

export interface RouteVerificationReport {
  totalPairsTested: number;
  passedPairs: number;
  failedPairs: number;
  issues: RouteVerificationIssue[];
}

export interface VerificationData {
  nodes: Node[];
  edges: any[];
  destinations: Destination[];
  floors: any[];
}

/**
 * Universal Route Verification Engine
 * Runs automated regression testing across source-destination pairs.
 */
export function verifyRouteSuite(data: VerificationData): RouteVerificationReport {
  const issues: RouteVerificationIssue[] = [];
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const destinations = data.destinations || [];

  if (nodes.length < 2 || edges.length === 0) {
    return {
      totalPairsTested: 0,
      passedPairs: 0,
      failedPairs: 0,
      issues: [],
    };
  }

  const { graph, nodeMap } = buildAdjacencyGraph(nodes, edges, {
    floors: data.floors,
    allowObstaclePenalties: false,
  });

  // Sample destinations and entrance nodes
  const testNodes = nodes.filter(
    (n) =>
      n.type === "ENTRANCE" ||
      n.type === "BUILDING_ENTRANCE" ||
      n.type === "ROOM" ||
      destinations.some((d) => d.nodeId === n.id)
  );

  let totalTested = 0;
  let passed = 0;

  for (let i = 0; i < testNodes.length; i++) {
    for (let j = i + 1; j < testNodes.length; j++) {
      const sNode = testNodes[i];
      const eNode = testNodes[j];
      if (sNode.id === eNode.id) continue;

      totalTested++;
      const res = findShortestPath(graph, nodeMap, sNode.id, eNode.id);
      if (!res) continue;

      // 1. Check for repeated nodes (loops)
      const nodeVisits = new Map<string, number>();
      let hasLoop = false;
      res.nodes.forEach((n) => {
        const count = (nodeVisits.get(n.id) || 0) + 1;
        nodeVisits.set(n.id, count);
        if (count > 1) hasLoop = true;
      });

      if (hasLoop) {
        issues.push({
          startNodeId: sNode.id,
          endNodeId: eNode.id,
          startName: sNode.name || sNode.id,
          endName: eNode.name || eNode.id,
          issueType: "LOOP_DETECTED",
          message: `Route from ${sNode.name || sNode.id} to ${eNode.name || eNode.id} contains repeated node traversal.`,
          actualDistance: res.totalDistance,
        });
        continue;
      }

      // 2. Check for Stair Hopping (switching between multiple distinct stair groups)
      const stairGroupVisits = new Set<string>();
      let stairHopping = false;
      res.edges.forEach((e) => {
        if (e.type === "STAIRS") {
          const fn = nodeMap.get(e.from);
          const groupKey = fn?.stairGroupId || (fn?.name ? fn.name.replace(/\s*\([^)]*\)/g, "").trim() : "");
          if (groupKey) {
            if (stairGroupVisits.size > 0 && !stairGroupVisits.has(groupKey)) {
              stairHopping = true;
            }
            stairGroupVisits.add(groupKey);
          }
        }
      });

      if (stairHopping) {
        issues.push({
          startNodeId: sNode.id,
          endNodeId: eNode.id,
          startName: sNode.name || sNode.id,
          endName: eNode.name || eNode.id,
          issueType: "STAIR_HOPPING",
          message: `Route switches between multiple distinct staircases unnecessarily.`,
          actualDistance: res.totalDistance,
        });
        continue;
      }

      // 3. Check for Suspicious Detours (Euclidean 2D vs Total Distance)
      if (sNode.floorId === eNode.floorId) {
        const straightLine = Math.hypot(sNode.x - eNode.x, sNode.y - eNode.y) / 4;
        if (straightLine > 20 && res.totalDistance > straightLine * 3.5) {
          issues.push({
            startNodeId: sNode.id,
            endNodeId: eNode.id,
            startName: sNode.name || sNode.id,
            endName: eNode.name || eNode.id,
            issueType: "SUSPICIOUS_DETOUR",
            message: `Route distance (${res.totalDistance}m) is over 3.5x straight line distance (${Math.round(straightLine)}m).`,
            actualDistance: res.totalDistance,
            expectedMaxDistance: Math.round(straightLine * 3.5),
          });
          continue;
        }
      }

      passed++;
    }
  }

  return {
    totalPairsTested: totalTested,
    passedPairs: passed,
    failedPairs: issues.length,
    issues,
  };
}
