/**
 * End-to-end check of /navigate's routing over the surveyed paths and the 3D
 * tab's views, in headless Chrome. Screenshots go to --out; any page error
 * fails the run.
 *  - A route between two buildings: the steps the sidebar shows, the line on
 *    the 2D map, the detected roads drawn over the photo, the route in 3D.
 *  - A building from every side: top, north, east, south, west, street level,
 *    and a 360 degree turn round it; left-drag in rotate mode; arrow keys.
 *
 *   node tools/drone/e2e-views-routes.mjs --out <dir> [--app http://localhost:5000] [--viewport desktop|phone]
 *     [--from "AS Block"] [--to "Central Hall"]
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
const from = flag("from", "AS Block");
const to = flag("to", "Central Hall");
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`  shot ${name}.png`);
};
const status = () => page.evaluate(() => document.body.innerText.match(/Loading drone survey[^\n]*|Sharpening detail[^\n]*/)?.[0] ?? "idle");
const settle = async (label, maxS = 60) => {
  const t0 = Date.now();
  let idle = 0;
  while (Date.now() - t0 < maxS * 1000) {
    await wait(250);
    idle = (await status()) === "idle" ? idle + 1 : 0;
    if (idle >= 8) break;
  }
  console.log(`${label}: settled in ${((Date.now() - t0) / 1000 - 2).toFixed(1)} s`);
};
const clickButton = (label) =>
  page.evaluate((label) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.getAttribute("aria-label")?.startsWith(label) || x.textContent?.trim() === label);
    if (!b) return false;
    b.click();
    return true;
  }, label);
const steps = () =>
  page.evaluate(() =>
    [...document.querySelectorAll("ol li")].map((li) => li.innerText.replace(/\n+/g, " · ").trim()).filter(Boolean)
  );

// ---- Route on the 2D map
const q = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
await page.goto(`${app}/navigate?${q}`, { waitUntil: "domcontentloaded", timeout: 300000 });
await page.waitForFunction(() => /Arrive at|You have arrived/.test(document.body.innerText), { timeout: 60000 }).catch(() => {});
if (phone) await clickButton("Directions").catch(() => {});
await wait(2500);
const summary = await page.evaluate(() => document.body.innerText.match(/\d+ min\s*\n?[^\n]*(walking|EV shuttle)/)?.[0]?.replace(/\n/g, " ") ?? "(no summary)");
console.log(`route ${from} -> ${to}: ${summary}`);
for (const s of await steps()) console.log(`  ${s}`);
const surveyed = await page.evaluate(() => /mapped from the drone survey/.test(document.body.innerText));
console.log(`follows the surveyed paths: ${surveyed}`);
await shot("01-route-2d");

// The detected network over the photo (map layers menu).
if (await clickButton("Map style and layers")) {
  await wait(300);
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /Roads & walkways/.test(b.textContent ?? ""))?.click());
  await clickButton("Map style and layers");
  await wait(1500);
  await shot("02-roads-on-photo");
}

// ---- The 3D tab
await page.goto(`${app}/navigate?${q}&view=3d`, { waitUntil: "domcontentloaded", timeout: 300000 });
await page.waitForSelector("canvas", { timeout: 120000 });
await settle("3D with the route", 90);
await shot("03-route-3d");

// Pick the destination in the sidebar: the camera frames it.
const picked = await page.evaluate((name) => {
  const sel = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.text === name));
  if (!sel) return null;
  const opt = [...sel.options].find((o) => o.text === name);
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, opt.value);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  return opt.text;
}, to);
console.log(`picked ${picked ?? "(not found)"}`);
await wait(2500);
await settle("framed", 60);
await shot("04-framed");
if (phone) await page.click('button[aria-label="Close"]').catch(() => {});

for (const [label, name] of [
  ["Straight down from above", "05-top"],
  ["From the north", "06-north"],
  ["From the east", "07-east"],
  ["From the south", "08-south"],
  ["From the west", "09-west"],
  ["From the ground", "10-street"],
]) {
  const ok = await clickButton(label);
  await wait(1600);
  await settle(label, 60);
  await shot(name);
  if (!ok) errors.push(`no button "${label}"`);
}

// A full turn round it.
await clickButton("From the south");
await wait(1500);
await clickButton("360°");
await wait(600);
const spinning = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Stop"));
console.log(`360 turn running: ${spinning}`);
for (const [s, name] of [
  [4.5, "11-spin-quarter"],
  [4.5, "12-spin-half"],
  [4.5, "13-spin-three-quarters"],
]) {
  await wait(s * 1000);
  await shot(name);
}
await wait(5500);
const stopped = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim() === "360°"));
console.log(`360 turn finished by itself: ${stopped}`);

if (!phone) {
  // Rotate mode: the left button turns the view.
  const box = await (await page.$("canvas")).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await clickButton("Left-drag turns the view");
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 300, cy, { steps: 30 });
  await page.mouse.up();
  await settle("left-drag in rotate mode", 60);
  await shot("14-rotate-mode-drag");
  await clickButton("Left-drag moves the view");

  // Arrow keys once the view has focus: turn left three steps, then tilt right down.
  await page.mouse.click(box.x + 30, box.y + box.height - 30);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("ArrowLeft");
    await wait(550);
  }
  await settle("arrow keys turn", 60);
  await shot("15-arrows-turned");
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("ArrowDown");
    await wait(500);
  }
  await settle("arrow keys tilt to the ground", 60);
  await shot("16-tilted-low");
}

console.log(errors.length ? `ERRORS (${errors.length}):\n  ${[...new Set(errors)].slice(0, 10).join("\n  ")}` : "no page errors");
await browser.close();
process.exitCode = errors.length ? 1 : 0;
