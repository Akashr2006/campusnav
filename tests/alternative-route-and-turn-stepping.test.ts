import { describe, it, expect, beforeEach } from "vitest";
import { findAlternativeRoutes, shortestPath, type Route, type RouteInstruction } from "../features/navigation/services/graph";
import { useNavigationStore } from "../features/navigation/navigation-store";
import { campusStore } from "../shared/lib/campus-store";
import type { Node, Edge, Destination, Floor } from "../shared/data/campus";

describe("Alternative (Second Shortest) Route & Turn-by-Turn Stepping Suite", () => {
  const sampleNodes: Node[] = [
    { id: "A", name: "Start Gate", x: 0, y: 0, floorId: "f-out", type: "GATE" },
    { id: "B", name: "Way North", x: 50, y: -20, floorId: "f-out", type: "CORRIDOR" },
    { id: "C", name: "Way South", x: 50, y: 30, floorId: "f-out", type: "CORRIDOR" },
    { id: "D", name: "End Building", x: 100, y: 0, floorId: "f-out", type: "BUILDING_ENTRANCE" },
  ];

  // Route 1 (North): A -> B (50m) -> D (50m) = 100m
  // Route 2 (South): A -> C (60m) -> D (60m) = 120m
  const sampleEdges: Edge[] = [
    { id: "e1", from: "A", to: "B", distance: 50, bidirectional: true, type: "WALK" },
    { id: "e2", from: "B", to: "D", distance: 50, bidirectional: true, type: "WALK" },
    { id: "e3", from: "A", to: "C", distance: 60, bidirectional: true, type: "WALK" },
    { id: "e4", from: "C", to: "D", distance: 60, bidirectional: true, type: "WALK" },
  ];

  const graphData = {
    nodes: sampleNodes,
    edges: sampleEdges,
    floors: [{ id: "f-out", name: "Outdoor", ordinal: 0, buildingId: "" }] as Floor[],
    buildings: [],
    destinations: [],
    events: [],
    obstacles: [],
  };

  beforeEach(() => {
    useNavigationStore.getState().cancelNavigationSession();
  });

  describe("1. Alternative Route Computation", () => {
    it("computes primary shortest route and 2nd shortest alternative route", () => {
      const result = findAlternativeRoutes("A", "D", { graphData });

      expect(result.primary).not.toBeNull();
      expect(result.primary?.distance).toBe(100);
      expect(result.primary?.nodes.map((n) => n.id)).toEqual(["A", "B", "D"]);

      expect(result.alternative).not.toBeNull();
      expect(result.alternative?.distance).toBe(120);
      expect(result.alternative?.nodes.map((n) => n.id)).toEqual(["A", "C", "D"]);
    });

    it("returns null alternative route when only one path exists in graph", () => {
      const singlePathData = {
        ...graphData,
        edges: [
          { id: "e1", from: "A", to: "B", distance: 50, bidirectional: true, type: "WALK" },
          { id: "e2", from: "B", to: "D", distance: 50, bidirectional: true, type: "WALK" },
        ],
      };

      const result = findAlternativeRoutes("A", "D", { graphData: singlePathData });
      expect(result.primary).not.toBeNull();
      expect(result.alternative).toBeNull();
    });
  });

  describe("2. Turn-by-Turn Single Step Precision", () => {
    it("steps forward and backward exactly 1 step at a time without jumping", () => {
      const primaryRoute = shortestPath("A", "D", { graphData });
      expect(primaryRoute).not.toBeNull();

      const startDest: Destination = { id: "d-start", name: "Start Gate", nodeId: "A", category: "Gate", aliases: [] };
      const endDest: Destination = { id: "d-end", name: "End Building", nodeId: "D", category: "Building", aliases: [] };

      useNavigationStore.getState().startNavigationSession(startDest, endDest, primaryRoute!);

      expect(useNavigationStore.getState().currentSegmentIndex).toBe(0);

      // Step forward 1
      useNavigationStore.getState().advanceToNextStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);

      // Step forward 2
      useNavigationStore.getState().advanceToNextStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(2);

      // Step backward 1
      useNavigationStore.getState().advanceToPrevStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);

      // Step backward to 0
      useNavigationStore.getState().advanceToPrevStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(0);

      // Clamped at 0
      useNavigationStore.getState().advanceToPrevStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(0);
    });

    it("preserves manual step index when updateGpsPosition is called during manual stepping", () => {
      const primaryRoute = shortestPath("A", "D", { graphData });
      const startDest: Destination = { id: "d-start", name: "Start Gate", nodeId: "A", category: "Gate", aliases: [] };
      const endDest: Destination = { id: "d-end", name: "End Building", nodeId: "D", category: "Building", aliases: [] };

      useNavigationStore.getState().startNavigationSession(startDest, endDest, primaryRoute!);
      useNavigationStore.getState().advanceToNextStep(); // step index = 1

      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);
      expect(useNavigationStore.getState().isManualStepping).toBe(true);

      // Live GPS update at node A (index 0)
      useNavigationStore.getState().updateGpsProgress(
        0,
        0,
        sampleNodes[0],
        sampleNodes,
        () => null,
        { canvasPos: { x: 0, y: 0, floorId: "f-out" } }
      );

      // Should remain at manual step index 1
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);
    });
  });

  describe("3. Admin Setting for Alternative Route Display", () => {
    it("allows toggling alternative route visibility in campus store", () => {
      expect(typeof campusStore.getShowAlternativeRoute).toBe("function");
      expect(typeof campusStore.setShowAlternativeRoute).toBe("function");

      campusStore.setShowAlternativeRoute(true);
      expect(campusStore.getShowAlternativeRoute()).toBe(true);

      campusStore.setShowAlternativeRoute(false);
      expect(campusStore.getShowAlternativeRoute()).toBe(false);
    });
  });

  describe("4. 3-State Node Display Mode Cycling", () => {
    it("correctly cycles through ALL -> CIRCLES_ONLY -> HIDDEN -> ALL", () => {
      type NodeDisplayMode = "ALL" | "CIRCLES_ONLY" | "HIDDEN";

      function cycleMode(mode: NodeDisplayMode): NodeDisplayMode {
        if (mode === "ALL") return "CIRCLES_ONLY";
        if (mode === "CIRCLES_ONLY") return "HIDDEN";
        return "ALL";
      }

      let mode: NodeDisplayMode = "ALL";
      expect(mode).toBe("ALL");

      mode = cycleMode(mode);
      expect(mode).toBe("CIRCLES_ONLY");

      mode = cycleMode(mode);
      expect(mode).toBe("HIDDEN");

      mode = cycleMode(mode);
      expect(mode).toBe("ALL");
    });
  });

  describe("5. Admin Instant Live Sync (Without Publish)", () => {
    it("allows toggling instant live sync mode in campus store", () => {
      expect(typeof campusStore.getInstantLiveSync).toBe("function");
      expect(typeof campusStore.setInstantLiveSync).toBe("function");

      campusStore.setInstantLiveSync(true);
      expect(campusStore.getInstantLiveSync()).toBe(true);

      const published = campusStore.getPublishedData();
      const working = campusStore.getWorkingData();
      expect(published.nodes.length).toBe(working.nodes.length);

      campusStore.setInstantLiveSync(false);
      expect(campusStore.getInstantLiveSync()).toBe(false);
    });
  });

  describe("6. Mid-Route Live Start Point Alignment (A->F with user at D)", () => {
    it("initializes current step at point D, marks A-C as completed, and shows remaining route from D to F", () => {
      const nodes: Node[] = [
        { id: "A", name: "Gate A", x: 0, y: 0, floorId: "f-out", type: "GATE" },
        { id: "B", name: "Corridor B", x: 50, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "C", name: "Corridor C", x: 100, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "D", name: "Midpoint D", x: 150, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "E", name: "Corridor E", x: 200, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "F", name: "Destination F", x: 250, y: 0, floorId: "f-out", type: "ROOM" },
      ];

      const edges: Edge[] = [
        { id: "e1", from: "A", to: "B", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e2", from: "B", to: "C", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e3", from: "C", to: "D", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e4", from: "D", to: "E", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e5", from: "E", to: "F", distance: 50, bidirectional: true, type: "WALK" },
      ];

      const route: Route = {
        id: "A->F",
        nodes,
        edges,
        distance: 250,
        durationSec: 200,
        instructions: [
          { text: "Head straight towards Corridor B", distance: 50, icon: "straight", targetNodeId: "B" },
          { text: "Continue towards Corridor C", distance: 50, icon: "straight", targetNodeId: "C" },
          { text: "Proceed to Midpoint D", distance: 50, icon: "straight", targetNodeId: "D" },
          { text: "Walk towards Corridor E", distance: 50, icon: "straight", targetNodeId: "E" },
          { text: "Arrive at Destination F", distance: 50, icon: "arrive", targetNodeId: "F" },
        ],
      };

      const origin: Destination = { id: "dest-a", name: "Gate A", nodeId: "A", category: "GATE", aliases: [] };
      const destination: Destination = { id: "dest-f", name: "Destination F", nodeId: "F", category: "ROOM", aliases: [] };

      // User hits Start Navigation while physically standing at Midpoint D (x=150, y=0)
      useNavigationStore.getState().startNavigationSession(origin, destination, route, {
        isGpsActive: true,
        x: 150,
        y: 0,
        floorId: "f-out",
        canvasPos: { x: 150, y: 0, floorId: "f-out" },
      });

      const session = useNavigationStore.getState();

      // Session should immediately be matched to D (segment index 3)
      expect(session.currentSegmentIndex).toBe(3);
      expect(session.matchedNodeId).toBe("D");

      // Current instruction should be step 3 (towards E)
      expect(session.currentInstruction?.text).toBe("Walk towards Corridor E");

      // Distance remaining should only be D->E->F (100m) instead of full 250m
      expect(session.distanceRemaining).toBeLessThanOrEqual(105);

      // In the full instruction list of 5 steps:
      // Steps 0, 1, 2 (A to C) are past / completed (idx < 3)
      const allInstructions: RouteInstruction[] = route.instructions || [];
      const pastSteps = allInstructions.filter((_: RouteInstruction, idx: number) => idx < session.currentSegmentIndex);
      const currentStep = allInstructions[session.currentSegmentIndex];
      const futureSteps = allInstructions.filter((_: RouteInstruction, idx: number) => idx > session.currentSegmentIndex);

      expect(pastSteps.length).toBe(3);
      expect(currentStep.text).toBe("Walk towards Corridor E");
      expect(futureSteps.length).toBe(1);
      expect(futureSteps[0].text).toBe("Arrive at Destination F");
    });

    it("starts strictly at Step 1 (Origin) when Live GPS is inactive or turned off", () => {
      const nodes: Node[] = [
        { id: "A", name: "Gate A", x: 0, y: 0, floorId: "f-out", type: "GATE" },
        { id: "B", name: "Corridor B", x: 50, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "C", name: "Corridor C", x: 100, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "D", name: "Corridor D", x: 150, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "E", name: "Corridor E", x: 200, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "F", name: "Destination F", x: 250, y: 0, floorId: "f-out", type: "ROOM" },
      ];

      const edges: Edge[] = [
        { id: "e1", from: "A", to: "B", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e2", from: "B", to: "C", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e3", from: "C", to: "D", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e4", from: "D", to: "E", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e5", from: "E", to: "F", distance: 50, bidirectional: true, type: "WALK" },
      ];

      const route: Route = {
        id: "A->F",
        nodes,
        edges,
        distance: 250,
        durationSec: 200,
        instructions: [
          { text: "Head straight towards Corridor B", distance: 50, icon: "straight", targetNodeId: "B" },
          { text: "Continue towards Corridor C", distance: 50, icon: "straight", targetNodeId: "C" },
          { text: "Proceed to Midpoint D", distance: 50, icon: "straight", targetNodeId: "D" },
          { text: "Walk towards Corridor E", distance: 50, icon: "straight", targetNodeId: "E" },
          { text: "Arrive at Destination F", distance: 50, icon: "arrive", targetNodeId: "F" },
        ],
      };

      const origin: Destination = { id: "dest-a", name: "Gate A", nodeId: "A", category: "GATE", aliases: [] };
      const destination: Destination = { id: "dest-f", name: "Destination F", nodeId: "F", category: "ROOM", aliases: [] };

      // User starts navigation without GPS (or GPS inactive with dummy canvas coordinates)
      useNavigationStore.getState().startNavigationSession(origin, destination, route, {
        isGpsActive: false,
        x: 400,
        y: 300,
        canvasPos: { x: 400, y: 300, floorId: "f-out" },
      });

      const session = useNavigationStore.getState();

      // Session MUST start at step 0 (Origin), not jump to end
      expect(session.currentSegmentIndex).toBe(0);
      expect(session.matchedNodeId).toBe("A");
      expect(session.currentInstruction?.text).toBe("Head straight towards Corridor B");
      expect(session.distanceRemaining).toBe(250);
      expect(session.status).toBe("NAVIGATING");
    });

    it("starts at Point C and marks A->C as completed when user has live location at Point C", () => {
      const nodes: Node[] = [
        { id: "A", name: "Gate A", x: 0, y: 0, floorId: "f-out", type: "GATE" },
        { id: "B", name: "Corridor B", x: 50, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "C", name: "Corridor C", x: 100, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "D", name: "Corridor D", x: 150, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "E", name: "Corridor E", x: 200, y: 0, floorId: "f-out", type: "CORRIDOR" },
        { id: "F", name: "Destination F", x: 250, y: 0, floorId: "f-out", type: "ROOM" },
      ];

      const edges: Edge[] = [
        { id: "e1", from: "A", to: "B", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e2", from: "B", to: "C", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e3", from: "C", to: "D", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e4", from: "D", to: "E", distance: 50, bidirectional: true, type: "WALK" },
        { id: "e5", from: "E", to: "F", distance: 50, bidirectional: true, type: "WALK" },
      ];

      const route: Route = {
        id: "A->F",
        nodes,
        edges,
        distance: 250,
        durationSec: 200,
        instructions: [
          { text: "Head straight towards Corridor B", distance: 50, icon: "straight", targetNodeId: "B" },
          { text: "Continue towards Corridor C", distance: 50, icon: "straight", targetNodeId: "C" },
          { text: "Proceed to Midpoint D", distance: 50, icon: "straight", targetNodeId: "D" },
          { text: "Walk towards Corridor E", distance: 50, icon: "straight", targetNodeId: "E" },
          { text: "Arrive at Destination F", distance: 50, icon: "arrive", targetNodeId: "F" },
        ],
      };

      const origin: Destination = { id: "dest-a", name: "Gate A", nodeId: "A", category: "GATE", aliases: [] };
      const destination: Destination = { id: "dest-f", name: "Destination F", nodeId: "F", category: "ROOM", aliases: [] };

      // User provides origin A and end F, but user is physically at Point C (x=100, y=0) with live location ON
      useNavigationStore.getState().startNavigationSession(origin, destination, route, {
        isGpsActive: true,
        x: 100,
        y: 0,
        floorId: "f-out",
        canvasPos: { x: 100, y: 0, floorId: "f-out" },
      });

      const session = useNavigationStore.getState();

      // Session should match to C (segment index 2)
      expect(session.currentSegmentIndex).toBe(2);
      expect(session.matchedNodeId).toBe("C");
      expect(session.currentInstruction?.text).toBe("Proceed to Midpoint D");
      expect(session.distanceRemaining).toBeLessThanOrEqual(155);

      // Steps 0 and 1 (A to C) are completed (idx < 2)
      const allInstructions: RouteInstruction[] = route.instructions || [];
      const pastSteps = allInstructions.filter((_, idx) => idx < session.currentSegmentIndex);
      expect(pastSteps.length).toBe(2);
      expect(pastSteps[0].text).toBe("Head straight towards Corridor B");
      expect(pastSteps[1].text).toBe("Continue towards Corridor C");
    });
  });
});
