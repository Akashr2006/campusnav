import { prisma } from "../lib/db";
import { gpsToCanvas, canvasToGps, MAP_ORIGIN, PIXELS_PER_METER } from "../lib/geo/projection";
import { calculateGeographicDistance } from "../lib/geo/haversine";

// These maintenance scripts only make sense against a real database.
if (!prisma) {
  console.error("This script requires DATABASE_URL to be set. Aborting.");
  process.exit(1);
}
const db = prisma;

async function run() {
  const draft = await db.draftGraph.findUnique({ where: { id: "active-draft" } });
  const buildings = (draft?.snapshot as any)?.buildings || [];
  const rp = buildings.find((b: any) => b.name?.includes("RP") || b.id?.includes("rp")) || buildings[0];

  console.log("=== STEP 2: RP BUILDING RECORD ===");
  console.log("ID:", rp.id);
  console.log("Name:", rp.name);
  console.log("Stored lat, lng:", rp.lat, rp.lng);
  console.log("Stored x, y:", rp.x, rp.y);
  console.log("Stored width, height:", rp.width, rp.height);

  const lat = rp.lat;
  const lng = rp.lng;
  const x = rp.x;
  const y = rp.y;
  const w = rp.width;
  const h = rp.height;

  // STEP 3: Current 4 visual corners rendered on canvas by <rect x={x} y={y} width={w} height={h} />
  const c1 = { x, y }; // Top-Left
  const c2 = { x: x + w, y }; // Top-Right
  const c3 = { x: x + w, y: y + h }; // Bottom-Right
  const c4 = { x, y: y + h }; // Bottom-Left

  console.log("\n=== STEP 3: CURRENT 4 RENDERING CANVAS CORNERS ===");
  console.log("Corner 1 (Top-Left):", c1);
  console.log("Corner 2 (Top-Right):", c2);
  console.log("Corner 3 (Bottom-Right):", c3);
  console.log("Corner 4 (Bottom-Left):", c4);

  // STEP 4: Convert each corner back to GPS using canvasToGps
  const g1 = canvasToGps(c1.x, c1.y);
  const g2 = canvasToGps(c2.x, c2.y);
  const g3 = canvasToGps(c3.x, c3.y);
  const g4 = canvasToGps(c4.x, c4.y);

  console.log("\n=== STEP 4: CORNER GPS COORDINATES (canvasToGps) ===");
  console.log("Corner 1 GPS (Top-Left):", g1);
  console.log("Corner 2 GPS (Top-Right):", g2);
  console.log("Corner 3 GPS (Bottom-Right):", g3);
  console.log("Corner 4 GPS (Bottom-Left):", g4);

  // STEP 5: Building Geographic Extent from current corners
  const minLat = Math.min(g1.lat, g2.lat, g3.lat, g4.lat);
  const maxLat = Math.max(g1.lat, g2.lat, g3.lat, g4.lat);
  const minLng = Math.min(g1.lng, g2.lng, g3.lng, g4.lng);
  const maxLng = Math.max(g1.lng, g2.lng, g3.lng, g4.lng);

  console.log("\n=== STEP 5: BUILDING GEOGRAPHIC EXTENT ===");
  console.log("Bounding Box:", { minLat, maxLat, minLng, maxLng });

  // STEP 6: Calculate Physical Distances in Meters
  const widthMeters = w / PIXELS_PER_METER;
  const heightMeters = h / PIXELS_PER_METER;

  console.log("\n=== STEP 6: PHYSICAL BUILDING DIMENSIONS ===");
  console.log("Canvas Width:", w, "px -> Physical Width:", widthMeters, "meters");
  console.log("Canvas Height:", h, "px -> Physical Height:", heightMeters, "meters");

  // Let's test with a live GPS point inside RP building (near RP center lat/lng: 11.497637, 77.278935)
  const testGps = { lat: 11.497637015, lng: 77.278935357, accuracy: 5.0, timestamp: Date.now() };
  const testCanvas = gpsToCanvas(testGps.lat, testGps.lng);

  console.log("\n=== STEP 1: LIVE GPS INPUT ===");
  console.log("Test GPS:", testGps);
  console.log("gpsToCanvas(live GPS):", testCanvas);

  const distGpsToCenter = calculateGeographicDistance(testGps.lat, testGps.lng, rp.lat, rp.lng);
  console.log("\n=== STEP 6 CONTINUED: HAVERSINE DISTANCES ===");
  console.log("Distance GPS -> Building Center (lat/lng):", distGpsToCenter, "meters");

  // STEP 7 & 8: CENTER AND ANCHOR SEMANTICS AUDIT
  const projBuildingCenter = gpsToCanvas(rp.lat, rp.lng);
  const rectCanvasCenter = { x: x + w / 2, y: y + h / 2 };

  console.log("\n=== STEP 7 & 8: ANCHOR & CENTER SEMANTICS AUDIT ===");
  console.log("Building Stored Lat/Lng:", { lat: rp.lat, lng: rp.lng });
  console.log("gpsToCanvas(building.lat, building.lng):", projBuildingCenter);
  console.log("Stored Canvas x, y (Top-Left):", { x, y });
  console.log("Canvas Rectangle Center (x + w/2, y + h/2):", rectCanvasCenter);

  console.log("\nCRITICAL DISCOVERY:");
  console.log("Difference between gpsToCanvas(building.lat, building.lng) and Stored (x, y):", {
    dx: projBuildingCenter.x - x,
    dy: projBuildingCenter.y - y,
  });
  console.log("Difference between gpsToCanvas(building.lat, building.lng) and Rectangle Canvas Center (x + w/2, y + h/2):", {
    dx: projBuildingCenter.x - rectCanvasCenter.x,
    dy: projBuildingCenter.y - rectCanvasCenter.y,
  });

  // STEP 5 CONTINUED: Is live GPS mathematically inside the building geographic extent?
  const isGpsInGeoExtent = testGps.lat >= minLat && testGps.lat <= maxLat && testGps.lng >= minLng && testGps.lng <= maxLng;
  console.log("\nIs Live GPS mathematically inside Building Geo Bounding Box?", isGpsInGeoExtent);

  // Is live GPS canvas position visually inside current rendered <rect x={x} y={y} width={w} height={h} /> ?
  const isGpsInCanvasRect = testCanvas.x >= x && testCanvas.x <= x + w && testCanvas.y >= y && testCanvas.y <= y + h;
  console.log("Is Live GPS canvas (x,y) inside rendered <rect x={x} y={y} width={w} height={h}>?", isGpsInCanvasRect);
}

run().catch(console.error);
