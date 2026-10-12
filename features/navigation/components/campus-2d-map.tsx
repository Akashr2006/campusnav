"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BedDouble,
  BookOpen,
  Building2,
  Bus,
  Check,
  Droplets,
  FlaskConical,
  GraduationCap,
  HardHat,
  Home,
  Layers,
  LocateFixed,
  Maximize2,
  Minus,
  Plus,
  Ruler,
  Theater,
  Trophy,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { Building3D, Campus3D, Vec2 } from "@/features/navigation-3d/lib/campus-3d";
import { frameFor, type BuildingFrame } from "@/features/navigation-3d/lib/building-structure";
import { isLandCover, placeKind, type PlaceKind } from "../lib/place-kind";
import { neatOutline } from "../lib/neat-outline";

/**
 * The 2D campus map, built from the 3D view's own data:
 *  - Drone style: the drone mesh rendered straight down (tools/drone/build-ortho.py)
 *    as a tile pyramid, with every roofed block's outline over it.
 *  - Plan style: a clean indoor-map style drawing of the same outlines.
 * Block outlines come from the drone survey's heights (anything roofed that
 * stands above the terrain), and take their names from the 3D view's buildings
 * wherever they overlap. Geometry is in the 3D scene's metres (X east, Z south).
 */

export const PLAN = {
  canvas: "#eceeec",
  droneCanvas: "#e7ecef",
  site: "#f3f1ec",
  siteEdge: "#7d8a97",
  // Land cover from the drone survey (public/drone/landcover.json).
  bare: "#eee2cb",
  paved: "#ebe9e5",
  grass: "#d3eac2",
  trees: "#acd595",
  water: "#a6d3f3",
  waterEdge: "#73b2e2",
  // Buildings: named ones in the markers' purple family, the rest grey.
  block: "#ddd5f4",
  blockEdge: "#9c8ed6",
  blockHover: "#cbbff0",
  blockActive: "#b4a3ee",
  blockActiveEdge: "#5b3fa6",
  unnamed: "#d9dee6",
  unnamedEdge: "#a3acb9",
  shadow: "#5a6478",
  wall: "#a99fd0",
  room: "#f3f0fc",
  // Roads and walkways: white at their surveyed width, with a darker edge.
  road: "#ffffff",
  roadEdge: "#a7b1bc",
  walk: "#ffffff",
  walkEdge: "#bcc5ce",
  grassEdge: "#9cc985",
  marker: "#5b3fa6",
  route: "#3bb26a",
  label: "#26313c",
} as const;

/** One SVG path per land cover class, in scene metres (tools/drone/build-landcover.mjs). */
type LandCover = { bare: string; paved: string; grass: string; trees: string; water: string };

const ICON: Record<PlaceKind, LucideIcon> = {
  academic: GraduationCap,
  lab: FlaskConical,
  hostel: BedDouble,
  hall: Theater,
  library: BookOpen,
  sports: Trophy,
  water: Droplets,
  residence: Home,
  transport: Bus,
  utility: Warehouse,
  construction: HardHat,
};

export function placeIcon(kind: PlaceKind | null) {
  return kind ? ICON[kind] : Building2;
}

/** A roofed block found in the drone survey (public/drone/footprints.json). */
export type Footprint = {
  id: string;
  outline: [number, number][];
  areaM2: number;
  heightM: number;
  storeys: number;
  buildingId: string | null;
  name: string | null;
};

type OrthoMeta = {
  x0: number;
  z0: number;
  mpp: number;
  tile: number;
  levels: { level: number; mpp: number; cols: number; rows: number; tiles: string[] }[];
};

/** The orthophoto lives next to the drone mesh, locally or on its CDN. */
const ORTHO_BASE = (process.env.NEXT_PUBLIC_DRONE_TILESET_URL ?? "/drone/mesh/tileset.json").replace(
  /tileset\.json$/,
  "ortho/"
);

/**
 * `w`: the paved width measured in the survey (metres), when known. `hidden`:
 * a link the survey inferred under tree canopy rather than saw.
 */
export type RoadSegment = { from: Vec2; to: Vec2; kind: "ROAD" | "WALK"; w?: number; hidden?: boolean };
export type MapStyle = "drone" | "plan";

/** One thing on the map: a named building (from the 3D view) or an unnamed block. */
export type MapFeature = {
  key: string;
  name: string | null;
  kind: PlaceKind | null;
  polygons: Vec2[][];
  centre: Vec2;
  areaM2: number;
  building: Building3D | null;
  footprints: Footprint[];
  land: boolean;
};

type View = { cx: number; cz: number; s: number };

const MIN_S = 0.25;
const MAX_S = 16;
const ROOM_ZOOM = 2.6;

function bounds(points: Vec2[]) {
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  return { minX, maxX, minZ, maxZ };
}

function polyArea(o: Vec2[]) {
  let a = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

function centroid(o: Vec2[]): Vec2 {
  let a = 0,
    cx = 0,
    cz = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    const c = p.x * q.z - q.x * p.z;
    a += c;
    cx += (p.x + q.x) * c;
    cz += (p.z + q.z) * c;
  }
  if (Math.abs(a) < 1e-6)
    return { x: o.reduce((s, p) => s + p.x, 0) / o.length, z: o.reduce((s, p) => s + p.z, 0) / o.length };
  return { x: cx / (3 * a), z: cz / (3 * a) };
}

const pts = (o: Vec2[]) => o.map((p) => `${p.x},${p.z}`).join(" ");

