"use client";

/**
 * The 2D campus map on /navigate: the 3D view seen from above.
 *
 * Geometry is not re-derived here. The page runs the *same* pipeline the 3D
 * view runs — `applyPilotStructure` -> `buildCampus3D` -> `frameFor` — so every
 * block, storey height and room is the one /navigate-3d draws, only flattened.
 * Working in scene metres (X east, Z south) rather than lat/lng keeps it that
 * way: there is no second projection to drift out of step.
 *
 * Rendering is a plain SVG in world metres inside one CSS-transformed layer,
 * which is what makes it feel like a map: pan, wheel and pinch only change that
 * transform, so gestures never re-render React and stay smooth on a phone.
 * Stroke widths and label sizes divide by the live scale (`--s`), so lines stay
 * crisp hairlines and text keeps its size at every zoom.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Crosshair, LocateFixed, Maximize2, Minus, Navigation, Plus, X } from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import type { Destination, Node } from "@/shared/data/campus";
import type { Route } from "@/features/navigation/services/graph";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { applyPilotStructure } from "@/shared/data/pilot-structure";
import { buildCampus3D, gpsToMetres, type Building3D, type Campus3D, type Vec2 } from "@/features/navigation-3d/lib/campus-3d";
import { frameFor, type Room } from "@/features/navigation-3d/lib/building-structure";
import { buildingPhoto } from "../lib/building-photos";

type Props = {
  route: Route | null;
  alternativeRoute?: Route | null;
  onSelectAlternativeRoute?: () => void;
  livePosition?: Node | null;
  progress?: number;
  gps?: ReturnType<typeof useVisitorGps>;
  onNavigateToDest?: (dest: Destination) => void;
  fromSelected?: Destination | null;
  toSelected?: Destination | null;
};

const CAMPUS_NAME = "Bannari Amman Institute of Technology";

/** Metres of padding around the campus when the whole plan is framed. */
const FIT_PADDING_M = 12;
/** Pixels per metre. 0.25 shows the whole campus; 6 is a single room. */
const MIN_SCALE = 0.12;
const MAX_SCALE = 9;
/** Rooms and their codes appear only when a room is big enough to read. */
const ROOM_SCALE = 1.1;
const ROOM_CODE_SCALE = 2.2;

/* ------------------------------------------------------------- geometry */

