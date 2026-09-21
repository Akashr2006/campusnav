# Campus data backup

Taken before clearing the map to rebuild the campus from satellite tracing.

- `published_graph.json` / `draft_graph.json` — the live local store at time of backup
  (4 buildings: SF, Mech, RP, Pearl; 16 floors; 52 nodes; 108 edges).
- `vercel_original.json` — the untouched payload fetched from
  https://campusnav-eight.vercel.app/api/published-graph

## Restore
```bash
cp backup/campus-data-<stamp>/published_graph.json .data/published_graph.json
cp backup/campus-data-<stamp>/draft_graph.json .data/draft_graph.json
```
