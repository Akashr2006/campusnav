import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph, getRelationalGraphFromDatabase, sanitizeSnapshotForPayload } from "@/lib/services/publish-service";
import { DATABASE_UNCONFIGURED_MESSAGE, isDatabaseConfigured, isDatabaseUnavailableError } from "@/lib/db-status";
import { readLocalDraftRecord, readLocalPublished, writeLocalDraft, writeLocalPublished } from "@/lib/local-graph-store";
import { STALE_DRAFT_MESSAGE, checkDraftRevision } from "@/lib/draft-revision";

/** Without a database the draft lives in `.data/draft_graph.json`. */
function localDraftResponse() {
  const record = readLocalDraftRecord();
  const draft = record?.snapshot ?? readLocalPublished()?.snapshot ?? null;
  if (!draft) {
    return NextResponse.json({
      draft: EMPTY_GRAPH,
      empty: true,
      storage: "local-file",
      revision: null,
      databaseConfigured: false,
      message: DATABASE_UNCONFIGURED_MESSAGE,
    });
  }
  return NextResponse.json({
    draft: sanitizeSnapshotForPayload(draft, true),
    storage: "local-file",
    revision: record?.updatedAt ?? null,
  });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const EMPTY_GRAPH = {
  buildings: [],
  floors: [],
  nodes: [],
  edges: [],
  destinations: [],
  obstacles: [],
  events: [],
  stairGroups: [],
  liftGroups: [],
  doors: [],
};

export async function GET() {
  if (!isDatabaseConfigured()) {
    return localDraftResponse();
  }
  try {
    if (!prisma) {
      console.warn("[DraftRoute:GET] Prisma client not available.");
      return NextResponse.json({ error: "Database client unavailable" }, { status: 503 });
    }

    // 1. Check if active draft overlay snapshot exists in database
    const draftRecord = await prisma.draftGraph.findUnique({
      where: { id: "active-draft" },
    });

    if (draftRecord && draftRecord.snapshot && typeof draftRecord.snapshot === "object") {
      const snap = draftRecord.snapshot as unknown as import("@/lib/services/publish-service").DraftSnapshot;
      console.log(`[DraftRoute:GET] Loaded active-draft from DB: ${snap.buildings?.length ?? 0} buildings, ${snap.nodes?.length ?? 0} nodes, ${snap.edges?.length ?? 0} edges, ${snap.floors?.length ?? 0} floors, ${snap.destinations?.length ?? 0} destinations`);
      return NextResponse.json({
        draft: sanitizeSnapshotForPayload(snap),
        revision: draftRecord.updatedAt?.toISOString() ?? null,
      });
    }

    // 2. Query PostgreSQL relational database tables if draftRecord is not found
    const relational = await getRelationalGraphFromDatabase().catch(() => null);
    if (relational) {
      const hasRelationalEntities =
        (Array.isArray(relational.buildings) && relational.buildings.length > 0) ||
        (Array.isArray(relational.nodes) && relational.nodes.length > 0);
      if (hasRelationalEntities) {
        console.log(`[DraftRoute:GET] Loaded from relational DB tables: ${relational.buildings?.length ?? 0} buildings, ${relational.nodes?.length ?? 0} nodes`);
        return NextResponse.json({ draft: sanitizeSnapshotForPayload(relational) });
      }
    }

    // 3. Fallback to active published graph if draft is not set
    const published = await getActivePublishedGraph(true).catch(() => null);
    if (published && published.snapshot) {
      console.log(`[DraftRoute:GET] Loaded from published graph: ${published.snapshot.buildings?.length ?? 0} buildings, ${published.snapshot.nodes?.length ?? 0} nodes`);
      return NextResponse.json({ draft: sanitizeSnapshotForPayload(published.snapshot) });
    }

    console.log("[DraftRoute:GET] Database contains empty draft graph.");
    return NextResponse.json({ draft: EMPTY_GRAPH, empty: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (isDatabaseUnavailableError(err)) {
      console.warn("[DraftRoute:GET] Database unavailable, serving the local file store.");
      return localDraftResponse();
    }
    console.error("[DraftRoute:GET] Database error loading draft:", errorMsg);
    return NextResponse.json(
      {
        error: "Database error while loading draft graph",
        details: errorMsg,
        draft: null,
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const snapshot = body.snapshot || body.draft;

    if (!isDatabaseConfigured()) {
      if (!snapshot || typeof snapshot !== "object") {
        return NextResponse.json({ success: true, storage: "local-file", skipped: true });
      }

      const current = readLocalDraftRecord();
      const check = checkDraftRevision(current?.updatedAt ?? null, body.baseRevision, {
        force: Boolean(body.force) || Boolean(body.isExplicitReset),
      });
      if (!check.ok) {
        console.warn(`[DraftRoute:PUT] Rejected ${check.reason} write (base=${body.baseRevision ?? "none"}, current=${check.currentRevision}).`);
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            reason: check.reason,
            message: STALE_DRAFT_MESSAGE,
            revision: check.currentRevision,
            draft: current ? sanitizeSnapshotForPayload(current.snapshot, true) : EMPTY_GRAPH,
            storage: "local-file",
          },
          { status: 409 }
        );
      }

      const revision = writeLocalDraft(snapshot);
      // Live Sync mirrors the draft straight to the published file
      if (revision && body.instantLiveSync) {
        writeLocalPublished(snapshot, "auto-live-sync");
      }
      return NextResponse.json(
        { success: Boolean(revision), storage: "local-file", revision },
        { status: revision ? 200 : 500 }
      );
    }

    if (!prisma) {
      console.warn("[DraftRoute:PUT] Prisma client not available.");
      return NextResponse.json({ error: "Database client unavailable" }, { status: 503 });
    }

    if (snapshot) {
      const existing = await prisma.draftGraph
        .findUnique({ where: { id: "active-draft" }, select: { updatedAt: true, snapshot: true } })
        .catch(() => null);
      const check = checkDraftRevision(existing?.updatedAt?.toISOString() ?? null, body.baseRevision, {
        force: Boolean(body.force) || Boolean(body.isExplicitReset),
      });
      if (!check.ok) {
        console.warn(`[DraftRoute:PUT] Rejected ${check.reason} write (base=${body.baseRevision ?? "none"}, current=${check.currentRevision}).`);
        return NextResponse.json(
          {
            success: false,
            conflict: true,
            reason: check.reason,
            message: STALE_DRAFT_MESSAGE,
            revision: check.currentRevision,
            draft: existing?.snapshot
              ? sanitizeSnapshotForPayload(existing.snapshot as unknown as import("@/lib/services/publish-service").DraftSnapshot)
              : EMPTY_GRAPH,
          },
          { status: 409 }
        );
      }

      // 1. Save the full working draft snapshot JSON to DraftGraph table (used strictly by CAD Editor / Admin)
      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue },
        create: { id: "active-draft", snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue },
      });

      const instantLiveSync = Boolean(body.instantLiveSync);

      // 2. Only if Live Sync is ON: Synchronize active-published in database so visitors receive latest graph on refresh without requiring Publish
      if (instantLiveSync) {
        const { invalidatePublishedCache } = await import("@/lib/services/publish-service");
        await prisma.publishedGraph.upsert({
          where: { id: "active-published" },
          update: {
            version: 1,
            snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
            publishedAt: new Date(),
            publishedBy: "auto-live-sync",
          },
          create: {
            id: "active-published",
            version: 1,
            snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
            publishedAt: new Date(),
            publishedBy: "auto-live-sync",
          },
        }).catch(() => null);

        invalidatePublishedCache();
        console.log(`[DraftRoute:PUT] [LiveSync: ON] Saved active-draft and auto-synced published-graph to database`);
      } else {
        console.log(`[DraftRoute:PUT] [LiveSync: OFF] Saved active-draft to database (publish required for visitor view)`);
      }
    }
    const saved = await prisma.draftGraph
      .findUnique({ where: { id: "active-draft" }, select: { updatedAt: true } })
      .catch(() => null);
    return NextResponse.json({ success: true, revision: saved?.updatedAt?.toISOString() ?? null });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[DraftRoute:PUT] Database error saving draft:", errorMsg);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to persist draft to database",
        details: errorMsg,
      },
      { status: 500 }
    );
  }
}

export const POST = PUT;
