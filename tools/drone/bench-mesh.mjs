/**
 * Drone mesh load benchmark: how long until the 3D view is fully sharp on a
 * low-end phone over Indian mobile data, for each mesh build.
 *
 * Needs the dev server (`/dev-mesh-bench`) and mesh-server.mjs running:
 *   node tools/drone/mesh-server.mjs --port 5443 v1="E:/BIT 3D/_work/web-mesh" v2="E:/BIT 3D/_work/web-mesh-v2"
 *   node tools/drone/bench-mesh.mjs --meshes v1,v2 [--building "AS Block"] [--cpu 4] [--latency 150] [--mbps 12]
 *
 * Every scenario runs in a fresh incognito context (empty HTTP cache):
 *   open-3d      the /navigate 3D tab's opening campus view
 *   then-zoom    from that settled view, fly to a building (coarse tiles cached)
 *   building     straight to the building (a deep link, nothing cached)
 *   revisit      the building again after reopening the page (HTTP cache warm)
 * A mesh may carry a loader tweak: --meshes v2,v2@ancestors (see app/dev-mesh-bench).
 * "sharp" = every tile the view needs at the app's error target is on screen
 * and nothing is left queued, downloading or parsing (held for 1.5 s).
 */
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const app = flag("app", "http://localhost:5000");
const host = flag("host", "https://localhost:5443");
const meshes = flag("meshes", "v1,v2").split(",");
const building = flag("building", "AS Block");
const cpu = Number(flag("cpu", 4));
const latency = Number(flag("latency", 150));
const mbps = Number(flag("mbps", 12));
const chrome = flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const scenarios = flag("scenarios", "open-3d,then-zoom,building").split(",");
const timeoutMs = Number(flag("timeout", 180000));
// phone: 412x915 @2x with touch; desktop: 1280x800 @1x mouse.
const viewport =
  flag("viewport", "phone") === "desktop"
    ? { width: 1280, height: 800, deviceScaleFactor: 1, isMobile: false, hasTouch: false }
    : { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--ignore-certificate-errors", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--no-first-run"],
});

/** "v2@ancestors+warm" = the v2 folder with those tweaks (see app/dev-mesh-bench). */
const benchUrl = (spec) => {
  const [mesh, tweak = ""] = spec.split("@");
  return `${app}/dev-mesh-bench?${new URLSearchParams({ host, mesh, tweak: tweak.split("+").join(",") })}`;
};

