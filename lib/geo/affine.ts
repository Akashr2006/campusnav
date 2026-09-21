export interface CalibrationPoint {
  canvasX: number;
  canvasY: number;
  lat: number;
  lng: number;
}

export interface AffineMatrix {
  a: number; // lng -> x
  b: number; // lat -> x
  c: number; // offset x
  d: number; // lng -> y
  e: number; // lat -> y
  f: number; // offset y
}

export function solveAffineMatrix(points: CalibrationPoint[]): AffineMatrix | null {
  if (points.length < 2) return null;

  const p1 = points[0];
  const p2 = points[points.length - 1];

  const dLng = p2.lng - p1.lng;
  const dLat = p2.lat - p1.lat;
  const dX = p2.canvasX - p1.canvasX;
  const dY = p2.canvasY - p1.canvasY;

  const scaleX = Math.abs(dLng) > 1e-12 ? dX / dLng : 0;
  const scaleY = Math.abs(dLat) > 1e-12 ? dY / dLat : 0;

  const a = scaleX;
  const b = 0;
  const c = p1.canvasX - a * p1.lng;

  const d = 0;
  const e = scaleY;
  const f = p1.canvasY - e * p1.lat;

  return { a, b, c, d, e, f };
}

export function gpsToCanvas(
  lat: number,
  lng: number,
  matrix: AffineMatrix
): { x: number; y: number } {
  const x = matrix.a * lng + matrix.b * lat + matrix.c;
  const y = matrix.d * lng + matrix.e * lat + matrix.f;
  return { x: Math.round(x), y: Math.round(y) };
}

export function canvasToGps(
  x: number,
  y: number,
  matrix: AffineMatrix
): { lat: number; lng: number } {
  const lng = matrix.a !== 0 ? (x - matrix.c) / matrix.a : 77.277485104;
  const lat = matrix.e !== 0 ? (y - matrix.f) / matrix.e : 11.496327485;
  return { lat, lng };
}
