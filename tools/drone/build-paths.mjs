#!/usr/bin/env node
/**
 * Roads and walking paths, detected from the drone orthophoto, as a routing network.
 *
 *   node tools/drone/build-paths.mjs <ortho dir> public/drone/paths.json \
 *     --footprints public/drone/footprints.json --graph .data/published_graph.json [--debug <dir>]
 *
 * <ortho dir> is the 2D map's photo pyramid (`mesh/ortho`, made by build-ortho.py):
 * the mesh rendered straight down, here read at 0.5 m/px. Steps:
 *  1. Paved surface: low-saturation grey (asphalt, concrete, covered walkways) or
 *     pink paver blocks, never on a roof (footprints.json) and never green.
 *  2. Cleaned (small specks out, gaps of a car or a shadow closed), thinned to
 *     one-pixel centre lines, and traced into a graph of junctions and polylines.
 *     Short spurs (the skeleton's whiskers into car parks and doorways) are pruned.
 *  3. Gaps under tree canopy: a dead end is carried on, in the direction it was
 *     heading, along the cheapest way over the photo (paved < shade < trees <
 *     soil; never through a roof or a pond) to the network it was heading for.
 *     Islands of path left unconnected are joined the same way.
 *  4. Simplified to 0.6 m and written in scene metres (X east, Z south), with the
 *     paved width measured along each line: `road` from 4.5 m, else `path`.
 * Building doors are not in the file: /navigate links every named block to the
 * network at run time (features/navigation/lib/path-network.ts), so renaming a
 * building never needs a rebuild.
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
const [orthoDir, outFile] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!orthoDir || !outFile) {
  console.error("usage: build-paths.mjs <ortho dir> <out paths.json> --footprints <json> --graph <json> [--debug <dir>]");
  process.exit(1);
}
const footprintsFile = flag("footprints", "public/drone/footprints.json");
const graphFile = flag("graph", ".data/published_graph.json");
const editsFile = flag("edits", path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "paths-edits.json"));
const debugDir = flag("debug", null);
const edits = fs.existsSync(editsFile) ? JSON.parse(fs.readFileSync(editsFile, "utf8")) : {};
const LEVEL = 1; // 0.5 m/px

const t0 = Date.now();
const log = (...m) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...m);

/* ---------------------------------------------------------------- input */

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

log(`mosaic ${W}x${H} at ${MPP} m/px`);
const rgba = Buffer.alloc(N * 4);
for (const name of L.tiles) {
  const [c, r] = name.split("_").map(Number);
  const { data, info } = await sharp(path.join(orthoDir, String(LEVEL), `${name}.webp`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) {
    data.copy(rgba, ((r * T + y) * W + c * T) * 4, y * info.width * 4, (y + 1) * info.width * 4);
  }
}

const graph = JSON.parse(fs.readFileSync(graphFile, "utf8"));
const snapshot = graph.snapshot ?? graph.graph ?? graph;
const footprints = JSON.parse(fs.readFileSync(footprintsFile, "utf8")).footprints;

// The 3D view's projection (features/navigation-3d/lib/campus-3d.ts gpsToMetres).
const MAP_ORIGIN = parseMapOrigin();
function parseMapOrigin() {
  const src = fs.readFileSync(path.resolve("lib/geo/projection.ts"), "utf8");
  const m = src.match(/MAP_ORIGIN[^=]*=\s*\{\s*lat:\s*([-\d.]+),\s*lng:\s*([-\d.]+)/);
  if (!m) throw new Error("MAP_ORIGIN not found in lib/geo/projection.ts");
  return { lat: Number(m[1]), lng: Number(m[2]) };
}
function gpsToMetres(lat, lng) {
  const r = (MAP_ORIGIN.lat * Math.PI) / 180;
  const perLat = 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r);
  const perLng = 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r);
  return [(lng - MAP_ORIGIN.lng) * perLng, -(lat - MAP_ORIGIN.lat) * perLat];
}

/* ---------------------------------------------------------------- raster helpers */

/** Scanline fill of a polygon given in pixel coordinates. */
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
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) mask[y * W + x] = value;
    }
  }
}

/** Squared Euclidean distance (in pixels) to the nearest 0 pixel, Felzenszwalb & Huttenlocher. */
function distanceTransform(mask) {
  const INF = 1e12;
  const f = new Float64Array(Math.max(W, H));
  const d = new Float64Array(Math.max(W, H));
  const v = new Int32Array(Math.max(W, H));
  const z = new Float64Array(Math.max(W, H) + 1);
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

/** Binary dilation / erosion by a disc of radius r pixels (via the distance transform). */
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

/** 8-connected components; returns labels and per-label pixel counts. */
function components(mask) {
  const label = new Int32Array(N).fill(-1);
  const sizes = [];
  const stack = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (!mask[p] || label[p] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    let top = 0;
    stack[top++] = p;
    label[p] = id;
    while (top) {
      const q = stack[--top];
      n++;
      const x = q % W;
      const y = (q - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const r = ny * W + nx;
          if (mask[r] && label[r] < 0) {
            label[r] = id;
            stack[top++] = r;
          }
        }
      }
    }
    sizes.push(n);
  }
  return { label, sizes };
}

