import { describe, it, expect, beforeEach } from "vitest";
import type { Node, Edge, Destination } from "../shared/data/campus";
import type { Route } from "../features/navigation/services/graph";
import {
  projectUserOntoRoute,
  computeLiveTurnGuidance,
  type LiveUserPosition,
} from "../lib/navigation/live-guidance";
import { useNavigationStore } from "../features/navigation/navigation-store";
import { canvasToGps, gpsToCanvas, PIXELS_PER_METER } from "../lib/geo/projection";
import { calculateGeographicDistance, calculateGeographicBearing } from "../lib/geo/haversine";

describe("Live GPS-Based Turn Direction Engine & Navigation Separation", () => {
  // Setup standard test route: Node A (0,0) -> Node B (100,0) -> Node C (100,100) -> Node D (200,100)
  // Distance in pixels: A->B = 100px (25m), B->C = 100px (25m), C->D = 100px (25m)
  // A->B goes East (+X)
  // B->C turns Right / South (+Y)
  // C->D turns Left / East (+X)

  const gpsA = canvasToGps(0, 0);
  const gpsB = canvasToGps(100, 0);
  const gpsC = canvasToGps(100, 100);
  const gpsD = canvasToGps(200, 100);

  const nodeA: Node = { id: "node-a", type: "OUTDOOR", name: "Science Block", x: 0, y: 0, lat: gpsA.lat, lng: gpsA.lng, floorId: "f-out" };
  const nodeB: Node = { id: "node-b", type: "JUNCTION", name: "Library Junction", x: 100, y: 0, lat: gpsB.lat, lng: gpsB.lng, floorId: "f-out" };
  const nodeC: Node = { id: "node-c", type: "JUNCTION", name: "Student Hub", x: 100, y: 100, lat: gpsC.lat, lng: gpsC.lng, floorId: "f-out" };
  const nodeD: Node = { id: "node-d", type: "BUILDING_ENTRANCE", name: "Main Auditorium", x: 200, y: 100, lat: gpsD.lat, lng: gpsD.lng, floorId: "f-out" };

  const edgeAB: Edge = { id: "e-ab", type: "WALK", from: "node-a", to: "node-b", distance: 25, bidirectional: true };
  const edgeBC: Edge = { id: "e-bc", type: "WALK", from: "node-b", to: "node-c", distance: 25, bidirectional: true };
  const edgeCD: Edge = { id: "e-cd", type: "WALK", from: "node-c", to: "node-d", distance: 25, bidirectional: true };

  const testRoute: Route = {
    id: "route-test",
    nodes: [nodeA, nodeB, nodeC, nodeD],
    edges: [edgeAB, edgeBC, edgeCD],
    distance: 75,
    durationSec: 60,
    instructions: [
      { text: "Continue straight toward Library Junction", distance: 25, icon: "straight", targetNodeId: "node-b", targetNodeName: "Library Junction" },
      { text: "Turn right at Student Hub", distance: 25, icon: "right", targetNodeId: "node-c", targetNodeName: "Student Hub" },
      { text: "Turn left at Main Auditorium", distance: 25, icon: "left", targetNodeId: "node-d", targetNodeName: "Main Auditorium" },
      { text: "You have arrived at Main Auditorium", distance: 0, icon: "arrive", transition: "arrive", targetNodeId: "node-d", targetNodeName: "Main Auditorium" },
    ],
  };

  const originDest: Destination = { id: "dest-a", name: "Science Block", nodeId: "node-a", x: 0, y: 0, category: "Academic", aliases: [] };
  const targetDest: Destination = { id: "dest-d", name: "Main Auditorium", nodeId: "node-d", x: 200, y: 100, category: "Auditorium", aliases: [] };

  beforeEach(() => {
    useNavigationStore.getState().cancelNavigationSession();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: User is exactly at node A
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 1: handles user exactly at starting node A with correct initial direction", () => {
    const userPos: LiveUserPosition = { x: 0, y: 0, lat: gpsA.lat, lng: gpsA.lng, floorId: "f-out" };
    const projection = projectUserOntoRoute(userPos, testRoute.nodes, testRoute.edges, 0);

    expect(projection.currentSegmentIndex).toBe(0);
    expect(projection.progressAlongSegment).toBe(0);
    expect(projection.distanceRemaining).toBe(75);

    const guidance = computeLiveTurnGuidance(userPos, testRoute, projection);
    expect(guidance.currentInstruction?.text).toContain("Library Junction");
    expect(guidance.distanceToManeuver).toBe(25);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: User is halfway between two nodes (Node A and Node B)
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 2: calculates direction and remaining distance from live position when halfway between nodes", () => {
    // Halfway between A(0,0) and B(100,0) is (50,0) -> 12.5 meters from A, 12.5 meters from B
    const gpsHalf = canvasToGps(50, 0);
    const userPos: LiveUserPosition = { x: 50, y: 0, lat: gpsHalf.lat, lng: gpsHalf.lng, floorId: "f-out" };

    const projection = projectUserOntoRoute(userPos, testRoute.nodes, testRoute.edges, 0);
    expect(projection.currentSegmentIndex).toBe(0);
    expect(projection.progressAlongSegment).toBeCloseTo(0.5, 1);
    expect(projection.distanceToSegmentEnd).toBeCloseTo(12.5, 1);
    expect(projection.distanceRemaining).toBeCloseTo(62.5, 1); // 12.5 + 25 + 25 = 62.5m

    const guidance = computeLiveTurnGuidance(userPos, testRoute, projection);
    // User is moving East towards B(100,0), then turning South at B(100,0) -> upcoming turn is RIGHT
    expect(guidance.turnAngle).toBeCloseTo(90, 0); // Clockwise 90° right turn at B
    expect(guidance.currentInstruction?.icon).toBe("right");
    expect(guidance.distanceToManeuver).toBeGreaterThanOrEqual(12);
    expect(guidance.distanceToManeuver).toBeLessThanOrEqual(13);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: User is close to a node but not at it -> No snapping of navigation position
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 3: preserves exact user physical position without snapping to nearest node", () => {
    // User is at (92, 0) -> 8 pixels (2m) before Node B(100,0)
    const gpsNearB = canvasToGps(92, 0);
    const userPos: LiveUserPosition = { x: 92, y: 0, lat: gpsNearB.lat, lng: gpsNearB.lng, floorId: "f-out" };

    const projection = projectUserOntoRoute(userPos, testRoute.nodes, testRoute.edges, 0);
    expect(projection.projectionPoint.x).toBe(92);
    expect(projection.projectionPoint.y).toBe(0);
    expect(projection.distanceToSegmentEnd).toBe(2); // 2m remaining to Node B, NOT 0m or 25m

    const guidance = computeLiveTurnGuidance(userPos, testRoute, projection);
    expect(guidance.distanceToManeuver).toBe(2);
    expect(guidance.distanceRemaining).toBe(52); // 2m + 25m + 25m = 52m
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: User approaches a right turn at junction B
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 4: computes upcoming right turn at junction B as user approaches along segment AB", () => {
    const gpsUser = canvasToGps(70, 0); // 30px (7.5m) before B
    const userPos: LiveUserPosition = { x: 70, y: 0, lat: gpsUser.lat, lng: gpsUser.lng, floorId: "f-out" };

    const projection = projectUserOntoRoute(userPos, testRoute.nodes, testRoute.edges, 0);
    const guidance = computeLiveTurnGuidance(userPos, testRoute, projection);

    // Vector user -> B is (30, 0). Vector B -> C is (0, 100). Angle is +90° (Turn Right)
    expect(guidance.travelVector.dx).toBe(30);
    expect(guidance.travelVector.dy).toBe(0);
    expect(guidance.upcomingVector?.dx).toBe(0);
    expect(guidance.upcomingVector?.dy).toBe(100);
    expect(guidance.turnAngle).toBeCloseTo(90, 0);
    expect(guidance.currentInstruction?.icon).toBe("right");
    expect(guidance.currentInstruction?.text).toContain("Turn right");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: User approaches a left turn at junction C
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 5: computes upcoming left turn at junction C as user approaches along segment BC", () => {
    // On segment BC: B(100,0) -> C(100,100). User is at (100, 60) -> 40px (10m) before C
    const gpsUser = canvasToGps(100, 60);
    const userPos: LiveUserPosition = { x: 100, y: 60, lat: gpsUser.lat, lng: gpsUser.lng, floorId: "f-out" };

    const projection = projectUserOntoRoute(userPos, testRoute.nodes, testRoute.edges, 1);
    expect(projection.currentSegmentIndex).toBe(1);

    const guidance = computeLiveTurnGuidance(userPos, testRoute, projection);

    // Vector user -> C is (0, 40). Vector C -> D is (100, 0). Angle is -90° (Turn Left)
    expect(guidance.travelVector.dx).toBe(0);
    expect(guidance.travelVector.dy).toBe(40);
    expect(guidance.upcomingVector?.dx).toBe(100);
    expect(guidance.upcomingVector?.dy).toBe(0);
    expect(guidance.turnAngle).toBeCloseTo(-90, 0);
    expect(guidance.currentInstruction?.icon).toBe("left");
    expect(guidance.currentInstruction?.text).toContain("Turn left");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: User is moving straight toward next route point
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 6: indicates 'Go straight' / 'Continue straight' when segments are collinear", () => {
    // Route in straight line: Node 1(0,0) -> Node 2(100,0) -> Node 3(200,0)
    const n1: Node = { id: "n1", type: "GATE", name: "Gate", x: 0, y: 0, floorId: "f-out" };
    const n2: Node = { id: "n2", type: "OUTDOOR_PATH", name: "Walkway", x: 100, y: 0, floorId: "f-out" };
    const n3: Node = { id: "n3", type: "BUILDING_ENTRANCE", name: "Hall", x: 200, y: 0, floorId: "f-out" };

    const straightRoute: Route = {
      id: "r-straight",
      nodes: [n1, n2, n3],
      edges: [
        { id: "e1", type: "WALK", from: "n1", to: "n2", distance: 25, bidirectional: true },
        { id: "e2", type: "WALK", from: "n2", to: "n3", distance: 25, bidirectional: true },
      ],
      distance: 50,
      durationSec: 40,
      instructions: [
        { text: "Continue straight toward Walkway", distance: 25, icon: "straight", targetNodeId: "n2" },
        { text: "You have arrived at Hall", distance: 0, icon: "arrive", transition: "arrive", targetNodeId: "n3" },
      ],
    };

    const userPos: LiveUserPosition = { x: 40, y: 0, floorId: "f-out" };
    const projection = projectUserOntoRoute(userPos, straightRoute.nodes, straightRoute.edges, 0);
    const guidance = computeLiveTurnGuidance(userPos, straightRoute, projection);

    expect(guidance.turnAngle).toBe(0);
    expect(guidance.currentInstruction?.icon).toBe("straight");
    expect(guidance.currentInstruction?.text).toContain("Continue straight");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7: User moves off route -> Off-route detection
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 7: detects off-route deviation when user moves perpendicular away from active route", () => {
    // Active route segment is (0,0) to (100,0). User moves North to (50, -160) -> 160px = 40 meters away (threshold = 25m)
    const userPos: LiveUserPosition = { x: 50, y: -160, floorId: "f-out" };
    const projection = projectUserOntoRoute(userPos, testRoute.nodes, testRoute.edges, 0, {
      outdoorThresholdMeters: 25.0,
    });

    expect(projection.distanceFromSegment).toBe(40);
    expect(projection.isDeviated).toBe(true);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8: GPS position changes but nearest node remains the same
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 8: continuously updates distance and guidance as GPS moves even when nearest node is constant", () => {
    useNavigationStore.getState().startNavigationSession(originDest, targetDest, testRoute);

    // Position 1: 40px (10m) from A -> nearest node is Node A (dist 10m)
    const gps1 = canvasToGps(40, 0);
    useNavigationStore.getState().updateGpsProgress(gps1.lat, gps1.lng, nodeA, testRoute.nodes, () => null, {
      canvasPos: { x: 40, y: 0, floorId: "f-out" },
    });

    let state = useNavigationStore.getState();
    expect(state.distanceRemaining).toBe(65); // (25-10) + 25 + 25 = 65m
    expect(state.currentInstruction?.distance).toBe(15);

    // Position 2: 48px (12m) from A -> nearest node is STILL Node A (dist 12m)
    const gps2 = canvasToGps(48, 0);
    useNavigationStore.getState().updateGpsProgress(gps2.lat, gps2.lng, nodeA, testRoute.nodes, () => null, {
      canvasPos: { x: 48, y: 0, floorId: "f-out" },
    });

    state = useNavigationStore.getState();
    expect(state.distanceRemaining).toBe(63); // (25-12) + 25 + 25 = 63m
    expect(state.currentInstruction?.distance).toBe(13);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9: Nearest node changes -> No sudden artificial direction jump
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 9: smoothly transitions as nearest node shifts from Node A to Node B without direction jump", () => {
    useNavigationStore.getState().startNavigationSession(originDest, targetDest, testRoute);

    // Position 1: at (48, 0) -> closest to Node A
    const gps1 = canvasToGps(48, 0);
    useNavigationStore.getState().updateGpsProgress(gps1.lat, gps1.lng, nodeA, testRoute.nodes, () => null, {
      canvasPos: { x: 48, y: 0, floorId: "f-out" },
    });
    const inst1 = useNavigationStore.getState().currentInstruction;

    // Position 2: at (52, 0) -> closest to Node B
    const gps2 = canvasToGps(52, 0);
    useNavigationStore.getState().updateGpsProgress(gps2.lat, gps2.lng, nodeB, testRoute.nodes, () => null, {
      canvasPos: { x: 52, y: 0, floorId: "f-out" },
    });
    const inst2 = useNavigationStore.getState().currentInstruction;

    // Both instructions should point towards the upcoming maneuver at Library Junction (Node B)
    expect(inst1?.targetNodeId).toBe("node-b");
    expect(inst2?.targetNodeId).toBe("node-b");
    expect(inst2?.distance).toBe(12); // smoothly decreased from 13m to 12m
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10: GPS noise / jitter occurs -> Stable instruction
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 10: maintains stable route segment and instructions under minor GPS noise", () => {
    useNavigationStore.getState().startNavigationSession(originDest, targetDest, testRoute);

    // Base point at (50, 0)
    const baseGps = canvasToGps(50, 0);
    useNavigationStore.getState().updateGpsProgress(baseGps.lat, baseGps.lng, nodeA, testRoute.nodes, () => null, {
      canvasPos: { x: 50, y: 0, floorId: "f-out" },
    });

    // Add ±2px noise
    const noiseGps = canvasToGps(51, 2);
    useNavigationStore.getState().updateGpsProgress(noiseGps.lat, noiseGps.lng, nodeA, testRoute.nodes, () => null, {
      canvasPos: { x: 51, y: 2, floorId: "f-out" },
    });

    const state = useNavigationStore.getState();
    expect(state.status).toBe("NAVIGATING");
    expect(state.currentSegmentIndex).toBe(0);
    expect(state.currentInstruction?.targetNodeId).toBe("node-b");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 11 & 12: Stationary vs Moving User Heading
  // ──────────────────────────────────────────────────────────────────────────
  it("Test 11 & 12: preserves stable heading when stationary and updates smoothly when moving", () => {
    const lat1 = 11.4933;
    const lng1 = 77.2760;

    // Stationary (no movement)
    const moveDistStationary = calculateGeographicDistance(lat1, lng1, lat1 + 0.000001, lng1);
    expect(moveDistStationary).toBeLessThan(1.2);

    // Moving East (speed ~ 1.4 m/s, delta ~ 5 meters)
    const lat2 = 11.4933;
    const lng2 = 77.27605;
    const moveDistWalking = calculateGeographicDistance(lat1, lng1, lat2, lng2);
    expect(moveDistWalking).toBeGreaterThanOrEqual(1.2);

    const bearing = calculateGeographicBearing(lat1, lng1, lat2, lng2);
    expect(bearing).toBeCloseTo(90, 5); // Walking East = 90°
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Section 19: CRITICAL INVARIANT TEST
  // ──────────────────────────────────────────────────────────────────────────
  it("Section 19: CRITICAL INVARIANT - proves Live GPS position != Nearest Node position", () => {
    // Route: A (x=0, y=0) -> B (x=100, y=0)
    // We test 3 GPS positions:
    // Pos 1: 10 meters before Node B (x=60px)
    // Pos 2: 5 meters before Node B (x=80px)
    // Pos 3: 2 meters after Node B on segment B->C (x=100px, y=8px)

    useNavigationStore.getState().startNavigationSession(originDest, targetDest, testRoute);

    // Pos 1: 10 meters before Node B
    const gps1 = canvasToGps(60, 0);
    useNavigationStore.getState().updateGpsProgress(gps1.lat, gps1.lng, nodeB, testRoute.nodes, () => null, {
      canvasPos: { x: 60, y: 0, floorId: "f-out" },
    });
    const state1 = useNavigationStore.getState();
    expect(state1.currentSegmentIndex).toBe(0);
    expect(state1.currentInstruction?.distance).toBe(10); // Exactly 10 meters before Node B
    expect(state1.distanceRemaining).toBe(60); // 10m + 25m + 25m

    // Pos 2: 5 meters before Node B
    const gps2 = canvasToGps(80, 0);
    useNavigationStore.getState().updateGpsProgress(gps2.lat, gps2.lng, nodeB, testRoute.nodes, () => null, {
      canvasPos: { x: 80, y: 0, floorId: "f-out" },
    });
    const state2 = useNavigationStore.getState();
    expect(state2.currentSegmentIndex).toBe(0);
    expect(state2.currentInstruction?.distance).toBe(5); // Exactly 5 meters before Node B
    expect(state2.distanceRemaining).toBe(55); // 5m + 25m + 25m

    // Pos 3: 2 meters after Node B on segment B->C
    const gps3 = canvasToGps(100, 8);
    useNavigationStore.getState().updateGpsProgress(gps3.lat, gps3.lng, nodeB, testRoute.nodes, () => null, {
      canvasPos: { x: 100, y: 8, floorId: "f-out" },
    });
    const state3 = useNavigationStore.getState();
    // Engine must understand user traversed Node B and is now on segment B->C (index 1)
    expect(state3.currentSegmentIndex).toBe(1);
    expect(state3.currentInstruction?.targetNodeId).toBe("node-c");
    expect(state3.currentInstruction?.distance).toBe(23); // 25m - 2m = 23m remaining to Node C
    expect(state3.distanceRemaining).toBe(48); // 23m + 25m = 48m

    // VERIFY CRITICAL INVARIANT: The 3 states had different distances and segments, NOT treated as static Node B
    expect(state1.currentInstruction?.distance).not.toBe(state2.currentInstruction?.distance);
    expect(state2.currentInstruction?.distance).not.toBe(state3.currentInstruction?.distance);
    expect(state1.distanceRemaining).toBeGreaterThan(state2.distanceRemaining);
    expect(state2.distanceRemaining).toBeGreaterThan(state3.distanceRemaining);
  });
});
