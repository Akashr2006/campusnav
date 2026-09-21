import { describe, it, expect } from "vitest";
import { buildAdjacencyGraph } from "../lib/routing/graph";
import { findShortestPath, findMultiWaypointPath } from "../lib/routing/dijkstra";
import { generateDirections } from "../lib/routing/directions";
import { checkRouteDeviation } from "../lib/routing/deviation";
import { useNavigationStore } from "../features/navigation/navigation-store";
import type { Node, Edge, Obstacle } from "../shared/data/campus";
import { nodes as sampleNodes, edges as sampleEdges } from "../shared/data/campus";

const fixtureNodes: Node[] = [
  { id: "n1", type: "ENTRANCE", name: "Main Gate", floorId: "f-out", x: 0, y: 0 },
  { id: "n2", type: "JUNCTION", name: "Plaza", floorId: "f-out", x: 100, y: 0 },
  { id: "n3", type: "ENTRANCE", name: "Admin Entrance", floorId: "f-out", x: 200, y: 0 },
  { id: "n4", type: "STAIR", name: "Stair Ground", floorId: "f-ab-0", x: 200, y: 50 },
  { id: "n5", type: "STAIR", name: "Stair First", floorId: "f-ab-1", x: 200, y: 150 },
  { id: "n6", type: "ROOM", name: "Dean Office", floorId: "f-ab-1", x: 300, y: 150 },
];

const fixtureEdges: Edge[] = [
  { id: "e1", from: "n1", to: "n2", type: "WALK", distance: 100, bidirectional: true },
  { id: "e2", from: "n2", to: "n3", type: "WALK", distance: 100, bidirectional: true },
  { id: "e3", from: "n3", to: "n4", type: "WALK", distance: 50, bidirectional: true },
  { id: "e4", from: "n4", to: "n5", type: "STAIRS", distance: 100, bidirectional: true },
  { id: "e5", from: "n5", to: "n6", type: "WALK", distance: 100, bidirectional: true },
];

describe("Pure Dijkstra Routing Engine", () => {
  it("computes standard shortest path across multi-floor graph", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(fixtureNodes, fixtureEdges);
    const result = findShortestPath(graph, nodeMap, "n1", "n6");

    expect(result).not.toBeNull();
    expect(result?.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
    expect(result?.totalDistance).toBe(450);
  });

  it("computes multi-stop route via intermediate waypoints", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(fixtureNodes, fixtureEdges);
    const result = findMultiWaypointPath(graph, nodeMap, ["n1", "n3", "n6"]);

    expect(result).not.toBeNull();
    expect(result?.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4", "n5", "n6"]);
    expect(result?.totalDistance).toBe(450);
  });

  it("strictly hard-drops obstacle-intersecting edges by default in primary graph", () => {
    const obstacle: Obstacle = {
      id: "obs1",
      campusId: "c1",
      floorId: "f-out",
      x: 150,
      y: 0,
      radius: 20,
      edgeIds: ["e2"],
      reason: "Construction",
    };

    const { graph, nodeMap } = buildAdjacencyGraph(fixtureNodes, fixtureEdges, {
      obstacles: [obstacle],
      allowObstaclePenalties: false,
    });
    const result = findShortestPath(graph, nodeMap, "n1", "n6");

    // Primary graph hard-drops edge e2 so router avoids it completely
    expect(result).toBeNull();
  });

  it("applies obstacle penalty in fallback graph when no obstacle-free route exists", () => {
    const spatialObstacle: Obstacle = {
      id: "obs2",
      campusId: "c1",
      floorId: "f-out",
      x: 150,
      y: 0,
      radius: 20,
      reason: "Under Construction",
    };

    const { graph, nodeMap } = buildAdjacencyGraph(fixtureNodes, fixtureEdges, {
      obstacles: [spatialObstacle],
      allowObstaclePenalties: true,
    });
    const result = findShortestPath(graph, nodeMap, "n1", "n6");

    // Fallback graph allows blocked edges so pure shortest physical path is found
    expect(result).not.toBeNull();
    expect(result?.totalDistance).toBe(450);
  });

  it("generates turn-by-turn direction steps with floor transition", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(fixtureNodes, fixtureEdges);
    const result = findShortestPath(graph, nodeMap, "n1", "n6");
    expect(result).not.toBeNull();

    const steps = generateDirections(result!.nodes, result!.edges);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps[steps.length - 1].icon).toBe("arrive");
  });

  it("detects off-route deviation when user strays from polyline", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(fixtureNodes, fixtureEdges);
    const result = findShortestPath(graph, nodeMap, "n1", "n6");
    expect(result).not.toBeNull();

    // User at (50, 0) is on line segment n1->n2
    const onRoute = checkRouteDeviation({ x: 50, y: 0, floorId: "f-out" }, result!.nodes);
    expect(onRoute.isDeviated).toBe(false);

    // User at (50, 100) is 100m away from outdoor path -> deviated
    const offRoute = checkRouteDeviation({ x: 50, y: 100, floorId: "f-out" }, result!.nodes);
    expect(offRoute.isDeviated).toBe(true);
  });
});

