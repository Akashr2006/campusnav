/**
 * Web mesh v2: repacks the drone 3D Tiles (the output of build-web-mesh.py) so
 * phones on Indian mobile networks get a sharp view sooner.
 *
 *  1. Fewer round trips. DJI nests 657 tileset JSONs up to six deep, so the
 *     viewer needed ~6 sequential fetches (~250 ms each from India to the
 *     Cloudflare edge it is routed to) before it could even ask for a sharp
 *     tile. v2 has one root tileset holding the top levels of every block and
 *     one external tileset per subtree at --split-level: two fetches reach any tile.
 *  2. Smaller tiles. DJI's Draco spends ~17 bytes per vertex on position + UV.
 *     Geometry is re-encoded with edgebreaker at 14-bit positions (under 5 mm
 *     even on the 80 m L17 tiles) and 13-bit UVs (1/16 texel on a 1024 atlas).
 *  3. Mipmapped textures. DJI's samplers ask for LINEAR minification with no
 *     mipmaps, so the photo shimmers and aliases at any distance and the
 *     viewer's anisotropic filtering has no effect. v2 asks for trilinear.
 *
 * Texture bytes are copied untouched: no re-compression, so no quality loss.
 * Tile file names are kept, so the 2D layers and tools that read them still work.
 *
 *   node tools/drone/build-web-mesh-v2.mjs <web-mesh> <out> [--split-level 17] [--workers 12] [--sample 40]
 *
 * --sample N converts N tiles spread over every level into <out> and prints the
 * size change, without writing tilesets. Re-running skips tiles already written.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const LEVEL = /_L(\d+)_/;
const levelOf = (uri) => {
  const m = LEVEL.exec(uri);
  return m ? Number(m[1]) : null;
};

// ---------------------------------------------------------------- b3dm framing

function splitB3dm(buf) {
  if (buf.toString("latin1", 0, 4) !== "b3dm") throw new Error("not a b3dm");
  const ftJ = buf.readUInt32LE(12);
  const ftB = buf.readUInt32LE(16);
  const btJ = buf.readUInt32LE(20);
  const btB = buf.readUInt32LE(24);
  const head = 28 + ftJ + ftB + btJ + btB;
  return { tables: buf.subarray(28, head), lengths: [ftJ, ftB, btJ, btB], glb: buf.subarray(head) };
}

function joinB3dm({ tables, lengths }, glb) {
  const header = Buffer.alloc(28);
  header.write("b3dm", 0, "latin1");
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(28 + tables.length + glb.length, 8);
  lengths.forEach((v, i) => header.writeUInt32LE(v, 12 + 4 * i));
  return Buffer.concat([header, tables, Buffer.from(glb)]);
}

// ---------------------------------------------------------------- tile worker

async function runWorker() {
  const { NodeIO, TextureInfo } = await import("@gltf-transform/core");
  const { KHRONOS_EXTENSIONS, KHRDracoMeshCompression } = await import("@gltf-transform/extensions");
  const draco3d = (await import("draco3dgltf")).default;
  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS).registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  });
  const { src, dst, opts } = workerData;

  const convert = async (input) => {
    const b3dm = splitB3dm(input);
    const doc = await io.readBinary(new Uint8Array(b3dm.glb));
    const root = doc.getRoot();
    for (const tex of root.listTextures()) {
      // DJI writes the non-standard "image/jpg".
      if (tex.getMimeType() === "image/jpg") tex.setMimeType("image/jpeg");
    }
    if (opts.mipmaps) {
      for (const mat of root.listMaterials()) {
        const info = mat.getBaseColorTextureInfo();
        if (!info) continue;
        info.setMinFilter(TextureInfo.MinFilter.LINEAR_MIPMAP_LINEAR);
        info.setMagFilter(TextureInfo.MagFilter.LINEAR);
      }
    }
    const draco =
      root.listExtensionsUsed().find((e) => e.extensionName === KHRDracoMeshCompression.EXTENSION_NAME) ??
      doc.createExtension(KHRDracoMeshCompression);
    draco.setRequired(true).setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
      encodeSpeed: opts.encodeSpeed,
      decodeSpeed: opts.decodeSpeed,
      quantizationBits: {
        POSITION: opts.qPosition,
        TEX_COORD: opts.qTexcoord,
        NORMAL: 10,
        COLOR: 8,
        GENERIC: 12,
      },
    });
    return joinB3dm(b3dm, await io.writeBinary(doc));
  };

  parentPort.on("message", async (job) => {
    if (job === null) return process.exit(0);
    const from = path.join(src, job);
    const to = path.join(dst, job);
    try {
      const input = fs.readFileSync(from);
      const output = await convert(input);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to + ".part", output);
      fs.renameSync(to + ".part", to);
      parentPort.postMessage({ job, before: input.length, after: output.length });
    } catch (e) {
      parentPort.postMessage({ job, error: String(e?.stack ?? e) });
    }
  });
  parentPort.postMessage({ ready: true });
}

// ---------------------------------------------------------------- tileset tree

/** 4x4 column-major multiply, as 3D Tiles stores transforms. */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/**
 * Loads a tileset with every external tileset inlined. Content URIs come back
 * relative to the source root, so the tree can be cut up again anywhere.
 */
