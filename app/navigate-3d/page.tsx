import { Navbar } from "@/shared/components/layout/navbar";
import { Navigate3DView } from "@/features/navigation-3d/components/navigate-3d-view";

export const metadata = { title: "3D Campus · CampusNav" };

export default function Navigate3DPage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Navbar />
      <Navigate3DView />
    </div>
  );
}
