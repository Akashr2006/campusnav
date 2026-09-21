import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";
import { logAuditEvent } from "@/lib/services/audit-service";

import { generateShortId } from "@/shared/lib/id-generator";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const destinations = campusStore.getWorkingData().destinations;
    return NextResponse.json({ rooms: destinations });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const body = await req.json();

    if (!body.name || !body.nodeId) {
      return NextResponse.json({ error: "Room name and nodeId are required." }, { status: 400 });
    }

    const room = {
      id: body.id || generateShortId("d", campusStore.getWorkingData().destinations.map((d) => d.id)),
      nodeId: body.nodeId,
      name: body.name,
      category: body.category || "Classroom",
      roomNumber: body.roomNumber,
      floorId: body.floorId,
      aliases: body.aliases || [],
    };

    campusStore.addDestination(room);

    await logAuditEvent({
      userId: user.id,
      action: "ROOM_CREATED",
      resource: "room",
      resourceId: room.id,
      after: room,
    });

    return NextResponse.json({ success: true, room });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
