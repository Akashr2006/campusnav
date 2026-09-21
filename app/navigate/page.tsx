import { Suspense } from "react";
import { Navbar } from "@/shared/components/layout/navbar";
import { NavigateShell } from "@/features/navigation/components/navigate-shell";

export const metadata = { title: "Navigate · CampusNav" };

export default function NavigatePage() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <Navbar />
      <Suspense
        fallback={
          <div className="flex flex-1 items-center justify-center gap-3 p-6 text-sm text-[rgb(var(--muted-fg))]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Loading map…
          </div>
        }
      >
        <NavigateShell />
      </Suspense>
    </div>
  );
}
