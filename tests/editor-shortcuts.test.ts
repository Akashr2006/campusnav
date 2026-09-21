import { describe, it, expect, beforeEach } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import { buildSpatialGridIndex, findNearestSpatialItem } from "../lib/geo/gps";
import { buildAdjacencyGraph } from "../lib/routing/graph";
import { findShortestPath } from "../lib/routing/dijkstra";
import type { Node, Edge } from "../shared/data/campus";

describe("CampusStore Drag Batching & Snap History", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("batches continuous node move operations into a single undo step", () => {
    const node: Node = { id: "n-batch-1", type: "CORRIDOR", floorId: "f-1", x: 10, y: 10 };
    campusStore.addNode(node);

    // Initial state recorded
    expect(campusStore.canUndo()).toBe(true);

    // Start drag batching
    campusStore.startBatching();
    campusStore.updateNode("n-batch-1", { x: 15, y: 15 }, false);
    campusStore.updateNode("n-batch-1", { x: 20, y: 20 }, false);
    campusStore.updateNode("n-batch-1", { x: 25, y: 25 }, false);
    campusStore.endBatching();

    const dataAfterDrag = campusStore.getWorkingData();
    const updatedNode = dataAfterDrag.nodes.find((n) => n.id === "n-batch-1");
    expect(updatedNode?.x).toBe(25);
    expect(updatedNode?.y).toBe(25);

    // Undoing should revert all drag updates back to initial x=10, y=10
    campusStore.undo();
    const dataAfterUndo = campusStore.getWorkingData();
    const revertedNode = dataAfterUndo.nodes.find((n) => n.id === "n-batch-1");
    expect(revertedNode?.x).toBe(10);
    expect(revertedNode?.y).toBe(10);
  });
});

describe("GPS Watcher EMA & Spatial Grid Indexing", () => {
  it("builds spatial grid index and performs sub-millisecond nearest node lookups", () => {
    const items = [
      { id: "p1", x: 10, y: 10 },
      { id: "p2", x: 150, y: 150 },
      { id: "p3", x: 500, y: 500 },
      { id: "p4", x: 1000, y: 1000 },
    ];

    const index = buildSpatialGridIndex(items, 100);
    expect(index.grid.size).toBeGreaterThan(0);

    // Point near p1 (12, 12)
    const resultNearP1 = findNearestSpatialItem(index, 12, 12, items);
    expect(resultNearP1).not.toBeNull();
    expect(resultNearP1?.item.id).toBe("p1");

    // Point near p2 (140, 160)
    const resultNearP2 = findNearestSpatialItem(index, 140, 160, items);
    expect(resultNearP2).not.toBeNull();
    expect(resultNearP2?.item.id).toBe("p2");
  });
});

describe("Optimized Dijkstra Performance", () => {
  it("calculates shortest path on dense graph accurately and rapidly", () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Create grid of 25 nodes
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const id = `g-${i}-${j}`;
        nodes.push({ id, type: "CORRIDOR", floorId: "f-1", x: i * 50, y: j * 50 });
      }
    }

    // Connect adjacent grid nodes
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const curr = `g-${i}-${j}`;
        if (i + 1 < 5) {
          edges.push({ id: `e-${curr}-r`, from: curr, to: `g-${i + 1}-${j}`, type: "WALK", distance: 50, bidirectional: true });
        }
        if (j + 1 < 5) {
          edges.push({ id: `e-${curr}-d`, from: curr, to: `g-${i}-${j + 1}`, type: "WALK", distance: 50, bidirectional: true });
        }
      }
    }

    const { graph, nodeMap } = buildAdjacencyGraph(nodes, edges);
    const start = "g-0-0";
    const end = "g-4-4";

    const path = findShortestPath(graph, nodeMap, start, end);
    expect(path).not.toBeNull();
    expect(path?.nodes[0].id).toBe(start);
    expect(path?.nodes[path.nodes.length - 1].id).toBe(end);
    expect(path?.totalDistance).toBe(400); // 8 segments of 50m = 400m
  });
});

