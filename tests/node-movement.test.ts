import { describe, it, expect, beforeEach } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import type { Building, Floor, Node, Destination } from "../shared/data/campus";
import { shortestPath } from "../features/navigation/services/graph";

describe("Navigation Node Movement & Visibility Inside Buildings", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("preserves valid coordinates and updates linked destination when moving a room node inside a building", () => {
    const building: Building = {
      id: "bld-main",
      campusId: "c1",
      name: "Main Engineering Block",
      x: 300,
      y: 300,
      width: 200,
      height: 150,
    };
    campusStore.addBuilding(building);

    const floor: Floor = {
      id: "f-main-gnd",
      buildingId: "bld-main",
      name: "Ground Floor",
      ordinal: 0,
    };
    campusStore.addFloor(floor);

    // Initial node outside building at (100, 100)
    const node: Node = {
      id: "node-room-103",
      type: "ROOM",
      name: "Room B #103",
      floorId: "f-main-gnd",
      x: 100,
      y: 100,
      searchable: true,
      visibleToUser: true,
    };
    campusStore.addNode(node);

    const dest: Destination = {
      id: "dest-103",
      nodeId: "node-room-103",
      name: "B",
      roomNumber: "103",
      category: "Classroom",
      aliases: ["103", "B"],
      floorId: "f-main-gnd",
      x: 100,
      y: 100,
    };
    campusStore.addDestination(dest);

    // 1. Move slightly
    campusStore.updateNode("node-room-103", { x: 110, y: 110 });
    let data = campusStore.getWorkingData();
    let updatedNode = data.nodes.find((n) => n.id === "node-room-103");
    let updatedDest = data.destinations.find((d) => d.id === "dest-103");
    expect(updatedNode?.x).toBe(110);
    expect(updatedNode?.y).toBe(110);
    expect(updatedDest?.x).toBe(110);
    expect(updatedDest?.y).toBe(110);
    expect(Number.isFinite(updatedNode?.lat)).toBe(true);
    expect(Number.isFinite(updatedNode?.lng)).toBe(true);

    // 2. Move to center of building (300, 300)
    campusStore.updateNode("node-room-103", { x: 300, y: 300 });
    data = campusStore.getWorkingData();
    updatedNode = data.nodes.find((n) => n.id === "node-room-103");
    updatedDest = data.destinations.find((d) => d.id === "dest-103");
    expect(updatedNode?.x).toBe(300);
    expect(updatedNode?.y).toBe(300);
    expect(updatedDest?.x).toBe(300);
    expect(updatedDest?.y).toBe(300);
    expect(Number.isFinite(updatedNode?.lat)).toBe(true);
    expect(Number.isFinite(updatedNode?.lng)).toBe(true);
    expect(isNaN(updatedNode!.x)).toBe(false);
    expect(isNaN(updatedNode!.y)).toBe(false);

    // 3. Move near all 4 corners/edges inside building
    const testPositions = [
      { x: 210, y: 235 }, // top-left inside
      { x: 390, y: 235 }, // top-right inside
      { x: 210, y: 365 }, // bottom-left inside
      { x: 390, y: 365 }, // bottom-right inside
    ];

    for (const pos of testPositions) {
      campusStore.updateNode("node-room-103", { x: pos.x, y: pos.y });
      data = campusStore.getWorkingData();
      updatedNode = data.nodes.find((n) => n.id === "node-room-103");
      updatedDest = data.destinations.find((d) => d.id === "dest-103");
      expect(updatedNode?.x).toBe(pos.x);
      expect(updatedNode?.y).toBe(pos.y);
      expect(updatedDest?.x).toBe(pos.x);
      expect(updatedDest?.y).toBe(pos.y);
      expect(Number.isFinite(updatedNode?.lat)).toBe(true);
      expect(Number.isFinite(updatedNode?.lng)).toBe(true);
    }
  });

  it("handles multi-step undo and redo correctly for node movements inside buildings", () => {
    const node: Node = {
      id: "node-undo-test",
      type: "ROOM",
      name: "Seminar Hall",
      floorId: "f-main-gnd",
      x: 50,
      y: 50,
      searchable: true,
      visibleToUser: true,
    };
    campusStore.addNode(node);

    // Step 1: Move to (150, 150)
    campusStore.updateNode("node-undo-test", { x: 150, y: 150 });
    // Step 2: Move to (250, 250)
    campusStore.updateNode("node-undo-test", { x: 250, y: 250 });
    // Step 3: Move to (350, 350)
    campusStore.updateNode("node-undo-test", { x: 350, y: 350 });

    let data = campusStore.getWorkingData();
    expect(data.nodes.find((n) => n.id === "node-undo-test")?.x).toBe(350);

    // Undo step 3
    campusStore.undo();
    data = campusStore.getWorkingData();
    expect(data.nodes.find((n) => n.id === "node-undo-test")?.x).toBe(250);

    // Undo step 2
    campusStore.undo();
    data = campusStore.getWorkingData();
    expect(data.nodes.find((n) => n.id === "node-undo-test")?.x).toBe(150);

    // Redo step 2
    campusStore.redo();
    data = campusStore.getWorkingData();
    expect(data.nodes.find((n) => n.id === "node-undo-test")?.x).toBe(250);

    // Redo step 3
    campusStore.redo();
    data = campusStore.getWorkingData();
    expect(data.nodes.find((n) => n.id === "node-undo-test")?.x).toBe(350);
  });

  it("auto-bridges unlinked entrance nodes to nearest pathway nodes during routing", () => {
    // Walkway path: n1 -> n2
    const n1: Node = { id: "n1", type: "OUTDOOR_PATH", floorId: "f-out", x: 0, y: 0 };
    const n2: Node = { id: "n2", type: "OUTDOOR_PATH", floorId: "f-out", x: 100, y: 0 };
    // Isolated entrance node placed nearby at (110, 10) without an explicit edge
    const rpEntrance: Node = { id: "rp-ent-1", name: "RP Entrance 1", type: "BUILDING_ENTRANCE", floorId: "f-out", x: 110, y: 10 };

    campusStore.addNode(n1);
    campusStore.addNode(n2);
    campusStore.addNode(rpEntrance);
    campusStore.addEdge({ id: "e1", from: "n1", to: "n2", type: "WALK", distance: 100, bidirectional: true });

    const dest: Destination = {
      id: "dest-rp-1",
      name: "RP Entrance 1",
      nodeId: "rp-ent-1",
      category: "Entrance",
      aliases: ["RP Entrance 1"],
      floorId: "f-out",
      x: 110,
      y: 10,
    };
    campusStore.addDestination(dest);

    const route = shortestPath("n1", "dest-rp-1");

    expect(route).not.toBeNull();
    expect(route?.nodes.map((n: Node) => n.id)).toContain("n1");
    expect(route?.nodes.map((n: Node) => n.id)).toContain("n2");
    expect(route?.nodes.map((n: Node) => n.id)).toContain("rp-ent-1");
  });
});