/* ---------------------------------------------------------------- 1. classify */

const CLS = { NONE: 0, ROOF: 1, VEG: 2, DARK: 3, GREY: 4, PINK: 5, BLUE: 6, SOIL: 7, DARK_GREY: 8 };
/**
 * A covered walkway that build-ortho.py kept as a roof: long, narrow, and no
 * building's. People walk under it, so it is a path here, not a wall.
 */
function isCoveredWalkway(f) {
  if (f.buildingId) return false;
  const pts = f.outline;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (const [x, z] of pts) {
    sxx += (x - cx) ** 2;
    szz += (z - cz) ** 2;
    sxz += (x - cx) * (z - cz);
  }
  const angle = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ux = Math.cos(angle);
  const uz = Math.sin(angle);
  let a0 = Infinity;
  let a1 = -Infinity;
  let b0 = Infinity;
  let b1 = -Infinity;
  for (const [x, z] of pts) {
    const a = (x - cx) * ux + (z - cz) * uz;
    const b = -(x - cx) * uz + (z - cz) * ux;
    a0 = Math.min(a0, a);
    a1 = Math.max(a1, a);
    b0 = Math.min(b0, b);
    b1 = Math.max(b1, b);
  }
  const long = Math.max(a1 - a0, b1 - b0);
  const short = Math.min(a1 - a0, b1 - b0);
  return long >= 25 && short <= 14 && long / short >= 3.2;
}
const walkways = footprints.filter(isCoveredWalkway);
const roof = new Uint8Array(N);
for (const f of footprints) if (!walkways.includes(f)) fillPolygon(roof, f.outline.map(([x, z]) => [toI(x), toJ(z)]));
// Eaves and walls lean out of the outline in a top-down render; keep a metre clear.
const roofWide = dilate(roof, 2);

const boundary = (snapshot.boundary ?? []).map((p) => gpsToMetres(p.lat, p.lng));
const campus = new Uint8Array(N);
if (boundary.length > 2) fillPolygon(campus, boundary.map(([x, z]) => [toI(x), toJ(z)]));
else campus.fill(1);
// Gates and the roads just outside them belong to the network too.
const area = dilate(campus, Math.round(60 / MPP));

const cls = new Uint8Array(N);
for (let p = 0; p < N; p++) {
  const r = rgba[p * 4];
  const g = rgba[p * 4 + 1];
  const b = rgba[p * 4 + 2];
  const a = rgba[p * 4 + 3];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const v = (r + g + b) / 3;
  // Neutral = no colour cast for its brightness: asphalt and concrete, in sun
  // or in the shade of the trees lining most campus roads (measured: shaded
  // road 30-66 grey with r = g = b; canopy beside it has blue well below green).
  const neutral = mx - mn < Math.max(10, 0.16 * v);
  if (a < 128 || (r > 250 && g > 250 && b > 250)) cls[p] = CLS.NONE;
  else if (roofWide[p]) cls[p] = CLS.ROOF;
  else if (2 * g - r - b > Math.max(8, 0.12 * v) && g >= r) cls[p] = CLS.VEG;
  // Blue sheeting and painted courts. A blue roof big enough to be a building is
  // in footprints.json; what is left are covered walkways and courts, both
  // walked on (the ponds have no survey data at all). Shade is bluish too, but darker.
  else if (b > r + 20 && b > g + 5 && v > 80) cls[p] = CLS.BLUE;
  else if (v < 22) cls[p] = CLS.DARK;
  else if (neutral && v < 235) cls[p] = v < 62 ? CLS.DARK_GREY : CLS.GREY;
  else if (v < 62) cls[p] = CLS.DARK;
  else if (r - g > 30 && Math.abs(g - b) < 18 && r > 140) cls[p] = CLS.PINK;
  else cls[p] = CLS.SOIL;
}
log(`classified (${walkways.length} covered walkways among the roofs)`);
const underCover = new Uint8Array(N);
for (const f of walkways) fillPolygon(underCover, f.outline.map(([x, z]) => [toI(x), toJ(z)]));

/* ---------------------------------------------------------------- 2. paved mask */

let paved = new Uint8Array(N);
for (let p = 0; p < N; p++)
  paved[p] = area[p] && (underCover[p] || cls[p] === CLS.GREY || cls[p] === CLS.PINK || cls[p] === CLS.DARK_GREY || cls[p] === CLS.BLUE) ? 1 : 0;
