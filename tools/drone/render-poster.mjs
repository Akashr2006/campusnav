/**
 * Renders the /navigate 3D tab's opening view, fully sharp, as the posters it
 * shows while its own tiles load (see PosterSwap in
 * features/navigation/components/drone-view-3d.tsx).
 *
 * For each poster shape it sizes the browser so the canvas is exactly that big
 * at 1x, waits until the view has finished sharpening, hides everything but the
 * canvas (the names, buttons and sky are drawn live by the page), and saves the
 * canvas with a transparent sky as AVIF and WebP, plus the camera pose they
 * were taken from in poster.json. The page shows a poster only when its camera
 * is at exactly that pose, so rerun this whenever the mesh, the campus outline
 * (its centre and size set the opening view) or the terrain change.
 *
 * Use a server that reads the mesh from the local disk (pnpm dev, without
 * NEXT_PUBLIC_DRONE_TILESET_URL): a sharp 3072 px view is several hundred MB of tiles.
 *
 *   node tools/drone/render-poster.mjs [--app http://localhost:5000] [--out public/drone/poster]
 */
import puppeteer from "puppeteer-core";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const app = flag("app", "http://localhost:5000");
const out = flag("out", "public/drone/poster");
// Wider than any canvas it will cover (up to 2.4:1), and a square one for phones
// and portrait tablets: covering by height then crops only the sides.
const SHAPES = [
  { file: "wide", width: 3072, height: 1280 },
  { file: "tall", width: 1600, height: 1600 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
  args: ["--use-angle=d3d11", "--ignore-gpu-blocklist"],
});
fs.mkdirSync(out, { recursive: true });
const images = [];
let pose = null;
for (const shape of SHAPES) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message ?? e)));
  let viewport = { width: shape.width + 256, height: shape.height + 64, deviceScaleFactor: 1 };
  await page.setViewport(viewport);
  await page.goto(`${app}/navigate?view=3d&debug=1`, { waitUntil: "domcontentloaded", timeout: 300000 });
  await page.waitForSelector("canvas", { timeout: 300000 });
  // Size the window so the canvas is exactly the poster's size.
  for (let i = 0; i < 4; i++) {
    const rect = await page.$eval("canvas", (c) => ({ w: c.clientWidth, h: c.clientHeight }));
    if (rect.w === shape.width && rect.h === shape.height) break;
    viewport = { ...viewport, width: viewport.width + shape.width - rect.w, height: viewport.height + shape.height - rect.h };
    await page.setViewport(viewport);
    await sleep(500);
  }
  const t0 = Date.now();
  // Fully sharp: no loading or sharpening message for 5 s.
  for (let idle = 0; idle < 20 && Date.now() - t0 < 15 * 60000; ) {
    await sleep(250);
    const busy = await page.evaluate(() => /Loading drone survey|Sharpening|Opening the drone view/.test(document.body.innerText));
    idle = busy ? 0 : idle + 1;
  }
  const p = await page.evaluate(() => window.__droneView?.pose());
  if (!p) throw new Error("no camera pose: is this a build with the ?debug hook?");
  if (pose && (Math.hypot(...p.position.map((v, i) => v - pose.position[i])) > 1e-3 || Math.abs(p.fov - pose.fov) > 1e-6))
    throw new Error(`the ${shape.file} poster's camera differs from the first one's`);
  pose ??= p;
  // Only the canvas, with a transparent sky.
  await page.addStyleTag({
    content: "body, body * { visibility: hidden !important; background: transparent !important; } canvas { visibility: visible !important; }",
  });
  await sleep(1000);
  const rect = await page.$eval("canvas", (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  const png = await page.screenshot({ clip: rect, omitBackground: true, type: "png" });
  const base = path.join(out, shape.file);
  await sharp(png).avif({ quality: 66, effort: 6 }).toFile(`${base}.avif`);
  await sharp(png).webp({ quality: 86, alphaQuality: 90, effort: 6 }).toFile(`${base}.webp`);
  const kb = (f) => Math.round(fs.statSync(f).size / 1024);
  console.log(
    `${shape.file}: ${rect.width}x${rect.height}, sharp after ${((Date.now() - t0) / 1000).toFixed(0)} s, ` +
      `${kb(`${base}.avif`)} KB avif, ${kb(`${base}.webp`)} KB webp${errors.length ? `, page errors: ${errors.join("; ")}` : ""}`
  );
  images.push({ file: shape.file, width: shape.width, height: shape.height });
  await page.close();
}
await browser.close();
const round = (v) => Math.round(v * 1e9) / 1e9;
fs.writeFileSync(
  path.join(out, "poster.json"),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString().slice(0, 10),
      pose: { position: pose.position.map(round), quaternion: pose.quaternion.map(round), fov: pose.fov },
      images,
    },
    null,
    2
  ) + "\n"
);
console.log(`wrote ${path.join(out, "poster.json")}`);
