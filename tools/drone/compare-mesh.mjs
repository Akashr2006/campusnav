/**
 * Equivalence check between two mesh builds: for every camera pose the bench
 * page knows (the campus view plus each building, near and far), both builds
 * must settle on the same number of tiles on screen, with no failed loads.
 * The v2 build keeps DJI's tree and errors, so any difference means a hole.
 * Unthrottled; uses /dev-mesh-bench and mesh-server.mjs.
 *
 *   node tools/drone/compare-mesh.mjs --a v1 --b v2
 */
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const app = flag("app", "http://localhost:5000");
const host = flag("host", "https://localhost:5443");
const builds = [flag("a", "v1"), flag("b", "v2")];

const browser = await puppeteer.launch({
  executablePath: flag("chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true,
  args: ["--ignore-certificate-errors", "--use-angle=d3d11", "--ignore-gpu-blocklist"],
});

async function survey(mesh) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(`${app}/dev-mesh-bench?${new URLSearchParams({ host, mesh })}`, { waitUntil: "load", timeout: 300000 });
  await page.waitForFunction(() => window.__bench?.ready, { timeout: 300000 });
  const poses = await page.evaluate(() => window.__bench.poses);
  const result = new Map();
  for (const [i, pose] of poses.entries()) {
    await page.evaluate((p, first) => (first ? window.__bench.start(p) : window.__bench.pose(p)), pose, i === 0);
    let stable = 0;
    let s;
    for (let k = 0; k < 900 && stable < 8; k++) {
      await new Promise((r) => setTimeout(r, 100));
      s = await page.evaluate(() => {
        const t = window.__benchTiles?.();
        return { ...window.__bench.snapshot(), failed: t?.stats.failed ?? 0 };
      });
      stable = s.rootReady && s.pending === 0 && s.visible > 0 ? stable + 1 : 0;
    }
    result.set(pose, { visible: s.visible, failed: s.failed, settled: stable >= 8 });
  }
  await page.close();
  return result;
}

const [a, b] = [await survey(builds[0]), await survey(builds[1])];
let differ = 0;
for (const [pose, ra] of a) {
  const rb = b.get(pose);
  const bad = !rb || ra.visible !== rb.visible || rb.failed > 0 || !rb.settled;
  if (bad) {
    differ++;
    console.log(`DIFF ${pose}: ${builds[0]} ${JSON.stringify(ra)}  ${builds[1]} ${JSON.stringify(rb)}`);
  }
}
console.log(`${a.size} poses compared: ${differ} differ (${builds[0]} failed loads: ${[...a.values()].reduce((x, r) => x + r.failed, 0)}, ${builds[1]}: ${[...b.values()].reduce((x, r) => x + r.failed, 0)})`);
await browser.close();
process.exitCode = differ ? 1 : 0;
