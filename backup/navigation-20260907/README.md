# Navigation backup — 2026-09-07

Snapshot of the navigation stack taken before starting the new student-facing
approach (Google-Maps-style light map + satellite tracing).

## Contents
| Folder | Restores to |
| --- | --- |
| `features-navigation/` | `features/navigation/` |
| `app-navigate/` | `app/navigate/` |
| `app-map/` | `app/map/` |
| `lib-geo/` | `lib/geo/` |
| `lib-routing/` | `lib/routing/` |
| `globals.css` | `app/globals.css` |
| `published_graph.json` | `.data/published_graph.json` |
| `draft_graph.json` | `.data/draft_graph.json` |

## Restore
Run from the project root:

```bash
cp -r backup/navigation-20260907/features-navigation/. features/navigation/
cp -r backup/navigation-20260907/app-navigate/. app/navigate/
cp -r backup/navigation-20260907/app-map/. app/map/
cp -r backup/navigation-20260907/lib-geo/. lib/geo/
cp -r backup/navigation-20260907/lib-routing/. lib/routing/
cp backup/navigation-20260907/globals.css app/globals.css
cp backup/navigation-20260907/published_graph.json .data/published_graph.json
cp backup/navigation-20260907/draft_graph.json .data/draft_graph.json
```

## State at time of backup
- Campus data imported from the Vercel deployment: 4 buildings (SF, Mech, RP,
  Pearl), 16 floors, 52 nodes, 108 edges.
- Map renders extruded 3D blocks, metric roads (7 m) and footpaths (2 m),
  scale bar, north arrow, and a camera-tilt control (0 / 35 / 55 degrees).
- Runs without a database, from the `.data/` file store.
