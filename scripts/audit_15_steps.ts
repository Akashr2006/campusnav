import { prisma } from "../lib/db";
import { gpsToCanvas, canvasToGps, PIXELS_PER_METER } from "../lib/geo/projection";
import { calculateGeographicDistance } from "../lib/geo/haversine";
import { evaluateBuildingContainment } from "../lib/geo/containment";

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

  console.log("============================================================");
  console.log("CANONICAL BUILDING CENTER ANCHORING AUDIT REPORT");
  console.log("============================================================");

  // Live GPS
  const liveGps = { lat: 11.497637015, lng: 77.278935357, accuracy: 5.0, timestamp: Date.now() };
  const liveCanvas = gpsToCanvas(liveGps.lat, liveGps.lng);

  console.log("1. LIVE GPS COORDINATE:", liveGps);
  console.log("2. LIVE GPS CANVAS POSITION:", liveCanvas);

  // RP Building
  const bCenterGps = { lat: rp.lat, lng: rp.lng };
  const bCenterCanvas = gpsToCanvas(rp.lat, rp.lng);

  console.log("3. BUILDING CENTER (GPS):", bCenterGps);
  console.log("4. BUILDING CENTER (CANVAS x,y):", bCenterCanvas);
  console.log("5. BUILDING WIDTH / HEIGHT (px):", { width: rp.width, height: rp.height });
  console.log("6. BUILDING WIDTH / HEIGHT (meters):", {
    width_meters: rp.width / PIXELS_PER_METER,
    height_meters: rp.height / PIXELS_PER_METER,
  });

  // BEFORE (Top-Left anchored at b.x, b.y)
  const beforeTL = { x: bCenterCanvas.x, y: bCenterCanvas.y };
  const beforeTR = { x: bCenterCanvas.x + rp.width, y: bCenterCanvas.y };
  const beforeBR = { x: bCenterCanvas.x + rp.width, y: bCenterCanvas.y + rp.height };
  const beforeBL = { x: bCenterCanvas.x, y: bCenterCanvas.y + rp.height };
  const isInsideBefore = liveCanvas.x >= beforeTL.x && liveCanvas.x <= beforeBR.x && liveCanvas.y >= beforeTL.y && liveCanvas.y <= beforeBR.y;

  console.log("\n=== BEFORE FIX (Top-Left positioned at Building Center) ===");
  console.log("Top-Left Canvas:", beforeTL);
  console.log("Top-Right Canvas:", beforeTR);
  console.log("Bottom-Right Canvas:", beforeBR);
  console.log("Bottom-Left Canvas:", beforeBL);
  console.log("GPS Inside Building Visually/Canvas:", isInsideBefore);

  // AFTER (Centered around b.x, b.y)
  const afterTL = { x: bCenterCanvas.x - rp.width / 2, y: bCenterCanvas.y - rp.height / 2 };
  const afterTR = { x: bCenterCanvas.x + rp.width / 2, y: bCenterCanvas.y - rp.height / 2 };
  const afterBR = { x: bCenterCanvas.x + rp.width / 2, y: bCenterCanvas.y + rp.height / 2 };
  const afterBL = { x: bCenterCanvas.x - rp.width / 2, y: bCenterCanvas.y + rp.height / 2 };
  const isInsideAfter = liveCanvas.x >= afterTL.x && liveCanvas.x <= afterBR.x && liveCanvas.y >= afterTL.y && liveCanvas.y <= afterBR.y;

  const afterCornersGps = [
    canvasToGps(afterTL.x, afterTL.y),
    canvasToGps(afterTR.x, afterTR.y),
    canvasToGps(afterBR.x, afterBR.y),
    canvasToGps(afterBL.x, afterBL.y),
  ];

  console.log("\n=== AFTER FIX (Centered around Building Center x,y) ===");
  console.log("Top-Left Canvas:", afterTL, "GPS:", afterCornersGps[0]);
  console.log("Top-Right Canvas:", afterTR, "GPS:", afterCornersGps[1]);
  console.log("Bottom-Right Canvas:", afterBR, "GPS:", afterCornersGps[2]);
  console.log("Bottom-Left Canvas:", afterBL, "GPS:", afterCornersGps[3]);
  console.log("GPS Inside Building Visually/Canvas:", isInsideAfter);

  const distToCenter = calculateGeographicDistance(liveGps.lat, liveGps.lng, rp.lat, rp.lng);
  console.log("\nGPS -> BUILDING CENTER HAVERSINE DISTANCE:", distToCenter, "meters");

  const containmentEval = evaluateBuildingContainment(liveGps.lat, liveGps.lng, liveGps.accuracy, {
    ...rp,
    footprint: afterCornersGps,
  });
  console.log("ACCURACY-AWARE CONTAINMENT EVALUATION:", containmentEval);
}

run().catch(console.error);
