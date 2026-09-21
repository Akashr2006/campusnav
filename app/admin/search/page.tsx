"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Plus, LayoutGrid, Table } from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import dynamic from "next/dynamic";

const DigitalTwinEditor = dynamic(
  () => import("@/features/admin/components/digital-twin-editor").then((mod) => mod.DigitalTwinEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-96 w-full items-center justify-center rounded-2xl border bg-[rgb(var(--card))]">
        <div className="flex items-center gap-3 text-sm font-semibold text-[rgb(var(--muted-fg))]">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent" />
          <span>Loading CAD Canvas Editor...</span>
        </div>
      </div>
    ),
  }
);

export default function Page() {
  const [storeData, setStoreData] = useState(campusStore.getWorkingData());
  const [viewMode, setViewMode] = useState<"TABLE" | "EDITOR">("TABLE");

  useEffect(() => {
    const unsub = campusStore.subscribe(() => setStoreData(campusStore.getWorkingData()));
    return () => {
      unsub();
    };
  }, []);


  return (
    <>
      <PageHeader
        title="Search Manager"
        description="Aliases and categories that power search. Connect new destinations visually on the canvas."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={viewMode === "EDITOR" ? "primary" : "outline"}
              onClick={() => setViewMode(viewMode === "EDITOR" ? "TABLE" : "EDITOR")}
            >
              {viewMode === "EDITOR" ? <Table className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              {viewMode === "EDITOR" ? "Table View" : "CAD Editor"}
            </Button>
            <Button size="sm" onClick={() => setViewMode("EDITOR")}>
              <Plus className="h-4 w-4" /> New Destination
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="DESTINATION" />
      ) : (
        <DataTable
          keyField="id"
          data={storeData.destinations}
          columns={[
            { key: "name", label: "Destination" },
            {
              key: "category",
              label: "Category",
              render: (d) => <Badge variant="primary">{String(d.category)}</Badge>,
            },
            {
              key: "aliases",
              label: "Aliases",
              render: (d) => (
                <div className="flex flex-wrap gap-1">
                  {(d.aliases as string[]).map((a) => (
                    <Badge key={a}>{a}</Badge>
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}
    </>
  );
}

