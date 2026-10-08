/**
 * The /navigate 3D tab on a 2 GB Android phone: how fast it shows, how much
 * memory it holds while the user explores, and how fast a reload is.
 *
 * Emulates a cheap phone (360x780 CSS px at 2x, touch, navigator.deviceMemory 2,
 * CPU slowed 6x, 4G at 9 Mbit/s and 170 ms) and counts memory the page itself
 * cannot report:
 *  - GPU: every texture, buffer and renderbuffer WebGL allocates, by wrapping
 *    the WebGL calls (plus the canvas's own drawing buffer);
 *  - decoded images: every ImageBitmap (the tiles' photos, decoded on the CPU
 *    and kept alongside their GPU copy) until it is closed or collected.
 * A 2 GB phone has roughly 300-500 MB for one tab before Chrome kills it (the
 * page then reloads), so GPU + bitmaps + JS heap is the number to keep low.
 *
 *   node tools/drone/lowend-mobile.mjs [--app http://localhost:5000] [--mem 2] [--cpu 6]
 *     [--down 9] [--rtt 170] [--no-reload] [--label before] [--shots dir] [--timeline] [--cold-only]
 *
 * --device desktop: a laptop instead (1536x864 at 1.25x, mouse, deviceMemory 8,
 * no CPU or network throttling unless asked). The cold load is the whole-campus
 * view; "full view" is when it has loaded at the base detail, "sharp" when it
 * has finished sharpening, and --score adds the Laplacian contrast of that
 * sharp view (higher = sharper).
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const app = flag("app", "http://localhost:5000");
const desktop = flag("device", "phone") === "desktop";
const deviceMemory = Number(flag("mem", desktop ? 8 : 2));
const cpu = Number(flag("cpu", desktop ? 1 : 6));
// 0: no network throttling.
const downMbit = Number(flag("down", desktop ? 0 : 9));
const rtt = Number(flag("rtt", desktop ? 0 : 170));
const label = flag("label", "");
const shots = flag("shots", "");
const reload = !args.includes("--no-reload");
const query = flag("query", "view=3d");

/** Runs in the page before any of its scripts. */
function instrument(deviceMemory) {
  Object.defineProperty(Navigator.prototype, "deviceMemory", { get: () => deviceMemory, configurable: true });
  const m = { tex: 0, buf: 0, rb: 0, bitmaps: 0, peakGpu: 0, peakBitmaps: 0, peakSum: 0, firstPicture: null, textures: 0 };
  window.__mem = m;
  const peak = () => {
    const gpu = m.tex + m.buf + m.rb;
    m.peakGpu = Math.max(m.peakGpu, gpu);
    m.peakBitmaps = Math.max(m.peakBitmaps, m.bitmaps);
    m.peakSum = Math.max(m.peakSum, gpu + m.bitmaps);
  };
  // Bytes per texel for the formats three.js uses; 4 for anything else.
  const BPP = { 0x8051: 3, 0x1907: 3, 0x8058: 4, 0x1908: 4, 0x8c43: 4, 0x881a: 8, 0x8814: 16, 0x822e: 4, 0x8229: 1, 0x1909: 1, 0x81a6: 3, 0x88f0: 4, 0x8cac: 4 };
  const bpp = (f) => BPP[f] ?? 4;
  const sizes = new WeakMap();
  const state = new WeakMap();
  const st = (gl) => {
    let s = state.get(gl);
    if (!s) state.set(gl, (s = { unit: 0x84c0, tex: new Map(), buf: new Map(), rb: null }));
    return s;
  };
  const setSize = (obj, kind, bytes) => {
    if (!obj) return;
    const old = sizes.get(obj) ?? 0;
    sizes.set(obj, bytes);
    m[kind] += bytes - old;
    peak();
  };
  const freeSize = (obj, kind) => {
    if (!obj || !sizes.has(obj)) return;
    m[kind] -= sizes.get(obj);
    sizes.delete(obj);
  };
  const boundTex = (gl, target) => st(gl).tex.get(`${st(gl).unit}:${target >= 0x8515 && target <= 0x851a ? 0x8513 : target}`);
  for (const C of [WebGLRenderingContext, typeof WebGL2RenderingContext !== "undefined" ? WebGL2RenderingContext : null]) {
    if (!C) continue;
    const p = C.prototype;
    const o = {};
    for (const k of ["activeTexture", "bindTexture", "texImage2D", "texStorage2D", "compressedTexImage2D", "generateMipmap", "deleteTexture", "bindBuffer", "bufferData", "deleteBuffer", "bindRenderbuffer", "renderbufferStorage", "renderbufferStorageMultisample", "deleteRenderbuffer"])
      if (p[k]) o[k] = p[k];
    p.activeTexture = function (u) {
      st(this).unit = u;
      return o.activeTexture.call(this, u);
    };
    p.bindTexture = function (t, tex) {
      st(this).tex.set(`${st(this).unit}:${t}`, tex);
      return o.bindTexture.call(this, t, tex);
    };
    p.texStorage2D = function (t, levels, f, w, h) {
      let b = 0;
      for (let l = 0; l < levels; l++) b += Math.max(1, w >> l) * Math.max(1, h >> l) * bpp(f);
      setSize(boundTex(this, t), "tex", b * (t === 0x8513 ? 6 : 1));
      if (w >= 64) {
        m.textures++;
        m.firstPicture ??= performance.now();
      }
      return o.texStorage2D.apply(this, arguments);
    };
    p.texImage2D = function (t, level, f, a, b2) {
      // (target, level, internalformat, width, height, border, format, type, pixels) or (target, level, internalformat, format, type, source)
      const src = arguments.length === 6 ? arguments[5] : null;
      const w = src ? src.width ?? src.videoWidth ?? 0 : a;
      const h = src ? src.height ?? src.videoHeight ?? 0 : b2;
      const tex = boundTex(this, t);
      if (level === 0) {
        setSize(tex, "tex", w * h * bpp(f) * (t >= 0x8515 && t <= 0x851a ? 6 : 1));
        if (w >= 64) {
          m.textures++;
          m.firstPicture ??= performance.now();
        }
      } else if (tex) setSize(tex, "tex", (sizes.get(tex) ?? 0) + w * h * bpp(f));
      return o.texImage2D.apply(this, arguments);
    };
    p.compressedTexImage2D = function (t, level, f, w, h, border, data) {
      const tex = boundTex(this, t);
      const bytes = data?.byteLength ?? 0;
      setSize(tex, "tex", (level === 0 ? 0 : sizes.get(tex) ?? 0) + bytes);
      return o.compressedTexImage2D.apply(this, arguments);
    };
    p.generateMipmap = function (t) {
      const tex = boundTex(this, t);
      if (tex && !tex.__mips) {
        tex.__mips = true;
        setSize(tex, "tex", Math.round((sizes.get(tex) ?? 0) * 4 / 3));
      }
      return o.generateMipmap.call(this, t);
    };
    p.deleteTexture = function (tex) {
      freeSize(tex, "tex");
      return o.deleteTexture.call(this, tex);
    };
    p.bindBuffer = function (t, b) {
      st(this).buf.set(t, b);
      return o.bindBuffer.call(this, t, b);
    };
    p.bufferData = function (t, data, usage, srcOffset, length) {
      const bytes = typeof data === "number" ? data : length ? length * (data.BYTES_PER_ELEMENT ?? 1) : data?.byteLength ?? 0;
      setSize(st(this).buf.get(t), "buf", bytes);
      return o.bufferData.apply(this, arguments);
    };
    p.deleteBuffer = function (b) {
      freeSize(b, "buf");
      return o.deleteBuffer.call(this, b);
    };
    p.bindRenderbuffer = function (t, rb) {
      st(this).rb = rb;
      return o.bindRenderbuffer.call(this, t, rb);
    };
    p.renderbufferStorage = function (t, f, w, h) {
      setSize(st(this).rb, "rb", w * h * bpp(f));
      return o.renderbufferStorage.apply(this, arguments);
    };
    if (o.renderbufferStorageMultisample)
      p.renderbufferStorageMultisample = function (t, samples, f, w, h) {
        setSize(st(this).rb, "rb", w * h * bpp(f) * Math.max(1, samples));
        return o.renderbufferStorageMultisample.apply(this, arguments);
      };
    p.deleteRenderbuffer = function (rb) {
      freeSize(rb, "rb");
      return o.deleteRenderbuffer.call(this, rb);
    };
  }
  // Decoded images: counted from creation until close() or garbage collection.
  const live = new WeakMap();
  const gone = new FinalizationRegistry((bytes) => {
    m.bitmaps -= bytes;
  });
  const create = window.createImageBitmap;
  window.createImageBitmap = function () {
    return create.apply(this, arguments).then((bmp) => {
      const bytes = bmp.width * bmp.height * 4;
      live.set(bmp, bytes);
      gone.register(bmp, bytes, bmp);
      m.bitmaps += bytes;
      peak();
      return bmp;
    });
  };
  const close = ImageBitmap.prototype.close;
  ImageBitmap.prototype.close = function () {
    const bytes = live.get(this);
    if (bytes !== undefined) {
      live.delete(this);
      gone.unregister(this);
      m.bitmaps -= bytes;
    }
    return close.call(this);
  };
}

