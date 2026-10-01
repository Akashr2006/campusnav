# Drone survey layers

Source: DJI Terra output in `E:\BIT 3D` (see the survey reports there).

| File | What | Made by |
|---|---|---|
| `mesh/` | 3D Tiles photogrammetry mesh, all levels to 22, **v2 build** (2.2 GB, not in git; junction to `web-mesh-v2`) | `build-web-mesh.py` (below), then `tools/drone/build-web-mesh-v2.mjs` (see "Web mesh v2") |
| `mesh-alignment.json` | Places the mesh in scene metres | measured, see below |
| `terrain.json` / `terrain.bin` | Bare-earth ground, 5 m grid, heights relative to the anchor | `python tools/drone/build-terrain.py <terra_b3dms> public/drone` |
| `thermal-as-ib.webp` / `.json` | Thermal orthomosaic, AS & IB blocks, with WGS84 bounds | downsampled from `BIT thermal/AS & IB Thermal/map/result.tif` |
| `../draco/` | Draco decoder (tiles are Draco-compressed) | copied from `three/examples/jsm/libs/draco/gltf` |
| `mesh/ortho/` | Orthophoto for the 2D map: the mesh rendered straight down, 256 px WebP tiles, levels 0-4 at 0.25-4 m/px, `meta.json` lists them (765 files, ~6 MB). Lives in the mesh folder so it is served, and deployed, with the mesh | `tools/drone/build-ortho.py` (below) |
| `footprints.json` | Every roofed block on campus (190), outline in scene metres, height and storeys from the survey, named from the 3D view's buildings where they overlap (`buildingId`/`name`, `null` if no building claims it) | `tools/drone/build-ortho.py` (below) |
| `paths.json` | Roads and walkways as a routing network: nodes, and edges with a polyline, `kind` (`road` from 4.5 m wide, `path`, or `link` across a gap the photo cannot show), width and length, in scene metres | `tools/drone/build-paths.mjs` (below) |

## Roads and walkways (routing network, 2026-10-01)

/navigate routes along these (`features/navigation/lib/path-network.ts`): every place is linked to its nearest
paths at run time, so renaming buildings never needs a rebuild. Built from the orthophoto at 0.5 m/px:

    node tools/drone/build-paths.mjs "D:/BIT 3D/_work/web-mesh-v2/ortho" public/drone/paths.json --debug <dir>

1. Paved: neutral grey (asphalt and concrete, in sun or in the shade of the trees lining most roads), pink
   pavers, blue walkway roofs; never on a roof from `footprints.json`, except long thin unnamed ones (covered
   walkways).
2. Cleaned, thinned to centre lines, traced into a graph; junction tangles folded, short spurs pruned.
3. A dead end is carried on in the direction it was heading, over the cheapest ground (paving < shade <
   canopy < soil; roofs and ponds impassable), to the network it was heading for; islands are joined the same way.
4. Hand corrections from `tools/drone/paths-edits.json`: `add` polylines (with a width) for ways the photo
   cannot show, such as roads under continuous canopy, covered walkways or porches that broke a road; `remove`
   polygons for false finds. Each has a `why`.

`--debug` writes `paths-review.png` (the photo with roads red, paths blue, gap links magenta, hand traces
yellow); `--probe x,z` prints the network near a point after each step. `tests/path-network.test.ts` checks
every pair of buildings: reachable, never across a solid roof, at most 2.8x the straight-line distance.
`tools/drone/e2e-views-routes.mjs` checks a route's steps and line in Chrome, and the 3D views.

## Web mesh v2 (fast loading, 2026-10-01)

`build-web-mesh.py` copies DJI's tiles as they are. v2 repacks them for phones
on Indian mobile data; the look is unchanged (verified below).

| | v1 (DJI layout) | v2 |
|---|---|---|
| Size | 3,649 MB | 2,192 MB (40% smaller) |
| Tileset JSONs | 657, nested up to 6 deep | 1 root + 266 subtrees, 2 fetches reach any tile |
| Texture filtering | `LINEAR`, no mipmaps (shimmers; anisotropy has no effect) | trilinear mipmaps |
| Geometry | DJI Draco, ~17 bytes/vertex | Draco edgebreaker, 14-bit positions, 13-bit UVs |
| Textures | JPEG | the same JPEG bytes, untouched |

