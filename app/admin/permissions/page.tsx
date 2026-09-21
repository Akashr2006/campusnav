import { PageHeader } from "@/features/admin/components/page-header";
import { Card, CardTitle } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";

const roles = [
  { name: "Super Admin", desc: "Full system access.", perms: ["*"] },
  { name: "Admin", desc: "Manage campus data and graph.", perms: ["campus.*", "building.*", "floor.*", "room.*", "node.*", "edge.*"] },
  { name: "Faculty", desc: "Read + share locations.", perms: ["navigation.read"] },
  { name: "Student", desc: "Read + favourites.", perms: ["navigation.read"] },
  { name: "Guest", desc: "Read-only navigation.", perms: ["navigation.read"] },
];

export default function Page() {
  return (
    <>
      <PageHeader
        title="Permissions"
        description="Role-permission matrix. Business logic never checks role names — only permissions."
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {roles.map((r) => (
          <Card key={r.name}>
            <div className="mb-1 flex items-center justify-between">
              <CardTitle>{r.name}</CardTitle>
              <Badge>{r.perms.length} perms</Badge>
            </div>
            <p className="mb-3 text-sm text-[rgb(var(--muted-fg))]">{r.desc}</p>
            <div className="flex flex-wrap gap-1">
              {r.perms.map((p) => (
                <span
                  key={p}
                  className="rounded-md bg-[rgb(var(--muted))] px-2 py-0.5 font-mono text-[11px]"
                >
                  {p}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