const MB = (b) => `${(b / 1048576).toFixed(0)} MB`;

const browser = await puppeteer.launch({
  executablePath: flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--js-flags=--expose-gc"],
});
const page = await browser.newPage();
if (desktop) await page.setViewport({ width: 1536, height: 864, deviceScaleFactor: 1.25 });
else
  await page.emulate({
    userAgent:
      "Mozilla/5.0 (Linux; Android 12; SM-A035F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
    viewport: { width: 360, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  });
await page.evaluateOnNewDocument(instrument, deviceMemory);
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
if (downMbit > 0)
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: rtt,
    downloadThroughput: (downMbit * 1e6) / 8,
    uploadThroughput: (2 * 1e6) / 8,
  });
let bytes = { app: 0, cdn: 0, requests: 0 };
const urls = new Map();
// Request start and end (CDP monotonic seconds), for --timeline.
const timeline = [];
const started = new Map();
cdp.on("Network.requestWillBeSent", (e) => {
  urls.set(e.requestId, e.request.url);
  started.set(e.requestId, { url: e.request.url, method: e.request.method, start: e.timestamp });
});
cdp.on("Network.loadingFinished", (e) => {
  const url = urls.get(e.requestId) ?? "";
  bytes.requests++;
  if (url.startsWith(app)) bytes.app += e.encodedDataLength;
  else bytes.cdn += e.encodedDataLength;
  const s = started.get(e.requestId);
  if (s) timeline.push({ ...s, end: e.timestamp, bytes: e.encodedDataLength });
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text().slice(0, 200));
});
if (cpu > 1) await page.emulateCPUThrottling(cpu);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Waits until the tab shows no loading or sharpening message for 3 s; returns the seconds waited. */
async function settle(maxSeconds = 90) {
  const t0 = Date.now();
  for (let idle = 0; idle < 12 && Date.now() - t0 < maxSeconds * 1000; ) {
    await sleep(250);
    const busy = await page.evaluate(
      () => !document.querySelector("canvas") || /Loading drone survey|Sharpening|Opening the drone view/.test(document.body.innerText)
    );
    idle = busy ? 0 : idle + 1;
  }
  return (Date.now() - t0) / 1000 - 3;
}
async function memory() {
  return page.evaluate(() => {
    const m = window.__mem;
    const c = document.querySelector("canvas");
    const gl = c?.getContext("webgl2") ?? c?.getContext("webgl");
    const aa = gl?.getContextAttributes()?.antialias;
    // Drawing buffer: colour + depth/stencil, times 4 samples with MSAA, plus the resolved colour.
    const px = c ? c.width * c.height : 0;
    const canvasBytes = px * (aa ? 8 * 4 + 4 : 8);
    return {
      gpu: m.tex + m.buf + m.rb + canvasBytes,
      tex: m.tex,
      buf: m.buf,
      canvas: canvasBytes,
      canvasSize: c ? `${c.width}x${c.height}${aa ? " MSAA" : ""}` : "",
      bitmaps: m.bitmaps,
      peakGpu: m.peakGpu + canvasBytes,
      peakBitmaps: m.peakBitmaps,
      peakSum: m.peakSum + canvasBytes,
      heap: performance.memory?.usedJSHeapSize ?? 0,
      firstPicture: m.firstPicture,
      textures: m.textures,
    };
  });
}
async function click(labelText) {
  const ok = await page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label") === t || x.title === t);
    b?.click();
    return Boolean(b);
  }, labelText);
  if (!ok) console.warn(`  (no button "${labelText}")`);
}
async function swipe(dx, dy) {
  const box = await (await page.$("canvas")).boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.55;
  if (desktop) {
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(x + (dx * i) / 12, y + (dy * i) / 12);
      await sleep(30);
    }
    await page.mouse.up();
    return;
  }
  await page.touchscreen.touchStart(x, y);
  for (let i = 1; i <= 12; i++) {
    await page.touchscreen.touchMove(x + (dx * i) / 12, y + (dy * i) / 12);
    await sleep(30);
  }
  await page.touchscreen.touchEnd();
}
async function shot(name) {
  if (!shots) return;
  fs.mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: path.join(shots, `${label || "run"}-${name}.png`) });
}

