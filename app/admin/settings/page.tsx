import { PageHeader } from "@/features/admin/components/page-header";
import { Card, CardTitle, CardDescription } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Global configuration for the CampusNav deployment."
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Displayed across the app.</CardDescription>
          <div className="mt-4 space-y-3">
            <Field label="Campus name" defaultValue="TKU Main Campus" />
            <Field label="Slug" defaultValue="main" />
            <Field label="Support email" defaultValue="support@campus.edu" />
          </div>
        </Card>

        <Card>
          <CardTitle>Navigation defaults</CardTitle>
          <CardDescription>Applied to new sessions.</CardDescription>
          <div className="mt-4 space-y-3">
            <Field label="Walking speed (m/s)" defaultValue="1.3" />
            <Field label="Rerouting threshold (m)" defaultValue="15" />
            <Field label="Max alternatives" defaultValue="3" />
          </div>
        </Card>

        <Card>
          <CardTitle>Search</CardTitle>
          <CardDescription>Ranking & suggestions.</CardDescription>
          <div className="mt-4 space-y-3">
            <Field label="Autocomplete limit" defaultValue="8" />
            <Field label="Popularity boost" defaultValue="0.25" />
          </div>
        </Card>

        <Card>
          <CardTitle>Feature flags</CardTitle>
          <CardDescription>Toggle experimental features safely.</CardDescription>
          <div className="mt-4 space-y-2 text-sm">
            {[
              ["Voice navigation", true],
              ["Offline mode", false],
              ["AR preview", false],
              ["Live analytics", true],
            ].map(([label, on]) => (
              <div
                key={label as string}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span>{label as string}</span>
                <span
                  className={`h-4 w-8 rounded-full ${on ? "bg-[rgb(var(--primary))]" : "bg-[rgb(var(--border))]"}`}
                >
                  <span
                    className={`block h-3 w-3 translate-y-0.5 rounded-full bg-white transition-all ${on ? "translate-x-4" : "translate-x-0.5"}`}
                  />
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 flex justify-end">
        <Button>Save changes</Button>
      </div>
    </>
  );
}

function Field({ label, defaultValue }: { label: string; defaultValue: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[rgb(var(--muted-fg))]">
        {label}
      </span>
      <Input defaultValue={defaultValue} />
    </label>
  );
}
