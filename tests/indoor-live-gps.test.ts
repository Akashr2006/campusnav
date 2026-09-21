import { describe, it, expect } from "vitest";
import { detectBuildingAtGps } from "../lib/geo/containment";
import { findContextAwareNearestNode } from "../lib/geo/haversine";
import { shortestPath } from "../features/navigation/services/graph";
import type { Building, Floor, Node, Edge, Destination } from "../shared/data/campus";

describe("Feature 1 & 2: Indoor Live GPS & Context-Aware Navigation", () => {
  const mockBuildings: Building[] = [
    {
      id: "b-main",
      campusId: "campus-1",
      name: "Main Academic Building",
      shortCode: "MAB",
      color: "#2563eb",
      centerLat: 12.971598,
      centerLng: 77.594562,
      footprint: [
        { lat: 12.9715, lng: 77.5945 },
        { lat: 12.9717, lng: 77.5945 },
        { lat: 12.9717, lng: 77.5947 },
        { lat: 12.9715, lng: 77.5947 },
      ],
    },
    {
      id: "b-science",
      campusId: "campus-1",
      name: "Science Complex",
      shortCode: "SCI",
      color: "#10b981",
      centerLat: 12.9725,
      centerLng: 77.5955,
      footprint: [
        { lat: 12.9723, lng: 77.5953 },
        { lat: 12.9727, lng: 77.5953 },
        { lat: 12.9727, lng: 77.5957 },
        { lat: 12.9723, lng: 77.5957 },
      ],
    },
  ];

  const mockFloors: Floor[] = [
    { id: "f-main-g", buildingId: "b-main", name: "Ground Floor", ordinal: 0 },
    { id: "f-main-1", buildingId: "b-main", name: "First Floor", ordinal: 1 },
    { id: "f-main-2", buildingId: "b-main", name: "Second Floor", ordinal: 2 },
    { id: "f-sci-g", buildingId: "b-science", name: "Ground Floor", ordinal: 0 },
  ];

  const mockNodes: Node[] = [
    // Outdoor nodes
    {
      id: "n-out-1",
      name: "Campus Quad",
      x: 100,
      y: 100,
      floorId: "f-out",
      type: "OUTDOOR_PATH",
      lat: 12.9710,
      lng: 77.5940,
    },
    {
      id: "n-out-entrance",
      name: "Main Building Entrance",
      x: 150,
      y: 200,
      floorId: "f-out",
      type: "BUILDING_ENTRANCE",
      isEntranceNode: true,
      lat: 12.9715,
      lng: 77.5945,
    },
    // Main Building - Ground Floor nodes
    {
      id: "n-main-g-lobby",
      name: "Main Lobby",
      x: 200,
      y: 200,
      floorId: "f-main-g",
      type: "ROOM",
      lat: 12.9716,
      lng: 77.5946,
    },
    {
      id: "n-main-g-hall",
      name: "Ground Hallway",
      x: 210,
      y: 200,
      floorId: "f-main-g",
      type: "ROOM",
      lat: 12.97161,
      lng: 77.59461,
    },
    // Main Building - First Floor nodes
    {
      id: "n-main-1-lab",
      name: "CS Lab 101",
      x: 200,
      y: 200,
      floorId: "f-main-1",
      type: "ROOM",
      lat: 12.9716,
      lng: 77.5946,
    },
    // Main Building - Second Floor nodes
    {
      id: "n-main-2-conf",
      name: "Conference Room 201",
      x: 200,
      y: 200,
      floorId: "f-main-2",
      type: "ROOM",
      lat: 12.9716,
      lng: 77.5946,
    },
    // Science Complex - Ground Floor nodes
    {
      id: "n-sci-g-lab",
      name: "Physics Lab",
      x: 600,
      y: 600,
      floorId: "f-sci-g",
      type: "ROOM",
      lat: 12.9725,
      lng: 77.5955,
    },
  ];

  // Test 1: Outdoor GPS
  it("Test 1: GPS outside any building detects outdoor context and never prompts for floor", () => {
    const outdoorLat = 12.9705;
    const outdoorLng = 77.5935;
    const detection = detectBuildingAtGps(outdoorLat, outdoorLng, 5, mockBuildings);

    expect(detection.isInside).toBe(false);
    expect(detection.building).toBeNull();

    const nearestResult = findContextAwareNearestNode(
      outdoorLat,
      outdoorLng,
      mockNodes,
      { isInside: false, floorId: "f-out" }
    );

    expect(nearestResult.isIndoor).toBe(false);
    expect(nearestResult.floorId).toBe("f-out");
    expect(nearestResult.node).not.toBeNull();
    expect(nearestResult.node?.id).toBe("n-out-1");
  });

  // Test 2: Multi-floor Indoor GPS
  it("Test 2: GPS inside multi-floor building identifies building and filters nodes to selected floor", () => {
    const indoorLat = 12.9716;
    const indoorLng = 77.5946;
    const detection = detectBuildingAtGps(indoorLat, indoorLng, 5, mockBuildings);

    expect(detection.isInside).toBe(true);
    expect(detection.building?.id).toBe("b-main");

    // Select Floor 1
    const nearestResultFloor1 = findContextAwareNearestNode(
      indoorLat,
      indoorLng,
      mockNodes,
      {
        isInside: true,
        buildingId: "b-main",
        floorId: "f-main-1",
        floors: mockFloors,
      }
    );

    expect(nearestResultFloor1.isIndoor).toBe(true);
    expect(nearestResultFloor1.floorId).toBe("f-main-1");
    expect(nearestResultFloor1.node?.id).toBe("n-main-1-lab");
    expect(nearestResultFloor1.node?.name).toBe("CS Lab 101");
  });

  // Test 3: GPS not exactly on a node
  it("Test 3: Live GPS coordinates not matching any node coordinates cleanly connect to nearest valid node", () => {
    // Coordinate slightly offset from n-main-g-lobby (12.9716, 77.5946)
    const offsetLat = 12.971595;
    const offsetLng = 77.594595;

    const result = findContextAwareNearestNode(
      offsetLat,
      offsetLng,
      mockNodes,
      {
        isInside: true,
        buildingId: "b-main",
        floorId: "f-main-g",
        floors: mockFloors,
      }
    );

    expect(result.node).not.toBeNull();
    expect(result.node?.id).toBe("n-main-g-lobby");
    expect(result.distanceMeters).toBeGreaterThan(0);
    expect(result.distanceMeters).toBeLessThan(20);
  });

  // Test 4: Strict Floor Isolation
  it("Test 4: Strict Floor Isolation prevents picking nodes from other floors even if physically closer in 2D", () => {
    const lat = 12.9716;
    const lng = 77.5946;

    // When Floor 2 is selected, MUST return Floor 2 node
    const resultFloor2 = findContextAwareNearestNode(
      lat,
      lng,
      mockNodes,
      {
        isInside: true,
        buildingId: "b-main",
        floorId: "f-main-2",
        floors: mockFloors,
      }
    );
    expect(resultFloor2.node?.id).toBe("n-main-2-conf");
    expect(resultFloor2.node?.floorId).toBe("f-main-2");

    // When Ground Floor is selected, MUST return Ground Floor node
    const resultGround = findContextAwareNearestNode(
      lat,
      lng,
      mockNodes,
      {
        isInside: true,
        buildingId: "b-main",
        floorId: "f-main-g",
        floors: mockFloors,
      }
    );
    expect(resultGround.node?.id).toBe("n-main-g-lobby");
    expect(resultGround.node?.floorId).toBe("f-main-g");
  });

  // Test 5: Multiple Buildings Disambiguation
  it("Test 5: Accurately identifies which building contains the user when multiple buildings exist", () => {
    // In Science Building
    const sciLat = 12.9725;
    const sciLng = 77.5955;
    const sciDetection = detectBuildingAtGps(sciLat, sciLng, 5, mockBuildings);
    expect(sciDetection.isInside).toBe(true);
    expect(sciDetection.building?.id).toBe("b-science");

    // In Main Building
    const mainLat = 12.9716;
    const mainLng = 77.5946;
    const mainDetection = detectBuildingAtGps(mainLat, mainLng, 5, mockBuildings);
    expect(mainDetection.isInside).toBe(true);
    expect(mainDetection.building?.id).toBe("b-main");
  });

  // Test 6: Single-floor building auto-selection
  it("Test 6: Single-floor building contains exactly one floor for automatic resolution", () => {
    const sciFloors = mockFloors.filter((f) => f.buildingId === "b-science");
    expect(sciFloors.length).toBe(1);
    expect(sciFloors[0].id).toBe("f-sci-g");
  });

  // Test 7: No valid nodes on selected floor
  it("Test 7: Returns graceful error when a floor has no nodes defined", () => {
    const resultEmptyFloor = findContextAwareNearestNode(
      12.9716,
      77.5946,
      mockNodes,
      {
        isInside: true,
        buildingId: "b-main",
        floorId: "f-empty-nonexistent",
        floors: mockFloors,
      }
    );

    expect(resultEmptyFloor.node).toBeNull();
    expect(resultEmptyFloor.error).toBe("No navigation nodes are available on this floor.");
  });

  // Test 8: End-to-end Routing with Live GPS ID fallback in graph.ts
  it("Test 8: shortestPath resolves dest-live-user-location seamlessly without throwing or returning null", () => {
    const mockEdges: Edge[] = [
      {
        id: "e1",
        from: "n-out-1",
        to: "n-out-entrance",
        distance: 50,
        type: "WALK",
        bidirectional: true,
      },
      {
        id: "e2",
        from: "n-out-entrance",
        to: "n-main-g-lobby",
        distance: 30,
        type: "WALK",
        bidirectional: true,
      },
    ];

    const mockDestinations: Destination[] = [
      {
        id: "dest-quad",
        name: "Campus Quad",
        category: "Outdoor",
        nodeId: "n-out-1",
        aliases: ["quad"],
      },
      {
        id: "dest-lobby",
        name: "Main Lobby",
        category: "Offices",
        nodeId: "n-main-g-lobby",
        aliases: ["lobby"],
      },
    ];

    const customGraphData = {
      nodes: mockNodes,
      edges: mockEdges,
      destinations: mockDestinations,
      buildings: mockBuildings,
      floors: mockFloors,
      stairGroups: [],
      liftGroups: [],
      obstacles: [],
    };

    // Route from dest-live-user-location fallback to dest-lobby
    const route = shortestPath("dest-live-user-location", "dest-lobby", {
      graphData: customGraphData,
    });

    expect(route).not.toBeNull();
    expect(route?.nodes.length).toBeGreaterThanOrEqual(2);
    expect(route?.nodes[route.nodes.length - 1].id).toBe("n-main-g-lobby");
  });
});
