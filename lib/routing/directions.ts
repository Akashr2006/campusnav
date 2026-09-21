import type { Node } from "@/shared/data/campus";
import type { AdjacencyEdge } from "./graph";

export type DirectionIcon =
  | "straight"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "u-turn"
  | "stairs-up"
  | "stairs-down"
  | "lift"
  | "parking"
  | "ev-drive"
  | "walk"
  | "arrive";

export interface DirectionStep {
  text: string;
  distanceMeters: number;
  icon: DirectionIcon;
  bearingDelta?: number;
  floorChange?: { from: string; to: string };
  targetNodeId: string;
  targetNodeName?: string;
  photoUrl?: string;
}

export function getNodeVector(n1: Node, n2: Node): { dx: number; dy: number } {
  if (
    n1.x !== undefined &&
    n1.y !== undefined &&
    n2.x !== undefined &&
    n2.y !== undefined &&
    (n1.x !== n2.x || n1.y !== n2.y)
  ) {
    return { dx: n2.x - n1.x, dy: n2.y - n1.y };
  }
  if (
    n1.lat !== undefined &&
    n1.lng !== undefined &&
    n2.lat !== undefined &&
    n2.lng !== undefined &&
    (n1.lat !== n2.lat || n1.lng !== n2.lng)
  ) {
    const latRad = (n1.lat * Math.PI) / 180;
    const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
    const metersPerDegLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
    const dx = (n2.lng - n1.lng) * metersPerDegLng;
    const dy = -(n2.lat - n1.lat) * metersPerDegLat; // Negative because North is -Y in screen coordinates
    return { dx, dy };
  }
  return { dx: 0, dy: 0 };
}

export function calculateTurnAngle(
  v1: { dx: number; dy: number },
  v2: { dx: number; dy: number }
): number {
  const len1 = Math.hypot(v1.dx, v1.dy);
  const len2 = Math.hypot(v2.dx, v2.dy);
  if (len1 === 0 || len2 === 0) return 0;

  // In Screen/Canvas Coordinates (+X East, +Y South):
  // Cross product (v1.dx * v2.dy - v1.dy * v2.dx):
  // > 0 indicates turning CLOCKWISE (RIGHT turn in user's travel direction)
  // < 0 indicates turning COUNTER-CLOCKWISE (LEFT turn in user's travel direction)
  const cross = v1.dx * v2.dy - v1.dy * v2.dx;
  const dot = v1.dx * v2.dx + v1.dy * v2.dy;

  const angleRad = Math.atan2(cross, dot);
  return (angleRad * 180) / Math.PI;
}

export function turnIconFromAngle(angleDeg: number): DirectionIcon {
  let norm = ((angleDeg % 360) + 360) % 360;
  if (norm > 180) norm -= 360;

  if (Math.abs(norm) <= 25) return "straight";
  if (norm > 25 && norm <= 45) return "slight-right";
  if (norm > 45 && norm <= 135) return "right";
  if (norm > 135 && norm < 155) return "sharp-right";
  if (norm < -25 && norm >= -45) return "slight-left";
  if (norm < -45 && norm >= -135) return "left";
  if (norm < -135 && norm > -155) return "sharp-left";
  return "u-turn";
}

export function isTechnicalOrWaypointName(name?: string): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  if (!trimmed) return true;

  // 1. Technical waypoint / route point patterns (e.g. "RP 1", "RP2", "RP-1", "RP_1", "RP10", "RP_123", "RP-OUT-1")
  if (
    /^rp[\s_\-]*\d+$/i.test(trimmed) ||
    /^rp[\s_\-]+(?:out|indoor|node|wp|pt|seg|point|coord|waypoint|loc|pos|junction|jct)[\s_\-]*\d*$/i.test(trimmed)
  ) {
    return true;
  }

  // 2. Node IDs: "n1", "n102", "node_14", "node 14", "node-14", "node14", "node_123", "n-1", "n_1"
  if (/^n[\s_\-]*\d+$/i.test(trimmed) || /^node[\s_\-]*\d+$/i.test(trimmed)) {
    return true;
  }

  // 3. Waypoint / Point / Route / Segment IDs: "wp 1", "wp_1", "waypoint 1", "pt 1", "point 1", "segment 1", "edge 1"
  if (/^(wp|waypoint|point|pt|seg|segment|edge|path|coord|loc|pos)[\s_\-]*\d+$/i.test(trimmed)) {
    return true;
  }

  // 4. Infrastructure IDs: "junction 1", "junction_4", "junction-4", "junction4", "jct 2", "corridor 1", "corr 2", "stair 1", "lift 1", "door 1"
  if (/^(junction|jct|junc|corridor|corr|stair|staircase|lift|elevator|door|gate)[\s_\-]*\d+$/i.test(trimmed)) {
    return true;
  }

  // 5. Raw UUIDs or Alphanumeric IDs (e.g. "n-17294827-abc", "f-out", "bld-rp", "dest-123")
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(trimmed) || /^[a-z]+-[0-9]+-[a-z0-9]+$/i.test(trimmed)) {
    return true;
  }

  return false;
}