console.log(
  `${label ? `[${label}] ` : ""}${app}/navigate?${query}  ${desktop ? "desktop" : "phone"}, deviceMemory ${deviceMemory}, CPU /${cpu}, ${downMbit ? `${downMbit} Mbit/s ${rtt} ms` : "network as is"}`
);
/** Seconds from t0 until the poster shows, the whole view has loaded at base detail, and it has finished sharpening. */
async function watchLoad(t0, maxSeconds = 150) {
  let full = null;
  let poster = null;
  let seenLoading = false;
  let idle = 0;
  let lastBusy = Date.now();
  while (idle < 30 && Date.now() - t0 < maxSeconds * 1000) {
    await sleep(100);
    const state = await page.evaluate(() => {
      const t = document.body.innerText;
      if (document.querySelector("picture img")?.style.opacity === "1") return "poster";
      if (!document.querySelector("canvas") || /Opening the drone view/.test(t)) return "start";
      return /Loading drone survey/.test(t) ? "loading" : /Sharpening/.test(t) ? "sharpening" : "idle";
    });
    if (state === "poster") poster ??= (Date.now() - t0) / 1000;
    if (state === "loading") seenLoading = true;
    if (full === null && seenLoading && (state === "sharpening" || state === "idle")) full = (Date.now() - t0) / 1000;
    // The poster is the sharp view until the camera moves (the mesh loads behind it).
    if (state === "idle" || state === "poster") idle++;
    else {
      idle = 0;
      lastBusy = Date.now();
    }
  }
  return { full, poster, sharp: (lastBusy - t0) / 1000 };
}
async function sharpness(file) {
  const { default: sharp } = await import("sharp");
  const meta = await sharp(file).metadata();
  // The 3D area, clear of the side buttons and the views bar.
  const box = desktop
    ? { left: Math.round(meta.width * 0.25), top: Math.round(meta.height * 0.25), width: Math.round(meta.width * 0.65), height: Math.round(meta.height * 0.55) }
    : { left: 130, top: 420, width: 560, height: 900 };
  const { data, info } = await sharp(file).extract(box).greyscale().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  let s1 = 0, s2 = 0, n = 0;
  for (let y = 1; y < info.height - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const l = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      s1 += l;
      s2 += l * l;
      n++;
    }
  return Math.sqrt(s2 / n - (s1 / n) ** 2);
}

