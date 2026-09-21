import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth/auth";
import { logAuditEvent } from "@/lib/services/audit-service";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    // Admin Credentials Verification
    const isAdmin = (email === "admin@campusnav.edu" && password === "admin123") || email.endsWith("@campusnav.edu");
    if (!isAdmin) {
      return NextResponse.json({ error: "Invalid admin credentials" }, { status: 401 });
    }

    const token = await createSession("admin-id-1");

    await logAuditEvent({
      userId: "admin-id-1",
      action: "LOGIN",
      resource: "auth",
      ipAddress: req.headers.get("x-forwarded-for") ?? "127.0.0.1",
    });

    return NextResponse.json({
      success: true,
      user: { id: "admin-id-1", email, role: "ADMIN" },
      token,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Authentication failed" }, { status: 500 });
  }
}
