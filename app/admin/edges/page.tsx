"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
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
import { getEdgePathType, getPathTypeLabel } from "@/lib/routing/edge-accessibility";

const variantForType: Record<string, Parameters<typeof Badge>[0]["variant"]> = {
  WALK: "default",
  ROAD: "default",
  STAIRS: "warning",
  LIFT: "primary",
  RAMP: "success",
};

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


  const nodeById = (id: string) => storeData.nodes.find((n) => n.id === id);

  const seen = new Set<string>();
  const unique = storeData.edges.filter((e) => {
    const key = [e.from, e.to, e.type].sort().join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const rows = unique.map((e) => {
    const pType = getEdgePathType(e);
    const pInfo = getPathTypeLabel(pType, e.type);
    return {
      id: e.id,
      from: nodeById(e.from)?.name ?? e.from,
      to: nodeById(e.to)?.name ?? e.to,
      type: e.type,
      pathType: pType,
      pathLabel: pInfo.label,
      distance: e.distance,
    };
  });

  return (
    <>
      <PageHeader
        title="Edges"
        description="Edges connect two nodes with live path preview lines and dynamic distance calculations."
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
              <Plus className="h-4 w-4" /> New Edge
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="EDGE" />
      ) : (
        <DataTable
          emptyMessage="No edges yet. Connect two nodes to make a walkable path."
          keyField="id"
          data={rows}
          columns={[
            { key: "from", label: "From" },
            { key: "to", label: "To" },
            {
              key: "type",
              label: "Type",
              render: (r) => (
                <Badge variant={variantForType[String(r.type)] ?? "default"}>
                  {String(r.type)}
                </Badge>
              ),
            },
            {
              key: "pathType",
              label: "Path Type",
              render: (r) => (
                <Badge variant={r.pathType === "EV" ? "success" : "default"} className="font-semibold">
                  {r.pathType === "EV" ? "EV Path" : "Walk only"}
                </Badge>
              ),
            },
            {
              key: "distance",
              label: "Distance",
              render: (r) => `${r.distance} m`,
            },
            {
              key: "actions",
              label: "Actions",
              render: (e) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => setPendingDelete({ id: String(e.id), name: `${e.from} → ${e.to}` })}
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
        title={`Delete edge ${pendingDelete?.name ?? ""}?`}
        description="Removing this connection may leave parts of the campus unreachable. This cannot be undone from here."
        confirmLabel="Delete edge"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) campusStore.deleteEdge(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}

