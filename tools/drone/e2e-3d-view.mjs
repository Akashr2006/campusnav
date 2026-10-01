/**
 * End-to-end check of the /navigate 3D tab in headless Chrome: load, sharpen,
 * mouse navigation (wheel zoom to cursor, drag, right-drag), click a building
 * for its place card, pick one in the sidebar and fly there. Screenshots go to
 * --out; any page error fails the run.
 *
 *   node tools/drone/e2e-3d-view.mjs --out <dir> [--app http://localhost:5000] [--viewport desktop|phone]
 */
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const app = flag("app", "http://localhost:5000");
const out = flag("out", ".");
const phone = flag("viewport", "desktop") === "phone";
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
await page.setViewport(phone ? { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1366, height: 820, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));

const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`  shot ${name}.png`);
};
const status = () => page.evaluate(() => document.body.innerText.match(/Loading drone survey[^\n]*|Sharpening detail[^\n]*/)?.[0] ?? "idle");
const settle = async (label, maxS = 60) => {
  const t0 = Date.now();
  let idle = 0;
  while (Date.now() - t0 < maxS * 1000) {
    await new Promise((r) => setTimeout(r, 250));
    idle = (await status()) === "idle" ? idle + 1 : 0;
    if (idle >= 8) break;
  }
  console.log(`${label}: settled in ${((Date.now() - t0) / 1000 - 2).toFixed(1)} s`);
};
const canvasBox = async () => (await page.$("canvas")).boundingBox();
const camera = () =>
  page.evaluate(() => {
    // The camera is not exposed; read it through the label layer's projection instead.
    return null;
  });

const t0 = Date.now();
await page.goto(`${app}/navigate?view=3d`, { waitUntil: "domcontentloaded", timeout: 300000 });
await page.waitForSelector("canvas", { timeout: 120000 });
console.log(`canvas up after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await settle("open 3D (load + sharpen)", 90);
await shot("01-open");

const box = await canvasBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

// Wheel-zoom toward a point left of centre: the view should move toward it, not toward the centre.
await page.mouse.move(cx - box.width * 0.18, cy + box.height * 0.05);
for (let i = 0; i < 10; i++) {
  await page.mouse.wheel({ deltaY: -240 });
  await new Promise((r) => setTimeout(r, 60));
}
await settle("wheel zoom to cursor", 60);
await shot("02-zoomed");

// Drag to pan.
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 220, cy + 60, { steps: 20 });
await page.mouse.up();
await settle("drag pan", 60);
await shot("03-panned");

// Right-drag to turn around the point under the pointer.
await page.mouse.move(cx, cy);
await page.mouse.down({ button: "right" });
await page.mouse.move(cx + 260, cy - 40, { steps: 25 });
await page.mouse.up({ button: "right" });
await settle("right-drag rotate", 60);
await shot("04-rotated");

// Click the middle of the view: a building there should open its place card.
await page.mouse.click(cx, cy);
await new Promise((r) => setTimeout(r, 800));
const card = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Route");
  return btn ? btn.closest("div.p-4")?.querySelector("div")?.innerText.split("\n")[0] ?? "card" : null;
});
console.log(`click in the middle -> place card: ${card ?? "(none: ground or unnamed)"}`);
await shot("05-clicked");

// Sidebar: choose a building, the camera should fly there.
const picked = await page.evaluate(() => {
  const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => /Central Hall/.test(o.text)));
  if (!sel) return null;
  const opt = [...sel.options].find((o) => /Central Hall/.test(o.text));
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
  setter.call(sel, opt.value);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return opt.text;
});
console.log(`sidebar pick: ${picked ?? "(building select not found)"}`);
await new Promise((r) => setTimeout(r, 2500));
await settle("fly to + sharpen", 60);
await shot("06-flown");

// Close the card, then click the building in the middle of the view: its card should open.
await page.click('button[aria-label="Close"]').catch(() => {});
await new Promise((r) => setTimeout(r, 400));
await page.mouse.click(cx, cy);
await new Promise((r) => setTimeout(r, 800));
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Route");
  return btn ? (btn.parentElement?.parentElement ?? btn.parentElement)?.innerText.split("\n")[0] : null;
});
console.log(`click on the building in view -> place card: ${clicked ?? "(none)"}`);
await shot("06b-clicked-building");

// Zoom right in with the + button.
for (let i = 0; i < 2; i++) {
  await page.click('button[aria-label="Zoom in"]');
  await new Promise((r) => setTimeout(r, 700));
}
await settle("zoom in buttons", 60);
await shot("07-close");

// Smoothness: frames per second while dragging, on a CPU slowed 4x (a low-end phone's main thread).
await page.click('button[aria-label="Whole campus"]');
await settle("back to whole campus", 60);
await page.emulateCPUThrottling(4);
await page.evaluate(() => {
  window.__frames = [];
  const tick = (t) => {
    window.__frames.push(t);
    if (window.__frames.length < 2000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.mouse.move(cx, cy);
await page.mouse.down();
for (let i = 0; i < 60; i++) {
  await page.mouse.move(cx + Math.sin(i / 6) * 200, cy + Math.cos(i / 6) * 80);
  await new Promise((r) => setTimeout(r, 50));
}
await page.mouse.up();
const fps = await page.evaluate(() => {
  const f = window.__frames;
  const gaps = f.slice(1).map((t, i) => t - f[i]).sort((a, b) => a - b);
  return { fps: (1000 * (f.length - 1)) / (f[f.length - 1] - f[0]), p95: gaps[Math.floor(gaps.length * 0.95)] };
});
console.log(`dragging with CPU 4x slower: ${fps.fps.toFixed(0)} fps, 95th percentile frame ${fps.p95.toFixed(0)} ms`);
await page.emulateCPUThrottling(1);

console.log(errors.length ? `ERRORS (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join("\n  ")}` : "no page errors");
await browser.close();
process.exitCode = errors.length ? 1 : 0;
