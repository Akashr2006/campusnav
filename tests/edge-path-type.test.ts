import { describe, it, expect, beforeEach } from "vitest";
import {
  canTraverseEdge,
  getEdgePathType,
  isEVAllowed,
  isWalkable,
  getPathTypeLabel,
  type TravelMode,
} from "../lib/routing/edge-accessibility";
import { buildAdjacencyGraph } from "../lib/routing/graph";
import { findShortestPath } from "../lib/routing/dijkstra";
import { shortestPath } from "../features/navigation/services/graph";
import { campusStore } from "../shared/lib/campus-store";
import type { Node, Edge } from "../shared/data/campus";

describe("Edge Path-Type Accessibility Engine", () => {
  it("correctly determines canonical path types and fallbacks", () => {
    expect(getEdgePathType({ pathType: "EV" })).toBe("EV");
    expect(getEdgePathType({ pathType: "WALK" })).toBe("WALK");

    // Backward-compatible legacy fallback
    expect(getEdgePathType({ type: "ROAD" })).toBe("EV");
    expect(getEdgePathType({ type: "WALK" })).toBe("WALK");
    expect(getEdgePathType({ type: "STAIRS" })).toBe("WALK");
    expect(getEdgePathType({ type: "LIFT" })).toBe("WALK");
  });

  it("evaluates isEVAllowed strictly", () => {
    expect(isEVAllowed({ pathType: "EV" })).toBe(true);
    expect(isEVAllowed({ pathType: "WALK" })).toBe(false);
    expect(isEVAllowed({ type: "ROAD" })).toBe(true);
    expect(isEVAllowed({ type: "WALK" })).toBe(false);
  });

  it("evaluates isWalkable as true for both EV Path and Only Walk Path", () => {
    expect(isWalkable({ pathType: "EV" })).toBe(true);
    expect(isWalkable({ pathType: "WALK" })).toBe(true);
  });

  it("enforces canTraverseEdge semantics for Walking vs EV", () => {
    const evEdge = { pathType: "EV" as const };
    const walkEdge = { pathType: "WALK" as const };
    const closedEdge = { pathType: "EV" as const, closed: true };

    // Walk mode: both EV Path and Only Walk Path allowed
    expect(canTraverseEdge(evEdge, "WALK")).toBe(true);
    expect(canTraverseEdge(walkEdge, "WALK")).toBe(true);

    // EV mode: only EV Path allowed, WALK-only blocked
    expect(canTraverseEdge(evEdge, "EV")).toBe(true);
    expect(canTraverseEdge(walkEdge, "EV")).toBe(false);

    // Closed edge: blocked for all
    expect(canTraverseEdge(closedEdge, "WALK")).toBe(false);
    expect(canTraverseEdge(closedEdge, "EV")).toBe(false);
  });

  it("returns human-readable labels and descriptions", () => {
    const evInfo = getPathTypeLabel("EV");
    expect(evInfo.label).toBe("EV Path");
    expect(evInfo.isEVAllowed).toBe(true);
    expect(evInfo.isWalkable).toBe(true);

    const walkInfo = getPathTypeLabel("WALK");
    expect(walkInfo.label).toBe("Only Walk Path");
    expect(walkInfo.isEVAllowed).toBe(false);
    expect(walkInfo.isWalkable).toBe(true);
  });
});

