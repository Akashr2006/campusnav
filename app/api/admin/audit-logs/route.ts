import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { getAuditLogs } from "@/lib/services/audit-service";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const logs = await getAuditLogs();
    return NextResponse.json({ logs });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}
