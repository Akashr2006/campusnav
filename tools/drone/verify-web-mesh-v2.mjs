/**
 * Checks v2 tiles against the originals: same triangles, same texture bytes,
 * and the geometry error the re-encode introduced (each v2 vertex matched to
 * its nearest original vertex; Draco reorders vertices, so indices differ).
 *
 *   node tools/drone/verify-web-mesh-v2.mjs <web-mesh> <web-mesh-v2> [tile ...]
 * With no tiles named, every tile present in v2 (up to --limit, default 200) is checked.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import draco3d from "draco3dgltf";

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
});

const glbOf = (buf) => {
  const o = [12, 16, 20, 24].reduce((a, k) => a + buf.readUInt32LE(k), 0);
  return new Uint8Array(buf.subarray(28 + o));
};

async function read(file) {
  const doc = await io.readBinary(glbOf(fs.readFileSync(file)));
  const prims = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives());
  return {
    prims: prims.map((p) => ({
      pos: p.getAttribute("POSITION").getArray(),
      uv: p.getAttribute("TEXCOORD_0")?.getArray(),
      tris: (p.getIndices()?.getCount() ?? p.getAttribute("POSITION").getCount()) / 3,
    })),
    images: doc.getRoot().listTextures().map((t) => crypto.createHash("sha1").update(t.getImage()).digest("hex")),
    minFilters: doc.getRoot().listMaterials().map((m) => m.getBaseColorTextureInfo()?.getMinFilter()),
  };
}

/** Max distance from each b vertex to the nearest a vertex, via a uniform grid. */
function maxNearest(a, b, uvA, uvB) {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < a.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], a[i + k]); hi[k] = Math.max(hi[k], a[i + k]); }
  const extent = Math.max(...hi.map((h, k) => h - lo[k]));
  const cell = extent / 64 || 1;
  // Two original vertices closer than one 14-bit quantization step can swap
  // places after the re-encode, so seam twins are searched within that step.
  const window = Math.max(0.002, (2 * Math.sqrt(3) * extent) / 2 ** 14);
  const key = (x, y, z) => `${Math.floor((x - lo[0]) / cell)},${Math.floor((y - lo[1]) / cell)},${Math.floor((z - lo[2]) / cell)}`;
  const grid = new Map();
  for (let i = 0; i < a.length; i += 3) {
    const k = key(a[i], a[i + 1], a[i + 2]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i / 3);
  }
  let worst = 0, worstUv = 0;
  for (let j = 0; j < b.length; j += 3) {
    const cx = Math.floor((b[j] - lo[0]) / cell), cy = Math.floor((b[j + 1] - lo[1]) / cell), cz = Math.floor((b[j + 2] - lo[2]) / cell);
    const near = [];
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const i of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const d = Math.hypot(a[3 * i] - b[j], a[3 * i + 1] - b[j + 1], a[3 * i + 2] - b[j + 2]);
        near.push([d, i]);
        best = Math.min(best, d);
      }
    }
    worst = Math.max(worst, best);
    if (uvA && uvB) {
      // A seam vertex exists once per chart, with the same position and
      // different UVs: compare against the closest UV among co-located originals.
      const v = j / 3;
      let bestUv = Infinity;
      for (const [d, i] of near)
        if (d <= best + window)
          bestUv = Math.min(bestUv, Math.max(Math.abs(uvA[2 * i] - uvB[2 * v]), Math.abs(uvA[2 * i + 1] - uvB[2 * v + 1])));
      if (bestUv < Infinity) worstUv = Math.max(worstUv, bestUv);
    }
  }
  return { worst, worstUv };
}

const [src, dst, ...named] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const limit = Number(process.argv[process.argv.indexOf("--limit") + 1]) || 200;
const list = named.length
  ? named
  : fs.readdirSync(dst, { recursive: true }).filter((f) => f.endsWith(".b3dm")).slice(0, limit);

let worstPos = 0, worstUv = 0, bad = 0;
for (const rel of list) {
  const a = await read(path.join(src, rel));
  const b = await read(path.join(dst, rel));
  const sameTris = a.prims.map((p) => p.tris).join() === b.prims.map((p) => p.tris).join();
  const sameImages = a.images.join() === b.images.join();
  let tilePos = 0, tileUv = 0;
  a.prims.forEach((p, i) => {
    const r = maxNearest(p.pos, b.prims[i].pos, p.uv, b.prims[i].uv);
    tilePos = Math.max(tilePos, r.worst);
    tileUv = Math.max(tileUv, r.worstUv);
  });
  worstPos = Math.max(worstPos, tilePos);
  worstUv = Math.max(worstUv, tileUv);
  if (!sameTris || !sameImages) bad++;
  console.log(`${rel}  tris ${sameTris ? "same" : "DIFFERENT"}  images ${sameImages ? "identical" : "DIFFERENT"}  minFilter ${b.minFilters.join("/")}  max pos err ${(tilePos * 1000).toFixed(2)} mm  max uv err ${(tileUv * 1024).toFixed(3)} texels@1024`);
}
console.log(`\n${list.length} tiles: ${bad} with differences; worst position error ${(worstPos * 1000).toFixed(2)} mm, worst UV error ${(worstUv * 1024).toFixed(3)} texels at 1024 px`);
process.exitCode = bad ? 1 : 0;