function loadInlined(src, rel) {
  const doc = JSON.parse(fs.readFileSync(path.join(src, rel), "utf8"));
  const base = path.posix.dirname(rel.split(path.sep).join("/"));
  const fix = (node) => {
    const uri = node.content?.uri;
    if (uri) {
      const full = path.posix.normalize(base === "." ? uri : `${base}/${uri}`);
      if (full.endsWith(".json")) {
        const ext = loadInlined(src, full).root;
        // The external root stands in for this pointer tile. Both may carry a
        // transform; the pointer's applies first (it is the outer frame).
        if (node.transform && ext.transform) ext.transform = mul(node.transform, ext.transform);
        else if (node.transform) ext.transform = node.transform;
        if (node.children?.length) throw new Error(`pointer tile with children in ${rel}`);
        return ext;
      }
      node.content = { ...node.content, uri: full };
    }
    if (node.children) node.children = node.children.map(fix);
    return node;
  };
  doc.root = fix(doc.root);
  return doc;
}

const r3 = (v) => Math.round(v * 1000) / 1000;
// Half-axis components are rounded away from zero so a box never shrinks.
const up3 = (v) => Math.sign(v) * Math.ceil(Math.abs(v) * 1000) / 1000;

function compactVolume(bv) {
  if (bv.box) return { box: bv.box.map((v, i) => (i < 3 ? r3(v) : up3(v))) };
  if (bv.sphere) return { sphere: [r3(bv.sphere[0]), r3(bv.sphere[1]), r3(bv.sphere[2]), up3(bv.sphere[3])] };
  return bv;
}

/**
 * Writes a node for a tileset that lives in `dir` (posix, relative to the
 * output root). With `external` set, nodes at the split level are cut out into
 * their own tileset; inside a cut subtree it is null, so a split-level tile
 * nested under another (DJI's tree has those) stays inline rather than being
 * cut a second time.
 */
function emitNode(node, dir, splitLevel, external) {
  const out = { boundingVolume: compactVolume(node.boundingVolume), geometricError: Math.round(node.geometricError * 1e5) / 1e5 };
  if (node.refine) out.refine = node.refine;
  if (node.transform) out.transform = node.transform;
  const uri = node.content?.uri;
  const lvl = uri ? levelOf(uri) : null;
  if (external && lvl === splitLevel && node.children?.length) {
    // Cut here: the whole subtree becomes one external tileset beside its tiles.
    if (node.transform) throw new Error("transform below a block root");
    const tileDir = path.posix.dirname(uri);
    const name = `${tileDir}/t_${path.posix.basename(uri, ".b3dm")}.json`;
    external.push({ name, node });
    const rel = path.posix.relative(dir, name);
    return { boundingVolume: out.boundingVolume, geometricError: out.geometricError, refine: node.refine ?? "REPLACE", content: { uri: rel } };
  }
  if (uri) out.content = { uri: path.posix.relative(dir, uri) };
  if (node.children?.length) out.children = node.children.map((c) => emitNode(c, dir, splitLevel, external));
  return out;
}

/** Every tileset reachable from `root` must exist, and every tile it names. Returns what is missing. */
function missingLinks(dir, root) {
  const seen = new Set();
  const missing = [];
  const walk = (rel) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    const file = path.join(dir, rel);
    if (!fs.existsSync(file)) return missing.push(rel);
    const base = path.posix.dirname(rel);
    const visit = (n) => {
      const uri = n.content?.uri;
      if (uri) {
        const full = path.posix.normalize(base === "." ? uri : `${base}/${uri}`);
        if (full.endsWith(".json")) walk(full);
        else if (!fs.existsSync(path.join(dir, full))) missing.push(full);
      }
      (n.children ?? []).forEach(visit);
    };
    visit(JSON.parse(fs.readFileSync(file, "utf8")).root);
  };
  walk(root);
  return { tilesets: seen.size, missing };
}

function collectTiles(node, list = []) {
  const uri = node.content?.uri;
  if (uri && !uri.endsWith(".json")) list.push(uri);
  (node.children ?? []).forEach((c) => collectTiles(c, list));
  return list;
}

// ---------------------------------------------------------------- main

