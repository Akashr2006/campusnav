#!/usr/bin/env node
/**
 * The 2D map's photo (its "Photo" style): a tile pyramid of the drone mesh seen
 * straight down, sharp enough to read court lines and paving at full zoom.
 *
 *   node tools/drone/build-photo-tiles.mjs --hi "D:/BIT 3D/_work/ortho/raw-hi" \
 *     --raw "D:/BIT 3D/_work/ortho/raw" --out "D:/BIT 3D/_work/web-mesh-v2/ortho-hd"
 *
 * Run from the repo root (it reads the campus boundary from .data/published_graph.json).
 * Inputs are /dev-ortho captures (rgb_<i>_<j>.png, 128 m windows from x0 -620, z0 -1215):
 *  - --hi: the campus at 0.0625 m/px (2048 px windows; `/dev-ortho?mpp=0.0625&out=raw-hi&list=...`),
 *  - --raw: the whole survey at 0.25 m/px (512 px windows; the capture the footprints,
 *    roads and land cover are built from).
 * Output: <out>/meta.json and <out>/<level>/<col>_<row>.webp, 512 px tiles, levels
 * 0-6 at 0.0625-4 m/px. Levels 0 and 1 cover the campus and 40 m round it only (the
 * village and farms are faded on the map anyway); level 2 and up cover the survey,
 * from the sharp capture where there is one. 512 px tiles keep the file count inside
 * the CDN's free plan (20,000 files per version, the mesh is most of it).
 *
 * The capture is a little flat and hazy (unlit mesh textures under an even sky), so
 * the tiles get a mild lift: contrast +8%, saturation +12%. The older 256 px pyramid
 * (<web-mesh>/ortho, build-ortho.py) stays as it was for build-paths and
 * build-landcover, whose colour thresholds were tuned on it.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const hiDir = flag("hi");
const rawDir = flag("raw");
const outDir = flag("out");
if (!hiDir || !rawDir || !outDir) {
  console.error("usage: build-photo-tiles.mjs --hi <0.0625 m/px capture> --raw <0.25 m/px capture> --out <tile dir>");
  process.exit(1);
}
const X0 = -620;
const Z0 = -1215;
const WIN = 128;
const COLS = 13;
const ROWS = 14;
const TILE = 512;
const MPP0 = 0.0625;
const LEVELS = 7;
const QUALITY = Number(flag("quality", 82));
const MARGIN = 40;
const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

/* ---- the campus, for which tiles the sharp levels keep ---- */
const graph = JSON.parse(fs.readFileSync(".data/published_graph.json", "utf8"));
const snapshot = graph.snapshot ?? graph;
const MAP_ORIGIN = (() => {
  const src = fs.readFileSync("lib/geo/projection.ts", "utf8");
  const m = src.match(/MAP_ORIGIN[^=]*=\s*\{\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+)/);
  return { lat: Number(m[1]), lng: Number(m[2]) };
})();
const lr = (MAP_ORIGIN.lat * Math.PI) / 180;
const perLat = 111132.92 - 559.82 * Math.cos(2 * lr) + 1.175 * Math.cos(4 * lr);
const perLng = 111412.84 * Math.cos(lr) - 93.5 * Math.cos(3 * lr);
const boundary = snapshot.boundary.map((p) => [(p.lng - MAP_ORIGIN.lng) * perLng, -(p.lat - MAP_ORIGIN.lat) * perLat]);
function nearCampus(x, z) {
  let inside = false;
  let d = Infinity;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const [xi, zi] = boundary[i];
    const [xj, zj] = boundary[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    const dx = xj - xi;
    const dz = zj - zi;
    const t = Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(x - xi - t * dx, z - zi - t * dz));
  }
  return inside || d <= MARGIN;
}
/** Does the square tile (x, z, side) touch the campus or its margin? Sampled every 8 m. */
function tileNearCampus(x, z, side) {
  const n = Math.max(1, Math.ceil(side / 8));
  for (let a = 0; a <= n; a++) for (let b = 0; b <= n; b++) if (nearCampus(x + (side * a) / n, z + (side * b) / n)) return true;
  return false;
}

