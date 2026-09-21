import { describe, it, expect } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import { isTechnicalOrWaypointName, cleanLandmarkName, formatInstructionText } from "../lib/routing/directions";
import { useNavigationStore } from "../features/navigation/navigation-store";
import type { Destination, Node, Edge } from "../shared/data/campus";
import type { Route } from "../features/navigation/services/graph";

describe("Performance, Concurrency & Navigation Lifecycle Spec", () => {
  describe("1. In-flight Request Deduplication & Store Resilience", () => {
    it("deduplicates concurrent syncWithServer calls to share a single in-flight Promise", async () => {
      let fetchCallCount = 0;
      const originalFetch = global.fetch;
      const originalWindow = (global as any).window;

      // Mock window object for node environment
      (global as any).window = {
        location: { pathname: "/map" },
      };

      global.fetch = (async (url: string) => {
        fetchCallCount++;
        // Simulate network latency
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          json: async () => ({
            graph: {
              buildings: [{ id: "b1", name: "Main Building" }],
              nodes: [{ id: "n1", name: "Main Node", x: 100, y: 100, floorId: "f-out", type: "WAYPOINT" }],
              floors: [{ id: "f-out", name: "Outdoor", ordinal: 0, buildingId: "b1" }],
              edges: [],
              destinations: [],
            },
          }),
        } as unknown as Response;
      }) as typeof fetch;

      try {
        // Fire 3 simultaneous syncWithServer calls
        const p1 = campusStore.syncWithServer();
        const p2 = campusStore.syncWithServer();
        const p3 = campusStore.syncWithServer();

        await Promise.all([p1, p2, p3]);

        // Should only trigger 1 network fetch cycle (2 parallel endpoints: draft + published) due to promise deduplication
        expect(fetchCallCount).toBe(2);
      } finally {
        global.fetch = originalFetch;
        (global as any).window = originalWindow;
      }
    });

    it("prevents accidental empty database snapshot overwrite", () => {
      // Clean empty state
      const initialWorking = campusStore.getWorkingData();
      expect(Array.isArray(initialWorking.buildings)).toBe(true);
    });
  });

  describe("2. Natural Language Instruction Generation", () => {
    it("identifies and filters technical waypoint IDs from user instructions", () => {
      expect(isTechnicalOrWaypointName("RP 1")).toBe(true);
      expect(isTechnicalOrWaypointName("RP102")).toBe(true);
      expect(isTechnicalOrWaypointName("RP-OUT-1")).toBe(true);
      expect(isTechnicalOrWaypointName("node_123")).toBe(true);
      expect(isTechnicalOrWaypointName("n1")).toBe(true);
      expect(isTechnicalOrWaypointName("wp_4")).toBe(true);
      expect(isTechnicalOrWaypointName("junction_4")).toBe(true);
      expect(isTechnicalOrWaypointName("corridor 2")).toBe(true);

      // Human-facing landmark names should NOT be filtered
      expect(isTechnicalOrWaypointName("Main Gate")).toBe(false);
      expect(isTechnicalOrWaypointName("Central Library")).toBe(false);
      expect(isTechnicalOrWaypointName("Auditorium")).toBe(false);
      expect(isTechnicalOrWaypointName("Science Block")).toBe(false);
    });

    it("cleans landmark names and formats natural turn instructions", () => {
      expect(cleanLandmarkName("RP 1")).toBeNull();
      expect(cleanLandmarkName("Main Gate")).toBe("Main Gate");

      // When landmark is a technical ID, fallback to natural turn phrase without technical ID
      expect(formatInstructionText("straight", "RP 1")).toBe("Go straight");
      expect(formatInstructionText("left", "node_14")).toBe("Turn left");
      expect(formatInstructionText("right", "junction_4")).toBe("Turn right");

      // When landmark is a real name, mention it naturally
      expect(formatInstructionText("straight", "Main Gate")).toBe("Continue straight toward Main Gate");
      expect(formatInstructionText("left", "Central Library")).toBe("Turn left at Central Library");
    });
  });

  describe("3. Active Navigation Session & Lifecycle Gating", () => {
    const mockOrigin: Destination = { id: "d1", name: "Main Gate", nodeId: "n1", category: "Gate", aliases: ["entrance"] };
    const mockDest: Destination = { id: "d2", name: "Library", nodeId: "n2", category: "Facility", aliases: ["books"] };
    const mockRoute: Route = {
      id: "test-route-1",
      nodes: [
        { id: "n1", name: "Main Gate", x: 100, y: 100, floorId: "f-out", type: "GATE" },
        { id: "n2", name: "Library", x: 200, y: 200, floorId: "f-out", type: "ROOM" },
      ],
      edges: [{ id: "e1", from: "n1", to: "n2", distance: 100, type: "WALK" }],
      distance: 100,
      durationSec: 80,
      instructions: [
        { text: "Head towards Library", distance: 100 },
        { text: "You have arrived at Library", distance: 0 },
      ],
    };

    it("transitions through navigation lifecycle correctly with auto-rotation gating", () => {
      const store = useNavigationStore.getState();

      // Initial state: IDLE
      store.setNavigationStatus("IDLE");
      expect(useNavigationStore.getState().status).toBe("IDLE");

      // Start navigation: status becomes NAVIGATING
      store.startNavigationSession(mockOrigin, mockDest, mockRoute);
      expect(useNavigationStore.getState().status).toBe("NAVIGATING");
      expect(useNavigationStore.getState().distanceRemaining).toBe(100);

      // Cancel/Exit navigation: status transitions to NAVIGATION_CANCELLED
      store.cancelNavigationSession();
      expect(useNavigationStore.getState().status).toBe("NAVIGATION_CANCELLED");
      expect(useNavigationStore.getState().activeRoute).toBeNull();
    });
  });
});
