import { describe, it, expect, beforeEach } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import { buildAdjacencyGraph } from "../lib/routing/graph";
import { findShortestPath } from "../lib/routing/dijkstra";
import { generateDirections } from "../lib/routing/directions";
import { validateCampusGraph } from "../lib/validation/graph-validator";
import type { Building, Floor, Node, Edge, Event, Obstacle } from "../shared/data/campus";
import { isEventActive, getEventStatus } from "../shared/lib/event-utils";
import { useNavigationStore } from "../features/navigation/navigation-store";

describe("Indoor Building System & Vertical Graph Engine", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("creates building with basements and upper floors", () => {
    const building: Building = {
      id: "b1",
      campusId: "c1",
      name: "Science Block",
      shortCode: "SB",
      color: "#4f46e5",
      lat: 12.9716,
      lng: 77.5946,
      floorsCount: 3,
      basementsCount: 1,
      description: "Science research and teaching block",
    };

    campusStore.addBuilding(building);
    const data = campusStore.getWorkingData();

    expect(data.buildings.length).toBe(1);
    // B1 (-1), G (0), F1 (1), F2 (2), F3 (3) = 5 floors total
    expect(data.floors.length).toBe(5);

    const floorCodes = data.floors.map((f) => f.code);
    expect(floorCodes).toContain("B1");
    expect(floorCodes).toContain("G");
    expect(floorCodes).toContain("1");
    expect(floorCodes).toContain("2");
    expect(floorCodes).toContain("3");
  });

  it("creates Stair Group system connecting multiple floors vertically", () => {
    const building: Building = {
      id: "b-main",
      campusId: "c1",
      name: "Main Block",
      shortCode: "MB",
      color: "#10b981",
      lat: 12.9716,
      lng: 77.5946,
      floorsCount: 3,
      basementsCount: 0,
    };
    campusStore.addBuilding(building);
    const floors = campusStore.getWorkingData().floors;

    const floorIds = floors.map((f) => f.id);
    const stairGroup = campusStore.createStairGroup("b-main", "Staircase A", floorIds, { x: 200, y: 200 });

    expect(stairGroup.id).toBeDefined();
    const data = campusStore.getWorkingData();

    // Verify stair nodes created on each floor
    const stairNodes = data.nodes.filter((n) => n.stairGroupId === stairGroup.id);
    expect(stairNodes.length).toBe(floors.length);

    // Verify vertical STAIRS edges created between consecutive floors
    const verticalEdges = data.edges.filter((e) => e.stairGroupId === stairGroup.id && e.type === "STAIRS");
    expect(verticalEdges.length).toBeGreaterThan(0);
  });

  it("calculates multi-floor Dijkstra route using Stair Group (Ground -> Floor 3)", () => {
    // Setup building
    const bld: Building = {
      id: "b-acad",
      campusId: "c1",
      name: "Academic Block",
      shortCode: "AB",
      color: "#6366f1",
      lat: 12.9716,
      lng: 77.5946,
      floorsCount: 3,
      basementsCount: 0,
    };
    campusStore.addBuilding(bld);

    const floors = campusStore.getWorkingData().floors.sort((a, b) => a.ordinal - b.ordinal);
    const gndFloor = floors.find((f) => f.ordinal === 0)!;
    const f3Floor = floors.find((f) => f.ordinal === 3)!;

    // Create Staircase Group connecting all floors
    const stairGroup = campusStore.createStairGroup("b-acad", "Main Stairs", floors.map((f) => f.id), { x: 100, y: 100 });
    const data1 = campusStore.getWorkingData();
    const gndStairNode = data1.nodes.find((n) => n.stairGroupId === stairGroup.id && n.floorId === gndFloor.id)!;
    const f3StairNode = data1.nodes.find((n) => n.stairGroupId === stairGroup.id && n.floorId === f3Floor.id)!;

    // Add start room node on Ground Floor and destination room node on Floor 3
    const startNode: Node = { id: "n-gnd-room", type: "ROOM", name: "Lobby Room", floorId: gndFloor.id, x: 50, y: 100 };
    const destNode: Node = { id: "n-f3-room", type: "ROOM", name: "Dean Office F3", floorId: f3Floor.id, x: 200, y: 100 };
    campusStore.addNode(startNode);
    campusStore.addNode(destNode);

    // Connect room nodes to floor stair nodes
    campusStore.addEdge({ id: "e-gnd-stair", from: startNode.id, to: gndStairNode.id, type: "WALK", distance: 20, bidirectional: true });
    campusStore.addEdge({ id: "e-f3-stair", from: f3StairNode.id, to: destNode.id, type: "WALK", distance: 20, bidirectional: true });

    const finalData = campusStore.getWorkingData();
    const { graph, nodeMap } = buildAdjacencyGraph(finalData.nodes, finalData.edges);

    const path = findShortestPath(graph, nodeMap, startNode.id, destNode.id);
    expect(path).not.toBeNull();
    expect(path?.nodes.map((n) => n.id)).toContain(startNode.id);
    expect(path?.nodes.map((n) => n.id)).toContain(destNode.id);

    const directions = generateDirections(path!.nodes, path!.edges);
    expect(directions.some((d) => d.icon === "stairs-up" || d.icon === "stairs-down")).toBe(true);
  });

  it("calculates Lift Group multi-floor route (Basement 1 -> Floor 2)", () => {
    const bld: Building = {
      id: "b-hostel",
      campusId: "c1",
      name: "Hostel Block",
      shortCode: "HB",
      color: "#ec4899",
      lat: 12.9716,
      lng: 77.5946,
      floorsCount: 2,
      basementsCount: 1,
    };
    campusStore.addBuilding(bld);

    const floors = campusStore.getWorkingData().floors.sort((a, b) => a.ordinal - b.ordinal);
    const b1Floor = floors.find((f) => f.ordinal === -1)!;
    const f2Floor = floors.find((f) => f.ordinal === 2)!;

    const liftGroup = campusStore.createLiftGroup("b-hostel", "Elevator 1", floors.map((f) => f.id), { x: 300, y: 300 });

    const data = campusStore.getWorkingData();
    const b1LiftNode = data.nodes.find((n) => n.liftGroupId === liftGroup.id && n.floorId === b1Floor.id)!;
    const f2LiftNode = data.nodes.find((n) => n.liftGroupId === liftGroup.id && n.floorId === f2Floor.id)!;

    const { graph, nodeMap } = buildAdjacencyGraph(data.nodes, data.edges);
    const path = findShortestPath(graph, nodeMap, b1LiftNode.id, f2LiftNode.id);

    expect(path).not.toBeNull();
    expect(path?.nodes[0].id).toBe(b1LiftNode.id);
    expect(path?.nodes[path.nodes.length - 1].id).toBe(f2LiftNode.id);
  });

  it("links Outdoor to Indoor entrance graph correctly", () => {
    const outdoorNode: Node = { id: "n-outdoor-path", type: "OUTDOOR", name: "Main Campus Quad", floorId: "f-out", x: 100, y: 100 };
    const entNode: Node = { id: "n-bld-ent", type: "BUILDING_ENTRANCE", name: "Admin Entrance", floorId: "f-out", x: 120, y: 100 };
    const indoorNode: Node = { id: "n-indoor-corr", type: "CORRIDOR", name: "Main Hallway", floorId: "f-admin-gnd", x: 140, y: 100 };

    campusStore.addNode(outdoorNode);
    campusStore.addNode(entNode);
    campusStore.addNode(indoorNode);

    campusStore.addEdge({ id: "e1", from: outdoorNode.id, to: entNode.id, type: "WALK", distance: 15, bidirectional: true });
    campusStore.addEdge({ id: "e2", from: entNode.id, to: indoorNode.id, type: "WALK", distance: 10, bidirectional: true });

    const data = campusStore.getWorkingData();
    const { graph, nodeMap } = buildAdjacencyGraph(data.nodes, data.edges);

    const path = findShortestPath(graph, nodeMap, outdoorNode.id, indoorNode.id);
    expect(path).not.toBeNull();
    expect(path?.nodes.map((n) => n.id)).toEqual([outdoorNode.id, entNode.id, indoorNode.id]);
  });

  it("performs Smart Floor Duplication with selective copying", () => {
    const bld: Building = {
      id: "b-dup",
      campusId: "c1",
      name: "Dup Building",
      shortCode: "DB",
      color: "#8b5cf6",
      lat: 12.9716,
      lng: 77.5946,
      floorsCount: 1,
    };
    campusStore.addBuilding(bld);
    const gnd = campusStore.getWorkingData().floors[0];

    const n1: Node = { id: "n-src-1", type: "CORRIDOR", name: "Src Node 1", floorId: gnd.id, x: 50, y: 50 };
    const n2: Node = { id: "n-src-2", type: "ROOM", name: "Src Room 2", floorId: gnd.id, x: 150, y: 50 };
    campusStore.addNode(n1);
    campusStore.addNode(n2);
    campusStore.addEdge({ id: "e-src-1-2", from: n1.id, to: n2.id, type: "WALK", distance: 25 });

    const newFloor = campusStore.duplicateFloor(gnd.id, {
      copyNodes: true,
      copyEdges: true,
      copyRooms: false, // Exclude rooms to test selective copying
    });

    expect(newFloor).toBeDefined();
    const data = campusStore.getWorkingData();
    const dupNodes = data.nodes.filter((n) => n.floorId === newFloor!.id);

    // Corridor node copied, room node excluded
    expect(dupNodes.length).toBe(1);
    expect(dupNodes[0].type).toBe("CORRIDOR");
  });

  it("validates multi-floor graph using 10-point Graph Validator", () => {
    const bld: Building = {
      id: "b-val",
      campusId: "c1",
      name: "Valid Block",
      shortCode: "VB",
      color: "#0284c7",
      lat: 12.9716,
      lng: 77.5946,
      floorsCount: 2,
    };
    campusStore.addBuilding(bld);
    const floors = campusStore.getWorkingData().floors;

    const reportBefore = validateCampusGraph(
      [bld],
      floors,
      campusStore.getWorkingData().nodes,
      campusStore.getWorkingData().edges,
      []
    );
    expect(reportBefore.issues.length).toBeGreaterThan(0); // Before adding nodes/staircases, issues exist

    // Add staircase group
    campusStore.createStairGroup(bld.id, "Stair A", floors.map((f) => f.id));

    // Add building entrance
    const entNode: Node = { id: "n-ent-val", type: "BUILDING_ENTRANCE", name: "Main Gate VB", floorId: floors[0].id, x: 100, y: 100, lat: 12.9716, lng: 77.5946 };
    campusStore.addNode(entNode);

    const stairNodeOnF0 = campusStore.getWorkingData().nodes.find((n) => n.floorId === floors[0].id && n.type === "STAIR");
    if (stairNodeOnF0) {
      campusStore.addEdge({
        id: `e-val-ent-stair`,
        from: entNode.id,
        to: stairNodeOnF0.id,
        type: "WALK",
        distance: 10,
      });
    }

    const reportAfter = validateCampusGraph(
      [bld],
      floors,
      campusStore.getWorkingData().nodes,
      campusStore.getWorkingData().edges,
      []
    );

    expect(reportAfter.healthScore).toBeGreaterThanOrEqual(70);
  });

  it("keeps doors independent without auto-generated graph suggestions", () => {
    const door = campusStore.addDoor({
      id: "d-test-1",
      floorId: "f-1",
      type: "ROOM_DOOR",
      name: "Room 101 Door",
      x: 100,
      y: 100,
    });

    const dataAfterDoor = campusStore.getWorkingData();
    expect(dataAfterDoor.suggestedNodes.length).toBe(0);
  });

  it("performs Copy & Paste entity cloning across floors", () => {
    const n1: Node = { id: "n-copy-1", type: "CORRIDOR", name: "Node 1", floorId: "f-1", x: 100, y: 100 };
    const n2: Node = { id: "n-copy-2", type: "ROOM", name: "Node 2", floorId: "f-1", x: 200, y: 100 };
    campusStore.addNode(n1);
    campusStore.addNode(n2);
    campusStore.addEdge({ id: "e-copy-1-2", from: n1.id, to: n2.id, type: "WALK", distance: 25 });

    campusStore.copySelectedEntities([n1.id, n2.id]);
    const pastedIds = campusStore.pasteEntities("f-2", { x: 50, y: 50 });

    expect(pastedIds.length).toBe(2);
    const data = campusStore.getWorkingData();
    const f2Nodes = data.nodes.filter((n) => n.floorId === "f-2");
    expect(f2Nodes.length).toBe(2);
    expect(f2Nodes[0].x).toBe(150);
  });

  it("supports Bulk Editing (Delete, Rename, Update Category)", () => {
    const d1 = { id: "d-b1", nodeId: "n1", name: "Room A", category: "Classroom", aliases: [] };
    const d2 = { id: "d-b2", nodeId: "n2", name: "Room B", category: "Classroom", aliases: [] };
    campusStore.addDestination(d1);
    campusStore.addDestination(d2);

    campusStore.bulkUpdateCategory(["d-b1", "d-b2"], "Laboratory");
    expect(campusStore.getWorkingData().destinations.every((d) => d.category === "Laboratory")).toBe(true);

    campusStore.bulkRename(["d-b1", "d-b2"], "Lab Wing");
    expect(campusStore.getWorkingData().destinations[0].name).toBe("Lab Wing 1");

    campusStore.bulkDelete(["d-b1", "d-b2"]);
    expect(campusStore.getWorkingData().destinations.length).toBe(0);
  });

  it("reverts building state to default after event completion time passes", () => {
    const pastEvent: Event = {
      id: "ev-past-1",
      campusId: "c1",
      buildingId: "b1",
      title: "Completed Science Fair",
      startsAt: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
      endsAt: new Date(Date.now() - 3600000).toISOString(),   // 1 hour ago
      color: "#f59e0b",
    };

    const activeEvent: Event = {
      id: "ev-active-1",
      campusId: "c1",
      buildingId: "b2",
      title: "Ongoing Hackathon",
      startsAt: new Date(Date.now() - 1800000).toISOString(), // 30 mins ago
      endsAt: new Date(Date.now() + 3600000).toISOString(),   // 1 hour from now
      color: "#ec4899",
    };

    expect(isEventActive(pastEvent)).toBe(false);
    expect(getEventStatus(pastEvent)).toBe("COMPLETED");

    expect(isEventActive(activeEvent)).toBe(true);
    expect(getEventStatus(activeEvent)).toBe("ONGOING");
  });

  it("supports adding obstacles across Outdoor, Ground Floor, 1st Floor, and all indoor floor levels", () => {
    const obsOutdoor: Obstacle = { id: "obs-out", campusId: "c1", floorId: "f-out", x: 100, y: 100, radius: 20, reason: "Road Work" };
    const obsGround: Obstacle = { id: "obs-gnd", campusId: "c1", floorId: "f-b1-g", x: 150, y: 150, radius: 15, reason: "Ground Spill" };
    const obsFirst: Obstacle = { id: "obs-fl1", campusId: "c1", floorId: "f-b1-1", x: 200, y: 200, radius: 25, reason: "1st Floor Maintenance" };

    campusStore.addObstacle(obsOutdoor);
    campusStore.addObstacle(obsGround);
    campusStore.addObstacle(obsFirst);

    const storeObs = campusStore.getWorkingData().obstacles;
    expect(storeObs.length).toBe(3);
    expect(storeObs.find((o) => o.id === "obs-fl1")?.floorId).toBe("f-b1-1");

    campusStore.updateObstacle("obs-fl1", { floorId: "f-b1-2", reason: "Moved to 2nd Floor" });
    expect(campusStore.getWorkingData().obstacles.find((o) => o.id === "obs-fl1")?.floorId).toBe("f-b1-2");
  });
});

