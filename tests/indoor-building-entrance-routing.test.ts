import { describe, it, expect, beforeEach } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import { shortestPath } from "../features/navigation/services/graph";
import type { Building, Floor, Node, Edge } from "../shared/data/campus";

describe("Indoor Live Location Building Entrance Routing", () => {
  beforeEach(() => {
    campusStore.resetToInitialData(true);
  });

  it("routes to the building entrance first when live location is inside the building instead of breaking through exterior walls", () => {
    // 1. Building RP: (x: 1000, y: -1800, width: 200, height: 150)
    const bldRP: Building = {
      id: "bld-rp",
      campusId: "c1",
      name: "RP",
      shortCode: "RP",
      x: 1000,
      y: -1800,
      width: 200,
      height: 150,
      floorsCount: 1,
    };

    const floorGnd: Floor = {
      id: "f-bld-rp-g",
      buildingId: "bld-rp",
      name: "Ground Floor",
      ordinal: 0,
    };

    // 2. Entrance node of RP (south entrance at x: 1160, y: -1709)
    const rpEntrance: Node = {
      id: "n-rp-entrance",
      name: "RP Entrance 1",
      type: "BUILDING_ENTRANCE",
      isEntranceNode: true,
      floorId: "f-out",
      x: 1160,
      y: -1709,
    };

    // 3. Outdoor node on the west outside the wall (x: 950, y: -1750)
    const outdoorWestNode: Node = {
      id: "n-outdoor-west",
      name: "Outdoor West Path",
      type: "CORRIDOR",
      floorId: "f-out",
      x: 950,
      y: -1750,
    };

    // 4. Outdoor walkway node connected to entrance
    const rp1: Node = {
      id: "n-rp-1",
      name: "RP 1",
      type: "CORRIDOR",
      floorId: "f-out",
      x: 1160,
      y: -1574,
    };

    // 5. Destination node (SF)
    const destNode: Node = {
      id: "n-dest-sf",
      name: "SF Building",
      type: "CORRIDOR",
      floorId: "f-out",
      x: 1160,
      y: -1200,
    };

    // Edges
    const edges: Edge[] = [
      { id: "e1", from: "n-rp-entrance", to: "n-rp-1", type: "WALK", distance: 135, bidirectional: true },
      { id: "e2", from: "n-rp-1", to: "n-dest-sf", type: "WALK", distance: 374, bidirectional: true },
      { id: "e3", from: "n-outdoor-west", to: "n-rp-1", type: "WALK", distance: 250, bidirectional: true },
    ];

    const graphData = {
      buildings: [bldRP],
      floors: [floorGnd],
      nodes: [rpEntrance, outdoorWestNode, rp1, destNode],
      edges,
      destinations: [],
      obstacles: [],
    };

    // User is located at (1050, -1750) INSIDE the RP building polygon (near the west wall)
    // Geometrically, outdoorWestNode (at 950, -1750, dist=100) is closer than rpEntrance (at 1160, -1709, dist=117)
    // But because user is inside RP, the route MUST exit via RP Entrance 1 and not cut through the west wall!
    const route = shortestPath("dest-live-user-location", "n-dest-sf", {
      graphData,
      userLocation: { x: 1050, y: -1750 },
    });

    expect(route).not.toBeNull();
    expect(route!.nodes[0].id).toBe("n-rp-entrance");
    expect(route!.nodes.map((n) => n.id)).toEqual(["n-rp-entrance", "n-rp-1", "n-dest-sf"]);
  });

  it("connects directly to the nearest outdoor node when live location is outside the building boundary", () => {
    const bldRP: Building = {
      id: "bld-rp",
      campusId: "c1",
      name: "RP",
      shortCode: "RP",
      x: 1000,
      y: -1800,
      width: 200,
      height: 150,
      floorsCount: 1,
    };

    const rpEntrance: Node = {
      id: "n-rp-entrance",
      name: "RP Entrance 1",
      type: "BUILDING_ENTRANCE",
      isEntranceNode: true,
      floorId: "f-out",
      x: 1160,
      y: -1709,
    };

    const outdoorWestNode: Node = {
      id: "n-outdoor-west",
      name: "Outdoor West Path",
      type: "CORRIDOR",
      floorId: "f-out",
      x: 750,
      y: -1750,
    };

    const rp1: Node = {
      id: "n-rp-1",
      name: "RP 1",
      type: "CORRIDOR",
      floorId: "f-out",
      x: 1160,
      y: -1574,
    };

    const destNode: Node = {
      id: "n-dest-sf",
      name: "SF Building",
      type: "CORRIDOR",
      floorId: "f-out",
      x: 1160,
      y: -1200,
    };

    const edges: Edge[] = [
      { id: "e1", from: "n-rp-entrance", to: "n-rp-1", type: "WALK", distance: 135, bidirectional: true },
      { id: "e2", from: "n-rp-1", to: "n-dest-sf", type: "WALK", distance: 374, bidirectional: true },
      { id: "e3", from: "n-outdoor-west", to: "n-rp-1", type: "WALK", distance: 250, bidirectional: true },
    ];

    const graphData = {
      buildings: [bldRP],
      floors: [],
      nodes: [rpEntrance, outdoorWestNode, rp1, destNode],
      edges,
      destinations: [],
      obstacles: [],
    };

    // User is located at (760, -1750) OUTSIDE the RP building polygon (west of building minX: 900)
    // Should connect to n-outdoor-west and NOT force RP Entrance 1 across the wall
    const route = shortestPath("dest-live-user-location", "n-dest-sf", {
      graphData,
      userLocation: { x: 760, y: -1750 },
    });

    expect(route).not.toBeNull();
    expect(route!.nodes[0].id).toBe("n-outdoor-west");
    expect(route!.nodes.map((n) => n.id)).toEqual(["n-outdoor-west", "n-rp-1", "n-dest-sf"]);
  });
});
