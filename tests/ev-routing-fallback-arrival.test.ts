import { describe, it, expect, beforeEach } from "vitest";
import { shortestPath, multiStopShortestPath } from "../features/navigation/services/graph";
import { computeLiveTurnGuidance, projectUserOntoRoute, type LiveUserPosition } from "../lib/navigation/live-guidance";
import { useNavigationStore } from "../features/navigation/navigation-store";
import type { Node, Edge, Destination } from "../shared/data/campus";

describe("EV Routing Fallback and Arrival Logic", () => {
  const nodes: Node[] = [
    { id: "n-user", name: "RP Entrance 1", floorId: "f-out", type: "ENTRANCE", x: 100, y: 100, lat: 11.496, lng: 77.277 },
    { id: "n-rp1", name: "RP 1", floorId: "f-out", type: "CORRIDOR", x: 100, y: 150, lat: 11.4965, lng: 77.277 },
    { id: "n-rp4", name: "RP 4", floorId: "f-out", type: "CORRIDOR", x: 100, y: 200, lat: 11.497, lng: 77.277 },
    { id: "n-sf", name: "SF Entrance", floorId: "f-out", type: "BUILDING_ENTRANCE", x: 100, y: 350, lat: 11.4985, lng: 77.277 },
    { id: "n-road-a", name: "EV North Ring", floorId: "f-out", type: "ROAD_JUNCTION", x: 300, y: 100, lat: 11.496, lng: 77.280 },
    { id: "n-road-b", name: "EV South Ring", floorId: "f-out", type: "ROAD_JUNCTION", x: 300, y: 350, lat: 11.4985, lng: 77.280 },
  ];

  // Scenario A: Walk only path connecting RP to SF (no EV road connecting to SF)
  const walkOnlyEdges: Edge[] = [
    { id: "e-1", from: "n-user", to: "n-rp1", distance: 50, type: "WALK", pathType: "WALK", bidirectional: true },
    { id: "e-2", from: "n-rp1", to: "n-rp4", distance: 50, type: "WALK", pathType: "WALK", bidirectional: true },
    { id: "e-3", from: "n-rp4", to: "n-sf", distance: 150, type: "WALK", pathType: "WALK", bidirectional: true },
  ];

  // Scenario B: EV road connects n-road-a and n-road-b
  const hybridEdges: Edge[] = [
    ...walkOnlyEdges,
    { id: "e-ev-ring", from: "n-road-a", to: "n-road-b", distance: 250, type: "ROAD", pathType: "EV", bidirectional: true },
    { id: "e-connect-a", from: "n-user", to: "n-road-a", distance: 200, type: "WALK", pathType: "WALK", bidirectional: true },
    { id: "e-connect-b", from: "n-road-b", to: "n-sf", distance: 200, type: "WALK", pathType: "WALK", bidirectional: true },
  ];

  const graphDataWalkOnly = {
    nodes,
    edges: walkOnlyEdges,
    floors: [],
    buildings: [],
    destinations: [
      { id: "dest-sf", name: "SF", nodeId: "n-sf", category: "Building" },
    ],
    obstacles: [],
    events: [],
  };

  const graphDataHybrid = {
    nodes,
    edges: hybridEdges,
    floors: [],
    buildings: [],
    destinations: [
      { id: "dest-sf", name: "SF", nodeId: "n-sf", category: "Building" },
    ],
    obstacles: [],
    events: [],
  };

  beforeEach(() => {
    useNavigationStore.getState().cancelNavigationSession();
  });

  it("Case 1: EV route exists -> uses EV / multimodal route when an EV segment is available", () => {
    // In hybrid graph, n-road-a to n-road-b is an EV road.
    const route = shortestPath("n-road-a", "n-road-b", {
      travelMode: "EV",
      graphData: graphDataHybrid,
    });

    expect(route).not.toBeNull();
    expect(route?.travelMode).toBe("EV");
    expect(route?.evDistance).toBe(250);
    expect(route?.isFallbackWalk).toBeFalsy();
  });

  it("Case 2: EV route does NOT exist -> falls back to the shortest valid walkable route", () => {
    // When destination SF has no EV connection at all, EV mode falls back to walking route
    const route = shortestPath("n-user", "n-sf", {
      travelMode: "EV",
      graphData: graphDataWalkOnly,
    });

    expect(route).not.toBeNull();
    expect(route?.isFallbackWalk).toBe(true);
    expect(route?.fallbackReason).toBe("EV path not available, Showing walkable route");
    expect(route?.travelMode).toBe("WALK");
    expect(route?.distance).toBe(250); // 50 + 50 + 150
    expect(route?.nodes.map((n) => n.id)).toEqual(["n-user", "n-rp1", "n-rp4", "n-sf"]);
  });

  it("Case 3: EV route does not exist and user is far from destination -> NEVER show Arrived", () => {
    const route = shortestPath("n-user", "n-sf", {
      travelMode: "EV",
      graphData: graphDataWalkOnly,
    });

    expect(route).not.toBeNull();

    // User is currently at n-user (start position, ~277 meters away from SF destination)
    const userPos: LiveUserPosition = {
      x: 100,
      y: 100,
      lat: 11.496,
      lng: 77.277,
      floorId: "f-out",
    };

    const projection = projectUserOntoRoute(userPos, route!.nodes, route!.edges, 0, {
      arrivalThresholdMeters: 12.0,
    });

    const guidance = computeLiveTurnGuidance(userPos, route!, projection, {
      arrivalThresholdMeters: 12.0,
    });

    expect(guidance.isArrived).toBe(false);
    expect(guidance.currentInstruction?.text).not.toContain("Arrived");
    expect(guidance.currentInstruction?.icon).not.toBe("arrive");
    expect(guidance.distanceRemaining).toBeGreaterThan(12);
  });

  it("Case 4: User physically reaches destination within arrival threshold -> shows Arrived", () => {
    const route = shortestPath("n-user", "n-sf", {
      travelMode: "EV",
      graphData: graphDataWalkOnly,
    });

    expect(route).not.toBeNull();

    // User has physically walked and is now 3 meters away from SF
    const userPosAtSF: LiveUserPosition = {
      x: 100,
      y: 348,
      lat: 11.49848,
      lng: 77.277,
      floorId: "f-out",
    };

    const projection = projectUserOntoRoute(userPosAtSF, route!.nodes, route!.edges, 2, {
      arrivalThresholdMeters: 12.0,
    });

    const guidance = computeLiveTurnGuidance(userPosAtSF, route!, projection, {
      arrivalThresholdMeters: 12.0,
    });

    expect(guidance.isArrived).toBe(true);
    expect(guidance.currentInstruction?.text).toContain("Arrived at SF Entrance");
    expect(guidance.currentInstruction?.icon).toBe("arrive");
  });

  it("Case 5: Walking mode with a valid route -> existing behavior remains unchanged", () => {
    const route = shortestPath("n-user", "n-sf", {
      travelMode: "WALK",
      graphData: graphDataWalkOnly,
    });

    expect(route).not.toBeNull();
    expect(route?.travelMode).toBe("WALK");
    expect(route?.isFallbackWalk).toBeFalsy();
    expect(route?.distance).toBe(250);
  });

  it("Case 6: Off-route recalculation under EV mode maintains fallback behavior", () => {
    const startDest: Destination = { id: "dest-user", name: "RP Entrance 1", nodeId: "n-user", category: "Entrance", aliases: [] };
    const endDest: Destination = { id: "dest-sf", name: "SF", nodeId: "n-sf", category: "Building", aliases: [] };

    const initialRoute = shortestPath("n-user", "n-sf", {
      travelMode: "EV",
      graphData: graphDataWalkOnly,
    });

    expect(initialRoute).not.toBeNull();

    useNavigationStore.getState().startNavigationSession(startDest, endDest, initialRoute!);
    expect(useNavigationStore.getState().status).toBe("NAVIGATING");

    // Recalculation function passed to updateGpsProgress
    const recalculateRouteFn = (fromId: string, toId: string) => {
      return shortestPath(fromId, toId, { travelMode: "EV", graphData: graphDataWalkOnly });
    };

    // Set lastRerouteTimestamp back to allow reroute
    useNavigationStore.setState({ lastRerouteTimestamp: 0 });

    // User deviates off route at n-rp1
    const offRoutePos = {
      x: 500,
      y: 500,
      floorId: "f-out",
    };

    // Simulate 3 off-route updates to trigger rerouting
    const rp1Node = nodes.find((n) => n.id === "n-rp1")!;
    for (let i = 0; i < 3; i++) {
      useNavigationStore.getState().updateGpsProgress(
        11.51,
        77.30,
        rp1Node,
        nodes,
        recalculateRouteFn,
        { canvasPos: offRoutePos }
      );
    }

    // Off-route reroute should succeed and remain NAVIGATING with fallback route
    const state = useNavigationStore.getState();
    expect(state.status).toBe("NAVIGATING");
    expect(state.activeRoute?.isFallbackWalk).toBe(true);
    expect(state.activeRoute?.nodes.map((n) => n.id)).toEqual(["n-rp1", "n-rp4", "n-sf"]);
  });
});
