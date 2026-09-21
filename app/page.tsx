import { Navbar } from "@/shared/components/layout/navbar";
import { ExplorePanel } from "@/features/search/explore-panel";

export const metadata = { title: "Home · CampusNav" };

export default function HomePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Navbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 md:px-6">
        <div className="mb-10 text-center md:text-left">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[rgb(var(--primary))]">
            Explore Campus
          </div>
          <h1 className="h-display mt-2 text-3xl font-semibold md:text-4xl">
            Browse everything <span className="gradient-text">on campus</span>
          </h1>
          <p className="mt-2 text-sm text-[rgb(var(--muted-fg))] md:text-base">
            Search rooms, buildings, laboratories, offices. Tap any card to navigate.
          </p>
        </div>
        <ExplorePanel />
      </main>
    </div>
  );
}

