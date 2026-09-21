# -*- coding: utf-8 -*-
"""Stitch a georeferenced mosaic from a dated Esri Wayback release."""
import io, json, math, os, sys, urllib.request
from PIL import Image

TILE = 256
TPL = ("https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/"
       "1.0.0/default028mm/MapServer/tile/{rel}/{z}/{y}/{x}")


def lng_to_tx(lng, z): return (lng + 180.0) / 360.0 * (2 ** z)
def lat_to_ty(lat, z):
    r = math.radians(lat)
    return (1.0 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2.0 * (2 ** z)
def tx_to_lng(x, z): return x / (2 ** z) * 360.0 - 180.0
def ty_to_lat(y, z):
    n = math.pi - 2.0 * math.pi * y / (2 ** z)
    return math.degrees(math.atan(math.sinh(n)))


def build(rel, minLat, minLng, maxLat, maxLng, z, out_png, out_meta):
    x0, x1 = int(lng_to_tx(minLng, z)), int(lng_to_tx(maxLng, z))
    y0, y1 = int(lat_to_ty(maxLat, z)), int(lat_to_ty(minLat, z))
    cols, rows = x1 - x0 + 1, y1 - y0 + 1
    print(f"release {rel} z{z}: {cols}x{rows} = {cols*rows} tiles")
    canvas = Image.new("RGB", (cols * TILE, rows * TILE))
    for ix, x in enumerate(range(x0, x1 + 1)):
        for iy, y in enumerate(range(y0, y1 + 1)):
            url = TPL.format(rel=rel, z=z, x=x, y=y)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "campusnav/1.0"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    canvas.paste(Image.open(io.BytesIO(r.read())), (ix * TILE, iy * TILE))
            except Exception as e:
                print("  tile failed", x, y, e)
    canvas.save(out_png)
    json.dump({"z": z, "x0": x0, "y0": y0, "width": cols * TILE, "height": rows * TILE,
               "release": rel}, open(out_meta, "w"), indent=1)
    print("saved", out_png, canvas.size)


def px_to_gps(px, py, meta):
    return ty_to_lat(meta["y0"] + py / TILE, meta["z"]), tx_to_lng(meta["x0"] + px / TILE, meta["z"])


def gps_to_px(lat, lng, meta):
    return ((lng_to_tx(lng, meta["z"]) - meta["x0"]) * TILE,
            (lat_to_ty(lat, meta["z"]) - meta["y0"]) * TILE)
