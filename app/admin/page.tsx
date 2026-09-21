"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Layers,
  DoorOpen,
  Waypoints,
  GitFork,
  ArrowRight,
  Sparkles,
  Compass,
  PencilRuler,
  Footprints,
  Route,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/features/admin/components/page-header";
import { Card, CardTitle, CardDescription } from "@/shared/components/ui/card";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { campusStore } from "@/shared/lib/campus-store";

const quickActions = [
  { href: "/admin/entity-management", label: "Entity Management", description: "Dedicated panel for creating, editing & managing all campus objects with real-time CAD sync", badge: "Primary Hub" },
  { href: "/admin/editor", label: "CAD Canvas Editor", description: "Interactive full-screen CAD editor for buildings, nodes, edges & hazards", badge: "CAD Engine" },
  { href: "/admin/buildings", label: "Manage Buildings", description: "Create and configure campus building shapes" },
  { href: "/admin/stairs", label: "Manage Stairs", description: "Configure multi-floor staircases & vertical routes" },
  { href: "/admin/nodes", label: "Manage Nodes", description: "View and edit campus graph nodes" },
  { href: "/admin/edges", label: "Manage Edges", description: "Configure connections between nodes" },
  { href: "/admin/simulator", label: "Route Simulator", description: "Test pathfinding and shortest path calculations" },
];

