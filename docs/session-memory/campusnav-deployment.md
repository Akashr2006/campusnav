---
name: campusnav-deployment
description: Where CampusNav is deployed (Vercel + Supabase Storage), which accounts own what, and the upload limits that shaped it.
metadata:
  type: project
---

Live since 2026-09-22 at **https://campusnav-rose.vercel.app**. It is on the Vercel account akashr.ad24@bitsathy.ac.in (team `akashrad24-7335s-projects`), and the Vercel CLI is logged in there.
- The old project on the `techkreateup` account (campusnav-beryl.vercel.app) never starts builds (status UNKNOWN), for reasons we couldn't see. The user chose to move off it. Its link is kept in `.vercel-techkreateup/`.
- There is no DATABASE_URL: the site serves the campus from `.data/published_graph.json`, which ships via `outputFileTracingIncludes`, the same as localhost. Old prod secrets were "sensitive" on Vercel and couldn't be copied. ADMIN_EMAIL/ADMIN_PASSWORD are unset, so admin login won't work until the user sets them.
- **Vercel Hobby rejects CLI uploads over ~100 MB** (the /v2/files 500 errors). `.vercelignore` excludes the mesh, `public/tour`, backups and tools.
- Supabase project `campusnav` (ref xnhsopueqgnvupiszwxr, Akashr2006's Org, free 1 GB) has public buckets `tour` (119 panos, 127 MB) and `drone` (L≤19 mesh, 691 MB). Uploads used temporary anon policies that are now dropped, so the buckets are read-only.
- The user wants the full 3.4 GB mesh on **Cloudflare R2** (not yet set up; the user must sign up and add a card).
Related: [[bit3d-drone-dataset]]

**Full-detail mesh LIVE 2026-09-23** (Vercel NEXT_PUBLIC_DRONE_TILESET_URL points here; Supabase `drone` bucket is now only a fallback): Cloudflare Worker static assets, worker `campusnav-drone`, URL https://campusnav-drone.akashr-ad24.workers.dev (no card needed; R2 needs a card, which the user doesn't have). Config: `D:\BIT 3D\_work\pages-deploy\wrangler.jsonc`, assets dir `D:\BIT 3D\_work\web-mesh` (includes a `_headers` CORS file). Resume with `CI=true npx --prefix <campusnav> wrangler deploy` from that folder; uploaded buckets are kept. Never run wrangler inside the campusnav repo, because it auto-converts the Next app to OpenNext. The user's upload speed is ~0.3–4 Mbit/s, the bottleneck. When it's live, set NEXT_PUBLIC_DRONE_TILESET_URL on Vercel to `<worker>/tileset.json`, redeploy, then delete the Supabase `drone` bucket.

Gotcha: two overlapping `_headers` rules made `Access-Control-Allow-Origin: *, *` and browsers rejected it. Keep the rules non-overlapping (`/*.b3dm` and `/*.json`).
