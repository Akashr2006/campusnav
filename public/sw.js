/*
 * CampusNav service worker: keeps the drone survey's files on the device once
 * they have been downloaded, so a second look is instant and as sharp as the
 * first. The files are the same ones, byte for byte; only where they come from
 * changes. (features/navigation/lib/survey-cache.ts registers it and asks for
 * the background preload; see public/drone/README.md "On the device".)
 *
 *  - 3D mesh tiles (*.b3dm) and their subtree JSONs, photo map tiles, tour
 *    photos and the Draco decoder: from the cache when there, else the network
 *    (then kept). They never change under the same name within a build; a
 *    rebuild bumps VERSION below, which clears the old caches.
 *  - The campus data (roads, roofs, land cover, terrain, the mesh's root
 *    tileset, the opening poster): from the cache at once, refreshed from the
 *    network behind it, so a deploy shows on the next visit.
 *  - Pages and the app's code are left to the browser as before.
 */
const VERSION = "2026-10-16";
const NAMES = { tiles: `cn-tiles-${VERSION}`, photo: `cn-photo-${VERSION}`, data: `cn-data-${VERSION}`, tour: `cn-tour-${VERSION}` };
/** Most entries kept per cache; the oldest go first. ~130 KB a mesh tile: ~1 GB at most. */
const LIMITS = { tiles: 8000, photo: 4000, data: 100, tour: 300 };

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set(Object.values(NAMES));
      for (const name of await caches.keys()) if (name.startsWith("cn-") && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })()
  );
});

/** Which cache a request belongs to and how it is served, or null to leave it alone. */
function route(url) {
  const p = url.pathname;
  const local = url.origin === self.location.origin;
  if (/\.b3dm$/.test(p) || /\/Block[A-Z]+\/[^/]+\.json$/.test(p)) return ["tiles", "first"];
  if (/\/tileset\.json$/.test(p)) return ["data", "fresh"];
  if (/\/ortho(-hd)?\/\d+\/\d+_\d+\.webp$/.test(p)) return ["photo", "first"];
  if (/\/ortho(-hd)?\/meta\.json$/.test(p)) return ["photo", "fresh"];
  if (/\/tour\/\d+\/(f|thumb|pano)\.jpg$/.test(p)) return ["tour", "first"];
  if (local && /^\/draco\//.test(p)) return ["data", "first"];
  if (local && /^\/drone\/(paths|footprints|landcover|terrain|prefetch|mesh-alignment)\.(json|bin)$/.test(p)) return ["data", "fresh"];
  if (local && /^\/drone\/poster\//.test(p)) return ["data", "fresh"];
  return null;
}

/**
 * The network, as a response the cache can keep. An <image> on the map asks a
 * cross-origin tile in no-cors mode, and an opaque answer would count as ~7 MB
 * against the storage quota whatever its size; the CDN allows CORS, so ask that way.
 */
function fromNetwork(request) {
  if (request.mode === "no-cors" && new URL(request.url).origin !== self.location.origin)
    return fetch(new Request(request.url, { mode: "cors", credentials: "omit" })).catch(() => fetch(request));
  return fetch(request);
}

const puts = {};
async function keep(kind, url, response) {
  if (!response.ok || response.type === "opaque" || response.status !== 200) return;
  const cache = await caches.open(NAMES[kind]);
  try {
    await cache.put(url, response);
  } catch {
    // Storage full: make room (the older half) and let this one go.
    await trim(kind, Math.floor(LIMITS[kind] / 2));
    return;
  }
  puts[kind] = (puts[kind] ?? 0) + 1;
  if (puts[kind] % 50 === 0) await trim(kind, LIMITS[kind]);
}
async function trim(kind, max) {
  const cache = await caches.open(NAMES[kind]);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const r = route(url);
  if (!r) return;
  const [kind, how] = r;
  event.respondWith(
    (async () => {
      const cache = await caches.open(NAMES[kind]);
      const hit = await cache.match(url.href);
      if (hit && how === "first") return hit;
      const network = fromNetwork(request).then((response) => {
        const kept = keep(kind, url.href, response.clone()).catch(() => {});
        try {
          event.waitUntil(kept);
        } catch {
          // The event already ended: the copy is still being kept, just not waited for.
        }
        return response;
      });
      if (hit) {
        // From the cache now; the fresh copy replaces it for next time.
        event.waitUntil(network.catch(() => {}));
        return hit;
      }
      return network;
    })()
  );
});

/*
 * Background preload (asked for by the 2D map while the user is on it): the
 * 3D tab's opening view, fully sharp, coarse levels first, up to a budget, two
 * files at a time so it never crowds the user's own downloads. Stops when the
 * 3D tab opens (that view loads what it needs itself, from what is here so far).
 */
let preloadRun = 0;
self.addEventListener("message", (event) => {
  const msg = event.data ?? {};
  if (msg.type === "preload-stop") preloadRun++;
  if (msg.type === "preload") event.waitUntil(preload(msg, ++preloadRun));
});
async function preload({ base, files, budget }, run) {
  const cache = await caches.open(NAMES.tiles);
  let i = 0;
  let used = 0;
  let failures = 0;
  const worker = async () => {
    while (run === preloadRun && i < files.length && used < budget && failures < 6) {
      const [path, size] = files[i++];
      const url = new URL(path, base).href;
      if (await cache.match(url)) continue;
      used += size;
      try {
        const response = await fetch(url, { mode: "cors", credentials: "omit", priority: "low" });
        if (response.ok) await keep("tiles", url, response);
        else failures++;
      } catch {
        failures++;
      }
    }
  };
  await Promise.all([worker(), worker()]);
}