export default function AdminHome() {
  const [storeData, setStoreData] = useState(() => campusStore.getWorkingData());
  const [showAltRoute, setShowAltRoute] = useState(() => campusStore.getShowAlternativeRoute());
  const [instantSync, setInstantSync] = useState(() => campusStore.getInstantLiveSync());
  const [publishedVersion, setPublishedVersion] = useState(() => campusStore.getPublishedVersion());
  const [isPublished, setIsPublished] = useState(false);

  useEffect(() => {
    setStoreData(campusStore.getWorkingData());
    setShowAltRoute(campusStore.getShowAlternativeRoute());
    setInstantSync(campusStore.getInstantLiveSync());
    setPublishedVersion(campusStore.getPublishedVersion());
    setIsPublished(campusStore.hasPublishedGraph());
    const unsubscribe = campusStore.subscribe(() => {
      setStoreData(campusStore.getWorkingData());
      setShowAltRoute(campusStore.getShowAlternativeRoute());
      setInstantSync(campusStore.getInstantLiveSync());
      setPublishedVersion(campusStore.getPublishedVersion());
      setIsPublished(campusStore.hasPublishedGraph());
    });
    return unsubscribe;
  }, []);

  const stats = [
    { label: "Buildings", value: storeData.buildings.length, icon: Building2, href: "/admin/buildings" },
    { label: "Floors", value: storeData.floors.length, icon: Layers, href: "/admin/floors" },
    { label: "Stairs", value: storeData.stairGroups.length, icon: Footprints, href: "/admin/stairs" },
    { label: "Nodes", value: storeData.nodes.length, icon: Waypoints, href: "/admin/nodes" },
    { label: "Edges", value: storeData.edges.length, icon: GitFork, href: "/admin/edges" },
    { label: "Destinations", value: storeData.destinations.length, icon: DoorOpen, href: "/admin/search" },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Digital Twin Overview"
        title="Main Campus Dashboard"
        description="Live overview of the campus graph. Use the CAD Editor to visually build & edit the map."
        action={
          <Badge variant={instantSync ? "warning" : isPublished ? "success" : "default"}>
            <span
              className={`mr-1.5 inline-flex h-1.5 w-1.5 rounded-full ${
                instantSync
                  ? "bg-amber-500 pulse-dot"
                  : isPublished
                    ? "bg-[rgb(var(--success))] pulse-dot"
                    : "bg-[rgb(var(--muted-fg))]"
              }`}
            />
            {instantSync
              ? "Live Draft Mode · Instant Sync"
              : isPublished
                ? `Published Mode · ${publishedVersion}`
                : "Not published yet"}
          </Badge>
        }
      />

      {storeData.buildings.length === 0 && (
        <div className="mb-4 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-5">
          <h3 className="text-base font-semibold tracking-tight">Set up your campus</h3>
          <p className="mt-1 text-sm text-[rgb(var(--muted-fg))]">
            The map is empty. Work through these steps to get a navigable campus.
          </p>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              { n: 1, title: "Draw buildings", body: "Place building footprints and their floors on the canvas." },
              { n: 2, title: "Add nodes & paths", body: "Mark rooms, entrances and stairs, then connect them with edges." },
              { n: 3, title: "Publish", body: "Push the draft live so visitors can search and navigate it." },
            ].map((step) => (
              <li key={step.n} className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.4)] p-3.5">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[rgb(var(--primary))] text-[10px] font-bold text-white">
                    {step.n}
                  </span>
                  <span className="text-sm font-semibold">{step.title}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-[rgb(var(--muted-fg))]">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Featured CAD Editor Banner */}
      <div className="mb-4 rounded-xl border border-[rgb(var(--primary)/0.3)] bg-gradient-to-r from-[rgb(var(--primary)/0.08)] via-[rgb(var(--card))] to-[rgb(var(--primary)/0.04)] p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl gradient-primary text-white shadow-md">
              <PencilRuler className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-[rgb(var(--fg))]">Interactive CAD Canvas Editor</h3>
                <Badge variant="primary" className="text-[10px]">CAD Engine</Badge>
              </div>
              <p className="text-xs text-[rgb(var(--muted-fg))] mt-0.5">
                Visually draw campus buildings, place nodes & edges, manage room destinations, set obstacle hazards, and test route simulation.
              </p>
            </div>
          </div>
          <Link href="/admin/editor" className="shrink-0">
            <Button size="sm" variant="primary" className="gap-1.5">
              <Compass className="h-4 w-4" /> Open CAD Editor <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        </div>
      </div>

      {/* Control & Publishing Mode Settings */}
      <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Instant Live Sync Without Publish Toggle */}
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4 shadow-xs">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200/60 dark:border-amber-800/60">
                <Zap className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[rgb(var(--fg))]">Live Sync Without Publish</h3>
                  <Badge variant={instantSync ? "success" : "default"} className="text-[10px]">
                    {instantSync ? "Instant Mode" : "Requires Publish"}
                  </Badge>
                </div>
                <p className="text-xs text-[rgb(var(--muted-fg))] mt-0.5">
                  Show all new and edited buildings, nodes, paths, and destinations on the public user map immediately without needing to click Publish.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={instantSync}
              onClick={() => {
                const next = !instantSync;
                setInstantSync(next);
                campusStore.setInstantLiveSync(next);
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
                instantSync ? "bg-amber-500" : "bg-slate-300 dark:bg-slate-700"
              }`}
              title={instantSync ? "Switch to staged publish mode" : "Enable instant sync without publishing"}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  instantSync ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Alternative Routes Navigation Toggle */}
        <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4 shadow-xs">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-200/60 dark:border-indigo-800/60">
                <Route className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[rgb(var(--fg))]">Alternative Routes</h3>
                  <Badge variant={showAltRoute ? "success" : "default"} className="text-[10px]">
                    {showAltRoute ? "Enabled on Map" : "Hidden"}
                  </Badge>
                </div>
                <p className="text-xs text-[rgb(var(--muted-fg))] mt-0.5">
                  Calculate and display the second shortest alternative route with light opacity on the user navigation map.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showAltRoute}
              onClick={() => {
                const next = !showAltRoute;
                setShowAltRoute(next);
                campusStore.setShowAlternativeRoute(next);
              }}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                showAltRoute ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
              }`}
              title={showAltRoute ? "Disable alternative route on user map" : "Enable alternative route on user map"}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                  showAltRoute ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Link key={s.label} href={s.href}>
              <Card hover className="group p-5">
                <div className="mb-3 inline-flex rounded-lg bg-[rgb(var(--primary)/0.08)] p-2 text-[rgb(var(--primary))] transition-colors group-hover:bg-[rgb(var(--primary)/0.15)]">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="text-2xl font-semibold tracking-tight">{s.value}</div>
                <div className="mt-0.5 text-xs text-[rgb(var(--muted-fg))]">
                  {s.label}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="mt-8">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[rgb(var(--primary))]" />
          <h2 className="text-lg font-semibold tracking-tight">Quick Actions</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {quickActions.map((action) => (
            <Link key={action.href} href={action.href}>
              <Card hover className="group flex h-full flex-col justify-between p-5">
                <div>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{action.label}</CardTitle>
                    {action.badge && (
                      <Badge variant="primary" className="text-[10px]">
                        {action.badge}
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="mt-1 text-xs">
                    {action.description}
                  </CardDescription>
                </div>
                <div className="mt-4 flex items-center justify-end text-xs font-medium text-[rgb(var(--primary))] group-hover:underline">
                  Open <ArrowRight className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
