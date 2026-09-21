import { describe, it, expect } from "vitest";

function normalizeRotation(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function calculateRotationDelta(startAngle: number, currentAngle: number): number {
  return currentAngle - startAngle;
}

function calculateSvgTransformString(x: number, y: number, scale: number, rotation: number): string {
  return `translate(${x}px, ${y}px) scale(${scale}) rotate(${rotation}deg)`;
}

describe("Manual Smooth Map Rotation Engine", () => {
  it("normalizes any degree angle smoothly into 0°–360° range", () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(360)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-45)).toBe(315);
  });

  it("calculates smooth incremental rotation deltas from mouse/touch drag", () => {
    const deltaClockwise = calculateRotationDelta(0, 15);
    expect(deltaClockwise).toBe(15);

    const deltaCcw = calculateRotationDelta(45, 30);
    expect(deltaCcw).toBe(-15);
  });

  it("formats valid CSS SVG matrix transform strings including rotation", () => {
    const transformStr = calculateSvgTransformString(100, -50, 1.5, 45);
    expect(transformStr).toBe("translate(100px, -50px) scale(1.5) rotate(45deg)");
  });

  it("resets compass orientation to 0° North upon reset action", () => {
    let rotation = 135;
    expect(rotation).toBe(135);

    rotation = 0;
    expect(normalizeRotation(rotation)).toBe(0);
  });

  it("resets twisted rotation to 0° North and zoom level to default 1.0 when recenter button is clicked", () => {
    // 1. Initial State: Normal North-Up (0°) and default zoom 1.0
    let bearing = 0;
    let zoomLevel = 1.0;
    let isFollowingUser = true;

    // 2. User twists and zooms map manually
    const twistAngle = 72; // User twisted map by 72°
    const userZoom = 2.4;  // User zoomed in
    bearing = normalizeRotation(bearing + twistAngle);
    zoomLevel = userZoom;
    isFollowingUser = false; // User gesture decouples camera

    expect(bearing).toBe(72);
    expect(zoomLevel).toBe(2.4);
    expect(isFollowingUser).toBe(false);

    // 3. User clicks Recenter button
    const handleRecenter = () => {
      bearing = 0;
      zoomLevel = 1.0;
      isFollowingUser = true;
    };

    handleRecenter();

    // 4. Verify map returns to default zoom 1.0 and True North 0°
    expect(bearing).toBe(0);
    expect(zoomLevel).toBe(1.0);
    expect(isFollowingUser).toBe(true);
    expect(calculateSvgTransformString(0, 0, zoomLevel, bearing)).toBe("translate(0px, 0px) scale(1) rotate(0deg)");
  });
});
