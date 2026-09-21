import { describe, it, expect, beforeEach } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import { buildAdjacencyGraph, optimizeMultiStopRoute } from "../lib/routing/graph";
import { checkOffRoute, detectEntranceTransition } from "../lib/routing/offroute";
import { generateDirections } from "../lib/routing/directions";
import type { Node, Edge, Building } from "../shared/data/campus";

describe("Visitor Navigation Engine & Services", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("optimizes multi-stop trip order using Nearest Neighbor TSP", () => {
    const n1: Node = { id: "n-start", type: "BUILDING_ENTRANCE", name: "Main Gate", floorId: "f-out", x: 0, y: 0 };
    const n2: Node = { id: "n-lib", type: "ROOM", name: "Library", floorId: "f-1", x: 100, y: 0 };
    const n3: Node = { id: "n-[#canteen]", type: "ROOM", name: "Canteen", floorId: "f-1", x: 20, y: 0 };
    const n4: Node = { id: "n-audi", type: "ROOM", name: "Auditorium", floorId: "f-1", x: 200, y: 0 };

    const nodes = [n1, n2, n3, n4];
    const nodeMap = new Map<string, Node>();
    nodes.forEach((n) => nodeMap.set(n.id, n));
    const graph = new Map();

    const ordered = optimizeMultiStopRoute(graph, nodeMap, "n-start", ["n-lib", "n-[#canteen]", "n-audi"]);

    // Nearest waypoint to start (0,0) is Canteen (20,0), then Library (100,0), then Auditorium (200,0)
    expect(ordered[0]).toBe("n-start");
    expect(ordered[1]).toBe("n-[#canteen]");
    expect(ordered[2]).toBe("n-lib");
    expect(ordered[3]).toBe("n-audi");
  });

  it("detects off-route deviation when visitor position exceeds threshold distance", () => {
    const routeNodes: Node[] = [
      { id: "r1", type: "CORRIDOR", name: "P1", floorId: "f-1", x: 10, y: 10 },
      { id: "r2", type: "CORRIDOR", name: "P2", floorId: "f-1", x: 30, y: 10 },
    ];
    const route = {
      nodes: routeNodes,
      edges: [],
      distance: 20,
      durationSec: 15,
      hasObstacles: false,
      totalDistance: 20,
      totalWeight: 20,
    };

    // Visitor close to route (5m away)
    const resultClose = checkOffRoute({ x: 12, y: 12, floorId: "f-1" }, route, 20);
    expect(resultClose.isOffRoute).toBe(false);

    // Visitor far off route (50m away)
    const resultFar = checkOffRoute({ x: 100, y: 100, floorId: "f-1" }, route, 20);
    expect(resultFar.isOffRoute).toBe(true);
  });

  it("detects seamless outdoor to indoor entrance transitions", () => {
    const entranceNode: Node = {
      id: "n-ent-1",
      type: "BUILDING_ENTRANCE",
      name: "Science Block Main Entrance",
      floorId: "f-out",
      x: 150,
      y: 150,
      isEntranceNode: true,
    };

    // User approaching entrance from outdoor
    const transition = detectEntranceTransition({ x: 152, y: 148, floorId: "f-out" }, [entranceNode], 20);
    expect(transition.entranceNode?.id).toBe("n-ent-1");
  });

  it("generates turn-by-turn guidance steps for multi-floor routes", () => {
    const n1: Node = { id: "n1", type: "ROOM", name: "Room 101", floorId: "f-1", x: 10, y: 10 };
    const n2: Node = { id: "n2", type: "STAIR", name: "Stair A Floor 1", floorId: "f-1", x: 50, y: 10 };
    const n3: Node = { id: "n3", type: "STAIR", name: "Stair A Floor 2", floorId: "f-2", x: 50, y: 10 };
    const n4: Node = { id: "n4", type: "ROOM", name: "Room 204", floorId: "f-2", x: 100, y: 10 };

    const edges = [
      { edgeId: "e1", from: "n1", to: "n2", type: "WALK" as const, distance: 40, bidirectional: true, weight: 40 },
      { edgeId: "e2", from: "n2", to: "n3", type: "STAIRS" as const, distance: 15, bidirectional: true, weight: 30 },
      { edgeId: "e3", from: "n3", to: "n4", type: "WALK" as const, distance: 50, bidirectional: true, weight: 50 },
    ];

    const floorNames = new Map([
      ["f-1", "Floor 1"],
      ["f-2", "Floor 2"],
    ]);

    const steps = generateDirections([n1, n2, n3, n4], edges, floorNames);

    expect(steps.length).toBe(4); // 3 edges + 1 arrival step
    expect(steps[1].icon).toBe("stairs-up");
    expect(steps[1].text).toContain("Take stairs to Floor 2");
    expect(steps[3].icon).toBe("arrive");
  });
});
