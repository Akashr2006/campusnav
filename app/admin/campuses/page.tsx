"use client";

import { PageHeader } from "@/features/admin/components/page-header";
import { DataTable } from "@/features/admin/components/data-table";
import { Button } from "@/shared/components/ui/button";
import { Plus } from "lucide-react";
import { campus } from "@/shared/data/campus";

export default function Page() {
  const rows = [campus];
  return (
    <>
      <PageHeader
        title="Campuses"
        description="Every campus owns its own Digital Twin."
        action={
          <Button size="sm">
            <Plus className="h-4 w-4" /> New Campus
          </Button>
        }
      />
      <DataTable
        keyField="id"
        data={rows}
        columns={[
          { key: "name", label: "Name" },
          { key: "slug", label: "Slug" },
          {
            key: "coords",
            label: "Coordinates",
            render: (c) => `${(c.lat as number).toFixed(6)}, ${(c.lng as number).toFixed(6)}`,
          },
        ]}
      />
    </>
  );
}
