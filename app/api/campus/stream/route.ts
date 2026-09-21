import { NextResponse } from "next/server";
import { campusStore } from "@/shared/lib/campus-store";

export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const customReadable = new ReadableStream({
    start(controller) {
      // Send initial version string
      const initialVersion = campusStore.getPublishedVersion();
      const initialData = `data: ${JSON.stringify({ event: "version", version: initialVersion, timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(initialData));

      // Subscribe to store changes
      const unsubscribe = campusStore.subscribe(() => {
        try {
          const currentVersion = campusStore.getPublishedVersion();
          const payload = `data: ${JSON.stringify({ event: "version", version: currentVersion, timestamp: Date.now() })}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream closed
        }
      });

      // Send periodic heartbeat every 15s to keep connection alive
      const timer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          clearInterval(timer);
          unsubscribe();
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        clearInterval(timer);
        unsubscribe();
      });
    },
  });

  return new NextResponse(customReadable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
