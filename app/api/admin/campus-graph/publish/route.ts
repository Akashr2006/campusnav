import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/auth/auth";
import { prisma } from "@/lib/db";
import { publishDraftGraph } from "@/lib/services/publish-service";
import { isDatabaseConfigured } from "@/lib/db-status";
import { readLocalDraft, writeLocalPublished } from "@/lib/local-graph-store";
import { validateCampusGraph } from "@/lib/validation/graph-validator";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function POST(req: Request) {
  try {
    const user = (await getCurrentAdminUser(req)) || { id: "admin-default", email: "admin@campusnav.edu", role: "ADMIN" };
    const body = await req.json().catch(() => ({}));

    let draftSnapshot = body.snapshot || body.draft;

    if (!isDatabaseConfigured()) {
      const snapshot =
        draftSnapshot && typeof draftSnapshot === "object" && Object.keys(draftSnapshot).length > 0
          ? draftSnapshot
          : readLocalDraft();
      if (!snapshot) {
        return NextResponse.json({ error: "No local draft available to publish." }, { status: 400 });
      }
      const validationReport = validateCampusGraph(
        snapshot.buildings || [],
        snapshot.floors || [],
        snapshot.nodes || [],
        snapshot.edges || [],
        snapshot.destinations || [],
        snapshot.obstacles || []
      );
      const saved = writeLocalPublished(snapshot, user.id, body.notes);
      if (!saved) {
        return NextResponse.json(
          { error: "Could not write the local map file (.data/published_graph.json)." },
          { status: 500 }
        );
      }
      console.log(`[PublishRoute:POST] Published v${saved.version} to the local file store.`);
      return NextResponse.json({
        success: true,
        version: saved.version,
        publishedAt: saved.publishedAt,
        storage: "local-file",
        validationReport,
      });
    }

    // If snapshot is not provided in body, retrieve the authoritative active-draft directly from database
    if (!draftSnapshot || typeof draftSnapshot !== "object" || Object.keys(draftSnapshot).length === 0) {
      if (prisma) {
        const dbDraft = await prisma.draftGraph.findUnique({
          where: { id: "active-draft" },
        }).catch(() => null);
        if (dbDraft && dbDraft.snapshot && typeof dbDraft.snapshot === "object") {
          draftSnapshot = dbDraft.snapshot;
        }
      }
    }

    if (!draftSnapshot || typeof draftSnapshot !== "object") {
      return NextResponse.json(
        { error: "No draft snapshot available to publish in database." },
        { status: 400 }
      );
    }

    console.log(`[PublishRoute:POST] Initiating publish for draft with ${(draftSnapshot.buildings || []).length} buildings, ${(draftSnapshot.nodes || []).length} nodes, ${(draftSnapshot.edges || []).length} edges`);

    // Run Graph Validation Guardrails and Publish to PostgreSQL
    const result = await publishDraftGraph(draftSnapshot, user.id, body.notes);

    if (!result.success) {
      console.error("[PublishRoute:POST] Publish failed:", result.error);
      return NextResponse.json(
        {
          error: result.error,
          validationReport: result.validationReport,
        },
        { status: 422 }
      );
    }

    console.log(`[PublishRoute:POST] Successfully published map v${result.version} to database at ${result.publishedAt}`);

    return NextResponse.json({
      success: true,
      version: result.version,
      publishedAt: result.publishedAt,
      validationReport: result.validationReport,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[PublishRoute:POST] Server database error:", errorMsg);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

