---
name: bit3d-drone-dataset
description: "The user's \"gold mine\" drone dataset at E:\\BIT 3D — contents, measured accuracy, and how it is wired into CampusNav (shipped 2026-09-21)."
metadata: 
  node_type: memory
  type: reference
  originSessionId: e1b9d2fd-51f1-48be-9cec-cc7b846b6b4f
  modified: 2026-09-21T09:54:23.537Z
---

**Data moved 2026-09-22 to `D:\BIT 3D` (internal, verified identical). E: (flaky USB) is retired; ignore E: paths below and read them as D:.**

`E:\BIT 3D` is DJI Terra output for the campus (about 11.4976N, 77.2755E). The user calls it the "gold mine data".
- `BIT 3D.zip` holds the full mesh: 3D Tiles in 4 blocks, Draco-compressed, levels L13–L22. It was extracted to `E:\BIT 3D\_extracted\BIT 3D full` and all 17,766 mesh files were verified. The point-cloud (`terra_pnts`) extraction failed; it isn't needed. The loose `BIT 3D/` folder is only a partial copy.
- **E: drops out intermittently** (unzip "No medium found", EINVAL on read). Retry before assuming the data is bad.
- RGB flight April 2022, no RTK (10.4 m RMSE reported). Measured against graph footprints, the offset is effectively 0.
- **Site falls ~60 m S→N** (ellipsoidal ground 282→222 m). Real terrain has been in the scene since 2026-09-21: `public/drone/terrain.*` (built by `tools/drone/build-terrain.py`), loaded by `useTerrain()` and `features/navigation-3d/lib/terrain.ts`. Everything measures y from groundHeight 265.4, and buildings sit at the lowest ground under their outline.
- Thermal (AS & IB only) is an 8-bit false-colour render, NOT radiometric. It can't give °C.
- `BIT photos/` is a later Aug 2022 flight with PPK logs. It hasn't been processed.

Wiring: `features/navigation-3d/components/drone-layers.tsx` (Drone + Thermal toolbar toggles). Thermal is projected onto the mesh in a shader, or laid flat when the mesh is off. The web mesh is built by `tools/drone/build-web-mesh.py` into `public/drone/mesh` (L≤19, 691 MB, gitignored). That script also patches DJI's undeclared KHR_materials_unlit, which crashes GLTFLoader. Details are in `public/drone/README.md`.
Testing gotcha: the in-app browser pane pauses requestAnimationFrame, so tiles only stream there if `update()` and the tile queues are pumped by hand.
Related: [[campusnav-lod350-roadmap]] (this is P3/P4).

**Storage rule (user, 2026-09-21): C: must not take new storage.** Put heavy data on E:. The web mesh lives at `E:\BIT 3D\_work\web-mesh`, and `public/drone/mesh` is now a junction to `D:\BIT 3D\_work\web-mesh`. The photogrammetry workspace and tools (COLMAP 4.2 CUDA, OpenMVS 2.4 CPU+CUDA, `run_pilot.sh`, `shrink.py`) are at `E:\BIT 3D\_work\photogrammetry`. The pilot is paused after downscaling to `pilot/images4k`; the user said quality can wait.
August 2022 flight: 45 MP, RTK fixed; the 204 obliques cover only the NE corner (bus stop, East Pond, poly houses). Feature extraction at full size ran 7 s/image, so downscale first.
Code repo: https://github.com/Akashr2006/campusnav (private, created 2026-09-21). Big pushes need `http.version HTTP/1.1` or GitHub returns 408.