// Specks out (a pixel or two of grey soil), then the gaps a parked car, a
// shadow or a manhole leaves closed.
paved = dilate(erode(paved, 1), 1);
paved = erode(dilate(paved, 3), 3);
for (let p = 0; p < N; p++) if (roof[p] || !area[p]) paved[p] = 0;
// Hand corrections (tools/drone/paths-edits.json): roads the photo cannot show
// (under continuous canopy, or unpaved) are drawn in; false finds are cut out.
const blocked = new Uint8Array(N);
for (const r of edits.remove ?? []) fillPolygon(blocked, r.poly.map(([x, z]) => [toI(x), toJ(z)]));
for (let p = 0; p < N; p++) if (blocked[p]) paved[p] = 0;
const traced = new Uint8Array(N);
for (const a of edits.add ?? []) {
  const rad = Math.max(1, (a.w ?? 4) / 2 / MPP);
  for (let k = 1; k < a.pts.length; k++) {
    const [x0, z0] = a.pts[k - 1];
    const [x1, z1] = a.pts[k];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (MPP / 2));
    for (let s = 0; s <= n; s++) {
      const ci = toI(x0 + ((x1 - x0) * s) / n);
      const cj = toJ(z0 + ((z1 - z0) * s) / n);
      for (let dj = -Math.ceil(rad); dj <= Math.ceil(rad); dj++)
        for (let di = -Math.ceil(rad); di <= Math.ceil(rad); di++) {
          if (di * di + dj * dj > rad * rad) continue;
          const X = Math.round(ci + di);
          const Y = Math.round(cj + dj);
          if (X >= 0 && Y >= 0 && X < W && Y < H) traced[Y * W + X] = 1;
        }
    }
  }
}
// A trace wins over a roof: it is drawn where a covered walkway runs under one.
for (let p = 0; p < N; p++) if (traced[p]) paved[p] = 1;
{
  const { label, sizes } = components(paved);
  const minPx = 60 / (MPP * MPP);
  for (let p = 0; p < N; p++) if (paved[p] && sizes[label[p]] < minPx) paved[p] = 0;
}
const edt = distanceTransform(paved);
log("paved mask");

/* ---------------------------------------------------------------- skeleton (Zhang-Suen) */

const skel = paved.slice();
{
  let candidates = [];
  for (let p = 0; p < N; p++) if (skel[p]) candidates.push(p);
  const nb = new Uint8Array(9);
  const del = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (const p of candidates) {
        if (!skel[p]) continue;
        const x = p % W;
        const y = (p - x) / W;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) continue;
        // P2..P9 clockwise from north.
        nb[1] = skel[p - W];
        nb[2] = skel[p - W + 1];
        nb[3] = skel[p + 1];
        nb[4] = skel[p + W + 1];
        nb[5] = skel[p + W];
        nb[6] = skel[p + W - 1];
        nb[7] = skel[p - 1];
        nb[8] = skel[p - W - 1];
        let B = 0;
        let A = 0;
        for (let k = 1; k <= 8; k++) {
          B += nb[k];
          if (!nb[k] && nb[(k % 8) + 1]) A++;
        }
        if (B < 2 || B > 6 || A !== 1) continue;
        if (step === 0 ? nb[1] * nb[3] * nb[5] || nb[3] * nb[5] * nb[7] : nb[1] * nb[3] * nb[7] || nb[1] * nb[5] * nb[7]) continue;
        del.push(p);
      }
      for (const p of del) skel[p] = 0;
      if (del.length) changed = true;
    }
    candidates = candidates.filter((p) => skel[p]);
  }
}
log("skeleton");

/* ---------------------------------------------------------------- trace into a graph */

const OFF = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1];
const neighbours = (p) => {
  const x = p % W;
  const out = [];
  for (let k = 0; k < 8; k++) {
    const dx = k === 1 || k === 2 || k === 3 ? 1 : k === 5 || k === 6 || k === 7 ? -1 : 0;
    if (x + dx < 0 || x + dx >= W) continue;
    const q = p + OFF[k];
    if (q >= 0 && q < N && skel[q]) out.push(q);
  }
  return out;
};
/** Branches leaving a skeleton pixel: 0->1 transitions around it (1 = end, 2 = line, 3+ = junction). */
const branches = (p) => {
  const x = p % W;
  let A = 0;
  const at = (k) => {
    const dx = k === 1 || k === 2 || k === 3 ? 1 : k === 5 || k === 6 || k === 7 ? -1 : 0;
    if (x + dx < 0 || x + dx >= W) return 0;
    const q = p + OFF[k];
    return q >= 0 && q < N ? skel[q] : 0;
  };
  for (let k = 0; k < 8; k++) if (!at(k) && at((k + 1) % 8)) A++;
  return A;
};

