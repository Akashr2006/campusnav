import Link from "next/link";
import { Compass, ArrowLeft, Search } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

export default function NotFound() {
  return (
    <div className="mesh-bg relative flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-center">
      <div aria-hidden className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />
      <div className="relative">
        <div className="absolute inset-0 rounded-2xl gradient-primary opacity-30 blur-xl" aria-hidden />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl gradient-primary text-white shadow-[var(--shadow-lg)]">
          <Compass className="h-8 w-8" />
        </div>
      </div>
      <div className="gradient-text text-6xl font-semibold tracking-tight md:text-7xl">
        404
      </div>
      <h1 className="h-display text-2xl font-semibold md:text-3xl">Off the map</h1>
      <p className="max-w-md text-sm text-[rgb(var(--muted-fg))] md:text-base">
        This page isn&apos;t in the campus graph. Let&apos;s get you back on route.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/">
          <Button variant="gradient">
            <ArrowLeft className="h-4 w-4" />
            Return home
          </Button>
        </Link>
        <Link href="/">
          <Button variant="outline">
            <Search className="h-4 w-4" />
            Explore campus
          </Button>
        </Link>

      </div>
    </div>
  );
}
