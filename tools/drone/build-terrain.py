"""
Bare-earth terrain grid from the DJI Terra mesh, for seating the 3D scene on
the real ground (the campus falls ~60 m north to south).

Decodes every tile at one level, takes the lowest surface point per cell, then
removes buildings and trees with a morphological opening. On a planar slope an
opening with a flat element is exact, so the 100 m window strips structures
without flattening the hillside. Heights are written relative to the anchor in
public/drone/mesh-alignment.json, as Int16 decimetres, row-major north to south.

    python tools/drone/build-terrain.py "E:/BIT 3D/_extracted/BIT 3D full/models/pc/0/terra_b3dms" public/drone
"""
import argparse, glob, json, math, struct, time
from pathlib import Path

import DracoPy
import numpy as np
from pyproj import Transformer
from scipy import ndimage

# Must match lib/geo/projection.ts MAP_ORIGIN and gpsToMetres.
LAT0, LNG0 = 11.493317972, 77.275954400
LR = math.radians(LAT0)
PER_LAT = 111132.92 - 559.82 * math.cos(2 * LR) + 1.175 * math.cos(4 * LR)
PER_LNG = 111412.84 * math.cos(LR) - 93.5 * math.cos(3 * LR)


def read_bytes(path: str, tries: int = 6) -> bytes:
    """The survey lives on a USB drive that drops out for a moment now and then."""
    for i in range(tries):
        try:
            with open(path, "rb") as fh:
                return fh.read()
        except OSError:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))
    raise AssertionError


def tile_points(src: Path, level: int) -> np.ndarray:
    ecef_to_geo = Transformer.from_crs(4978, 4979, always_xy=True)
    out = []
    for block in sorted(p.name for p in src.iterdir() if p.is_dir()):
        root = json.loads(read_bytes(str(src / block / "tileset.json")))["root"]
        T = np.array(root["transform"]).reshape(4, 4).T
        for f in glob.glob(str(src / block / f"{block}_L{level}_*.b3dm")):
            data = read_bytes(f)
            ftj, ftb, btj, btb = struct.unpack("<IIII", data[12:28])
            glb = data[28 + ftj + ftb + btj + btb :]
            jl = struct.unpack("<I", glb[12:16])[0]
            doc = json.loads(glb[20 : 20 + jl])
            binary = glb[20 + jl + 8 :]
            for mesh in doc["meshes"]:
                for prim in mesh["primitives"]:
                    bv = doc["bufferViews"][prim["extensions"]["KHR_draco_mesh_compression"]["bufferView"]]
                    o = bv.get("byteOffset", 0)
                    q = np.asarray(DracoPy.decode(binary[o : o + bv["byteLength"]]).points, dtype=np.float64)
                    out.append((np.c_[q, np.ones(len(q))] @ T.T)[:, :3])
    P = np.vstack(out)
    lon, lat, h = ecef_to_geo.transform(P[:, 0], P[:, 1], P[:, 2])
    return np.c_[(lon - LNG0) * PER_LNG, -(lat - LAT0) * PER_LAT, h]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--level", type=int, default=18)
    ap.add_argument("--cell", type=float, default=5.0)
    ap.add_argument("--window", type=float, default=100.0, help="opening size in metres")
    args = ap.parse_args()

    anchor = json.loads((args.out / "mesh-alignment.json").read_text())["groundHeight"]
    P = tile_points(args.src, args.level)
    c = args.cell
    x0, z0 = math.floor(P[:, 0].min() / c) * c, math.floor(P[:, 1].min() / c) * c
    W = int((P[:, 0].max() - x0) / c) + 1
    H = int((P[:, 1].max() - z0) / c) + 1
    ix = ((P[:, 0] - x0) / c).astype(int)
    iz = ((P[:, 1] - z0) / c).astype(int)
    low = np.full((H, W), np.inf)
    np.minimum.at(low, (iz, ix), P[:, 2])

    known = np.isfinite(low)
    # Fill holes from the nearest measured cell so the opening has no voids.
    idx = ndimage.distance_transform_edt(~known, return_distances=False, return_indices=True)
    filled = low[tuple(idx)]
    k = int(args.window / c) | 1
    ground = ndimage.grey_opening(filled, size=(k, k))
    ground = ndimage.uniform_filter(ground, size=5)

    rel = np.round((ground - anchor) * 10).astype("<i2")
    (args.out / "terrain.bin").write_bytes(rel.tobytes())
    meta = {
        "originX": x0, "originZ": z0, "cell": c, "cols": W, "rows": H,
        "units": "decimetres relative to groundHeight in mesh-alignment.json, Int16 LE, row-major by z",
        "anchor": anchor,
        "min": float(ground.min() - anchor), "max": float(ground.max() - anchor),
        "measuredFraction": float(known.mean()),
    }
    (args.out / "terrain.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
