# -*- coding: utf-8 -*-
"""Score recent Wayback releases over the campus for cloud cover."""
import io, json, os, sys, math, urllib.request
import numpy as np
from PIL import Image

TPL = ("https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/"
       "1.0.0/default028mm/MapServer/tile/{rel}/{z}/{y}/{x}")
sp = sys.argv[1]
Z = 16
LAT, LNG = 11.4946, 77.2773   # campus centre


def tile_xy(lat, lng, z):
    r = math.radians(lat)
    x = int((lng + 180) / 360 * 2 ** z)
    y = int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z)
    return x, y


def grab(rel, x, y, z):
    url = TPL.format(rel=rel, z=z, x=x, y=y)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "campusnav/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            return Image.open(io.BytesIO(r.read())).convert("RGB")
    except Exception:
        return None


def cloud_score(im):
    """Fraction of pixels that are bright and desaturated — i.e. cloud."""
    a = np.asarray(im).astype(np.float32)
    mx, mn = a.max(axis=2), a.min(axis=2)
    sat = np.where(mx == 0, 0, (mx - mn) / np.maximum(mx, 1))
    bright = a.mean(axis=2)
    return float(((bright > 165) & (sat < 0.16)).mean())


cfg = json.load(open(os.path.join(sp, "wayback.json"), encoding="utf-8"))
rels = sorted(
    ((v.get("itemTitle", ""), k) for k, v in cfg.items()),
    reverse=True,
)[:14]

x0, y0 = tile_xy(LAT, LNG, Z)
results = []
for title, rel in rels:
    tiles = [grab(rel, x0 + dx, y0 + dy, Z) for dx in (0, 1) for dy in (0, 1)]
    tiles = [t for t in tiles if t is not None]
    if not tiles:
        continue
    score = sum(cloud_score(t) for t in tiles) / len(tiles)
    date = title.split("Wayback ")[-1].rstrip(")")
    results.append((score, date, rel))
    print(f"  {date}  cloud {score*100:5.1f}%   release {rel}", flush=True)

results.sort()
json.dump([{"cloud": s, "date": d, "release": r} for s, d, r in results],
          open(os.path.join(sp, "wayback_scores.json"), "w"), indent=1)
print("\nclearest:", results[0][1], f"({results[0][0]*100:.1f}% cloud)" if results else "n/a")
