import { useEffect, useState } from "react";
import { DEFAULT_DOWNLOAD_QUEUE } from "3d-tiles-renderer";
import { TILESET_URL } from "@/features/navigation-3d/components/drone-layers";

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
const TILE_DOWNLOADS_IN_FLIGHT = 6;

/**
 * What the 3D drone view needs before it can show its first sharp tile, ~100 KB
 * in all. The tile loader only asks for the Draco decoder once the first tile
 * has downloaded, so on a phone link the decoder then queues behind every other
 * tile and holds the first picture back. Fetched ahead, it comes from cache.
 */
const WARM_URLS = ["/draco/draco_wasm_wrapper.js", "/draco/draco_decoder.wasm", "/drone/mesh-alignment.json", TILESET_URL];

let warming: Promise<void> | null = null;

/**
 * Applies the download limit and pulls those files into the HTTP cache at low
 * priority. Safe to call often: it runs once per page. The prefetch is skipped
 * when the user has asked to save data.
 */
export function warmDroneCache(): Promise<void> {
  if (warming) return warming;
  // The renderer's shared default queue; DroneMesh's renderer uses it.
  DEFAULT_DOWNLOAD_QUEUE.maxJobsPerOrigin = TILE_DOWNLOADS_IN_FLIGHT;
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
