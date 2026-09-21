"use client";

import { Suspense } from "react";
import { DigitalTwinEditor } from "@/features/admin/components/digital-twin-editor";

export default function CADEditorPage() {
  return (
    <div className="h-full w-full overflow-hidden flex flex-col p-1 sm:p-2">
      <Suspense fallback={<div className="p-8 text-xs text-muted-foreground">Loading CAD Editor...</div>}>
        <DigitalTwinEditor initialTool="SELECT" />
      </Suspense>
    </div>
  );
}
