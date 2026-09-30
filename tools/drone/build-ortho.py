"""
Build the 2D map's drone layers from a top-down capture of the 3D mesh.

Input: the raw windows written by the capture page (rgb_{i}_{j}.png, h_{i}_{j}.png),
each `win` metres square at `mpp` metres per pixel, the first window's NW corner
at (x0, z0) in scene metres (X east, Z south, the 3D view's frame). Heights are
encoded as (y + 100) * 100 in the R (high) and G (low) bytes; 0/1 means no data.

Output:
  <tiles>/meta.json + <tiles>/<level>/<col>_<row>.webp  - orthophoto pyramid
  <footprints>                                          - every roofed block found,
      matched to the published graph's buildings so names carry over from the 3D view.

Usage:
  python tools/drone/build-ortho.py <raw_dir> <tiles_dir> <footprints.json> \
      --graph .data/published_graph.json --terrain public/drone [--preview out.png]
"""
import argparse
import json
import math
import os

import cv2
import numpy as np
from PIL import Image

# Must match lib/geo/projection.ts and features/navigation-3d/lib/campus-3d.ts.
MAP_ORIGIN = {"lat": 11.493317972, "lng": 77.275954400}
METRES_PER_STOREY = 3.5
TILE = 256
# Names that are land cover, not buildings (same idea as features/navigation/lib/place-kind.ts).
LAND_COVER = __import__("re").compile(r"pond|lake|tank|ground|court|track|stadium")


def metres_per_degree(lat):
    r = math.radians(lat)
    return (
        111132.92 - 559.82 * math.cos(2 * r) + 1.175 * math.cos(4 * r),
        111412.84 * math.cos(r) - 93.5 * math.cos(3 * r),
    )


PER_LAT, PER_LNG = metres_per_degree(MAP_ORIGIN["lat"])


def gps_to_metres(lat, lng):
    return ((lng - MAP_ORIGIN["lng"]) * PER_LNG, -(lat - MAP_ORIGIN["lat"]) * PER_LAT)


def graph_outline(b):
    fp = b.get("footprint")
    if isinstance(fp, list) and len(fp) >= 3:
        pts = [gps_to_metres(float(p["lat"]), float(p["lng"])) for p in fp if "lat" in p and "lng" in p]
        if len(pts) >= 3:
            return pts
    try:
        x, y, w, h = (float(b[k]) for k in ("x", "y", "width", "height"))
    except (KeyError, TypeError, ValueError):
        return None
    return [(x / 4, y / 4), ((x + w) / 4, y / 4), ((x + w) / 4, (y + h) / 4), (x / 4, (y + h) / 4)]


def load_terrain(d):
    meta = json.load(open(os.path.join(d, "terrain.json")))
    raw = np.fromfile(os.path.join(d, "terrain.bin"), dtype="<i2").astype(np.float32) / 10.0
    return meta, raw.reshape(meta["rows"], meta["cols"])


def terrain_at(meta, grid, xs, zs):
    """Bilinear, cell values at cell centres, edges clamp - as terrain.ts does."""
    fx = np.clip((xs - meta["originX"]) / meta["cell"] - 0.5, 0, meta["cols"] - 1)
    fz = np.clip((zs - meta["originZ"]) / meta["cell"] - 0.5, 0, meta["rows"] - 1)
    c0 = np.floor(fx).astype(int)
    r0 = np.floor(fz).astype(int)
    c1 = np.minimum(c0 + 1, meta["cols"] - 1)
    r1 = np.minimum(r0 + 1, meta["rows"] - 1)
    tx = fx - c0
    tz = fz - r0
    top = grid[r0, c0] * (1 - tx) + grid[r0, c1] * tx
    bot = grid[r1, c0] * (1 - tx) + grid[r1, c1] * tx
    return top * (1 - tz) + bot * tz


