export const MAP_ORIGIN = { lat: 11.493317972, lng: 77.275954400 }; // fixed reference point, southwest corner of campus
export const PIXELS_PER_METER = 4; // adjustable scale
export const ROTATION_DEGREES = 0; // 0 = North up. User-adjustable later.

function metersPerDegree(lat: number) {
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
  const metersPerDegLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
  return { metersPerDegLat, metersPerDegLng };
}

export function getCenterFromCorners(corners: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const avgLat = corners.reduce((sum, c) => sum + c.lat, 0) / corners.length;
  const avgLng = corners.reduce((sum, c) => sum + c.lng, 0) / corners.length;
  return { lat: avgLat, lng: avgLng };
}

export function gpsToCanvas(lat: number, lng: number, rotationDegrees = ROTATION_DEGREES) {
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree(MAP_ORIGIN.lat);
  const xMeters = (lng - MAP_ORIGIN.lng) * metersPerDegLng;
  const yMeters = (lat - MAP_ORIGIN.lat) * metersPerDegLat;
  let x = xMeters * PIXELS_PER_METER;
  let y = -yMeters * PIXELS_PER_METER; // flip so north = up
  if (rotationDegrees !== 0) {
    const rad = (rotationDegrees * Math.PI) / 180;
    const rx = x * Math.cos(rad) - y * Math.sin(rad);
    const ry = x * Math.sin(rad) + y * Math.cos(rad);
    x = rx; y = ry;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

export function canvasToGps(x: number, y: number, rotationDegrees = ROTATION_DEGREES) {
  let px = x, py = y;
  if (rotationDegrees !== 0) {
    const rad = (-rotationDegrees * Math.PI) / 180;
    const rx = px * Math.cos(rad) - py * Math.sin(rad);
    const ry = px * Math.sin(rad) + py * Math.cos(rad);
    px = rx; py = ry;
  }
  const { metersPerDegLat, metersPerDegLng } = metersPerDegree(MAP_ORIGIN.lat);
  const lng = MAP_ORIGIN.lng + (px / PIXELS_PER_METER) / metersPerDegLng;
  const lat = MAP_ORIGIN.lat - (py / PIXELS_PER_METER) / metersPerDegLat;
  return { lat, lng };
}
