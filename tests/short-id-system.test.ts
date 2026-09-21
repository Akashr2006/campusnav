import { describe, it, expect, beforeEach } from "vitest";
import { generateShortId } from "../shared/lib/id-generator";
import { campusStore } from "../shared/lib/campus-store";

describe("Short & Unique ID Generator System", () => {
  it("generates short 6-character IDs with appropriate prefix (prefix-xxxx)", () => {
    const nodeId = generateShortId("n");
    const edgeId = generateShortId("e");
    const bldId = generateShortId("b");
    const floorId = generateShortId("f");
    const destId = generateShortId("d");

    expect(nodeId).toMatch(/^n-[a-z0-9]{4}$/);
    expect(edgeId).toMatch(/^e-[a-z0-9]{4}$/);
    expect(bldId).toMatch(/^b-[a-z0-9]{4}$/);
    expect(floorId).toMatch(/^f-[a-z0-9]{4}$/);
    expect(destId).toMatch(/^d-[a-z0-9]{4}$/);
  });

  it("avoids collisions against existing IDs set", () => {
    const existing = new Set(["n-a1b2", "n-c3d4", "n-e5f6"]);
    const id = generateShortId("n", existing);
    expect(existing.has(id)).toBe(false);
    expect(id).toMatch(/^n-[a-z0-9]{4}$/);
  });

  it("compactAllIds cleanly shortens all existing long IDs while preserving topological connections", () => {
    campusStore.clearAll();

    const longBldId = "b-1786947132740-gcpy89";
    const longFloorId = "f-b-1786947132740-gcpy89-floor1";
    const longNode1 = "n-1786947132740-node-start";
    const longNode2 = "n-1786947132740-node-end";
    const longEdge = "e-1786947132740-edge-1";
    const longDest = "dest-room-1786947132740-lab";

    campusStore.addBuilding({
      id: longBldId,
      campusId: "c1",
      name: "Computer Science Block",
      shortCode: "CSB",
      x: 500,
      y: 500,
      width: 200,
      height: 150,
      floorsCount: 1,
    });

    campusStore.addFloor({
      id: longFloorId,
      buildingId: longBldId,
      name: "First Floor",
      ordinal: 1,
      code: "F1",
    });

    campusStore.addNode(
      {
        id: longNode1,
        type: "CORRIDOR",
        name: "Hallway Entry",
        floorId: longFloorId,
        x: 520,
        y: 520,
      },
      false
    );

    campusStore.addNode(
      {
        id: longNode2,
        type: "ROOM",
        name: "CS Lab 101",
        floorId: longFloorId,
        x: 580,
        y: 580,
      },
      false
    );

    campusStore.addEdge({
      id: longEdge,
      from: longNode1,
      to: longNode2,
      type: "WALK",
      distance: 20,
      bidirectional: true,
    });

    campusStore.addDestination({
      id: longDest,
      nodeId: longNode2,
      floorId: longFloorId,
      name: "CS Lab 101",
      category: "Laboratory",
      aliases: ["101"],
    });

    const result = campusStore.compactAllIds();
    expect(result.success).toBe(true);

    const working = campusStore.getWorkingData();

    // Check buildings are short
    expect(working.buildings[0].id).toMatch(/^b-[a-z0-9]{4}$/);
    const newBldId = working.buildings[0].id;

    // Check floor references updated building
    const f1 = working.floors.find((f) => f.name === "First Floor");
    expect(f1).toBeDefined();
    expect(f1!.id).toMatch(/^f-[a-z0-9]{4}$/);
    expect(f1!.buildingId).toBe(newBldId);

    // Check nodes shortened
    expect(working.nodes.length).toBe(2);
    expect(working.nodes[0].id).toMatch(/^n-[a-z0-9]{4}$/);
    expect(working.nodes[1].id).toMatch(/^n-[a-z0-9]{4}$/);
    expect(working.nodes[0].floorId).toBe(f1!.id);
    expect(working.nodes[1].floorId).toBe(f1!.id);

    // Check edge connections preserved with new short IDs
    expect(working.edges.length).toBe(2); // bidirectional
    const baseEdge = working.edges.find((e) => !e.id.endsWith("_rev") && !e.id.startsWith("e-stair") && !e.id.startsWith("e-lift"));
    expect(baseEdge).toBeDefined();
    expect(baseEdge!.id).toMatch(/^e-[a-z0-9]{4}$/);
    expect(baseEdge!.from).toBe(working.nodes[0].id);
    expect(baseEdge!.to).toBe(working.nodes[1].id);

    // Check destination linked node reference preserved
    expect(working.destinations[0].id).toMatch(/^d-[a-z0-9]{4}$/);
    expect(working.destinations[0].nodeId).toBe(working.nodes[1].id);
    expect(working.destinations[0].floorId).toBe(f1!.id);
  });

  it("creates stair groups and lift groups with short node and edge IDs", () => {
    campusStore.clearAll();

    const bld = campusStore.addBuilding({
      id: "b-test",
      campusId: "c1",
      name: "Engineering Hall",
      shortCode: "ENG",
      x: 300,
      y: 300,
      width: 200,
      height: 150,
      floorsCount: 2,
    });

    const f1 = campusStore.addFloor("b-test", "Level 1", 1, "L1");
    const f2 = campusStore.addFloor("b-test", "Level 2", 2, "L2");

    const stairGroup = campusStore.createStairGroup("b-test", "Staircase A", [f1.id, f2.id]);
    expect(stairGroup.id).toMatch(/^stair-[a-z0-9]{4}$/);

    const working = campusStore.getWorkingData();
    const stairNodes = working.nodes.filter((n) => n.stairGroupId === stairGroup.id);
    expect(stairNodes.length).toBe(2);
    stairNodes.forEach((n) => {
      expect(n.id).toMatch(/^n-[a-z0-9]{4}$/);
    });

    const stairEdges = working.edges.filter((e) => e.stairGroupId === stairGroup.id);
    expect(stairEdges.length).toBeGreaterThanOrEqual(2);
    stairEdges.forEach((e) => {
      expect(e.id).toMatch(/^e-[a-z0-9]{4}(_rev)?$/);
    });
  });
});
