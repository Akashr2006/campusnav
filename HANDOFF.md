# CampusNav — handoff notes (2026-09-07)

State of the project after the satellite-tracing / 360-tour work. Written for
whoever picks this up next.

## Running it

```bash
cd campusnav-main
pnpm dev -p 3001
```

Port 3000 was occupied on this machine; nothing depends on 3001.

**`pnpm dev -- -p 3001` does not work** — pnpm forwards `--` literally and Next
reads it as a directory (`no such directory: ...\-p`). Use `pnpm dev -p 3001`.

**Never run `next build` while the dev server is running.** They share `.next`
and the build corrupts the dev server's chunks (`Cannot find module './5115.js'`).
Stop dev first, or accept a restart. `pnpm build` also runs `prisma generate`,
which fails with `EPERM` on Windows while the dev server holds the query-engine
DLL — `pnpm exec next build` skips that step.

## There is no database, by design

`DATABASE_URL` is unset and Postgres is not installed here. The app runs from a
**local file store** instead:

- `.data/published_graph.json` — the live map
- `.data/draft_graph.json` — the admin working copy

`lib/local-graph-store.ts` implements it; the API routes fall back to it
whenever `isDatabaseConfigured()` is false. Setting `DATABASE_URL` restores the
Postgres path with no other changes.

The admin panel is reachable at `/admin/login`. The guard is **client-side only**
(`sessionStorage.campusnav_admin_auth`), so `/admin` is not protected server-side.
The API routes are the real access control.

### Draft writes are version-checked

The admin client autosaves its whole in-memory graph. A stale tab used to
silently overwrite newer data, and because the next page load read back what
that tab had just written, the stale copy stuck. Writes now carry a
`baseRevision`; the server rejects stale or unversioned writes with `409`
(`lib/draft-revision.ts`). If you edit `.data/*.json` by hand, **close every
admin tab first** or the open tab may overwrite you.

## Campus data — where it came from

48 areas, 115 floors, 70 nodes, 69 edges, 29-point boundary.

| Source | What it gave |
| --- | --- |
| OpenStreetMap (Overpass) | campus perimeter + 5 internal service roads |
| Esri Wayback imagery | every building outline, traced |
| Vercel deployment | the original 4-building dataset (backed up, no longer live) |

**Imagery release matters.** The default Esri `World_Imagery` layer has ~11%
cloud directly over this campus. Esri Wayback release **49059 (2026-04-30)** is
cloud-free — that constant is in `lib/geo/tiles.ts`. Counter-intuitively the
*newest* captures (2026-05-28 onward) are the cloudy ones.

Outlines were extracted with OpenCV (roof colour mask → contour → polygon
simplify, clipped to a hand-drawn box). 41 of 48 are real polygons averaging 13
vertices; 7 fell back to rectangles where the mask wasn't confident.

### ⚠ The building names are placeholders

"North Block C3", "Academic Block W", "East Block 4" are **invented**. Nothing
in any source links a traced polygon to a real block name:

- the 360 tour has labels but **no coordinates** (verified — its config has zero
  lat/lng/map keys)
- OSM has only 2 buildings here, one generically named

The real names are all sitting in `shared/data/campus-tour.ts` (119 of them:
Aero Block, BT Block, Spl Lab Block, Mech Block, Learning Centre, Boys/Girls
Mess, Girls Hostel, Sports Complex, Fashion Tech, T & P, Netcafe, Community
Radio, Medical Centre…). **A human has to match names to shapes.** Once that's
done, the 360 panoramas link to buildings automatically by name via
`findTourScene()`.

Trace verification images are in the session scratchpad (`trace_check.png`,
`north_trace_check.png`, `outline_check_north.png`) — regenerate by re-running
the scripts if needed.

## The 360 tour is mirrored locally

`public/tour/` — 119 panoramas, 218 MB. Each folder has six 1024×1024 cube faces
plus `pano.jpg`, a 4096×2048 equirectangular render.

The viewer (`features/navigation/components/cubemap-viewer.tsx`) pans the
equirect image with a background offset. An earlier CSS-3D cubemap version was
abandoned: the six faces kept getting flattened by an ancestor stacking context.
Equirect is far more robust — no `preserve-3d`, no stacking traps.

Two bugs worth remembering if you re-mirror:
- tiles are named `{row}_{col}`, **not** `{col}_{row}` — getting this wrong
  produces faces made of four transposed quadrants
- Tailwind preflight's `img { max-width: 100% }` collapses absolutely-positioned
  panorama images to zero width; set `maxWidth: "none"`

`PanoramaViewer` has a Hosted/Local toggle; local is the default.

## Map rendering notes

- The canvas is **metric**: `PIXELS_PER_METER = 4`, origin at the campus SW
  corner (`lib/geo/projection.ts`). The scale bar is therefore truthful.
- Buildings render flat in plan view and extrude when the camera is tilted
  (0° → 45° → 65°).
- `HEIGHT_EXAGGERATION = 3.5` in `campus-map.tsx`. True-to-scale buildings look
  flat from above; this is the same trick terrain renderers use. Change this
  number, **not** `METRES_PER_STOREY` (3.5 m, which the data depends on).
- Walls carry one line per storey. A blank extruded quad reads as a crate; the
  banding is most of what makes it read as a building.
- Coordinates can be **negative**. The map bounds used to clamp the origin to 0,
  which pushed the whole campus off-screen for real data.

## Known gaps

1. **Names** (above) — the biggest blocker.
2. `pnpm lint` passes, `pnpm typecheck` passes, 256 tests pass.
3. The dev server died on its own a couple of times early on, with the log full
   of `Watchpack Error … lstat 'C:\pagefile.sys'`. Never reproduced after
   `.data/`, `backup/` and `*.log` were added to the watcher ignore list in
   `next.config.ts`. If it recurs, that log is the place to look.
4. No sub-rooms anywhere — deliberately, pending that data.
5. Analytics page shows real graph statistics. It previously showed fabricated
   session numbers; do not reintroduce those.

## Backups

- `backup/navigation-20260907/` — the whole navigation stack before the rebuild
- `backup/campus-data-20260907-1049/` — the original Vercel campus data

Both have restore commands in their own README.
