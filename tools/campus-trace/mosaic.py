# -*- coding: utf-8 -*-
"""Stitch Esri World Imagery tiles into one georeferenced mosaic for tracing."""
import io, json, math, os, sys, urllib.request
from PIL import Image

TILE = 256
URL = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"

def lng_to_tx(lng, z): return (lng + 180.0) / 360.0 * (2 ** z)
def lat_to_ty(lat, z):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1/math.cos(r)) / math.pi) / 2.0 * (2 ** z)
def tx_to_lng(x, z): return x / (2 ** z) * 360.0 - 180.0
def ty_to_lat(y, z):
    n = math.pi - 2.0 * math.pi * y / (2 ** z)
    return math.degrees(math.atan(math.sinh(n)))

def build(minLat, minLng, maxLat, maxLng, z, out_png, out_meta):
    x0, x1 = int(lng_to_tx(minLng, z)), int(lng_to_tx(maxLng, z))
    y0, y1 = int(lat_to_ty(maxLat, z)), int(lat_to_ty(minLat, z))
    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    print(f"z{z}: {cols}x{rows} = {cols*rows} tiles")
    canvas = Image.new("RGB", (cols * TILE, rows * TILE))
    for ix, x in enumerate(range(x0, x1 + 1)):
        for iy, y in enumerate(range(y0, y1 + 1)):
            url = URL.format(z=z, x=x, y=y)
            req = urllib.request.Request(url, headers={"User-Agent": "campusnav-trace/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                canvas.paste(Image.open(io.BytesIO(r.read())), (ix * TILE, iy * TILE))
    canvas.save(out_png)
    meta = {"z": z, "x0": x0, "y0": y0, "cols": cols, "rows": rows,
            "width": cols * TILE, "height": rows * TILE,
            "nwLat": ty_to_lat(y0, z), "nwLng": tx_to_lng(x0, z),
            "seLat": ty_to_lat(y1 + 1, z), "seLng": tx_to_lng(x1 + 1, z)}
    json.dump(meta, open(out_meta, "w"), indent=1)
    print("saved", out_png, canvas.size, "->", meta["nwLat"], meta["nwLng"])

def px_to_gps(px, py, meta):
    """Mosaic pixel -> lat/lng (exact slippy-map inverse)."""
    z = meta["z"]
    return (ty_to_lat(meta["y0"] + py / TILE, z), tx_to_lng(meta["x0"] + px / TILE, z))

if __name__ == "__main__":
    sp = sys.argv[1]
    build(11.4884, 77.2729, 11.5011, 77.2817, 17,
          os.path.join(sp, "campus_z17.png"), os.path.join(sp, "campus_z17.json"))