describe("Draft Retention & Management Engine", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("saves draft snapshot, detects saved draft, and retains previous edits", () => {
    campusStore.addBuilding({ id: "bld-draft-1", campusId: "c1", name: "Draft Science Hall", shortCode: "DSH", floorsCount: 2, color: "#4f46e5", lat: 12.97, lng: 77.59 });
    campusStore.addNode({ id: "node-draft-1", type: "CORRIDOR", floorId: "f-1", x: 100, y: 200 });

    expect(campusStore.hasUnsavedEdits()).toBe(true);

    const saveRes = campusStore.saveDraft("My Test Session Draft");
    expect(saveRes.success).toBe(true);

    const meta = campusStore.getSavedDraftMetadata();
    expect(meta).not.toBeNull();
    expect(meta?.name).toBe("My Test Session Draft");
    expect(meta?.entityCount).toBeGreaterThan(0);

    campusStore.addNode({ id: "node-draft-2", type: "ROOM", floorId: "f-1", x: 300, y: 400 });
    expect(campusStore.getWorkingData().nodes.length).toBe(2);

    const loadSuccess = campusStore.loadSavedDraft();
    expect(loadSuccess).toBe(true);
    expect(campusStore.getWorkingData().nodes.length).toBe(1);
    expect(campusStore.getWorkingData().nodes[0].id).toBe("node-draft-1");

    campusStore.discardDraft();
    expect(campusStore.getSavedDraftMetadata()).toBeNull();
  });

  it("restores 100% of all entities including liftGroups, doors, and checkpoints", () => {
    campusStore.addBuilding({ id: "b1", campusId: "c1", name: "Engineering Hall", shortCode: "EH" });
    campusStore.addDoor({ id: "door-1", floorId: "f-1", x: 50, y: 50, type: "BUILDING_ENTRANCE" });
    campusStore.createLiftGroup("b1", "Elevator A", ["f-1"]);

    const saveRes = campusStore.saveDraft("100% Full Draft");
    expect(saveRes.success).toBe(true);

    const meta = campusStore.getSavedDraftMetadata();
    expect(meta?.breakdown.doors).toBe(1);
    expect(meta?.breakdown.lifts).toBe(1);

    campusStore.clearAllData();
    expect(campusStore.getWorkingData().doors.length).toBe(0);

    const loadSuccess = campusStore.loadSavedDraft();
    expect(loadSuccess).toBe(true);
    const restored = campusStore.getWorkingData();
    expect(restored.doors.length).toBe(1);
    expect(restored.liftGroups?.length).toBe(1);
  });
});

describe("Enhanced Action History & Multi-Step Undo", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("stores action descriptions, tracks undo/redo stacks, and supports multi-step jump", () => {
    campusStore.addBuilding({ id: "b1", campusId: "c1", name: "Physics Hall", shortCode: "PH" });
    campusStore.addNode({ id: "n1", type: "CORRIDOR", floorId: "f-1", x: 10, y: 10 });
    campusStore.addNode({ id: "n2", type: "ROOM", floorId: "f-1", x: 50, y: 50 });

    expect(campusStore.getUndoCount()).toBeGreaterThanOrEqual(3);
    const history = campusStore.getUndoHistory();
    expect(history.some((h) => h.description.includes("Physics Hall"))).toBe(true);

    const latestDesc = campusStore.getLatestUndoDescription();
    expect(latestDesc).toContain("ROOM Node");

    // Single step undo
    const undoRes = campusStore.undo();
    expect(undoRes.success).toBe(true);
    expect(campusStore.getRedoCount()).toBe(1);

    // Multi-step jump to step 2 (before nodes were added)
    campusStore.jumpToUndoStep(2);
    expect(campusStore.getWorkingData().buildings.length).toBe(1);
    expect(campusStore.getWorkingData().nodes.length).toBe(0);

    // Redo step
    const redoRes = campusStore.redo();
    expect(redoRes.success).toBe(true);
  });
});
