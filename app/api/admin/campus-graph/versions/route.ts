import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { getMapVersions, restoreMapVersion } from "@/lib/services/version-service";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const versions = await getMapVersions();
    return NextResponse.json({ versions });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const body = await req.json();

    if (!body.versionId) {
      return NextResponse.json({ error: "versionId parameter is required for restoration." }, { status: 400 });
    }

    const restored = await restoreMapVersion(body.versionId, user.id);

    return NextResponse.json({ success: true, restored });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
