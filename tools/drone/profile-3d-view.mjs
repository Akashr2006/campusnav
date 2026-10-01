/**
 * Where the /navigate 3D tab spends main-thread time while the user drags the
 * view, on a CPU slowed like a low-end phone. Prints fps and the functions
 * with the most self time (V8 CPU profile).
 *
 *   node tools/drone/profile-3d-view.mjs [--cpu 4] [--app http://localhost:5000] [--query viewer=studio --settle-seconds 20]
 */
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const app = flag("app", "http://localhost:5000");
const cpu = Number(flag("cpu", 4));
// Extra query, e.g. "viewer=studio" for the previous 3D view; and a minimum wait
// before the drag, for a viewer that shows no loading indicator.
const query = flag("query", "");
const minSettle = Number(flag("settle-seconds", 0));
// Which mouse button drags: left pans the new viewer (orbits the old one), right orbits the new one.
const button = flag("button", "left");

const browser = await puppeteer.launch({
  executablePath: flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 820, deviceScaleFactor: 1 });
await page.goto(`${app}/navigate?view=3d${query ? `&${query}` : ""}`, { waitUntil: "domcontentloaded", timeout: 300000 });
await page.waitForSelector("canvas", { timeout: 120000 });
await new Promise((r) => setTimeout(r, minSettle * 1000));
// Let the first view load and sharpen completely, so the profile is about interaction.
for (let idle = 0, i = 0; i < 400 && idle < 12; i++) {
  await new Promise((r) => setTimeout(r, 250));
  const busy = await page.evaluate(() => /Loading drone survey|Sharpening/.test(document.body.innerText));
  idle = busy ? 0 : idle + 1;
}
const box = await (await page.$("canvas")).boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const session = await page.createCDPSession();
await page.emulateCPUThrottling(cpu);
await session.send("Profiler.enable");
await session.send("Profiler.setSamplingInterval", { interval: 200 });
await page.evaluate(() => {
  window.__frames = [];
  const tick = (t) => {
    window.__frames.push(t);
    if (window.__frames.length < 3000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await session.send("Profiler.start");
if (button === "none") {
  // Camera still: what drawing the settled view costs, with no loading.
  await new Promise((r) => setTimeout(r, 3200));
} else {
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button });
  for (let i = 0; i < 80; i++) {
    await page.mouse.move(cx + Math.sin(i / 7) * 180, cy + Math.cos(i / 7) * 70);
    await new Promise((r) => setTimeout(r, 40));
  }
  await page.mouse.up({ button });
}
const { profile } = await session.send("Profiler.stop");
const fps = await page.evaluate(() => {
  const f = window.__frames;
  const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
  return { fps: (1000 * (f.length - 1)) / (f[f.length - 1] - f[0]), p95: gaps[Math.floor(gaps.length * 0.95)] };
});

// Self time per function from the sampled profile.
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const f = n.callFrame;
  const file = (f.url.split("/").pop() || "(native)").split("?")[0];
  const key = `${f.functionName || "(anonymous)"}  ${file}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
});
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`CPU ${cpu}x slower, dragging: ${fps.fps.toFixed(0)} fps, 95th percentile frame ${fps.p95.toFixed(0)} ms`);
for (const [k, us] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 22)) console.log(`${((100 * us) / total).toFixed(1).padStart(5)}%  ${k}`);
await browser.close();