def mosaic(raw, cols, rows, px):
    rgba = np.zeros((rows * px, cols * px, 4), np.uint8)
    hgt = np.full((rows * px, cols * px), np.nan, np.float32)
    for j in range(rows):
        for i in range(cols):
            rp = os.path.join(raw, f"rgb_{i}_{j}.png")
            hp = os.path.join(raw, f"h_{i}_{j}.png")
            if not (os.path.exists(rp) and os.path.exists(hp)):
                continue
            a = np.array(Image.open(rp).convert("RGBA"))
            h = np.array(Image.open(hp).convert("RGBA")).astype(np.int32)
            v = h[..., 0] * 256 + h[..., 1]
            y = np.where(v > 1, v / 100.0 - 100.0, np.nan).astype(np.float32)
            rgba[j * px:(j + 1) * px, i * px:(i + 1) * px] = a
            hgt[j * px:(j + 1) * px, i * px:(i + 1) * px] = y
    return rgba, hgt


def write_pyramid(rgba, out, x0, z0, mpp, levels):
    os.makedirs(out, exist_ok=True)
    info = {"x0": x0, "z0": z0, "mpp": mpp, "tile": TILE, "levels": []}
    img = rgba
    files = 0
    for level in range(levels):
        if level > 0:
            # Premultiply so transparent edges do not bleed dark fringes when shrunk.
            f = img.astype(np.float32)
            f[..., :3] *= f[..., 3:4] / 255.0
            f = cv2.resize(f, (img.shape[1] // 2, img.shape[0] // 2), interpolation=cv2.INTER_AREA)
            a = np.maximum(f[..., 3:4], 1e-3)
            f[..., :3] = np.where(f[..., 3:4] > 0, f[..., :3] * 255.0 / a, 0)
            img = np.clip(f, 0, 255).astype(np.uint8)
        d = os.path.join(out, str(level))
        os.makedirs(d, exist_ok=True)
        cols = math.ceil(img.shape[1] / TILE)
        rows = math.ceil(img.shape[0] / TILE)
        present = []
        for r in range(rows):
            for c in range(cols):
                t = img[r * TILE:(r + 1) * TILE, c * TILE:(c + 1) * TILE]
                if t[..., 3].max() == 0:
                    continue
                pad = np.zeros((TILE, TILE, 4), np.uint8)
                pad[: t.shape[0], : t.shape[1]] = t
                Image.fromarray(pad, "RGBA").save(os.path.join(d, f"{c}_{r}.webp"), "WEBP", quality=80, method=5)
                present.append(f"{c}_{r}")
                files += 1
        info["levels"].append({"level": level, "mpp": mpp * 2 ** level, "cols": cols, "rows": rows, "tiles": present})
    json.dump(info, open(os.path.join(out, "meta.json"), "w"))
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("raw")
    ap.add_argument("tiles")
    ap.add_argument("footprints")
    ap.add_argument("--graph", required=True)
    ap.add_argument("--terrain", required=True)
    ap.add_argument("--x0", type=float, default=-620)
    ap.add_argument("--z0", type=float, default=-1215)
    ap.add_argument("--cols", type=int, default=13)
    ap.add_argument("--rows", type=int, default=14)
    ap.add_argument("--win", type=float, default=128)
    ap.add_argument("--mpp", type=float, default=0.25)
    ap.add_argument("--levels", type=int, default=5)
    ap.add_argument("--preview")
    ap.add_argument("--skip-tiles", action="store_true")
    a = ap.parse_args()

    px = int(round(a.win / a.mpp))
    rgba, hgt = mosaic(a.raw, a.cols, a.rows, px)
    print("mosaic", rgba.shape, "coverage", float((rgba[..., 3] > 0).mean()))

    if not a.skip_tiles:
        n = write_pyramid(rgba, a.tiles, a.x0, a.z0, a.mpp, a.levels)
        print("tiles written", n)

    # ---- footprints, on a 0.5 m grid ----
    s = 2
    g_mpp = a.mpp * s
    small = cv2.resize(rgba, (rgba.shape[1] // s, rgba.shape[0] // s), interpolation=cv2.INTER_AREA)
    h = cv2.resize(np.nan_to_num(hgt, nan=-999.0), (hgt.shape[1] // s, hgt.shape[0] // s), interpolation=cv2.INTER_NEAREST)
    H, W = h.shape
    xs = a.x0 + (np.arange(W) + 0.5) * g_mpp
    zs = a.z0 + (np.arange(H) + 0.5) * g_mpp
    X, Z = np.meshgrid(xs, zs)
    tmeta, tgrid = load_terrain(a.terrain)
    ground = terrain_at(tmeta, tgrid, X, Z)
    valid = (h > -900) & (small[..., 3] > 0)
    ndsm = np.where(valid, h - ground, 0).astype(np.float32)

    rgb = small[..., :3].astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    exg = (2 * g - r - b) / (r + g + b + 1e-3)
    # Green-dominant pixels are trees; pale-blue roof sheeting has a high
    # green index too, but its blue channel is higher still.
    veg = (exg > 0.05) & (g >= b)

    raised = valid & (ndsm > 2.5) & ~veg
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    mask = cv2.morphologyEx(raised.astype(np.uint8), cv2.MORPH_OPEN, k, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    # Covered walkways (up to ~5 m with their canopy) chain whole blocks into
    # one shape. Open wider than a walkway to find building cores, then give
    # back only the roof within 1 m of a core: the walkway does not come back.
    core = cv2.morphologyEx(mask, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_RECT, (11, 11)))
    mask = mask & cv2.dilate(core, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)))

    graph = json.load(open(a.graph, encoding="utf8"))
    snap = graph.get("snapshot", graph)
    # Only the campus: the survey also covers the village and farms around it.
    inside = np.ones((H, W), np.uint8)
    boundary = snap.get("boundary") or []
    if len(boundary) >= 3:
        bpoly = np.array(
            [[(x - a.x0) / g_mpp, (z - a.z0) / g_mpp] for x, z in (gps_to_metres(p["lat"], p["lng"]) for p in boundary)],
            np.int32,
        )
        inside = np.zeros((H, W), np.uint8)
        cv2.fillPoly(inside, [bpoly], 1)
        inside = cv2.dilate(inside, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)))

    min_px = int(45 / (g_mpp * g_mpp))
    min_named_px = int(20 / (g_mpp * g_mpp))

    # The 3D view's buildings, rasterised on the same grid. Grounds and ponds
    # carry no roof, so they never claim one.
    gb = []
    glabels = np.zeros((H, W), np.float32)
    for b in snap.get("buildings", []):
        o = graph_outline(b)
        if not o or LAND_COVER.search((b.get("name") or "").lower()):
            continue
        poly = np.array([[(x - a.x0) / g_mpp, (z - a.z0) / g_mpp] for x, z in o], np.int32)
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [poly], 1)
        glabels[m > 0] = len(gb) + 1
        gb.append({"id": b["id"], "name": b.get("name")})
    # Traced outlines are a few metres off in places: let each grow up to 4 m
    # into unclaimed ground, so a roof edge just outside still belongs to it.
    k3 = np.ones((3, 3), np.uint8)
    for _ in range(8):
        grown = cv2.dilate(glabels, k3)
        glabels = np.where(glabels == 0, grown, glabels)
    glabels = glabels.astype(np.int32)

    def outline_of(region):
        cnts, _ = cv2.findContours(region.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        c = max(cnts, key=cv2.contourArea)
        approx = cv2.approxPolyDP(c, 1.6, True)[:, 0, :]
        if len(approx) < 3:
            return None, c
        return [[round(a.x0 + (p[0] + 0.5) * g_mpp, 2), round(a.z0 + (p[1] + 0.5) * g_mpp, 2)] for p in approx], c

    def record(region, area_px, match):
        heights = ndsm[region]
        if np.percentile(heights, 75) < 3.0:
            return None
        outline, contour = outline_of(region)
        if not outline:
            return None
        # Covered walkways and hedges survive as long thin strips; roofs do not.
        (_, _), (rw, rh), _ = cv2.minAreaRect(contour)
        short, long_ = sorted((rw * g_mpp, rh * g_mpp))
        mean_width = 2 * cv2.contourArea(contour) * g_mpp / max(cv2.arcLength(contour, True), 1)
        if (short < 8 and long_ / max(short, 0.1) > 6) or mean_width < 2.5:
            return None
        top = float(np.percentile(heights, 90))
        return {
            "outline": outline,
            "areaM2": round(float(area_px) * g_mpp * g_mpp, 1),
            "heightM": round(top, 1),
            "storeys": max(1, int(round(top / METRES_PER_STOREY))),
            "buildingId": match["id"] if match else None,
            "name": match["name"] if match else None,
        }, contour

    out = []
    # 1. Each named building claims the roofs inside its outline. This also
    #    splits roofs that touch across two buildings along the traced line.
    for gi, b in enumerate(gb, start=1):
        piece = (mask > 0) & (glabels == gi)
        n, labels, stats, _ = cv2.connectedComponentsWithStats(piece.astype(np.uint8), connectivity=8)
        for lab in range(1, n):
            if stats[lab, cv2.CC_STAT_AREA] < min_named_px:
                continue
            r = record(labels == lab, stats[lab, cv2.CC_STAT_AREA], b)
            if r:
                out.append(r[0])

    # Water has no photogrammetry, so ponds are holes in the mesh; the mesh
    # skirts their banks with false "roofs". Real roofs never touch a hole.
    near_hole = cv2.dilate((~valid).astype(np.uint8), np.ones((7, 7), np.uint8)) & inside

    # 2. Roofs no building claims stay as unnamed blocks, campus only.
    rest = (mask > 0) & (glabels == 0) & (inside > 0)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(rest.astype(np.uint8), connectivity=8)
    for lab in range(1, n):
        if stats[lab, cv2.CC_STAT_AREA] < min_px:
            continue
        r = record(labels == lab, stats[lab, cv2.CC_STAT_AREA], None)
        if not r:
            continue
        f, c = r
        if near_hole[labels == lab].any():
            continue
        # Roofs are compact; tree lines and pond banks are ragged.
        hull = cv2.contourArea(cv2.convexHull(c))
        if hull <= 0 or cv2.contourArea(c) / hull < 0.6:
            continue
        out.append(f)

    out.sort(key=lambda f: -f["areaM2"])
    for i, f in enumerate(out):
        f["id"] = f"fp-{i + 1:03d}"
    named = sum(1 for f in out if f["buildingId"])
    matched_ids = {f["buildingId"] for f in out if f["buildingId"]}
    json.dump(
        {
            "source": "Drone mesh (DJI Terra, April 2022), rendered top-down; heights above tools/drone terrain.",
            "footprints": out,
        },
        open(a.footprints, "w", encoding="utf8"),
        separators=(",", ":"),
    )
    print(f"footprints {len(out)}; named from graph {named}; graph buildings matched {len(matched_ids)}/{len(gb)}")
    unmatched = [b["name"] for b in gb if b["id"] not in matched_ids]
    print("graph buildings with no roof found:", unmatched)

    if a.preview:
        pv = cv2.cvtColor(small[..., :3], cv2.COLOR_RGB2BGR).copy()
        for f in out:
            poly = np.array([[(x - a.x0) / g_mpp, (z - a.z0) / g_mpp] for x, z in f["outline"]], np.int32)
            cv2.polylines(pv, [poly], True, (0, 255, 0) if f["buildingId"] else (0, 0, 255), 2)
        for i, b in enumerate(snap.get("buildings", [])):
            o = graph_outline(b)
            if o:
                poly = np.array([[(x - a.x0) / g_mpp, (z - a.z0) / g_mpp] for x, z in o], np.int32)
                cv2.polylines(pv, [poly], True, (255, 200, 0), 1)
        cv2.imwrite(a.preview, pv)


if __name__ == "__main__":
    main()
