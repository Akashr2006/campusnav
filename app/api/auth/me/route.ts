import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/auth/auth";

export async function GET(req: Request) {
  const user = await getCurrentAdminUser(req);
  if (!user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }
  return NextResponse.json({ authenticated: true, user });
}
