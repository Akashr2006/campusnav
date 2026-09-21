import { describe, it, expect } from "vitest";
import { getValidNavigationDestinations, isStairOrLiftOrUnnamed } from "../shared/lib/destination-utils";
import type { Node, Destination } from "../shared/data/campus";

describe("Navigation Destination Filtering Rules", () => {
  it("excludes unnamed nodes", () => {
    const unnamedNode = { id: "n1", type: "CORRIDOR" as const, floorId: "f1", x: 10, y: 10 };
    expect(isStairOrLiftOrUnnamed(unnamedNode)).toBe(true);

    const emptyNameNode = { id: "n2", name: "   ", type: "ROOM" as const, floorId: "f1", x: 10, y: 10 };
    expect(isStairOrLiftOrUnnamed(emptyNameNode)).toBe(true);
  });

  it("excludes staircases and stair groups", () => {
    const stairNode = { id: "n3", name: "Staircase A", type: "STAIR" as const, floorId: "f1", x: 10, y: 10 };
    expect(isStairOrLiftOrUnnamed(stairNode)).toBe(true);

    const stairGroupNode = { id: "n4", name: "Stair Node", type: "CORRIDOR" as const, stairGroupId: "sg-1", floorId: "f1", x: 10, y: 10 };
    expect(isStairOrLiftOrUnnamed(stairGroupNode)).toBe(true);
  });

  it("excludes lifts, elevators, escalators and lift groups", () => {
    const liftNode = { id: "n5", name: "Main Elevator", type: "LIFT" as const, floorId: "f1", x: 10, y: 10 };
    expect(isStairOrLiftOrUnnamed(liftNode)).toBe(true);

    const liftGroupNode = { id: "n6", name: "Lift Shaft 2", type: "CORRIDOR" as const, liftGroupId: "lg-1", floorId: "f1", x: 10, y: 10 };
    expect(isStairOrLiftOrUnnamed(liftGroupNode)).toBe(true);
  });

  it("includes valid named nodes as selectable destinations when visibleToUser is true", () => {
    const roomNode = { id: "n7", name: "Chemistry Lab 101", type: "LABORATORY" as const, floorId: "f1", x: 10, y: 10, visibleToUser: true };
    expect(isStairOrLiftOrUnnamed(roomNode)).toBe(false);

    const entranceNode = { id: "n8", name: "Main Building Entrance", type: "BUILDING_ENTRANCE" as const, floorId: "f1", x: 10, y: 10, visibleToUser: true };
    expect(isStairOrLiftOrUnnamed(entranceNode)).toBe(false);
  });

  it("builds valid start/end navigation destination list respecting visibleToUser = true", () => {
    const sampleNodes: Node[] = [
      { id: "n-unnamed", floorId: "f1", x: 0, y: 0, type: "CORRIDOR" },
      { id: "n-stair", name: "Staircase West", floorId: "f1", x: 10, y: 10, type: "STAIR", stairGroupId: "sg-1", visibleToUser: true },
      { id: "n-lift", name: "Elevator 1", floorId: "f1", x: 20, y: 20, type: "LIFT", liftGroupId: "lg-1", visibleToUser: true },
      { id: "n-lab", name: "Robotics Lab", floorId: "f1", x: 30, y: 30, type: "LABORATORY", visibleToUser: true },
      { id: "n-office", name: "Dean's Office", floorId: "f1", x: 40, y: 40, type: "OFFICE", visibleToUser: true },
      { id: "n-hidden", name: "Hidden Service Corridor", floorId: "f1", x: 50, y: 50, type: "CORRIDOR", visibleToUser: false },
    ];

    const sampleDestinations: Destination[] = [
      { id: "d-stair", name: "Staircase West", category: "Stairs", nodeId: "n-stair", aliases: [] },
      { id: "d-lab", name: "Robotics Lab", category: "Laboratory", nodeId: "n-lab", aliases: [] },
      { id: "d-hidden", name: "Hidden Maintenance Room", category: "Utility", nodeId: "n-hidden", aliases: [] },
    ];

    const result = getValidNavigationDestinations({
      nodes: sampleNodes,
      destinations: sampleDestinations,
    });

    const names = result.map((d) => d.name);

    // Visible = YES appears in search
    expect(names).toContain("Robotics Lab");
    expect(names).toContain("Dean's Office");

    // Visible = NO does not appear in search
    expect(names).not.toContain("Hidden Service Corridor");
    expect(names).not.toContain("Hidden Maintenance Room");

    // Stairs and lifts excluded
    expect(names).not.toContain("Staircase West");
    expect(names).not.toContain("Elevator 1");
    expect(names.length).toBe(2);
  });

  it("ensures nodes with visibleToUser = false or unnamed nodes are strictly excluded from user search results", () => {
    const nodes: Node[] = [
      { id: "n1", name: "Visible Room 101", floorId: "f1", x: 10, y: 10, type: "ROOM", visibleToUser: true },
      { id: "n2", name: "Hidden Waypoint 102", floorId: "f1", x: 20, y: 20, type: "CORRIDOR", visibleToUser: false },
      { id: "n3", name: "Default Unspecified Node", floorId: "f1", x: 30, y: 30, type: "ROOM" },
      { id: "n4", floorId: "f1", x: 40, y: 40, type: "CORRIDOR" }, // Unnamed
    ];

    const result = getValidNavigationDestinations({ nodes });
    const resultIds = result.map((d) => d.nodeId || d.id);

    expect(resultIds).toContain("n1");
    expect(resultIds).not.toContain("n2");
    expect(resultIds).toContain("n3");
    expect(resultIds).not.toContain("n4");
  });
});
