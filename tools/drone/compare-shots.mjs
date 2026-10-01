/**
 * Side-by-side crops of screenshots (from shoot-mesh.mjs) for judging sharpness.
 *
 *   node tools/drone/compare-shots.mjs --out cmp.png --crop x,y,w,h a.png b.png c.png
 */
import sharp from "sharp";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const files = args.filter((a, i) => a.endsWith(".png") && !args[i - 1]?.startsWith("--"));
const [left, top, width, height] = flag("crop", "0,0,640,400").split(",").map(Number);
const gap = 8;
const crops = await Promise.all(files.map((f) => sharp(f).extract({ left, top, width, height }).png().toBuffer()));
await sharp({ create: { width: files.length * width + (files.length - 1) * gap, height, channels: 3, background: "#ffffff" } })
  .composite(crops.map((input, i) => ({ input, left: i * (width + gap), top: 0 })))
  .png()
  .toFile(flag("out", "compare.png"));
console.log(`${files.length} crops -> ${flag("out", "compare.png")}`);
