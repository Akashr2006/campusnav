import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logAuditEvent } from "@/lib/services/audit-service";

export async function POST(req: Request) {
  const cookieStore = await cookies();
  cookieStore.delete("campusnav_session");

  await logAuditEvent({
    action: "LOGOUT",
    resource: "auth",
    ipAddress: req.headers.get("x-forwarded-for") ?? "127.0.0.1",
  });

  return NextResponse.json({ success: true, message: "Logged out successfully" });
}
