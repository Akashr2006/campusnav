# Campus tracing toolchain

The scripts that produced the current campus data. Kept so the work is
reproducible rather than a one-off. Plain Python — needs `pillow`, `numpy`,
`opencv-python`.

Run them from the project root.

## Scripts

| File | Purpose |
| --- | --- |
| `mosaic.py` | stitch Esri World Imagery tiles into a georeferenced mosaic |
| `wayback_mosaic.py` | same, from a dated Esri **Wayback** release (what the current data used) |
| `wayback_probe.py` | score recent Wayback releases for cloud cover over the campus |
| `extract_outline.py` | roof-colour mask → contour → simplified building polygon |
| `build_campus.py` | projection helpers + OSM roads → campus graph skeleton |
| `mirror_tour.py` | download the 360 tour as stitched cube faces |
| `cube2equi.py` | cube faces → 4096×2048 equirectangular panorama |

## Data

- `traced*.json` — hand-drawn boxes, in mosaic pixel coordinates, per area
- `traced_all_gps.json` — the extracted polygons in lat/lng (what got installed)
- `panolist.txt` / `scenes_full.json` — the 119 tour scenes with panorama ids

## Typical flow

```bash
# 1. find a cloud-free imagery release
python tools/campus-trace/wayback_probe.py <scratch-dir>

# 2. stitch a mosaic of the area you want to trace
#    (edit the bbox/zoom at the bottom of the script)
python tools/campus-trace/wayback_mosaic.py

# 3. draw rough boxes over buildings in a traced*.json, in mosaic pixels

# 4. extract real outlines and convert to lat/lng, then rebuild the graph
#    (see the inline snippets in HANDOFF.md for the exact glue)
```

## Gotchas

- Tour tiles are named `{row}_{col}`, not `{col}_{row}`.
- Wayback release **49059 (2026-04-30)** is the cloud-free one for this campus;
  the newest releases are cloudier.
- Always draw a trace back onto the imagery before installing it. Doing that
  caught two bad footprints (one sitting on tree canopy, one a duplicate).
