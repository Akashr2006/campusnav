import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FLAT_TERRAIN,
  baseHeight,
  decodeTerrain,
  terrainFromGrid,
} from "@/features/navigation-3d/lib/terrain";

// 3 x 2 grid of 10 m cells, centres at x = 5, 15, 25 and z = 5, 15.
const grid = terrainFromGrid({
  originX: 0,
  originZ: 0,
  cell: 10,
  cols: 3,
  rows: 2,
  heights: new Float32Array([0, 10, 20, 2, 12, 22]),
});

describe("terrain", () => {
  it("is flat without a survey", () => {
    expect(FLAT_TERRAIN.heightAt(123, -456)).toBe(0);
    expect(baseHeight(FLAT_TERRAIN, [{ x: 0, z: 0 }])).toBe(0);
  });

  it("returns the cell value at a cell centre", () => {
    expect(grid.heightAt(15, 5)).toBeCloseTo(10);
    expect(grid.heightAt(25, 15)).toBeCloseTo(22);
  });

  it("interpolates between centres", () => {
    expect(grid.heightAt(10, 5)).toBeCloseTo(5);
    expect(grid.heightAt(15, 10)).toBeCloseTo(11);
  });

  it("clamps beyond the grid instead of extrapolating", () => {
    expect(grid.heightAt(-500, 5)).toBeCloseTo(0);
    expect(grid.heightAt(500, 500)).toBeCloseTo(22);
  });

  it("seats a building at the lowest ground under it", () => {
    const outline = [
      { x: 5, z: 5 },
      { x: 25, z: 5 },
      { x: 25, z: 15 },
      { x: 5, z: 15 },
    ];
    expect(baseHeight(grid, outline)).toBeCloseTo(0);
  });

  it("decodes Int16 decimetres and rejects a mismatched grid", () => {
    const bytes = new Int16Array([15, -25]).buffer;
    const t = decodeTerrain({ originX: 0, originZ: 0, cell: 1, cols: 2, rows: 1 }, bytes);
    expect(t.heightAt(0.5, 0.5)).toBeCloseTo(1.5);
    expect(t.heightAt(1.5, 0.5)).toBeCloseTo(-2.5);
    expect(() => decodeTerrain({ originX: 0, originZ: 0, cell: 1, cols: 3, rows: 1 }, bytes)).toThrow();
  });

  it("matches the drone survey where it was measured by hand", () => {
    const meta = JSON.parse(readFileSync("public/drone/terrain.json", "utf8"));
    const buf = readFileSync("public/drone/terrain.bin");
    const t = decodeTerrain(meta, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    // Academic Block W sits ~12 m above the anchor, the AS Block ~8 m below.
    expect(t.heightAt(-143, 26.5)).toBeGreaterThan(9);
    expect(t.heightAt(171, -369.5)).toBeLessThan(-5);
  });
});
