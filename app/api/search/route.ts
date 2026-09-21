import { NextResponse } from "next/server";
import { getActivePublishedGraph } from "@/lib/services/publish-service";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = Number(searchParams.get("limit") ?? 8);

  const published = await getActivePublishedGraph();
  const data = published?.snapshot ?? { buildings: [], destinations: [] };

  const buildingDestinations = (data.buildings || []).map((b) => ({
    id: b.id,
    name: b.name,
    category: "Building",
    aliases: [b.shortCode || "", b.name],
  }));

  const allDestinations = [...(data.destinations || []), ...buildingDestinations];

  const scored = allDestinations
    .map((d) => {
      const hay = [d.name, d.category, ...(d.aliases || [])].join(" ").toLowerCase();
      let score = 0;
      if (!q) score = 10;
      else {
        if (hay.includes(q)) score += 40;
        if (d.name.toLowerCase().startsWith(q)) score += 60;
      }
      return { d, score };
    })
    .filter((r) => (q ? r.score > 40 : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.d);

  return NextResponse.json({ results: scored });
}
