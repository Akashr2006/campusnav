#!/usr/bin/env node
/**
 * Land cover for the 2D map's plan style, from the drone survey: trees, lawns
 * and crops, bare ground (the grounds, farm plots, dirt yards), paving and water.
 *
 *   node tools/drone/build-landcover.mjs "<web-mesh>/ortho" "D:/BIT 3D/_work/ortho/raw" \
 *     public/drone/landcover.json [--debug <dir>]
 *
 * Run from the repo root (it reads public/drone/terrain.*, footprints.json and
 * .data/published_graph.json). Inputs are the photo pyramid at 1 m/px (level 2,
 * made by build-ortho.py) and the /dev-ortho capture's heights (h_<i>_<j>.png:
 * one 128 m window at 0.25 m/px each, height encoded as (y + 100) * 100 in
 * R * 256 + G, 0 = no survey). Per 1 m pixel:
 *  - water: a hole in the survey inside the campus (the mesh has no surface over
 *    the ponds), with the dark water along its edge;
 *  - trees: not under a roof, standing 3 m+ above the bare earth, green or dark;
 *  - grass: green and low (lawns, crops, scrub);
 *  - paved: neutral grey or blue and low (courtyards, plazas, car parks, courts);
 *  - bare: the warm browns and reds left (grounds, farm plots, yards and tracks).
 * Roofs are left out: the map draws the buildings from footprints.json. Each class
 * is cleaned (a 5 x 5 majority vote, specks out, gaps closed), traced into
 * outlines, simplified, rounded off and written as one SVG path per class, in
 * scene metres (X east, Z south), relative coordinates to 0.1 m.
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
const [orthoDir, rawDir, outFile] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!orthoDir || !rawDir || !outFile) {
  console.error("usage: build-landcover.mjs <ortho dir> <raw capture dir> <out landcover.json> [--debug <dir>]");
  process.exit(1);
}
const debugDir = flag("debug", null);
const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

/* ---------------------------------------------------------------- input */

const LEVEL = 2; // 1 m/px
const meta = JSON.parse(fs.readFileSync(path.join(orthoDir, "meta.json"), "utf8"));
const L = meta.levels.find((l) => l.level === LEVEL);
const MPP = L.mpp;
const T = meta.tile;
const W = L.cols * T;
const H = L.rows * T;
const N = W * H;
const toX = (i) => meta.x0 + (i + 0.5) * MPP;
const toZ = (j) => meta.z0 + (j + 0.5) * MPP;
const toI = (x) => (x - meta.x0) / MPP - 0.5;
const toJ = (z) => (z - meta.z0) / MPP - 0.5;

const rgba = Buffer.alloc(N * 4);
for (const name of L.tiles) {
  const [c, r] = name.split("_").map(Number);
  const { data, info } = await sharp(path.join(orthoDir, String(LEVEL), `${name}.webp`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) data.copy(rgba, ((r * T + y) * W + c * T) * 4, y * info.width * 4, (y + 1) * info.width * 4);
}
log(`photo ${W}x${H} at ${MPP} m/px`);

// Highest and lowest surface in each 1 m pixel (16 samples at 0.25 m).
const hMax = new Float32Array(N).fill(NaN);
const hMin = new Float32Array(N).fill(NaN);
{
  const S = Math.round(MPP / 0.25);
  const WIN = Math.round(128 / MPP);
  const names = fs.readdirSync(rawDir).filter((n) => /^h_\d+_\d+\.png$/.test(n));
  for (const name of names) {
    const [, i, j] = name.match(/^h_(\d+)_(\d+)\.png$/).map(Number);
    const { data, info } = await sharp(path.join(rawDir, name)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const ch = info.channels;
    for (let y = 0; y < WIN; y++)
      for (let x = 0; x < WIN; x++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let dy = 0; dy < S; dy++)
          for (let dx = 0; dx < S; dx++) {
            const q = ((S * y + dy) * info.width + S * x + dx) * ch;
            const v = data[q] * 256 + data[q + 1];
            if (v > 1) {
              const h = v / 100 - 100;
              lo = Math.min(lo, h);
              hi = Math.max(hi, h);
            }
          }
        const X = i * WIN + x;
        const Y = j * WIN + y;
        if (hi > -Infinity && X < W && Y < H) {
          hMax[Y * W + X] = hi;
          hMin[Y * W + X] = lo;
        }
      }
  }
  log(`heights from ${names.length} windows`);
}

const tMeta = JSON.parse(fs.readFileSync("public/drone/terrain.json", "utf8"));
const tBytes = fs.readFileSync("public/drone/terrain.bin");
const tH = new Int16Array(tBytes.buffer, tBytes.byteOffset, tBytes.byteLength / 2);
function ground(x, z) {
  const fx = Math.min(Math.max((x - tMeta.originX) / tMeta.cell - 0.5, 0), tMeta.cols - 1);
  const fz = Math.min(Math.max((z - tMeta.originZ) / tMeta.cell - 0.5, 0), tMeta.rows - 1);
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fz);
  const c1 = Math.min(c0 + 1, tMeta.cols - 1);
  const r1 = Math.min(r0 + 1, tMeta.rows - 1);
  const at = (c, r) => tH[r * tMeta.cols + c] / 10;
  const tx = fx - c0;
  const tz = fz - r0;
  return (at(c0, r0) * (1 - tx) + at(c1, r0) * tx) * (1 - tz) + (at(c0, r1) * (1 - tx) + at(c1, r1) * tx) * tz;
}