describe("Routing Engine – Empty Campus (no mock data)", () => {
  it("returns null for empty campus graph", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(sampleNodes, sampleEdges);
    // sampleNodes / sampleEdges are now empty arrays — no path is possible
    const result = findShortestPath(graph, nodeMap, "any-start", "any-end");
    expect(result).toBeNull();
  });

  it("builds an empty adjacency graph without error", () => {
    const { graph, nodeMap } = buildAdjacencyGraph([], []);
    expect(Object.keys(graph).length).toBe(0);
    expect(nodeMap.size).toBe(0);
  });

  it("handles obstacle list with empty graph gracefully", () => {
    const obstacle: Obstacle = {
      id: "o1",
      campusId: "c1",
      x: 0,
      y: 0,
      radius: 50,
      reason: "Test",
    };
    const { graph } = buildAdjacencyGraph([], [], { obstacles: [obstacle] });
    expect(Object.keys(graph).length).toBe(0);
  });
});

describe("Phase 2 – Active Navigation Session Store", () => {
  it("starts navigation session and sets state to NAVIGATING", () => {
    const mockOrigin = { id: "d1", name: "Start", nodeId: "n1", x: 0, y: 0, category: "Test", aliases: [] };
    const mockDest = { id: "d2", name: "End", nodeId: "n3", x: 200, y: 0, category: "Test", aliases: [] };
    const mockRoute = {
      id: "r1",
      nodes: [fixtureNodes[0], fixtureNodes[1], fixtureNodes[2]],
      edges: [fixtureEdges[0], fixtureEdges[1]],
      distance: 200,
      durationSec: 160,
      instructions: [
        { text: "Walk straight to Plaza", distance: 100 },
        { text: "Arrive at Admin Entrance", distance: 100, transition: "arrive" as const },
      ],
      hasObstacles: false,
    };

    useNavigationStore.getState().startNavigationSession(mockOrigin, mockDest, mockRoute);
    const state = useNavigationStore.getState();

    expect(state.status).toBe("NAVIGATING");
    expect(state.origin?.id).toBe("d1");
    expect(state.destination?.id).toBe("d2");
    expect(state.distanceRemaining).toBe(200);
  });

  it("detects arrival when position is close to destination", () => {
    const mockOrigin = { id: "d1", name: "Start", nodeId: "n1", x: 0, y: 0, category: "Test", aliases: [] };
    const mockDest = { id: "d2", name: "End", nodeId: "n3", x: 200, y: 0, category: "Test", aliases: [] };
    const mockRoute = {
      id: "r1",
      nodes: [fixtureNodes[0], fixtureNodes[1], fixtureNodes[2]],
      edges: [fixtureEdges[0], fixtureEdges[1]],
      distance: 200,
      durationSec: 160,
      instructions: [{ text: "Walk", distance: 200 }],
      hasObstacles: false,
    };

    useNavigationStore.getState().startNavigationSession(mockOrigin, mockDest, mockRoute);

    // Update GPS to near destination node n3
    useNavigationStore.getState().updateGpsProgress(
      11.4980, 77.2790, fixtureNodes[2], fixtureNodes, () => null
    );

    const state = useNavigationStore.getState();
    expect(state.status).toBe("ARRIVED");
    expect(state.distanceRemaining).toBe(0);
  });
});