function traceGraph() {
  const nodeOf = new Int32Array(N).fill(-1);
  const nodes = []; // { px: [pixels], x, y }
  for (let p = 0; p < N; p++) {
    if (!skel[p] || nodeOf[p] >= 0) continue;
    const b = branches(p);
    if (b === 2) continue;
    // Junction pixels that touch are one junction.
    const id = nodes.length;
    const px = [p];
    nodeOf[p] = id;
    for (let i = 0; i < px.length; i++) {
      for (const q of neighbours(px[i])) {
        if (nodeOf[q] < 0 && branches(q) !== 2 && (b >= 3) === (branches(q) >= 3)) {
          nodeOf[q] = id;
          px.push(q);
        }
      }
    }
    nodes.push({ px });
  }
  const visited = new Uint8Array(N);
  const edges = []; // { a, b, chain: [pixels] }
  const seenPair = new Set();
  const walk = (startNode, from, first) => {
    const chain = [from, first];
    visited[first] = 1;
    let prev = from;
    let cur = first;
    for (;;) {
      const nbs = neighbours(cur).filter((q) => q !== prev);
      const toNode = nbs.find((q) => nodeOf[q] >= 0 && !(nodeOf[q] === startNode && chain.length <= 2));
      if (toNode !== undefined) {
        chain.push(toNode);
        return { b: nodeOf[toNode], chain };
      }
      const free = nbs.filter((q) => nodeOf[q] < 0 && !visited[q]);
      if (!free.length) return { b: -1, chain };
      // Prefer a 4-connected step over a diagonal one.
      const next = free.find((q) => Math.abs(q - cur) === 1 || Math.abs(q - cur) === W) ?? free[0];
      visited[next] = 1;
      chain.push(next);
      prev = cur;
      cur = next;
    }
  };
  const traceFrom = (id) => {
    for (const q of nodes[id].px) {
      for (const n of neighbours(q)) {
        if (nodeOf[n] === id) continue;
        if (nodeOf[n] >= 0) {
          const key = id < nodeOf[n] ? `${id}-${nodeOf[n]}` : `${nodeOf[n]}-${id}`;
          if (!seenPair.has(key)) {
            seenPair.add(key);
            edges.push({ a: id, b: nodeOf[n], chain: [q, n] });
          }
          continue;
        }
        if (visited[n]) continue;
        const { b, chain } = walk(id, q, n);
        if (b < 0) {
          // Ran out without meeting a node (should not happen): end it here.
          const end = chain[chain.length - 1];
          const nid = nodes.length;
          nodes.push({ px: [end] });
          nodeOf[end] = nid;
          edges.push({ a: id, b: nid, chain });
        } else edges.push({ a: id, b, chain });
      }
    }
  };
  for (let id = 0; id < nodes.length; id++) traceFrom(id);
  // Closed loops with no junction on them.
  for (let p = 0; p < N; p++) {
    if (!skel[p] || nodeOf[p] >= 0 || visited[p]) continue;
    const id = nodes.length;
    nodes.push({ px: [p] });
    nodeOf[p] = id;
    traceFrom(id);
  }
  for (const n of nodes) {
    let sx = 0;
    let sy = 0;
    for (const p of n.px) {
      sx += p % W;
      sy += Math.floor(p / W);
    }
    n.x = sx / n.px.length;
    n.y = sy / n.px.length;
  }
  return { nodes, edges };
}

let { nodes, edges } = traceGraph();
log(`traced ${nodes.length} nodes, ${edges.length} edges`);

/* ---------------------------------------------------------------- polyline graph ops */

// From here on an edge carries a polyline in pixel coordinates.
const pxPoint = (p) => [p % W, Math.floor(p / W)];
let E = edges
  .filter((e) => e.a !== e.b || e.chain.length > 8)
  .map((e) => ({ a: e.a, b: e.b, pts: [[nodes[e.a].x, nodes[e.a].y], ...e.chain.slice(1, -1).map(pxPoint), [nodes[e.b].x, nodes[e.b].y]], kind: "detected" }));
let V = nodes.map((n) => ({ x: n.x, y: n.y }));

const lengthOf = (pts) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s * MPP;
};
const widthAt = (x, y) => {
  const p = Math.round(y) * W + Math.round(x);
  return p >= 0 && p < N ? 2 * Math.sqrt(edt[p]) * MPP : 0;
};
const degrees = () => {
  const d = new Int32Array(V.length);
  for (const e of E) {
    d[e.a]++;
    d[e.b]++;
  }
  return d;
};

/** Join chains through nodes with exactly two edges, so every node is an end or a junction. */
function mergeThrough() {
  for (;;) {
    const deg = degrees();
    const inc = Array.from({ length: V.length }, () => []);
    E.forEach((e, i) => {
      inc[e.a].push(i);
      inc[e.b].push(i);
    });
    let merged = false;
    const dead = new Set();
    for (let v = 0; v < V.length; v++) {
      if (deg[v] !== 2 || inc[v].some((i) => dead.has(i))) continue;
      const [i, j] = inc[v];
      if (i === j) continue; // a loop through one node
      const e1 = E[i];
      const e2 = E[j];
      if (e1.kind !== e2.kind) continue;
      const p1 = e1.b === v ? e1.pts : [...e1.pts].reverse();
      const s1 = e1.b === v ? e1.a : e1.b;
      const p2 = e2.a === v ? e2.pts : [...e2.pts].reverse();
      const s2 = e2.a === v ? e2.b : e2.a;
      E.push({ a: s1, b: s2, pts: [...p1, ...p2.slice(1)], kind: e1.kind });
      dead.add(i);
      dead.add(j);
      // Keep the incidence lists honest for this pass.
      inc[s1] = inc[s1].map((k) => (k === i || k === j ? E.length - 1 : k));
      inc[s2] = inc[s2].map((k) => (k === i || k === j ? E.length - 1 : k));
      merged = true;
    }
    E = E.filter((_, i) => !dead.has(i));
    if (!merged) break;
  }
}

function pruneSpurs(rounds) {
  for (let r = 0; r < rounds; r++) {
    const deg = degrees();
    const before = E.length;
    E = E.filter((e) => {
      const endA = deg[e.a] === 1;
      const endB = deg[e.b] === 1;
      if (!endA && !endB) return true;
      if (endA && endB) return lengthOf(e.pts) >= 25; // an island: keep if it is a real stretch
      const j = endA ? V[e.b] : V[e.a];
      const limit = Math.max(9, 1.3 * widthAt(j.x, j.y));
      return lengthOf(e.pts) >= limit;
    });
    mergeThrough();
    if (E.length === before) break;
  }
}

