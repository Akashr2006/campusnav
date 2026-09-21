"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { campusStore } from "@/shared/lib/campus-store";
import { cn } from "@/shared/lib/utils";
import {
  LayoutDashboard,
  Building2,
  Layers,
  DoorOpen,
  Waypoints,
  GitFork,
  AlertTriangle,
  Search,
  Play,
  History,
  Compass,
  ChevronLeft,
  Footprints,
  Boxes,
  Scan,
  type LucideIcon,
} from "lucide-react";
import { useAdminAuth } from "@/features/admin/components/admin-guard";
import { LogOut } from "lucide-react";

type NavItem = { href: string; label: string; icon: LucideIcon; badge?: string };

export const adminNavGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Digital Twin",
    items: [
      { href: "/admin/entity-management", label: "Entity Management", icon: Boxes, badge: "Primary" },
      { href: "/admin/editor", label: "CAD Canvas Editor", icon: Compass, badge: "CAD" },
      { href: "/admin/buildings", label: "Buildings", icon: Building2 },
      { href: "/admin/floors", label: "Floors", icon: Layers },
      { href: "/admin/floor-plans", label: "Floor Plans", icon: Scan, badge: "Trace" },
      { href: "/admin/rooms", label: "Rooms", icon: DoorOpen },
      { href: "/admin/nodes", label: "Nodes", icon: Waypoints },
      { href: "/admin/edges", label: "Edges", icon: GitFork },
      { href: "/admin/obstacles", label: "Obstacles", icon: AlertTriangle },
      { href: "/admin/stairs", label: "Stairs", icon: Footprints },
    ],
  },
  {
    title: "Navigation",
    items: [
      { href: "/admin/simulator", label: "Route Simulator", icon: Play, badge: "Live" },
      { href: "/admin/search", label: "Search Manager", icon: Search },
      { href: "/admin/audit", label: "Audit Log", icon: History },
    ],
  },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-6">
      {adminNavGroups.map((g) => (
        <div key={g.title}>
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted-fg))]">
            {g.title}
          </div>
          <div className="flex flex-col gap-0.5">
            {g.items.map((item) => {
              const active =
                pathname === item.href ||
                (item.href !== "/admin" && pathname.startsWith(item.href));
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={true}
                  onClick={onNavigate}
                  className={cn(
                    "group relative flex items-center justify-start gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all whitespace-nowrap overflow-hidden text-ellipsis",
                    active
                      ? "bg-[rgb(var(--primary)/0.1)] text-[rgb(var(--primary))]"
                      : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]",
                  )}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[rgb(var(--primary))]" />
                  )}
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      active
                        ? "text-[rgb(var(--primary))]"
                        : "text-[rgb(var(--muted-fg))] group-hover:text-[rgb(var(--fg))]",
                    )}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                  {item.badge && (
                    <span className="shrink-0 whitespace-nowrap rounded-full bg-[rgb(var(--success)/0.12)] px-1.5 py-0.5 text-[10px] font-semibold text-[rgb(var(--success))]">
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Sidebar() {
  const { logout } = useAdminAuth();
  const [published, setPublished] = useState(false);
  const [version, setVersion] = useState(campusStore.getPublishedVersion());

  // Reflect the real publish state instead of a hardcoded label.
  useEffect(() => {
    const sync = () => {
      setPublished(campusStore.hasPublishedGraph());
      setVersion(campusStore.getPublishedVersion());
    };
    sync();
    return campusStore.subscribe(sync);
  }, []);

  return (
    <aside className="hidden w-72 shrink-0 border-r bg-[rgb(var(--bg-elev))]/60 lg:block">
      <div className="scrollbar-thin sticky top-0 flex h-dvh flex-col overflow-y-auto">
        {/* Brand Header */}
        <div className="flex h-16 items-center border-b px-4 shrink-0">
          <Link href="/" className="group flex items-center justify-between w-full min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gradient-primary text-white shadow-[var(--shadow-sm)]">
                <Compass className="h-4.5 w-4.5" />
              </div>
              <span className="text-base font-bold tracking-tight text-[rgb(var(--fg))] truncate">
                CampusNav
              </span>
            </div>
            <span className="shrink-0 rounded-md bg-[rgb(var(--primary)/0.1)] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-[rgb(var(--primary))]">
              ADMIN
            </span>
          </Link>
        </div>

        <div className="flex-1 p-4">
          <SidebarNav />
        </div>

        {/* Footer */}
        <div className="border-t p-4 space-y-1">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-600"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
          <Link
            href="/"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-[rgb(var(--muted-fg))] transition-colors hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]"
          >
            <ChevronLeft className="h-4 w-4" />
            Back to site
          </Link>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-[rgb(var(--muted))]/70 px-3 py-2 text-xs text-[rgb(var(--muted-fg))]">
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                published ? "bg-emerald-500" : "bg-amber-500"
              )}
            />
            <span className="truncate">
              {published ? `Map ${version} · Published` : "Not published yet"}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
}
