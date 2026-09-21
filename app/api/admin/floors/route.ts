import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";
import { logAuditEvent } from "@/lib/services/audit-service";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const floors = campusStore.getWorkingData().floors;
    return NextResponse.json({ floors });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const body = await req.json();

    if (!body.buildingId || !body.name) {
      return NextResponse.json({ error: "buildingId and name are required." }, { status: 400 });
    }

    const floor = campusStore.addFloor(body.buildingId, body.name, body.ordinal ?? 1, body.code);

    await logAuditEvent({
      userId: user.id,
      action: "FLOOR_CREATED",
      resource: "floor",
      resourceId: floor.id,
      after: floor,
    });

    return NextResponse.json({ success: true, floor });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