// 1. Cold load.
const t0 = Date.now();
await page.goto(`${app}/navigate?${query}`, { waitUntil: "domcontentloaded", timeout: 300000 });
const navStart = await page.evaluate(() => performance.timeOrigin);
const load = await watchLoad(t0);
let m = await memory();
console.log(
  `cold load: first picture ${m.firstPicture ? ((navStart + m.firstPicture - t0) / 1000).toFixed(1) : "-"} s, sharp poster ${load.poster?.toFixed(1) ?? "-"} s, full view ${load.full?.toFixed(1) ?? "-"} s, sharp ${load.sharp.toFixed(1)} s` +
    ` | downloaded app ${MB(bytes.app)}, tiles ${MB(bytes.cdn)} (${bytes.requests} requests)`
);
console.log(`  memory: GPU ${MB(m.gpu)} (textures ${MB(m.tex)}, geometry ${MB(m.buf)}, canvas ${m.canvasSize} ${MB(m.canvas)}), decoded images ${MB(m.bitmaps)}, JS heap ${MB(m.heap)}`);
if (args.includes("--timeline")) {
  // What the first picture waited for: each request's start and end, from the page request.
  const t = [...timeline].sort((a, b) => a.start - b.start);
  const origin = t[0]?.start ?? 0;
  const firstTile = t.find((r) => /\.b3dm/.test(r.url));
  for (const r of t) {
    const tile = /\.b3dm/.test(r.url);
    if (tile && r !== firstTile) continue;
    if (r.start - origin > (firstTile ? firstTile.end - origin + 0.5 : 10)) break;
    const name = r.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 70);
    console.log(`  ${(r.start - origin).toFixed(2).padStart(6)} -> ${(r.end - origin).toFixed(2).padStart(6)} s  ${String(Math.round(r.bytes / 1024)).padStart(5)} KB  ${r.method === "GET" ? "" : r.method + " "}${name}`);
  }
  console.log(`  first picture (first tile photo on the GPU) at ${m.firstPicture ? (m.firstPicture / 1000).toFixed(2) : "-"} s after the page started`);
}
await shot("1-cold");
if (args.includes("--score")) {
  const file = path.join(shots || process.env.TEMP || ".", `${label || "run"}-score.png`);
  await page.screenshot({ path: file });
  console.log(`  sharpness of the whole view: ${(await sharpness(file)).toFixed(1)}`);
}