// `--probe x,z` prints the network near a point after each step, to see where a line goes missing.
const probe = flag("probe", null)?.split(",").map(Number);
function report(stage) {
  if (!probe) return;
  const [px, pz] = [toI(probe[0]), toJ(probe[1])];
  if (stage === "traced") {
    const p = Math.round(pz) * W + Math.round(px);
    let sk = 0;
    for (let dy = -20; dy <= 20; dy++) for (let dx = -20; dx <= 20; dx++) sk += skel[p + dy * W + dx];
    console.log(`probe pixel: class ${cls[p]} paved ${paved[p]} traced ${traced[p]} roof ${roof[p]}; skeleton pixels within 10 m: ${sk}`);
    const raw = edges.filter((e) => e.chain.some((q) => Math.hypot((q % W) - px, Math.floor(q / W) - pz) * MPP < 10));
    console.log(`probe raw edges: ${raw.map((e) => `${e.a}->${e.b} (${e.chain.length} px)`).join(", ")}`);
    const nn = nodes.map((n, i) => [i, n]).filter(([, n]) => Math.hypot(n.x - px, n.y - pz) * MPP < 10);
    console.log(`probe nodes: ${nn.map(([i, n]) => `${i} (${n.px.length} px)`).join(", ")}`);
  }
  const near = E.filter((e) => e.pts.some(([x, y]) => Math.hypot(x - px, y - pz) * MPP < 10));
  console.log(`probe ${stage}: ` + near.map((e) => `${e.kind} ${toX(V[e.a].x).toFixed(1)},${toZ(V[e.a].y).toFixed(1)} -> ${toX(V[e.b].x).toFixed(1)},${toZ(V[e.b].y).toFixed(1)} (${lengthOf(e.pts).toFixed(1)} m)`).join(" | "));
}
/**
 * A junction in a thinned blob is often a tangle of nodes a pixel or two apart,
 * some not even joined. Fold nodes joined by a very short edge, or simply this
 * close, into one.
 */
function contractClose(maxM) {
  const parent = V.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (const e of E) if (lengthOf(e.pts) < maxM) union(e.a, e.b);
  const used = new Set(E.flatMap((e) => [e.a, e.b]));
  const cell = new Map();
  const size = maxM / MPP;
  for (const v of used) {
    const k = `${Math.floor(V[v].x / size)},${Math.floor(V[v].y / size)}`;
    (cell.get(k) ?? cell.set(k, []).get(k)).push(v);
  }
  for (const v of used) {
    const cx = Math.floor(V[v].x / size);
    const cy = Math.floor(V[v].y / size);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const w of cell.get(`${cx + dx},${cy + dy}`) ?? [])
          if (w !== v && Math.hypot(V[v].x - V[w].x, V[v].y - V[w].y) * MPP < maxM * 0.8) union(v, w);
  }
  const sum = new Map();
  for (const v of used) {
    const r = find(v);
    const s = sum.get(r) ?? { x: 0, y: 0, n: 0 };
    s.x += V[v].x;
    s.y += V[v].y;
    s.n++;
    sum.set(r, s);
  }
  for (const [r, s] of sum) V[r] = { x: s.x / s.n, y: s.y / s.n };
  E = E.map((e) => {
    const a = find(e.a);
    const b = find(e.b);
    const pts = e.pts.slice();
    pts[0] = [V[a].x, V[a].y];
    pts[pts.length - 1] = [V[b].x, V[b].y];
    return { ...e, a, b, pts };
  }).filter((e) => e.a !== e.b || lengthOf(e.pts) > 12);
}

report("traced");
contractClose(4);
report("contracted");
mergeThrough();
report("merged");
pruneSpurs(4);
report("pruned");
log(`pruned to ${E.length} edges`);

/* ---------------------------------------------------------------- 3. bridge gaps */

// Cost of stepping onto a pixel, per pixel length. Roofs, and ponds (no survey data), are walls.
const STEP = new Float32Array(N);
for (let p = 0; p < N; p++) {
  const c = cls[p];
  STEP[p] = traced[p] ? 1 : !area[p] || roof[p] || blocked[p] || c === CLS.NONE ? Infinity : paved[p] ? 1 : c === CLS.DARK ? 1.4 : c === CLS.VEG ? 2 : c === CLS.ROOF ? 3 : 2.6;
}

/** Raster the network: which edge each centre-line pixel belongs to. */
function rasterEdges() {
  const owner = new Int32Array(N).fill(-1);
  E.forEach((e, i) => {
    for (let k = 1; k < e.pts.length; k++) {
      const [x0, y0] = e.pts[k - 1];
      const [x1, y1] = e.pts[k];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= n; s++) {
        const x = Math.round(x0 + ((x1 - x0) * s) / n);
        const y = Math.round(y0 + ((y1 - y0) * s) / n);
        if (x >= 0 && y >= 0 && x < W && y < H) owner[y * W + x] = i;
      }
    }
  });
  return owner;
}

