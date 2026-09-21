/**
 * Accuracy-Aware Building Containment Utility
 *
 * Implements standard Ray-Casting Point-in-Polygon, distance to polygon boundary,
 * and accuracy-aware containment classification (INSIDE / OUTSIDE / UNCERTAIN).
 */

import { calculateGeographicDistance } from "./haversine";
import { gpsToCanvas, canvasToGps } from "./projection";
import type { Building } from "../../shared/data/campus";

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export type ContainmentStatus = "INSIDE" | "OUTSIDE" | "UNCERTAIN";
export type AccuracyConfidence = "HIGH CONFIDENCE" | "MEDIUM CONFIDENCE" | "LOW CONFIDENCE" | "INVALID";

export interface ContainmentResult {
  status: ContainmentStatus;
  isInsidePolygon: boolean;
  distanceToBoundaryMeters: number;
  accuracyMeters: number;
  confidence: AccuracyConfidence;
  reason: string;
}

/**
 * Standard Ray-Casting Algorithm for Point-in-Polygon.
 * Determines if a (lat, lng) point lies strictly inside a polygon ring of [lng, lat] or {lat, lng} vertices.
 */
export function isPointInBuildingPolygon(
  lat: number,
  lng: number,
  footprint: LatLngPoint[]
): boolean {
  if (!footprint || footprint.length < 3) return false;

  let inside = false;
  const n = footprint.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = footprint[i].lng;
    const yi = footprint[i].lat;
    const xj = footprint[j].lng;
    const yj = footprint[j].lat;

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Calculates the shortest perpendicular distance in meters from a (lat, lng) point
 * to any segment of a polygon footprint.
 */
export function getDistanceToBuildingBoundary(
  lat: number,
  lng: number,
  footprint: LatLngPoint[]
): number {
  if (!footprint || footprint.length < 2) return Infinity;

  let minDistanceMeters = Infinity;
  const n = footprint.length;

  for (let i = 0; i < n; i++) {
    const p1 = footprint[i];
    const p2 = footprint[(i + 1) % n];

    const dist = distanceToSegmentMeters(lat, lng, p1.lat, p1.lng, p2.lat, p2.lng);
    if (dist < minDistanceMeters) {
      minDistanceMeters = dist;
    }
  }

  return Math.round(minDistanceMeters * 10) / 10;
}

/**
 * Distance from point (lat, lng) to segment (lat1, lng1)-(lat2, lng2) in meters.
 */
function distanceToSegmentMeters(
  lat: number,
  lng: number,
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const d1 = calculateGeographicDistance(lat, lng, lat1, lng1);
  const d2 = calculateGeographicDistance(lat, lng, lat2, lng2);
  const segmentLen = calculateGeographicDistance(lat1, lng1, lat2, lng2);

  if (segmentLen <= 0.1) return d1;

  const dx = (lng2 - lng1) * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  const dy = lat2 - lat1;
  const px = (lng - lng1) * Math.cos(((lat1 + lat2) / 2 * Math.PI) / 180);
  const py = lat - lat1;

  const dot = px * dx + py * dy;
  const lenSq = dx * dx + dy * dy;
  let param = -1;

  if (lenSq !== 0) param = dot / lenSq;

  if (param < 0) {
    return d1;
  } else if (param > 1) {
    return d2;
  } else {
    const projLat = lat1 + param * (lat2 - lat1);
    const projLng = lng1 + param * (lng2 - lng1);
    return calculateGeographicDistance(lat, lng, projLat, projLng);
  }
}

/**
 * Classifies GPS Accuracy into confidence levels.
 */
export function classifyGpsConfidence(accuracyMeters: number | null): AccuracyConfidence {
  if (accuracyMeters === null || accuracyMeters === undefined || isNaN(accuracyMeters) || accuracyMeters <= 0) {
    return "INVALID";
  }
  if (accuracyMeters <= 15) return "HIGH CONFIDENCE";
  if (accuracyMeters <= 50) return "MEDIUM CONFIDENCE";
  return "LOW CONFIDENCE";
}

/**
 * Extracts building footprint vertices. Falls back to corner coordinates or bounding box if footprint array is missing.
 */
export function getBuildingFootprintVertices(b: Building): LatLngPoint[] {
  if (b.footprint && Array.isArray(b.footprint) && b.footprint.length >= 3) {
    return b.footprint.map((pt: { lat: number; lng: number }) => ({ lat: pt.lat, lng: pt.lng }));
  }

  if (b.corner1Lat && b.corner1Lng && b.corner2Lat && b.corner2Lng && b.corner3Lat && b.corner3Lng && b.corner4Lat && b.corner4Lng) {
    return [
      { lat: b.corner1Lat, lng: b.corner1Lng },
      { lat: b.corner2Lat, lng: b.corner2Lng },
      { lat: b.corner3Lat, lng: b.corner3Lng },
      { lat: b.corner4Lat, lng: b.corner4Lng },
    ];
  }

  const centerLat = b.centerLat ?? b.lat;
  const centerLng = b.centerLng ?? b.lng;
  const bw = b.width ?? 180;
  const bh = b.height ?? 120;
  let centerCanvasX = b.x ?? 400;
  let centerCanvasY = b.y ?? 300;

  if (typeof centerLat === "number" && typeof centerLng === "number" && !isNaN(centerLat) && !isNaN(centerLng)) {
    const centerCanvas = gpsToCanvas(centerLat, centerLng);
    centerCanvasX = centerCanvas.x;
    centerCanvasY = centerCanvas.y;
  }

  const tl = canvasToGps(centerCanvasX - bw / 2, centerCanvasY - bh / 2);
  const tr = canvasToGps(centerCanvasX + bw / 2, centerCanvasY - bh / 2);
  const br = canvasToGps(centerCanvasX + bw / 2, centerCanvasY + bh / 2);
  const bl = canvasToGps(centerCanvasX - bw / 2, centerCanvasY + bh / 2);
  return [tl, tr, br, bl];
}

/**
 * Accuracy-Aware Building Containment Evaluator.
 *
 * Checks whether a GPS coordinate is inside a building polygon, and compares
 * the GPS accuracy radius against the distance to the building boundary.
 *
 * Returns UNCERTAIN whenever the accuracy radius overlaps the building boundary.
 */
export function evaluateBuildingContainment(
  lat: number,
  lng: number,
  accuracyMeters: number,
  building: Building
): ContainmentResult {
  const confidence = classifyGpsConfidence(accuracyMeters);
  const footprint = getBuildingFootprintVertices(building);

  if (footprint.length < 3) {
    return {
      status: "UNCERTAIN",
      isInsidePolygon: false,
      distanceToBoundaryMeters: Infinity,
      accuracyMeters,
      confidence,
      reason: `Building '${building.name}' lacks valid polygon footprint vertices`,
    };
  }

  const isInside = isPointInBuildingPolygon(lat, lng, footprint);
  const distToBoundary = getDistanceToBuildingBoundary(lat, lng, footprint);

  if (accuracyMeters > distToBoundary) {
    return {
      status: "UNCERTAIN",
      isInsidePolygon: isInside,
      distanceToBoundaryMeters: distToBoundary,
      accuracyMeters,
      confidence,
      reason: `Location uncertain: GPS accuracy radius (${accuracyMeters}m) exceeds distance to building boundary (${distToBoundary}m)`,
    };
  }

  if (isInside) {
    return {
      status: "INSIDE",
      isInsidePolygon: true,
      distanceToBoundaryMeters: distToBoundary,
      accuracyMeters,
      confidence,
      reason: `Inside '${building.name}' (distance to boundary: ${distToBoundary}m, GPS accuracy: ${accuracyMeters}m)`,
    };
  }

  return {
    status: "OUTSIDE",
    isInsidePolygon: false,
    distanceToBoundaryMeters: distToBoundary,
    accuracyMeters,
    confidence,
    reason: `Outside '${building.name}' (distance to boundary: ${distToBoundary}m, GPS accuracy: ${accuracyMeters}m)`,
  };
}

export interface DetectedBuildingResult {
  isInside: boolean;
  building: Building | null;
  confidence: AccuracyConfidence;
  distanceToBoundaryMeters: number;
}

/**
 * Evaluates live GPS coordinates across all campus buildings to detect
 * if the user is physically inside any building footprint.
 */
export function detectBuildingAtGps(
  lat: number,
  lng: number,
  accuracyMeters: number = 10,
  buildings: Building[] = []
): DetectedBuildingResult {
  if (!lat || !lng || isNaN(lat) || isNaN(lng) || !buildings || buildings.length === 0) {
    return {
      isInside: false,
      building: null,
      confidence: "INVALID",
      distanceToBoundaryMeters: Infinity,
    };
  }

  const conf = classifyGpsConfidence(accuracyMeters);

  for (const b of buildings) {
    const footprint = getBuildingFootprintVertices(b);
    if (footprint.length < 3) continue;

    const isInside = isPointInBuildingPolygon(lat, lng, footprint);
    if (isInside) {
      const dist = getDistanceToBuildingBoundary(lat, lng, footprint);
      return {
        isInside: true,
        building: b,
        confidence: conf,
        distanceToBoundaryMeters: dist,
      };
    }
  }

  return {
    isInside: false,
    building: null,
    confidence: conf,
    distanceToBoundaryMeters: Infinity,
  };
}

