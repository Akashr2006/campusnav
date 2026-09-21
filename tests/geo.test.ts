import { describe, it, expect } from "vitest";
import { solveAffineMatrix, gpsToCanvas, canvasToGps, type CalibrationPoint } from "../lib/geo/affine";
import { calculateGeographicDistance, findNearestNodeByGps } from "../lib/geo/haversine";

const testPoints: CalibrationPoint[] = [
  { canvasX: 0, canvasY: 0, lat: 12.9710, lng: 77.5940 },
  { canvasX: 1000, canvasY: 0, lat: 12.9710, lng: 77.5950 },
  { canvasX: 0, canvasY: 1000, lat: 12.9720, lng: 77.5940 },
  { canvasX: 1000, canvasY: 1000, lat: 12.9720, lng: 77.5950 },
];

describe("Geo-Calibration & Distance Calculations", () => {
  it("computes exact forward transform matrix from calibration points", () => {
    const matrix = solveAffineMatrix(testPoints);
    expect(matrix).not.toBeNull();

    if (!matrix) return;

    // Test (lng=77.5940, lat=12.9710) -> should map to (0, 0)
    const p1 = gpsToCanvas(12.9710, 77.5940, matrix);
    expect(Math.abs(p1.x - 0)).toBeLessThan(5);
    expect(Math.abs(p1.y - 0)).toBeLessThan(5);

    // Test (lng=77.5950, lat=12.9710) -> should map to (1000, 0)
    const p2 = gpsToCanvas(12.9710, 77.5950, matrix);
    expect(Math.abs(p2.x - 1000)).toBeLessThan(5);
    expect(Math.abs(p2.y - 0)).toBeLessThan(5);
  });

  it("computes exact inverse transform canvas (x, y) -> GPS (lat, lng)", () => {
    const matrix = solveAffineMatrix(testPoints);
    expect(matrix).not.toBeNull();

    if (!matrix) return;

    const gps = canvasToGps(500, 500, matrix);
    expect(Math.abs(gps.lat - 12.9715)).toBeLessThan(0.001);
    expect(Math.abs(gps.lng - 77.5945)).toBeLessThan(0.001);
  });

  it("calculates accurate real-world distances in meters using equirectangular formula", () => {
    // Section 10 Sample Validation Test:
    // Point A: Lat 11.031000, Lng 77.120000
    // Point B: Lat 11.032000, Lng 77.121000
    // Expected distance: ~156 meters
    const sampleDist = calculateGeographicDistance(11.031000, 77.120000, 11.032000, 77.121000);
    expect(sampleDist).toBe(156);
  });

  it("snaps visitor live GPS position to the nearest navigation node", () => {
    const nodes = [
      { id: "n1", type: "OUTDOOR_PATH", floorId: "f-out", x: 100, y: 100, lat: 12.9716, lng: 77.5946 },
      { id: "n2", type: "BUILDING_ENTRANCE", floorId: "f-out", x: 300, y: 300, lat: 12.9750, lng: 77.5980 },
    ];

    const nearest = findNearestNodeByGps(12.97162, 77.59461, nodes as any);
    expect(nearest.node?.id).toBe("n1");
    expect(nearest.distanceMeters).toBeLessThan(10);
  });

  it("preserves exact 9-decimal precision throughout creation, serialization, and calculations", () => {
    const lat = 11.496327485;
    const lng = 77.277485104;

    // Verify string formatting
    expect(lat.toFixed(9)).toBe("11.496327485");
    expect(lng.toFixed(9)).toBe("77.277485104");

    // Verify JSON serialization and parsing preserves precision
    const nodeObj = { id: "n-prec-1", lat, lng };
    const serialized = JSON.stringify(nodeObj);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.lat).toBe(11.496327485);
    expect(deserialized.lng).toBe(77.277485104);

    // Verify distance calculation receives full precision
    const dist = calculateGeographicDistance(11.496327485, 77.277485104, 11.496328485, 77.277486104);
    expect(dist).toBeGreaterThan(0);
  });

  it("evaluates accuracy-aware building containment correctly (INSIDE, OUTSIDE, UNCERTAIN)", async () => {
    const { evaluateBuildingContainment, isPointInBuildingPolygon, getDistanceToBuildingBoundary } = await import("../lib/geo/containment");

    const rpBuilding = {
      id: "bld-rp-test",
      campusId: "c1",
      name: "RP Building",
      footprint: [
        { lat: 11.497912015, lng: 77.278560357 },
        { lat: 11.497912015, lng: 77.279260357 },
        { lat: 11.497312015, lng: 77.279260357 },
        { lat: 11.497412015, lng: 77.278660357 },
      ],
    };

    // Center of RP Building
    const centerLat = 11.497637015;
    const centerLng = 77.278935357;
    expect(isPointInBuildingPolygon(centerLat, centerLng, rpBuilding.footprint)).toBe(true);

    // High confidence inside test (accuracy = 5m < boundary distance ~30m)
    const insideHighConf = evaluateBuildingContainment(centerLat, centerLng, 5, rpBuilding as any);
    expect(insideHighConf.status).toBe("INSIDE");

    // Indoor GPS Uncertainty test (Point is inside, but accuracy = 35m exceeds distance to boundary ~30m)
    const insideUncertain = evaluateBuildingContainment(centerLat, centerLng, 35, rpBuilding as any);
    expect(insideUncertain.status).toBe("UNCERTAIN");

    // Point outside building (Far away)
    const farOutside = evaluateBuildingContainment(11.491000, 77.275000, 5, rpBuilding as any);
    expect(farOutside.status).toBe("OUTSIDE");
  });

  it("enforces canonical building center anchoring and footprint alignment", async () => {
    const { gpsToCanvas, canvasToGps } = await import("../lib/geo/projection");
    const { evaluateBuildingContainment } = await import("../lib/geo/containment");

    const bCenterLat = 11.49717809;
    const bCenterLng = 77.27905242;
    const width = 276;
    const height = 498;

    const bCanvasCenter = gpsToCanvas(bCenterLat, bCenterLng);

    // Top-Left and Bottom-Right canvas bounds centered around bCanvasCenter
    const tl = { x: bCanvasCenter.x - width / 2, y: bCanvasCenter.y - height / 2 };
    const br = { x: bCanvasCenter.x + width / 2, y: bCanvasCenter.y + height / 2 };

    // Verified Live GPS point inside RP
    const liveLat = 11.497637015;
    const liveLng = 77.278935357;
    const liveCanvas = gpsToCanvas(liveLat, liveLng);

    expect(liveCanvas.x).toBeGreaterThanOrEqual(tl.x);
    expect(liveCanvas.x).toBeLessThanOrEqual(br.x);
    expect(liveCanvas.y).toBeGreaterThanOrEqual(tl.y);
    expect(liveCanvas.y).toBeLessThanOrEqual(br.y);

    const bldRecord = {
      id: "bld-rp",
      name: "RP",
      lat: bCenterLat,
      lng: bCenterLng,
      width,
      height,
    };

    const evalResult = evaluateBuildingContainment(liveLat, liveLng, 5, bldRecord as any);
    expect(evalResult.status).toBe("INSIDE");
  });
});