const footprints = JSON.parse(fs.readFileSync("public/drone/footprints.json", "utf8")).footprints;
const graph = JSON.parse(fs.readFileSync(".data/published_graph.json", "utf8"));
const snapshot = graph.snapshot ?? graph.graph ?? graph;
const MAP_ORIGIN = (() => {
  const src = fs.readFileSync("lib/geo/projection.ts", "utf8");
  const m = src.match(/MAP_ORIGIN[^=]*=\s*\{\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+)/);
  if (!m) throw new Error("MAP_ORIGIN not found in lib/geo/projection.ts");
  return { lat: Number(m[1]), lng: Number(m[2]) };
})();
function gpsToMetres(lat, lng) {
  const r = (MAP_ORIGIN.lat * Math.PI) / 180;
  const perLat = 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r);
  const perLng = 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r);
  return [(lng - MAP_ORIGIN.lng) * perLng, -(lat - MAP_ORIGIN.lat) * perLat];
}
const boundary = (snapshot.boundary ?? []).map((p) => gpsToMetres(p.lat, p.lng));

/* ---------------------------------------------------------------- raster helpers */

function fillPolygon(mask, poly, value = 1) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let y = Math.max(0, Math.ceil(minY)); y <= Math.min(H - 1, Math.floor(maxY)); y++) {
    const xs = [];
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > y !== yj > y) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) mask[y * W + x] = value;
  }
}

/** Squared distance (pixels) to the nearest 0 pixel (Felzenszwalb & Huttenlocher). */
function distanceTransform(mask) {
  const INF = 1e12;
  const M = Math.max(W, H);
  const f = new Float64Array(M);
  const d = new Float64Array(M);
  const v = new Int32Array(M);
  const z = new Float64Array(M + 1);
  const out = new Float64Array(N);
  const pass = (n) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = mask[y * W + x] ? INF : 0;
    pass(H);
    for (let y = 0; y < H; y++) out[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = out[y * W + x];
    pass(W);
    for (let x = 0; x < W; x++) out[y * W + x] = d[x];
  }
  return out;
}
function dilate(mask, r) {
  const inv = new Uint8Array(N);
  for (let p = 0; p < N; p++) inv[p] = mask[p] ? 0 : 1;
  const d = distanceTransform(inv);
  const out = new Uint8Array(N);
  for (let p = 0; p < N; p++) out[p] = d[p] <= r * r ? 1 : 0;
  return out;
}
function erode(mask, r) {
  const d = distanceTransform(mask);
  const out = new Uint8Array(N);
  for (let p = 0; p < N; p++) out[p] = mask[p] && d[p] > r * r ? 1 : 0;
  return out;
}
/** 4-connected components; labels and per-label pixel counts and whether each touches the edge. */
function components(mask) {
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  const edge = [];
  const stack = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (!mask[p] || label[p] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    let touches = false;
    let top = 0;
    stack[top++] = p;
    label[p] = id;
    while (top) {
      const q = stack[--top];
      n++;
      const x = q % W;
      const y = (q - x) / W;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
      if (x > 0 && mask[q - 1] && label[q - 1] < 0) (label[q - 1] = id), (stack[top++] = q - 1);
      if (x < W - 1 && mask[q + 1] && label[q + 1] < 0) (label[q + 1] = id), (stack[top++] = q + 1);
      if (y > 0 && mask[q - W] && label[q - W] < 0) (label[q - W] = id), (stack[top++] = q - W);
      if (y < H - 1 && mask[q + W] && label[q + W] < 0) (label[q + W] = id), (stack[top++] = q + W);
    }
    sizes.push(n);
    edge.push(touches);
  }
  return { label, sizes, edge };
}
/** Specks under `minPx` out, and holes under `holePx` filled. */
function tidy(mask, minPx, holePx) {
  const out = mask.slice();
  const { label, sizes } = components(out);
  for (let p = 0; p < N; p++) if (out[p] && sizes[label[p]] < minPx) out[p] = 0;
  const inv = new Uint8Array(N);
  for (let p = 0; p < N; p++) inv[p] = out[p] ? 0 : 1;
  const holes = components(inv);
  for (let p = 0; p < N; p++) if (inv[p] && !holes.edge[holes.label[p]] && holes.sizes[holes.label[p]] < holePx) out[p] = 1;
  return out;
}

