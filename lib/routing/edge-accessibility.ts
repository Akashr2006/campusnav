import type { PathType } from "@/shared/data/campus";

export type TravelMode = "WALK" | "EV";

export const WALK_SPEED = 1.3; // m/s (~4.7 km/h)
export const EV_SPEED = 5.5;   // m/s (~20 km/h)

/**
 * Normalizes and extracts the canonical PathType for an edge.
 * Legacy/fallback migration: if pathType is missing, ROAD edges default to "EV", others default to "WALK".
 */
export function getEdgePathType(edge: { pathType?: PathType | null; type?: string }): PathType {
  if (edge.pathType === "EV" || edge.pathType === "WALK") {
    return edge.pathType;
  }
  // Safe backward-compatible fallback for pre-existing graph data
  return edge.type === "ROAD" ? "EV" : "WALK";
}

/**
 * Returns true if Electric Vehicles are permitted to traverse the edge.
 * Canonical rule: pathType === "EV" -> true; pathType === "WALK" -> false.
 */
export function isEVAllowed(edge: { pathType?: PathType | null; type?: string }): boolean {
  return getEdgePathType(edge) === "EV";
}

/**
 * Returns true if pedestrians are permitted to traverse the edge.
 * Canonical rule: Both "EV" and "WALK" paths are always walkable.
 */
export function isWalkable(_edge?: { pathType?: PathType | null; type?: string }): boolean {
  void _edge;
  return true;
}

/**
 * Centralized edge accessibility verification function.
 *
 * SEMANTICS:
 * - mode = "WALK":
 *   - EV Path -> ALLOWED
 *   - Only Walk Path -> ALLOWED
 * - mode = "EV":
 *   - EV Path -> ALLOWED
 *   - Only Walk Path -> BLOCKED (excluded from EV routing graph)
 */
export function canTraverseEdge(
  edge: { pathType?: PathType | null; type?: string; closed?: boolean; accessible?: boolean },
  mode: TravelMode = "WALK"
): boolean {
  // If edge is closed, it cannot be traversed regardless of mode
  if (edge.closed) return false;

  const pathType = getEdgePathType(edge);

  if (mode === "WALK") {
    // Both EV Path and Only Walk Path are allowed for walking
    return pathType === "EV" || pathType === "WALK";
  }

  if (mode === "EV") {
    // Only EV Path is allowed for Electric Vehicles
    return pathType === "EV";
  }

  return true;
}

/**
 * Returns a human-friendly label and description for an edge path type.
 */
export function getPathTypeLabel(pathType?: PathType | null, edgeType?: string): {
  label: string;
  shortLabel: string;
  description: string;
  isEVAllowed: boolean;
  isWalkable: boolean;
} {
  const canonical = getEdgePathType({ pathType, type: edgeType });
  if (canonical === "EV") {
    return {
      label: "EV Path",
      shortLabel: "EV + Walk",
      description: "Electric vehicle + walking allowed",
      isEVAllowed: true,
      isWalkable: true,
    };
  }
  return {
    label: "Only Walk Path",
    shortLabel: "Walk Only",
    description: "Walking only — EV prohibited",
    isEVAllowed: false,
    isWalkable: true,
  };
}