if (args.includes("--cold-only")) {
  await browser.close();
  process.exit(0);
}

// 2. Explore: zoom in, swipe around, turn, street level, back to the campus.
const steps = [
  ["zoom in", () => click("Zoom in")],
  ["zoom in", () => click("Zoom in")],
  ["swipe left", () => swipe(-220, 0)],
  ["swipe up", () => swipe(0, -260)],
  ["swipe right", () => swipe(240, 40)],
  ["turn right", () => click("Turn right")],
  ["street view", () => click("From the ground, looking up at it")],
  ["swipe down", () => swipe(0, 200)],
  ["whole campus", () => click("Whole campus")],
];
const t1 = Date.now();
let worstStep = 0;
for (const [name, act] of steps) {
  await act();
  const s = await settle(60);
  worstStep = Math.max(worstStep, s);
  const now = await memory();
  console.log(`  ${name.padEnd(13)} settled ${s.toFixed(1).padStart(5)} s  GPU ${MB(now.gpu).padStart(7)}  images ${MB(now.bitmaps).padStart(7)}  heap ${MB(now.heap).padStart(6)}`);
}
m = await memory();
await shot("2-explored");
console.log(
  `explore: ${((Date.now() - t1) / 1000).toFixed(0)} s, slowest step ${worstStep.toFixed(1)} s` +
    ` | PEAK GPU ${MB(m.peakGpu)}, PEAK decoded images ${MB(m.peakBitmaps)}, PEAK GPU+images ${MB(m.peakSum)}, JS heap now ${MB(m.heap)}`
);

// 3. Reload (what a phone does after Chrome dropped the tab, or the user pulls to refresh).
if (reload) {
  bytes = { app: 0, cdn: 0, requests: 0 };
  const t2 = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 300000 });
  const navStart2 = await page.evaluate(() => performance.timeOrigin);
  await settle(150);
  const r = await memory();
  console.log(
    `reload: first picture ${r.firstPicture ? ((navStart2 + r.firstPicture - t2) / 1000).toFixed(1) : "-"} s, settled ${((Date.now() - t2) / 1000).toFixed(1)} s` +
      ` | downloaded app ${MB(bytes.app)}, tiles ${MB(bytes.cdn)} (${bytes.requests} requests)`
  );
  await shot("3-reload");
}
if (errors.length) console.log(`page errors (${errors.length}):\n  ${[...new Set(errors)].slice(0, 8).join("\n  ")}`);
await browser.close();
