import { MAP_ORIGIN, gpsToCanvas, canvasToGps, getCenterFromCorners } from "./projection";
import type { Building } from "@/shared/data/campus";

export type BuildingCorner = {
  lat: number;
  lng: number;
};

/**
 * Helper to check if two 2D line segments (p1-q1) and (p2-q2) intersect.
 */
function doSegmentsIntersect(
  p1: { x: number; y: number },
  q1: { x: number; y: number },
  p2: { x: number; y: number },
  q2: { x: number; y: number }
): boolean {
  function ccw(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
    return (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x);
  }

  const ccw1 = ccw(p1, q1, p2);
  const ccw2 = ccw(p1, q1, q2);
  const ccw3 = ccw(p2, q2, p1);
  const ccw4 = ccw(p2, q2, q1);

  if (((ccw1 > 0 && ccw2 < 0) || (ccw1 < 0 && ccw2 > 0)) &&
      ((ccw3 > 0 && ccw4 < 0) || (ccw3 < 0 && ccw4 > 0))) {
    return true;
  }

  return false;
}

/**
 * Extracts the authoritative GPS corner array for any building.
 * Supports N-corner footprint, legacy 4-corner fields, or bounds fallback.
 */
export function getBuildingCorners(building: Partial<Building>): BuildingCorner[] {
  // 1. Explicit N-corner footprint array (primary authoritative source)
  if (building?.footprint && Array.isArray(building.footprint) && building.footprint.length >= 3) {
    const valid = building.footprint.filter(
      (c) => c && typeof c.lat === "number" && !isNaN(c.lat) && typeof c.lng === "number" && !isNaN(c.lng)
    );
    if (valid.length >= 3) {
      return valid.map((c) => ({ lat: Number(c.lat), lng: Number(c.lng) }));
    }
  }

  // 2. Legacy 4 corner fields
  if (
    typeof building?.corner1Lat === "number" && typeof building?.corner1Lng === "number" &&
    typeof building?.corner2Lat === "number" && typeof building?.corner2Lng === "number" &&
    typeof building?.corner3Lat === "number" && typeof building?.corner3Lng === "number" &&
    typeof building?.corner4Lat === "number" && typeof building?.corner4Lng === "number"
  ) {
    return [
      { lat: building.corner1Lat, lng: building.corner1Lng },
      { lat: building.corner2Lat, lng: building.corner2Lng },
      { lat: building.corner3Lat, lng: building.corner3Lng },
      { lat: building.corner4Lat, lng: building.corner4Lng },
    ];
  }

  // 3. Fallback for legacy rectangle buildings (center lat/lng or x/y + width/height)
  const centerLat = building?.centerLat ?? building?.lat;
  const centerLng = building?.centerLng ?? building?.lng;
  const bw = building?.width ?? 180;
  const bh = building?.height ?? 120;

  let centerCanvasX = building?.x ?? 400;
  let centerCanvasY = building?.y ?? 300;

  if (typeof centerLat === "number" && typeof centerLng === "number" && !isNaN(centerLat) && !isNaN(centerLng)) {
    const cCanvas = gpsToCanvas(centerLat, centerLng);
    centerCanvasX = cCanvas.x;
    centerCanvasY = cCanvas.y;
  }

  const p1 = canvasToGps(centerCanvasX - bw / 2, centerCanvasY - bh / 2);
  const p2 = canvasToGps(centerCanvasX + bw / 2, centerCanvasY - bh / 2);
  const p3 = canvasToGps(centerCanvasX + bw / 2, centerCanvasY + bh / 2);
  const p4 = canvasToGps(centerCanvasX - bw / 2, centerCanvasY + bh / 2);

  return [p1, p2, p3, p4];
}

/**
 * Projects a building's GPS corners to Canvas pixel coordinates.
 */
export function getBuildingCanvasPoints(building: Partial<Building>): { x: number; y: number }[] {
  const corners = getBuildingCorners(building);
  if (corners.length < 3) {
    const cx = building?.x ?? 400;
    const cy = building?.y ?? 300;
    const bw = building?.width ?? 180;
    const bh = building?.height ?? 120;
    return [
      { x: cx - bw / 2, y: cy - bh / 2 },
      { x: cx + bw / 2, y: cy - bh / 2 },
      { x: cx + bw / 2, y: cy + bh / 2 },
      { x: cx - bw / 2, y: cy + bh / 2 },
    ];
  }
  return corners.map((c) => gpsToCanvas(c.lat, c.lng));
}

/**
 * Computes building geographic & canvas center coordinates.
 */
export function getBuildingCenter(building: Partial<Building>): { lat: number; lng: number; x: number; y: number } {
  const corners = getBuildingCorners(building);
  if (corners.length >= 3) {
    const centerGps = getCenterFromCorners(corners);
    const centerCanvas = gpsToCanvas(centerGps.lat, centerGps.lng);
    return { lat: centerGps.lat, lng: centerGps.lng, x: centerCanvas.x, y: centerCanvas.y };
  }
  const lat = building?.centerLat ?? building?.lat ?? MAP_ORIGIN.lat;
  const lng = building?.centerLng ?? building?.lng ?? MAP_ORIGIN.lng;
  const canvas = (building?.x !== undefined && building?.y !== undefined)
    ? { x: building.x, y: building.y }
    : gpsToCanvas(lat, lng);
  return { lat, lng, x: canvas.x, y: canvas.y };
}

