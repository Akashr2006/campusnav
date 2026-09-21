"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronRight,
  Menu,
  X,
  Rocket,
  Compass,
  ExternalLink,
  LogOut,
} from "lucide-react";
import { ThemeToggle } from "@/shared/components/ui/theme-toggle";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";
import { SidebarNav } from "./sidebar";
import { useAdminAuth } from "@/features/admin/components/admin-guard";
import { campusStore } from "@/shared/lib/campus-store";
import { PublishModal } from "@/shared/components/publish-modal";

const labels: Record<string, string> = {
  admin: "Admin",
  "entity-management": "Entity Management",
  editor: "CAD Canvas Editor",
  analytics: "Analytics",
  campuses: "Campuses",
  buildings: "Buildings",
  floors: "Floors",
  "floor-plans": "Floor Plans",
  rooms: "Rooms",
  nodes: "Nodes",
  edges: "Edges",
  obstacles: "Obstacles",
  simulator: "Route Simulator",
  search: "Search Manager",
  audit: "Audit Log",
};

export function AdminTopbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const { toast } = useToast();
  const { logout } = useAdminAuth();

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => ({
    label: labels[seg] ?? seg,
    href: "/" + segments.slice(0, i + 1).join("/"),
    last: i === segments.length - 1,
  }));

  return (
    <>
      <header className="glass-strong sticky top-0 z-40 border-b">
        <div className="flex h-16 items-center justify-between gap-2 sm:gap-3 px-3 sm:px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            {/* Mobile menu */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden shrink-0 h-8 w-8 sm:h-9 sm:w-9"
              onClick={() => setOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-4 w-4" />
            </Button>

            {/* Breadcrumb */}
            <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 sm:gap-1.5 text-xs sm:text-sm">
              {crumbs.map((c) => (
                <span key={c.href} className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                  {c.href !== "/admin" && (
                    <ChevronRight className="h-3 w-3 sm:h-3.5 sm:w-3.5 shrink-0 text-[rgb(var(--muted-fg))]" />
                  )}
                  {c.last ? (
                    <span className="truncate font-semibold">{c.label}</span>
                  ) : (
                    <Link
                      href={c.href}
                      className="truncate text-[rgb(var(--muted-fg))] transition-colors hover:text-[rgb(var(--fg))]"
                    >
                      {c.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link href="/navigate" target="_blank" className="hidden md:block">
              <Button size="sm" variant="ghost">
                <ExternalLink className="h-3.5 w-3.5" />
                View site
              </Button>
            </Link>
            <ThemeToggle />

            <Button
              size="sm"
              variant="gradient"
              onClick={() => setShowPublishModal(true)}
            >
              <Rocket className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Publish</span>
            </Button>
            <Button size="sm" variant="outline" onClick={logout} title="Sign Out">
              <LogOut className="h-3.5 w-3.5 text-red-500" />
              <span className="hidden md:inline text-red-500">Logout</span>
            </Button>
          </div>
        </div>
      </header>

      <PublishModal open={showPublishModal} onClose={() => setShowPublishModal(false)} />

      {/* Mobile drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm lg:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", bounce: 0, duration: 0.35 }}
              className="scrollbar-thin fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r bg-[rgb(var(--card))] shadow-[var(--shadow-lg)] lg:hidden"
            >
              <div className="flex h-16 items-center justify-between border-b px-4">
                <Link href="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-primary text-white">
                    <Compass className="h-4.5 w-4.5" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold tracking-tight text-[rgb(var(--fg))]">
                      CampusNav
                    </span>
                    <span className="rounded-md bg-[rgb(var(--primary)/0.1)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-[rgb(var(--primary))]">
                      ADMIN
                    </span>
                  </div>
                </Link>

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <div className="p-4">
                <SidebarNav onNavigate={() => setOpen(false)} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
