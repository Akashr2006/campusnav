// Dev-only endpoint for the /dev-ortho capture tool: writes the raw top-down
// windows of the drone mesh to D:\BIT 3D\_work\ortho\<dir> (raw by default; heavy data stays off C:).
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const ROOT = "D:\\BIT 3D\\_work\\ortho";

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ ok: false }, { status: 404 });
  const { name, data, dir = "raw" } = (await req.json()) as { name: string; data: string; dir?: string };
  if (!/^[a-z0-9_\-]+\.png$/i.test(name) || !/^[a-z0-9_\-]+$/i.test(dir))
    return NextResponse.json({ ok: false }, { status: 400 });
  const out = path.join(ROOT, dir);
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(path.join(out, name), Buffer.from(data.replace(/^data:image\/png;base64,/, ""), "base64"));
  return NextResponse.json({ ok: true });
}
