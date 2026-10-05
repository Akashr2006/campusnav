"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, ArrowRight, Home, Navigation } from "lucide-react";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/lib/utils";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";

// "3D Campus" opens the drone 3D view (the /navigate 3D tab: the survey mesh,
// 360 degree views, routes on the surveyed roads). The modelled 3D studio
// stays at /navigate-3d, which points back here.
const links: { href: string; label: string; active: (pathname: string) => boolean }[] = [
  { href: "/", label: "Home", active: (p) => p === "/" },
  { href: "/navigate", label: "Navigate", active: (p) => p === "/navigate" },
  { href: "/navigate?view=3d", label: "3D Campus", active: (p) => p.startsWith("/navigate-3d") },
];

export function Navbar() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  const isNavigatePage = pathname === "/navigate";

  useEffect(() => {
    const onScroll = () => {
      const isScrolled = window.scrollY > 8;
      setScrolled((prev) => (prev !== isScrolled ? isScrolled : prev));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-[rgb(var(--border))] transition-shadow duration-200 glass-strong",
        scrolled ? "shadow-[var(--shadow-sm)]" : "",
      )}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-3 sm:px-4 md:px-6">
        <Link href="/" className="group flex items-center gap-2.5 shrink-0">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-[rgb(var(--primary))] opacity-30 blur-md group-hover:opacity-60 transition-opacity" />
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl gradient-primary text-white shadow-[var(--shadow-sm)]">
              <Compass className="h-4.5 w-4.5" />
            </div>
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-semibold tracking-tight">
              CampusNav
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.2em] text-[rgb(var(--muted-fg))] sm:block">
              Digital Twin
            </span>
          </div>
        </Link>

        {/* Mobile Quick Navigation Buttons (Between Logo and Theme Changer) */}
        <nav aria-label="Mobile Navigation" className="flex items-center gap-1 md:hidden">
          <Link
            href="/"
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              pathname === "/"
                ? "bg-[rgb(var(--primary))] text-white shadow-xs font-bold"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]"
            )}
          >
            <Home className="h-3.5 w-3.5" />
            <span>Home</span>
          </Link>
          <Link
            href="/navigate"
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
              isNavigatePage
                ? "bg-[rgb(var(--primary))] text-white shadow-xs font-bold"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]"
            )}
          >
            <Navigation className="h-3.5 w-3.5" />
            <span>Navigate</span>
          </Link>
        </nav>

        {/* Desktop Navigation Links */}
        <nav aria-label="Desktop Navigation" className="hidden items-center gap-1 rounded-full border border-[rgb(var(--border))] bg-[rgb(var(--card))]/60 p-1 md:flex">
          {links.map((l) => {
            const active = l.active(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={cn(
                  "relative rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "text-[rgb(var(--fg))]"
                    : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute inset-0 -z-10 rounded-full bg-[rgb(var(--muted))]"
                    transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
                  />
                )}
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <Link href="/navigate" className="hidden sm:block">
            <Button size="sm" variant="gradient">
              Start Navigating
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
