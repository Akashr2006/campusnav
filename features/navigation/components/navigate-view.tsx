"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpDown,
  Box,
  Bus,
  ChevronDown,
  CornerUpLeft,
  CornerUpRight,
  Eye,
  Flag,
  Footprints,
  Home,
  LocateFixed,
  MapPin,
  Navigation,
  Pause,
  Play,
  Search,
  Undo2,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Destination } from "@/shared/data/campus";
import type { shortestPath as ShortestPath } from "@/features/navigation/services/graph";
import { createPathRouter, type PathNetworkFile, type PathRouter, type RouteEnd } from "@/features/navigation/lib/path-network";
import { getValidNavigationDestinations } from "@/shared/lib/destination-utils";
import type { TravelMode } from "@/lib/routing/edge-accessibility";
import { applyPilotStructure } from "@/shared/data/pilot-structure";
import { findTourScene } from "@/shared/data/campus-tour";
import { buildCampus3D, gpsToMetres, type Campus3D, type Vec2 } from "@/features/navigation-3d/lib/campus-3d";
import { FILTER_KINDS, KIND_LABEL, placeKind, type PlaceKind } from "../lib/place-kind";
import { PLAN, buildFeatures, type Footprint, type MapFeature, type RoadSegment } from "./campus-2d-map";
import { preloadOpeningView, useDroneMeshStatus, warmDroneCache } from "@/features/navigation/lib/drone-warmup";
import { cn } from "@/shared/lib/utils";

/**
 * /navigate — a clean indoor-map style navigator with two views of one campus:
 *  - 2D: a floor-plan style drawing of the 3D model's geometry.
 *  - 3D: the /navigate-3d scene itself, imported unchanged.
 * Search, routing and directions are shared; switching views keeps the route.
 */
const Campus2DMap = dynamic(() => import("./campus-2d-map").then((m) => m.Campus2DMap), {
  ssr: false,
  loading: () => <Loading text="Drawing the campus…" />,
});
const CampusScene = dynamic(
  () => import("@/features/navigation-3d/components/campus-scene").then((m) => m.CampusScene),
  { ssr: false, loading: () => <Loading text="Building the 3D campus…" dark /> }
);
// The 3D view and its engine (three.js, the tiles renderer: ~290 KB gzipped)
// are a separate chunk, so the page and its 2D map load without them.
const loadDroneView = () => import("./drone-view-3d");
const preloadDroneView = () => void loadDroneView().catch(() => {});
const DroneView3D = dynamic(() => loadDroneView().then((m) => m.DroneView3D), {
  ssr: false,
  loading: () => <Loading text="Opening the drone view…" />,
});

const ACCENT = "#2ea3dc";

function Loading({ text, dark }: { text: string; dark?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-1 items-center justify-center gap-3 text-sm",
        dark ? "bg-[#0b1120] text-slate-400" : "bg-[#f4f8fa] text-[#6b7785]"
      )}
    >
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#2ea3dc] border-t-transparent" />
      {text}
    </div>
  );
}

type Graph = Record<string, any>;

const MY_LOCATION_ID = "dest-live-user-location";

function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatDuration(sec: number) {
  const min = Math.max(1, Math.round(sec / 60));
  return min >= 60 ? `${Math.floor(min / 60)} hr ${min % 60} min` : `${min} min`;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(a));
}

/** What the sidebar shows of a route, from the surveyed paths or the published graph. */
type RouteView = {
  distance: number;
  durationSec: number;
  instructions: { text: string; distance: number; icon?: string }[];
  isFallbackWalk?: boolean;
  /** Routed along the roads and walkways detected in the drone survey. */
  surveyed?: boolean;
};

function stepIcon(step: { text: string; icon?: string }): LucideIcon {
  switch (step.icon) {
    case "start":
      return Navigation;
    case "left":
    case "slight-left":
      return CornerUpLeft;
    case "right":
    case "slight-right":
      return CornerUpRight;
    case "u-turn":
      return Undo2;
    case "arrive":
      return Flag;
    case "shuttle":
      return Bus;
    case "walk":
      return Footprints;
  }
  const t = step.text.toLowerCase();
  if (t.includes("arrive")) return Flag;
  if (t.includes("left")) return CornerUpLeft;
  if (t.includes("right")) return CornerUpRight;
  return ArrowUp;
}

/* ---------- form primitives, in the reference's quiet grey-field style ---------- */

function FieldLabel({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-1.5 flex items-center justify-between">
      <span className="text-[12px] text-[#7b8794]">{children}</span>
      {right}
    </div>
  );
}

