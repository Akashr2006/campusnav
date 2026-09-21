# -*- coding: utf-8 -*-
"""Convert mirrored cube faces into a single equirectangular panorama.

An equirect image is trivial to pan with a background offset, which avoids the
CSS 3D stacking-context problems the cube viewer ran into.
"""
import os, sys
import numpy as np
from PIL import Image

OUT_W, OUT_H = 4096, 2048
FACES = ["f", "b", "l", "r", "u", "d"]


def load_faces(folder):
    faces = {}
    for f in FACES:
        path = os.path.join(folder, f"{f}.jpg")
        if not os.path.exists(path):
            return None
        faces[f] = np.asarray(Image.open(path).convert("RGB"))
    return faces


def convert(folder, out_path, size=(OUT_W, OUT_H)):
    faces = load_faces(folder)
    if faces is None:
        return False
    W, H = size
    fs = faces["f"].shape[0]  # faces are square

    lon = (np.linspace(0, 1, W, endpoint=False) + 0.5 / W) * 2 * np.pi - np.pi
    lat = np.pi / 2 - (np.linspace(0, 1, H, endpoint=False) + 0.5 / H) * np.pi
    lon, lat = np.meshgrid(lon, lat)

    # Direction vector per output pixel. +Z forward, +Y up, +X right.
    x = np.cos(lat) * np.sin(lon)
    y = np.sin(lat)
    z = np.cos(lat) * np.cos(lon)

    ax, ay, az = np.abs(x), np.abs(y), np.abs(z)
    out = np.zeros((H, W, 3), dtype=np.uint8)

    def sample(mask, face, u, v):
        if not mask.any():
            return
        iu = np.clip(((u[mask] + 1) * 0.5 * fs).astype(np.int32), 0, fs - 1)
        iv = np.clip(((v[mask] + 1) * 0.5 * fs).astype(np.int32), 0, fs - 1)
        out[mask] = faces[face][iv, iu]

    # Front (+Z) / Back (-Z)
    m = (az >= ax) & (az >= ay) & (z > 0)
    sample(m, "f", x / np.where(az == 0, 1, az), -y / np.where(az == 0, 1, az))
    m = (az >= ax) & (az >= ay) & (z <= 0)
    sample(m, "b", -x / np.where(az == 0, 1, az), -y / np.where(az == 0, 1, az))

    # Right (+X) / Left (-X)
    m = (ax >= ay) & (ax > az) & (x > 0)
    sample(m, "r", -z / np.where(ax == 0, 1, ax), -y / np.where(ax == 0, 1, ax))
    m = (ax >= ay) & (ax > az) & (x <= 0)
    sample(m, "l", z / np.where(ax == 0, 1, ax), -y / np.where(ax == 0, 1, ax))

    # Up (+Y) / Down (-Y)
    m = (ay > ax) & (ay > az) & (y > 0)
    sample(m, "u", x / np.where(ay == 0, 1, ay), z / np.where(ay == 0, 1, ay))
    m = (ay > ax) & (ay > az) & (y <= 0)
    sample(m, "d", x / np.where(ay == 0, 1, ay), -z / np.where(ay == 0, 1, ay))

    Image.fromarray(out).save(out_path, "JPEG", quality=84, optimize=True)
    return True


if __name__ == "__main__":
    root = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    done = 0
    for name in sorted(os.listdir(root), key=lambda n: int(n) if n.isdigit() else -1):
        folder = os.path.join(root, name)
        if not name.isdigit() or not os.path.isdir(folder):
            continue
        if only and name != only:
            continue
        out = os.path.join(folder, "pano.jpg")
        if os.path.exists(out) and os.path.getsize(out) > 5000:
            done += 1
            continue
        if convert(folder, out):
            done += 1
            if done % 10 == 0:
                print(f"  {done} panoramas", flush=True)
    print(f"equirect written for {done} panoramas")