/* ---------------------------------------------------------------- 1. classify */

const C = { NONE: 0, BARE: 1, PAVED: 2, GRASS: 3, TREES: 4, HOLE: 5 };
const roof = new Uint8Array(N);
for (const f of footprints) fillPolygon(roof, f.outline.map(([x, z]) => [toI(x), toJ(z)]));
const campus = new Uint8Array(N);
fillPolygon(campus, boundary.map(([x, z]) => [toI(x), toJ(z)]));

let cls = new Uint8Array(N);
for (let p = 0; p < N; p++) {
  const x = p % W;
  const y = (p - x) / W;
  const r = rgba[p * 4];
  const g = rgba[p * 4 + 1];
  const b = rgba[p * 4 + 2];
  const a = rgba[p * 4 + 3];
  if (roof[p]) continue;
  if (a < 128 || hMax[p] !== hMax[p]) {
    cls[p] = C.HOLE;
    continue;
  }
  const v = (r + g + b) / 3;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const exg = 2 * g - r - b;
  const green = exg > Math.max(6, 0.1 * v) && g >= r;
  const above = hMax[p] - ground(toX(x), toZ(y));
  // Canopy in its own shade is dark rather than green; anything else this tall
  // and not roofed is a tree too (sheds and buses are rare, and small).
  if (above > 3 && (green || v < 95)) cls[p] = C.TREES;
  else if (green) cls[p] = C.GRASS;
  else if (b > r + 15 && b > g) cls[p] = C.PAVED; // blue courts and sheeting
  else if (mx - mn < Math.max(12, 0.15 * v) && v < 240) cls[p] = v < 45 ? C.NONE : C.PAVED;
  else if (r >= b) cls[p] = v < 50 ? C.NONE : C.BARE;
}
log("classified");

// Majority of the 5 x 5 pixels around (unclassified shade does not vote; roofs keep out).
function majority(src, rad) {
  const out = new Uint8Array(N);
  const votes = new Int32Array(6);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (roof[p]) continue;
      votes.fill(0);
      for (let dy = -rad; dy <= rad; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -rad; dx <= rad; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          votes[src[yy * W + xx]]++;
        }
      }
      let best = 0;
      for (let k = 1; k < 6; k++) if (votes[k] > votes[best] || (best === 0 && votes[k] > 0)) best = k;
      // A hole is only a hole where the survey really is missing.
      out[p] = best === C.HOLE && src[p] !== C.HOLE ? (src[p] || C.BARE) : best;
    }
  return out;
}
cls = majority(cls, 2);
log("majority vote");

/* ---------------------------------------------------------------- 2. masks per class */

const mask = (k) => {
  const m = new Uint8Array(N);
  for (let p = 0; p < N; p++) m[p] = cls[p] === k ? 1 : 0;
  return m;
};
// The ponds: holes in the survey inside the campus (the survey's own edge is a
// hole that touches the picture's edge), with the dark water along their banks.
const holes = mask(C.HOLE);
const hc = components(holes);
const near = dilate(campus, 30);
let water = new Uint8Array(N);
for (let p = 0; p < N; p++) water[p] = holes[p] && near[p] && !hc.edge[hc.label[p]] && hc.sizes[hc.label[p]] >= 40 ? 1 : 0;
{
  const bank = dilate(water, 4);
  for (let p = 0; p < N; p++) {
    if (!bank[p] || water[p] || roof[p]) continue;
    const v = (rgba[p * 4] + rgba[p * 4 + 1] + rgba[p * 4 + 2]) / 3;
    const x = p % W;
    const y = (p - x) / W;
    if (v < 75 && hMin[p] - ground(toX(x), toZ(y)) < 1) water[p] = 1;
  }
}
water = tidy(erode(dilate(water, 2), 2), 40, 400);

