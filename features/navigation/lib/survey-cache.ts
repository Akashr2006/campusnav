/**
 * Keeps the drone survey on the device (public/sw.js, a service worker): once a
 * 3D tile, photo tile or tour photo has been downloaded it is kept, so the next
 * look is instant and exactly as sharp. And while someone is on the 2D map, the
 * 3D tab's opening view is fetched ahead in the background (coarse levels
 * first), so the 3D view is sharp sooner when they open it.
 *
 * Like drone-warmup.ts this is imported by the /navigate page itself: no three.js.
 */

const TILESET_URL = process.env.NEXT_PUBLIC_DRONE_TILESET_URL ?? "/drone/mesh/tileset.json";
/** The mesh folder: tile paths in public/drone/prefetch.json are relative to it. */
const MESH_BASE = TILESET_URL.replace(/tileset\.json$/, "");

type Prefetch = { desktop: [string, number][]; phone: [string, number][] };
type Connection = { saveData?: boolean; effectiveType?: string; downlink?: number };

let registered = false;

/**
 * Registers the service worker once the page has loaded and gone idle, so it
 * never competes with the first paint. Production only: in development the
 * mesh and data change under the same names.
 */
export function registerSurveyCache() {
  if (registered || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;
  registered = true;
  const go = () => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const run = () => navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 2000);
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/**
 * How much of the opening view to fetch ahead: all of it (30 MB on a desktop,
 * 19 MB on a phone; its coarse levels alone, 10 MB, only reach level 16, not
 * the sharpness the owner asked for), or nothing when the user saves data or
 * the browser reports 2G/3G. Browsers that do not say (Safari, Firefox) get it all.
 */
function budgetBytes(): number {
  const c = (navigator as Navigator & { connection?: Connection }).connection;
  if (c?.saveData) return 0;
  if (c?.effectiveType && /(^|-)(2g|3g)$/.test(c.effectiveType)) return 0;
  return Infinity;
}

let asked = false;
/** Asks the service worker to fetch the 3D opening view ahead (again after a stop: it skips what it has). */
export async function preloadOpeningView3D() {
  if (asked || !("serviceWorker" in navigator)) return;
  const budget = budgetBytes();
  if (!budget) return;
  asked = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    const worker = reg.active;
    if (!worker) return;
    const r = await fetch("/drone/prefetch.json");
    if (!r.ok) return;
    const list = (await r.json()) as Prefetch;
    // The phone list for narrow screens: a phone's view needs fewer, coarser tiles.
    const files = window.innerWidth < 768 ? list.phone : list.desktop;
    worker.postMessage({ type: "preload", base: new URL(MESH_BASE, window.location.href).href, files, budget: budget === Infinity ? 1e12 : budget });
  } catch {
    asked = false;
  }
}

/** The 3D tab is open: it fetches what it needs itself, so the preload gives way. */
export function stopPreload3D() {
  if (typeof navigator === "undefined") return;
  navigator.serviceWorker?.controller?.postMessage({ type: "preload-stop" });
  asked = false;
}
