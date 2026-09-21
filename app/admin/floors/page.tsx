"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
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
        title="Floors"
        description="Every floor is its own graph layer. Switch and configure floors on the CAD editor canvas."
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
              <Plus className="h-4 w-4" /> New Floor
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="FLOOR" />
      ) : (
        <DataTable
          emptyMessage="No floors yet. Add a building first, then give it floors."
          keyField="id"
          data={storeData.floors.map((f) => ({
            ...f,
            building: storeData.buildings.find((b) => b.id === f.buildingId)?.name ?? "—",
            nodes: storeData.nodes.filter((n) => n.floorId === f.id).length,
          }))}
          columns={[
            { key: "name", label: "Name" },
            { key: "building", label: "Building" },
            { key: "ordinal", label: "Ordinal" },
            { key: "nodes", label: "Nodes" },
            {
              key: "actions",
              label: "Actions",
              render: (f) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => setPendingDelete({ id: String(f.id), name: String(f.name ?? f.id) })}
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
        description="Deleting a floor also removes the rooms and nodes placed on it. This cannot be undone from here."
        confirmLabel="Delete floor"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) campusStore.deleteFloor(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}

