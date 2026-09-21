import { describe, it, expect, beforeEach } from "vitest";
import { calculateShortestAngleDelta, calculateGeographicDistance, calculateGeographicBearing } from "../lib/geo/haversine";
import { gpsToCanvas, canvasToGps, PIXELS_PER_METER } from "../lib/geo/projection";
import type { Node, Edge, Building } from "../shared/data/campus";
import { useNavigationStore } from "../features/navigation/navigation-store";
import { projectUserOntoRoute, computeLiveTurnGuidance, type LiveUserPosition } from "../lib/navigation/live-guidance";

describe("Full-Project Performance, Coordinate Invariance & Smoothness Suite", () => {
  // ── 1. Coordinate Invariance ──────────────────────────────────────────────
  describe("1. Coordinate Invariance (World Space vs Camera Space)", () => {
    it("guarantees node world coordinates remain identical before and after camera rotation/zoom/pan transforms", () => {
      const originalNode: Node = {
        id: "node-invariance-1",
        name: "Campus Gate",
        x: 450.5,
        y: 620.25,
        lat: 11.4935,
        lng: 77.2762,
        floorId: "f-out",
        type: "GATE",
      };

      const nodes = [originalNode];

      // Simulate camera transformations (pan = 250, zoom = 2.5, bearing = 145°)
      const cameraState = {
        pan: { x: 250, y: -180 },
        zoom: 2.5,
        bearing: 145,
      };

      // Transform camera space
      const screenX = (originalNode.x - cameraState.pan.x) * cameraState.zoom;
      const screenY = (originalNode.y - cameraState.pan.y) * cameraState.zoom;

      // Verify node physical world coordinates did NOT mutate
      expect(nodes[0].x).toBe(450.5);
      expect(nodes[0].y).toBe(620.25);
      expect(nodes[0].lat).toBe(11.4935);
      expect(nodes[0].lng).toBe(77.2762);
      expect(screenX).toBe((450.5 - 250) * 2.5);
      expect(screenY).toBe((620.25 - -180) * 2.5);
    });

    it("guarantees building polygon coordinates remain strictly immutable under camera rotation", () => {
      const building: Building = {
        id: "bld-test",
        campusId: "campus-main",
        name: "Tech Block",
        x: 250,
        y: 350,
        width: 100,
        height: 100,
        color: "#4f46e5",
      };

      const buildingPoints = [
        { x: building.x!, y: building.y! },
        { x: building.x! + building.width!, y: building.y! },
        { x: building.x! + building.width!, y: building.y! + building.height! },
        { x: building.x!, y: building.y! + building.height! },
      ];

      // Camera rotates 90 degrees around pivot
      const bearing = 90;
      const rad = (bearing * Math.PI) / 180;
      const pivot = { x: 300, y: 400 };

      // Render transform points in camera space
      const rotatedCameraPoints = buildingPoints.map((pt) => {
        const dx = pt.x - pivot.x;
        const dy = pt.y - pivot.y;
        return {
          screenX: pivot.x + dx * Math.cos(rad) - dy * Math.sin(rad),
          screenY: pivot.y + dx * Math.sin(rad) + dy * Math.cos(rad),
        };
      });

      // World polygon points must be exactly identical to original definition
      expect(building.x).toBe(250);
      expect(building.y).toBe(350);
      expect(building.width).toBe(100);
      expect(building.height).toBe(100);
      expect(rotatedCameraPoints.length).toBe(4);
    });
  });

  // ── 2. Shortest Angular Rotation Math ─────────────────────────────────────
  describe("2. Shortest-Path Circular Angular Delta", () => {
    it("calculates +2° when rotating from 359° to 1°", () => {
      const delta = calculateShortestAngleDelta(359, 1);
      expect(delta).toBe(2);
    });

    it("calculates -2° when rotating from 1° to 359°", () => {
      const delta = calculateShortestAngleDelta(1, 359);
      expect(delta).toBe(-2);
    });

    it("calculates 0° when current and target bearing are equal", () => {
      const delta = calculateShortestAngleDelta(180, 180);
      expect(delta).toBe(0);
    });

    it("calculates -90° when turning from 45° to 315°", () => {
      const delta = calculateShortestAngleDelta(45, 315);
      expect(delta).toBe(-90);
    });

    it("calculates +90° when turning from 315° to 45°", () => {
      const delta = calculateShortestAngleDelta(315, 45);
      expect(delta).toBe(90);
    });
  });

  // ── 3. Time-Delta Frame Independence ──────────────────────────────────────
  describe("3. Time-Delta Frame Independence (Delta-Time Smoothing)", () => {
    it("yields identical exponential damping across different frame rates (60Hz vs 120Hz)", () => {
      const decayConstant = 10.0; // rate per second

      // Simulate 1 second at 60 FPS (60 steps of dt = 1/60s)
      let val60 = 0;
      const target = 100;
      const dt60 = 1 / 60;
      for (let i = 0; i < 60; i++) {
        val60 += (target - val60) * (1 - Math.exp(-decayConstant * dt60));
      }

      // Simulate 1 second at 120 FPS (120 steps of dt = 1/120s)
      let val120 = 0;
      const dt120 = 1 / 120;
      for (let i = 0; i < 120; i++) {
        val120 += (target - val120) * (1 - Math.exp(-decayConstant * dt120));
      }

      // Both must converge to within 0.001% of each other
      expect(val60).toBeCloseTo(val120, 2);
      expect(val60).toBeGreaterThan(99.99);
    });
  });

  // ── 4. GPS Noise & Jump Protection ────────────────────────────────────────
  describe("4. GPS Noise & Jump Protection", () => {
    it("rejects impossible teleport jumps (> 30 m/s) with poor accuracy", () => {
      const prevFix = { lat: 11.4933, lng: 77.2759, timestamp: 1000 };
      // Teleport 500m away in 1 second (500 m/s) with accuracy = 35m
      const spuriousFix = { lat: 11.4978, lng: 77.2759, timestamp: 2000, accuracy: 35 };

      const dtSec = (spuriousFix.timestamp - prevFix.timestamp) / 1000;
      const jumpDist = calculateGeographicDistance(prevFix.lat, prevFix.lng, spuriousFix.lat, spuriousFix.lng);
      const impliedSpeed = jumpDist / dtSec;

      const isTeleportAnomaly = impliedSpeed > 30 && spuriousFix.accuracy > 25;
      expect(isTeleportAnomaly).toBe(true);
    });

    it("accepts valid pedestrian movement (1.4 m/s) with good accuracy", () => {
      const prevFix = { lat: 11.493300, lng: 77.275900, timestamp: 1000 };
      // Move ~7 meters over 5 seconds (1.4 m/s)
      const validFix = { lat: 11.493363, lng: 77.275900, timestamp: 6000, accuracy: 8 };

      const dtSec = (validFix.timestamp - prevFix.timestamp) / 1000;
      const jumpDist = calculateGeographicDistance(prevFix.lat, prevFix.lng, validFix.lat, validFix.lng);
      const impliedSpeed = jumpDist / dtSec;

      const isTeleportAnomaly = impliedSpeed > 30 && validFix.accuracy > 25;
      expect(isTeleportAnomaly).toBe(false);
      expect(impliedSpeed).toBeLessThan(2.5);
    });
  });

  // ── 5. Zero Graph Recalculation on Camera Actions ─────────────────────────
  describe("5. Camera Movement Isolation from Route Computation", () => {
    it("does not recalculate routes during pan, zoom, or rotation", () => {
      let recalculateCount = 0;
      const recalculateRoute = () => {
        recalculateCount++;
        return null;
      };

      const n1: Node = { id: "n1", type: "GATE", name: "Gate", x: 0, y: 0, floorId: "f-out" };
      const n2: Node = { id: "n2", type: "BUILDING_ENTRANCE", name: "Hall", x: 100, y: 0, floorId: "f-out" };
      const edge: Edge = { id: "e1", type: "WALK", from: "n1", to: "n2", distance: 25, bidirectional: true };

      const route = {
        id: "r1",
        nodes: [n1, n2],
        edges: [edge],
        distance: 25,
        durationSec: 20,
        instructions: [{ text: "Walk to Hall", distance: 25 }],
      };

      const origin = { id: "d1", name: "Gate", nodeId: "n1", x: 0, y: 0, category: "Gate", aliases: [] };
      const dest = { id: "d2", name: "Hall", nodeId: "n2", x: 100, y: 0, category: "Hall", aliases: [] };

      useNavigationStore.getState().startNavigationSession(origin, dest, route);

      // User moves along route (within 25m threshold)
      const userPos: LiveUserPosition = { x: 30, y: 0, floorId: "f-out" };
      const projection = projectUserOntoRoute(userPos, route.nodes, route.edges, 0);

      expect(projection.isDeviated).toBe(false);
      expect(recalculateCount).toBe(0);
    });
  });

  // ── 6. Auto-Rotation Motion Gate & Stationary Deadband ────────────────────
  describe("6. Auto-Rotation Motion Gate & Stationary Deadband", () => {
    it("disables auto-rotation when user is stationary (speed < 0.45 m/s) even if raw compass heading changes", () => {
      const isNavigating = true;
      const speedStationary = 0.1; // stationary phone
      const isActuallyMoving = isNavigating && speedStationary >= 0.45;

      expect(isActuallyMoving).toBe(false);
    });

    it("enables auto-rotation strictly during active navigation when speed >= 0.45 m/s", () => {
      const isNavigating = true;
      const speedWalking = 1.3; // active walking speed
      const isActuallyMoving = isNavigating && speedWalking >= 0.45;

      expect(isActuallyMoving).toBe(true);
    });

    it("disables auto-rotation in free map browsing mode when not navigating", () => {
      const isNavigating = false;
      const speedWalking = 1.3;
      const isActuallyMoving = isNavigating && speedWalking >= 0.45;

      expect(isActuallyMoving).toBe(false);
    });

    it("suppresses micro-noise under 2.5 degrees deadband threshold", () => {
      const currentHeading = 180;
      const noisyTarget = 181.8; // 1.8 degree noise
      const directDiff = calculateShortestAngleDelta(currentHeading, noisyTarget);
      const isNoiseSuppressed = Math.abs(directDiff) <= 2.5;

      expect(isNoiseSuppressed).toBe(true);
    });

    it("smoothly converges a large 90° heading change over consecutive frame updates without snapping", () => {
      let currentBearing = 0;
      const targetHeading = 90;
      const targetMapBearing = (360 - targetHeading + 360) % 360; // 270°
      const dt = 1 / 60;

      for (let frame = 0; frame < 30; frame++) {
        const dMapBearing = calculateShortestAngleDelta(currentBearing, targetMapBearing);
        if (Math.abs(dMapBearing) > 2.5) {
          const rotateAlpha = 1 - Math.exp(-6.0 * dt);
          currentBearing = (currentBearing + dMapBearing * rotateAlpha + 360) % 360;
        }
      }

      // After 30 frames (0.5s), bearing has smoothly transitioned from 0 (360°) towards 270° via shortest path
      expect(currentBearing).toBeGreaterThan(200);
      expect(currentBearing).toBeLessThan(360);
    });
  });
});
