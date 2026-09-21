"use client";

import Link from "next/link";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/shared/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="mesh-bg relative flex min-h-screen flex-col items-center justify-center gap-5 p-6 text-center">
      <div aria-hidden className="grid-pattern pointer-events-none absolute inset-0 opacity-40" />
      <div className="rounded-2xl bg-[rgb(var(--danger)/0.12)] p-4 ring-1 ring-[rgb(var(--danger)/0.2)]">
        <AlertTriangle className="h-8 w-8 text-[rgb(var(--danger))]" />
      </div>
      <h1 className="h-display text-2xl font-semibold md:text-3xl">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-[rgb(var(--muted-fg))] md:text-base">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={reset} variant="gradient">
          <RotateCcw className="h-4 w-4" />
          Try again
        </Button>
        <Link href="/">
          <Button variant="outline">
            <Home className="h-4 w-4" />
            Return home
          </Button>
        </Link>
      </div>
    </div>
  );
}
