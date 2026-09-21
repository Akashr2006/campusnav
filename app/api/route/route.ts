import { NextResponse } from "next/server";
import { shortestPath } from "@/features/navigation/services/graph";
import { getActivePublishedGraph } from "@/lib/services/publish-service";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from") || "";
  const toParam = searchParams.get("to") || "";

  if (!toParam) {
    return NextResponse.json({ error: "Missing destination" }, { status: 400 });
  }

  const published = await getActivePublishedGraph();
  const graphData = published?.snapshot ?? undefined;

  const route = shortestPath(fromParam, toParam, { graphData });
  if (!route) {
    return NextResponse.json({ error: "No route found" }, { status: 404 });
  }

  return NextResponse.json({ route });
}
