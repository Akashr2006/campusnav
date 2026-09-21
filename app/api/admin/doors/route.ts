import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";
import { logAuditEvent } from "@/lib/services/audit-service";

import { generateShortId } from "@/shared/lib/id-generator";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const doors = campusStore.getWorkingData().doors;
    return NextResponse.json({ doors });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const body = await req.json();

    if (!body.floorId || body.x === undefined || body.y === undefined) {
      return NextResponse.json({ error: "floorId, x, and y coordinates are required." }, { status: 400 });
    }

    const door = campusStore.addDoor({
      id: body.id || generateShortId("door", campusStore.getWorkingData().doors.map((d) => d.id)),
      floorId: body.floorId,
      type: body.type || "ROOM_DOOR",
      name: body.name || "Door",
      x: body.x,
      y: body.y,
    });

    await logAuditEvent({
      userId: user.id,
      action: "DOOR_CREATED",
      resource: "door",
      resourceId: door.id,
      after: door,
    });

    return NextResponse.json({ success: true, door });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