const out = {};
const layers = [
  // [name, class, open radius, close radius, min area m2, max hole m2]
  ["bare", C.BARE, 1, 2, 120, 60],
  ["paved", C.PAVED, 1, 1, 80, 30],
  ["grass", C.GRASS, 1, 1, 60, 40],
  ["trees", C.TREES, 1, 2, 40, 60],
];
// The campus and a band of its surroundings (--margin metres): the map fades
// what lies outside the campus, and the farms further out only cost bytes.
const MARGIN = Number(flag("margin", 150));
const extent = dilate(campus, MARGIN / MPP);
const masks = {};
for (const [name, k, op, cl, minA, holeA] of layers) {
  let m = mask(k);
  m = dilate(erode(m, op), op);
  m = erode(dilate(m, cl), cl);
  for (let p = 0; p < N; p++) if (roof[p] || water[p] || !extent[p]) m[p] = 0;
  masks[name] = tidy(m, minA / (MPP * MPP), holeA / (MPP * MPP));
}
masks.water = water;
log("masks");

/* ---------------------------------------------------------------- 3. outlines */

/**
 * The boundary of a mask as closed rings along pixel edges (the region kept on
 * the right, so outer rings run clockwise on screen and holes the other way).
 * At a corner two pixels share diagonally, the turn keeps them apart.
 */
function trace(m) {
  const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? m[y * W + x] : 0);
  const VW = W + 1;
  // Outgoing edges per corner: up to 2. Directions 0 E, 1 S, 2 W, 3 N.
  const outs = new Map();
  const add = (x, y, dir) => {
    const k = y * VW + x;
    const l = outs.get(k);
    if (l) l.push(dir);
    else outs.set(k, [dir]);
  };
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!m[y * W + x]) continue;
      if (!at(x, y - 1)) add(x, y, 0);
      if (!at(x + 1, y)) add(x + 1, y, 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, 2);
      if (!at(x - 1, y)) add(x, y + 1, 3);
    }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const rings = [];
  for (const [start, list] of outs) {
    while (list.length) {
      let x = start % VW;
      let y = (start - x) / VW;
      let dir = list.pop();
      const ring = [[x, y]];
      for (;;) {
        x += DX[dir];
        y += DY[dir];
        const l = outs.get(y * VW + x);
        // Back at the start with nothing left to follow: closed.
        if (!l || !l.length) break;
        // Two ways on: turn right (keeps diagonal pixels apart); else the only one.
        let pickI = 0;
        if (l.length > 1) {
          pickI = l.indexOf((dir + 1) % 4);
          if (pickI < 0) pickI = 0;
        }
        const nd = l.splice(pickI, 1)[0];
        if (nd !== dir) ring.push([x, y]);
        dir = nd;
      }
      if (ring.length >= 4) rings.push(ring);
    }
  }
  return rings;
}

