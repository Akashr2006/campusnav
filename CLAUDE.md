# CampusNav: project brief for Claude

Claude Code loads this file into every session in this repo. Read it before doing anything.
It holds everything earlier sessions learned (Sept 2026, on the first laptop), so a new
machine or a new session doesn't start from zero. Deeper notes:
- `HANDOFF.md`: data origins, map rendering and the 360 tour
- `public/drone/README.md`: the drone survey pipeline and hosting
- `docs/session-memory/`: the auto-memory notes from the first laptop, copied verbatim

---

## 1. What this is

**CampusNav** is a digital twin and wayfinding app for **Bannari Amman Institute of
Technology (BIT), Sathyamangalam** (campus about 11.4976 N, 77.2755 E). It is Next.js 15, React 19,
TypeScript, Tailwind, three.js / react-three-fiber and 3d-tiles-renderer.

| | |
|---|---|
| Repo | https://github.com/Akashr2006/campusnav (public since 2026-09-30, branch `main`) |
| Live site | https://campusnav-rose.vercel.app (Vercel team `akashrad24-7335s-projects`, account akashr.ad24@bitsathy.ac.in) |
| Drone mesh CDN | https://campusnav-drone.akashr-ad24.workers.dev (Cloudflare Worker static assets) |
| Panoramas | Supabase Storage bucket `tour` (project ref `xnhsopueqgnvupiszwxr`) |

The owner (Akash) talks in short, urgent messages, often in capitals. He wants a result he
can see, not options. He calls the drone data his "gold mine".

## 2. Rules the owner has set (do not break these)

1. **Never edit anything under `features/navigation-3d/**`** ("don't touch the 3D view"). New
   work imports from it. Since 2026-10-01 (the owner asked for sharper 3D and mouse navigation to every
   building) the `/navigate` 3D tab uses its own drone viewer, `features/navigation/components/drone-view-3d.tsx`,
   built beside the studio; `CampusScene` still shows there when no mesh is deployed, or with `&viewer=studio`.
2. In the `/navigate` 3D tab, show the **drone view**, and **no building may open into the
   exploded view**. Clicking or picking a building there selects it (outline and place card) and nothing more.
3. The 2D map must be **derived from the 3D / drone view** and look **neat and clean**, in the
   style of the Navigine indoor-map reference (white sidebar, grey fields, purple markers,
   green dotted route, square controls at the top left, photo card with a full-width Route button).
4. **Heavy data never goes in the repo or on the system drive.** It lives on a data drive
   (`D:\BIT 3D` on the first laptop) and is linked in with junctions.
5. **Don't invent building names.** Many names are placeholders (see section 7). Say so; don't guess.

## 3. Setting up on a new machine

```bash
git clone https://github.com/Akashr2006/campusnav.git
cd campusnav
pnpm install        # runs prisma generate
pnpm dev -p 5000    # the app, at http://localhost:5000
```

- Use `pnpm dev -p 5000`, **not** `pnpm dev -- -p 5000`. pnpm passes the `--` through and Next treats it as a folder.
  `.claude/launch.json` defines `campusnav-dev-5000` for the Claude preview pane.
- **Never run `next build` while the dev server runs.** They share `.next` and the build corrupts dev
  chunks. `pnpm build` also runs `prisma generate`, which hits EPERM on Windows while dev
  holds the DLL. Use `pnpm exec next build` if needed.
- There is **no database**. `DATABASE_URL` is unset on purpose. The campus is served from
  `.data/published_graph.json` (the live map) and `.data/draft_graph.json` (the admin working copy),
  through `lib/local-graph-store.ts`. **These two files are committed** (from 2026-09-30; they used to be
  gitignored, so an older clone had an empty campus).
