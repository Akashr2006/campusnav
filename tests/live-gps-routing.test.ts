import { describe, it, expect, beforeEach } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import { findContextAwareNearestNodes } from "../lib/geo/haversine";
import { shortestPath } from "../features/navigation/services/graph";
import type { Building, Floor, Node, Edge, Destination } from "../shared/data/campus";

describe("Live GPS Auto-Connecting Routing Engine", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("prioritizes same-floor nodes for indoor GPS context", () => {
    const building: Building = {
      id: "bld-rp",
      campusId: "c1",
      name: "RP Block",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    };
    campusStore.addBuilding(building);

    const floor1: Floor = { id: "f-rp-1", buildingId: "bld-rp", name: "Floor 1", ordinal: 1 };
    const floor2: Floor = { id: "f-rp-2", buildingId: "bld-rp", name: "Floor 2", ordinal: 2 };
    campusStore.addFloor(floor1);
    campusStore.addFloor(floor2);

    const nodeF1: Node = { id: "n-f1", type: "ROOM", floorId: "f-rp-1", x: 100, y: 100, lat: 11.0001, lng: 77.0001 };
    const nodeF2: Node = { id: "n-f2", type: "ROOM", floorId: "f-rp-2", x: 100, y: 100, lat: 11.0001, lng: 77.0001 };
    campusStore.addNode(nodeF1);
    campusStore.addNode(nodeF2);

    // User is physically at lat=11.0001, lng=77.0001 on Floor 2
    const candidates = findContextAwareNearestNodes(11.0001, 77.0001, [nodeF1, nodeF2], {
      isInside: true,
      buildingId: "bld-rp",
      floorId: "f-rp-2",
      floors: [floor1, floor2],
    });

    expect(candidates.length).toBe(2);
    expect(candidates[0].id).toBe("n-f2");
  });

  it("falls back to the next nearest connected node if the geographically closest node is disconnected", () => {
    // Disconnected closest node (0 edges)
    const nCloseDisconnected: Node = { id: "n-close-disc", type: "CORRIDOR", floorId: "f-out", x: 10, y: 10, lat: 11.0, lng: 77.0 };
    // Connected node slightly further
    const nFarConnected1: Node = { id: "n-far-conn-1", type: "OUTDOOR_PATH", floorId: "f-out", x: 50, y: 50, lat: 11.0005, lng: 77.0005 };
    const nFarConnected2: Node = { id: "n-far-conn-2", type: "OUTDOOR_PATH", floorId: "f-out", x: 100, y: 100, lat: 11.001, lng: 77.001 };

    campusStore.addNode(nCloseDisconnected);
    campusStore.addNode(nFarConnected1);
    campusStore.addNode(nFarConnected2);

    campusStore.addEdge({ id: "e-conn", from: "n-far-conn-1", to: "n-far-conn-2", type: "WALK", distance: 50, bidirectional: true });

    const dest: Destination = {
      id: "dest-sf",
      nodeId: "n-far-conn-2",
      name: "SF",
      category: "Classroom",
      aliases: ["SF"],
      floorId: "f-out",
      x: 100,
      y: 100,
    };
    campusStore.addDestination(dest);

    // Candidate ranking
    const candidates = findContextAwareNearestNodes(11.0, 77.0, campusStore.getWorkingData().nodes, {
      isInside: false,
    });

    expect(candidates[0].id).toBe("n-close-disc");

    // Route evaluation iterates candidates until a connected path is found
    let segRoute = null;
    for (const c of candidates) {
      const r = shortestPath(c.id, "dest-sf");
      if (r) {
        segRoute = r;
        break;
      }
    }

    expect(segRoute).not.toBeNull();
    expect(segRoute?.nodes.map((n) => n.id)).toContain("n-far-conn-2");
  });

  it("allows nodes with visibleToUser = false to be used for internal routing", () => {
    const hiddenNode: Node = {
      id: "n-hidden",
      type: "CORRIDOR",
      name: "Internal Service Passageway",
      floorId: "f-out",
      x: 0,
      y: 0,
      visibleToUser: false,
    };
    const destNode: Node = {
      id: "n-dest",
      type: "ROOM",
      name: "SF Room",
      floorId: "f-out",
      x: 100,
      y: 0,
      visibleToUser: true,
    };

    campusStore.addNode(hiddenNode);
    campusStore.addNode(destNode);
    campusStore.addEdge({ id: "e-hidden-dest", from: "n-hidden", to: "n-dest", type: "WALK", distance: 100, bidirectional: true });

    const dest: Destination = {
      id: "dest-sf-hidden",
      nodeId: "n-dest",
      name: "SF",
      category: "Classroom",
      aliases: ["SF"],
      floorId: "f-out",
      x: 100,
      y: 0,
    };
    campusStore.addDestination(dest);

    const route = shortestPath("n-hidden", "dest-sf-hidden");

    expect(route).not.toBeNull();
    expect(route?.nodes.map((n) => n.id)).toEqual(["n-hidden", "n-dest"]);
  });

  it("TEST 1 & 2: selects the genuinely closest node by geographic distance (5m vs 50m, and 10m vs 20m)", () => {
    // Node A at (11.4933, 77.2760), Node B at (11.4938, 77.2760) (~55m North)
    const nodeA: Node = { id: "nA", type: "OUTDOOR_PATH", floorId: "f-out", x: 0, y: 0, lat: 11.4933, lng: 77.2760 };
    const nodeB: Node = { id: "nB", type: "OUTDOOR_PATH", floorId: "f-out", x: 0, y: 55, lat: 11.4938, lng: 77.2760 };

    // Case 1: User is 5m from Node A (11.49334, 77.2760)
    const candidates1 = findContextAwareNearestNodes(11.49334, 77.2760, [nodeA, nodeB], { isInside: false });
    expect(candidates1[0].id).toBe("nA");

    // Case 2: User is 10m from Node B (11.4937, 77.2760) and 45m from Node A
    const candidates2 = findContextAwareNearestNodes(11.4937, 77.2760, [nodeA, nodeB], { isInside: false });
    expect(candidates2[0].id).toBe("nB");
  });

  it("TEST 3: correctly handles nodes with canvas coordinates only (missing/zero lat) via canvasToGps", () => {
    // Node 1: canvas (100, 100), lat: 0
    const node1: Node = { id: "n1", type: "OUTDOOR_PATH", floorId: "f-out", x: 100, y: 100, lat: 0, lng: 0 };
    // Node 2: canvas (300, 300), lat: 0
    const node2: Node = { id: "n2", type: "OUTDOOR_PATH", floorId: "f-out", x: 300, y: 300, lat: 0, lng: 0 };

    // User at canvas position (105, 105) (very close to node1)
    const candidates = findContextAwareNearestNodes(0, 0, [node1, node2], {
      isInside: false,
      userCanvasPos: { x: 105, y: 105 },
    });

    expect(candidates.length).toBe(2);
    expect(candidates[0].id).toBe("n1");
  });

  it("TEST 4: shortestPath from dest-live-user-location chooses the node closest to user, not destination", () => {
    // Node Start (User is at Node Start): x=0, y=0
    const nodeUserStart: Node = { id: "n-user-start", type: "OUTDOOR_PATH", floorId: "f-out", x: 0, y: 0, lat: 11.4933, lng: 77.2760 };
    // Node Middle: x=50, y=0
    const nodeMiddle: Node = { id: "n-mid", type: "OUTDOOR_PATH", floorId: "f-out", x: 50, y: 0, lat: 11.4935, lng: 77.2760 };
    // Node Dest: x=100, y=0
    const nodeDest: Node = { id: "n-dest", type: "OUTDOOR_PATH", floorId: "f-out", x: 100, y: 0, lat: 11.4940, lng: 77.2760 };

    campusStore.addNode(nodeUserStart);
    campusStore.addNode(nodeMiddle);
    campusStore.addNode(nodeDest);

    campusStore.addEdge({ id: "e1", from: "n-user-start", to: "n-mid", type: "WALK", distance: 50, bidirectional: true });
    campusStore.addEdge({ id: "e2", from: "n-mid", to: "n-dest", type: "WALK", distance: 50, bidirectional: true });

    // User is located right at nodeUserStart (11.4933, 77.2760)
    const route = shortestPath("dest-live-user-location", "n-dest", {
      graphData: campusStore.getWorkingData(),
      userLocation: { lat: 11.4933, lng: 77.2760 },
    });

    expect(route).not.toBeNull();
    // Route must start at n-user-start (the node closest to user), NOT n-mid or n-dest!
    expect(route!.nodes[0].id).toBe("n-user-start");
    expect(route!.nodes.map((n) => n.id)).toEqual(["n-user-start", "n-mid", "n-dest"]);
  });

  it("TEST 6-10: visual transformations (zoom, pan, rotation) do not change geographic nearest node", () => {
    const nodeA: Node = { id: "nA", type: "OUTDOOR_PATH", floorId: "f-out", x: 10, y: 10, lat: 11.4933, lng: 77.2760 };
    const nodeB: Node = { id: "nB", type: "OUTDOOR_PATH", floorId: "f-out", x: 500, y: 500, lat: 11.4970, lng: 77.2800 };

    const userLat = 11.49332;
    const userLng = 77.27601;

    // Baseline
    const base = findContextAwareNearestNodes(userLat, userLng, [nodeA, nodeB], { isInside: false });
    expect(base[0].id).toBe("nA");

    // Simulated zoom 500%, zoom 50%, rotate 90°, rotate 180°, pan
    const zooms = [0.5, 1.0, 2.0, 5.0];
    const rotations = [0, 90, 180, 270];

    zooms.forEach((_z) => {
      rotations.forEach((_r) => {
        const result = findContextAwareNearestNodes(userLat, userLng, [nodeA, nodeB], { isInside: false });
        expect(result[0].id).toBe("nA");
      });
    });
  });
});
