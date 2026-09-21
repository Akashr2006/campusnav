"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { Badge } from "@/shared/components/ui/badge";
import { Plus, LayoutGrid, Table, Trash2, Undo2, Redo2 } from "lucide-react";
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
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
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
        title="Buildings"
        description="Manage building footprints and metadata directly on the interactive CAD canvas."
        action={
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!campusStore.canUndo()}
              onClick={() => campusStore.undo()}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!campusStore.canRedo()}
              onClick={() => campusStore.redo()}
              title="Redo (Ctrl+Y)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>

            <Button
              size="sm"
              variant={viewMode === "EDITOR" ? "primary" : "outline"}
              onClick={() => setViewMode(viewMode === "EDITOR" ? "TABLE" : "EDITOR")}
            >
              {viewMode === "EDITOR" ? <Table className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
              {viewMode === "EDITOR" ? "Table View" : "CAD Editor"}
            </Button>
            <Button size="sm" onClick={() => setViewMode("EDITOR")}>
              <Plus className="h-4 w-4" /> New Building
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="BUILDING" />
      ) : (
        <DataTable
          emptyMessage="No buildings yet. Use the CAD Editor to draw your first building footprint."
          keyField="id"
          data={storeData.buildings.map((b) => ({
            ...b,
            floors: storeData.floors.filter((f) => f.buildingId === b.id).length,
          }))}
          columns={[
            {
              key: "name",
              label: "Building Name",
              render: (b) => (
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: (b.color as string) || "#4f46e5" }}
                  />
                  <span className="font-semibold">{String(b.name)}</span>
                </div>
              ),
            },
            { key: "floors", label: "Floors" },
            {
              key: "coords",
              label: "Coordinates",
              render: (b) =>
                b.lat === undefined || b.lng === undefined
                  ? "—"
                  : `${(b.lat as number).toFixed(6)}, ${(b.lng as number).toFixed(6)}`,
            },
            {
              key: "status",
              label: "Status",
              render: (b) =>
                campusStore.isEntityPublished("buildings", String(b.id)) ? (
                  <Badge variant="success">Published</Badge>
                ) : (
                  <Badge variant="warning">Draft</Badge>
                ),
            },
            {
              key: "actions",
              label: "Actions",
              render: (b) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => setPendingDelete({ id: String(b.id), name: String(b.name ?? b.id) })}
                >
                  <Trash2 className="h-4 w-4 mr-1" /> Delete
                </Button>
              ),
            },
          ]}
        />
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? ""}?`}
        description="Deleting a building also removes its floors, rooms and nodes from the digital twin. This cannot be undone from here."
        confirmLabel="Delete building"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) campusStore.deleteBuilding(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}