- Env vars used: `NEXT_PUBLIC_DRONE_TILESET_URL`, `NEXT_PUBLIC_TOUR_BASE_URL`,
  `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY`, `SUPABASE_*`, `DATABASE_URL` (unset). `.env.local` only holds a
  Vercel OIDC token; run `vercel link` and `vercel env pull` on the new machine if needed. Without
  `NEXT_PUBLIC_DRONE_TILESET_URL`, the app reads the mesh from `public/drone/mesh/` (see below).
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm test` (256+ vitest tests passed at the last full run).

### Heavy data NOT in git: copy it from the first laptop's `D:\BIT 3D`

| What | Size | Where it goes on the new machine |
|---|---|---|
| `D:\BIT 3D\_work\web-mesh` (web drone mesh, L≤22, plus `ortho/` 2D photo tiles) | 3.5 GB | anywhere on a data drive; then `mklink /J public\drone\mesh "<that folder>"` |
| `D:\BIT 3D\_work\ortho\raw` (raw top-down captures) | 87 MB | only needed to rebuild the 2D layers |
| `D:\BIT 3D\BIT 3D.zip` and `_extracted` (DJI Terra source: full mesh L13-L22, 17,766 files) | large | archive; source for `tools/drone/build-web-mesh.py` |
| `D:\BIT 3D\BIT photos` (Aug 2022 flight, 45 MP, RTK/PPK, **not processed yet**) | large | photogrammetry input |
| `D:\BIT 3D\BIT thermal` (AS & IB blocks, 8-bit false colour, **not radiometric**) | | already baked into `public/drone/thermal-as-ib.*` |
| `D:\BIT 3D\_work\photogrammetry` (COLMAP 4.2 CUDA, OpenMVS 2.4, `run_pilot.sh`, `shrink.py`) | | paused pilot, see section 8 |
| `D:\BIT 3D\_work\pages-deploy` (`wrangler.jsonc` for the drone CDN) | small | needed to redeploy the CDN |

On the second machine (2026-10-01) the project is at `D:\campusnav` and the survey on the USB drive **`E:\BIT 3D`**.
`public\drone\mesh` is a junction to **`D:\BIT 3D\_work\web-mesh-v2`** (the fast-loading build, section 5, copied
off E: and verified byte for byte), and `D:\BIT 3D\_work\pages-deploy` is the CDN deploy folder. `E:\BIT 3D\_work\web-mesh`
is the v1 source v2 is built from. **Windows reports the E: volume as "Full Repair Needed"** (file system errors; a
write failed mid-session): back up `E:\BIT 3D` before running a repair on it.

Without the local mesh, point `NEXT_PUBLIC_DRONE_TILESET_URL` at
`https://campusnav-drone.akashr-ad24.workers.dev/tileset.json` and the 3D drone view streams from the CDN.
(The 2D photo map needs `ortho/` on that CDN too. It isn't uploaded yet; see section 8.)

## 4. The app, page by page

| Route | What | Main code |
|---|---|---|
| `/` | landing | `features/landing` |
| `/navigate` | **main navigator**: own header, 2D map / 3D view tabs, sidebar, route | `features/navigation/components/navigate-view.tsx` |
| `/navigate-3d` | 3D studio: structure, explode, section cut, presentation mode (`?present=1`), drone and thermal toggles | `features/navigation-3d/**` (**do not edit**) |
| `/search`, `/map` | explore / older map | `features/search`, `app/map` |
| `/admin` (`/admin/login`) | graph editor, floor-plan tracer, publish. The guard is client-side only; the API routes are the real control | `features/admin` |
| `/dev-ortho` | **dev-only** capture tool for the 2D photo map (404 in production) | `app/dev-ortho`, `app/api/dev-ortho` |

### `/navigate` in detail (built 2026-09-24 to 26)
- `navigate-view.tsx`: header (logo, "2D map" and "3D view" pill tabs, Explore, Home, campus selector,
  admin icon), a white sidebar (Location, Building, Start point, Destination + Swap, Travel mode,
  Category, "Show names" toggle, counts, then route time, Preview/Pause and steps), a phone bottom sheet,
  and the place card (name, kind, **drone-measured floors and height**, roof area, photo if a tour scene
  matches, Route and "Set as start point"). Deep links: `?from=&to=` (destination id, node id or name),
  `&view=3d`, `&style=plan`.
- Routing (since 2026-10-01) follows **the roads and walkways detected in the drone survey**: `public/drone/paths.json`
  (made by `tools/drone/build-paths.mjs`, see section 5) through `features/navigation/lib/path-network.ts`, which links
  every place to the network at run time (up to 3 doors on its nearest paths, on different sides), runs Dijkstra
  (EV mode drives the `road` edges, walks the rest), and writes turn-by-turn steps named after the building at each
  turn ("Turn left at AS Block", "past X on your right", "Arrive at Y, on your left"). Academic blocks and labs
  (`placeKind`) may be walked through door to door ("Go through ..."), hostels and halls never. Every building
  reaches every other (`tests/path-network.test.ts`). Without `paths.json` it falls back to the old
  `shortestPath(start, end, { graphData, travelMode })` over the published graph (24 road junctions in a coarse
  grid, **two disconnected parts**).
- `campus-2d-map.tsx`: SVG in scene metres (X east, Z south, the 3D frame), with its own pan, zoom and pinch camera.
  - **Drone style (default):** photo tiles `mesh/ortho/<level>/<c>_<r>.webp` (levels 0-4 = 0.25 to 4 m/px),
    the area outside the campus faded, and every block outlined.
  - **Plan style:** Navigine look with an even white inner band (the polygon clipped to itself).
    Buildings with a room survey (Aero Block) open into rooms and stairs when zoomed in.
  - Labels are placed greedily with collision avoidance, largest and selected first.
  - The roads and walkways routing uses are drawn in plan style, and over the photo with the layers menu's
    "Roads & walkways (mapped)" (off by default there). One SVG path per kind, not a line per segment.
- `drone-view-3d.tsx` (2026-10-01), the 3D tab: the v2 drone mesh with 3d-tiles-renderer's `EnvironmentControls`
  (drag moves the ground under the pointer, wheel zooms to the pointer, right-drag / two fingers turn a full 360 deg
  around it and tilt from straight down to level with the ground (`minAltitude` 0, `maxAltitude` 100 deg: these are
  angles from straight down, not from the horizon), double-click flies closer; camera kept 3 m off any surface).
  A Move/Rotate toggle makes left-drag turn the view (it patches the controls' `pointerTracker.isRightClicked`);
  arrow keys turn and tilt, +/- zoom. A views bar (bottom on desktop, top on phones) shows the selected building
  (or the middle of the view) from the top, N/E/S/W, street level (the first of 16 directions with a clear line of
  sight, by raycast) and turns a 360 deg circle round it; views swing round the building rather than fly through it.
  Click a building for its outline and place card, a sidebar pick flies there framing it roof to ground, names
  decluttered like the 2D map. The route is a screen-width line, drawn over everything. The tab waits ("Opening
  the drone view…") while `useDroneMeshStatus` (`lib/drone-warmup.ts`) checks the mesh, retrying twice; it used to
  show the studio's old modelled campus during that check, and stay on it after one failed request (2026-10-05).
  The 2D map retries its photo tiles the same way before falling back to the plan drawing. **Progressive sharpness:** loads at error target 4 (the old view's detail), then,
  with nothing left to load, halves it down to one CSS pixel (1 on desktop, 2 on a 2x phone; Data Saver and
  phones with 3 GB or less stay at 4). During a sustained drag it drops back to 4 and parses one tile at a time,
  then re-sharpens about a second after it stops: measured on a 4x slowed CPU, a drag at full sharpness ran
  ~20 fps, now ~45-60 like the old view, and overview buildings go from blurred blobs to distinct roofs.
  Measured with `tools/drone/profile-3d-view.mjs` and `tools/drone/e2e-3d-view.mjs` (see public/drone/README.md).
- `features/navigation/lib/place-kind.ts`: kind, icon and colour from the building name.
- The old `navigate-shell.tsx` (with `campus-plan-map.tsx`, built by a parallel session on 26 Sep) is kept
  but **no longer mounted**.

## 5. The drone survey ("gold mine")

DJI Terra output for the whole campus: **April 2022 RGB flight, no RTK** (10.4 m RMSE reported, but measured
against footprints the offset is effectively 0, so `mesh-alignment.json` has dx=dz=0). The site **falls about
60 m from south to north**. `groundHeight` 265.4 m is the shared datum (y = 0).

- `tools/drone/build-web-mesh.py`: Terra b3dm to web 3D Tiles. It also patches DJI's undeclared
  KHR_materials_unlit, which crashes GLTFLoader.
- `tools/drone/build-terrain.py`: `public/drone/terrain.*` (bare earth on a 5 m grid). Buildings sit at the lowest
  ground under their outline.
- **Web mesh v2 (2026-10-01)**, `tools/drone/build-web-mesh-v2.mjs` (Node; `tools/drone` has its own package.json):
  40% smaller (3.6 to 2.2 GB) with identical look: geometry re-encoded, DJI's no-mipmap texture samplers fixed,
  the same JPEG bytes, and 657 nested tileset JSONs flattened to 1 root + 266 subtrees. With the `/navigate`
  loading changes (`features/navigation/lib/drone-warmup.ts`: at most 6 tile downloads in flight, decoder and root
  tileset prefetched on the 2D tab), a low-end phone at 12 Mbit/s sees the 3D tab's first picture at 1.6 s instead
  of 8.7 s, and a building fully sharp at 4.2 s instead of 7.0 s. Measured with `/dev-mesh-bench` and
  `tools/drone/bench-mesh.mjs`; the full table and commands are in `public/drone/README.md`.
- The mesh's sharpness ceiling is the survey itself: up close the walls show brick texture but warped window
  frames (a mostly top-down 2022 flight). Loading changes cannot add detail; reprocessing a better flight can.
- **Roads and walkways (2026-10-01)**, `tools/drone/build-paths.mjs` to `public/drone/paths.json` (~80 KB, committed):
  the 2D photo tiles read at 0.5 m/px; paved = neutral grey (asphalt, concrete, also in tree shade), pink pavers or
  blue walkway roofs, never on a roof from footprints.json (long thin unnamed roofs are covered walkways and count as
  paths); thinned to centre lines, traced to a graph, spurs pruned; dead ends carried on through tree canopy to the
  network they were heading for (cost raster: paving < shade < canopy < soil, roofs impassable). About 11 km of road,
  5.5 km of path, 5 km of gap links. **Hand corrections** in `tools/drone/paths-edits.json` (`add` polylines in scene
  metres for ways the photo cannot show, `remove` polygons), each with a reason; 12 so far (the gate avenue, the
  covered spines of the academic blocks, roads under canopy). Rerun after editing:
  `node tools/drone/build-paths.mjs "<web-mesh>/ortho" public/drone/paths.json --debug <dir>` (writes
  `paths-review.png`, the photo with the network drawn on it; `--probe x,z` traces a missing line through each step).
  Then `pnpm test` (the network test checks every building pair: reachable, off roofs, at most 2.8x the straight line).
- `features/navigation-3d/components/drone-layers.tsx`: loads the mesh (ECEF, then scene matrix), the thermal
  shader overlay and the terrain.
- **2D layers (2026-09-26):** `/dev-ortho` renders the mesh straight down (orthographic, 182 windows of 128 m at
  0.25 m/px, colour plus height encoded in RG). Then `tools/drone/build-ortho.py` builds:
  - the WebP tile pyramid, written into the mesh folder `ortho/`
  - `public/drone/footprints.json`: 190 roofed blocks, found where the surface is more than 2.5 m above terrain
    and not green. The script cuts covered walkways (11 px opening, then restores 1 m), drops strips thinner
    than 2.5 m, and drops pond-edge artifacts (they touch mesh holes). Each graph building **claims the roofs
    inside its outline** (with 4 m tolerance), which also splits roofs that touch. **42 of the 43 named
    buildings matched**; the other roofs are "Unnamed building".
  - Rebuild after renaming buildings: `python tools/drone/build-ortho.py "<raw>" "<web-mesh>/ortho" public/drone/footprints.json --graph .data/published_graph.json --terrain public/drone --skip-tiles`.
- Testing gotchas: the Claude in-app browser pane **pauses requestAnimationFrame** and reports
  `document.hidden`, which throttles timers to about 1 s. The capture page schedules with MessageChannel
  and calls `scene.updateMatrixWorld(true)` before `tiles.update()`. For real screenshots use headless Chrome:
  `chrome --headless=new --user-data-dir=<fresh dir> --window-size=1400,860 --virtual-time-budget=30000 --screenshot=out.png URL`.
  Use a fresh profile directory each time, or it hangs on a profile lock.

## 6. 3D studio roadmap (LOD 350 digital twin)

Goal: the architectural-board look (exploded axonometric, structural frame, section cuts).
- Phases: P0 schema, P1 procedural frame, P2 sketch/plan intake (admin plan tracer and rooms), P3 drone shell,
  P4 thermal layer, P5 presentation mode. **P0, P1, P2, P3, P4 (thermal overlay) and P5 have shipped.**
- Pilot buildings: `b-acad-w` (RC frame + basement), `b-east` (elongated, unequal bays), `b-hall` (long span),
  plus the Aero Block `n-blk-ne2`.
- Room code `AE301` = **AE**ronautical block, floor 3, room 01 (not Academic Block E). The owner works on that floor.
  The Aero 3rd floor (`shared/data/aero-block-3f.ts`) has real room identities from photos, but its
  dimensions are provisional.
- Known data defect: the graph records 2 floors for `n-blk-ne2`, but photos show at least 4. Floors 2-3 come
  from `shared/data/pilot-structure.ts`; remove them there once the graph is fixed.
- Settled, don't relitigate: drone RGB gives the **exterior only**, thermal **can't produce geometry**,
  and dimensioned per-floor plans are the key input. The standing ask is to get DWG/PDF floor plans from
  the college estate office. Before any new flight, check the DGCA Digital Sky airspace.

## 7. Campus data facts

- 48 areas, 115 floors, 70 nodes, 69 edges, a 29-point boundary. Outlines were traced from Esri Wayback
  imagery (release 49059 is cloud-free).
- **Many building names are placeholders** (for example "North Block B3", "Academic Block W"). Real names exist in
  `shared/data/campus-tour.ts` (119 tour labels, **no coordinates**). A human must match names to shapes,
  in the admin editor. Then rerun `build-ortho.py --skip-tiles`.
- Large real buildings with **no outline in the graph**, which show as unnamed on the 2D map: the big comb
  complex and the blue/red-roofed complex on the east side, and the red-tiled building south of the centre.
  They need tracing and naming in the admin editor.
- Draft writes carry a `baseRevision`, and stale tabs get a 409. Close admin tabs before hand-editing `.data/*.json`.

## 8. Open items / next steps

1. ~~Deploy the 2D photo tiles to the CDN~~ **Done 2026-09-30** (766 files; worker version 9a409121). To redeploy after
   rebuilding the tiles: from `<data>\_work\pages-deploy`, run `CI=true npx --prefix <repo> wrangler deploy`
   (**never run wrangler inside this repo**, because it converts the app to OpenNext). `_headers` has three
   non-overlapping rules: `*.b3dm`, `*.json` and `*.webp`.
2. Name the placeholder and unnamed buildings (needs the owner or estate-office input).
3. Connect the two disconnected parts of the walkway graph (admin editor).
4. ~~Deploy `/navigate` to Vercel~~ **Done 2026-09-30**: `campusnav-rose.vercel.app` serves it, with the photo 2D map
   from the CDN. To redeploy, run `npx vercel --prod --yes` from the repo (Hobby rejects uploads over ~100 MB;
   `.vercelignore` already excludes the mesh, tour and tools). The Vercel API is sometimes unreachable from
   the owner's network; if you see "fetch failed", retry.
5. Photogrammetry pilot on the **Aug 2022 RTK flight** (paused; downscaled to `pilot/images4k`). It covers only
   the NE corner (bus stop, East Pond, poly houses) with obliques. The new GPU makes this practical (see below).
6. Admin login: `ADMIN_EMAIL` and `ADMIN_PASSWORD` are unset on Vercel.
7. **Deploy web mesh v2 to the CDN** (built and verified 2026-10-01, not uploaded): `npx wrangler login`, then
   `npx wrangler deploy` from `D:\BIT 3D\_work\pages-deploy`. It replaces v1 at the same URLs (no Vercel env change).
   Then redeploy Vercel for the new 3D tab, the `/navigate` loading changes and the `/draco` cache header in `vercel.json`.

## 9. New laptop (RTX 3060 8 GB, 32 GB RAM): what it unlocks

- **Photogrammetry:** COLMAP and OpenMVS on CUDA. Resume the Aug 2022 RTK pilot for sharper, better-georeferenced
  meshes of the NE corner. Keep images downscaled (4K) to fit 8 GB of VRAM.
- **Full-detail mesh locally:** L22 tiles stream smoothly, so you can raise `errorTarget` quality while testing.
- **Faster 2D rebuilds:** `/dev-ortho` capture (about 30 min on the old laptop) and `build-ortho.py` both run faster.
  A finer 0.15 m/px capture is feasible.
- **Blender** (a Blender MCP server is configured): model or clean hero buildings (Aero Block, Central Hall)
  from the mesh and plans for the LOD 350 look.
- It does **not** solve the naming problem. That needs human knowledge of the campus.

## 10. Timeline (what was done, by whom and when)

- to 2026-09-07: base app, local file store, OSM and Esri tracing, 360 tour mirrored (`public/tour`, 119 panoramas).
- 09-14 to 09-16: LOD roadmap P0/P1/P2 (procedural frames, plan tracer, rooms), P5 presentation mode.
- 09-21: drone survey layers, real terrain, thermal overlay. Repo created and pushed.
- 09-22: moved to Vercel (campusnav-rose), panoramas and mesh on Supabase. Data moved from the flaky E: to D:.
- 09-23: full L22 mesh on the Cloudflare Worker, and on-screen-only tile streaming.
- 09-24 to 26: `/navigate` rebuilt several times. Final: its own header and sidebar, a 2D map built from the drone
  survey (photo plus detected blocks named from the 3D view), a 3D tab with the drone view and no explode.
- 10-01: web mesh v2 and the `/navigate` 3D loading changes, with a load benchmark; then the new 3D tab viewer
  (sharper, navigable everywhere); then 360 deg turning, top/side/street views and a 360 turn per building, and
  routing over roads and walkways detected from the drone photo with landmark turn-by-turn directions
  (`tools/drone/e2e-views-routes.mjs` checks both in Chrome). Nothing under `features/navigation-3d` was edited. Built on a second machine:
  project at `D:\campusnav`, survey on the USB drive `E:`, v2 mesh copied to `D:\BIT 3D`.
- 09-30: this file, and the campus data committed, for the move to the new laptop. 2D photo tiles uploaded to the
  CDN, and the site deployed to production and checked live (lint clean, typecheck clean, 416 tests pass).
