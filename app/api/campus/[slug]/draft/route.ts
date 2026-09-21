import { NextResponse } from "next/server";
import { campusStore } from "@/shared/lib/campus-store";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const workingData = campusStore.getWorkingData();
  const pendingChanges = campusStore.getPendingChanges();

  return NextResponse.json({
    slug,
    workingData,
    pendingChangesCount: pendingChanges.length,
    pendingChanges,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const body = await req.json();

  if (body.action === "CLEAR") {
    campusStore.clearAllData();
    return NextResponse.json({ success: true, message: "Draft graph cleared" });
  }

  return NextResponse.json({ success: true, slug, workingData: campusStore.getWorkingData() });
}
