import { NextResponse } from "next/server";
import { getActivePublishedGraph, sanitizeSnapshotForPayload } from "@/lib/services/publish-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const publishedServiceData = await getActivePublishedGraph(true);
  const rawData = publishedServiceData?.snapshot ?? {
    buildings: [],
    floors: [],
    nodes: [],
    edges: [],
    destinations: [],
    obstacles: [],
  };

  const data = sanitizeSnapshotForPayload(rawData);
  const version = publishedServiceData?.version ?? 1;

  return NextResponse.json(
    {
      slug,
      version,
      data,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    }
  );
}