/**
 * Computes bounding rectangle metrics from canvas polygon points.
 */
export function getBuildingCanvasBounds(points: { x: number; y: number }[]) {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100, width: 100, height: 100, cx: 50, cy: 50 };
  }
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = Math.max(10, maxX - minX);
  const height = Math.max(10, maxY - minY);
  const cx = Math.round((minX + maxX) / 2);
  const cy = Math.round((minY + maxY) / 2);
  return { minX, minY, maxX, maxY, width, height, cx, cy };
}

/**
 * Returns SVG path string ("M x1 y1 L x2 y2 L x3 y3 ... Z") for polygon points.
 */
export function getPolygonSvgPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
}

/**
 * Returns SVG polygon points string ("x1,y1 x2,y2 x3,y3...") for polygon points.
 */
export function getPolygonPointsString(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/**
 * Comprehensive polygon coordinate & geometry validator.
 */
export function validatePolygonCorners(corners: BuildingCorner[]): { valid: boolean; error?: string } {
  if (!corners || !Array.isArray(corners) || corners.length < 3) {
    return {
      valid: false,
      error: "Building footprint requires at least 3 valid GPS corners to form a polygon.",
    };
  }

  for (let i = 0; i < corners.length; i++) {
    const c = corners[i];
    if (!c || typeof c.lat !== "number" || isNaN(c.lat) || typeof c.lng !== "number" || isNaN(c.lng)) {
      return {
        valid: false,
        error: `Corner ${i + 1} has invalid or missing Latitude/Longitude coordinates.`,
      };
    }
    if (c.lat < -90 || c.lat > 90) {
      return {
        valid: false,
        error: `Corner ${i + 1} Latitude (${c.lat}) must be between -90 and +90 degrees.`,
      };
    }
    if (c.lng < -180 || c.lng > 180) {
      return {
        valid: false,
        error: `Corner ${i + 1} Longitude (${c.lng}) must be between -180 and +180 degrees.`,
      };
    }
  }

  // Check for duplicate adjacent or identical points
  const canvasPts = corners.map((c) => gpsToCanvas(c.lat, c.lng));
  const n = canvasPts.length;

  // Check self-intersection of non-adjacent edges
  for (let i = 0; i < n; i++) {
    const p1 = canvasPts[i];
    const q1 = canvasPts[(i + 1) % n];

    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // adjacent edges share endpoint
      const p2 = canvasPts[j];
      const q2 = canvasPts[(j + 1) % n];

      if (doSegmentsIntersect(p1, q1, p2, q2)) {
        return {
          valid: false,
          error: `Building footprint has self-intersecting lines between Corner ${i + 1} and Corner ${j + 1}. Adjust corner order so boundary lines do not cross.`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Distance from point p to 2D line segment v-w
 */
function pointToSegmentDistance(
  p: { x: number; y: number },
  v: { x: number; y: number },
  w: { x: number; y: number }
): number {
  const l2 = (v.x - w.x) * (v.x - w.x) + (v.y - w.y) * (v.y - w.y);
  if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

/**
 * High-performance Ray-Casting algorithm to test if 2D canvas point is inside a polygon
 */
export function isPointInPolygon(
  point: { x: number; y: number },
  polygon: { x: number; y: number }[]
): boolean {
  if (!polygon || polygon.length < 3) return false;
  const { x, y } = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Accurately tests if a 2D canvas point (x, y) is inside a building footprint (polygon or rectangle)
 */
export function isPointInsideBuilding(
  x: number,
  y: number,
  building: Partial<Building>,
  margin = 0
): boolean {
  if (!building) return false;
  const pts = getBuildingCanvasPoints(building);
  if (!pts || pts.length < 3) {
    const bx = building.x ?? 0;
    const by = building.y ?? 0;
    const bw = building.width ?? 180;
    const bh = building.height ?? 120;
    return (
      x >= bx - margin &&
      x <= bx + bw + margin &&
      y >= by - margin &&
      y <= by + bh + margin
    );
  }

  const bounds = getBuildingCanvasBounds(pts);
  if (
    x < bounds.minX - margin ||
    x > bounds.maxX + margin ||
    y < bounds.minY - margin ||
    y > bounds.maxY + margin
  ) {
    return false;
  }

  // Exact polygon check
  if (isPointInPolygon({ x, y }, pts)) return true;

  // Margin buffer check for points on or very close to the building perimeter/walls
  if (margin > 0) {
    for (let i = 0; i < pts.length; i++) {
      const p1 = pts[i];
      const p2 = pts[(i + 1) % pts.length];
      const dist = pointToSegmentDistance({ x, y }, p1, p2);
      if (dist <= margin) return true;
    }
  }

  return false;
}

/**
 * Checks if a point is outside all buildings on canvas
 */
export function isPointOutsideAllBuildings(
  x: number,
  y: number,
  buildings: Partial<Building>[],
  margin = 0
): boolean {
  if (!buildings || buildings.length === 0) return true;
  return !buildings.some((b) => isPointInsideBuilding(x, y, b, margin));
}

