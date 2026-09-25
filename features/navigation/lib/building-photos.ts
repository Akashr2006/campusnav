/**
 * Which 360 tour scene shows each building, for the photo bubble and the
 * building card on the 2D map. Deliberately an explicit list: tour labels
 * ("Aero Block", "BT Block") do not match building names closely enough for
 * a fuzzy match to be trusted, and a wrong photo is worse than none.
 */
const SCENE_FOR_BUILDING: Record<string, number> = {
  "n-blk-ne2": 8, // Aeronautical Block <- "Aero Block"
  "n-blk-a1": 11, // Biotechnology Block <- "BT Block"
  "n-blk-d1": 14, // Mechanical Block <- "Mech Block"
  "n-blk-d2": 43, // ME Block <- "ME Block Entry"
  "n-blk-e1": 18, // BIT Learning Centre <- "Learning Centre"
  "b-blk-sw": 25, // Women's Hostel <- "Girls Hostel"
  "s-track": 12, // BIT Ground <- "Athletic Track"
};

const TOUR_BASE = process.env.NEXT_PUBLIC_TOUR_BASE_URL ?? "/tour";

export type BuildingPhoto = { thumb: string; full: string };

export function buildingPhoto(buildingId: string): BuildingPhoto | null {
  const scene = SCENE_FOR_BUILDING[buildingId];
  if (scene === undefined) return null;
  return { thumb: `${TOUR_BASE}/${scene}/thumb.jpg`, full: `${TOUR_BASE}/${scene}/pano.jpg` };
}
