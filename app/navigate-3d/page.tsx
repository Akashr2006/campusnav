import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Navbar } from "@/shared/components/layout/navbar";
import { Navigate3DView } from "@/features/navigation-3d/components/navigate-3d-view";

export const metadata = { title: "3D Studio · CampusNav" };

export default function Navigate3DPage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Navbar />
      {/* This is the modelled studio (structure, explode, thermal). Bookmarks and
          old links still land here, so point to the drone 3D view, which the
          site's "3D Campus" link now opens. */}
      <div className="flex shrink-0 items-center justify-center gap-2 border-b border-[rgb(var(--border))] bg-[#eef6ff] px-3 py-2 text-center text-[13px] text-[#1f3a5f]">
        <span>
          This is the 3D studio (modelled buildings, structure, explode).{" "}
          <span className="hidden sm:inline">The sharp drone survey view, with 360° views and routes along the real roads, is the 3D view.</span>
        </span>
        <Link
          href="/navigate?view=3d"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#2ea3dc] px-3 py-1 font-medium text-white hover:brightness-95"
        >
          Open the 3D view <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <Navigate3DView />
    </div>
  );
}
