"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { Plus, LayoutGrid, Table, Trash2, Undo2, Redo2, Footprints, Layers } from "lucide-react";
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
import { useToast } from "@/shared/components/ui/toast";

export default function Page() {
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [storeData, setStoreData] = useState(campusStore.getWorkingData());
  const [viewMode, setViewMode] = useState<"TABLE" | "EDITOR">("TABLE");
  const { toast } = useToast();

  useEffect(() => {
    const unsub = campusStore.subscribe(() => setStoreData(campusStore.getWorkingData()));
    return () => {
      unsub();
    };
  }, []);

  const rows = storeData.stairGroups.map((sg) => {
    const b = storeData.buildings.find((bg) => bg.id === sg.buildingId);
    const connectedFloors = (sg.connectedFloorIds || [])
      .map((fid) => storeData.floors.find((f) => f.id === fid))
      .filter((f): f is NonNullable<typeof f> => Boolean(f))
      .sort((a, b) => a.ordinal - b.ordinal);

    const stairNodesCount = storeData.nodes.filter((n) => n.stairGroupId === sg.id).length;

    return {
      id: sg.id,
      name: sg.name || "Staircase Group",
      building: b ? b.name : "Campus-wide",
      connectedFloors,
      nodesCount: stairNodesCount,
      status: connectedFloors.length >= 2 ? "Multi-floor Connected" : "Single Floor",
    };
  });

  const handleDelete = (id: string, name: string) => {
    campusStore.deleteStairGroup(id);
    toast({
      type: "info",
      title: "Staircase Deleted",
      description: `Removed stair group "${name}" and its vertical routing nodes.`,
    });
  };

  return (
    <>
      <PageHeader
        title="Stairs & Vertical Connections"
        description="Manage multi-floor staircases, vertical stair nodes, and inter-floor connections across campus buildings."
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
              <Plus className="h-4 w-4" /> New Staircase
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="PLACE_VERTICAL" />
      ) : (
        <DataTable
          emptyMessage="No staircases yet. Group stair nodes to connect floors vertically."
          keyField="id"
          data={rows}
          columns={[
            { key: "id", label: "ID", className: "font-mono text-xs text-[rgb(var(--muted-fg))]" },
            {
              key: "name",
              label: "Staircase Name",
              render: (r) => (
                <div className="flex items-center gap-2 font-semibold text-[rgb(var(--fg))]">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <Footprints className="h-4 w-4" />
                  </div>
                  <span>{String(r.name)}</span>
                </div>
              ),
            },
            { key: "building", label: "Building Location" },
            {
              key: "connectedFloors",
              label: "Connected Floors",
              render: (r) => {
                const floors = r.connectedFloors as Array<{ id: string; name: string; code?: string }>;
                if (!floors || floors.length === 0) {
                  return <span className="text-xs text-[rgb(var(--muted-fg))] italic">No floors assigned</span>;
                }
                return (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {floors.map((fl) => (
                      <span
                        key={fl.id}
                        className="inline-flex items-center gap-1 rounded bg-[rgb(var(--primary)/0.1)] px-2 py-0.5 text-xs font-semibold text-[rgb(var(--primary))]"
                      >
                        <Layers className="h-3 w-3" />
                        {fl.code || fl.name}
                      </span>
                    ))}
                  </div>
                );
              },
            },
            {
              key: "nodesCount",
              label: "Vertical Nodes",
              render: (r) => (
                <span className="font-mono text-xs font-medium">{String(r.nodesCount)} nodes</span>
              ),
            },
            {
              key: "status",
              label: "Routing Status",
              render: (r) => (
                <Badge variant={String(r.status).includes("Multi") ? "success" : "default"}>
                  {String(r.status)}
                </Badge>
              ),
            },
            {
              key: "actions",
              label: "Actions",
              render: (r) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => setPendingDelete({ id: String(r.id), name: String(r.name) })}
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
        description="The staircase and its vertical routing nodes are removed, so multi-floor routes through it will fail."
        confirmLabel="Delete staircase"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) handleDelete(pendingDelete.id, pendingDelete.name);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
