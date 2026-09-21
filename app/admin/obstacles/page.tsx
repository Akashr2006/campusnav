"use client";

import { useState, useEffect } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { ConfirmDialog } from "@/shared/components/ui/confirm-dialog";
import { Plus, LayoutGrid, Table, Trash2, Undo2, Redo2, AlertTriangle } from "lucide-react";
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

  const rows = storeData.obstacles.map((obs) => {
    const f = storeData.floors.find((fl) => fl.id === obs.floorId);
    const b = f ? storeData.buildings.find((bg) => bg.id === f.buildingId) : undefined;
    const isRouteOnly = Boolean(obs.edgeIds && obs.edgeIds.length > 0);

    return {
      id: obs.id,
      reason: obs.reason || "Hazard / Obstacle",
      mode: isRouteOnly ? "Route-Only Edge" : "Spatial Area",
      radius: isRouteOnly ? "N/A (Blocked Edge)" : `${obs.radius} px`,
      location: f ? `${b?.name ? `${b.name} - ` : ""}${f.name}` : "Outdoor Campus",
      severity: obs.severity ?? "HIGH",
    };
  });

  const handleDelete = (id: string) => {
    campusStore.deleteObstacle(id);
    toast({
      type: "info",
      title: "Obstacle Deleted",
      description: `Removed obstacle ${id} from digital twin graph.`,
    });
  };

  return (
    <>
      <PageHeader
        title="Obstacles & Hazards"
        description="View and manage active campus hazards, construction zones, and blocked route obstacles."
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
              <Plus className="h-4 w-4" /> New Obstacle
            </Button>
          </div>
        }
      />

      {viewMode === "EDITOR" ? (
        <DigitalTwinEditor initialTool="OBSTACLE" />
      ) : (
        <DataTable
          emptyMessage="No obstacles. Add one to route people around construction or closures."
          keyField="id"
          data={rows}
          columns={[
            { key: "id", label: "ID", className: "font-mono text-xs" },
            {
              key: "reason",
              label: "Reason / Label",
              render: (r) => (
                <div className="flex items-center gap-1.5 font-semibold text-red-600 dark:text-red-400">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span>{String(r.reason)}</span>
                </div>
              ),
            },
            {
              key: "mode",
              label: "Mode",
              render: (r) => (
                <Badge variant={String(r.mode).includes("Route") ? "warning" : "danger"}>
                  {String(r.mode)}
                </Badge>
              ),
            },
            { key: "radius", label: "Radius / Range" },
            { key: "location", label: "Location" },
            {
              key: "actions",
              label: "Actions",
              render: (obs) => (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                  onClick={() => setPendingDelete({ id: String(obs.id), name: String(obs.reason ?? obs.id) })}
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
        title={`Delete obstacle ${pendingDelete?.name ?? ""}?`}
        description="Routes currently avoiding this hazard will be recalculated through it."
        confirmLabel="Delete obstacle"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) handleDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
