import { NextResponse } from "next/server";
import { publishDraftGraph, type DraftSnapshot } from "@/lib/services/publish-service";
import { prisma } from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  let snapshot = body.snapshot || body.draft;

  if (!snapshot && prisma) {
    const draftRecord = await prisma.draftGraph.findUnique({
      where: { id: "active-draft" },
    }).catch(() => null);
    snapshot = (draftRecord?.snapshot as unknown as DraftSnapshot) || undefined;
  }

  const result = await publishDraftGraph(snapshot || {}, "admin", body.notes || `Published for ${slug}`);

  if (!result.success) {
    return NextResponse.json({ error: result.error, validationReport: result.validationReport }, { status: 422 });
  }

  return NextResponse.json({
    success: true,
    slug,
    version: result.version,
    publishedAt: result.publishedAt,
    publishedGraph: snapshot,
  });
}