Build, from the repo (Node; tools have their own `tools/drone/package.json`, run
`npm install` there once). It takes ~5 minutes on 20 workers, skips tiles
already converted, and refuses to finish if any tileset link is broken:

    node tools/drone/build-web-mesh-v2.mjs "E:/BIT 3D/_work/web-mesh" "E:/BIT 3D/_work/web-mesh-v2" --split-level 17
    node tools/drone/verify-web-mesh-v2.mjs "E:/BIT 3D/_work/web-mesh" "E:/BIT 3D/_work/web-mesh-v2" --limit 200

Verified: same triangles, byte-identical images, UVs within 1/16 texel, and
positions within 5 mm on L19-L22 (46 mm on the 842 m L13 tiles, whose own
error is 7.5 m). `ortho/` is copied in beside it, since the 2D map reads the
orthophoto from next to the tileset.

Re-tried and rejected (measured): WebP textures (q80 is 21% smaller but softens
detail to 36 dB PSNR; q85 saves only 5%), and loading coarse parent tiles first
(`loadAncestors`: 1.7-3.3x the bytes, and the first picture came later).

### Load benchmark

`/dev-mesh-bench` (dev server only) mounts the app's own `DroneMesh` and times
how long a view takes to become fully sharp; `tools/drone/bench-mesh.mjs` drives
it in headless Chrome on a 412x915 @2x phone viewport with a 4x slower CPU,
12 Mbit/s and 150 ms latency (the CDN is routed to Hong Kong from here, ~250 ms
per request). `mesh-server.mjs` serves any mesh folders the way the CDN does.

    node tools/drone/mesh-server.mjs --port 5443 --http-port 5480 v1="E:/BIT 3D/_work/web-mesh" v2="E:/BIT 3D/_work/web-mesh-v2"
    node tools/drone/bench-mesh.mjs --meshes "v1,v2@jobs6+warm" --runs 3
    node tools/drone/compare-mesh.mjs --a v1 --b v2      # same tiles on screen at ~100 poses, no failed loads
    node tools/drone/shoot-mesh.mjs --poses "b:AS Block,close:AS Block,home" --out <dir>

`@jobs6+warm` is what `/navigate` now does (`features/navigation/lib/drone-warmup.ts`):
at most 6 tile downloads in flight, so the view fills in nearest-first instead of
all at once at the end, and the Draco decoder and root tileset fetched while the
2D map is up. Medians of 3 runs:

| Low-end phone, 12 Mbit/s, 150 ms | today (v1) | v2 + loading changes |
|---|---|---|
| Open the 3D tab: first picture | 8.7 s | 1.6 s |
| Open the 3D tab: fully sharp | 15.1 s (20.3 MB) | 7.7 s (9.6 MB) |
| Fly to AS Block: fully sharp | 5.9 s | 3.7 s |
| Deep link to AS Block: first picture / fully sharp | 6.2 s / 7.0 s | 2.1 s / 4.2 s |
| Campus Wi-Fi 40 Mbit/s, AS Block fully sharp | 3.7 s | 2.5 s (1.8 s from an Indian CDN edge) |
| Second visit (browser cache), AS Block fully sharp | 1.8 s | 1.8 s |

### The /navigate 3D tab (`features/navigation/components/drone-view-3d.tsx`)

It loads at the error target above (4), then sharpens to one CSS pixel once nothing is left to load, and drops
back to 4 during a sustained drag. Desktop 1280x800, campus Wi-Fi (40 Mbit/s): the overview is complete in
~2 s at target 4; fully sharp at target 1 it is 20 MB instead of 4.7 MB, which is why the sharpening comes after
the first picture rather than instead of it. Checks:

    node tools/drone/e2e-3d-view.mjs --out <dir> [--viewport phone]    # load, wheel/drag/right-drag, click, fly-to, fps
    node tools/drone/profile-3d-view.mjs --cpu 4 [--button right|left|none] [--query viewer=studio --settle-seconds 25]
    node tools/drone/compare-shots.mjs --out cmp.png --crop x,y,w,h a.png b.png   # side-by-side crops

