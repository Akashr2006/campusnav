/**
 * Campus GeoJSON Boundary Definition & Spatial Geofencing Utilities
 * Derived from user's custom GeoJSON boundary: Untitled.geojson
 */

export interface Point2D {
  lat: number;
  lng: number;
}

export const CAMPUS_BOUNDARY_GEOJSON = {
  type: "FeatureCollection" as const,
  features: [
    {
      type: "Feature" as const,
      properties: { name: "Main Campus Boundary" },
      geometry: {
        type: "Polygon" as const,
        coordinates: [
          [
            [77.277868, 11.500557],
            [77.27459, 11.501215],
            [77.274151, 11.498129],
            [77.273325, 11.492463],
            [77.276551, 11.491805],
            [77.277377, 11.49178],
            [77.278229, 11.491957],
            [77.280475, 11.491805],
            [77.280655, 11.492159],
            [77.281172, 11.492109],
            [77.281533, 11.493297],
            [77.280496, 11.49344],
            [77.280872, 11.495568],
            [77.279797, 11.495576],
            [77.279759, 11.496674],
            [77.279141, 11.496615],
            [77.279121, 11.496681],
            [77.279007, 11.496733],
            [77.279024, 11.497528],
            [77.279147, 11.498391],
            [77.279116, 11.499414],
            [77.279223, 11.499417],
            [77.279253, 11.500246],
            [77.277868, 11.500557],
          ],
        ],
      },
      bbox: [77.273325, 11.49178, 77.281533, 11.501215],
    },
  ],
};

// Extracted polygon ring coordinates: Array of [lng, lat]
export const CAMPUS_POLYGON_COORDS: [number, number][] =
  CAMPUS_BOUNDARY_GEOJSON.features[0].geometry.coordinates[0] as [number, number][];

export const CAMPUS_BBOX = {
  minLng: 77.273325,
  minLat: 11.49178,
  maxLng: 77.281533,
  maxLat: 11.501215,
};

/**
 * Standard Ray-Casting algorithm for Point-in-Polygon spatial query.
 * Determines if a given (lat, lng) coordinate lies inside the campus boundary.
 */
export function isPointInCampusBoundary(lat: number, lng: number): boolean {
  let inside = false;
  const polygon = CAMPUS_POLYGON_COORDS;
  const n = polygon.length;

  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i][0]; // lng
    const yi = polygon[i][1]; // lat
    const xj = polygon[j][0];
    const yj = polygon[j][1];

    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;

    if (intersect) inside = !inside;
  }

  return inside;
}



/**
 * Ensures building / node GPS position is inside the campus boundary.
 * Clamps coordinates to the centroid of the boundary if outside.
 */
export function validateAndClampGps(lat: number, lng: number): { lat: number; lng: number; isInside: boolean } {
  const inside = isPointInCampusBoundary(lat, lng);
  if (inside) {
    return { lat, lng, isInside: true };
  }

  // Calculate polygon centroid as safe fallback clamp
  const sumLat = CAMPUS_POLYGON_COORDS.reduce((acc, pt) => acc + pt[1], 0);
  const sumLng = CAMPUS_POLYGON_COORDS.reduce((acc, pt) => acc + pt[0], 0);
  const centerLat = sumLat / CAMPUS_POLYGON_COORDS.length;
  const centerLng = sumLng / CAMPUS_POLYGON_COORDS.length;

  return {
    lat: centerLat,
    lng: centerLng,
    isInside: false,
  };
}