class Heap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  push(key, val) {
    const { k, v } = this;
    k.push(key);
    v.push(val);
    let i = k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const { k, v } = this;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

/**
 * Cheapest way over the photo from the source pixels to a pixel `accept`s,
 * within `maxLen` metres. Returns the pixel path (source first) or null.
 */
function cheapestPath(sources, accept, maxLen, allowed = () => true) {
  const cost = new Map();
  const from = new Map();
  const heap = new Heap();
  const isSource = new Set(sources);
  // Search inside the sources' box grown by maxLen.
  const R = Math.ceil(maxLen / MPP);
  let bx0 = Infinity;
  let by0 = Infinity;
  let bx1 = -Infinity;
  let by1 = -Infinity;
  for (const s of sources) {
    const x = s % W;
    const y = Math.floor(s / W);
    bx0 = Math.min(bx0, x - R);
    by0 = Math.min(by0, y - R);
    bx1 = Math.max(bx1, x + R);
    by1 = Math.max(by1, y + R);
    cost.set(s, 0);
    heap.push(0, s);
  }
  while (heap.size) {
    const p = heap.pop();
    const c = cost.get(p);
    if (c * MPP > maxLen * 2.6) break;
    if (!isSource.has(p) && accept(p)) {
      const out = [p];
      let q = p;
      while (from.has(q)) {
        q = from.get(q);
        out.push(q);
      }
      return out.reverse();
    }
    const x = p % W;
    const y = (p - x) / W;
    for (let k = 0; k < 8; k++) {
      const dx = k === 1 || k === 2 || k === 3 ? 1 : k === 5 || k === 6 || k === 7 ? -1 : 0;
      const dy = k === 7 || k === 0 || k === 1 ? -1 : k === 3 || k === 4 || k === 5 ? 1 : 0;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
      const q = ny * W + nx;
      const step = STEP[q];
      if (step === Infinity || !allowed(q)) continue;
      const nc = c + step * (dx && dy ? Math.SQRT2 : 1);
      if (nc < (cost.get(q) ?? Infinity)) {
        cost.set(q, nc);
        from.set(q, p);
        heap.push(nc, q);
      }
    }
  }
  return null;
}

/** Network distance (metres) between nodes, for telling a short-cut from a real gap. */
function networkDistance(a, b, limit) {
  const adj = Array.from({ length: V.length }, () => []);
  E.forEach((e) => {
    const l = lengthOf(e.pts);
    adj[e.a].push([e.b, l]);
    adj[e.b].push([e.a, l]);
  });
  const dist = new Map([[a, 0]]);
  const heap = new Heap();
  heap.push(0, a);
  while (heap.size) {
    const v = heap.pop();
    const d = dist.get(v);
    if (v === b) return d;
    if (d > limit) break;
    for (const [w, l] of adj[v]) {
      if (d + l < (dist.get(w) ?? Infinity)) {
        dist.set(w, d + l);
        heap.push(d + l, w);
      }
    }
  }
  return Infinity;
}

/** Adds a node on edge i at its polyline point nearest pixel (x, y); returns the node. */
function splitEdgeAt(i, x, y) {
  const e = E[i];
  let best = { k: 0, t: 0, d: Infinity };
  for (let k = 1; k < e.pts.length; k++) {
    const [ax, ay] = e.pts[k - 1];
    const [bx, by] = e.pts[k];
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L2));
    const d = Math.hypot(ax + t * (bx - ax) - x, ay + t * (by - ay) - y);
    if (d < best.d) best = { k, t, d };
  }
  const [ax, ay] = e.pts[best.k - 1];
  const [bx, by] = e.pts[best.k];
  const p = [ax + best.t * (bx - ax), ay + best.t * (by - ay)];
  // Close to an end: use that end rather than a sliver of an edge.
  if (Math.hypot(p[0] - V[e.a].x, p[1] - V[e.a].y) * MPP < 3) return e.a;
  if (Math.hypot(p[0] - V[e.b].x, p[1] - V[e.b].y) * MPP < 3) return e.b;
  const v = V.length;
  V.push({ x: p[0], y: p[1] });
  const first = [...e.pts.slice(0, best.k), p];
  const second = [p, ...e.pts.slice(best.k)];
  E[i] = { a: e.a, b: v, pts: first, kind: e.kind };
  E.push({ a: v, b: e.b, pts: second, kind: e.kind });
  return v;
}

