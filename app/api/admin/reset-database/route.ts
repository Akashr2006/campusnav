import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminSession } from "@/lib/auth/auth";
import { isDatabaseConfigured } from "@/lib/db-status";
import { clearLocalGraphs } from "@/lib/local-graph-store";

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req).catch(() => null);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Admin session required to reset database." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    if (body.confirm !== "RESET_CAMPUSNAV_DATABASE") {
      return NextResponse.json({ error: "Explicit confirmation parameter 'confirm: RESET_CAMPUSNAV_DATABASE' is required." }, { status: 400 });
    }

    if (!isDatabaseConfigured()) {
      clearLocalGraphs();
      console.log("[ResetRoute:POST] Cleared the local file store.");
      return NextResponse.json({ success: true, storage: "local-file" });
    }

    if (prisma) {
      // Execute single TRUNCATE CASCADE query to safely clear all tables in one connection
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE 
          "Edge",
          "SearchAlias",
          "Destination",
          "Room",
          "Node",
          "Door",
          "StairGroup",
          "LiftGroup",
          "Facility",
          "Obstacle",
          "Event",
          "GeoCalibration",
          "Floor",
          "Building",
          "DraftGraph",
          "PublishedGraph",
          "MapVersion",
          "AuditLog",
          "NavigationSession",
          "AnalyticsEvent",
          "MediaAsset"
        RESTART IDENTITY CASCADE;
      `);

      // Ensure default campus row exists
      await prisma.campus.upsert({
        where: { id: "c1" },
        update: { status: "PUBLISHED" },
        create: {
          id: "c1",
          name: "Main Campus",
          slug: "main",
          latitude: 11.4965,
          longitude: 77.2774,
          status: "PUBLISHED",
        },
      });

      // Reset Draft and Published graph entries to clean empty state
      const emptySnapshot = {
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

      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: emptySnapshot as unknown as import("@prisma/client").Prisma.InputJsonValue },
        create: { id: "active-draft", snapshot: emptySnapshot as unknown as import("@prisma/client").Prisma.InputJsonValue },
      });

      await prisma.publishedGraph.upsert({
        where: { id: "active-published" },
        update: {
          version: 1,
          snapshot: emptySnapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
          publishedAt: new Date(),
          publishedBy: "admin",
        },
        create: {
          id: "active-published",
          version: 1,
          snapshot: emptySnapshot as unknown as import("@prisma/client").Prisma.InputJsonValue,
          publishedAt: new Date(),
          publishedBy: "admin",
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: "Database tables and graph snapshots completely reset to clean state.",
    });
  } catch (err: unknown) {
    console.error("Error performing database reset:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