export function cleanLandmarkName(name?: string): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (isTechnicalOrWaypointName(trimmed)) {
    return null;
  }
  return trimmed;
}

export function formatInstructionText(
  icon: DirectionIcon,
  targetName?: string,
  floorChange?: { from: string; to: string; toFloorName?: string },
  isEntrance?: boolean,
  bldName?: string,
  isExit?: boolean
): string {
  const landmark = cleanLandmarkName(targetName);

  if (isExit) {
    return "Exit the building";
  }

  if (icon === "lift") {
    return floorChange?.toFloorName ? `Take lift to ${floorChange.toFloorName}` : "Take the lift";
  }
  if (icon === "stairs-up" || icon === "stairs-down") {
    return floorChange?.toFloorName ? `Take stairs to ${floorChange.toFloorName}` : "Take the stairs";
  }
  if (isEntrance) {
    return bldName ? `Enter ${bldName}` : "Enter the building";
  }

  switch (icon) {
    case "straight":
      return landmark ? `Continue straight toward ${landmark}` : "Go straight";
    case "slight-left":
      return landmark ? `Keep left at ${landmark}` : "Keep left";
    case "left":
      return landmark ? `Turn left at ${landmark}` : "Turn left";
    case "sharp-left":
      return landmark ? `Turn sharply left at ${landmark}` : "Turn sharply left";
    case "slight-right":
      return landmark ? `Keep right at ${landmark}` : "Keep right";
    case "right":
      return landmark ? `Turn right at ${landmark}` : "Turn right";
    case "sharp-right":
      return landmark ? `Turn sharply right at ${landmark}` : "Turn sharply right";
    case "u-turn":
      return landmark ? `Turn around at ${landmark}` : "Turn around";
    case "arrive":
      return landmark ? `You have arrived at ${landmark}` : "You have arrived";
    default:
      return "Go straight";
  }
}