function bridgeDeadEnds() {
  let added = 0;
  const deg = degrees();
  const ends = [];
  E.forEach((e, i) => {
    if (deg[e.a] === 1) ends.push({ v: e.a, i, pts: e.pts });
    if (deg[e.b] === 1) ends.push({ v: e.b, i, pts: [...e.pts].reverse() });
  });
  for (const end of ends) {
    const owner = rasterEdges();
    const node = V[end.v];
    // Heading at the dead end, from ~8 m back along its line.
    let back = end.pts[0];
    for (const q of end.pts) {
      if (Math.hypot(q[0] - node.x, q[1] - node.y) * MPP >= 8) {
        back = q;
        break;
      }
    }
    const hx = node.x - back[0];
    const hy = node.y - back[1];
    const hl = Math.hypot(hx, hy);
    if (hl * MPP < 3) continue;
    const start = Math.round(node.y) * W + Math.round(node.x);
    const own = end.i;
    const MAX = 110;
    const pathPx = cheapestPath(
      [start],
      (p) => {
        const o = owner[p];
        if (o < 0 || o === own) return false;
        const x = p % W;
        const y = (p - x) / W;
        const dx = x - node.x;
        const dy = y - node.y;
        const d = Math.hypot(dx, dy);
        if (d * MPP < 2) return false;
        // Carry on the way it was going (within 55 degrees; 30 past 40 m, 18 past 70), not back on itself.
        const cone = d * MPP > 70 ? 18 : d * MPP > 40 ? 30 : 55;
        return (dx * hx + dy * hy) / (d * hl) > Math.cos((cone * Math.PI) / 180);
      },
      MAX,
      (q) => owner[q] !== own || Math.hypot((q % W) - node.x, Math.floor(q / W) - node.y) < 6
    );
    if (!pathPx) continue;
    const pts = pathPx.map(pxPoint);
    const len = lengthOf(pts);
    let cost = 0;
    for (const p of pathPx.slice(1)) cost += STEP[p] * MPP;
    // Mostly over paving, shade or canopy: a hidden road, not a walk across a field.
    if (len > MAX || cost / Math.max(len, 1) > (len > 45 ? 2.05 : 2.15)) continue;
    const hit = pathPx[pathPx.length - 1];
    const target = splitEdgeAt(owner[hit], hit % W, Math.floor(hit / W));
    if (target === end.v) continue;
    // Not a short-cut between two points the network already joins closely.
    if (networkDistance(end.v, target, len * 3 + 40) < len * 3 + 40) continue;
    pts[pts.length - 1] = [V[target].x, V[target].y];
    E.push({ a: end.v, b: target, pts, kind: "bridge" });
    added++;
  }
  return added;
}

const triedIslands = new Set();
function joinIslands() {
  let added = 0;
  for (let round = 0; round < 6; round++) {
    // Components of the network.
    const comp = new Int32Array(V.length).fill(-1);
    const adj = Array.from({ length: V.length }, () => []);
    E.forEach((e, i) => {
      adj[e.a].push(i);
      adj[e.b].push(i);
    });
    let nc = 0;
    // Each component's lowest node, which names it across rounds.
    const rep = [];
    for (let v = 0; v < V.length; v++) {
      if (comp[v] >= 0 || !adj[v].length) continue;
      const stack = [v];
      comp[v] = nc;
      rep.push(v);
      while (stack.length) {
        const u = stack.pop();
        for (const i of adj[u]) {
          const w = E[i].a === u ? E[i].b : E[i].a;
          if (comp[w] < 0) {
            comp[w] = nc;
            stack.push(w);
          }
        }
      }
      nc++;
    }
    const lens = new Array(nc).fill(0);
    for (const e of E) lens[comp[e.a]] += lengthOf(e.pts);
    const main = lens.indexOf(Math.max(...lens));
    const owner = rasterEdges();
    let joined = 0;
    for (let c = 0; c < nc; c++) {
      if (c === main || lens[c] < 30 || triedIslands.has(`${rep[c]}:${lens[c].toFixed(0)}`)) continue;
      triedIslands.add(`${rep[c]}:${lens[c].toFixed(0)}`);
      // Every centre-line pixel of the island is a start.
      const sources = [];
      for (const e of E) {
        if (comp[e.a] !== c) continue;
        for (const q of e.pts) sources.push(Math.round(q[1]) * W + Math.round(q[0]));
      }
      const pathPx = cheapestPath(sources, (p) => owner[p] >= 0 && comp[E[owner[p]].a] !== c, 60);
      if (!pathPx) continue;
      let cost = 0;
      for (const p of pathPx.slice(1)) cost += STEP[p] * MPP;
      const len = lengthOf(pathPx.map(pxPoint));
      // Over paving or under trees, not across a field.
      if (cost / Math.max(len, 1) > 2.3) continue;
      const from = pathPx[0];
      const to = pathPx[pathPx.length - 1];
      const fromEdge = owner[from];
      const toEdge = owner[to];
      if (fromEdge < 0 || toEdge < 0) continue;
      const a = splitEdgeAt(fromEdge, from % W, Math.floor(from / W));
      const b = splitEdgeAt(toEdge, to % W, Math.floor(to / W));
      const pts = pathPx.map(pxPoint);
      pts[0] = [V[a].x, V[a].y];
      pts[pts.length - 1] = [V[b].x, V[b].y];
      E.push({ a, b, pts, kind: "bridge" });
      joined++;
      added++;
      break; // components changed; recount
    }
    if (!joined) break;
  }
  return added;
}

const bridges = bridgeDeadEnds();
log(`bridged ${bridges} gaps`);
let islands = 0;
for (let k = 0; k < 40; k++) {
  const n = joinIslands();
  islands += n;
  if (!n) break;
}
log(`joined ${islands} islands`);
mergeThrough();
pruneSpurs(2);

/* ---------------------------------------------------------------- 4. simplify and write */

function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ax, ay] = pts[i];
    const [bx, by] = pts[j];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bd = 0;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - pts[k][1]) - (ax - pts[k][0]) * (by - ay)) / L;
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