/* ---- tiles ---- */
const meta = { x0: X0, z0: Z0, mpp: MPP0, tile: TILE, levels: [] };
for (let L = 0; L < LEVELS; L++) {
  const span = TILE * MPP0 * 2 ** L;
  meta.levels.push({ level: L, mpp: MPP0 * 2 ** L, cols: Math.ceil((COLS * WIN) / span), rows: Math.ceil((ROWS * WIN) / span), tiles: [] });
  fs.mkdirSync(path.join(outDir, String(L)), { recursive: true });
}
let bytes = 0;
async function writeTile(L, c, r, raw) {
  // Nothing surveyed: no file. Fully covered: no alpha channel (a third smaller).
  let opaque = true;
  let any = false;
  for (let p = 3; p < raw.length; p += 4) {
    if (raw[p] > 0) any = true;
    if (raw[p] < 255) opaque = false;
    if (any && !opaque) break;
  }
  if (!any) return false;
  let img = sharp(raw, { raw: { width: TILE, height: TILE, channels: 4 } });
  if (opaque) img = img.removeAlpha();
  const buf = await img.webp({ quality: QUALITY, alphaQuality: 90, effort: 5, smartSubsample: true }).toBuffer();
  fs.writeFileSync(path.join(outDir, String(L), `${c}_${r}.webp`), buf);
  meta.levels[L].tiles.push(`${c}_${r}`);
  bytes += buf.length;
  return true;
}
/** A window's pixels, lifted (contrast, saturation), as RGBA at `size` px. */
async function windowAt(file, size) {
  return sharp(file)
    .ensureAlpha()
    .modulate({ saturation: 1.12 })
    .linear([1.08, 1.08, 1.08, 1], [-10, -10, -10, 0])
    .resize(size, size, { kernel: "lanczos3" })
    .raw()
    .toBuffer();
}
const crop = (buf, size, x, y) => {
  const out = Buffer.alloc(TILE * TILE * 4);
  for (let row = 0; row < TILE; row++) buf.copy(out, row * TILE * 4, ((y + row) * size + x) * 4, ((y + row) * size + x + TILE) * 4);
  return out;
};

const level2 = new Map(); // "c_r" -> RGBA, for the coarse levels
let hiWins = 0;
for (let j = 0; j < ROWS; j++) {
  for (let i = 0; i < COLS; i++) {
    const hi = path.join(hiDir, `rgb_${i}_${j}.png`);
    const lo = path.join(rawDir, `rgb_${i}_${j}.png`);
    const wx = X0 + i * WIN;
    const wz = Z0 + j * WIN;
    if (fs.existsSync(hi)) {
      hiWins++;
      for (const [L, size] of [
        [0, 2048],
        [1, 1024],
      ]) {
        const buf = await windowAt(hi, size);
        const n = size / TILE;
        const side = WIN / n;
        for (let b = 0; b < n; b++)
          for (let a = 0; a < n; a++) {
            if (!tileNearCampus(wx + a * side, wz + b * side, side)) continue;
            await writeTile(L, i * n + a, j * n + b, crop(buf, size, a * TILE, b * TILE));
          }
      }
      level2.set(`${i}_${j}`, await windowAt(hi, 512));
    } else if (fs.existsSync(lo)) {
      level2.set(`${i}_${j}`, await windowAt(lo, 512));
    }
    const l2 = level2.get(`${i}_${j}`);
    if (l2) await writeTile(2, i, j, l2);
  }
  log(`row ${j + 1}/${ROWS}`);
}
// Levels 3-6: each tile from the 2 x 2 below it, halved.
let below = level2;
for (let L = 3; L < LEVELS; L++) {
  const here = new Map();
  const { cols, rows } = meta.levels[L];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const parts = [];
      for (let b = 0; b < 2; b++)
        for (let a = 0; a < 2; a++) {
          const t = below.get(`${2 * c + a}_${2 * r + b}`);
          if (t) parts.push({ input: t, raw: { width: TILE, height: TILE, channels: 4 }, left: a * TILE, top: b * TILE });
        }
      if (!parts.length) continue;
      const big = await sharp({ create: { width: 2 * TILE, height: 2 * TILE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(parts)
        .raw()
        .toBuffer();
      const half = await sharp(big, { raw: { width: 2 * TILE, height: 2 * TILE, channels: 4 } }).resize(TILE, TILE, { kernel: "lanczos3" }).raw().toBuffer();
      here.set(`${c}_${r}`, half);
      await writeTile(L, c, r, half);
    }
  below = here;
}
meta.source = `Drone mesh (DJI Terra, April 2022) rendered straight down by /dev-ortho: ${hiWins} campus windows at ${MPP0} m/px, the rest at 0.25 m/px; tools/drone/build-photo-tiles.mjs`;
fs.writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta));
const files = meta.levels.reduce((n, l) => n + l.tiles.length, 0);
log(`wrote ${files} tiles (${meta.levels.map((l) => l.tiles.length).join(" / ")} per level), ${(bytes / 1e6).toFixed(1)} MB, to ${outDir}`);
