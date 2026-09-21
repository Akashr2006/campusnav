"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { Card, CardDescription, CardTitle } from "@/shared/components/ui/card";
import { campusStore } from "@/shared/lib/campus-store";

type BarRow = { label: string; value: number };

function BarList({ rows, empty }: { rows: BarRow[]; empty: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-[rgb(var(--muted-fg))]">{empty}</p>;
  }
  return (
    <div className="mt-4 space-y-3">
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}</span>
            <span className="shrink-0 font-mono text-xs text-[rgb(var(--muted-fg))]">{r.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[rgb(var(--muted))]">
            <div
              className="h-full rounded-full bg-[rgb(var(--primary))]"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Page() {
  const [data, setData] = useState(() => campusStore.getWorkingData());
  const [logs, setLogs] = useState(() => campusStore.getAuditLogs());

  useEffect(() => {
    const sync = () => {
      setData(campusStore.getWorkingData());
      setLogs([...campusStore.getAuditLogs()]);
    };
    sync();
    return campusStore.subscribe(sync);
  }, []);

  const stats = useMemo(() => {
    const nodes = data.nodes ?? [];
    const edges = data.edges ?? [];

    const connected = new Set<string>();
    edges.forEach((e) => {
      connected.add(e.from);
      connected.add(e.to);
    });
    const isolated = nodes.filter((n) => !connected.has(n.id)).length;

    const byType = new Map<string, number>();
    nodes.forEach((n) => byType.set(n.type, (byType.get(n.type) ?? 0) + 1));

    const byEdgeType = new Map<string, number>();
    edges.forEach((e) => byEdgeType.set(e.type, (byEdgeType.get(e.type) ?? 0) + 1));

    const roomsPerBuilding = (data.buildings ?? []).map((b) => {
      const floorIds = new Set((data.floors ?? []).filter((f) => f.buildingId === b.id).map((f) => f.id));
      return {
        label: b.name,
        value: (data.destinations ?? []).filter((d) => d.floorId && floorIds.has(d.floorId)).length,
      };
    });

    return {
      isolated,
      avgDegree: nodes.length ? (edges.length * 2) / nodes.length : 0,
      nodeTypes: [...byType.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
      edgeTypes: [...byEdgeType.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value),
      roomsPerBuilding: roomsPerBuilding.sort((a, b) => b.value - a.value),
    };
  }, [data]);

  const counts: [string, number][] = [
    ["Buildings", (data.buildings ?? []).length],
    ["Floors", (data.floors ?? []).length],
    ["Destinations", (data.destinations ?? []).length],
    ["Nodes", (data.nodes ?? []).length],
    ["Edges", (data.edges ?? []).length],
    ["Obstacles", (data.obstacles ?? []).length],
  ];

  return (
    <>
      <PageHeader
        title="Graph Analytics"
        description="Composition and connectivity of the campus digital twin."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {counts.map(([label, value]) => (
          <Card key={label} className="p-4">
            <div className="text-xs text-[rgb(var(--muted-fg))]">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Nodes by type</CardTitle>
          <CardDescription>What the graph is actually made of.</CardDescription>
          <BarList rows={stats.nodeTypes} empty="No nodes placed yet." />
        </Card>

        <Card>
          <CardTitle>Connectivity</CardTitle>
          <CardDescription>Routing health of the current draft.</CardDescription>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[rgb(var(--muted-fg))]">Avg. connections per node</dt>
              <dd className="font-mono tabular-nums">{stats.avgDegree.toFixed(2)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-[rgb(var(--muted-fg))]">Unreachable nodes</dt>
              <dd
                className={
                  stats.isolated > 0
                    ? "font-mono tabular-nums text-[rgb(var(--danger))]"
                    : "font-mono tabular-nums text-[rgb(var(--success))]"
                }
              >
                {stats.isolated}
              </dd>
            </div>
          </dl>
          <div className="mt-5 border-t border-[rgb(var(--border))] pt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
              Edges by type
            </div>
            <BarList rows={stats.edgeTypes} empty="No edges drawn yet." />
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Destinations per building</CardTitle>
          <CardDescription>Where searchable places are concentrated.</CardDescription>
          <BarList rows={stats.roomsPerBuilding} empty="No buildings yet." />
        </Card>

        <Card>
          <CardTitle>Recent changes</CardTitle>
          <CardDescription>Edits recorded in this session&apos;s audit log.</CardDescription>
          {logs.length === 0 ? (
            <p className="py-6 text-center text-sm text-[rgb(var(--muted-fg))]">
              No changes recorded yet.
            </p>
          ) : (
            <ul className="scrollbar-thin mt-4 max-h-64 space-y-1 overflow-y-auto">
              {logs.slice(0, 12).map((log) => (
                <li
                  key={log.id}
                  className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-[rgb(var(--muted))]"
                >
                  <span className="w-16 shrink-0 font-mono text-[10px] font-bold uppercase text-[rgb(var(--muted-fg))]">
                    {log.action}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{log.resource}</span>
                  <span className="shrink-0 text-xs text-[rgb(var(--muted-fg))]">{log.at}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
