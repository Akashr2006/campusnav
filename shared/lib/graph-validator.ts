import type { Node, Edge, Floor, StairGroup, LiftGroup, Destination, Building, Obstacle } from "@/shared/data/campus";

export type IssueSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export type IssueType =
  | "ISOLATED_STAIR_LANDING"
  | "SKIPPED_STAIR_FLOOR"
  | "UNREACHABLE_DESTINATION"
  | "UNREACHABLE_ENTRANCE"
  | "UNEXPECTED_DISCONNECTED_SUBGRAPH"
  | "MISSING_REVERSE_EDGE"
  | "DUPLICATE_EDGE"
  | "INVALID_WEIGHT"
  | "ZERO_DISTANCE_EDGE"
  | "ISOLATED_NODE";

export interface GraphIssue {
  id: string;
  type: IssueType;
  severity: IssueSeverity;
  title: string;
  description: string;
  affectedNodeIds: string[];
  affectedEdgeIds: string[];
  recommendation: string;
}

export interface ConnectedComponent {
  componentId: number;
  nodeCount: number;
  nodeIds: string[];
  isMainComponent: boolean;
  isIntentionallyIsolated?: boolean;
}

export interface GraphHealthReport {
  healthScore: number; // 0% - 100%
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  canPublish: boolean;
  connectedComponents: ConnectedComponent[];
  issues: GraphIssue[];
}

export interface CampusGraphData {
  nodes: Node[];
  edges: Edge[];
  floors: Floor[];
  buildings: Building[];
  destinations: Destination[];
  stairGroups?: StairGroup[];
  liftGroups?: LiftGroup[];
  obstacles?: Obstacle[];
}

/**
 * Universal Graph Validator Engine
 * Performs comprehensive analysis without mutating raw graph topology.
 */
