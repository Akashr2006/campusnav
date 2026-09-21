"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Badge } from "@/shared/components/ui/badge";
import { campusStore, type AuditLogEntry } from "@/shared/lib/campus-store";

const variant: Record<string, Parameters<typeof Badge>[0]["variant"]> = {
  PUBLISH: "success",
  UPDATE: "primary",
  CREATE: "success",
  DELETE: "danger",
  LOGIN: "default",
};

export default function Page() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    setLogs(campusStore.getAuditLogs());
    const unsub = campusStore.subscribe(() => {
      setLogs(campusStore.getAuditLogs());
    });
    return unsub;
  }, []);

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Every administrative action is recorded immutably."
      />
      {logs.length === 0 ? (
        <div className="card flex flex-col items-center justify-center p-12 text-center text-[rgb(var(--muted-fg))]">
          <div className="text-base font-medium text-[rgb(var(--fg))]">No audit logs recorded yet</div>
          <div className="mt-1 text-xs">Actions such as publishing, creating buildings, updating nodes, and logging in will appear here live.</div>
        </div>
      ) : (
        <DataTable
          keyField="id"
          data={logs}
          columns={[
            {
              key: "action",
              label: "Action",
              render: (r) => (
                <Badge variant={variant[String(r.action)] ?? "default"}>
                  {String(r.action)}
                </Badge>
              ),
            },
            { key: "resource", label: "Resource" },
            { key: "user", label: "User" },
            { key: "at", label: "When" },
          ]}
        />
      )}
    </>
  );
}