// Drop nodes no edge uses, and renumber.
const used = new Map();
const outNodes = [];
const nodeIndex = (v) => {
  if (!used.has(v)) {
    used.set(v, outNodes.length);
    outNodes.push([+toX(V[v].x).toFixed(2), +toZ(V[v].y).toFixed(2)]);
  }
  return used.get(v);
};
const outEdges = [];
let roadM = 0;
let pathM = 0;
let bridgeM = 0;
for (const e of E) {
  if (e.a === e.b && lengthOf(e.pts) < 20) continue;
  // A gap link is a guess at a hidden line: keep it straight rather than following the photo's noise.
  const smooth = simplify(e.pts, (e.kind === "bridge" ? 2.5 : 0.6) / MPP);
  const widths = e.pts.map(([x, y]) => widthAt(x, y)).filter((w) => w > 0).sort((a, b) => a - b);
  const width = widths.length ? widths[Math.floor(widths.length / 2)] : 0;
  const len = lengthOf(e.pts);
  const kind = e.kind === "bridge" ? "link" : width >= 4.5 ? "road" : "path";
  if (kind === "road") roadM += len;
  else if (kind === "path") pathM += len;
  else bridgeM += len;
  outEdges.push({
    a: nodeIndex(e.a),
    b: nodeIndex(e.b),
    kind,
    w: +width.toFixed(1),
    len: +len.toFixed(1),
    pts: smooth.slice(1, -1).flatMap(([x, y]) => [+toX(x).toFixed(2), +toZ(y).toFixed(2)]),
  });
}

const out = {
  source: "Detected from the drone orthophoto (DJI Terra mesh, April 2022) at 0.5 m/px by tools/drone/build-paths.mjs",
  frame: "scene metres: x east, z south (the 3D view's frame)",
  nodes: outNodes,
  edges: outEdges,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out));
log(
  `wrote ${outFile}: ${outNodes.length} nodes, ${outEdges.length} edges; roads ${(roadM / 1000).toFixed(2)} km, paths ${(pathM / 1000).toFixed(2)} km, gap links ${(bridgeM / 1000).toFixed(2)} km, ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`
);

/* ---------------------------------------------------------------- debug picture */

if (debugDir) {
  fs.mkdirSync(debugDir, { recursive: true });
  const img = Buffer.alloc(N * 3);
  for (let p = 0; p < N; p++) {
    const k = rgba[p * 4 + 3] < 128 ? 1 : 0.55;
    let r = rgba[p * 4] * k + (1 - k) * 255;
    let g = rgba[p * 4 + 1] * k + (1 - k) * 255;
    let b = rgba[p * 4 + 2] * k + (1 - k) * 255;
    if (paved[p]) {
      r = r * 0.6 + 255 * 0.4;
      g = g * 0.6 + 220 * 0.4;
      b = b * 0.6;
    }
    img[p * 3] = r;
    img[p * 3 + 1] = g;
    img[p * 3 + 2] = b;
  }
  const dot = (x, y, col, rad) => {
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        const X = Math.round(x + dx);
        const Y = Math.round(y + dy);
        if (X < 0 || Y < 0 || X >= W || Y >= H || dx * dx + dy * dy > rad * rad) continue;
        img.set(col, (Y * W + X) * 3);
      }
  };
  const line = (pts, col, rad) => {
    for (let k = 1; k < pts.length; k++) {
      const [x0, y0] = pts[k - 1];
      const [x1, y1] = pts[k];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      for (let s = 0; s <= n; s++) dot(x0 + ((x1 - x0) * s) / n, y0 + ((y1 - y0) * s) / n, col, rad);
    }
  };
  for (const e of outEdges) {
    const pts = [outNodes[e.a], ...Array.from({ length: e.pts.length / 2 }, (_, k) => [e.pts[2 * k], e.pts[2 * k + 1]]), outNodes[e.b]].map(([x, z]) => [toI(x), toJ(z)]);
    line(pts, e.kind === "road" ? [220, 30, 30] : e.kind === "path" ? [30, 90, 230] : [230, 0, 230], 1.5);
  }
  for (const [x, z] of outNodes) dot(toI(x), toJ(z), [0, 0, 0], 2.5);
  if (boundary.length > 2) line([...boundary, boundary[0]].map(([x, z]) => [toI(x), toJ(z)]), [255, 255, 255], 1);
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(debugDir, "paths-debug.png"));
  // The photo at full strength with thin lines, for checking against what the eye sees.
  for (let p = 0; p < N; p++) {
    img[p * 3] = rgba[p * 4];
    img[p * 3 + 1] = rgba[p * 4 + 1];
    img[p * 3 + 2] = rgba[p * 4 + 2];
  }
  for (const e of outEdges) {
    const pts = [outNodes[e.a], ...Array.from({ length: e.pts.length / 2 }, (_, k) => [e.pts[2 * k], e.pts[2 * k + 1]]), outNodes[e.b]].map(([x, z]) => [toI(x), toJ(z)]);
    line(pts, e.kind === "road" ? [255, 40, 40] : e.kind === "path" ? [40, 120, 255] : [255, 0, 255], 0.8);
  }
  for (const a of edits.add ?? []) line(a.pts.map(([x, z]) => [toI(x), toJ(z)]), [255, 255, 0], 0.5);
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(debugDir, "paths-review.png"));
  log(`debug picture in ${debugDir}`);
}
