import { useEffect, useState } from "react";

// This module is imported by the /navigate page itself, so it must not import
// three.js or 3d-tiles-renderer (directly or through drone-layers): that put
// ~290 KB gzipped of 3D code into the page's first load, parsed even by a phone
// that only opens the 2D map. The 3D view (its own chunk) imports those.

/** The drone mesh's root tileset; the same value as drone-layers' TILESET_URL. */
const TILESET_URL = process.env.NEXT_PUBLIC_DRONE_TILESET_URL ?? "/drone/mesh/tileset.json";

export type DroneMeshStatus = "checking" | "yes" | "no";

/**
 * Whether the drone mesh is served here, and "checking" until that is known.
 *
 * The studio's `useDroneMeshAvailable` says false until its one request
 * returns, and false for good if it fails; the /navigate 3D tab used to show
 * the modelled campus (the studio's old buildings) in that time, and stay on
 * it after a hiccup (a dev server busy compiling, a dropped request). So: wait
 * while checking, and retry a failed check twice before giving up. A 404 is a
 * real answer (no mesh deployed) and is not retried.
 */
export function useDroneMeshStatus(): DroneMeshStatus {
  const [status, setStatus] = useState<DroneMeshStatus>("checking");
  useEffect(() => {
    let live = true;
    (async () => {
      for (const wait of [0, 1500, 4000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        if (!live) return;
        try {
          const r = await fetch(TILESET_URL, { method: "HEAD", cache: "no-store" });
          if (r.ok) {
            if (live) setStatus("yes");
            return;
          }
          if (r.status === 404) break;
        } catch {
          // Network hiccup: try again.
        }
      }
      if (live) setStatus("no");
    })();
    return () => {
      live = false;
    };
  }, []);
  return status;
}

/**
 * Loading tuned for phones on Indian mobile data. Measured with
 * tools/drone/bench-mesh.mjs (4x slower CPU, 12 Mbit/s, 150 ms; see
 * public/drone/README.md): together these bring the 3D view's first picture
 * from 6.4 s to 1.6 s and a building's from 4.2 s to 2.1 s.
 */

/**
 * At most this many tile downloads at once. The tiles renderer allows 25, and
 * over HTTP/2 those share the link and all finish together at the end, so the
 * screen stays empty until everything is in. Six at a time, nearest first,
 * fills the view in front of the user progressively for the same total time.
 */
export const TILE_DOWNLOADS_IN_FLIGHT = 6;

/**
 * What the 3D drone view needs before it can show its first sharp tile, ~100 KB
 * in all. The tile loader only asks for the Draco decoder once the first tile
 * has downloaded, so on a phone link the decoder then queues behind every other
 * tile and holds the first picture back. Fetched ahead, it comes from cache.
 */
const WARM_URLS = ["/draco/draco_wasm_wrapper.js", "/draco/draco_decoder.wasm", TILESET_URL];

let warming: Promise<void> | null = null;
let openingViewRequested = false;

/**
 * On the 3D tab: starts the opening view's poster (public/drone/poster, see
 * PosterSwap in drone-view-3d.tsx) and the terrain the opening camera is aimed
 * with downloading now, alongside the 3D view's code, instead of once that code
 * has run. On a slow phone that brings the sharp opening view ~0.5 s sooner.
 * The poster is picked as the view will pick it: square for a canvas taller
 * than wide, wide otherwise (the canvas is the window less the header and, from
 * 768 px, the sidebar).
 */
export function preloadOpeningView() {
  if (openingViewRequested) return;
  openingViewRequested = true;
  const sidebar = window.innerWidth >= 768 ? 256 : 0;
  const shape = (window.innerWidth - sidebar) / Math.max(1, window.innerHeight - 64) < 1 ? "tall" : "wide";
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  // Only browsers that will use the AVIF fetch it.
  link.type = "image/avif";
  link.href = `/drone/poster/${shape}.avif`;
  link.setAttribute("fetchpriority", "high");
  document.head.appendChild(link);
  for (const url of ["/drone/terrain.json", "/drone/terrain.bin"])
    fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
}

/**
 * Pulls those files into the HTTP cache at low priority. Safe to call often: it
 * runs once per page. Skipped when the user has asked to save data. (The 3D
 * view applies TILE_DOWNLOADS_IN_FLIGHT to its own renderer.)
 */
export function warmDroneCache(): Promise<void> {
  if (warming) return warming;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (connection?.saveData) return (warming = Promise.resolve());
  warming = Promise.all(
    WARM_URLS.map((url) =>
      fetch(url, { priority: "low" } as RequestInit)
        // The body must be read for the response to be stored.
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .catch(() => null)
    )
  ).then(() => undefined);
  return warming;
}