describe("Routing Engine with Travel Modes (Walking vs EV)", () => {
  const nodes: Node[] = [
    { id: "A", name: "Main Gate", floorId: "f-out", type: "ENTRANCE", x: 0, y: 0, lat: 11.0, lng: 77.0 },
    { id: "B", name: "Footpath Junction", floorId: "f-out", type: "JUNCTION", x: 50, y: 0, lat: 11.0001, lng: 77.0 },
    { id: "C", name: "Library", floorId: "f-out", type: "DESTINATION_NODE", x: 100, y: 0, lat: 11.0002, lng: 77.0 },
    { id: "D", name: "Perimeter Ring Road", floorId: "f-out", type: "ROAD_JUNCTION", x: 50, y: 100, lat: 11.0001, lng: 77.001 },
  ];

  // A -> B -> C (Direct short path, 50m + 50m = 100m, but B -> C is WALK ONLY)
  // A -> D -> C (Longer detour ring road, 80m + 80m = 160m, all EV PATH)
  const edges: Edge[] = [
    { id: "e-AB", from: "A", to: "B", type: "ROAD", pathType: "EV", distance: 50, bidirectional: true },
    { id: "e-BC", from: "B", to: "C", type: "WALK", pathType: "WALK", distance: 50, bidirectional: true },
    { id: "e-AD", from: "A", to: "D", type: "ROAD", pathType: "EV", distance: 80, bidirectional: true },
    { id: "e-DC", from: "D", to: "C", type: "ROAD", pathType: "EV", distance: 80, bidirectional: true },
  ];

  it("routes pedestrian along the shortest direct path through WALK-only edge", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(nodes, edges, { travelMode: "WALK" });
    const result = findShortestPath(graph, nodeMap, "A", "C");

    expect(result).not.toBeNull();
    expect(result?.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(result?.totalDistance).toBe(100);
  });

  it("routes EV along longer EV detour path avoiding WALK-only edge", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(nodes, edges, { travelMode: "EV" });
    const result = findShortestPath(graph, nodeMap, "A", "C");

    expect(result).not.toBeNull();
    expect(result?.nodes.map((n) => n.id)).toEqual(["A", "D", "C"]);
    expect(result?.totalDistance).toBe(160);
  });

  it("returns null for EV on strict EV graph when only a WALK-only path connects endpoints", () => {
    const isolatedEdges: Edge[] = [
      { id: "e-AB", from: "A", to: "B", type: "ROAD", pathType: "EV", distance: 50, bidirectional: true },
      { id: "e-BC", from: "B", to: "C", type: "WALK", pathType: "WALK", distance: 50, bidirectional: true },
    ];

    // Pedestrian can reach C
    const walkGraph = buildAdjacencyGraph(nodes, isolatedEdges, { travelMode: "WALK" });
    const walkResult = findShortestPath(walkGraph.graph, walkGraph.nodeMap, "A", "C");
    expect(walkResult).not.toBeNull();
    expect(walkResult?.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);

    // Strict EV graph cannot reach C directly because B -> C is WALK only
    const evGraph = buildAdjacencyGraph(nodes, isolatedEdges, { travelMode: "EV" });
    const evResult = findShortestPath(evGraph.graph, evGraph.nodeMap, "A", "C");
    expect(evResult).toBeNull();
  });

  it("calculates multimodal EV + Walk route when destination is only reachable on foot", () => {
    const isolatedEdges: Edge[] = [
      { id: "e-AB", from: "A", to: "B", type: "ROAD", pathType: "EV", distance: 50, bidirectional: true },
      { id: "e-BC", from: "B", to: "C", type: "WALK", pathType: "WALK", distance: 50, bidirectional: true },
    ];

    const route = shortestPath("A", "C", {
      travelMode: "EV",
      graphData: {
        nodes,
        edges: isolatedEdges,
        floors: [],
        buildings: [],
        destinations: [],
        obstacles: [],
      },
    });

    expect(route).not.toBeNull();
    expect(route?.travelMode).toBe("MULTIMODAL");
    expect(route?.nodes.map((n) => n.id)).toEqual(["A", "B", "C"]);
    expect(route?.evDistance).toBe(50);
    expect(route?.walkDistance).toBe(50);
    expect(route?.transferNodeId).toBe("B");
    expect(route?.instructions.some((ins) => ins.transition === "ev->walk" || ins.icon === "parking")).toBe(true);
  });
});

