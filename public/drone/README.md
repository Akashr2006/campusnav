# Drone survey layers

Source: DJI Terra output in `E:\BIT 3D` (see the survey reports there).

| File | What | Made by |
|---|---|---|
| `mesh/` | 3D Tiles photogrammetry mesh, all levels to 22 (~3.6 GB, not in git) | `python tools/drone/build-web-mesh.py <terra_b3dms> public/drone/mesh --max-level 22` |
| `mesh-alignment.json` | Places the mesh in scene metres | measured, see below |
| `terrain.json` / `terrain.bin` | Bare-earth ground, 5 m grid, heights relative to the anchor | `python tools/drone/build-terrain.py <terra_b3dms> public/drone` |
| `thermal-as-ib.webp` / `.json` | Thermal orthomosaic, AS & IB blocks, with WGS84 bounds | downsampled from `BIT thermal/AS & IB Thermal/map/result.tif` |
| `../draco/` | Draco decoder (tiles are Draco-compressed) | copied from `three/examples/jsm/libs/draco/gltf` |

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
`D:\BIT 3D\_work\web-mesh`), run `CI=true npx wrangler deploy`. Only changed files upload, and
an interrupted upload resumes. Do **not** run wrangler inside this repo: it auto-converts the
Next.js app to OpenNext. The `_headers` file in the assets dir must not match a path with two
rules, or `Access-Control-Allow-Origin` is sent twice and browsers reject it.
