import { PageHeader } from "@/features/admin/components/page-header";
import { RouteSimulator } from "@/features/admin/components/route-simulator";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Route Simulator"
        description="Test routes before publishing. Pick a start and destination."
      />
      <RouteSimulator />
    </>
  );
}
