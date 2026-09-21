# -*- coding: utf-8 -*-
"""Mirror the BIT campus tour panoramas locally as stitched cube faces.

Each panorama is stored as six 1024x1024 JPEGs (level 2 = 2x2 tiles of 512px),
which is what a cubemap viewer needs — no tiling logic required at runtime.
"""
import io, json, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from PIL import Image

BASE = "https://campustour.bitsathy.ac.in"
FACES = ["f", "b", "l", "r", "u", "d"]
LEVEL = 2
GRID = 2
TILE = 512


def fetch(url, tries=3):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "campusnav-mirror/1.0"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def build_face(pano_id, face, out_dir):
    out = os.path.join(out_dir, f"{face}.jpg")
    if os.path.exists(out) and os.path.getsize(out) > 2000:
        return True
    canvas = Image.new("RGB", (TILE * GRID, TILE * GRID))
    # Tiles are named {row}_{column}, so the column drives x and the row y.
    for row in range(GRID):
        for col in range(GRID):
            data = fetch(f"{BASE}/media/{pano_id}_0/{face}/{LEVEL}/{row}_{col}.jpg")
            if not data:
                return False
            canvas.paste(Image.open(io.BytesIO(data)), (col * TILE, row * TILE))
    canvas.save(out, "JPEG", quality=82, optimize=True)
    return True


def mirror(scene, root):
    idx, pano_id = scene["i"], scene["id"]
    out_dir = os.path.join(root, str(idx))
    os.makedirs(out_dir, exist_ok=True)
    ok = all(build_face(pano_id, f, out_dir) for f in FACES)
    thumb = os.path.join(out_dir, "thumb.jpg")
    if not os.path.exists(thumb):
        data = fetch(f"{BASE}/media/{pano_id}_t.jpg")
        if data:
            open(thumb, "wb").write(data)
    return idx, ok


if __name__ == "__main__":
    scenes = json.load(open(sys.argv[1], encoding="utf-8"))["items"]
    root = sys.argv[2]
    os.makedirs(root, exist_ok=True)
    done = failed = 0
    with ThreadPoolExecutor(max_workers=6) as pool:
        for idx, ok in pool.map(lambda s: mirror(s, root), scenes):
            done += 1
            if not ok:
                failed += 1
                print(f"  scene {idx}: INCOMPLETE", flush=True)
            if done % 10 == 0:
                print(f"  {done}/{len(scenes)} panoramas", flush=True)
    print(f"mirrored {done - failed}/{done} panoramas into {root}")
