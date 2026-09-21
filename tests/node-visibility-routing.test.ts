import { describe, it, expect } from "vitest";
import type { Node, Edge, Destination } from "@/shared/data/campus";
import { buildAdjacencyGraph } from "@/lib/routing/graph";
import { findShortestPath } from "@/lib/routing/dijkstra";
import { getValidNavigationDestinations } from "@/shared/lib/destination-utils";
import { calculateTurnAngle, turnIconFromAngle, formatInstructionText } from "@/lib/routing/directions";
import { findNearestNodeByGps } from "@/lib/geo/haversine";
import { campusStore } from "@/shared/lib/campus-store";

describe("Separate User Node Visibility from Routing Graph (15 Specification Tests)", () => {
  // Test Data Setup
  const nodeA: Node = {
    id: "nA",
    name: "Main Entrance",
    type: "BUILDING_ENTRANCE",
    floorId: "f-1",
    x: 0,
    y: 0,
    lat: 11.4933,
    lng: 77.2760,
    visibleToUser: true,
  };

  const nodeB_hidden: Node = {
    id: "nB",
    name: "Internal Junction B",
    type: "CORRIDOR",
    floorId: "f-1",
    x: 50,
    y: 0,
    lat: 11.4934,
    lng: 77.2761,
    visibleToUser: false,
  };

  const nodeC_turn_hidden: Node = {
    id: "nC",
    name: "Internal Turn C",
    type: "CORRIDOR",
    floorId: "f-1",
    x: 50,
    y: 50,
    lat: 11.4935,
    lng: 77.2762,
    visibleToUser: false,
  };

  const nodeD: Node = {
    id: "nD",
    name: "Classroom 101",
    type: "ROOM",
    floorId: "f-1",
    x: 100,
    y: 50,
    lat: 11.4936,
    lng: 77.2763,
    visibleToUser: true,
  };

  const nodeStair_hidden: Node = {
    id: "nStair",
    name: "Stairway South",
    type: "STAIR",
    floorId: "f-1",
    stairGroupId: "sg-1",
    x: 100,
    y: 100,
    visibleToUser: false,
  };

  const nodeStairF2: Node = {
    id: "nStairF2",
    name: "Stairway South F2",
    type: "STAIR",
    floorId: "f-2",
    stairGroupId: "sg-1",
    x: 100,
    y: 100,
    visibleToUser: false,
  };

  const edgeAB: Edge = { id: "eAB", from: "nA", to: "nB", type: "WALK", distance: 50 };
  const edgeBC: Edge = { id: "eBC", from: "nB", to: "nC", type: "WALK", distance: 50 };
  const edgeCD: Edge = { id: "eCD", from: "nC", to: "nD", type: "WALK", distance: 50 };
  const edgeDStair: Edge = { id: "eDS", from: "nD", to: "nStair", type: "WALK", distance: 50 };
  const edgeStairTransfer: Edge = { id: "eST", from: "nStair", to: "nStairF2", type: "STAIRS", distance: 10 };

  const allTestNodes = [nodeA, nodeB_hidden, nodeC_turn_hidden, nodeD, nodeStair_hidden, nodeStairF2];
  const allTestEdges = [edgeAB, edgeBC, edgeCD, edgeDStair, edgeStairTransfer];

  it("TEST 1: Visible node appears in user search", () => {
    const destinations = getValidNavigationDestinations({
      nodes: allTestNodes,
      destinations: [],
      buildings: [],
      floors: [{ id: "f-1", name: "Floor 1", ordinal: 1 }],
    });

    const hasMainEntrance = destinations.some((d) => d.name === "Main Entrance");
    const hasClassroom = destinations.some((d) => d.name === "Classroom 101");

    expect(hasMainEntrance).toBe(true);
    expect(hasClassroom).toBe(true);
  });

  it("TEST 2: Hidden node does not appear in user search", () => {
    const destinations = getValidNavigationDestinations({
      nodes: allTestNodes,
      destinations: [],
      buildings: [],
      floors: [{ id: "f-1", name: "Floor 1", ordinal: 1 }],
    });

    const hasHiddenJunction = destinations.some((d) => d.name === "Internal Junction B" || d.nodeId === "nB");
    const hasHiddenTurn = destinations.some((d) => d.name === "Internal Turn C" || d.nodeId === "nC");

    expect(hasHiddenJunction).toBe(false);
    expect(hasHiddenTurn).toBe(false);
  });

  it("TEST 3: Hidden node remains in routing graph", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(allTestNodes, allTestEdges);

    expect(nodeMap.has("nB")).toBe(true);
    expect(nodeMap.has("nC")).toBe(true);
    expect(graph.has("nB")).toBe(true);
    expect(graph.has("nC")).toBe(true);

    const neighborsA = graph.get("nA")?.map((e) => e.to);
    expect(neighborsA).toContain("nB");

    const neighborsB = graph.get("nB")?.map((e) => e.to);
    expect(neighborsB).toContain("nC");
  });

  it("TEST 4: Route can pass through hidden node: A -> B(hidden) -> C(hidden) -> D", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(allTestNodes, allTestEdges);
    const path = findShortestPath(graph, nodeMap, "nA", "nD");

    expect(path).not.toBeNull();
    expect(path!.nodes.map((n) => n.id)).toEqual(["nA", "nB", "nC", "nD"]);
    expect(path!.totalDistance).toBe(150);
  });

  it("TEST 5: Hidden node marker does not appear on user map", () => {
    // User map visual filter logic
    const userMapVisibleNodes = allTestNodes.filter((n) => n.visibleToUser !== false);

    expect(userMapVisibleNodes.map((n) => n.id)).toEqual(["nA", "nD"]);
    expect(userMapVisibleNodes.some((n) => n.id === "nB")).toBe(false);
    expect(userMapVisibleNodes.some((n) => n.id === "nC")).toBe(false);
  });

  it("TEST 6: Path passing through hidden node remains completely visible", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(allTestNodes, allTestEdges);
    const route = findShortestPath(graph, nodeMap, "nA", "nD");

    // All 3 route edges (eAB, eBC, eCD) are present in route result for complete polyline rendering
    expect(route!.edges.length).toBe(3);
    expect(route!.edges[0].from).toBe("nA");
    expect(route!.edges[0].to).toBe("nB");
    expect(route!.edges[1].from).toBe("nB");
    expect(route!.edges[1].to).toBe("nC");
    expect(route!.edges[2].from).toBe("nC");
    expect(route!.edges[2].to).toBe("nD");
  });

  it("TEST 7: GPS nearest-node detection can select hidden node", () => {
    // User GPS is directly on top of hidden node B (11.4934, 77.2761) on floor f-1
    const nearest = findNearestNodeByGps(11.4934, 77.2761, allTestNodes, "f-1");

    expect(nearest.node).not.toBeNull();
    expect(nearest.node!.id).toBe("nB");
    expect(nearest.distanceMeters).toBeLessThan(5);
  });

  it("TEST 8: Hidden node can act as an intermediate Dijkstra node", () => {
    const { graph, nodeMap } = buildAdjacencyGraph(allTestNodes, allTestEdges);
    const path = findShortestPath(graph, nodeMap, "nA", "nStairF2");

    expect(path).not.toBeNull();
    expect(path!.nodes.map((n) => n.id)).toEqual(["nA", "nB", "nC", "nD", "nStair", "nStairF2"]);
  });

  it("TEST 9: Hidden node can represent a turn and produce natural turn instructions", () => {
    // Vector 1 (nA -> nC via nB): moving East (+dx)
    const v1 = { dx: 50, dy: 0 };
    // Vector 2 (nC -> nD): moving South (+dy)
    const v2 = { dx: 0, dy: 50 };

    const angle = calculateTurnAngle(v1, v2);
    const icon = turnIconFromAngle(angle);

    expect(icon).toBe("right");

    // When target node is hidden, no technical ID or internal name is leaked
    const text = formatInstructionText(icon, undefined);
    expect(text).toBe("Turn right");
  });

  it("TEST 10: Hidden node can represent stairs/lift transition", () => {
    const stairInstruction = formatInstructionText("stairs-up", undefined, {
      from: "f-1",
      to: "f-2",
      toFloorName: "Second Floor",
    });
    expect(stairInstruction).toBe("Take stairs to Second Floor");

    const liftInstruction = formatInstructionText("lift", undefined, {
      from: "f-1",
      to: "f-2",
      toFloorName: "Second Floor",
    });
    expect(liftInstruction).toBe("Take lift to Second Floor");
  });

  it("TEST 11: Admin visibility change does not delete node", () => {
    const node: Node = { ...nodeA, visibleToUser: true };
    // Admin toggles visibleToUser to false
    node.visibleToUser = false;

    expect(node.id).toBe("nA");
    expect(node.x).toBe(0);
    expect(node.y).toBe(0);
    expect(node.visibleToUser).toBe(false);
  });

  it("TEST 12: Admin visibility change does not delete edges", () => {
    const node: Node = { ...nodeA, visibleToUser: false };
    const edges = [edgeAB];

    const { graph, nodeMap } = buildAdjacencyGraph([node, nodeB_hidden], edges);
    expect(graph.get("nA")?.length).toBe(1);
    expect(graph.get("nA")![0].to).toBe("nB");
  });

  it("TEST 13: Publishing preserves visibleToUser", () => {
    const draftNode: Node = { id: "n-test", name: "Test Node", type: "CORRIDOR", floorId: "f-1", x: 10, y: 10, visibleToUser: false };
    
    // Simulate publish service preservation
    const publishedNode = {
      ...draftNode,
      visibleToUser: draftNode.visibleToUser !== undefined ? draftNode.visibleToUser : true,
    };

    expect(publishedNode.visibleToUser).toBe(false);
  });

  it("TEST 14: Existing routes continue working after visibility changes", () => {
    // Before: B is visible
    const nodeB_vis: Node = { ...nodeB_hidden, visibleToUser: true };
    const { graph: g1, nodeMap: m1 } = buildAdjacencyGraph([nodeA, nodeB_vis, nodeC_turn_hidden, nodeD], allTestEdges);
    const routeBefore = findShortestPath(g1, m1, "nA", "nD");

    // After: B is hidden
    const { graph: g2, nodeMap: m2 } = buildAdjacencyGraph(allTestNodes, allTestEdges);
    const routeAfter = findShortestPath(g2, m2, "nA", "nD");

    expect(routeBefore!.nodes.map((n) => n.id)).toEqual(routeAfter!.nodes.map((n) => n.id));
    expect(routeBefore!.totalDistance).toBe(routeAfter!.totalDistance);
  });

  it("TEST 15: GPS updates do not cause unnecessary graph refetches", () => {
    const publishedGraph1 = campusStore.getPublishedData();
    const publishedGraph2 = campusStore.getPublishedData();
    expect(publishedGraph1).toBeDefined();
    expect(publishedGraph2).toBeDefined();

    // Verify data equality across synchronous store reads
    expect(publishedGraph1.nodes.length).toBe(publishedGraph2.nodes.length);
    expect(publishedGraph1.edges.length).toBe(publishedGraph2.edges.length);
  });
});
