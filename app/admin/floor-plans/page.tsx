"use client";

import dynamic from "next/dynamic";
import { PageHeader } from "@/features/admin/components/page-header";

// Canvas work and an object-URL image loader are browser-only.
const FloorPlanTracer = dynamic(
  () => import("@/features/admin/components/floor-plan-tracer").then((m) => m.FloorPlanTracer),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 w-full items-center justify-center rounded-2xl border bg-[rgb(var(--card))]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[rgb(var(--muted-fg))]">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent" />
          <span>Loading floor plan tracer…</span>
        </div>
      </div>
    ),
  }
);

export default function Page() {
  return (
    <>
      <PageHeader
        title="Floor Plans"
        description="Pin a scanned floor plan to a building's footprint, then trace its columns, walls and slab edge into the twin."
      />
      <FloorPlanTracer />
    </>
  );
}
