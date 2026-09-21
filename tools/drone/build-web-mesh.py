"""
Make a web-sized copy of the DJI Terra 3D Tiles mesh.

The full survey mesh is ~3 GB and goes down to level 22 (a few cm per texel),
far more than a navigation backdrop needs. 3D Tiles are a tree of levels with
REPLACE refinement, so cutting every tile deeper than --max-level leaves a
valid tileset whose deepest remaining tiles become the leaves. Only the files
the pruned tree still references are copied.

    python tools/drone/build-web-mesh.py "E:/BIT 3D/_extracted/BIT 3D full/models/pc/0/terra_b3dms" public/drone/mesh --max-level 22
"""
import argparse
import json
import re
import struct
import time
from pathlib import Path

LEVEL = re.compile(r"_L(\d+)_")


def level_of(uri: str) -> int | None:
    m = LEVEL.search(uri)
    return int(m.group(1)) if m else None


def prune(node: dict, max_level: int, keep: set[str], base: str) -> None:
    kept = []
    for child in node.get("children", []):
        uri = child.get("content", {}).get("uri")
        lvl = level_of(uri) if uri else None
        if lvl is not None and lvl > max_level:
            continue
        prune(child, max_level, keep, base)
        kept.append(child)
    if kept:
        node["children"] = kept
    else:
        node.pop("children", None)
        # A leaf must not ask to be refined further.
        node["geometricError"] = 0.0
    uri = node.get("content", {}).get("uri")
    if uri:
        keep.add(str(Path(base) / uri))


def read_bytes(path: Path, tries: int = 6) -> bytes:
    """The survey lives on a USB drive that drops out for a moment now and then."""
    for i in range(tries):
        try:
            return path.read_bytes()
        except OSError:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))
    raise AssertionError


def fix_b3dm(data: bytes) -> bytes:
    """
    DJI Terra puts KHR_materials_unlit on every material but leaves it out of
    extensionsUsed, and three's GLTFLoader only wires up declared extensions,
    so it crashes reading the material. Declare it and re-pack the GLB.
    """
    ft_json, ft_bin, bt_json, bt_bin = struct.unpack("<IIII", data[12:28])
    head = 28 + ft_json + ft_bin + bt_json + bt_bin
    glb = data[head:]
    json_len = struct.unpack("<I", glb[12:16])[0]
    doc = json.loads(glb[20 : 20 + json_len])
    used = doc.setdefault("extensionsUsed", [])
    if "KHR_materials_unlit" in used:
        return data
    used.append("KHR_materials_unlit")
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    rest = glb[20 + json_len :]
    new_glb = glb[:4] + struct.pack("<I", 2) + struct.pack("<I", 12 + 8 + len(js) + len(rest))
    new_glb += struct.pack("<I", len(js)) + b"JSON" + js + rest
    out = bytearray(data[:head] + new_glb)
    struct.pack_into("<I", out, 8, len(out))
    return bytes(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src", type=Path)
    ap.add_argument("dst", type=Path)
    ap.add_argument("--max-level", type=int, default=19)
    args = ap.parse_args()

    done: set[str] = set()
    queue = ["tileset.json"]
    copied = 0
    size = 0
    while queue:
        rel = queue.pop()
        if rel in done:
            continue
        done.add(rel)
        doc = json.loads(read_bytes(args.src / rel))
        keep: set[str] = set()
        base = str(Path(rel).parent)
        prune(doc["root"], args.max_level, keep, base)
        out = args.dst / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(doc, separators=(",", ":")))
        for k in keep:
            k = Path(k).as_posix().removeprefix("./")
            if k.endswith(".json"):
                queue.append(k)
            else:
                target = args.dst / k
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(fix_b3dm(read_bytes(args.src / k)))
                copied += 1
                size += target.stat().st_size
    print(f"{len(done)} tileset files, {copied} tiles, {size / 1e6:.0f} MB -> {args.dst}")


if __name__ == "__main__":
    main()
