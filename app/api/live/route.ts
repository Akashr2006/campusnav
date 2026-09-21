import { shortestPath } from "@/features/navigation/services/graph";
import { campusStore } from "@/shared/lib/campus-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Server-Sent Events stream — emits progressive location updates
// as if the user is walking the route.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const to = searchParams.get("to");

  const working = campusStore.getWorkingData();
  const dest = to ? working.destinations.find((d) => d.id === to) : null;
  const endNodeId = dest?.nodeId ?? to ?? "";

  let fromNodeId = fromParam ?? "n-gate";

  // If start node equals destination node, pick a distinct outdoor/entrance start node
  if (fromNodeId === endNodeId && working.nodes.length > 1) {
    const alternateStart = working.nodes.find(
      (n) => n.id !== endNodeId && (n.type === "BUILDING_ENTRANCE" || n.type === "GATE" || n.floorId === "f-out")
    );
    if (alternateStart) {
      fromNodeId = alternateStart.id;
    }
  }

  let route = (endNodeId && fromNodeId) ? shortestPath(fromNodeId, endNodeId) : null;

  // If route is 1 node (start == end), ensure a valid multi-step route is found
  if (route && route.nodes.length <= 1 && working.nodes.length > 1) {
    const alternateStart = working.nodes.find(
      (n) => n.id !== endNodeId && (n.type === "BUILDING_ENTRANCE" || n.type === "GATE" || n.floorId === "f-out")
    );
    if (alternateStart) {
      route = shortestPath(alternateStart.id, endNodeId);
    }
  }

  const encoder = new TextEncoder();

  if (!to || !route || route.nodes.length === 0) {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ message: "No route available" })}\n\n`)
        );
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("route", route);

      let step = 0;
      const total = route.nodes.length;
      const interval = setInterval(() => {
        if (step >= total) {
          send("arrived", { at: route.nodes[total - 1] });
          clearInterval(interval);
          controller.close();
          return;
        }
        const cur = route.nodes[step];
        const remainingDist = route.edges
          .slice(step)
          .reduce((s, e) => s + e.distance, 0);
        send("position", {
          index: step,
          node: cur,
          remainingDistance: remainingDist,
          remainingSec: Math.round(remainingDist / 1.3),
          progress: total > 1 ? step / (total - 1) : 1,
        });
        step++;
      }, 1200);

      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
