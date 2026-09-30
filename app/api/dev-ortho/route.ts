// Dev-only endpoint for the /dev-ortho capture tool: writes the raw top-down
// windows of the drone mesh to D:\BIT 3D\_work\ortho\raw (heavy data stays off C:).
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const OUT = "D:\\BIT 3D\\_work\\ortho\\raw";

export async function POST(req: Request) {
  if (process.env.NODE_ENV !== "development") return NextResponse.json({ ok: false }, { status: 404 });
  const { name, data } = (await req.json()) as { name: string; data: string };
  if (!/^[a-z0-9_\-]+\.png$/i.test(name)) return NextResponse.json({ ok: false }, { status: 400 });
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, name), Buffer.from(data.replace(/^data:image\/png;base64,/, ""), "base64"));
  return NextResponse.json({ ok: true });
}
