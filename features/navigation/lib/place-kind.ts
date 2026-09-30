/**
 * Classifies a campus feature by name so the 2D map can pick a marker and a
 * fill without the data carrying a category. Names are the only signal the
 * published graph has for this (see HANDOFF.md).
 */
export type PlaceKind =
  | "academic"
  | "lab"
  | "hostel"
  | "hall"
  | "library"
  | "sports"
  | "water"
  | "residence"
  | "transport"
  | "utility"
  | "construction";

export function placeKind(name: string): PlaceKind {
  const n = name.toLowerCase();
  if (/pond|lake|tank/.test(n)) return "water";
  if (/ground|court|track|sports|stadium/.test(n)) return "sports";
  if (/shed|poly ?house|store/.test(n)) return "utility";
  if (/construction/.test(n)) return "construction";
  if (/bus|parking|gate/.test(n)) return "transport";
  if (/hostel/.test(n)) return "hostel";
  if (/apartment|quarters|staff/.test(n)) return "residence";
  if (/hall|auditorium/.test(n)) return "hall";
  if (/learning centre|library/.test(n)) return "library";
  if (/lab|biotech|cse|cs block|it |eee|mech|me block|aero/.test(n)) return "lab";
  return "academic";
}

export const KIND_LABEL: Record<PlaceKind, string> = {
  academic: "Academic",
  lab: "Departments & labs",
  hostel: "Hostels",
  hall: "Halls",
  library: "Library",
  sports: "Sports",
  water: "Water",
  residence: "Staff housing",
  transport: "Transport",
  utility: "Utility",
  construction: "Under construction",
};

/** Marker colour per kind. Purple is the default, as in most indoor-map UIs. */
export const KIND_COLOR: Record<PlaceKind, string> = {
  academic: "#6d4bd8",
  lab: "#4f46e5",
  hostel: "#db2777",
  hall: "#ea580c",
  library: "#0d9488",
  sports: "#16a34a",
  water: "#0284c7",
  residence: "#9333ea",
  transport: "#2563eb",
  utility: "#64748b",
  construction: "#ca8a04",
};

/** The chips shown above the map, in order. */
export const FILTER_KINDS: PlaceKind[] = ["academic", "lab", "hostel", "hall", "library", "sports", "residence"];

/** Grounds and water are painted as land cover, not as blocks. */
export function isLandCover(kind: PlaceKind) {
  return kind === "sports" || kind === "water";
}
