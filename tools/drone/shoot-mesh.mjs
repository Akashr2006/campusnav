/**
 * Renders the same camera pose from several mesh builds, fully loaded, for a
 * side-by-side look (uses the /dev-mesh-bench page and mesh-server.mjs).
 *
 *   node tools/drone/shoot-mesh.mjs --meshes v1,v2 --poses "b:AS Block,home" --out <dir> [--width 1280 --height 800 --dpr 1]
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
const host = flag("host", "https://localhost:5443");
const meshes = flag("meshes", "v1,v2").split(",");
const poses = flag("poses", "b:AS Block").split(",");
const out = flag("out", ".");
const width = Number(flag("width", 1280));
const height = Number(flag("height", 800));
const dpr = Number(flag("dpr", 1));
fs.mkdirSync(out, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
  args: ["--ignore-certificate-errors", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
for (const mesh of meshes) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: dpr });
  // "v2@et2+jobs6" = folder v2 with those bench tweaks (see app/dev-mesh-bench).
  const [folder, tweak = ""] = mesh.split("@");
  const q = new URLSearchParams({ host, mesh: folder, tweak: tweak.split("+").join(",") });
  await page.goto(`${app}/dev-mesh-bench?${q}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction(() => window.__bench?.ready, { timeout: 300000 });
  for (const [i, pose] of poses.entries()) {
    await page.evaluate((p, first) => (first ? window.__bench.start(p) : window.__bench.pose(p)), pose, i === 0);
    let stable = 0;
    for (let k = 0; k < 600 && stable < 15; k++) {
      await new Promise((r) => setTimeout(r, 100));
      const s = await page.evaluate(() => window.__bench.snapshot());
      stable = s.rootReady && s.pending === 0 && s.visible > 0 ? stable + 1 : 0;
    }
    const file = path.join(out, `${pose.replace(/[^a-z0-9]+/gi, "_")}_${mesh.replace(/[^a-z0-9]+/gi, "_")}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await ctx.close();
}
await browser.close();