async function load(page, mesh) {
  await page.goto(benchUrl(mesh), { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction(() => window.__bench?.ready, { timeout: 300000 });
  // `prewarm`: the user spent a moment on the 2D map, which warms the cache.
  if (mesh.split("@")[1]?.split("+").includes("prewarm")) await page.evaluate(() => window.__bench.warm());
}

async function openPage(mesh) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  // `nothermal`: as if DroneMesh fetched the thermal overlay only when it is switched on.
  if (mesh.split("@")[1]?.split("+").includes("nothermal")) {
    await page.setRequestInterception(true);
    page.on("request", (r) => (/thermal-as-ib\.webp/.test(r.url()) ? r.abort() : r.continue()));
  }
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await load(page, mesh);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  // Throttle only now: the dev page's own JS is not part of what we measure.
  await page.emulateCPUThrottling(cpu);
  await page.emulateNetworkConditions({ download: (mbps * 1e6) / 8, upload: (3 * 1e6) / 8, latency });
  return { ctx, page, errors, gpu };
}

async function settle(page, t0) {
  let firstVisible = null;
  let stableSince = null;
  const timeline = [];
  // "half": when half of the finished view's tiles were already on screen.
  const half = (snap) => timeline.find((p) => p.visible >= snap.visible / 2)?.at ?? null;
  while (true) {
    const s = await page.evaluate(() => window.__bench.snapshot());
    const elapsed = s.now - t0;
    timeline.push({ at: elapsed, visible: s.visible });
    if (s.visible > 0 && firstVisible === null) firstVisible = elapsed;
    const done = s.rootReady && s.pending === 0 && s.visible > 0;
    if (done) {
      stableSince ??= elapsed;
      if (elapsed - stableSince >= 1500) return { firstVisible, half: half(s), sharp: stableSince, snap: s };
    } else stableSince = null;
    if (elapsed > timeoutMs) return { firstVisible, half: half(s), sharp: null, snap: s };
    await new Promise((r) => setTimeout(r, 100));
  }
}

const rows = [];
const record = (mesh, scenario, r, base = { requests: 0, jsonRequests: 0, bytes: 0 }) =>
  rows.push({
    mesh,
    scenario,
    "first tile (s)": r.firstVisible === null ? "-" : (r.firstVisible / 1000).toFixed(1),
    "half sharp (s)": r.half === null ? "-" : (r.half / 1000).toFixed(1),
    "fully sharp (s)": r.sharp === null ? `>${timeoutMs / 1000}` : (r.sharp / 1000).toFixed(1),
    MB: ((r.snap.bytes - base.bytes) / 1e6).toFixed(1),
    requests: r.snap.requests - base.requests,
    "json requests": r.snap.jsonRequests - base.jsonRequests,
    "tiles on screen": r.snap.visible,
  });

const runs = Number(flag("runs", 1));
console.log(`profile: CPU ${cpu}x slower, ${mbps} Mbit/s down, ${latency} ms latency, ${viewport.width}x${viewport.height} @${viewport.deviceScaleFactor}x viewport; building "${building}"; ${runs} run(s)`);
// Alternate the order between runs so neither build always goes first.
const order = Array.from({ length: runs }, (_, i) => (i % 2 ? [...meshes].reverse() : meshes)).flat();
for (const mesh of order) {
  if (scenarios.includes("open-3d") || scenarios.includes("then-zoom")) {
    const { ctx, page, errors, gpu } = await openPage(mesh);
    if (mesh === meshes[0]) console.log(`GPU: ${gpu}`);
    const t0 = await page.evaluate(() => (window.__bench.start("home"), performance.now()));
    const home = await settle(page, t0);
    record(mesh, "open-3d", home);
    if (scenarios.includes("then-zoom")) {
      const t1 = await page.evaluate((b) => (window.__bench.pose(`b:${b}`), performance.now()), building);
      const zoom = await settle(page, t1);
      record(mesh, "then-zoom", zoom, home.snap);
    }
    if (errors.length) console.log(`  ${mesh} page errors: ${errors.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
  if (scenarios.includes("building") || scenarios.includes("revisit")) {
    const { ctx, page, errors } = await openPage(mesh);
    const t0 = await page.evaluate((b) => (window.__bench.start(`b:${b}`), performance.now()), building);
    const first = await settle(page, t0);
    if (scenarios.includes("building")) record(mesh, "building", first);
    if (scenarios.includes("revisit")) {
      // Same browser profile, page opened again: what a returning student gets
      // from the HTTP cache alone (tiles are immutable, JSON max-age 1 h).
      await load(page, mesh);
      const t1 = await page.evaluate((b) => (window.__bench.start(`b:${b}`), performance.now()), building);
      record(mesh, "revisit", await settle(page, t1));
    }
    if (errors.length) console.log(`  ${mesh} page errors: ${errors.slice(0, 3).join(" | ")}`);
    await ctx.close();
  }
}
console.table(rows);
if (runs > 1) {
  // Median per build and scenario.
  const med = (xs) => {
    const s = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
  };
  const summary = [];
  for (const mesh of meshes)
    for (const scenario of new Set(rows.map((r) => r.scenario))) {
      const rs = rows.filter((r) => r.mesh === mesh && r.scenario === scenario);
      if (!rs.length) continue;
      summary.push({
        mesh,
        scenario,
        "median first tile (s)": med(rs.map((r) => Number(r["first tile (s)"]))),
        "median half sharp (s)": med(rs.map((r) => Number(r["half sharp (s)"]))),
        "median fully sharp (s)": med(rs.map((r) => Number(r["fully sharp (s)"]))),
        "median MB": med(rs.map((r) => Number(r.MB))),
        "json requests": med(rs.map((r) => r["json requests"])),
      });
    }
  console.table(summary);
}
await browser.close();