function niceScale(s: number, px = 120) {
  const metres = px / s;
  const pow = Math.pow(10, Math.floor(Math.log10(metres)));
  const n = metres / pow;
  const m = (n >= 5 ? 5 : n >= 2 ? 2 : 1) * pow;
  const fmt = (v: number) => (m >= 1000 ? `${v / 1000}` : `${v}`);
  return { px: m * s, metres: m, half: fmt(m / 2), label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

/** Walking pace the router uses (features/navigation/lib/path-network.ts). */
const WALK_SPEED = 1.3;

export function formatMetres(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

function walkMinutes(m: number) {
  return Math.max(1, Math.round(m / WALK_SPEED / 60));
}

const LAND_URL = "/drone/landcover.json";

function roomPlan(frame: BuildingFrame | null) {
  if (!frame || !frame.rooms.length) return null;
  const floorId = frame.rooms[0].floorId;
  const rooms = frame.rooms.filter((r) => r.floorId === floorId);
  const base = rooms[0].base;
  const cores = frame.cores.filter((c) => c.base <= base + 0.1 && c.top >= base);
  return { rooms, cores };
}

/**
 * Joins the 3D view's buildings with the drone footprints. A building takes
 * the outlines of every roof that overlaps it; roofs no building claims stay
 * as unnamed blocks. Roof outlines are straightened (lib/neat-outline.ts): the
 * survey traces them from pixels, so straight walls came out as zig-zags.
 */
export function buildFeatures(campus: Campus3D, footprints: Footprint[] | null): MapFeature[] {
  const fps = footprints ?? [];
  const out: MapFeature[] = [];
  for (const b of campus.buildings) {
    const kind = placeKind(b.name);
    const mine = fps.filter((f) => f.buildingId === b.id);
    const land = isLandCover(kind);
    // A few scraps of roof (low sheds, translucent greenhouses) say less than
    // the traced outline does, so the survey only replaces it when it found most of it.
    const found = mine.reduce((n, f) => n + f.areaM2, 0);
    if (mine.length && !land && found >= 0.2 * polyArea(b.outline)) {
      const polygons = mine.map((f) => neatOutline(f.outline.map(([x, z]) => ({ x, z }))));
      const largest = polygons.reduce((a, p) => (polyArea(p) > polyArea(a) ? p : a), polygons[0]);
      out.push({
        key: b.id,
        name: b.name,
        kind,
        polygons,
        centre: centroid(largest),
        areaM2: mine.reduce((n, f) => n + f.areaM2, 0),
        building: b,
        footprints: mine,
        land,
      });
    } else {
      out.push({
        key: b.id,
        name: b.name,
        kind,
        polygons: [b.outline],
        centre: b.centre,
        areaM2: polyArea(b.outline),
        building: b,
        footprints: [],
        land,
      });
    }
  }
  for (const f of fps) {
    if (f.buildingId) continue;
    const poly = neatOutline(f.outline.map(([x, z]) => ({ x, z })));
    out.push({
      key: f.id,
      name: null,
      kind: null,
      polygons: [poly],
      centre: centroid(poly),
      areaM2: f.areaM2,
      building: null,
      footprints: [f],
      land: false,
    });
  }
  return out;
}

export function Campus2DMap({
  campus,
  features,
  segments,
  routePath,
  playing,
  onProgress,
  selectedId,
  onSelect,
  highlightKind,
  focusId,
  myPosition,
  onLocate,
  locating,
  destinationKey,
  routeLabel,
  showLabels = true,
  padding = { top: 40, right: 40, bottom: 40, left: 80 },
}: {
  campus: Campus3D;
  features: MapFeature[];
  segments: RoadSegment[];
  routePath: Vec2[];
  playing: boolean;
  onProgress?: (t: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  highlightKind: PlaceKind | null;
  focusId?: { id: string; n: number } | null;
  myPosition?: Vec2 | null;
  onLocate?: () => void;
  locating?: boolean;
  destinationKey?: string | null;
  /** Shown at the route's end, e.g. "732 m · 9 min". */
  routeLabel?: string | null;
  showLabels?: boolean;
  padding?: { top: number; right: number; bottom: number; left: number };
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Unmeasured until the first layout: fitting the campus to a guessed size left it small.
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ cx: campus.centre.x, cz: campus.centre.z, s: 0.6 });
  const [layers, setLayers] = useState({ places: true, paths: true, outlines: true, rooms: true });
  // On the photo the roads already show; the detected network is drawn over it on request.
  const [photoPaths, setPhotoPaths] = useState(false);
  // The map drawn from the survey opens first: it reads at every zoom, where
  // the photo blurs past 0.25 m a pixel and its labels fight the roofs.
  const [style, setStyle] = useState<MapStyle>("plan");
  const [land, setLand] = useState<LandCover | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  // The ruler: taps on the map add points, distances shown along the way.
  const [measuring, setMeasuring] = useState(false);
  const [measure, setMeasure] = useState<Vec2[]>([]);
  const [walker, setWalker] = useState<Vec2 | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [ortho, setOrtho] = useState<OrthoMeta | null>(null);
  const [orthoMissing, setOrthoMissing] = useState(false);
  const [dpr, setDpr] = useState(1);

  useEffect(() => {
    setDpr(Math.min(2, window.devicePixelRatio || 1));
    // `?style=photo` (or `drone`) opens on the drone photo; `?style=plan` is the default map.
    const asked = new URLSearchParams(window.location.search).get("style");
    if (asked === "photo" || asked === "drone") setStyle("drone");
    let live = true;
    // Retried twice: one dropped request must not leave the map on the plan
    // drawing (the traced outlines) instead of the drone photo. A 404 means
    // the photo tiles are not deployed here and is not retried.
    (async () => {
      for (const wait of [0, 1500, 4000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        if (!live) return;
        try {
          const r = await fetch(`${ORTHO_BASE}meta.json`);
          if (r.ok) {
            const m = await r.json();
            if (live) setOrtho(m);
            return;
          }
          if (r.status === 404) break;
        } catch {
          // Network hiccup: try again.
        }
      }
      if (live) setOrthoMissing(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  // Without the orthophoto there is nothing to draw in drone style.
  const effectiveStyle: MapStyle = style === "drone" && orthoMissing ? "plan" : style;
  const drone = effectiveStyle === "drone";

  // Land cover is drawn in the map style only: fetched the first time it shows,
  // retried like the photo (the map still reads without it, as plain ground).
  useEffect(() => {
    if (drone || land) return;
    let live = true;
    (async () => {
      for (const wait of [0, 1500, 4000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        if (!live) return;
        try {
          const r = await fetch(LAND_URL);
          if (r.ok) {
            const j = (await r.json()) as LandCover;
            if (live) setLand(j);
            return;
          }
          if (r.status === 404) return;
        } catch {
          // Network hiccup: try again.
        }
      }
    })();
    return () => {
      live = false;
    };
  }, [drone, land]);

  const tileSets = useMemo(() => ortho?.levels.map((l) => new Set(l.tiles)) ?? [], [ortho]);

  const plans = useMemo(() => {
    const m = new Map<string, NonNullable<ReturnType<typeof roomPlan>>>();
    for (const b of campus.buildings) {
      if (b.lod === "MASSING") continue;
      const plan = roomPlan(frameFor(b));
      if (plan) m.set(b.id, plan);
    }
    return m;
  }, [campus]);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- camera ----------------------------------------------------------------
  const anim = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;

  const flyTo = useCallback((target: View, ms = 450) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = 1 - Math.pow(1 - t, 3);
      const s = Math.exp(Math.log(from.s) + (Math.log(target.s) - Math.log(from.s)) * e);
      setView({ cx: from.cx + (target.cx - from.cx) * e, cz: from.cz + (target.cz - from.cz) * e, s });
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const fitTo = useCallback(
    (points: Vec2[], animate = true, maxS = 3) => {
      if (!points.length || size.w < 10) return;
      const b = bounds(points);
      const w = Math.max(20, b.maxX - b.minX);
      const h = Math.max(20, b.maxZ - b.minZ);
      const availW = Math.max(40, size.w - padding.left - padding.right);
      const availH = Math.max(40, size.h - padding.top - padding.bottom);
      const s = Math.max(MIN_S, Math.min(maxS, availW / w, availH / h));
      const v = {
        cx: (b.minX + b.maxX) / 2 - (padding.left - padding.right) / 2 / s,
        cz: (b.minZ + b.maxZ) / 2 - (padding.top - padding.bottom) / 2 / s,
        s,
      };
      animate ? flyTo(v) : setView(v);
    },
    [size.w, size.h, padding.left, padding.right, padding.top, padding.bottom, flyTo]
  );

  const campusPoints = useMemo(
    () => (campus.boundary.length ? campus.boundary : campus.buildings.flatMap((b) => b.outline)),
    [campus]
  );

  // `?debug`: the camera, for tools/drone screenshots of exact places.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("debug")) return;
    (window as unknown as { __map2d: unknown }).__map2d = { view: () => viewRef.current, setView };
  }, []);

  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || size.w < 10) return;
    fitted.current = true;
    fitTo(campusPoints, false);
  }, [size.w, fitTo, campusPoints]);

  const routeKey = routePath.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join("|");
  // Also once the map has a size: a route opened from a link arrives before it does.
  const measured = size.w >= 10;
  useEffect(() => {
    if (routePath.length >= 2) fitTo(routePath, true, 2.2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, measured]);

  useEffect(() => {
    if (!focusId) return;
    const f = features.find((x) => x.key === focusId.id);
    if (f) fitTo(f.polygons.flat(), true, plans.has(f.key) ? 4 : 2.6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  useEffect(() => {
    if (myPosition) flyTo({ cx: myPosition.x, cz: myPosition.z, s: Math.max(viewRef.current.s, 1.6) });
  }, [myPosition, flyTo]);

  const zoomAt = useCallback(
    (factor: number, sx = size.w / 2, sy = size.h / 2) => {
      setView((v) => {
        const s = Math.max(MIN_S, Math.min(MAX_S, v.s * factor));
        const wx = v.cx + (sx - size.w / 2) / v.s;
        const wz = v.cz + (sy - size.h / 2) / v.s;
        return { s, cx: wx - (sx - size.w / 2) / s, cz: wz - (sy - size.h / 2) / s };
      });
    },
    [size.w, size.h]
  );

  // ---- gestures ----------------------------------------------------------------
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(0);
  const pinchDist = useRef(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-map-ui]")) return;
    cancelAnimationFrame(anim.current);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setGrabbing(true);
    if (pointers.current.size === 1) dragged.current = 0;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchDist.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      dragged.current += Math.abs(dx) + Math.abs(dy);
      setView((v) => ({ ...v, cx: v.cx - dx / v.s, cz: v.cz - dy / v.s }));
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist.current > 0) {
        const r = wrapRef.current!.getBoundingClientRect();
        zoomAt(d / pinchDist.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      }
      pinchDist.current = d;
      dragged.current += 10;
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchDist.current = 0;
    if (pointers.current.size === 0) setGrabbing(false);
  };

  const pick = (id: string | null) => {
    if (dragged.current > 5) return;
    onSelect(id);
  };

  // ---- route walker ----------------------------------------------------------------
  const lengths = useMemo(() => {
    const acc = [0];
    for (let i = 1; i < routePath.length; i++) {
      acc.push(acc[i - 1] + Math.hypot(routePath[i].x - routePath[i - 1].x, routePath[i].z - routePath[i - 1].z));
    }
    return acc;
  }, [routePath]);

  const progressRef = useRef(0);
  useEffect(() => {
    progressRef.current = 0;
    setWalker(routePath[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey]);

  useEffect(() => {
    if (!playing || routePath.length < 2) return;
    const total = lengths[lengths.length - 1];
    const duration = Math.min(22, Math.max(7, total / 35)) * 1000;
    let last = performance.now();
    let raf = 0;
    let reported = -1;
    const tick = (now: number) => {
      progressRef.current = (progressRef.current + (now - last) / duration) % 1;
      last = now;
      const d = progressRef.current * total;
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < d) i++;
      const seg = lengths[i] - lengths[i - 1] || 1;
      const t = (d - lengths[i - 1]) / seg;
      const a = routePath[i - 1];
      const b = routePath[i];
      setWalker({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      const q = Math.round(progressRef.current * 50) / 50;
      if (q !== reported) {
        reported = q;
        onProgress?.(q);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, routePath, lengths, onProgress]);

  // ---- projection ----------------------------------------------------------------
  const toScreen = (p: Vec2) => ({
    left: (p.x - view.cx) * view.s + size.w / 2,
    top: (p.z - view.cz) * view.s + size.h / 2,
  });
  const worldTransform = `translate(${size.w / 2 - view.cx * view.s} ${size.h / 2 - view.cz * view.s}) scale(${view.s})`;
  const scale = niceScale(view.s);
  const roomsOn = !drone && layers.rooms && view.s >= ROOM_ZOOM;

  // ---- orthophoto tiles in view ----------------------------------------------------
  const orthoTiles = useMemo(() => {
    if (!drone || !ortho) return [];
    const want = 1 / (view.s * dpr);
    const maxL = ortho.levels.length - 1;
    const L = Math.max(0, Math.min(maxL, Math.floor(Math.log2(want / ortho.mpp) + 0.35)));
    const xMin = view.cx - size.w / 2 / view.s;
    const xMax = view.cx + size.w / 2 / view.s;
    const zMin = view.cz - size.h / 2 / view.s;
    const zMax = view.cz + size.h / 2 / view.s;
    const out: { key: string; href: string; x: number; z: number; span: number }[] = [];
    // A coarse level underneath fills gaps while the sharp tiles arrive.
    const levels = L + 2 <= maxL ? [L + 2, L] : L < maxL ? [maxL, L] : [L];
    for (const lv of levels) {
      const info = ortho.levels[lv];
      const span = ortho.tile * info.mpp;
      const c0 = Math.max(0, Math.floor((xMin - ortho.x0) / span));
      const c1 = Math.min(info.cols - 1, Math.floor((xMax - ortho.x0) / span));
      const r0 = Math.max(0, Math.floor((zMin - ortho.z0) / span));
      const r1 = Math.min(info.rows - 1, Math.floor((zMax - ortho.z0) / span));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) {
          if (!tileSets[lv]?.has(`${c}_${r}`)) continue;
          out.push({
            key: `${lv}/${c}_${r}`,
            href: `${ORTHO_BASE}${lv}/${c}_${r}.webp`,
            x: ortho.x0 + c * span,
            z: ortho.z0 + r * span,
            span,
          });
        }
    }
    return out;
  }, [drone, ortho, tileSets, view, size.w, size.h, dpr]);

  // ---- labels: greedy placement, biggest and selected first, no overlaps ----------------
  const labelled = useMemo(() => {
    const placed: { l: number; t: number; r: number; b: number }[] = [];
    const result = new Map<string, { marker: boolean; label: boolean }>();
    const order = features
      .filter((f) => f.name)
      .sort((a, b) => {
        const pa = a.key === selectedId || a.key === destinationKey ? 1 : 0;
        const pb = b.key === selectedId || b.key === destinationKey ? 1 : 0;
        return pb - pa || b.areaM2 - a.areaM2;
      });
    for (const f of order) {
      const p = {
        left: (f.centre.x - view.cx) * view.s + size.w / 2,
        top: (f.centre.z - view.cz) * view.s + size.h / 2,
      };
      if (p.left < -80 || p.top < -80 || p.left > size.w + 80 || p.top > size.h + 80) continue;
      const forced = f.key === selectedId || f.key === destinationKey;
      const markerOn = layers.places && !f.land && (forced || view.s >= 0.3);
      const nameOn = showLabels || forced;
      const d = markerOn ? 28 : 0;
      const w = nameOn ? Math.min(150, (f.name?.length ?? 0) * 6.3 + 12) : d;
      const box = {
        l: p.left - Math.max(w, d) / 2,
        r: p.left + Math.max(w, d) / 2,
        t: p.top - d / 2 - 2,
        b: p.top + d / 2 + (nameOn ? 18 : 0),
      };
      const hit = placed.some((q) => box.l < q.r && box.r > q.l && box.t < q.b && box.b > q.t);
      if (hit && !forced) continue;
      placed.push(box);
      result.set(f.key, { marker: markerOn, label: nameOn });
    }
    return result;
  }, [features, view, size.w, size.h, selectedId, destinationKey, layers.places, showLabels]);

  // One SVG path per kind: the surveyed network is thousands of short segments.
  // For the plan, one per kind and width as well: roads drawn as wide as the
  // survey measured them (a plaza's 28 m capped at 12), walkways at theirs.
  // Consecutive segments of one line are drawn as one polyline, so its bends join smoothly.
  const pathD = useMemo(() => {
    const p = (v: Vec2) => `${v.x.toFixed(1)},${v.z.toFixed(1)}`;
    const groups = new Map<string, { kind: RoadSegment["kind"]; w: number; hidden: boolean; d: string[] }>();
    const all = { ROAD: [] as string[], WALK: [] as string[] };
    let prev: RoadSegment | null = null;
    let prevKey = "";
    for (const s of segments) {
      const road = s.kind === "ROAD";
      const w = road
        ? Math.round(Math.min(12, Math.max(5, s.w ?? 7)))
        : Math.round(2 * Math.min(4.5, Math.max(2, s.w ?? 2.5))) / 2;
      const hidden = !road && Boolean(s.hidden);
      const key = `${s.kind}-${w}${hidden ? "-h" : ""}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { kind: s.kind, w, hidden, d: [] }));
      const joined = prev && key === prevKey && prev.to.x === s.from.x && prev.to.z === s.from.z;
      const piece = joined ? `L${p(s.to)}` : `M${p(s.from)}L${p(s.to)}`;
      g.d.push(piece);
      all[s.kind].push(joined ? piece : `M${p(s.from)}L${p(s.to)}`);
      prev = s;
      prevKey = key;
    }
    // Walkways under roads, narrow under wide, so junctions join cleanly.
    const bands = [...groups.values()]
      .map((g) => ({
        key: `${g.kind}-${g.w}${g.hidden ? "-h" : ""}`,
        kind: g.kind,
        w: g.w,
        hidden: g.hidden,
        d: g.d.join(""),
      }))
      .sort((a, b) => (a.kind === b.kind ? a.w - b.w : a.kind === "WALK" ? -1 : 1));
    return { roads: all.ROAD.join(""), walks: all.WALK.join(""), bands };
  }, [segments]);
  const start = routePath[0];
  const end = routePath[routePath.length - 1];

  const buildings = useMemo(() => features.filter((f) => !f.land), [features]);
  const landCover = useMemo(() => features.filter((f) => f.land), [features]);
  const routeTotal = lengths[lengths.length - 1] ?? 0;

  // Distance marks along the route: every 100 m (50 m on a short one), doubled
  // until they sit at least 70 px apart on screen.
  const routeMarks = useMemo(() => {
    if (routePath.length < 2 || routeTotal < 120) return [];
    let step = routeTotal > 600 ? 100 : 50;
    while (step * view.s < 70) step *= 2;
    const out: { at: Vec2; d: number }[] = [];
    let i = 1;
    for (let d = step; d < routeTotal - step * 0.4; d += step) {
      while (i < lengths.length - 1 && lengths[i] < d) i++;
      const t = (d - lengths[i - 1]) / (lengths[i] - lengths[i - 1] || 1);
      const a = routePath[i - 1];
      const b = routePath[i];
      out.push({ at: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, d });
    }
    return out;
  }, [routePath, lengths, routeTotal, view.s]);

  const measureLegs = measure.slice(1).map((p, i) => Math.hypot(p.x - measure[i].x, p.z - measure[i].z));
  const measureTotal = measureLegs.reduce((a, b) => a + b, 0);
  const stopMeasuring = useCallback(() => {
    setMeasuring(false);
    setMeasure([]);
  }, []);
  useEffect(() => {
    if (!measuring) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stopMeasuring();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [measuring, stopMeasuring]);

  // A drag only moves the world <g> (worldTransform): what is drawn in it is rebuilt
  // when it changes, or when the zoom moves a quarter of a doubling (strokes and
  // shadows are sized for the screen), not on every frame of a pan.
  const zs = Math.pow(2, Math.round(Math.log2(view.s) * 4) / 4);
  const planGround = useMemo(
    () =>
      drone ? null : (
        <>
          {/* The ground: the campus, then what the survey found on it. */}
          <rect x={-5000} y={-5000} width={10000} height={10000} fill={PLAN.canvas} onClick={() => pick(null)} />
          {campus.boundary.length > 2 && (
            <polygon points={pts(campus.boundary)} fill={PLAN.site} onClick={() => pick(null)} />
          )}
          {land && (
            <g pointerEvents="none">
              <path d={land.bare} fill={PLAN.bare} />
              <path d={land.paved} fill={PLAN.paved} />
              <path d={land.grass} fill={PLAN.grass} />
              <path d={land.trees} fill={PLAN.trees} />
              <path
                d={land.water}
                fill={PLAN.water}
                stroke={PLAN.waterEdge}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
          {/* Outside the campus: the same survey, faded, behind a crisp boundary line. */}
          {campus.boundary.length > 2 && (
            <>
              <path
                d={`M-5000,-5000H5000V5000H-5000Z M${campus.boundary.map((p) => `${p.x},${p.z}`).join("L")}Z`}
                fillRule="evenodd"
                fill="#ffffff"
                fillOpacity={0.55}
                pointerEvents="none"
              />
              <polygon
                points={pts(campus.boundary)}
                fill="none"
                stroke={PLAN.siteEdge}
                strokeWidth={1.5}
                strokeDasharray="7 4"
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            </>
          )}
          {/* Grounds and ponds named in the campus map: their land cover is drawn above,
            these are where a click selects them (outlined while selected). */}
          {landCover.map((f) => {
            const on = selectedId === f.key || hoverId === f.key;
            const water = f.kind === "water";
            return (
              <polygon
                key={f.key}
                points={pts(f.polygons[0])}
                fill={land ? "rgba(0,0,0,0.001)" : water ? PLAN.water : PLAN.grass}
                stroke={on ? PLAN.blockActiveEdge : land ? "none" : water ? PLAN.waterEdge : PLAN.grassEdge}
                strokeWidth={selectedId === f.key ? 2 : 1.2}
                strokeDasharray={land ? "5 4" : undefined}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: "pointer" }}
                onPointerEnter={() => setHoverId(f.key)}
                onPointerLeave={() => setHoverId((h) => (h === f.key ? null : h))}
                onClick={(e) => {
                  e.stopPropagation();
                  pick(f.key);
                }}
              />
            );
          })}
          {layers.paths && (
            <g strokeLinecap="round" strokeLinejoin="round" fill="none" pointerEvents="none">
              {/* Every edge first, then every surface, so crossings and junctions read as one
                network. Never thinner on screen than a road or a path can be seen at. */}
              {pathD.bands.map((b) => (
                <path
                  key={`e-${b.key}`}
                  d={b.d}
                  stroke={b.kind === "ROAD" ? PLAN.roadEdge : PLAN.walkEdge}
                  strokeWidth={Math.max(b.w, (b.kind === "ROAD" ? 3.2 : 1.8) / zs) + 2.4 / zs}
                />
              ))}
              {pathD.bands.map((b) => (
                <path
                  key={`s-${b.key}`}
                  d={b.d}
                  stroke={b.kind === "ROAD" ? PLAN.road : PLAN.walk}
                  strokeWidth={Math.max(b.w, (b.kind === "ROAD" ? 3.2 : 1.8) / zs)}
                />
              ))}
            </g>
          )}
        </>
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [drone, land, campus.boundary, landCover, selectedId, hoverId, layers.paths, pathD, zs, onSelect]
  );
  const blocksLayer = useMemo(
    () => (
      <>
        {/* Each block's shadow, all under every block: taller blocks cast longer ones, so
        the plan reads in depth (a metre and a half on screen at the least). */}
        {!drone && (
          <g fill={PLAN.shadow} fillOpacity={0.22} pointerEvents="none">
            {buildings.map((f) => {
              const h = f.footprints.reduce((m, fp) => Math.max(m, fp.heightM), 0) || 6;
              const off = Math.max(1.5 / zs, Math.min(4, h * 0.16));
              return (
                <g key={f.key} transform={`translate(${off * 0.6} ${off})`}>
                  {f.polygons.map((o, i) => (
                    <polygon key={i} points={pts(o)} />
                  ))}
                </g>
              );
            })}
          </g>
        )}

        {/* Blocks */}
        {(layers.outlines || !drone) &&
          buildings.map((f) => {
            const sel = selectedId === f.key;
            const dest = destinationKey === f.key;
            const hot = hoverId === f.key;
            const dim = highlightKind !== null && highlightKind !== f.kind;
            const plan = roomsOn ? plans.get(f.key) : undefined;
            const handlers = {
              style: { cursor: "pointer" } as React.CSSProperties,
              onClick: (e: React.MouseEvent) => {
                e.stopPropagation();
                pick(f.key);
              },
              onPointerEnter: () => setHoverId(f.key),
              onPointerLeave: () => setHoverId((h) => (h === f.key ? null : h)),
            };
            if (drone) {
              return (
                <g key={f.key} {...handlers} opacity={dim ? 0.3 : 1}>
                  {f.polygons.map((o, i) => (
                    <polygon
                      key={i}
                      points={pts(o)}
                      fill={
                        sel
                          ? "rgba(46,163,220,0.32)"
                          : dest
                            ? "rgba(59,178,106,0.3)"
                            : hot
                              ? "rgba(255,255,255,0.2)"
                              : "rgba(0,0,0,0.001)"
                      }
                      stroke={sel ? "#2ea3dc" : dest ? PLAN.route : "#ffffff"}
                      strokeOpacity={sel || dest ? 1 : f.name ? 0.85 : 0.45}
                      strokeWidth={sel || dest ? 2.5 : f.name ? 1.4 : 1}
                      vectorEffect="non-scaling-stroke"
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              );
            }
            return (
              <g key={f.key} {...handlers} opacity={dim ? 0.35 : 1}>
                {f.polygons.map((o, i) => (
                  <polygon
                    key={i}
                    points={pts(o)}
                    fill={
                      plan
                        ? "#ffffff"
                        : dest
                          ? "#bfe7cd"
                          : sel
                            ? PLAN.blockActive
                            : hot
                              ? PLAN.blockHover
                              : f.name
                                ? PLAN.block
                                : PLAN.unnamed
                    }
                    stroke={dest ? PLAN.route : sel ? PLAN.blockActiveEdge : f.name ? PLAN.blockEdge : PLAN.unnamedEdge}
                    strokeWidth={sel || dest ? 2 : 1}
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                ))}
                {plan && (
                  <g>
                    {plan.rooms.map((r) => (
                      <polygon
                        key={r.id}
                        points={pts(r.outline)}
                        fill={r.category === "CORRIDOR" ? "#ffffff" : PLAN.room}
                        stroke={PLAN.wall}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {plan.cores.map((c) => (
                      <rect
                        key={c.id}
                        x={c.centre.x - c.width / 2}
                        y={c.centre.z - c.depth / 2}
                        width={c.width}
                        height={c.depth}
                        fill={c.kind === "STAIR" ? "url(#cn2d-stairs)" : PLAN.block}
                        stroke={PLAN.wall}
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        transform={`rotate(${(c.angleRad * 180) / Math.PI} ${c.centre.x} ${c.centre.z})`}
                      />
                    ))}
                  </g>
                )}
              </g>
            );
          })}
      </>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      drone,
      buildings,
      layers.outlines,
      selectedId,
      destinationKey,
      hoverId,
      highlightKind,
      roomsOn,
      plans,
      zs,
      onSelect,
    ]
  );

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full touch-none select-none overflow-hidden"
      style={{
        background: drone ? PLAN.droneCanvas : PLAN.canvas,
        cursor: grabbing ? "grabbing" : measuring ? "crosshair" : "grab",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      // Measuring: a tap anywhere on the map (not a drag) adds a point, and selects nothing.
      onClickCapture={(e) => {
        if (!measuring || (e.target as HTMLElement).closest("[data-map-ui]")) return;
        e.stopPropagation();
        if (dragged.current > 5) return;
        const r = wrapRef.current!.getBoundingClientRect();
        const sx = e.clientX - r.left;
        const sy = e.clientY - r.top;
        setMeasure((m) => [...m, { x: view.cx + (sx - size.w / 2) / view.s, z: view.cz + (sy - size.h / 2) / view.s }]);
      }}
      onDoubleClick={(e) => {
        if (measuring || (e.target as HTMLElement).closest("[data-map-ui]")) return;
        const r = wrapRef.current!.getBoundingClientRect();
        zoomAt(1.8, e.clientX - r.left, e.clientY - r.top);
      }}
    >
      <style>{`@keyframes cn2d-pulse { 0%{transform:scale(.6);opacity:.55} 100%{transform:scale(2.4);opacity:0} }`}</style>

      <svg width={size.w} height={size.h} className="absolute inset-0">
        <defs>
          <pattern id="cn2d-stairs" width="1" height="0.9" patternUnits="userSpaceOnUse">
            <rect width="1" height="0.9" fill="#ffffff" />
            <line x1="0" y1="0.45" x2="1" y2="0.45" stroke={PLAN.wall} strokeWidth="0.12" />
          </pattern>
        </defs>

        <g transform={worldTransform}>
          {drone ? (
            <g onClick={() => pick(null)}>
              {orthoTiles.map((t) => (
                <image
                  key={t.key}
                  href={t.href}
                  x={t.x}
                  y={t.z}
                  // A hair of overlap hides the seams between neighbouring tiles.
                  width={t.span * 1.004}
                  height={t.span * 1.004}
                  preserveAspectRatio="none"
                />
              ))}
              {/* The survey also covers the village and farms: fade them so the campus reads first. */}
              {campus.boundary.length > 2 && (
                <>
                  <path
                    d={`M-5000,-5000H5000V5000H-5000Z M${campus.boundary.map((p) => `${p.x},${p.z}`).join("L")}Z`}
                    fillRule="evenodd"
                    fill="#eef2f4"
                    fillOpacity={0.62}
                    pointerEvents="none"
                  />
                  <polygon
                    points={pts(campus.boundary)}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity={0.9}
                    strokeWidth={2}
                    strokeDasharray="6 5"
                    vectorEffect="non-scaling-stroke"
                    pointerEvents="none"
                  />
                </>
              )}
              {photoPaths && (
                <g strokeLinecap="round" strokeLinejoin="round" fill="none" pointerEvents="none">
                  <path
                    d={pathD.roads}
                    stroke="#ffd54a"
                    strokeWidth={3}
                    strokeOpacity={0.9}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={pathD.walks}
                    stroke="#7fe7ff"
                    strokeWidth={2}
                    strokeOpacity={0.9}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              )}
            </g>
          ) : (
            planGround
          )}

          {blocksLayer}

          {routePath.length >= 2 && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round">
              {/* On the white roads of the map, a green rim keeps the route's band visible. */}
              {!drone && (
                <polyline
                  points={pts(routePath)}
                  stroke={PLAN.route}
                  strokeOpacity={0.35}
                  strokeWidth={14}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              <polyline
                points={pts(routePath)}
                stroke="#ffffff"
                strokeOpacity={drone ? 0.9 : 1}
                strokeWidth={drone ? 9 : 10}
                vectorEffect="non-scaling-stroke"
              />
              <polyline
                points={pts(routePath)}
                stroke={PLAN.route}
                strokeWidth={5}
                strokeDasharray="0.1 9"
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}

          {measure.length > 0 && (
            <g fill="none" strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
              <polyline points={pts(measure)} stroke="#ffffff" strokeWidth={6} vectorEffect="non-scaling-stroke" />
              <polyline
                points={pts(measure)}
                stroke="#1f2a37"
                strokeWidth={2.5}
                strokeDasharray="8 5"
                vectorEffect="non-scaling-stroke"
              />
              {measure.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.z}
                  r={4.5 / view.s}
                  fill="#ffffff"
                  stroke="#1f2a37"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>
          )}
        </g>
      </svg>

      {/* Markers and names, in screen space. */}
      <div className="pointer-events-none absolute inset-0 isolate z-0">
        {roomsOn &&
          [...plans.values()].flatMap((plan) =>
            plan.rooms
              .filter((r) => r.code && r.category !== "CORRIDOR")
              .map((r) => {
                const p = toScreen(r.centre);
                if (p.left < -40 || p.top < -40 || p.left > size.w + 40 || p.top > size.h + 40) return null;
                return (
                  <span
                    key={r.id}
                    className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] font-semibold"
                    style={{ ...p, color: "#5c8aa1" }}
                  >
                    {r.code}
                  </span>
                );
              })
          )}

        {features.map((f) => {
          const show = labelled.get(f.key);
          if (!show) return null;
          const p = toScreen(f.centre);
          const sel = f.key === selectedId;
          const dim = highlightKind !== null && highlightKind !== f.kind;
          const Icon = placeIcon(f.kind);
          const d = sel ? 36 : view.s < 0.6 ? 22 : 28;
          const lifted = roomsOn && plans.has(f.key);
          const top = lifted ? toScreen({ x: f.centre.x, z: bounds(f.polygons.flat()).minZ }).top - 30 : p.top;
          return (
            <div
              key={f.key}
              className="absolute flex -translate-x-1/2 flex-col items-center"
              style={{
                left: p.left,
                top: top - (show.marker ? d / 2 : 8),
                opacity: dim ? 0.35 : 1,
                zIndex: sel ? 5 : 1,
              }}
            >
              {show.marker && (
                <button
                  type="button"
                  data-map-ui
                  onClick={() => onSelect(f.key)}
                  title={f.name ?? undefined}
                  className="pointer-events-auto flex items-center justify-center rounded-full border-2 border-white transition-transform hover:scale-110"
                  style={{
                    width: d,
                    height: d,
                    background: PLAN.marker,
                    boxShadow: sel
                      ? "0 0 0 4px rgba(91,63,166,0.22), 0 3px 8px rgba(20,15,50,0.45)"
                      : "0 2px 6px rgba(20,15,50,0.4)",
                  }}
                >
                  <Icon className="text-white" style={{ width: d * 0.48, height: d * 0.48 }} strokeWidth={2.2} />
                </button>
              )}
              {show.label && (
                <span
                  className="mt-0.5 max-w-[150px] text-center text-[11.5px] font-semibold leading-tight"
                  style={
                    drone
                      ? {
                          color: "#ffffff",
                          textShadow: "0 0 2px rgba(0,0,0,.9), 0 0 3px rgba(0,0,0,.8), 0 1px 4px rgba(0,0,0,.7)",
                        }
                      : {
                          // Grounds and ponds are named like a map names land: italic, in their own colour.
                          color: f.land ? (f.kind === "water" ? "#1f6aa5" : "#46702c") : PLAN.label,
                          fontStyle: f.land ? "italic" : undefined,
                          textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 0 4px #fff, 0 0 5px #fff",
                        }
                  }
                >
                  {f.name}
                </span>
              )}
            </div>
          );
        })}

        {start && routePath.length >= 2 && (
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={toScreen(start)}>
            <span
              className="block h-4 w-4 rounded-full border-[3px] border-white shadow"
              style={{ background: PLAN.route }}
            />
          </div>
        )}
        {routePath.length >= 2 &&
          routeMarks.map((m) => (
            <div key={m.d} className="absolute -translate-x-1/2 -translate-y-1/2" style={toScreen(m.at)}>
              <span className="block whitespace-nowrap rounded-full border border-[#3bb26a] bg-white px-1.5 text-[10px] font-semibold leading-[15px] text-[#1f7a45] shadow-sm">
                {formatMetres(m.d)}
              </span>
            </div>
          ))}
        {end && routePath.length >= 2 && (
          <div className="absolute -translate-x-1/2 -translate-y-full" style={toScreen(end)}>
            <div className="absolute left-full top-1 ml-1 whitespace-nowrap rounded-md bg-[#1f7a45] px-2 py-0.5 text-[12px] font-semibold text-white shadow">
              {routeLabel ?? `${formatMetres(routeTotal)} · ${walkMinutes(routeTotal)} min`}
            </div>
            <svg width="26" height="34" viewBox="0 0 26 34" className="drop-shadow">
              <path
                d="M13 0C5.8 0 0 5.7 0 12.8 0 22.4 13 34 13 34s13-11.6 13-21.2C26 5.7 20.2 0 13 0z"
                fill={PLAN.route}
              />
              <circle cx="13" cy="12.5" r="4.5" fill="#fff" />
            </svg>
          </div>
        )}
        {measureLegs.map((d, i) => {
          const a = measure[i];
          const b = measure[i + 1];
          if (d * view.s < 46) return null;
          return (
            <div
              key={i}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={toScreen({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })}
            >
              <span className="block whitespace-nowrap rounded bg-white/95 px-1.5 text-[11px] font-semibold leading-[17px] text-[#1f2a37] shadow-sm">
                {formatMetres(d)}
              </span>
            </div>
          );
        })}
        {walker && routePath.length >= 2 && (
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={toScreen(walker)}>
            <span
              className="absolute inset-0 rounded-full"
              style={{ background: PLAN.route, animation: "cn2d-pulse 1.6s ease-out infinite" }}
            />
            <span
              className="relative block h-3.5 w-3.5 rounded-full border-2 border-white shadow"
              style={{ background: PLAN.route }}
            />
          </div>
        )}
        {myPosition && (
          <div className="absolute -translate-x-1/2 -translate-y-1/2" style={toScreen(myPosition)}>
            <span
              className="absolute inset-0 rounded-full bg-[#2ea3dc]"
              style={{ animation: "cn2d-pulse 1.8s ease-out infinite" }}
            />
            <span className="relative block h-4 w-4 rounded-full border-[3px] border-white bg-[#2ea3dc] shadow" />
          </div>
        )}
      </div>

      {/* Controls */}
      <div data-map-ui className="absolute left-5 top-5 z-10 flex flex-col gap-2">
        <CtrlButton title="Zoom in" onClick={() => zoomAt(1.5)}>
          <Plus className="h-4 w-4" />
        </CtrlButton>
        <CtrlButton title="Zoom out" onClick={() => zoomAt(1 / 1.5)}>
          <Minus className="h-4 w-4" />
        </CtrlButton>
        <CtrlButton title="Fit campus" onClick={() => fitTo(campusPoints)}>
          <Maximize2 className="h-4 w-4" />
        </CtrlButton>
        <CtrlButton
          title={measuring ? "Stop measuring" : "Measure a distance"}
          onClick={() => (measuring ? stopMeasuring() : setMeasuring(true))}
          active={measuring}
        >
          <Ruler className="h-4 w-4" />
        </CtrlButton>
        <div className="relative">
          <CtrlButton title="Map style and layers" onClick={() => setLayersOpen((o) => !o)} active={layersOpen}>
            <Layers className="h-4 w-4" />
          </CtrlButton>
          {layersOpen && (
            <div className="absolute left-11 top-0 max-h-[70vh] w-56 overflow-y-auto rounded-lg border border-[#e6edf1] bg-white p-2 text-[13px] shadow-lg">
              <div className="px-1 pb-1.5 text-[11px] text-[#7b8794]">Map style</div>
              <div className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-[#f3f6f8] p-1">
                {(
                  [
                    ["plan", "Map"],
                    ["drone", "Photo"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    disabled={k === "drone" && orthoMissing}
                    onClick={() => setStyle(k)}
                    className={`rounded px-2 py-1 text-[12px] font-medium transition disabled:opacity-40 ${
                      effectiveStyle === k ? "bg-white text-[#1e9bd7] shadow-sm" : "text-[#4a5968]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="px-1 pb-1 text-[11px] text-[#7b8794]">Show</div>
              {(
                [
                  ["places", "Place markers"],
                  ["outlines", "Block outlines"],
                  ["paths", drone ? "Roads & walkways (mapped)" : "Roads & walkways"],
                  ["rooms", "Room plans (plan)"],
                ] as const
              ).map(([k, label]) => {
                // On the photo, the paths row shows the network detected from it.
                const on = k === "paths" && drone ? photoPaths : layers[k];
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      k === "paths" && drone ? setPhotoPaths((v) => !v) : setLayers((l) => ({ ...l, [k]: !l[k] }))
                    }
                    className="flex w-full items-center justify-between rounded-md px-1 py-1.5 text-left text-[#2b3640] hover:bg-[#f3f6f8]"
                  >
                    {label}
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        on ? "border-[#2ea3dc] bg-[#2ea3dc] text-white" : "border-[#c9d6de]"
                      }`}
                    >
                      {on && <Check className="h-3 w-3" strokeWidth={3} />}
                    </span>
                  </button>
                );
              })}
              {!drone && (
                <>
                  <div className="px-1 pb-1 pt-2 text-[11px] text-[#7b8794]">Key (from the drone survey)</div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 px-1 pb-1 text-[12px] text-[#3c4752]">
                    {(
                      [
                        [PLAN.block, PLAN.blockEdge, "Named building"],
                        [PLAN.unnamed, PLAN.unnamedEdge, "Other building"],
                        [PLAN.road, PLAN.roadEdge, "Road / walkway"],
                        [PLAN.trees, PLAN.trees, "Trees"],
                        [PLAN.grass, PLAN.grass, "Lawn, crops"],
                        [PLAN.bare, PLAN.bare, "Open ground"],
                        [PLAN.paved, PLAN.paved, "Paved yard"],
                        [PLAN.water, PLAN.waterEdge, "Water"],
                      ] as const
                    ).map(([fill, edge, label]) => (
                      <div key={label} className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-4 shrink-0 rounded-[2px] border"
                          style={{ background: fill, borderColor: edge }}
                        />
                        {label}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {onLocate && (
          <CtrlButton title="My location" onClick={onLocate}>
            <LocateFixed className={`h-4 w-4 ${locating ? "animate-pulse text-[#2ea3dc]" : ""}`} />
          </CtrlButton>
        )}
      </div>

      {/* Map or photo, one tap away: beside the controls, or on a phone (where the
          search bar runs along the top) at the bottom right, level with the scale. */}
      <div
        data-map-ui
        className="absolute z-10 flex rounded-md border border-[#e6edf1] bg-white p-0.5 shadow-[0_1px_3px_rgba(30,60,80,0.12)]"
        style={size.w < 640 ? { right: 16, bottom: Math.max(16, padding.bottom - 14) } : { left: 68, top: 20 }}
      >
        {(
          [
            ["plan", "Map"],
            ["drone", "Photo"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            disabled={k === "drone" && orthoMissing}
            onClick={() => setStyle(k)}
            className={`h-8 rounded px-3 text-[13px] font-medium transition disabled:opacity-40 ${
              effectiveStyle === k ? "bg-[#e3f4fb] text-[#1e8fc8]" : "text-[#4a5968] hover:bg-[#f3f7f9]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* The ruler's readout. */}
      {measuring && (
        <div data-map-ui className="absolute inset-x-0 top-[68px] z-10 flex justify-center px-4">
          <div className="flex items-center gap-3 rounded-full bg-[#1f2a37] py-1.5 pl-4 pr-1.5 text-[13px] text-white shadow-lg">
            <span>
              {measure.length < 2 ? (
                "Tap the map to measure"
              ) : (
                <>
                  <b>{formatMetres(measureTotal)}</b>
                  <span className="text-white/70"> · about {walkMinutes(measureTotal)} min walk</span>
                </>
              )}
            </span>
            {measure.length > 0 && (
              <button
                type="button"
                onClick={() => setMeasure([])}
                className="rounded-full px-2 py-0.5 text-white/80 hover:bg-white/10"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={stopMeasuring}
              className="rounded-full bg-white px-3 py-0.5 font-medium text-[#1f2a37]"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Scale, north and source */}
      <div
        className="pointer-events-none absolute left-5 z-10 flex items-end gap-2"
        style={{ bottom: Math.max(16, padding.bottom - 14) }}
      >
        <div
          className="flex h-9 w-9 flex-col items-center justify-center rounded-md bg-white/90 shadow-sm"
          title="North is up"
        >
          <svg width="10" height="12" viewBox="0 0 10 12">
            <path d="M5 0 10 12 5 9 0 12z" fill="#26313c" />
          </svg>
          <span className="text-[9px] font-bold leading-none text-[#26313c]">N</span>
        </div>
        <div className="rounded-md bg-white/90 px-2 pb-1.5 pt-1 shadow-sm">
          <div
            className="relative h-3 text-[10px] font-semibold leading-none text-[#26313c]"
            style={{ width: scale.px }}
          >
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2" style={{ left: scale.px / 2 }}>
              {scale.half}
            </span>
            <span className="absolute right-0 translate-x-1/3">{scale.label}</span>
          </div>
          <div className="mt-0.5 flex h-[5px] border border-[#26313c]" style={{ width: scale.px }}>
            <span className="h-full w-1/2 bg-[#26313c]" />
            <span className="h-full w-1/2 bg-white" />
          </div>
        </div>
        {drone && (
          <div className="rounded bg-white/85 px-1.5 py-0.5 text-[10px] text-[#4a5968]">
            Imagery: campus drone survey
          </div>
        )}
      </div>
    </div>
  );
}

function CtrlButton({
  children,
  title,
  onClick,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`flex h-9 w-9 items-center justify-center rounded-md border border-[#e6edf1] shadow-[0_1px_3px_rgba(30,60,80,0.12)] transition ${
        active ? "bg-[#e3f4fb] text-[#2ea3dc]" : "bg-white text-[#3c4752] hover:bg-[#f3f7f9]"
      }`}
    >
      {children}
    </button>
  );
}