async function main() {
  const args = process.argv.slice(2);
  const flag = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : def;
  };
  const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
  const [src, dst] = positional;
  if (!src || !dst) throw new Error("usage: build-web-mesh-v2.mjs <web-mesh> <out> [--split-level 17] [--workers N] [--sample N]");
  const splitLevel = Number(flag("split-level", 17));
  const workers = Number(flag("workers", Math.max(1, os.cpus().length - 2)));
  const sample = flag("sample") ? Number(flag("sample")) : null;
  const opts = {
    mipmaps: flag("mipmaps", "on") !== "off",
    qPosition: Number(flag("q-position", 14)),
    qTexcoord: Number(flag("q-texcoord", 13)),
    encodeSpeed: Number(flag("encode-speed", 3)),
    decodeSpeed: Number(flag("decode-speed", 5)),
  };

  const t0 = Date.now();
  const tree = loadInlined(src, "tileset.json");
  let tiles = collectTiles(tree.root);
  console.log(`${tiles.length} tiles in the source tree (${((Date.now() - t0) / 1000).toFixed(1)} s to read the tilesets)`);

  if (sample) {
    const byLevel = new Map();
    for (const t of tiles) byLevel.set(levelOf(t), [...(byLevel.get(levelOf(t)) ?? []), t]);
    const per = Math.max(1, Math.ceil(sample / byLevel.size));
    tiles = [...byLevel.values()].flatMap((l) => l.filter((_, i) => i % Math.ceil(l.length / per) === 0).slice(0, per));
  }

  const todo = tiles.filter((t) => {
    const out = path.join(dst, t);
    return !fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(path.join(src, t)).mtimeMs;
  });
  console.log(`${todo.length} to convert with ${workers} workers (${tiles.length - todo.length} already done)`);

  let before = 0;
  let after = 0;
  let done = 0;
  const failed = [];
  const perLevel = new Map();
  await new Promise((resolve) => {
    if (!todo.length) return resolve();
    let next = 0;
    let alive = 0;
    const self = fileURLToPath(import.meta.url);
    for (let w = 0; w < Math.min(workers, todo.length); w++) {
      alive++;
      const worker = new Worker(self, { workerData: { src, dst, opts } });
      const feed = () => worker.postMessage(next < todo.length ? todo[next++] : null);
      worker.on("message", (m) => {
        if (m.ready) return feed();
        if (m.error) failed.push(m);
        else {
          before += m.before;
          after += m.after;
          const L = levelOf(m.job);
          const s = perLevel.get(L) ?? { n: 0, before: 0, after: 0 };
          s.n++;
          s.before += m.before;
          s.after += m.after;
          perLevel.set(L, s);
        }
        done++;
        if (done % 500 === 0 || done === todo.length)
          console.log(`  ${done}/${todo.length}  ${(before / 1e6).toFixed(0)} MB -> ${(after / 1e6).toFixed(0)} MB  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
        feed();
      });
      worker.on("exit", () => --alive === 0 && resolve());
      worker.on("error", (e) => failed.push({ job: "worker", error: String(e) }));
    }
  });

  for (const [L, s] of [...perLevel].sort((a, b) => a[0] - b[0]))
    console.log(`  L${L}: ${s.n} tiles, avg ${(s.before / s.n / 1024).toFixed(0)} KB -> ${(s.after / s.n / 1024).toFixed(0)} KB (${((1 - s.after / s.before) * 100).toFixed(0)}% smaller)`);
  if (before) console.log(`converted: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB (${((1 - after / before) * 100).toFixed(0)}% smaller)`);
  if (failed.length) {
    console.error(`${failed.length} failed, first: ${failed[0].job}\n${failed[0].error}`);
    process.exitCode = 1;
  }
  if (sample) return;
  if (failed.length) return console.error("tilesets not written because some tiles failed; re-run to retry them");

  // Tilesets: one root, one external tileset per subtree at the split level.
  const external = [];
  const asset = tree.asset;
  const rootOut = { asset, geometricError: tree.geometricError, root: emitNode(tree.root, ".", splitLevel, external) };
  const write = (name, doc) => {
    const file = path.join(dst, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(doc));
    return fs.statSync(file).size;
  };
  let jsonBytes = write("tileset.json", rootOut);
  for (const { name, node } of external) {
    const dir = path.posix.dirname(name);
    jsonBytes += write(name, { asset, geometricError: node.geometricError, root: emitNode(node, dir, splitLevel, null) });
  }
  console.log(`tilesets: 1 root (${(fs.statSync(path.join(dst, "tileset.json")).size / 1024).toFixed(0)} KB) + ${external.length} subtrees, ${(jsonBytes / 1e6).toFixed(2)} MB total`);
  const links = missingLinks(dst, "tileset.json");
  if (links.missing.length) {
    console.error(`BROKEN: ${links.missing.length} referenced files missing, e.g. ${links.missing.slice(0, 5).join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`links checked: ${links.tilesets} tilesets, every referenced file present`);
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${dst}`);
}

if (isMainThread) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
else runWorker();