export function validateCampusGraph(data: CampusGraphData): GraphHealthReport {
  const issues: GraphIssue[] = [];
  const nodes = data.nodes || [];
  const edges = data.edges || [];
  const floors = data.floors || [];
  const destinations = data.destinations || [];

  const nodeMap = new Map<string, Node>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  // Build Adjacency Map for Validation
  const adjMap = new Map<string, string[]>();
  nodes.forEach((n) => adjMap.set(n.id, []));

  const edgePairs = new Map<string, Edge[]>();

  edges.forEach((e) => {
    const fromId = e.fromNodeId ?? e.from;
    const toId = e.toNodeId ?? e.to;
    if (fromId && toId && nodeMap.has(fromId) && nodeMap.has(toId)) {
      adjMap.get(fromId)?.push(toId);
      if (e.bidirectional) {
        adjMap.get(toId)?.push(fromId);
      }

      const pairKey = [fromId, toId].sort().join("->");
      const list = edgePairs.get(pairKey) || [];
      list.push(e);
      edgePairs.set(pairKey, list);
    }
  });

  // 1. Connected Components Validation (BFS)
  const visited = new Set<string>();
  const components: ConnectedComponent[] = [];
  let compId = 0;

  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      compId++;
      const compNodes: string[] = [];
      const queue = [n.id];
      visited.add(n.id);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        compNodes.push(curr);
        const neighbors = adjMap.get(curr) || [];
        neighbors.forEach((nbr) => {
          if (!visited.has(nbr)) {
            visited.add(nbr);
            queue.push(nbr);
          }
        });
      }

      components.push({
        componentId: compId,
        nodeCount: compNodes.length,
        nodeIds: compNodes,
        isMainComponent: false,
      });
    }
  });

  // Sort components by size descending
  components.sort((a, b) => b.nodeCount - a.nodeCount);
  if (components.length > 0) {
    components[0].isMainComponent = true;
  }

  // Flag unexpected disconnected subgraphs (>1 component, non-main components)
  for (let i = 1; i < components.length; i++) {
    const comp = components[i];
    // Check if component nodes are intentionally isolated (e.g. PARKING, OUTDOOR_ISOLATED)
    const isIntentional = comp.nodeIds.every((nId) => {
      const node = nodeMap.get(nId);
      return node && (node.type === "PARKING" || node.type === "OUTDOOR");
    });

    if (!isIntentional && comp.nodeCount > 0) {
      issues.push({
        id: `issue-comp-${comp.componentId}`,
        type: "UNEXPECTED_DISCONNECTED_SUBGRAPH",
        severity: comp.nodeCount > 5 ? "CRITICAL" : "HIGH",
        title: `Disconnected Subgraph Fragment #${comp.componentId}`,
        description: `Found isolated subgraph of ${comp.nodeCount} node(s) detached from the main campus network.`,
        affectedNodeIds: comp.nodeIds,
        affectedEdgeIds: [],
        recommendation: "Connect this node cluster to the primary corridor or outdoor network.",
      });
    }
  }

  // 2. Stair & Lift Grouping & Horizontal Landing Validation
  const stairNodes = nodes.filter((n) => n.type === "STAIR" || n.stairGroupId);

  stairNodes.forEach((stairNode) => {
    // Check horizontal same-floor walkable connections
    const neighbors = adjMap.get(stairNode.id) || [];
    const hasSameFloorLink = neighbors.some((nbrId) => {
      const nbr = nodeMap.get(nbrId);
      return nbr && nbr.floorId === stairNode.floorId;
    });

    if (!hasSameFloorLink) {
      issues.push({
        id: `issue-stair-isolated-${stairNode.id}`,
        type: "ISOLATED_STAIR_LANDING",
        severity: "CRITICAL",
        title: `Isolated Stair Landing: ${stairNode.name || stairNode.id}`,
        description: `Stair node on floor ${stairNode.floorId} has no horizontal walking connection to any floor corridor node.`,
        affectedNodeIds: [stairNode.id],
        affectedEdgeIds: [],
        recommendation: "Draw a connecting corridor edge between this stair node and the floor hallway.",
      });
    }
  });

  // 3. Edge Validation: Duplicate Edges & Missing Reverse Edges & Invalid Weights
  edgePairs.forEach((pairEdges) => {
    if (pairEdges.length > 1) {
      // Check for true duplicates (same from, to, type, distance)
      const seen = new Set<string>();
      pairEdges.forEach((e) => {
        const sig = `${e.from}->${e.to}:${e.type}:${e.distance}`;
        if (seen.has(sig)) {
          issues.push({
            id: `issue-dup-edge-${e.id}`,
            type: "DUPLICATE_EDGE",
            severity: "LOW",
            title: `Duplicate Edge Detected: ${e.id}`,
            description: `Multiple identical edges exist between node ${e.from} and ${e.to}.`,
            affectedNodeIds: [e.from, e.to],
            affectedEdgeIds: [e.id],
            recommendation: "Duplicate edge will be automatically pruned during graph construction.",
          });
        } else {
          seen.add(sig);
        }
      });
    }
  });

  edges.forEach((e) => {
    if (typeof e.distance === "number" && e.distance <= 0) {
      issues.push({
        id: `issue-zero-dist-${e.id}`,
        type: "ZERO_DISTANCE_EDGE",
        severity: "HIGH",
        title: `Zero/Negative Distance Edge: ${e.id}`,
        description: `Edge has invalid distance of ${e.distance}m.`,
        affectedNodeIds: [e.from, e.to],
        affectedEdgeIds: [e.id],
        recommendation: "Set a valid positive distance for this edge.",
      });
    }

    if (e.type === "STAIRS" || e.type === "LIFT") {
      const fromNode = nodeMap.get(e.from);
      const toNode = nodeMap.get(e.to);
      if (fromNode && toNode && e.bidirectional) {
        const hasReverse = edges.some(
          (rev) => rev.from === e.to && rev.to === e.from
        );
        if (!hasReverse) {
          issues.push({
            id: `issue-missing-rev-${e.id}`,
            type: "MISSING_REVERSE_EDGE",
            severity: "MEDIUM",
            title: `Missing Reverse Twin for Vertical Edge: ${e.id}`,
            description: `Vertical transition from ${e.from} to ${e.to} lacks a matching reverse edge twin.`,
            affectedNodeIds: [e.from, e.to],
            affectedEdgeIds: [e.id],
            recommendation: "Ensure bidirectional reverse edge is generated.",
          });
        }
      }
    }
  });

  // 4. Reachability Validation (Entrances -> Public Destinations)
  const entrances = nodes.filter(
    (n) => n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode
  );
  if (entrances.length > 0 && destinations.length > 0) {
    const reachableFromEntrances = new Set<string>();

    entrances.forEach((ent) => {
      const q = [ent.id];
      const seen = new Set<string>([ent.id]);
      while (q.length > 0) {
        const curr = q.shift()!;
        reachableFromEntrances.add(curr);
        (adjMap.get(curr) || []).forEach((nbr) => {
          if (!seen.has(nbr)) {
            seen.add(nbr);
            q.push(nbr);
          }
        });
      }
    });

    destinations.forEach((dest) => {
      if (dest.nodeId && nodeMap.has(dest.nodeId)) {
        if (!reachableFromEntrances.has(dest.nodeId)) {
          issues.push({
            id: `issue-unreachable-dest-${dest.id}`,
            type: "UNREACHABLE_DESTINATION",
            severity: "CRITICAL",
            title: `Unreachable Destination: ${dest.name}`,
            description: `Destination "${dest.name}" cannot be reached from any campus entrance node.`,
            affectedNodeIds: [dest.nodeId],
            affectedEdgeIds: [],
            recommendation: "Verify hallway connections from building entrances to this destination.",
          });
        }
      }
    });
  }

  // Calculate Health Metrics & Score
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  issues.forEach((iss) => {
    if (iss.severity === "CRITICAL") criticalCount++;
    if (iss.severity === "HIGH") highCount++;
    if (iss.severity === "MEDIUM") mediumCount++;
    if (iss.severity === "LOW") lowCount++;
  });

  const penalty =
    criticalCount * 25 + highCount * 10 + mediumCount * 5 + lowCount * 2;
  const healthScore = Math.max(0, 100 - penalty);
  const canPublish = criticalCount === 0;

  return {
    healthScore,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    canPublish,
    connectedComponents: components,
    issues,
  };
}
