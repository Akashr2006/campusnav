/**
 * Which 360 tour scene shows each building, for the photo bubble and the
 * building card on the 2D map. Deliberately an explicit list: tour labels
 * ("Aero Block", "Netcafe", "T & P") do not match building names closely
 * enough for a fuzzy match to be trusted, and a wrong photo is worse than none.
 * Names follow GeoBITs since 2026-10-14; a scene is listed only where its label
 * names the same place (or its photo shows the place's sign).
 */
import { TOUR_SCENES } from "@/shared/data/campus-tour";

const SCENE_FOR_BUILDING: Record<string, number> = {
  "n-blk-ne2": 8, // Aeronautical Block <- "Aero Block"
  "n-blk-ne4": 14, // Mechanical Block <- "Mech Block"
  "n-blk-e1": 18, // Library <- "Learning Centre"
  "b-blk-sw": 25, // Cauvery Hostel <- "Girls Hostel"
  "s-track": 12, // Football Ground <- "Athletic Track"
  "gb-main-gate": 0, // Main Gate <- "BIT Main Gate"
  "f-poly": 4, // Main Parking Area <- "Parking"
  "gb-boys-mess": 16, // Boys Mess
  "b-hall": 32, // Girls Mess
  "gb-medical-centre": 33, // Medical Centre
  "gb-radio-centre": 20, // BIT Community Radio Centre <- "Community Radio"
  "gb-power-house": 85, // Power House
  "gb-internet-centre": 108, // Internet Centre <- "Netcafe" (its sign reads Internet Centre)
  "gb-placement-and-training-cell": 110, // Placement and Training Cell <- "T & P"
  "gb-fashion-resource-centre": 96, // Fashion Resource Centre <- "FRC Display"
  "gb-tennis-court-1": 88, // Tennis Court 1 <- "Tennies Court I"
  "gb-tennis-court-2": 89, // Tennis Court 2 <- "Tennies Court II"
  "gb-basketball-court": 90, // Basketball Court <- "Basket Ball Court"
  "gb-volley-ball-court": 91, // Volley Ball Court <- "Volleyball Court"
};

const TOUR_BASE = process.env.NEXT_PUBLIC_TOUR_BASE_URL ?? "/tour";

export type BuildingPhoto = { thumb: string; full: string };

export function buildingPhoto(buildingId: string): BuildingPhoto | null {
  const scene = SCENE_FOR_BUILDING[buildingId];
  if (scene === undefined) return null;
  return { thumb: `${TOUR_BASE}/${scene}/thumb.jpg`, full: `${TOUR_BASE}/${scene}/pano.jpg` };
}

/** The tour scene for a place: the list above, else a scene labelled with exactly its name. */
export function tourSceneFor(buildingId: string | null | undefined, name: string | null | undefined): number | null {
  if (buildingId && SCENE_FOR_BUILDING[buildingId] !== undefined) return SCENE_FOR_BUILDING[buildingId];
  const n = name?.trim().toLowerCase();
  if (!n) return null;
  return TOUR_SCENES.find((s) => s.label.toLowerCase() === n)?.index ?? null;
}
