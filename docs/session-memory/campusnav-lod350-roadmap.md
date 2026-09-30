---
name: campusnav-lod350-roadmap
description: CampusNav digital-twin roadmap — phase plan, the three pilot buildings, and what drone/thermal/sketch inputs can each actually contribute.
metadata:
  type: project
---

User wants CampusNav's 3D view to reach the LOD 350 architectural-board look
(exploded axonometric, structural frame, section cuts) they shared as reference.
Agreed phase plan: P0 schema/geometry contract, P1 procedural frame from existing
data, P2 sketch intake in the admin editor, P3 drone photogrammetry shell,
P4 thermal analysis layer, P5 presentation mode.

Settled feasibility conclusions (do not relitigate):
- Drone RGB photogrammetry gives the exterior shell only — no interiors.
- Drone **thermal cannot produce geometry** (640x512, texture-poor, SfM fails).
  It is an envelope-performance overlay for the estate team, scoped to P4.
- Dimensioned **per-floor** sketches are the load-bearing input. One sketch per
  building is not enough.

Blocking ask handed to the user 2026-09-14: get DWG/PDF floor plans from the
college estate office — vector plans collapse P2 from ~6 weeks to ~1.
Also outstanding: confirm campus airspace on the DGCA Digital Sky portal before P3.

Pilot buildings chosen to cover three structural cases: `b-acad-w` (RC frame +
basement), `b-east` (elongated plate, unequal bays), `b-hall` (LONG_SPAN, clear
interior). P0 and P1 shipped 2026-09-14; P2 (plan tracer + rooms) 2026-09-16.

Room codes decode as `<block><floor><nn>`: **`AE301` is the AEronautical Block
(`n-blk-ne2`), floor 3, room 01** — NOT Academic Block E, which also has
shortCode AE. The user works on that floor.

**Known data defect:** the published graph records only 2 floors for
`n-blk-ne2`, but photographs prove at least 4. Floors 2 and 3 are currently
supplied by the pilot overlay in `shared/data/pilot-structure.ts`; delete them
from there once the graph itself is corrected.

Aero 3rd floor is a schematic: room identity, category and order along the
corridor come from photos/video and are real; every dimension is provisional and
apportioned across the real 71 x 38 m footprint. Awaiting tape measurements (or
a photo of the floor's fire evacuation plan, which would be a scaled plan and
would let the tracer do the whole floor properly). P5 presentation mode shipped 2026-09-15:
`features/navigation-3d/lib/presentation.ts` is a pure cue-timeline director
(overview → route → each pilot: settle/explode/reassemble/section-cut → outro),
entered via the Present button or `/navigate-3d?present=1`; space/arrows/Esc.
Clock is wall-time from an origin, NOT summed rAF deltas (throttled rAF made a
delta clock run at ~10% speed).

Roadmap document: https://claude.ai/code/artifact/1e6bb228-dd6d-4094-a54f-472a38bc3ea8
