#!/usr/bin/env node
/**
 * The list of mesh tiles the 3D tab's opening view loads once fully sharp, for
 * the background preload (features/navigation/lib/survey-cache.ts, public/sw.js).
 * Opens /navigate?view=3d in headless Chrome at desktop (1600 x 1000) and phone
 * (390 x 844 @2x) size, nudges the camera a pixel (the poster gives way to the
 * real tiles, for the same view), waits until nothing is left to sharpen, and
 * writes every tile it took, coarse levels first, with its size.
 *
 *   node tools/drone/record-prefetch.mjs [--app http://localhost:5000] [--out public/drone/prefetch.json]
 *
 * Rerun when the mesh, the opening camera or the 3D view's sharpening change
 * (with render-poster.mjs: the same moments). Needs the dev server with the mesh.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const app = flag("app", "http://localhost:5000");
const out = flag("out", "public/drone/prefetch.json");
const level = (p) => (p.endsWith(".json") ? 0 : Number(p.match(/_L(\d+)_/)?.[1] ?? 99));

const result = {};
for (const [name, viewport] of [
  ["desktop", { width: 1600, height: 1000, deviceScaleFactor: 1 }],
  ["phone", { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cn-prefetch-"));
  const browser = await puppeteer.launch({
    executablePath: flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
    headless: true,
    userDataDir: dir,
    args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const seen = new Map();
  page.on("response", (r) => {
    const m = r.url().match(/\/(Block[A-Z]+\/[^?/]+\.(?:b3dm|json))(\?|$)/);
    if (m && r.status() === 200 && !seen.has(m[1])) seen.set(m[1], Number(r.headers()["content-length"] ?? 0));
  });
  const status = () =>
    page.evaluate(() => document.body.innerText.match(/Loading drone survey[^\n]*|Sharpening detail[^\n]*/)?.[0] ?? "idle");
  await page.goto(`${app}/navigate?view=3d`, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForSelector("canvas", { timeout: 120000 });
  await new Promise((r) => setTimeout(r, 3000));
  const box = await (await page.$("canvas")).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2, { steps: 2 });
  await page.mouse.up();
  const t0 = Date.now();
  for (let idle = 0; idle < 12 && Date.now() - t0 < 300000; ) {
    await new Promise((r) => setTimeout(r, 250));
    idle = (await status()) === "idle" ? idle + 1 : 0;
  }
  const files = [...seen.entries()].map(([p, size], i) => ({ p, size, i }));
  files.sort((a, b) => level(a.p) - level(b.p) || a.i - b.i);
  result[name] = files.map((f) => [f.p, f.size]);
  const mb = files.reduce((s, f) => s + f.size, 0) / 1e6;
  console.log(`${name}: ${files.length} files, ${mb.toFixed(1)} MB`);
  await browser.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
result.note = "Mesh tiles of the 3D tab's opening view, fully sharp, coarse levels first, [path, bytes], relative to the mesh folder (tools/drone/record-prefetch.mjs).";
fs.writeFileSync(out, JSON.stringify(result));
console.log(`wrote ${out}`);
