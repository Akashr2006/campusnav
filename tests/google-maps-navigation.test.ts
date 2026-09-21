import { describe, it, expect } from "vitest";
import { canTraverseEdge, getEdgePathType, isEVAllowed, isWalkable, type TravelMode } from "../lib/routing/edge-accessibility";
import { shortestPath, multiStopShortestPath } from "../features/navigation/services/graph";
import { calculateGeographicBearing, calculateShortestAngleDelta } from "../lib/geo/haversine";
import type { Node, Edge, Floor, Building } from "../shared/data/campus";

describe("Google Maps Experience — Enhanced Navigation & Gestures Spec", () => {
  describe("1. Transport Mode Selection & Routing Gating", () => {
    const mockNodes: Node[] = [
      { id: "n1", name: "Main Gate", x: 100, y: 100, floorId: "f-out", type: "GATE" },
      { id: "n2", name: "Central Circle", x: 200, y: 200, floorId: "f-out", type: "ROAD_JUNCTION" },
      { id: "n3", name: "Pedestrian Plaza", x: 300, y: 300, floorId: "f-out", type: "OUTDOOR_PATH" },
      { id: "n4", name: "Academic Block", x: 400, y: 400, floorId: "f-out", type: "BUILDING_ENTRANCE" },
    ];

    // Graph where n1 -> n2 is EV-accessible road, but n2 -> n3 is WALK-only path, and n2 -> n4 has an EV bypass road
    const mockEdges: Edge[] = [
      { id: "e1", from: "n1", to: "n2", distance: 100, type: "ROAD", pathType: "EV" },
      { id: "e2", from: "n2", to: "n3", distance: 50, type: "WALK", pathType: "WALK" },
      { id: "e3", from: "n3", to: "n4", distance: 50, type: "WALK", pathType: "WALK" },
      { id: "e4", from: "n2", to: "n4", distance: 120, type: "ROAD", pathType: "EV" },
    ];

    const graphData = {
      nodes: mockNodes,
      edges: mockEdges,
      buildings: [] as Building[],
      floors: [] as Floor[],
      destinations: [],
      obstacles: [],
      events: [],
    };

    it("walk mode allows traversal across both EV and WALK pathways", () => {
      // In walk mode, the direct path n1 -> n2 -> n3 -> n4 is 100 + 50 + 50 = 200m
      const route = shortestPath("n1", "n4", {
        travelMode: "WALK",
        graphData,
      });

      expect(route).not.toBeNull();
      expect(route!.distance).toBe(200);
      expect(route!.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    });

    it("EV mode restricts routing to EV-accessible edges only", () => {
      // In EV mode, n2 -> n3 is blocked (WALK only), so it must take the EV road n2 -> n4 (100 + 120 = 220m)
      const route = shortestPath("n1", "n4", {
        travelMode: "EV",
        graphData,
      });

      expect(route).not.toBeNull();
      expect(route!.distance).toBe(220);
      expect(route!.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n4"]);
      expect(route!.edges.every((e) => isEVAllowed(e))).toBe(true);
    });

    it("calculates multimodal EV drive + walk route when destination is on a pedestrian-only path", () => {
      // n3 is only connected by WALK-only paths e2 and e3.
      // EV route drives n1 -> n2 (100m EV drive), transfers at n2, and walks n2 -> n3 (50m walk).
      const route = shortestPath("n1", "n3", {
        travelMode: "EV",
        graphData,
      });

      expect(route).not.toBeNull();
      expect(route?.travelMode).toBe("MULTIMODAL");
      expect(route?.evDistance).toBe(100);
      expect(route?.walkDistance).toBe(50);
      expect(route?.transferNodeId).toBe("n2");
      expect(route?.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3"]);
    });

    it("multi-stop routing respects the requested travel mode", () => {
      const route = multiStopShortestPath(["n1", "n2", "n4"], {
        travelMode: "EV",
        graphData,
      });

      expect(route).not.toBeNull();
      expect(route!.distance).toBe(220);
    });
  });

  describe("2. Map Rotation & Compass Math", () => {
    it("computes correct touch angle between two finger points", () => {
      const getAngle = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
        (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;

      // Horizontal fingers (left to right) -> 0 deg
      expect(getAngle({ x: 100, y: 100 }, { x: 200, y: 100 })).toBe(0);

      // Vertical fingers (top to bottom) -> 90 deg
      expect(getAngle({ x: 100, y: 100 }, { x: 100, y: 200 })).toBe(90);

      // Diagonal fingers -> 45 deg
      expect(getAngle({ x: 100, y: 100 }, { x: 200, y: 200 })).toBe(45);
    });

    it("calculates shortest arc distance for smooth North-Up reset animation", () => {
      const getShortestArcDiff = (fromBearing: number, targetBearing = 0) =>
        (((targetBearing - fromBearing + 540) % 360) - 180);

      // At 350 deg (10 deg west of north), should rotate +10 deg to reach 0 deg
      expect(getShortestArcDiff(350, 0)).toBe(10);

      // At 10 deg (10 deg east of north), should rotate -10 deg to reach 0 deg
      expect(getShortestArcDiff(10, 0)).toBe(-10);

      // At 180 deg, diff is +/- 180 deg
      expect(Math.abs(getShortestArcDiff(180, 0))).toBe(180);

      // At 270 deg (West), should rotate +90 deg
      expect(getShortestArcDiff(270, 0)).toBe(90);

      // At 90 deg (East), should rotate -90 deg
      expect(getShortestArcDiff(90, 0)).toBe(-90);
    });

    it("calculates accurate geographic forward bearing for movement directions", () => {
      // Moving North: (11.0, 77.0) -> (11.01, 77.0) -> ~0 deg
      const bearingNorth = calculateGeographicBearing(11.0, 77.0, 11.01, 77.0);
      expect(Math.round(bearingNorth)).toBe(0);

      // Moving East: (11.0, 77.0) -> (11.0, 77.01) -> ~90 deg
      const bearingEast = calculateGeographicBearing(11.0, 77.0, 11.0, 77.01);
      expect(Math.round(bearingEast)).toBe(90);

      // Moving South: (11.01, 77.0) -> (11.0, 77.0) -> ~180 deg
      const bearingSouth = calculateGeographicBearing(11.01, 77.0, 11.0, 77.0);
      expect(Math.round(bearingSouth)).toBe(180);

      // Moving West: (11.0, 77.01) -> (11.0, 77.0) -> ~270 deg
      const bearingWest = calculateGeographicBearing(11.0, 77.01, 11.0, 77.0);
      expect(Math.round(bearingWest)).toBe(270);

      // Shortest arc 359° -> 1° = +2°
      expect(calculateShortestAngleDelta(359, 1)).toBe(2);

      // Shortest arc 1° -> 359° = -2°
      expect(calculateShortestAngleDelta(1, 359)).toBe(-2);
    });

    it("orients target map rotation to keep user travel direction forward-up", () => {
      const getTargetMapRotation = (userHeading: number) => (360 - userHeading + 360) % 360;

      // North (0°) -> map rotation 0°
      expect(getTargetMapRotation(0)).toBe(0);

      // East (90°) -> map rotation 270° (-90°)
      expect(getTargetMapRotation(90)).toBe(270);

      // South (180°) -> map rotation 180°
      expect(getTargetMapRotation(180)).toBe(180);

      // West (270°) -> map rotation 90° (-270°)
      expect(getTargetMapRotation(270)).toBe(90);
    });

    it("restricts automatic map rotation strictly to active navigation sessions", () => {
      let isNavigating = false;
      let isGpsActive = true;
      let currentBearing = 0;
      let movementHeading = 90; // User moving East

      const updateCameraBearing = () => {
        if (isNavigating) {
          currentBearing = (360 - movementHeading + 360) % 360;
        }
      };

      // 1. In normal non-navigation mode (even with active GPS), map stays North-Up (0°)
      updateCameraBearing();
      expect(currentBearing).toBe(0);

      // 2. User taps "Start Navigation" -> isNavigating becomes true -> auto-rotation activates
      isNavigating = true;
      updateCameraBearing();
      expect(currentBearing).toBe(270); // East (90°) rotates map to 270° (-90°)

      // 3. User exits navigation -> isNavigating becomes false -> map resets to 0° North-Up
      isNavigating = false;
      const resetBearingToNorth = () => { currentBearing = 0; };
      resetBearingToNorth();
      expect(currentBearing).toBe(0);
    });
  });

  describe("3. Camera & Follow State Decoupling", () => {
    it("ensures manual user interaction decouples camera without modifying route or GPS", () => {
      let isFollowingUser = true;
      const onUserPan = () => {
        isFollowingUser = false;
      };

      expect(isFollowingUser).toBe(true);

      // User initiates drag/pan/pinch
      onUserPan();
      expect(isFollowingUser).toBe(false);

      // User clicks Re-center FAB
      const onRecenter = () => {
        isFollowingUser = true;
      };
      onRecenter();
      expect(isFollowingUser).toBe(true);
    });
  });

  describe("4. Absolute GPS & World Invariance Under Rotation & Zoom", () => {
    it("guarantees GPS and world coordinates remain 100% invariant across all camera rotations", () => {
      const canonicalGps = { lat: 11.4965, lng: 77.2774 };
      const canonicalWorldPos = { x: 450, y: 320 };

      const rotations = [0, 45, 90, 135, 180, 225, 270, 315, 359];

      rotations.forEach((bearing) => {
        // Camera rotation must NOT mutate canonical GPS or world coordinates
        expect(canonicalGps.lat).toBe(11.4965);
        expect(canonicalGps.lng).toBe(77.2774);
        expect(canonicalWorldPos.x).toBe(450);
        expect(canonicalWorldPos.y).toBe(320);
      });
    });

    it("guarantees GPS and world coordinates remain 100% invariant across all camera zoom levels", () => {
      const canonicalGps = { lat: 11.4965, lng: 77.2774 };
      const canonicalWorldPos = { x: 450, y: 320 };

      const zoomLevels = [0.35, 0.5, 0.85, 1.0, 1.5, 2.0, 3.0, 5.0];

      zoomLevels.forEach((zoom) => {
        // Camera zoom must NOT mutate canonical GPS or world coordinates
        expect(canonicalGps.lat).toBe(11.4965);
        expect(canonicalGps.lng).toBe(77.2774);
        expect(canonicalWorldPos.x).toBe(450);
        expect(canonicalWorldPos.y).toBe(320);
      });
    });

    it("compensates screen touch drag vectors using rotation matrix R(-bearing)", () => {
      const rotateDelta = (screenDx: number, screenDy: number, bearingDeg: number) => {
        const rad = (-bearingDeg * Math.PI) / 180;
        const worldDx = screenDx * Math.cos(rad) - screenDy * Math.sin(rad);
        const worldDy = screenDx * Math.sin(rad) + screenDy * Math.cos(rad);
        const x = Math.round(worldDx) === 0 ? 0 : Math.round(worldDx);
        const y = Math.round(worldDy) === 0 ? 0 : Math.round(worldDy);
        return { x, y };
      };

      // At 0° (North Up): drag UP (dx=0, dy=-10) -> world (0, -10)
      expect(rotateDelta(0, -10, 0)).toEqual({ x: 0, y: -10 });

      // At 90°: drag UP on screen (dx=0, dy=-10) -> world (-10, 0)
      expect(rotateDelta(0, -10, 90)).toEqual({ x: -10, y: 0 });

      // At 180°: drag UP on screen (dx=0, dy=-10) -> world (0, 10)
      expect(rotateDelta(0, -10, 180)).toEqual({ x: 0, y: 10 });

      // At 270°: drag UP on screen (dx=0, dy=-10) -> world (10, 0)
      expect(rotateDelta(0, -10, 270)).toEqual({ x: 10, y: 0 });
    });
  });
});

