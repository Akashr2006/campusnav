import type { Node, Destination, Building } from "@/shared/data/campus";

/**
 * Checks if a node or destination represents a staircase, lift, elevator, escalator,
 * lift/stair group, or is unnamed.
 */
export function isStairOrLiftOrUnnamed(item: {
  name?: string;
  type?: string;
  category?: string;
  stairGroupId?: string;
  liftGroupId?: string;
}): boolean {
  // 1. Must have a valid name (exclude unnamed nodes)
  if (!item.name || item.name.trim().length === 0) {
    return true;
  }

  const typeUpper = (item.type || "").toUpperCase();
  const catUpper = (item.category || "").toUpperCase();
  const nameLower = item.name.toLowerCase();

  // 2. Exclude stair & lift types / groups
  if (
    typeUpper === "STAIR" ||
    typeUpper === "STAIRS" ||
    typeUpper === "LIFT" ||
    typeUpper === "ELEVATOR" ||
    typeUpper === "ESCALATOR" ||
    Boolean(item.stairGroupId) ||
    Boolean(item.liftGroupId)
  ) {
    return true;
  }

  // 3. Exclude stair & lift categories
  if (
    catUpper === "STAIRS" ||
    catUpper === "STAIR" ||
    catUpper === "LIFT" ||
    catUpper === "ELEVATOR" ||
    catUpper === "ESCALATOR" ||
    catUpper === "FLOOR TRANSITION"
  ) {
    return true;
  }

  // 4. Exclude stair & lift names (e.g. "Staircase A", "Lift Group 1", "Elevator 2", "Escalator B")
  if (/\b(stair|stairs|staircase|stairway|lift|elevator|escalator)\b/i.test(nameLower)) {
    return true;
  }

  return false;
}

/**
 * Builds the list of valid user navigation start/end destinations from published graph data.
 * - Excludes all staircases, lifts, lift groups, escalators, and unnamed nodes.
 * - Includes all named nodes, explicit destinations, and campus buildings.
 * - Keyed by nodeId/id to avoid duplicate options for the same node.
 */
export function getValidNavigationDestinations(
  publishedData: {
    buildings?: Building[];
    floors?: any[];
    nodes?: Node[];
    destinations?: Destination[];
  }
): Destination[] {
  const nodes = publishedData.nodes || [];
  const destinations = publishedData.destinations || [];
  const buildings = publishedData.buildings || [];
  const floors = publishedData.floors || [];

  const buildingMap = new Map<string, Building>();
  buildings.forEach((b) => buildingMap.set(b.id, b));

  const floorMap = new Map<string, any>();
  floors.forEach((f: any) => floorMap.set(f.id, f));

  const nodeMap = new Map<string, Node>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const validMap = new Map<string, Destination>();

  // 1. Process explicit destinations
  destinations.forEach((d) => {
    if (!d.name || d.name.trim().length === 0) return;
    if (d.category === "Building") return;

    // Linked node check
    if (d.nodeId) {
      const linkedNode = nodeMap.get(d.nodeId);
      if (linkedNode && (isStairOrLiftOrUnnamed(linkedNode) || linkedNode.visibleToUser === false)) {
        return;
      }
    }

    if (isStairOrLiftOrUnnamed(d)) {
      return;
    }

    const key = d.nodeId || d.id;
    validMap.set(key, d);
  });

  // 2. Process all named nodes (include all named nodes unless explicitly hidden with visibleToUser === false)
  nodes.forEach((n) => {
    if (isStairOrLiftOrUnnamed(n)) return;
    if (n.visibleToUser === false) return;

    if (!validMap.has(n.id)) {
      const floor = n.floorId ? floorMap.get(n.floorId) : undefined;
      const bld = floor?.buildingId ? buildingMap.get(floor.buildingId) : undefined;

      const isEntrance = n.type === "GATE" || n.type === "BUILDING_ENTRANCE" || n.type === "ROOM_ENTRANCE" || n.isEntranceNode || n.name!.toLowerCase().includes("entrance") || n.name!.toLowerCase().includes("gate");
      const isRoom = n.type === "ROOM" || n.type === "LABORATORY" || n.type === "OFFICE" || n.name!.toLowerCase().includes("room") || n.name!.toLowerCase().includes("lab") || n.name!.toLowerCase().includes("class");

      const typeLabel =
        n.type === "GATE" || n.name!.toLowerCase().includes("gate")
          ? "Gate / Entrance"
          : isEntrance
          ? "Building Entrance"
          : n.type === "RECEPTION" || n.name!.toLowerCase().includes("reception")
          ? "Reception"
          : isRoom
          ? "Room / Lab"
          : n.type === "OUTDOOR" || n.type === "OUTDOOR_PATH" || n.type === "ROAD_JUNCTION"
          ? "Campus Landmark"
          : (bld ? `${bld.name} Node` : "Campus Node");

      const locationDetails = [
        bld ? bld.name : null,
        floor && floor.name && floor.id !== "f-out" ? floor.name : null,
      ].filter(Boolean).join(" · ");

      const categoryDisplay = locationDetails ? `${typeLabel} · ${locationDetails}` : typeLabel;

      validMap.set(n.id, {
        id: n.id,
        name: n.name!.trim(),
        category: categoryDisplay,
        floorId: n.floorId,
        nodeId: n.id,
        x: n.x,
        y: n.y,
        buildingId: bld?.id,
        aliases: [
          n.name!.trim(),
          n.type,
          ...(bld ? [bld.name, bld.shortCode || ""] : []),
          ...(n.name!.toLowerCase().includes("gate") ? ["gate", "entrance", "main gate", "a gate"] : []),
          ...(n.name!.toLowerCase().includes("entrance") ? ["entrance", "entry", "door"] : []),
          ...(n.name!.toLowerCase().includes("room") ? ["classroom", "room", "hall"] : []),
          ...(n.name!.toLowerCase().includes("node") ? ["node", "waypoint"] : []),
        ].filter(Boolean),
      });
    }
  });

  // 3. Process campus buildings as selectable navigation destinations
  buildings.forEach((b) => {
    if (!b.name || b.name.trim().length === 0) return;
    const bldKey = `bld-dest-${b.id}`;
    if (!validMap.has(b.id) && !validMap.has(bldKey)) {
      validMap.set(bldKey, {
        id: bldKey,
        name: b.name.trim(),
        category: "Building",
        nodeId: b.id,
        x: b.x,
        y: b.y,
        buildingId: b.id,
        aliases: [b.name.trim(), b.shortCode || ""].filter(Boolean),
      });
    }
  });

  return Array.from(validMap.values());
}
