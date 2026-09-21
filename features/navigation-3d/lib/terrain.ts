/**
 * Real ground height for the 3D scene, from the drone survey
 * (tools/drone/build-terrain.py). The campus falls ~60 m north to south, so a
 * flat y = 0 floats the south blocks and buries the north ones against the
 * drone mesh. Heights are metres relative to the survey anchor, which is the
 * mesh's y = 0, so terrain, mesh and procedural content share one datum.
 */

export type TerrainGrid = {
  originX: number;
  originZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** Metres, row-major by z (north row first). */
  heights: Float32Array;
};

export type Terrain = {
  /** Ground height in metres at scene (x, z); edges clamp. */
  heightAt: (x: number, z: number) => number;
  grid: TerrainGrid | null;
};

export const FLAT_TERRAIN: Terrain = { heightAt: () => 0, grid: null };

export function terrainFromGrid(grid: TerrainGrid): Terrain {
  const { originX, originZ, cell, cols, rows, heights } = grid;
  const at = (c: number, r: number) => heights[r * cols + c];
  return {
    grid,
    heightAt(x, z) {
      // Cell values sit at cell centres; bilinear between the four around (x, z).
      const fx = Math.min(Math.max((x - originX) / cell - 0.5, 0), cols - 1);
      const fz = Math.min(Math.max((z - originZ) / cell - 0.5, 0), rows - 1);
      const c0 = Math.floor(fx);
      const r0 = Math.floor(fz);
      const c1 = Math.min(c0 + 1, cols - 1);
      const r1 = Math.min(r0 + 1, rows - 1);
      const tx = fx - c0;
      const tz = fz - r0;
      const top = at(c0, r0) * (1 - tx) + at(c1, r0) * tx;
      const bottom = at(c0, r1) * (1 - tx) + at(c1, r1) * tx;
      return top * (1 - tz) + bottom * tz;
    },
  };
}

/** Decode the Int16-decimetre grid written by build-terrain.py. */
export function decodeTerrain(
  meta: { originX: number; originZ: number; cell: number; cols: number; rows: number },
  bytes: ArrayBuffer
): Terrain {
  const raw = new Int16Array(bytes);
  if (raw.length !== meta.cols * meta.rows) throw new Error("terrain.bin does not match terrain.json");
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = raw[i] / 10;
  return terrainFromGrid({ ...meta, heights });
}

/**
 * Lowest ground under an outline: a building on a slope is seated there, so it
 * never floats on its downhill side (its uphill wall runs into the bank, which
 * is what a real cut-in building does).
 */
export function baseHeight(terrain: Terrain, outline: { x: number; z: number }[]): number {
  if (!terrain.grid || outline.length === 0) return 0;
  let min = Infinity;
  for (const p of outline) min = Math.min(min, terrain.heightAt(p.x, p.z));
  let cx = 0;
  let cz = 0;
  for (const p of outline) {
    cx += p.x;
    cz += p.z;
  }
  min = Math.min(min, terrain.heightAt(cx / outline.length, cz / outline.length));
  return min;
}
