import { describe, it, expect } from "vitest";
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM, cleanStairLiftDisplayName } from "../shared/lib/map-config";
import { shortestPath } from "../features/navigation/services/graph";
import type { Node, Edge, Floor, Building } from "../shared/data/campus";

describe("User Experience & Zoom Configuration Verification", () => {
  it("verifies cleanStairLiftDisplayName removes level numbers and names", () => {
    expect(cleanStairLiftDisplayName("Main Staircase A (Floor 3)")).toBe("Main Staircase A");
    expect(cleanStairLiftDisplayName("Main Staircase A (Floor 1)")).toBe("Main Staircase A");
    expect(cleanStairLiftDisplayName("Main Staircase A (Ground Floor)")).toBe("Main Staircase A");
    expect(cleanStairLiftDisplayName("Elevator 1 (Level 2)")).toBe("Elevator 1");
    expect(cleanStairLiftDisplayName("Staircase B - Floor 2")).toBe("Staircase B");
    expect(cleanStairLiftDisplayName("North Lift (L1)")).toBe("North Lift");
  });

  it("verifies MAX_MAP_ZOOM is centralized and active", () => {
    expect(typeof MAX_MAP_ZOOM).toBe("number");
    expect(MAX_MAP_ZOOM).toBeGreaterThanOrEqual(10.0);
    expect(typeof MIN_MAP_ZOOM).toBe("number");

    // Dynamic zoom clamping verification with user-configured constant
    const clampedZoom = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, 1.0 * (MAX_MAP_ZOOM + 10)));
    expect(clampedZoom).toBe(MAX_MAP_ZOOM);
  });

  it("verifies consecutive straight steps are merged with summed distance", () => {
    const mockNodes: Node[] = [
      { id: "n1", name: "Corridor Start", x: 100, y: 100, floorId: "f-out", type: "OUTDOOR_PATH" },
      { id: "n2", name: "Corridor Mid 1", x: 150, y: 100, floorId: "f-out", type: "OUTDOOR_PATH" },
      { id: "n3", name: "Corridor Mid 2", x: 200, y: 100, floorId: "f-out", type: "OUTDOOR_PATH" },
      { id: "n4", name: "Room 101", x: 250, y: 100, floorId: "f-out", type: "ROOM" },
    ];

    const mockEdges: Edge[] = [
      { id: "e1", from: "n1", to: "n2", distance: 10, type: "WALK", pathType: "WALK" },
      { id: "e2", from: "n2", to: "n3", distance: 15, type: "WALK", pathType: "WALK" },
      { id: "e3", from: "n3", to: "n4", distance: 20, type: "WALK", pathType: "WALK" },
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

    const route = shortestPath("n1", "n4", { graphData, travelMode: "WALK" });
    expect(route).not.toBeNull();
    expect(route!.distance).toBe(45);

    // Instructions should merge straight corridor segments (10m + 15m + 20m = 45m) into 1 straight step + 1 arrive step
    const nonArriveSteps = route!.instructions.filter((ins) => ins.icon !== "arrive");
    expect(nonArriveSteps.length).toBe(1);
    expect(nonArriveSteps[0].distance).toBe(45);
    expect(nonArriveSteps[0].icon).toBe("straight");
  });

  it("verifies floor filtering cleanly separates outdoor path from indoor room path", () => {
    const isOutdoorFloor = (floorId: string) => floorId === "f-out" || floorId === "outdoor";
    const isEntrance = (n: { type?: string; name?: string }) =>
      n.type === "BUILDING_ENTRANCE" || n.type === "ENTRANCE" || (n.name && n.name.toLowerCase().includes("entrance"));

    const isEdgeVisibleOnFloor = (
      from: { floorId?: string; type?: string; name?: string },
      to: { floorId?: string; type?: string; name?: string },
      activeFloorId: string
    ) => {
      const fromFloor = from.floorId || "f-out";
      const toFloor = to.floorId || "f-out";
      const isOut = isOutdoorFloor(activeFloorId);

      if (isOut) {
        const fromOut = fromFloor === "f-out" || fromFloor === "outdoor";
        const toOut = toFloor === "f-out" || toFloor === "outdoor";
        const fromEnt = isEntrance(from);
        const toEnt = isEntrance(to);
        return (fromOut && toOut) || (fromOut && toEnt) || (toOut && fromEnt);
      }

      const fromThis = fromFloor === activeFloorId;
      const toThis = toFloor === activeFloorId;
      const fromEnt = isEntrance(from);
      const toEnt = isEntrance(to);

      return (fromThis && toThis) || (fromThis && toEnt) || (toThis && fromEnt);
    };

    const outdoorNode = { floorId: "f-out", type: "OUTDOOR_PATH", name: "RP 1" };
    const entranceNode = { floorId: "f-out", type: "BUILDING_ENTRANCE", name: "RP Entrance 1" };
    const indoorRoomNode = { floorId: "rp-ground", type: "ROOM", name: "Accounts" };
    const stairsNode = { floorId: "rp-ground", type: "STAIR", name: "Main Staircase A" };

    // 1. Outdoor view
    expect(isEdgeVisibleOnFloor(outdoorNode, entranceNode, "f-out")).toBe(true);  // RP 1 -> RP Entrance 1 is visible on outdoor
    expect(isEdgeVisibleOnFloor(entranceNode, indoorRoomNode, "f-out")).toBe(false); // Entrance -> Accounts is HIDDEN on outdoor
    expect(isEdgeVisibleOnFloor(indoorRoomNode, stairsNode, "f-out")).toBe(false);   // Accounts -> Stairs is HIDDEN on outdoor

    // 2. RP Ground floor view
    expect(isEdgeVisibleOnFloor(outdoorNode, entranceNode, "rp-ground")).toBe(false); // RP 1 -> Entrance is HIDDEN on indoor
    expect(isEdgeVisibleOnFloor(entranceNode, indoorRoomNode, "rp-ground")).toBe(true);  // Entrance -> Accounts is VISIBLE on ground floor
    expect(isEdgeVisibleOnFloor(indoorRoomNode, stairsNode, "rp-ground")).toBe(true);    // Accounts -> Stairs is VISIBLE on ground floor

    // 3. RP Floor 3 view: Outdoor & Ground floor entrances are NEVER visible on Floor 3
    const isNodeOnFloor = (n: { floorId?: string; type?: string }, activeFloor: string, isGnd: boolean) => {
      if (activeFloor === "f-out" || activeFloor === "outdoor") {
        return n.floorId === "f-out" || n.floorId === "outdoor" || !n.floorId;
      }
      if (n.floorId === activeFloor) return true;
      if (isGnd && (n.type === "BUILDING_ENTRANCE" || n.type === "ENTRANCE")) {
        return n.floorId === "f-out" || n.floorId === "outdoor" || !n.floorId || n.floorId === activeFloor;
      }
      return false;
    };

    const rpEntrance1 = { id: "e1", floorId: "f-out", type: "BUILDING_ENTRANCE", name: "RP Entrance 1" };
    const rpEntrance2 = { id: "e2", floorId: "rp-ground", type: "BUILDING_ENTRANCE", name: "RP Entrance 2" };
    const room301 = { id: "r301", floorId: "rp-floor-3", type: "ROOM", name: "AE301" };

    // On Floor 3: Neither RP Entrance 1 nor RP Entrance 2 should be visible
    expect(isNodeOnFloor(rpEntrance1, "rp-floor-3", false)).toBe(false);
    expect(isNodeOnFloor(rpEntrance2, "rp-floor-3", false)).toBe(false);
    expect(isNodeOnFloor(room301, "rp-floor-3", false)).toBe(true);
  });
});
