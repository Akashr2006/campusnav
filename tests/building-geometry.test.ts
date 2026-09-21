import { describe, it, expect } from "vitest";
import {
  getBuildingCorners,
  getBuildingCanvasPoints,
  getBuildingCenter,
  getPolygonSvgPath,
  getPolygonPointsString,
  validatePolygonCorners,
  type BuildingCorner,
} from "../lib/geo/building-geometry";
import { gpsToCanvas, canvasToGps } from "../lib/geo/projection";
import type { Building } from "../shared/data/campus";

describe("Irregular Building Footprint & N-Corner Geometry Engine", () => {
  it("Test Case 1: 4-corner building footprint extraction & projection", () => {
    const b4: Partial<Building> = {
      id: "bld-4",
      name: "Standard Quad Building",
      footprint: [
        { lat: 11.4975, lng: 77.2765 },
        { lat: 11.4975, lng: 77.2780 },
        { lat: 11.4962, lng: 77.2780 },
        { lat: 11.4962, lng: 77.2765 },
      ],
    };

    const corners = getBuildingCorners(b4);
    expect(corners).toHaveLength(4);
    expect(corners[0]).toEqual({ lat: 11.4975, lng: 77.2765 });

    const canvasPoints = getBuildingCanvasPoints(b4);
    expect(canvasPoints).toHaveLength(4);

    const svgPath = getPolygonSvgPath(canvasPoints);
    expect(svgPath).toContain("M ");
    expect(svgPath).toContain(" Z");

    const center = getBuildingCenter(b4);
    expect(center.lat).toBeCloseTo((11.4975 + 11.4962) / 2, 5);
    expect(center.lng).toBeCloseTo((77.2765 + 77.2780) / 2, 5);
  });

  it("Test Case 2: 5-corner L-shaped irregular building footprint", () => {
    const b5: Partial<Building> = {
      id: "bld-5",
      name: "L-Shaped Science Wing",
      footprint: [
        { lat: 11.4975, lng: 77.2765 },
        { lat: 11.4975, lng: 77.2785 },
        { lat: 11.4968, lng: 77.2785 },
        { lat: 11.4968, lng: 77.2772 },
        { lat: 11.4962, lng: 77.2765 },
      ],
    };

    const corners = getBuildingCorners(b5);
    expect(corners).toHaveLength(5);

    const validation = validatePolygonCorners(corners);
    expect(validation.valid).toBe(true);

    const ptsString = getPolygonPointsString(getBuildingCanvasPoints(b5));
    const pointPairs = ptsString.split(" ");
    expect(pointPairs).toHaveLength(5);
  });

  it("Test Case 3: 6-corner U-shaped irregular building footprint", () => {
    const b6: Partial<Building> = {
      id: "bld-6",
      name: "U-Shaped Innovation Hub",
      footprint: [
        { lat: 11.4980, lng: 77.2760 },
        { lat: 11.4980, lng: 77.2790 },
        { lat: 11.4960, lng: 77.2790 },
        { lat: 11.4960, lng: 77.2780 },
        { lat: 11.4972, lng: 77.2780 },
        { lat: 11.4972, lng: 77.2760 },
      ],
    };

    const corners = getBuildingCorners(b6);
    expect(corners).toHaveLength(6);
    expect(validatePolygonCorners(corners).valid).toBe(true);
  });

  it("Test Case 4: 8-corner complex irregular building footprint", () => {
    const b8: Partial<Building> = {
      id: "bld-8",
      name: "Complex Academic Block 8",
      footprint: [
        { lat: 11.4985, lng: 77.2760 },
        { lat: 11.4985, lng: 77.2780 },
        { lat: 11.4978, lng: 77.2780 },
        { lat: 11.4978, lng: 77.2795 },
        { lat: 11.4965, lng: 77.2795 },
        { lat: 11.4965, lng: 77.2775 },
        { lat: 11.4972, lng: 77.2775 },
        { lat: 11.4972, lng: 77.2760 },
      ],
    };

    const corners = getBuildingCorners(b8);
    expect(corners).toHaveLength(8);

    const canvasPoints = getBuildingCanvasPoints(b8);
    expect(canvasPoints).toHaveLength(8);

    const validation = validatePolygonCorners(corners);
    expect(validation.valid).toBe(true);
  });

  it("Test Case 5: Rejects polygons with less than 3 corners", () => {
    const invalidCorners: BuildingCorner[] = [
      { lat: 11.4975, lng: 77.2765 },
      { lat: 11.4975, lng: 77.2780 },
    ];
    const res = validatePolygonCorners(invalidCorners);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("requires at least 3 valid GPS corners");
  });

  it("Test Case 6: Rejects out-of-range GPS coordinates", () => {
    const invalidCorners: BuildingCorner[] = [
      { lat: 95.0, lng: 77.2765 },
      { lat: 11.4975, lng: 77.2780 },
      { lat: 11.4962, lng: 77.2780 },
    ];
    const res = validatePolygonCorners(invalidCorners);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("between -90 and +90");
  });

  it("Test Case 7: Rejects self-intersecting (figure-8 / bowtie) polygons", () => {
    const selfIntersectingCorners: BuildingCorner[] = [
      { lat: 11.4980, lng: 77.2760 },
      { lat: 11.4960, lng: 77.2780 },
      { lat: 11.4980, lng: 77.2780 },
      { lat: 11.4960, lng: 77.2760 },
    ];
    const res = validatePolygonCorners(selfIntersectingCorners);
    expect(res.valid).toBe(false);
    expect(res.error).toContain("self-intersecting");
  });

  it("Test Case 8: Backward compatibility for legacy buildings without footprint array", () => {
    const legacyBuilding: Partial<Building> = {
      id: "bld-legacy",
      name: "Legacy Building",
      lat: 11.4970,
      lng: 77.2770,
      width: 180,
      height: 120,
    };

    const corners = getBuildingCorners(legacyBuilding);
    expect(corners).toHaveLength(4);

    const canvasPts = getBuildingCanvasPoints(legacyBuilding);
    expect(canvasPts).toHaveLength(4);

    const center = getBuildingCenter(legacyBuilding);
    expect(center.lat).toBeCloseTo(11.4970, 4);
    expect(center.lng).toBeCloseTo(77.2770, 4);
  });

  it("Test Case 9: Round-trip GPS -> Canvas -> GPS precision for arbitrary corners", () => {
    const origGps = { lat: 11.496789, lng: 77.277123 };
    const canvas = gpsToCanvas(origGps.lat, origGps.lng);
    const roundTrip = canvasToGps(canvas.x, canvas.y);

    expect(roundTrip.lat).toBeCloseTo(origGps.lat, 5);
    expect(roundTrip.lng).toBeCloseTo(origGps.lng, 5);
  });
});