function ring(points: Vec2[]) {
  return points.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`).join(" ");
}

function metresBetween(a: Vec2, b: Vec2) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** Point `t` metres along a polyline, for the walking marker. */
function pointAlong(line: Vec2[], cum: number[], t: number): Vec2 {
  const d = Math.max(0, Math.min(cum[cum.length - 1], t));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  return { x: line[i - 1].x + (line[i].x - line[i - 1].x) * k, z: line[i - 1].z + (line[i].z - line[i - 1].z) * k };
}

function boundsOf(points: Vec2[]) {
  const xs = points.map((p) => p.x);
  const zs = points.map((p) => p.z);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/** Longest-edge direction, so a label sits along the block rather than across it. */
function outlineAngleDeg(outline: Vec2[]) {
  let best = 0;
  let bestLen = 0;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const len = metresBetween(a, b);
    if (len > bestLen) {
      bestLen = len;
      best = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
    }
  }
  // Keep text upright: never more than a quarter turn from horizontal.
  if (best > 90) best -= 180;
  if (best < -90) best += 180;
  return best;
}

type View = { s: number; tx: number; ty: number };

/* --------------------------------------------------------------- styles */

/** Grounds, courts and water read as landscape; everything else is a block. */
function buildingKind(b: Building3D): "water" | "green" | "block" {
  if (/pond/i.test(b.id)) return "water";
  if (b.isSiteFeature) return "green";
  return "block";
}

const ROOM_FILL: Record<string, string> = {
  CLASSROOM: "#e4edfb",
  LABORATORY: "#e2f0e7",
  OFFICE: "#fdeeda",
  STAFF_ROOM: "#fdeeda",
  SEMINAR_HALL: "#ece5fa",
  LIBRARY: "#ece5fa",
  WASHROOM: "#e9edf2",
  CIRCULATION: "#f4f6f9",
  SERVICE: "#eef0f3",
};

/* ------------------------------------------------------------ component */

export function CampusPlanMap({ route, alternativeRoute, onSelectAlternativeRoute, livePosition, gps, onNavigateToDest, fromSelected, toSelected }: Props) {
  const [graph, setGraph] = useState<Record<string, unknown> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>({ s: 1, tx: 0, ty: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const hostRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  /** The live transform. Gestures write here every frame; React only follows. */
  const viewRef = useRef<View>({ s: 1, tx: 0, ty: 0 });
  const userMovedRef = useRef(false);

  /* ---- campus data: the 3D view's own pipeline ---- */

  useEffect(() => {
    let live = true;
    const take = (g: Record<string, unknown> | null) => live && g && setGraph(applyPilotStructure(g));
    take(campusStore.getPublishedData() as Record<string, unknown>);
    campusStore.fetchPublishedData().then((g) => take(g as Record<string, unknown>));
    const unsub = campusStore.subscribe(() => take(campusStore.getPublishedData() as Record<string, unknown>));
    return () => {
      live = false;
      unsub();
    };
  }, []);

  const campus: Campus3D | null = useMemo(() => (graph ? buildCampus3D(graph) : null), [graph]);

  /** Paths carry their type in the raw graph, which `Campus3D` drops. */
  const paths = useMemo(() => {
    if (!campus || !graph) return [];
    const raw = (graph.edges as { id: string; from: string; to: string; fromNodeId?: string; toNodeId?: string; type?: string }[]) ?? [];
    return raw
      .map((e) => {
        const a = campus.nodeById.get(String(e.fromNodeId ?? e.from));
        const b = campus.nodeById.get(String(e.toNodeId ?? e.to));
        return a && b ? { id: e.id, road: e.type === "ROAD", a: a.position, b: b.position } : null;
      })
      .filter(Boolean) as { id: string; road: boolean; a: Vec2; b: Vec2 }[];
  }, [campus, graph]);

  /** World extent of everything drawn, and the SVG's own coordinate window. */
  const world = useMemo(() => {
    if (!campus) return null;
    const pts = [...campus.buildings.flatMap((b) => b.outline), ...campus.boundary, ...campus.nodes.map((n) => n.position)];
    if (!pts.length) return null;
    const b = boundsOf(pts);
    return { minX: b.minX - FIT_PADDING_M, minZ: b.minZ - FIT_PADDING_M, w: b.maxX - b.minX + FIT_PADDING_M * 2, h: b.maxZ - b.minZ + FIT_PADDING_M * 2 };
  }, [campus]);

  /* ---- route, markers ---- */

  const routeLine = useMemo(() => {
    if (!campus || !route) return [];
    return route.nodes.map((n) => campus.nodeById.get(n.id)?.position).filter(Boolean) as Vec2[];
  }, [campus, route]);

  const altLine = useMemo(() => {
    if (!campus || !alternativeRoute) return [];
    return alternativeRoute.nodes.map((n) => campus.nodeById.get(n.id)?.position).filter(Boolean) as Vec2[];
  }, [campus, alternativeRoute]);

  const startPos = useMemo(() => {
    const id = fromSelected?.nodeId ?? fromSelected?.id;
    return (id && campus?.nodeById.get(id)?.position) || routeLine[0] || null;
  }, [fromSelected, campus, routeLine]);

  const destId = toSelected?.nodeId ?? toSelected?.id ?? route?.nodes[route.nodes.length - 1]?.id;
  const destPos = useMemo(() => (destId && campus?.nodeById.get(destId)?.position) || null, [destId, campus]);
  const livePos = useMemo(() => (livePosition && campus?.nodeById.get(livePosition.id)?.position) || null, [livePosition, campus]);
  const gpsPos: Vec2 | null = useMemo(() => {
    if (!campus || !gps?.isGpsActive || typeof gps.lat !== "number" || typeof gps.lng !== "number") return null;
    return gpsToMetres(gps.lat, gps.lng);
  }, [campus, gps?.isGpsActive, gps?.lat, gps?.lng]);

  /* ---- view transform ---- */

  const applyView = useCallback((v: View) => {
    viewRef.current = v;
    const el = layerRef.current;
    if (!el) return;
    el.style.transform = `translate3d(${v.tx}px, ${v.ty}px, 0) scale(${v.s})`;
    el.style.setProperty("--s", String(v.s));
  }, []);

  /** Commit the live transform to React, so labels and room detail catch up. */
  const commitView = useCallback(() => setView({ ...viewRef.current }), []);

  const fitTo = useCallback(
    (target: { minX: number; minZ: number; w: number; h: number }, pad = { top: 16, right: 60, bottom: 16, left: 16 }) => {
      const host = hostRef.current;
      if (!host || !world) return;
      const cw = host.clientWidth;
      const ch = host.clientHeight;
      if (cw < 50 || ch < 50) return;
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min((cw - pad.left - pad.right) / target.w, (ch - pad.top - pad.bottom) / target.h)));
      const cxWorld = target.minX + target.w / 2 - world.minX;
      const czWorld = target.minZ + target.h / 2 - world.minZ;
      applyView({
        s,
        tx: (cw + pad.left - pad.right) / 2 - cxWorld * s,
        ty: (ch + pad.top - pad.bottom) / 2 - czWorld * s,
      });
      commitView();
    },
    [applyView, commitView, world]
  );

  const fitCampus = useCallback(() => {
    if (!world) return;
    userMovedRef.current = false;
    fitTo({ minX: world.minX, minZ: world.minZ, w: world.w, h: world.h });
  }, [fitTo, world]);

  const fitRoute = useCallback(() => {
    if (!routeLine.length) return fitCampus();
    const b = boundsOf(routeLine);
    const host = hostRef.current;
    const mobile = (host?.clientWidth ?? 0) < 768;
    fitTo(
      { minX: b.minX - 25, minZ: b.minZ - 25, w: b.maxX - b.minX + 50, h: b.maxZ - b.minZ + 50 },
      { top: 16, right: 60, bottom: mobile ? 200 : 16, left: 16 }
    );
  }, [routeLine, fitTo, fitCampus]);

  // First paint, and whenever the map becomes visible again (the phone layout
  // hides it behind the planner sheet, where it has no size to fit into).
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let hidden = host.clientWidth < 50;
    const ro = new ResizeObserver(() => {
      const nowHidden = host.clientWidth < 50;
      setSize({ w: host.clientWidth, h: host.clientHeight });
      if (hidden && !nowHidden && !userMovedRef.current) (routeLine.length ? fitRoute : fitCampus)();
      hidden = nowHidden;
    });
    ro.observe(host);
    setSize({ w: host.clientWidth, h: host.clientHeight });
    return () => ro.disconnect();
  }, [fitCampus, fitRoute, routeLine.length]);

  useEffect(() => {
    if (!world) return;
    if (routeLine.length >= 2) fitRoute();
    else if (!userMovedRef.current) fitCampus();
    // A new route reframes even if the user had panned: they asked for it.
  }, [world, route?.id, routeLine.length, fitRoute, fitCampus]);

  /* ---- gestures: pan, wheel zoom, pinch ---- */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch: { dist: number; mid: { x: number; y: number } } | null = null;
    let raf = 0;
    const commitSoon = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(commitView);
    };

    const zoomAbout = (factor: number, px: number, py: number) => {
      const v = viewRef.current;
      const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.s * factor));
      const k = s / v.s;
      applyView({ s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k });
      userMovedRef.current = true;
    };

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-no-pan]")) return;
      host.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
      }
      host.style.cursor = "grabbing";
    };

    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const rect = host.getBoundingClientRect();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const v = viewRef.current;
        // Pan by the midpoint's movement, zoom by the fingers' spread.
        applyView({ s: v.s, tx: v.tx + (mid.x - pinch.mid.x), ty: v.ty + (mid.y - pinch.mid.y) });
        zoomAbout(dist / (pinch.dist || dist), mid.x - rect.left, mid.y - rect.top);
        pinch = { dist, mid };
        userMovedRef.current = true;
        commitSoon();
        return;
      }

      const v = viewRef.current;
      applyView({ s: v.s, tx: v.tx + (e.clientX - prev.x), ty: v.ty + (e.clientY - prev.y) });
      userMovedRef.current = true;
      commitSoon();
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      host.style.cursor = "grab";
      commitView();
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      zoomAbout(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
      commitSoon();
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    host.addEventListener("wheel", onWheel, { passive: false });
    host.style.cursor = "grab";
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(raf);
    };
  }, [applyView, commitView]);

  const zoomBy = (factor: number) => {
    const host = hostRef.current;
    if (!host) return;
    const v = viewRef.current;
    const px = host.clientWidth / 2;
    const py = host.clientHeight / 2;
    const s = Math.max(MIN_SCALE, Math.min(MAX_SCALE, v.s * factor));
    const k = s / v.s;
    applyView({ s, tx: px - (px - v.tx) * k, ty: py - (py - v.ty) * k });
    userMovedRef.current = true;
    commitView();
  };

  /* ---- what is on screen, for labels and room detail ---- */

  const screenOf = useCallback(
    (p: Vec2) => (world ? { x: (p.x - world.minX) * view.s + view.tx, y: (p.z - world.minZ) * view.s + view.ty } : { x: 0, y: 0 }),
    [world, view]
  );

  // Footprint overlap, not just the centre: zoomed into a long block its centre
  // is often off screen while the part under the camera still needs its rooms.
  const visibleBuildings = useMemo(() => {
    if (!campus || !world || !size.w) return [];
    const m = 140;
    return campus.buildings.filter((b) => {
      const pts = b.outline.map(screenOf);
      const x0 = Math.min(...pts.map((p) => p.x));
      const x1 = Math.max(...pts.map((p) => p.x));
      const y0 = Math.min(...pts.map((p) => p.y));
      const y1 = Math.max(...pts.map((p) => p.y));
      return x1 > -m && y1 > -m && x0 < size.w + m && y0 < size.h + m;
    });
  }, [campus, world, size, screenOf]);

  /** Buildings the 3D view can model, drawn as real plans once close enough. */
  const roomPlans = useMemo(() => {
    if (view.s < ROOM_SCALE) return [];
    return visibleBuildings
      .filter((b) => b.floors.some((f) => f.rooms?.length))
      .slice(0, 6)
      .map((b) => {
        const frame = frameFor(b);
        if (!frame) return null;
        // One storey at a time: the lowest that carries rooms, as a plan sheet does.
        const ordinal = Math.min(...frame.rooms.map((r) => b.floors.find((f) => f.id === r.floorId)?.ordinal ?? 0));
        const rooms = frame.rooms.filter((r) => (b.floors.find((f) => f.id === r.floorId)?.ordinal ?? 0) === ordinal);
        return { id: b.id, rooms, cores: frame.cores, floorName: b.floors.find((f) => f.ordinal === ordinal)?.name ?? "" };
      })
      .filter((p): p is NonNullable<typeof p> => Boolean(p && p.rooms.length > 0));
  }, [visibleBuildings, view.s]);

  /** Blue pin + name per building, largest first, skipping collisions. */
  const labels = useMemo(() => {
    if (!size.w) return [];
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: { id: string; text: string; at: Vec2; angle: number; big: boolean }[] = [];
    const ordered = [...visibleBuildings].sort((a, b) => footprintArea(b.outline) - footprintArea(a.outline));
    for (const b of ordered) {
      if (b.id === selectedId) continue;
      const p = screenOf(b.centre);
      const kind = buildingKind(b);
      const area = footprintArea(b.outline);
      const big = area > 2500 || view.s > 1.2;
      for (const text of [b.name, b.shortCode].filter(Boolean) as string[]) {
        const w = 20 + text.length * (big ? 7.2 : 6.2);
        const box = { x0: p.x - 10, y0: p.y - 11, x1: p.x - 10 + w, y1: p.y + 11 };
        if (box.x1 < 0 || box.y1 < 0 || box.x0 > size.w || box.y0 > size.h) break;
        if (taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0)) continue;
        taken.push(box);
        out.push({ id: b.id, text, at: b.centre, angle: kind === "green" ? outlineAngleDeg(b.outline) : 0, big });
        break;
      }
    }
    return out;
  }, [visibleBuildings, screenOf, size, selectedId, view.s]);

  /* ---- selection ---- */

  const selected = campus?.buildings.find((b) => b.id === selectedId) ?? null;
  const selectedPhoto = selected ? buildingPhoto(selected.id) : null;
  const entranceId = selected ? `${selected.id}-ent` : null;
  const hasEntrance = Boolean(entranceId && campus?.nodeById.has(entranceId));

  useEffect(() => {
    if (route) setSelectedId(null);
  }, [route]);

  function routeToSelected() {
    if (!selected || !entranceId || !campus || !onNavigateToDest) return;
    const entrance = campus.nodeById.get(entranceId);
    if (!entrance) return;
    onNavigateToDest({
      id: entrance.id,
      nodeId: entrance.id,
      name: entrance.name || selected.name,
      category: "Academic",
      aliases: [selected.name, selected.shortCode ?? ""].filter(Boolean),
      floorId: "f-out",
      buildingId: selected.id,
    });
    setSelectedId(null);
  }

  /* ---- walking marker ---- */

  const walker = useWalker(routeLine);

  const scaleBar = niceScaleBar(view.s);

  return (
    <div ref={hostRef} className="plan-root relative h-full w-full touch-none select-none overflow-hidden">
      {(!campus || !world) && <div className="absolute inset-0 animate-pulse bg-[#e4e9e2]" />}
      {campus && world && (
      <div ref={layerRef} className="absolute left-0 top-0 origin-top-left will-change-transform" style={{ width: world.w, height: world.h }}>
        <svg
          width={world.w}
          height={world.h}
          viewBox={`${world.minX} ${world.minZ} ${world.w} ${world.h}`}
          className="absolute left-0 top-0 block overflow-visible"
          shapeRendering="geometricPrecision"
        >
          {/* Campus ground */}
          {campus.boundary.length >= 3 && <polygon className="pl-ground" points={ring(campus.boundary)} />}

          {/* Path network, at its real width in metres. */}
          <g className="pl-paths">
            {paths.map((p) => (
              <line key={`${p.id}-c`} className={p.road ? "pl-road-casing" : "pl-walk-casing"} x1={p.a.x} y1={p.a.z} x2={p.b.x} y2={p.b.z} />
            ))}
            {paths.map((p) => (
              <line key={p.id} className={p.road ? "pl-road" : "pl-walk"} x1={p.a.x} y1={p.a.z} x2={p.b.x} y2={p.b.z} />
            ))}
          </g>

          {/* Massing shadow: offset by height, so the plan keeps the 3D view's
              sense of which blocks are tall. */}
          <g className="pl-shadows">
            {campus.buildings
              .filter((b) => buildingKind(b) === "block")
              .map((b) => (
                <polygon key={b.id} className="pl-shadow" points={ring(b.outline)} transform={`translate(${b.heightMetres * 0.16} ${b.heightMetres * 0.22})`} />
              ))}
          </g>

          {/* Buildings */}
          <g>
            {campus.buildings.map((b) => {
              const kind = buildingKind(b);
              const isSel = b.id === selectedId;
              const isDest = destId === `${b.id}-ent`;
              return (
                <polygon
                  key={b.id}
                  points={ring(b.outline)}
                  className={`pl-bld pl-bld--${kind}${isSel ? " is-selected" : ""}${isDest ? " is-dest" : ""}`}
                  onClick={() => setSelectedId(b.id)}
                />
              );
            })}
          </g>

          {/* Room plans: the same rooms the 3D view builds, seen from above. */}
          <g className="pl-rooms">
            {roomPlans.map((plan) => (
              <g key={plan.id}>
                {plan.rooms.map((r) => (
                  <polygon key={r.id} points={ring(r.outline)} className="pl-room" style={{ fill: ROOM_FILL[r.category] ?? "#f4f6f8" }} />
                ))}
                {plan.cores.map((c) => (
                  <rect
                    key={c.id}
                    className="pl-core"
                    x={c.centre.x - c.width / 2}
                    y={c.centre.z - c.depth / 2}
                    width={c.width}
                    height={c.depth}
                    transform={`rotate(${(c.angleRad * 180) / Math.PI} ${c.centre.x} ${c.centre.z})`}
                  />
                ))}
              </g>
            ))}
          </g>

          {/* Alternative route, tappable to switch. */}
          {altLine.length >= 2 && (
            <polyline className="pl-alt" points={ring(altLine)} onClick={() => onSelectAlternativeRoute?.()} data-no-pan />
          )}

          {/* Active route */}
          {routeLine.length >= 2 && (
            <>
              <polyline className="pl-route-halo" points={ring(routeLine)} />
              <polyline className="pl-route" points={ring(routeLine)} />
            </>
          )}
        </svg>

        {/* Labels and markers ride the same transform but keep their pixel size. */}
        <div className="pointer-events-none absolute left-0 top-0" style={{ width: world.w, height: world.h }}>
          {labels.map((l) => (
            <button
              key={`${l.id}-${l.text}`}
              type="button"
              data-no-pan
              onClick={() => setSelectedId(l.id)}
              className={`pl-label pointer-events-auto${l.big ? " pl-label--big" : ""}`}
              style={{ left: l.at.x - world.minX, top: l.at.z - world.minZ }}
            >
              <span className="pl-dot" />
              <span className="pl-label-text">{l.text}</span>
            </button>
          ))}

          {view.s >= ROOM_CODE_SCALE &&
            roomPlans.flatMap((plan) =>
              plan.rooms
                .filter((r) => r.code)
                .map((r) => (
                  <span key={`${plan.id}-${r.id}`} className="pl-room-code" style={{ left: r.centre.x - world.minX, top: r.centre.z - world.minZ }}>
                    {r.code}
                  </span>
                ))
            )}

          {selected && (
            <div className="pl-bubble" style={{ left: selected.centre.x - world.minX, top: selected.centre.z - world.minZ }}>
              {selectedPhoto ? <span className="pl-bubble-img" style={{ backgroundImage: `url('${selectedPhoto.thumb}')` }} /> : null}
              <span className="pl-bubble-pin" />
            </div>
          )}

          {startPos && (
            <span className="pl-walker" style={{ left: startPos.x - world.minX, top: startPos.z - world.minZ }}>
              <WalkIcon />
            </span>
          )}
          {walker && routeLine.length >= 2 && (
            <span className="pl-walker pl-walker--moving" style={{ left: walker.x - world.minX, top: walker.z - world.minZ }}>
              <WalkIcon />
            </span>
          )}
          {livePos && (
            <span className="pl-walker pl-walker--moving" style={{ left: livePos.x - world.minX, top: livePos.z - world.minZ }}>
              <WalkIcon />
            </span>
          )}
          {destPos && (
            <span className="pl-pin" style={{ left: destPos.x - world.minX, top: destPos.z - world.minZ }}>
              <svg viewBox="0 0 32 44" width="30" height="42" aria-hidden="true">
                <path d="M16 1.5C8 1.5 1.5 7.8 1.5 15.7c0 10.4 14.5 26.8 14.5 26.8s14.5-16.4 14.5-26.8C30.5 7.8 24 1.5 16 1.5z" fill="#ea4335" stroke="#b31412" strokeWidth="1.5" />
                <circle cx="16" cy="15.5" r="5.2" fill="#7a0c0c" />
              </svg>
            </span>
          )}
          {gpsPos && (
            <span className="pl-gps" style={{ left: gpsPos.x - world.minX, top: gpsPos.z - world.minZ }}>
              <span className="pl-gps-dot" />
            </span>
          )}
        </div>
      </div>
      )}

      {/* Controls */}
      <div className="absolute right-3 top-3 z-20 flex flex-col gap-2" data-no-pan>
        <button type="button" className="pl-btn" title="Zoom in" onClick={() => zoomBy(1.6)}>
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" className="pl-btn" title="Zoom out" onClick={() => zoomBy(1 / 1.6)}>
          <Minus className="h-5 w-5" />
        </button>
        <button
          type="button"
          className="pl-btn"
          title="Show my location"
          onClick={() => {
            if (!gpsPos || !world || !hostRef.current) return;
            const host = hostRef.current;
            const s = Math.max(viewRef.current.s, 2.5);
            applyView({ s, tx: host.clientWidth / 2 - (gpsPos.x - world.minX) * s, ty: host.clientHeight / 2 - (gpsPos.z - world.minZ) * s });
            userMovedRef.current = true;
            commitView();
          }}
        >
          <LocateFixed className={`h-5 w-5 ${gpsPos ? "text-[#1a73e8]" : "opacity-45"}`} />
        </button>
        <button type="button" className="pl-btn" title={routeLine.length ? "Show whole route" : "Show whole campus"} onClick={() => (routeLine.length ? fitRoute() : fitCampus())}>
          {routeLine.length ? <Crosshair className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}
        </button>
      </div>

      {/* Scale bar, as a plan drawing carries. */}
      <div className="pointer-events-none absolute bottom-[86px] left-3 z-20 flex items-end gap-2 md:bottom-3">
        <div className="pl-scale" style={{ width: scaleBar.px }}>
          <span>{scaleBar.label}</span>
        </div>
      </div>

      {/* Building card */}
      {selected && (
        <div className="absolute inset-x-3 bottom-[92px] z-30 mx-auto max-w-md md:bottom-4 md:left-4 md:right-auto md:mx-0 md:w-[360px]" data-no-pan>
          <div className="pl-card">
            <button type="button" className="pl-card-close" title="Close" onClick={() => setSelectedId(null)}>
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[18px] font-semibold leading-tight text-[#1f2328]">{selected.name}</div>
                <div className="mt-1 text-[13px] text-[#5f6672]">{CAMPUS_NAME}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[#5f6672]">
                  {selected.shortCode && <span className="pl-chip">{selected.shortCode}</span>}
                  {!selected.isSiteFeature && (
                    <span>
                      {selected.storeys} {selected.storeys === 1 ? "floor" : "floors"} · {Math.round(selected.heightMetres)} m
                    </span>
                  )}
                  {selected.isSiteFeature && <span>Campus grounds</span>}
                </div>
              </div>
              {selectedPhoto && <div className="pl-card-photo" style={{ backgroundImage: `url('${selectedPhoto.full}')` }} />}
            </div>
            {hasEntrance && (
              <button type="button" className="pl-route-btn" onClick={routeToSelected}>
                <Navigation className="h-4 w-4" />
                Directions
              </button>
            )}
          </div>
        </div>
      )}

      <style>{CSS}</style>
    </div>
  );
}

/* ------------------------------------------------------------- helpers */

function WalkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <path
        fill="#fff"
        d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"
      />
    </svg>
  );
}

function footprintArea(outline: Vec2[]) {
  let a = 0;
  for (let i = 0; i < outline.length; i++) {
    const p = outline[i];
    const q = outline[(i + 1) % outline.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a / 2);
}

/** A round number of metres that lands near 90 px, for the scale bar. */
function niceScaleBar(scale: number) {
  const target = 90 / Math.max(scale, 0.0001);
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const m = steps.find((s) => s >= target) ?? 1000;
  return { px: Math.round(m * scale), label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

/** Loops a walking marker along the route so the way is obvious at a glance. */
function useWalker(line: Vec2[]) {
  const [pos, setPos] = useState<Vec2 | null>(null);
  const cum = useMemo(() => {
    const out = [0];
    for (let i = 1; i < line.length; i++) out.push(out[i - 1] + metresBetween(line[i - 1], line[i]));
    return out;
  }, [line]);
  useEffect(() => {
    if (line.length < 2) {
      setPos(null);
      return;
    }
    const total = cum[cum.length - 1];
    const speed = Math.max(25, total / 14);
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      setPos(pointAlong(line, cum, (((now - t0) / 1000) * speed) % (total + speed * 0.8)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [line, cum]);
  return pos;
}

/* ---------------------------------------------------------------- style */

const CSS = `
.plan-root { --s: 1; background: #e4e9e2; font-family: Inter, "Segoe UI", Roboto, system-ui, sans-serif; }

.pl-ground { fill: #f4f7f2; stroke: #bccab5; stroke-width: calc(1.8px / var(--s)); }

.pl-road-casing { stroke: #cdd5dd; stroke-width: 8.6; stroke-linecap: round; }
.pl-road { stroke: #ffffff; stroke-width: 7; stroke-linecap: round; }
.pl-walk-casing { stroke: #d3dbd1; stroke-width: 3.6; stroke-linecap: round; }
.pl-walk { stroke: #fdfefe; stroke-width: 2.4; stroke-linecap: round; }

.pl-shadow { fill: rgba(31, 41, 55, .13); }

.pl-bld { fill: #ffffff; stroke: #8b95a3; stroke-width: calc(1.15px / var(--s)); stroke-linejoin: round; cursor: pointer; transition: fill .12s; }
.pl-bld:hover { fill: #f2f6ff; }
.pl-bld--green { fill: #d8e9cd; stroke: #adc79f; }
.pl-bld--water { fill: #cfe3f5; stroke: #9cc0de; }
.pl-bld.is-selected, .pl-bld.is-dest { fill: #d9e6fd; stroke: #1a73e8; stroke-width: calc(2.2px / var(--s)); }

.pl-room { stroke: #aab4c0; stroke-width: calc(1.1px / var(--s)); }
.pl-core { fill: #d7dde5; stroke: #a9b3bf; stroke-width: calc(1.1px / var(--s)); }

.pl-alt { fill: none; stroke: #9aa3ad; stroke-width: calc(6px / var(--s)); stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: calc(1px / var(--s)) calc(11px / var(--s)); cursor: pointer; }
.pl-route-halo { fill: none; stroke: rgba(26,115,232,.18); stroke-width: calc(15px / var(--s)); stroke-linecap: round; stroke-linejoin: round; }
.pl-route { fill: none; stroke: #1a73e8; stroke-width: calc(6.5px / var(--s)); stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: calc(.1px / var(--s)) calc(12px / var(--s)); }

.pl-label { position: absolute; display: flex; align-items: center; gap: 4px; white-space: nowrap;
  transform: translate(-9px, -50%) scale(calc(1 / var(--s))); transform-origin: 9px 50%;
  color: #12306b; font-size: 12px; font-weight: 600; letter-spacing: .1px; }
.pl-label--big { font-size: 13px; }
.pl-label-text { text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 0 5px #fff, 0 1px 2px #fff; }
.pl-dot { width: 9px; height: 9px; border-radius: 50%; background: #1a73e8; border: 2px solid #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); flex: none; }

.pl-room-code { position: absolute; transform: translate(-50%, -50%) scale(calc(1 / var(--s)));
  font-size: 11px; font-weight: 700; color: #33404f; white-space: nowrap; letter-spacing: .2px; }

.pl-bubble { position: absolute; transform: translate(-50%, -100%) scale(calc(1 / var(--s))); transform-origin: 50% 100%;
  display: flex; flex-direction: column; align-items: center; }
.pl-bubble-img { width: 62px; height: 62px; border-radius: 50%; border: 3px solid #fff; background-size: cover; background-position: center;
  box-shadow: 0 4px 12px rgba(0,0,0,.28); }
.pl-bubble-pin { width: 14px; height: 14px; margin-top: -5px; background: #1a73e8; border: 2px solid #fff; transform: rotate(45deg);
  box-shadow: 0 2px 4px rgba(0,0,0,.25); }

.pl-walker { position: absolute; width: 30px; height: 30px; border-radius: 50%; background: #1a73e8; border: 3px solid #fff;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(0,0,0,.3);
  transform: translate(-50%, -50%) scale(calc(1 / var(--s))); }
.pl-walker--moving svg { animation: pl-step .5s ease-in-out infinite alternate; transform-origin: 50% 90%; }
@keyframes pl-step { from { transform: translateY(0) rotate(-7deg); } to { transform: translateY(-1.5px) rotate(7deg); } }

.pl-pin { position: absolute; transform: translate(-50%, -100%) scale(calc(1 / var(--s))); transform-origin: 50% 100%;
  filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
.pl-gps { position: absolute; transform: translate(-50%, -50%) scale(calc(1 / var(--s))); }
.pl-gps-dot { display: block; width: 18px; height: 18px; border-radius: 50%; background: #4285f4; border: 3px solid #fff;
  box-shadow: 0 0 0 7px rgba(66,133,244,.22), 0 1px 4px rgba(0,0,0,.3); }

.pl-btn { width: 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
  background: #fff; color: #1f2328; box-shadow: 0 1px 4px rgba(0,0,0,.18); }
.pl-btn:hover { background: #f5f7fa; }

.pl-scale { height: 22px; border: 2px solid #97a0ac; border-top: 0; border-radius: 0 0 2px 2px; position: relative; }
.pl-scale span { position: absolute; left: 50%; top: 2px; transform: translateX(-50%); font-size: 11px; font-weight: 600; color: #5a6472;
  text-shadow: 0 0 3px #fff, 0 0 3px #fff; }

.pl-card { position: relative; background: #fff; border-radius: 18px; padding: 16px 16px 14px; box-shadow: 0 10px 30px rgba(15,23,42,.18); }
.pl-card-close { position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; background: #f1f3f5; color: #5f6672; }
.pl-card-photo { width: 96px; height: 74px; border-radius: 12px; background-size: cover; background-position: center; flex: none; margin-right: 24px; }
.pl-chip { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; background: #e8f0fe; color: #1558d6; font-weight: 600; }
.pl-route-btn { margin-top: 14px; width: 100%; height: 46px; border-radius: 12px; background: #1a73e8; color: #fff;
  font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; }
.pl-route-btn:hover { background: #1765cc; }
`;