export function generateDirections(
  nodes: Node[],
  edges: AdjacencyEdge[],
  floorNames: Map<string, string> = new Map(),
  buildingNames: Map<string, string> = new Map()
): DirectionStep[] {
  if (nodes.length < 2 || edges.length === 0) {
    if (nodes.length === 1) {
      const landmark = cleanLandmarkName(nodes[0].name);
      return [
        {
          text: landmark ? `You have arrived at ${landmark}` : "You have arrived",
          distanceMeters: 0,
          icon: "arrive",
          targetNodeId: nodes[0].id,
          targetNodeName: nodes[0].name,
          photoUrl: nodes[0].photoUrl,
        },
      ];
    }
    return [];
  }

  const steps: DirectionStep[] = [];
  let prevVector: { dx: number; dy: number } | null = null;

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const fromNode = nodes[i];
    const toNode = nodes[i + 1];
    if (!toNode) continue;

    const fromFloor = fromNode.floorId;
    const toFloor = toNode.floorId;
    const isFloorTransition = fromFloor !== toFloor;

    const toFloorName = floorNames.get(toFloor) ?? toFloor;
    const toBldName = buildingNames.get(toFloor);

    const isFromOutdoor = fromFloor === "f-out" || fromFloor === "outdoor";
    const isToOutdoor = toFloor === "f-out" || toFloor === "outdoor";

    const isOutdoorToIndoor = isFromOutdoor && !isToOutdoor;
    const isIndoorToOutdoor = !isFromOutdoor && isToOutdoor;

    if (edge.type === "LIFT") {
      steps.push({
        text: `Take lift to ${toFloorName}`,
        distanceMeters: edge.distance,
        icon: "lift",
        floorChange: { from: fromFloor, to: toFloor },
        targetNodeId: toNode.id,
        targetNodeName: toNode.name,
        photoUrl: toNode.photoUrl,
      });
      prevVector = null;
      continue;
    }

    if (edge.type === "STAIRS") {
      const getFloorRank = (fId?: string, fName?: string, nName?: string): number => {
        const combined = `${fId || ""} ${fName || ""} ${nName || ""}`.toLowerCase();
        if (combined.includes("ground") || combined.includes("gnd") || combined.endsWith("-g") || combined.endsWith("-0")) return 0;
        if (combined.includes("base") || combined.includes("b-") || combined.includes("-1")) return -1;
        const match = combined.match(/(?:floor|fl|level|lvl|f)\s*(\d+)/i);
        if (match) return parseInt(match[1], 10);
        return 0;
      };

      const fromRank = getFloorRank(fromFloor, floorNames.get(fromFloor), fromNode.name);
      const toRank = getFloorRank(toFloor, toFloorName, toNode.name);
      const isUp = toRank >= fromRank;

      steps.push({
        text: `Take stairs to ${toFloorName}`,
        distanceMeters: edge.distance,
        icon: isUp ? "stairs-up" : "stairs-down",
        floorChange: isFloorTransition ? { from: fromFloor, to: toFloor } : undefined,
        targetNodeId: toNode.id,
        targetNodeName: toNode.name,
        photoUrl: toNode.photoUrl,
      });
      prevVector = null;
      continue;
    }

    const currentVector = getNodeVector(fromNode, toNode);
    let icon: DirectionIcon = "straight";
    let delta = 0;

    if (prevVector !== null && !isFloorTransition) {
      delta = calculateTurnAngle(prevVector, currentVector);
      icon = turnIconFromAngle(delta);
    }
    prevVector = currentVector;

    const isEntrance = (toNode.type === "ENTRANCE" || toNode.type === "BUILDING_ENTRANCE" || toNode.isEntranceNode) && isOutdoorToIndoor;
    const text = formatInstructionText(
      icon,
      toNode.name,
      isFloorTransition ? { from: fromFloor, to: toFloor, toFloorName } : undefined,
      isEntrance,
      toBldName,
      isIndoorToOutdoor
    );

    steps.push({
      text,
      distanceMeters: edge.distance,
      icon,
      bearingDelta: delta,
      floorChange: isFloorTransition ? { from: fromFloor, to: toFloor } : undefined,
      targetNodeId: toNode.id,
      targetNodeName: toNode.name,
      photoUrl: toNode.photoUrl,
    });
  }

  const lastNode = nodes[nodes.length - 1];
  const lastLandmark = cleanLandmarkName(lastNode.name);
  steps.push({
    text: lastLandmark ? `You have arrived at ${lastLandmark}` : "You have arrived",
    distanceMeters: 0,
    icon: "arrive",
    targetNodeId: lastNode.id,
    targetNodeName: lastNode.name,
    photoUrl: lastNode.photoUrl,
  });

  // Combine consecutive "Go straight" steps and sum their distances into one clean step
  const merged: DirectionStep[] = [];
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const prev = merged[merged.length - 1];

    const isStraight = current.icon === "straight";
    const prevIsStraight = prev && prev.icon === "straight";
    const noFloorChange = prev && !prev.floorChange && !current.floorChange;

    if (prev && prevIsStraight && isStraight && noFloorChange && current.icon !== "arrive") {
      prev.distanceMeters = Math.round(prev.distanceMeters + current.distanceMeters);
      prev.targetNodeId = current.targetNodeId || prev.targetNodeId;
      prev.targetNodeName = current.targetNodeName || prev.targetNodeName;
      if (current.photoUrl) prev.photoUrl = current.photoUrl;
      if (current.text && current.text !== "Go straight" && prev.text === "Go straight") {
        prev.text = current.text;
      }
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}