function SelectField({
  value,
  onChange,
  children,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full cursor-pointer appearance-none truncate rounded-lg bg-[#f3f6f8] pl-4 pr-9 text-[14px] text-[#2b3640] outline-none transition focus:ring-2 focus:ring-[#2ea3dc]/30"
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b7785]" />
    </div>
  );
}

function PlaceField({
  label,
  value,
  options,
  onPick,
  onClear,
  extra,
  icon,
}: {
  label: string;
  value: Destination | null;
  options: Destination[];
  onPick: (d: Destination) => void;
  onClear: () => void;
  extra?: { label: string; onPick: () => void } | null;
  icon?: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setQuery(value?.name ?? ""), [value]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const q = value && query === value.name ? "" : query.trim().toLowerCase();
  const list = useMemo(
    () =>
      options
        .filter(
          (d) =>
            !q ||
            d.name.toLowerCase().includes(q) ||
            (d.category ?? "").toLowerCase().includes(q) ||
            (d.aliases ?? []).some((a) => a.toLowerCase().includes(q))
        )
        .sort((a, b) => {
          if (q) {
            const as = a.name.toLowerCase().startsWith(q);
            const bs = b.name.toLowerCase().startsWith(q);
            if (as !== bs) return as ? -1 : 1;
          }
          if ((a.category === "Building") !== (b.category === "Building")) return a.category === "Building" ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .slice(0, 40),
    [options, q]
  );
  const offset = extra ? 1 : 0;
  const pick = (d: Destination) => {
    onPick(d);
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <div
        className={cn(
          "flex h-10 items-center gap-2 rounded-lg bg-[#f3f6f8] pl-4 pr-2 transition",
          open && "bg-white ring-2 ring-[#2ea3dc]/30"
        )}
      >
        {icon}
        <input
          aria-label={label}
          placeholder={label}
          value={query}
          onFocus={(e) => {
            setOpen(true);
            setCursor(0);
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            const total = list.length + offset;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setCursor((c) => Math.min(total - 1, c + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setCursor((c) => Math.max(0, c - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (extra && cursor === 0) {
                extra.onPick();
                setOpen(false);
              } else if (list[cursor - offset]) pick(list[cursor - offset]);
            } else if (e.key === "Escape") {
              setOpen(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-[#2b3640] outline-none placeholder:text-[#98a4ae]"
        />
        {value ? (
          <button
            type="button"
            onClick={() => {
              onClear();
              setQuery("");
            }}
            aria-label={`Clear ${label}`}
            className="rounded p-1 text-[#8a96a3] hover:bg-[#e6ecf0]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <ChevronDown className="mr-1 h-4 w-4 text-[#6b7785]" />
        )}
      </div>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[#e6edf1] bg-white py-1 shadow-[0_10px_30px_rgba(30,60,80,0.14)]">
          {extra && (
            <button
              type="button"
              onMouseEnter={() => setCursor(0)}
              onClick={() => {
                extra.onPick();
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] font-medium text-[#2ea3dc]",
                cursor === 0 && "bg-[#f3f7f9]"
              )}
            >
              <LocateFixed className="h-4 w-4" />
              {extra.label}
            </button>
          )}
          {list.length === 0 && <div className="px-3 py-3 text-xs text-[#7b8794]">No places match “{query}”.</div>}
          {list.map((d, i) => (
            <button
              key={d.id}
              type="button"
              onMouseEnter={() => setCursor(i + offset)}
              onClick={() => pick(d)}
              className={cn("flex w-full flex-col px-3 py-2 text-left", cursor === i + offset && "bg-[#f3f7f9]")}
            >
              <span className="truncate text-[13px] text-[#2b3640]">{d.name}</span>
              {d.category && <span className="truncate text-[11px] text-[#8a96a3]">{d.category}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cn("relative h-5 w-9 rounded-full transition", on ? "bg-[#4cb963]" : "bg-[#d3dbe0]")}
    >
      <span
        className={cn(
          "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
          on ? "left-[18px]" : "left-0.5"
        )}
      />
    </button>
  );
}

/* ------------------------------------------------------------------------------------ */

export function NavigateView() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"2d" | "3d">("2d");

  const [from, setFrom] = useState<Destination | null>(null);
  const [to, setTo] = useState<Destination | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>("WALK");
  const [myPos, setMyPos] = useState<Vec2 | null>(null);
  const [locating, setLocating] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The 3D tab shows the drone survey whenever the mesh is deployed (it is too
  // large for the hosted build, so it may only exist locally). Until that is
  // known the tab waits, rather than showing the modelled campus meanwhile.
  const droneStatus = useDroneMeshStatus();
  const droneAvailable = droneStatus === "yes";
  const [studioViewer, setStudioViewer] = useState(false);
  // Fetch the 3D view's decoder and root tileset while the 2D map is up (or
  // alongside the 3D view on a ?view=3d link), so its first sharp tile is not
  // held back waiting for them.
  useEffect(() => {
    if (droneAvailable) void warmDroneCache();
  }, [droneAvailable]);
  // On the 3D tab, fetch the 3D view's code while the mesh check runs, not after it.
  useEffect(() => {
    if (viewMode !== "3d") return;
    preloadDroneView();
    if (droneStatus !== "no") preloadOpeningView();
  }, [viewMode, droneStatus]);
  // A ?view=3d link opens on the 3D tab straight away, so its code downloads
  // alongside the campus data rather than after the data has been processed.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") === "3d") setViewMode("3d");
  }, []);
  const [focus, setFocus] = useState<{ id: string; n: number } | null>(null);
  const [kindFilter, setKindFilter] = useState<PlaceKind | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [photoOk, setPhotoOk] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/published-graph", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        const g = payload?.graph;
        if (!g) setError("No campus has been published yet.");
        else setGraph(applyPilotStructure(g));
      })
      .catch(() => !cancelled && setError("Could not load the campus map."));
    return () => {
      cancelled = true;
    };
  }, []);

  const campus: Campus3D | null = useMemo(() => (graph ? buildCampus3D(graph) : null), [graph]);
  const campusName = String(graph?.campus?.name ?? "Campus");
  const destinations = useMemo<Destination[]>(
    () => (graph ? getValidNavigationDestinations(graph as any) : []),
    [graph]
  );

  // Every roofed block the drone survey found (tools/drone/build-ortho.py),
  // named from the 3D view's buildings where they overlap.
  const [footprints, setFootprints] = useState<Footprint[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/drone/footprints.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setFootprints(d?.footprints ?? []))
      .catch(() => live && setFootprints([]));
    return () => {
      live = false;
    };
  }, []);

  const features = useMemo<MapFeature[]>(
    () => (campus ? buildFeatures(campus, footprints) : []),
    [campus, footprints]
  );

  // The roads and walkways detected in the drone survey (tools/drone/build-paths.mjs).
  // Routes follow them; without the file, the published walkway graph is used.
  const [network, setNetwork] = useState<PathNetworkFile | null>(null);
  // The walkway-graph router, loaded only when it is needed (no paths.json, or a
  // route the network cannot make): its module brings the admin editor's campus
  // store, which on import fetches the admin draft and the published graph again
  // (2 x 66 KB, parsed on a phone's main thread).
  const [fallbackRouter, setFallbackRouter] = useState<{ shortestPath: typeof ShortestPath } | null>(null);
  const loadFallbackRouter = useCallback(() => {
    import("@/features/navigation/services/graph")
      .then((m) => setFallbackRouter({ shortestPath: m.shortestPath }))
      .catch(() => {});
  }, []);
  useEffect(() => {
    let live = true;
    fetch("/drone/paths.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live) return;
        if (d?.nodes) setNetwork(d);
        else loadFallbackRouter();
      })
      .catch(() => live && loadFallbackRouter());
    return () => {
      live = false;
    };
  }, [loadFallbackRouter]);
  const router = useMemo<PathRouter | null>(
    () =>
      network && features.length
        ? createPathRouter(
            network,
            features.map((f) => ({
              key: f.key,
              name: f.name,
              polygons: f.polygons,
              centre: f.centre,
              land: f.land,
              // Academic blocks and departments can be cut through; hostels and halls cannot.
              walkThrough: f.kind === "academic" || f.kind === "lab",
            }))
          )
        : null,
    [network, features]
  );

  // Link the places to the network once the 2D map is idle, so the first route
  // is instant. (Not under the 3D view: there the main thread is busy loading
  // tiles, and the first route links them instead.)
  useEffect(() => {
    if (!router || viewMode !== "2d") return;
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => router.prepare(), { timeout: 5000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = setTimeout(() => router.prepare(), 2000);
    return () => clearTimeout(t);
  }, [router, viewMode]);

  const segments = useMemo<RoadSegment[]>(() => {
    if (router) {
      return router.lines.flatMap((l) =>
        l.pts.slice(1).map((p, i) => ({ from: l.pts[i], to: p, kind: l.kind === "road" ? ("ROAD" as const) : ("WALK" as const), w: l.w }))
      );
    }
    if (!campus || !graph) return [];
    return (graph.edges ?? []).flatMap((e: any) => {
      const a = campus.nodeById.get(String(e.fromNodeId ?? e.from));
      const b = campus.nodeById.get(String(e.toNodeId ?? e.to));
      if (!a || !b) return [];
      return [{ from: a.position, to: b.position, kind: e.type === "ROAD" || e.pathType === "EV" ? "ROAD" : "WALK" }];
    });
  }, [campus, graph, router]);

  // Deep links: /navigate?to=<id|name>&from=<id|name>&view=3d
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || destinations.length === 0) return;
    deepLinked.current = true;
    const params = new URLSearchParams(window.location.search);
    const resolve = (p: string | null) =>
      p
        ? destinations.find((d) => d.id === p || d.nodeId === p || d.name.toLowerCase() === p.toLowerCase()) ?? null
        : null;
    const t = resolve(params.get("to"));
    const f = resolve(params.get("from"));
    if (t) setTo(t);
    if (f) setFrom(f);
    // (`view=3d` is applied on mount, above.)
    // `&viewer=studio`: the 3D studio's scene in this tab, as before the drone view, for comparison.
    if (params.get("viewer") === "studio") setStudioViewer(true);
  }, [destinations]);

  const { route, routePath, routeError } = useMemo(() => {
    const none = { route: null as RouteView | null, routePath: [] as Vec2[], routeError: null as string | null };
    if (!campus || !graph || !from || !to) return none;
    // Along the surveyed roads and walkways, door to door.
    if (router) {
      const end = (d: Destination): RouteEnd | null => {
        if (d.id === MY_LOCATION_ID && myPos) return { point: myPos, name: "your location" };
        const f = features.find((x) => x.key === d.id) ?? (d.buildingId ? features.find((x) => x.key === d.buildingId) : undefined);
        if (f) return { place: f.key };
        const n = campus.nodeById.get(String(d.nodeId ?? d.id));
        return n ? { point: n.position, name: d.name } : null;
      };
      const s = end(from);
      const e = end(to);
      if (s && e && "place" in s && "place" in e && s.place === e.place) {
        return { ...none, routeError: "Start and destination are the same place." };
      }
      const r = s && e ? router.route(s, e, travelMode) : null;
      if (r) {
        return {
          route: {
            distance: r.distance,
            durationSec: r.durationSec,
            instructions: r.steps.map((st) => ({ text: st.text, distance: st.distance, icon: st.icon })),
            // EV asked for, but no road on the way: it is a walk.
            isFallbackWalk: travelMode === "EV" && r.rideDistance === 0,
            surveyed: true,
          },
          routePath: r.path,
          routeError: null,
        };
      }
    }
    // No surveyed network (or it is still loading): the published walkway graph,
    // once its router has loaded.
    if (!fallbackRouter) return none;
    // A building is not a graph node: route to its entrance, or failing that
    // to the path node nearest its centre.
    const endpoint = (d: Destination) => {
      const id = d.nodeId || d.id;
      if (campus.nodeById.has(id)) return id;
      const b = campus.buildings.find((x) => x.id === (d.buildingId ?? id));
      if (!b) return id;
      if (campus.nodeById.has(`${b.id}-ent`)) return `${b.id}-ent`;
      let best: { id: string; d: number } | null = null;
      for (const n of campus.nodes) {
        const dist = Math.hypot(n.position.x - b.centre.x, n.position.z - b.centre.z);
        if (!best || dist < best.d) best = { id: n.id, d: dist };
      }
      return best?.id ?? id;
    };
    const s = endpoint(from);
    const e = endpoint(to);
    if (s === e) return { ...none, routeError: "Start and destination are the same place." };
    const r = fallbackRouter.shortestPath(s, e, { graphData: graph, travelMode });
    if (!r || !r.nodes?.length) {
      return { ...none, routeError: "These two places are not linked on the published walkway map yet." };
    }
    const path = r.nodes
      .map((n: any) => campus.nodeById.get(String(n.id))?.position)
      .filter((p): p is Vec2 => Boolean(p));
    return { route: r as RouteView, routePath: path, routeError: null };
  }, [campus, graph, from, to, travelMode, router, fallbackRouter, features, myPos]);
  // The surveyed network could not make this route (an end far off it): try the walkway graph.
  useEffect(() => {
    if (router && campus && graph && from && to && !route && !routeError && !fallbackRouter) loadFallbackRouter();
  }, [router, campus, graph, from, to, route, routeError, fallbackRouter, loadFallbackRouter]);

  useEffect(() => {
    setProgress(0);
    setPlaying(true);
  }, [route]);

  const onProgress = useCallback((t: number) => setProgress(Math.round(t * 50) / 50), []);

  const locateMe = useCallback(() => {
    if (!graph || !campus || !("geolocation" in navigator)) {
      setGpsError("Location isn't available in this browser.");
      return;
    }
    setLocating(true);
    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        let best: { id: string; d: number } | null = null;
        for (const n of graph.nodes ?? []) {
          if (typeof n.lat !== "number" || typeof n.lng !== "number" || !campus.nodeById.has(String(n.id))) continue;
          const d = haversine(latitude, longitude, n.lat, n.lng);
          if (!best || d < best.d) best = { id: String(n.id), d };
        }
        if (!best || best.d > 2000) {
          setGpsError("You seem to be off campus. Choose a start point instead.");
          return;
        }
        setMyPos(gpsToMetres(latitude, longitude));
        setFrom({ id: MY_LOCATION_ID, name: "Your location", category: "GPS location", nodeId: best.id, aliases: [] });
      },
      () => {
        setLocating(false);
        setGpsError("Location permission was denied.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [graph, campus]);

  const named = useMemo(
    () => features.filter((f) => f.name).sort((a, b) => a.name!.localeCompare(b.name!)),
    [features]
  );

  /** Where a route to this block should go: its published destination, or its nearest path node. */
  const destFor = useCallback(
    (f: MapFeature): Destination | null => {
      if (!campus) return null;
      if (f.building) {
        const id = f.building.id;
        return (
          destinations.find((d) => d.buildingId === id && d.category === "Building") ??
          destinations.find((d) => d.buildingId === id) ?? {
            id: `bld-dest-${id}`,
            name: f.building.name,
            category: "Building",
            nodeId: id,
            buildingId: id,
            aliases: [],
          }
        );
      }
      let best: { id: string; d: number } | null = null;
      for (const n of campus.nodes) {
        const d = Math.hypot(n.position.x - f.centre.x, n.position.z - f.centre.z);
        if (!best || d < best.d) best = { id: n.id, d };
      }
      if (!best) return null;
      return { id: f.key, name: "Unnamed building", category: "Building", nodeId: best.id, aliases: [] };
    },
    [campus, destinations]
  );

  const selected = useMemo(() => features.find((f) => f.key === selectedId) ?? null, [features, selectedId]);
  useEffect(() => setPhotoOk(true), [selectedId]);
  const tour = selected?.name ? findTourScene(selected.name) : null;

  const steps = useMemo(() => route?.instructions ?? [], [route]);
  const activeStep = useMemo(() => {
    if (!steps.length) return -1;
    const total = steps.reduce((n, s) => n + (s.distance || 0), 0) || 1;
    const d = progress * total;
    let acc = 0;
    for (let i = 0; i < steps.length; i++) {
      acc += steps[i].distance || 0;
      if (d < acc) return i;
    }
    return steps.length - 1;
  }, [steps, progress]);

  // Shows the place in whichever view is open: the 2D map pans to it, the 3D view flies there.
  const focusPlace = (id: string) => {
    setSelectedId(id);
    setFocus({ id, n: Date.now() });
  };

  const showCard = Boolean(selected);
  const mapPadding = useMemo(
    () =>
      isMobile
        ? { top: 72, right: 24, bottom: showCard ? 320 : sheetOpen ? Math.round(window.innerHeight * 0.55) : 96, left: 64 }
        : { top: 40, right: showCard ? 360 : 48, bottom: 48, left: 88 },
    [isMobile, showCard, sheetOpen]
  );

  if (error) return <Loading text={error} />;
  if (!campus) return <Loading text="Loading campus map…" />;

  const tabs = [
    { id: "2d", label: "2D map", icon: Eye },
    { id: "3d", label: "3D view", icon: Box },
  ] as const;

  /* ---------- sidebar ---------- */
  const sidebar = (
    <div className="space-y-5 px-5 pb-6 pt-5">
      <div>
        <FieldLabel>Location</FieldLabel>
        <SelectField label="Location" value="campus" onChange={() => {}}>
          <option value="campus">{campusName}</option>
        </SelectField>
      </div>

      <div>
        <FieldLabel>Building</FieldLabel>
        <SelectField label="Building" value={selectedId ?? ""} onChange={(v) => (v ? focusPlace(v) : setSelectedId(null))}>
          <option value="">All buildings</option>
          {named.map((f) => (
            <option key={f.key} value={f.key}>
              {f.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div>
        <FieldLabel>Start point</FieldLabel>
        <PlaceField
          label="Choose start point"
          value={from}
          options={destinations}
          onPick={setFrom}
          onClear={() => setFrom(null)}
          extra={{ label: locating ? "Finding you…" : "Use my location", onPick: locateMe }}
        />
      </div>

      <div>
        <FieldLabel
          right={
            <button
              type="button"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
              className="flex items-center gap-1 text-[12px] text-[#2ea3dc] hover:underline"
            >
              <ArrowUpDown className="h-3 w-3" /> Swap
            </button>
          }
        >
          Destination
        </FieldLabel>
        <PlaceField
          label="Choose destination"
          value={to}
          options={destinations}
          onPick={setTo}
          onClear={() => setTo(null)}
        />
      </div>

      <div>
        <FieldLabel>Travel mode</FieldLabel>
        <SelectField label="Travel mode" value={travelMode} onChange={(v) => setTravelMode(v as TravelMode)}>
          <option value="WALK">Walking</option>
          <option value="EV">EV shuttle</option>
        </SelectField>
      </div>

      <div>
        <FieldLabel>Category</FieldLabel>
        <SelectField
          label="Category"
          value={kindFilter ?? ""}
          onChange={(v) => setKindFilter((v || null) as PlaceKind | null)}
        >
          <option value="">All categories</option>
          {FILTER_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="flex items-center gap-3">
        <Toggle on={showLabels} onChange={setShowLabels} label="Show names" />
        <span className="text-[13px] text-[#2b3640]">Show names</span>
      </div>

      <div className="text-[13px] text-[#2b3640]">
        Places:{" "}
        <span className="font-semibold">
          {kindFilter ? named.filter((f) => f.kind === kindFilter).length : named.length}
        </span>
        {footprints && footprints.length > 0 && (
          <div className="mt-1 text-[12px] text-[#7b8794]">
            {footprints.length} blocks mapped from the drone survey
          </div>
        )}
      </div>

      {(gpsError || routeError) && (
        <p className="rounded-lg bg-[#fff6e5] px-3 py-2 text-[12px] leading-snug text-[#8a5a00]">{gpsError || routeError}</p>
      )}
      {to && !from && !routeError && <p className="text-[12px] text-[#7b8794]">Choose a start point to see the route.</p>}

      {route && (
        <div className="border-t border-[#eef2f5] pt-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[18px] font-semibold text-[#1f2a37]">{formatDuration(route.durationSec)}</div>
              <div className="text-[12px] text-[#7b8794]">
                {formatDistance(route.distance)} ·{" "}
                {route.isFallbackWalk || travelMode === "WALK" ? "walking" : "EV shuttle"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-[#d9e6ed] px-3 text-[13px] font-medium text-[#2ea3dc] hover:bg-[#f3f9fc]"
            >
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? "Pause" : "Preview"}
            </button>
          </div>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-[#eef2f5]">
            <div
              className="h-full rounded-full transition-[width] duration-150"
              style={{ width: `${progress * 100}%`, background: PLAN.route }}
            />
          </div>
          <ol className="mt-3 space-y-1">
            {steps.map((s, i) => {
              const Icon = stepIcon(s);
              const active = i === activeStep;
              return (
                <li key={i} className={cn("flex items-center gap-3 rounded-lg px-2 py-2", active && "bg-[#eef9f2]")}>
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                      active ? "text-white" : "bg-[#f3f6f8] text-[#4a5968]"
                    )}
                    style={active ? { background: PLAN.route } : undefined}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn("block text-[13px] leading-snug", i < activeStep ? "text-[#98a4ae]" : "text-[#2b3640]")}
                    >
                      {s.text}
                    </span>
                    {s.distance > 0 && <span className="text-[11px] text-[#98a4ae]">{formatDistance(s.distance)}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
          {route.surveyed && (
            <p className="mt-3 text-[11px] leading-snug text-[#98a4ae]">
              Follows the roads and walkways mapped from the drone survey.
            </p>
          )}
        </div>
      )}
    </div>
  );

  const card = selected && (
    <div className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold leading-tight text-[#1f2a37]">
            {selected.name ?? "Unnamed building"}
          </div>
          <div className="mt-1.5 text-[14px] leading-snug text-[#3c4752]">
            {selected.kind ? KIND_LABEL[selected.kind] : "Not yet named in the campus map"}
            {selected.building?.shortCode ? ` · ${selected.building.shortCode}` : ""}
          </div>
          <div className="text-[14px] leading-snug text-[#3c4752]">
            {(() => {
              // Height and floors measured from the drone survey where a roof was found.
              const fp = selected.footprints.reduce<Footprint | null>(
                (a, f) => (!a || f.areaM2 > a.areaM2 ? f : a),
                null
              );
              if (fp) return `About ${fp.storeys} ${fp.storeys === 1 ? "floor" : "floors"} · ${Math.round(fp.heightM)} m tall`;
              if (selected.building && !selected.building.isSiteFeature)
                return `${selected.building.floors.length || selected.building.storeys} floors`;
              return campusName;
            })()}
          </div>
          {selected.footprints.length > 0 && (
            <div className="mt-1 text-[12px] text-[#8a96a3]">
              Roof {Math.round(selected.areaM2).toLocaleString()} m² · measured by drone survey
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSelectedId(null)}
          aria-label="Close"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f0f3f5] text-[#4a5968] hover:bg-[#e4e9ed]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {tour && photoOk && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/tour/${tour.index}/f.jpg`}
          alt={selected.name ?? "Building"}
          onError={() => setPhotoOk(false)}
          className="mt-4 h-40 w-full rounded-md object-cover"
        />
      )}
      {(() => {
        const d = destFor(selected);
        if (!d) return <p className="mt-4 text-[12px] text-[#7b8794]">No entrance is mapped for this place yet.</p>;
        return (
          <>
            <button
              type="button"
              onClick={() => {
                setTo(d);
                setSelectedId(null);
                setSheetOpen(true);
              }}
              className="mt-4 h-11 w-full rounded-md text-[15px] font-medium text-white transition hover:brightness-95"
              style={{ background: ACCENT }}
            >
              Route
            </button>
            <button
              type="button"
              onClick={() => {
                setFrom(d);
                setSelectedId(null);
                setSheetOpen(true);
              }}
              className="mt-2 w-full text-center text-[13px] text-[#2ea3dc] hover:underline"
            >
              Set as start point
            </button>
          </>
        );
      })()}
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white text-[#1f2a37]">
      {/* Header */}
      <header className="flex h-16 shrink-0 items-center border-b border-[#eef2f5] bg-white pr-4 md:pr-6">
        {/* The header's links don't prefetch: on a phone that competed with the map's own first downloads. */}
        <Link href="/" prefetch={false} className="flex h-full shrink-0 items-center gap-2.5 px-4 md:w-64 md:px-5">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-full text-white"
            style={{ background: "radial-gradient(circle at 30% 30%, #6cc6ee, #1f8fc8)" }}
          >
            <Navigation className="h-4 w-4" />
          </span>
          <span className="hidden leading-tight min-[400px]:block">
            <span className="block text-[20px] font-medium tracking-tight text-[#1f2a37]">CampusNav</span>
            <span className="hidden text-[11px] text-[#6b7785] sm:block">Campus Navigation</span>
          </span>
        </Link>

        <nav className="ml-2 flex items-center gap-1 md:ml-6 md:gap-2">
          {tabs.map((t) => {
            const on = viewMode === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setViewMode(t.id)}
                // Start fetching the 3D code as the finger or pointer lands, before the click.
                onPointerEnter={t.id === "3d" ? preloadDroneView : undefined}
                onPointerDown={t.id === "3d" ? preloadDroneView : undefined}
                className={cn(
                  "flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-3 text-[14px] transition md:px-4",
                  on ? "bg-[#e3f4fb] font-medium text-[#1e9bd7]" : "text-[#3c4752] hover:bg-[#f5f8fa]"
                )}
              >
                <t.icon className="h-[18px] w-[18px]" />
                <span className={cn(!on && "hidden sm:inline")}>{t.label}</span>
              </button>
            );
          })}
          <Link
            prefetch={false}
            href="/search"
            className="hidden h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] text-[#3c4752] hover:bg-[#f5f8fa] xl:flex"
          >
            <Search className="h-[18px] w-[18px]" /> Explore
          </Link>
          <Link
            prefetch={false}
            href="/"
            className="hidden h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[14px] text-[#3c4752] hover:bg-[#f5f8fa] xl:flex"
          >
            <Home className="h-[18px] w-[18px]" /> Home
          </Link>
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <div className="hidden h-11 w-[250px] items-center gap-3 rounded-lg bg-[#f5f7f9] px-4 lg:flex">
            <MapPin className="h-[18px] w-[18px] text-[#3c4752]" />
            <span className="flex-1 truncate text-[14px] text-[#2b3640]">{campusName}</span>
            <ChevronDown className="h-3.5 w-3.5 text-[#6b7785]" />
          </div>
          <Link
            prefetch={false}
            href="/admin/login"
            title="Admin sign in"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[#e3f4fb] text-[#2ea3dc]"
          >
            <UserRound className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {/* Sidebar: desktop */}
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-[#eef2f5] bg-white md:block">{sidebar}</aside>

        {/* Map area */}
        <main className="relative min-w-0 flex-1 bg-[#f4f8fa]">
          {viewMode === "2d" ? (
            <Campus2DMap
              campus={campus}
              segments={segments}
              routePath={routePath}
              playing={playing}
              onProgress={onProgress}
              selectedId={selectedId}
              onSelect={setSelectedId}
              highlightKind={kindFilter}
              focusId={focus}
              myPosition={myPos}
              onLocate={locateMe}
              locating={locating}
              features={features}
              destinationKey={to ? to.buildingId ?? to.id : null}
              showLabels={showLabels}
              padding={mapPadding}
            />
          ) : (
            <div className="absolute inset-0 bg-[#0b1120]">
              {/* The drone view: navigable anywhere, click or pick a place to see
                  it. No building opens into its structural / exploded frame. */}
              {droneStatus === "checking" && !studioViewer ? (
                <Loading text="Opening the drone view…" />
              ) : droneAvailable && !studioViewer ? (
                <DroneView3D
                  campus={campus}
                  features={features}
                  routePath={routePath}
                  playing={playing}
                  onRouteProgress={onProgress}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  focus={focus}
                  showLabels={showLabels}
                />
              ) : (
                // No mesh on this server (the modelled campus), or ?viewer=studio.
                // Nothing is selected, so no building opens into its exploded frame.
                <CampusScene
                  campus={campus}
                  routePath={routePath}
                  playing={playing}
                  selectedId={null}
                  onSelect={() => {}}
                  onRouteProgress={onProgress}
                  mode="REALISTIC"
                  droneMesh={droneAvailable}
                />
              )}
              {droneStatus === "no" && (
                <div className="pointer-events-none absolute inset-x-0 top-5 flex justify-center">
                  <div className="rounded-full bg-white/95 px-4 py-2 text-[13px] text-[#8a5a00] shadow">
                    Drone survey mesh isn&apos;t available on this server — showing the modelled campus.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Place card: floating on desktop */}
          {showCard && !isMobile && (
            <div className="absolute right-5 top-5 z-20 w-[300px] overflow-hidden rounded-xl bg-white shadow-[0_8px_30px_rgba(30,60,80,0.14)]">
              {card}
            </div>
          )}

          {/* Phone: search over the map, and a bottom sheet for directions or the place card. */}
          {isMobile && (
            <>
              {viewMode === "2d" && (
                <div className="absolute left-16 right-3 top-5 z-20 rounded-lg bg-white shadow-[0_2px_10px_rgba(30,60,80,0.1)]">
                  <PlaceField
                    label="Search"
                    icon={<Search className="h-4 w-4 text-[#98a4ae]" />}
                    value={to}
                    options={destinations}
                    onPick={(d) => {
                      setTo(d);
                      setSheetOpen(true);
                    }}
                    onClear={() => setTo(null)}
                  />
                </div>
              )}
              {showCard ? (
                <div className="absolute inset-x-0 bottom-0 z-30 rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(30,60,80,0.16)]">
                  <div className="flex justify-center pt-2">
                    <span className="h-1 w-10 rounded-full bg-[#dfe6ea]" />
                  </div>
                  {card}
                </div>
              ) : (
                <div
                  className={cn(
                    "absolute inset-x-0 bottom-0 z-30 flex flex-col rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(30,60,80,0.16)]",
                    sheetOpen ? "max-h-[55vh]" : "max-h-[76px]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setSheetOpen((o) => !o)}
                    className="flex shrink-0 flex-col items-center gap-2 px-5 pb-3 pt-2"
                  >
                    <span className="h-1 w-10 rounded-full bg-[#dfe6ea]" />
                    <span className="flex w-full items-center justify-between text-[15px] font-medium text-[#1f2a37]">
                      {route ? `${formatDuration(route.durationSec)} · ${formatDistance(route.distance)}` : "Directions"}
                      <ChevronDown className={cn("h-4 w-4 text-[#6b7785] transition", !sheetOpen && "rotate-180")} />
                    </span>
                  </button>
                  <div className="min-h-0 flex-1 overflow-y-auto border-t border-[#eef2f5]">{sidebar}</div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