function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const [x0, y0] = r[i];
    const [x1, y1] = r[(i + 1) % r.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function simplifyOpen(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const Ln = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bd = 0;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / Ln;
      if (d > bd) {
        bd = d;
        best = k;
      }
    }
    if (bd > tol && best > 0) {
      keep[best] = 1;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}
/** Douglas-Peucker on a closed ring: split at the point farthest from the first. */
function simplifyRing(r, tol) {
  let far = 0;
  let fd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  const a = simplifyOpen(r.slice(0, far + 1), tol);
  const b = simplifyOpen([...r.slice(far), r[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
/** Chaikin corner cutting on a closed ring. */
function chaikin(r, n) {
  let cur = r;
  for (let it = 0; it < n; it++) {
    const next = [];
    for (let i = 0; i < cur.length; i++) {
      const [x0, y0] = cur[i];
      const [x1, y1] = cur[(i + 1) % cur.length];
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    cur = next;
  }
  return cur;
}

/** One SVG path for a class: relative moves in metres, rounded to 0.1 m. */
function toPath(rings, tol, smooth, minArea) {
  let d = "";
  let pts = 0;
  let kept = 0;
  const num = (v) => {
    const s = (v / 10).toString();
    return s.startsWith("-") ? s : ` ${s}`;
  };
  for (const ring of rings) {
    const area = Math.abs(ringArea(ring)) * MPP * MPP;
    if (area < minArea) continue;
    let r = simplifyRing(ring, tol / MPP);
    if (r.length < 3) continue;
    // Rounded off, then thinned again: the cut corners of a near-straight run add nothing.
    if (smooth) r = simplifyRing(chaikin(r, smooth), 0.25 / MPP);
    // Pixel corners to scene metres, in decimetres.
    const dm = r.map(([x, y]) => [Math.round((meta.x0 + x * MPP) * 10), Math.round((meta.z0 + y * MPP) * 10)]);
    const ded = dm.filter((p, i) => i === 0 || p[0] !== dm[i - 1][0] || p[1] !== dm[i - 1][1]);
    if (ded.length < 3) continue;
    d += `M${ded[0][0] / 10} ${ded[0][1] / 10}l`;
    let s = "";
    for (let i = 1; i < ded.length; i++) s += num(ded[i][0] - ded[i - 1][0]) + num(ded[i][1] - ded[i - 1][1]);
    d += s.replace(/^ /, "") + "z";
    pts += ded.length;
    kept++;
  }
  return { d, pts, rings: kept };
}

const STYLE = {
  // [simplify tolerance m, Chaikin passes, smallest ring m2]
  water: [0.6, 2, 30],
  bare: [1.4, 2, 80],
  paved: [1.0, 1, 60],
  grass: [1.3, 2, 40],
  trees: [1.2, 2, 30],
};
for (const name of ["bare", "paved", "grass", "trees", "water"]) {
  const [tol, smooth, minArea] = STYLE[name];
  const res = toPath(trace(masks[name]), tol, smooth, minArea);
  out[name] = res.d;
  let px = 0;
  for (let p = 0; p < N; p++) px += masks[name][p];
  log(`${name}: ${res.rings} rings, ${res.pts} points, ${(res.d.length / 1024).toFixed(0)} KB, ${(px * MPP * MPP / 1e4).toFixed(1)} ha`);
}

const result = {
  source: "Classified from the drone survey (DJI Terra mesh, April 2022): photo colour and heights above the bare earth, at 1 m/px, by tools/drone/build-landcover.mjs",
  frame: "scene metres: x east, z south (the 3D view's frame); SVG path data, draw in the order bare, paved, grass, trees, water",
  ...out,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(result));
log(`wrote ${outFile}: ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);

/* ---------------------------------------------------------------- debug */

if (debugDir) {
  fs.mkdirSync(debugDir, { recursive: true });
  const COL = { 0: [255, 255, 255], 1: [239, 222, 190], 2: [205, 209, 214], 3: [190, 226, 165], 4: [120, 175, 100], 5: [40, 40, 40] };
  const img = Buffer.alloc(N * 3);
  for (let p = 0; p < N; p++) img.set(roof[p] ? [150, 140, 200] : COL[cls[p]], p * 3);
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(debugDir, "landcover-classes.png"));
  const [bx0, bz0] = [meta.x0, meta.z0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${bx0} ${bz0} ${W * MPP} ${H * MPP}">
<rect x="${bx0}" y="${bz0}" width="${W * MPP}" height="${H * MPP}" fill="#f3f1ec"/>
<path d="${out.bare}" fill="#efe2c9"/><path d="${out.paved}" fill="#e3e6ea"/><path d="${out.grass}" fill="#d3ebc3"/>
<path d="${out.trees}" fill="#acd596"/><path d="${out.water}" fill="#9fd0f2" stroke="#6fb2e3" stroke-width="0.6"/>
${footprints.map((f) => `<polygon points="${f.outline.map((p) => p.join(",")).join(" ")}" fill="#dcdfe6" stroke="#aab2bf" stroke-width="0.4"/>`).join("")}
</svg>`;
  fs.writeFileSync(path.join(debugDir, "landcover.svg"), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(debugDir, "landcover-render.png"));
  log(`debug pictures in ${debugDir}`);
}