`/dev-mesh-bench` also takes `et<N>` (error target) for comparing sharpness with `shoot-mesh.mjs`. Profile a
production build (`next build`, `next start`): React's dev build alone costs several times more per frame.

### Rebuilding the 2D layers

1. Capture (only when the mesh changes): with `pnpm dev` running, open
   `/dev-ortho` (dev server only). It renders the mesh top-down in 128 m windows at
   0.25 m/px, colour plus encoded height, into `D:\BIT 3D\_work\ortho\raw` (182
   windows, ~30 min). `?start=N` resumes; `?only=i,j` redoes one window.
2. Build: `python tools/drone/build-ortho.py "D:/BIT 3D/_work/ortho/raw" "D:/BIT 3D/_work/web-mesh/ortho" public/drone/footprints.json --graph .data/published_graph.json --terrain public/drone`.
   Add `--skip-tiles` when only the names changed (e.g. buildings renamed or
   re-traced in the admin editor): footprints are re-matched in seconds.

Blocks are found where the surface stands more than 2.5 m above the terrain and
is not green (trees); covered walkways are cut away, and each named building
claims the roofs inside its traced outline (with 4 m tolerance), which also splits
roofs that touch. Roofs no building claims show on the map as unnamed buildings:
the data has no name for them (see HANDOFF.md, "building names").

## Accuracy

- The April 2022 RGB flight had **no RTK fix**; DJI Terra reports 10.4 m
  georeferencing RMSE. Checked against the published building footprints, the
  mesh already agrees to within a few metres, so `dx`/`dz` are 0.
- The site falls ~60 m from south (~282 m) to north (~222 m ellipsoidal).
  `groundHeight` (265.4 m) is the shared datum: the mesh, the terrain grid and
  the procedural scene all measure y from it. Buildings are seated at the
  lowest terrain under their outline; paths, route, trees and the thermal
  sheet are draped. Without the terrain files the scene falls back to flat.
- The terrain is the mesh with buildings and trees removed (100 m
  morphological opening). It matches hand measurements to ~2 m; under very
  large structures it can read a little low.
- Thermal is a false-colour 8-bit render, **not radiometric**. It shows
  relative heat (bright = warmer), never degrees Celsius. The raw R-JPEG
  thermal images would be needed for temperatures.

`NEXT_PUBLIC_DRONE_TILESET_URL` points the viewer at a hosted copy of `mesh/`
(e.g. a CDN bucket) for deployments; Vercel will not serve 690 MB of tiles.

## Hosting (production)

| What | Where |
|---|---|
| Full-detail mesh (L≤22, 17,767 files, 3.4 GB) | Cloudflare Worker static assets: `https://campusnav-drone.akashr-ad24.workers.dev` (Workers free plan: ≤20,000 files, ≤25 MiB each) |
| Tour panoramas | Supabase Storage bucket `tour` (project `xnhsopueqgnvupiszwxr`) |
| Older L≤19 mesh copy | Supabase bucket `drone` (fallback, can be deleted) |

Vercel reads them through `NEXT_PUBLIC_DRONE_TILESET_URL` and `NEXT_PUBLIC_TOUR_BASE_URL`.

To republish the mesh: from `D:\BIT 3D\_work\pages-deploy` (holds `wrangler.jsonc`, assets dir
`D:\BIT 3D\_work\web-mesh-v2`; a copy of both is on the USB drive `E:`), run `npx wrangler login` once, then
`npx wrangler deploy`. Only changed files upload, and an interrupted upload resumes. Do **not**
run wrangler inside this repo: it auto-converts the Next.js app to OpenNext. The `_headers` file
in the assets dir must not match a path with two rules, or `Access-Control-Allow-Origin` is sent
twice and browsers reject it (it has three: `*.b3dm`, `*.json`, `*.webp`).

**v2 is built but not deployed yet** (2026-10-01): the CDN still serves v1. v2 keeps every tile
file name, and carries v1's 656 tileset JSONs too, so it replaces v1 at the same URLs: a browser
still holding v1's root `tileset.json` (cached up to an hour) keeps resolving. No Vercel env
change is needed. The first v2 upload is all 2.2 GB, since every tile changed.