describe("CampusStore PathType Synchronization & Persistence", () => {
  beforeEach(() => {
    campusStore.clearAllData();
    campusStore.addNode({ id: "n1", name: "Node 1", floorId: "f-out", type: "CORRIDOR", x: 100, y: 100 }, false);
    campusStore.addNode({ id: "n2", name: "Node 2", floorId: "f-out", type: "CORRIDOR", x: 200, y: 100 }, false);
    campusStore.addNode({ id: "n3", name: "Node 3", floorId: "f-out", type: "CORRIDOR", x: 300, y: 100 }, false);
  });

  it("synchronizes pathType on reverse twin edge when adding bidirectional edge", () => {
    const edge: Edge = {
      id: "e-n1-n2",
      from: "n1",
      to: "n2",
      type: "ROAD",
      pathType: "EV",
      distance: 25,
      bidirectional: true,
    };

    const res = campusStore.addEdge(edge);
    expect(res.success).toBe(true);

    const working = campusStore.getWorkingData();
    const fwd = working.edges.find((e) => e.id === "e-n1-n2");
    const rev = working.edges.find((e) => e.id === "e-n2-n1");

    expect(fwd).toBeDefined();
    expect(fwd?.pathType).toBe("EV");

    expect(rev).toBeDefined();
    expect(rev?.pathType).toBe("EV");
  });

  it("synchronizes pathType on reverse edge when updating edge", () => {
    campusStore.addEdge({
      id: "e-n1-n2",
      from: "n1",
      to: "n2",
      type: "WALK",
      pathType: "WALK",
      distance: 25,
      bidirectional: true,
    });

    // Update to EV Path
    campusStore.updateEdge("e-n1-n2", { pathType: "EV" });

    const working = campusStore.getWorkingData();
    const fwd = working.edges.find((e) => e.id === "e-n1-n2");
    const rev = working.edges.find((e) => e.id === "e-n2-n1");

    expect(fwd?.pathType).toBe("EV");
    expect(rev?.pathType).toBe("EV");
  });

  it("preserves pathType when splitting an edge with a node", () => {
    campusStore.addEdge({
      id: "e-n1-n3",
      from: "n1",
      to: "n3",
      type: "ROAD",
      pathType: "EV",
      distance: 100,
      bidirectional: true,
    });

    const splitRes = campusStore.splitEdgeWithNode("e-n1-n3", 200, 100, "JUNCTION", "Split Node");
    expect(splitRes).not.toBeNull();

    const working = campusStore.getWorkingData();
    // Split edges should inherit pathType: "EV"
    const splitEdges = working.edges.filter((e) => e.from === "n1" || e.to === "n3");
    expect(splitEdges.length).toBeGreaterThan(0);
    splitEdges.forEach((e) => {
      expect(e.pathType).toBe("EV");
    });
  });

  it("only sets transferNodeId when EV Mode is active and never for Walk Mode", () => {
    const testNodes: Node[] = [
      { id: "A", name: "Gate", floorId: "f-out", type: "GATE", x: 100, y: 100 },
      { id: "B", name: "Junction", floorId: "f-out", type: "JUNCTION", x: 200, y: 100 },
      { id: "C", name: "Classroom", floorId: "f-out", type: "ROOM", x: 300, y: 100 },
    ];
    const testEdges: Edge[] = [
      { id: "e-AB", from: "A", to: "B", type: "ROAD", pathType: "EV", distance: 50, bidirectional: true },
      { id: "e-BC", from: "B", to: "C", type: "WALK", pathType: "WALK", distance: 50, bidirectional: true },
    ];

    // Under WALK mode, a route along EV + pedestrian paths should have travelMode WALK and no transfer badge
    const walkRoute = shortestPath("A", "C", {
      travelMode: "WALK",
      graphData: {
        nodes: testNodes,
        edges: testEdges,
        floors: [],
        buildings: [],
        destinations: [],
        obstacles: [],
      },
    });
    expect(walkRoute).not.toBeNull();
    expect(walkRoute?.travelMode).toBe("WALK");
    expect(walkRoute?.transferNodeId).toBeUndefined();

    // Under EV mode, the multimodal route has transferNodeId at B
    const evRoute = shortestPath("A", "C", {
      travelMode: "EV",
      graphData: {
        nodes: testNodes,
        edges: testEdges,
        floors: [],
        buildings: [],
        destinations: [],
        obstacles: [],
      },
    });
    expect(evRoute).not.toBeNull();
    expect(evRoute?.travelMode).toBe("MULTIMODAL");
    expect(evRoute?.transferNodeId).toBe("B");
  });
});