describe("Phase 3 – Indoor Navigation State Machine & Transitions", () => {
  it("transitions state through Outdoor -> Building Entrance -> Indoor -> Room Arrival", () => {
    const outdoorNode: Node = { id: "n-out", type: "OUTDOOR", name: "Quad Walkway", floorId: "f-out", x: 0, y: 0, lat: 11.4965, lng: 77.2774 };
    const entNode: Node = { id: "n-ent", type: "BUILDING_ENTRANCE", name: "Science Block Entrance", floorId: "f-out", x: 50, y: 0, lat: 11.4969, lng: 77.2778 };
    const roomNode: Node = { id: "n-room-101", type: "ROOM", name: "Room 101", floorId: "f-sb-1", x: 100, y: 0 };

    const mockOrigin = { id: "d-start", name: "Outdoor Quad", nodeId: "n-out", x: 0, y: 0, category: "Outdoor", aliases: [] };
    const mockDest = { id: "d-end", name: "Room 101", nodeId: "n-room-101", x: 100, y: 0, category: "Classroom", aliases: [] };
    const mockRoute = {
      id: "r-indoor",
      nodes: [outdoorNode, entNode, roomNode],
      edges: [
        { id: "e1", from: "n-out", to: "n-ent", type: "WALK" as const, distance: 50 },
        { id: "e2", from: "n-ent", to: "n-room-101", type: "WALK" as const, distance: 50 },
      ],
      distance: 100,
      durationSec: 80,
      instructions: [
        { text: "Walk to Science Block Entrance", distance: 50 },
        { text: "Arrive at Room 101", distance: 50, transition: "arrive" as const },
      ],
      hasObstacles: false,
    };

    useNavigationStore.getState().startNavigationSession(mockOrigin, mockDest, mockRoute);
    let state = useNavigationStore.getState();
    expect(state.navigationMode).toBe("OUTDOOR");

    // Progress to Entrance Node
    useNavigationStore.getState().updateGpsProgress(
      11.4969, 77.2778, entNode, [outdoorNode, entNode, roomNode], () => null
    );
    state = useNavigationStore.getState();
    expect(state.navigationMode).toBe("APPROACHING_ENTRANCE");

    // Progress to Room Node on Indoor Floor
    useNavigationStore.getState().updateGpsProgress(
      11.4969, 77.2778, roomNode, [outdoorNode, entNode, roomNode], () => null
    );
    state = useNavigationStore.getState();
    expect(state.status).toBe("ARRIVED");
    expect(state.navigationMode).toBe("ARRIVED");
  });

  it("handles unknown indoor position gracefully without claiming false precision", () => {
    useNavigationStore.getState().setIndoorContext("b-science", "f-sb-2", "INDOOR_GRAPH_CONTEXT", "MEDIUM");
    const state = useNavigationStore.getState();

    expect(state.currentFloorId).toBe("f-sb-2");
    expect(state.indoorPositionSource).toBe("INDOOR_GRAPH_CONTEXT");
    expect(state.positionConfidence).toBe("MEDIUM");
  });

  it("ensures standalone STAIR and LIFT nodes do not connect automatically upon placement", () => {
    const building: Building = {
      id: "b-manual-connect",
      campusId: "c1",
      name: "Engineering Hall",
      shortCode: "EH",
      color: "#3b82f6",
      lat: 12.9716,
      lng: 77.5946,
      floorsCount: 2,
      basementsCount: 0,
    };
    campusStore.addBuilding(building);
    const floors = campusStore.getWorkingData().floors.filter((f) => f.buildingId === "b-manual-connect");
    const gFloor = floors.find((f) => f.ordinal === 0)!;
    const f1Floor = floors.find((f) => f.ordinal === 1)!;

    // Add Stair Node on Ground Floor
    const stairGnd: Node = { id: "stair-gnd", type: "STAIR", name: "Main Staircase", floorId: gFloor.id, x: 200, y: 200 };
    campusStore.addNode(stairGnd);

    // Add Stair Node on Floor 1
    const stairF1: Node = { id: "stair-f1", type: "STAIR", name: "Main Staircase", floorId: f1Floor.id, x: 205, y: 205 };
    campusStore.addNode(stairF1);

    // Verify NO edge is automatically created without explicit connection
    const stairEdges = campusStore.getWorkingData().edges.filter(
      (e) => (e.from === "stair-gnd" && e.to === "stair-f1") || (e.from === "stair-f1" && e.to === "stair-gnd")
    );
    expect(stairEdges.length).toBe(0);

    // Add Lift Node on Ground Floor
    const liftGnd: Node = { id: "lift-gnd", type: "LIFT", name: "Passenger Lift 1", floorId: gFloor.id, x: 350, y: 350 };
    campusStore.addNode(liftGnd);

    // Add Lift Node on Floor 1
    const liftF1: Node = { id: "lift-f1", type: "LIFT", name: "Passenger Lift 1", floorId: f1Floor.id, x: 352, y: 352 };
    campusStore.addNode(liftF1);

    // Verify NO edge is automatically created
    const liftEdges = campusStore.getWorkingData().edges.filter(
      (e) => (e.from === "lift-gnd" && e.to === "lift-f1") || (e.from === "lift-f1" && e.to === "lift-gnd")
    );
    expect(liftEdges.length).toBe(0);
  });
});


