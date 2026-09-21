import { describe, it, expect } from "vitest";
import {
  generateDirections,
  calculateTurnAngle,
  turnIconFromAngle,
  getNodeVector,
  cleanLandmarkName,
  isTechnicalOrWaypointName,
  formatInstructionText,
} from "../lib/routing/directions";
import { buildAdjacencyGraph } from "../lib/routing/graph";
import { findShortestPath } from "../lib/routing/dijkstra";
import type { Node } from "../shared/data/campus";
import type { AdjacencyEdge } from "../lib/routing/graph";

describe("Turn Direction Classification & Vector Mathematics", () => {
  // Screen Coordinates (+X = East/Right, +Y = South/Down, -Y = North/Up)
  const northVec = { dx: 0, dy: -10 };
  const southVec = { dx: 0, dy: 10 };
  const eastVec = { dx: 10, dy: 0 };
  const westVec = { dx: -10, dy: 0 };

  it("TEST 1: North -> West results in LEFT turn", () => {
    const angle = calculateTurnAngle(northVec, westVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 2: North -> East results in RIGHT turn", () => {
    const angle = calculateTurnAngle(northVec, eastVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 3: East -> North results in LEFT turn", () => {
    const angle = calculateTurnAngle(eastVec, northVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 4: East -> South results in RIGHT turn", () => {
    const angle = calculateTurnAngle(eastVec, southVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 5: South -> East results in LEFT turn", () => {
    const angle = calculateTurnAngle(southVec, eastVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 6: South -> West results in RIGHT turn", () => {
    const angle = calculateTurnAngle(southVec, westVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 7: West -> South results in LEFT turn", () => {
    const angle = calculateTurnAngle(westVec, southVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 8: West -> North results in RIGHT turn", () => {
    const angle = calculateTurnAngle(westVec, northVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 9: Same direction results in STRAIGHT", () => {
    const angle = calculateTurnAngle(northVec, northVec);
    expect(angle).toBeCloseTo(0, 1);
    expect(turnIconFromAngle(angle)).toBe("straight");
  });

  it("TEST 10: Approximately 180° results in U-TURN", () => {
    const angle = calculateTurnAngle(northVec, southVec);
    expect(Math.abs(angle)).toBeCloseTo(180, 1);
    expect(turnIconFromAngle(angle)).toBe("u-turn");
  });

  it("User problem scenario: approaching intersection heading South and turning West/Right", () => {
    // Node A (100, 0) -> Node B (100, 100) [heading South] -> Node C (50, 100) [turning West]
    const nA: Node = { id: "nA", type: "CORRIDOR", floorId: "f-out", x: 100, y: 0, name: "Start Point" };
    const nB: Node = { id: "nB", type: "JUNCTION", floorId: "f-out", x: 100, y: 100, name: "Intersection" };
    const nC: Node = { id: "nC", type: "CORRIDOR", floorId: "f-out", x: 50, y: 100, name: "Destination" };

    const edges: AdjacencyEdge[] = [
      { edgeId: "e1", from: "nA", to: "nB", distance: 100, type: "WALK", bidirectional: true, weight: 100 },
      { edgeId: "e2", from: "nB", to: "nC", distance: 50, type: "WALK", bidirectional: true, weight: 50 },
    ];

    const steps = generateDirections([nA, nB, nC], edges);
    expect(steps.length).toBe(3);
    // Walking South and turning West is turning to the right of forward travel vector
    expect(steps[1].icon).toBe("right");
    expect(steps[1].text.toLowerCase()).toContain("right");
  });

  it("handles GPS-only coordinate vectors accurately", () => {
    // GPS Latitude: +Lat is North, +Lng is East
    // Point 1: (11.0, 77.0) -> Point 2: (11.001, 77.0) [Heading North]
    // Point 3: (11.001, 77.001) [Turning East]
    const g1: Node = { id: "g1", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, lat: 11.0, lng: 77.0 };
    const g2: Node = { id: "g2", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, lat: 11.001, lng: 77.0 };
    const g3: Node = { id: "g3", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, lat: 11.001, lng: 77.001 };

    const v1 = getNodeVector(g1, g2);
    const v2 = getNodeVector(g2, g3);

    const angle = calculateTurnAngle(v1, v2);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });
});

describe("Technical ID & Waypoint Filtering (No RP 1 / node_14 in User UI)", () => {
  it("filters out technical node IDs, waypoint tags, and temporary markers", () => {
    const technicalNames = [
      "RP 1",
      "RP 2",
      "RP 3",
      "RP-1",
      "RP_1",
      "RP10",
      "node_14",
      "node-14",
      "node 14",
      "n102",
      "n1",
      "wp_1",
      "waypoint 1",
      "junction_3",
      "junction 3",
      "jct 1",
      "corridor_2",
      "corridor 2",
      "stair_1",
      "lift_2",
      "door_1",
      "point_5",
      "pt 1",
      "seg_1",
      "segment 2",
      "123e4567-e89b-12d3-a456-426614174000",
      "n-17294827-abc",
    ];

    technicalNames.forEach((name) => {
      expect(isTechnicalOrWaypointName(name)).toBe(true);
      expect(cleanLandmarkName(name)).toBeNull();
    });
  });

  it("preserves genuine physical human landmarks", () => {
    const realLandmarks = [
      "Library",
      "Main Gate",
      "Reception",
      "RP Block",
      "Chemistry Lab",
      "Administrative Office",
      "Cafeteria",
      "Auditorium",
      "SF Entrance",
      "North Gate",
      "Physics Department",
      "Seminar Hall A",
    ];

    realLandmarks.forEach((name) => {
      expect(isTechnicalOrWaypointName(name)).toBe(false);
      expect(cleanLandmarkName(name)).toBe(name);
    });
  });

  it("generates clean natural walking instructions without RP 1 or node IDs", () => {
    const n1: Node = { id: "n1", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, name: "RP 1" };
    const n2: Node = { id: "n2", type: "OUTDOOR", floorId: "f-out", x: 50, y: 0, name: "RP 2" };
    const n3: Node = { id: "n3", type: "OUTDOOR", floorId: "f-out", x: 50, y: 50, name: "RP 3" };

    const edges: AdjacencyEdge[] = [
      { edgeId: "e1", from: "n1", to: "n2", distance: 50, type: "WALK", bidirectional: true, weight: 50 },
      { edgeId: "e2", from: "n2", to: "n3", distance: 50, type: "WALK", bidirectional: true, weight: 50 },
    ];

    const steps = generateDirections([n1, n2, n3], edges);

    // Step 1: Going from n1 to n2 -> "Go straight" (NOT "Go straight to RP 2")
    expect(steps[0].text).toBe("Go straight");
    expect(steps[0].text).not.toContain("RP");
    expect(steps[0].text).not.toContain("n2");

    // Step 2: Turning from East to South -> "Turn right" (NOT "Turn right at RP 3")
    expect(steps[1].text).toBe("Turn right");
    expect(steps[1].text).not.toContain("RP");
    expect(steps[1].text).not.toContain("n3");

    // Arrival Step -> "You have arrived" (NOT "Arrived at RP 3")
    expect(steps[2].text).toBe("You have arrived");
  });

  it("incorporates genuine physical landmarks when available", () => {
    const n1: Node = { id: "n1", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, name: "Main Gate" };
    const n2: Node = { id: "n2", type: "OUTDOOR", floorId: "f-out", x: 50, y: 0, name: "Reception" };
    const n3: Node = { id: "n3", type: "ROOM", floorId: "f-out", x: 50, y: 50, name: "Central Library" };

    const edges: AdjacencyEdge[] = [
      { edgeId: "e1", from: "n1", to: "n2", distance: 50, type: "WALK", bidirectional: true, weight: 50 },
      { edgeId: "e2", from: "n2", to: "n3", distance: 50, type: "WALK", bidirectional: true, weight: 50 },
    ];

    const steps = generateDirections([n1, n2, n3], edges);

    expect(steps[0].text).toBe("Continue straight toward Reception");
    expect(steps[1].text).toBe("Turn right at Central Library");
    expect(steps[2].text).toBe("You have arrived at Central Library");
  });
});

describe("Command Grammar & Transitions", () => {
  it("formats gentle, sharp, and u-turn commands accurately", () => {
    expect(formatInstructionText("slight-left")).toBe("Keep left");
    expect(formatInstructionText("slight-right")).toBe("Keep right");
    expect(formatInstructionText("left")).toBe("Turn left");
    expect(formatInstructionText("right")).toBe("Turn right");
    expect(formatInstructionText("sharp-left")).toBe("Turn sharply left");
    expect(formatInstructionText("sharp-right")).toBe("Turn sharply right");
    expect(formatInstructionText("u-turn")).toBe("Turn around");
    expect(formatInstructionText("arrive")).toBe("You have arrived");
  });

  it("formats vertical stair and lift transitions accurately", () => {
    expect(formatInstructionText("stairs-up", undefined, { from: "f-1", to: "f-2", toFloorName: "2nd Floor" })).toBe("Take stairs to 2nd Floor");
    expect(formatInstructionText("stairs-up")).toBe("Take the stairs");
    expect(formatInstructionText("lift", undefined, { from: "f-1", to: "f-3", toFloorName: "3rd Floor" })).toBe("Take lift to 3rd Floor");
    expect(formatInstructionText("lift")).toBe("Take the lift");
  });

  it("formats building entrance and exit transitions accurately", () => {
    expect(formatInstructionText("straight", undefined, undefined, true, "RP Block")).toBe("Enter RP Block");
    expect(formatInstructionText("straight", undefined, undefined, true, undefined)).toBe("Enter the building");
    expect(formatInstructionText("straight", undefined, undefined, false, undefined, true)).toBe("Exit the building");
  });
});

describe("Node Visibility Separation from Routing", () => {
  it("allows routing through hidden nodes without breaking shortest path", () => {
    // Route: A (visible) -> B (hidden, visibleToUser: false) -> C (visible)
    const nodeA: Node = { id: "nA", type: "CORRIDOR", floorId: "f-1", x: 0, y: 0, name: "Node A", visibleToUser: true };
    const nodeB: Node = { id: "nB", type: "CORRIDOR", floorId: "f-1", x: 50, y: 0, name: "Hidden Waypoint B", visibleToUser: false };
    const nodeC: Node = { id: "nC", type: "ROOM", floorId: "f-1", x: 100, y: 0, name: "Node C", visibleToUser: true };

    const rawEdges: any[] = [
      { id: "e1", from: "nA", to: "nB", distance: 50, type: "WALK", bidirectional: true },
      { id: "e2", from: "nB", to: "nC", distance: 50, type: "WALK", bidirectional: true },
    ];

    const { graph, nodeMap } = buildAdjacencyGraph([nodeA, nodeB, nodeC], rawEdges);
    const path = findShortestPath(graph, nodeMap, "nA", "nC");

    // Path must successfully route through hidden node B
    expect(path).not.toBeNull();
    expect(path?.nodes.map((n) => n.id)).toEqual(["nA", "nB", "nC"]);
    expect(path?.totalDistance).toBe(100);

    // Visual filter check: user map only visualizes nodes with visibleToUser !== false
    const renderedNodes = [nodeA, nodeB, nodeC].filter((n) => n.visibleToUser === undefined || n.visibleToUser === true);
    expect(renderedNodes.map((n) => n.id)).toEqual(["nA", "nC"]);
    expect(renderedNodes.some((n) => n.id === "nB")).toBe(false);
  });
});

describe("Reference Photo Navigation & Preloading Engine", () => {
  it("attaches photoUrl and targetNodeName to DirectionStep without base64 bloat", () => {
    const n1: Node = { id: "n1", type: "CORRIDOR", floorId: "f-1", x: 0, y: 0, name: "Start Point" };
    const n2: Node = {
      id: "n2",
      type: "ROOM",
      floorId: "f-1",
      x: 50,
      y: 0,
      name: "RP Block",
      photoUrl: "/api/nodes/n2/photo",
    };

    const edges: AdjacencyEdge[] = [
      { edgeId: "e1", from: "n1", to: "n2", distance: 50, type: "WALK", bidirectional: true, weight: 50 },
    ];

    const steps = generateDirections([n1, n2], edges);
    expect(steps.length).toBe(2); // 1 step + 1 arrival
    expect(steps[0].photoUrl).toBe("/api/nodes/n2/photo");
    expect(steps[0].targetNodeName).toBe("RP Block");
    expect(steps[1].photoUrl).toBe("/api/nodes/n2/photo");
  });
});

describe("Google Maps Navigation UX & Step Progression", () => {
  it("strictly filters technical IDs RP1, RP2, node_123, junction_4 from instructions", () => {
    const technicalNodes = ["RP1", "RP2", "node_123", "junction_4", "wp_1", "pt_2", "corr_3"];
    technicalNodes.forEach((name) => {
      expect(isTechnicalOrWaypointName(name)).toBe(true);
      expect(cleanLandmarkName(name)).toBeNull();
    });
  });

  it("formats standard Google Maps navigation step instructions cleanly", () => {
    expect(formatInstructionText("straight")).toBe("Go straight");
    expect(formatInstructionText("left")).toBe("Turn left");
    expect(formatInstructionText("right")).toBe("Turn right");
    expect(formatInstructionText("slight-left")).toBe("Keep left");
    expect(formatInstructionText("slight-right")).toBe("Keep right");
    expect(formatInstructionText("stairs-up")).toBe("Take the stairs");
    expect(formatInstructionText("lift")).toBe("Take the lift");
    expect(formatInstructionText("straight", undefined, undefined, true, "Main Block")).toBe("Enter Main Block");
    expect(formatInstructionText("arrive")).toBe("You have arrived");
  });
});

describe("Map Rotation Physics & Shortest Angular Path", () => {
  // Helper for shortest angular delta
  const shortestAngularDelta = (fromDeg: number, toDeg: number) => {
    return ((toDeg - fromDeg + 540) % 360) - 180;
  };

  it("handles 359° -> 0° transition as +1° movement instead of a 359° spin", () => {
    const delta = shortestAngularDelta(359, 0);
    expect(delta).toBe(1);
  });

  it("handles 0° -> 359° transition as -1° movement", () => {
    const delta = shortestAngularDelta(0, 359);
    expect(delta).toBe(-1);
  });

  it("handles cross-quadrant smooth transitions accurately", () => {
    expect(shortestAngularDelta(10, 350)).toBe(-20);
    expect(shortestAngularDelta(350, 10)).toBe(20);
    expect(shortestAngularDelta(179, 181)).toBe(2);
    expect(shortestAngularDelta(181, 179)).toBe(-2);
  });

  it("maintains mathematical user location invariance when rotating around user pivot", () => {
    // Let user position be (Ux, Uy)
    const Ux = 720;
    const Uy = 480;
    const angleDeg = 45;
    const rad = (angleDeg * Math.PI) / 180;

    // Standard 2D affine rotation of (Ux, Uy) around pivot (Ux, Uy):
    // X' = cos(theta) * (Ux - Ux) - sin(theta) * (Uy - Uy) + Ux = Ux
    // Y' = sin(theta) * (Ux - Ux) + cos(theta) * (Uy - Uy) + Uy = Uy
    const rotatedX = Math.cos(rad) * (Ux - Ux) - Math.sin(rad) * (Uy - Uy) + Ux;
    const rotatedY = Math.sin(rad) * (Ux - Ux) + Math.cos(rad) * (Uy - Uy) + Uy;

    expect(rotatedX).toBeCloseTo(Ux, 5);
    expect(rotatedY).toBeCloseTo(Uy, 5);
  });
});



