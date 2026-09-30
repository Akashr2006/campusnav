---
name: navigate-2d-from-drone
description: "How /navigate's 2D map is built from the drone survey, and the user's rule never to modify the 3D view files."
metadata:
  node_type: memory
  type: project
  originSessionId: c37d7f9b-9c94-4348-9c47-48794606dccb
  modified: 2026-09-26T07:54:25.053Z
---

/navigate (rebuilt 2026-09-26) has a 2D tab and a 3D tab. The 3D tab imports the /navigate-3d CampusScene unchanged, with the drone mesh on and building selection disabled, so buildings never explode. The 2D map (`features/navigation/components/campus-2d-map.tsx`) defaults to a drone orthophoto; a "Plan" style (Navigine-like) is in the layers menu.

- Orthophoto tiles are at `D:\BIT 3D\_work\web-mesh\ortho` (served as /drone/mesh/ortho via the junction). They are NOT on the Cloudflare worker until someone runs `wrangler deploy`, and without them production falls back to Plan style.
- `public/drone/footprints.json` holds 190 roofed blocks detected from mesh height above terrain. They are named by overlap with graph buildings (42 of 43 named buildings matched). Unclaimed roofs show as "Unnamed building": no data source has their names.
- Rebuild steps are in `public/drone/README.md`: /dev-ortho capture page (dev only) then `tools/drone/build-ortho.py`. Use `--skip-tiles` when only names change.

**Why:** the user said repeatedly: "don't touch anything in the 3D view"; 2D must be derived from the 3D/drone view and look clean.
**How to apply:** never edit `features/navigation-3d/**` for /navigate work; import from it instead. Related: [[bit3d-drone-dataset]], [[campusnav-deployment]].
