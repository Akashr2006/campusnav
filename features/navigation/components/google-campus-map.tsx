"use client";

/**
 * The 2D campus map on /navigate: the 3D view's campus drawn flat as a clean
 * university wayfinding map. White buildings with fine outlines on a light
 * ground, a blue pin and name beside each building (decluttered so labels
 * never overlap), a selected building highlighted in blue with a photo
 * bubble and a bottom card with a Route button, and a dotted walking route
 * from a walking-person start to a red destination pin.
 *
 * Only campus data is drawn: no outside street or satellite tiles. Leaflet
 * provides pan, pinch and zoom. Takes the same props as the older SVG
 * `CampusMap`, so `NavigateShell` routing, search and guidance are unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Polygon, Polyline, Marker, Circle, useMap, useMapEvents } from "react-leaflet";
import { LocateFixed, Maximize, Minus, Plus, X, Navigation } from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import type { Building, Destination, Node } from "@/shared/data/campus";
import type { Route } from "@/features/navigation/services/graph";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { buildingPhoto } from "../lib/building-photos";

type LatLng = [number, number];

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

/* ------------------------------------------------------------- palette */

const C = {
  outside: "#eceef1",
  ground: "#f8f9fa",
  groundEdge: "#d9dde2",
  building: "#ffffff",
  buildingEdge: "#9aa3ad",
  green: "#e3efdf",
  greenEdge: "#bfd3b8",
  water: "#d6e6f5",
  waterEdge: "#aac6e0",
  path: "#e1e4e8",
  pathEdge: "#d2d6db",
  selected: "#d8e5fb",
  selectedEdge: "#2f6bd8",
  pin: "#0b57d0",
  route: "#1a73e8",
};

/* ------------------------------------------------------------- icons */

// Material "directions_walk" (Apache-2.0).
const WALK_PATH =
  "M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7";

const PIN_SVG = (color: string, size: number) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="${color}" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="3" fill="#fff"/></svg>`;

function walkerIcon(moving: boolean) {
  return L.divIcon({
    className: "cm-bare",
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `<div class="cm-walker${moving ? " cm-walker--moving" : ""}"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="#fff" d="${WALK_PATH}"/></svg></div>`,
  });
}

const DEST_PIN = L.divIcon({
  className: "cm-bare",
  iconSize: [30, 42],
  iconAnchor: [15, 40],
  html: `<svg viewBox="0 0 32 44" width="30" height="42" class="cm-drop" aria-hidden="true"><path d="M16 1.5C8 1.5 1.5 7.8 1.5 15.7c0 10.4 14.5 26.8 14.5 26.8s14.5-16.4 14.5-26.8C30.5 7.8 24 1.5 16 1.5z" fill="#EA4335" stroke="#B31412" stroke-width="1.5"/><circle cx="16" cy="15.5" r="5.2" fill="#7A0C0C"/></svg>`,
});

const GPS_DOT = L.divIcon({ className: "cm-bare", iconSize: [20, 20], iconAnchor: [10, 10], html: `<div class="cm-gps"></div>` });

function labelIcon(text: string) {
  const w = 18 + text.length * 6.9;
  return L.divIcon({
    className: "cm-bare",
    iconSize: [w, 20],
    iconAnchor: [9, 10],
    html: `<div class="cm-label">${PIN_SVG(C.pin, 16)}<span>${escapeHtml(text)}</span></div>`,
  });
}

function bubbleIcon(photo: string | null) {
  return L.divIcon({
    className: "cm-bare",
    iconSize: [64, 86],
    iconAnchor: [32, 86],
    html: photo
      ? `<div class="cm-bubble"><div class="cm-bubble-img" style="background-image:url('${photo}')"></div><div class="cm-bubble-tip">${PIN_SVG(C.pin, 26)}</div></div>`
      : `<div class="cm-bubble cm-bubble--pin">${PIN_SVG(C.pin, 38)}</div>`,
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* ------------------------------------------------------------ geometry */

function nodeLatLng(n?: Node | null): LatLng | null {
  return n && typeof n.lat === "number" && typeof n.lng === "number" ? [n.lat, n.lng] : null;
}

function buildingRing(b: Building): LatLng[] {
  const fp = (b as Building & { footprint?: { lat: number; lng: number }[] }).footprint ?? [];
  return fp.map((p) => [p.lat, p.lng]);
}

function ringCentre(ring: LatLng[]): LatLng {
  const la = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const ln = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  return [la, ln];
}

function ringAreaM2(ring: LatLng[]) {
  const k = 111320 * Math.cos((ring[0][0] * Math.PI) / 180);
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p[1] * k * q[0] * 110574 - q[1] * k * p[0] * 110574;
  }
  return Math.abs(a / 2);
}

function metresBetween(a: LatLng, b: LatLng) {
  const r = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

function pointAlong(line: LatLng[], cum: number[], t: number): LatLng {
  const d = Math.max(0, Math.min(cum[cum.length - 1], t));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const k = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
  const a = line[i - 1];
  const b = line[i];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/** Screen width in pixels of `metres` at this zoom, for paths drawn to scale. */
function metresToPx(zoom: number, metres: number) {
  const mpp = (156543.03 * Math.cos((11.5 * Math.PI) / 180)) / 2 ** zoom;
  return metres / mpp;
}

/* ------------------------------------------------------- map behaviour */

function FitView({ bounds, routeKey }: { bounds: L.LatLngBounds | null; routeKey: string }) {
  const map = useMap();
  const fit = useCallback(() => {
    if (!bounds || !bounds.isValid()) return;
    const el = map.getContainer();
    // Hidden behind the phone planner sheet the map has no size, and fitting
    // then zooms to the maximum. Wait until it is actually on screen.
    if (el.clientWidth < 50 || el.clientHeight < 50) return;
    map.invalidateSize();
    const mobile = el.clientWidth < 768;
    map.fitBounds(bounds, {
      // Top: room for the destination pin's height. Right: the round buttons.
      paddingTopLeft: [24, 70],
      // Bottom: the phone route card, only when a route is showing.
      paddingBottomRight: [64, mobile ? (routeKey === "campus" ? 40 : 230) : 40],
      maxZoom: 19,
      animate: false,
    });
  }, [map, bounds, routeKey]);
  useEffect(() => {
    fit();
    const t = setTimeout(fit, 350);
    return () => clearTimeout(t);
  }, [fit, routeKey]);
  useEffect(() => {
    let wasHidden = map.getContainer().clientWidth < 50;
    const ro = new ResizeObserver(() => {
      const hidden = map.getContainer().clientWidth < 50;
      map.invalidateSize();
      if (wasHidden && !hidden) fit();
      wasHidden = hidden;
    });
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, fit]);
  return null;
}

function ViewWatcher({ onChange }: { onChange: (zoom: number) => void }) {
  const map = useMapEvents({ zoomend: () => onChange(map.getZoom()) });
  useEffect(() => onChange(map.getZoom()), [map, onChange]);
  return null;
}

type LabelCandidate = { id: string; name: string; short?: string; at: LatLng; priority: number };

/**
 * Blue pin + name for each building, placed greedily largest-first and
 * skipped when it would collide with one already placed, so the map
 * declutters itself as Google and campus maps do. Falls back to the short
 * code before giving a building no label.
 */
function BuildingLabels({ items, hiddenId, onSelect }: { items: LabelCandidate[]; hiddenId: string | null; onSelect: (id: string) => void }) {
  const map = useMap();
  const [placed, setPlaced] = useState<{ id: string; text: string; at: LatLng }[]>([]);
  const relayout = useCallback(() => {
    const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const out: { id: string; text: string; at: LatLng }[] = [];
    const size = map.getSize();
    const sorted = [...items].sort((a, b) => b.priority - a.priority);
    for (const it of sorted) {
      if (it.id === hiddenId) continue;
      const p = map.latLngToContainerPoint(it.at);
      if (p.x < -50 || p.y < -20 || p.x > size.x + 50 || p.y > size.y + 20) continue;
      for (const text of [it.name, it.short].filter(Boolean) as string[]) {
        const w = 18 + text.length * 6.9;
        const box = { x0: p.x - 11, y0: p.y - 11, x1: p.x - 11 + w + 4, y1: p.y + 11 };
        if (!boxes.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) {
          boxes.push(box);
          out.push({ id: it.id, text, at: it.at });
          break;
        }
      }
    }
    setPlaced(out);
  }, [map, items, hiddenId]);
  useMapEvents({ zoomend: relayout, moveend: relayout, resize: relayout });
  useEffect(() => {
    relayout();
  }, [relayout]);
  return (
    <>
      {placed.map((l) => (
        <Marker key={`${l.id}-${l.text}`} position={l.at} icon={labelIcon(l.text)} eventHandlers={{ click: () => onSelect(l.id) }} />
      ))}
    </>
  );
}

function RouteWalker({ line }: { line: LatLng[] }) {
  const [pos, setPos] = useState<LatLng | null>(line[0] ?? null);
  const cum = useMemo(() => {
    const out = [0];
    for (let i = 1; i < line.length; i++) out.push(out[i - 1] + metresBetween(line[i - 1], line[i]));
    return out;
  }, [line]);
  useEffect(() => {
    if (line.length < 2) return;
    const total = cum[cum.length - 1];
    const speed = Math.max(30, total / 12);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      setPos(pointAlong(line, cum, (((now - start) / 1000) * speed) % (total + speed)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [line, cum]);
  const icon = useMemo(() => walkerIcon(true), []);
  return pos ? <Marker position={pos} icon={icon} zIndexOffset={900} interactive={false} /> : null;
}

/* ------------------------------------------------------------ component */

export function GoogleCampusMap({ route, alternativeRoute, onSelectAlternativeRoute, livePosition, gps, onNavigateToDest, fromSelected, toSelected }: Props) {
  const [data, setData] = useState(() => campusStore.getPublishedData());
  const [zoom, setZoom] = useState(17);
  const [map, setMap] = useState<L.Map | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    campusStore.fetchPublishedData().then((d) => live && d && setData(d));
    const unsub = campusStore.subscribe(() => live && setData(campusStore.getPublishedData()));
    return () => {
      live = false;
      unsub();
    };
  }, []);

  const nodes = useMemo(() => data.nodes || [], [data.nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const buildings = useMemo(
    () =>
      (data.buildings || [])
        .map((b) => {
          const ring = buildingRing(b);
          if (ring.length < 3) return null;
          const kind: "water" | "green" | "building" = /pond/i.test(b.id)
            ? "water"
            : b.id.startsWith("s-") || /poly/i.test(b.id)
              ? "green"
              : "building";
          return { b, ring, kind, centre: ringCentre(ring), area: ringAreaM2(ring) };
        })
        .filter(Boolean) as { b: Building; ring: LatLng[]; kind: "water" | "green" | "building"; centre: LatLng; area: number }[],
    [data.buildings]
  );

  const paths = useMemo(
    () =>
      (data.edges || [])
        .map((e) => {
          const a = nodeLatLng(nodeById.get(e.fromNodeId ?? e.from));
          const b = nodeLatLng(nodeById.get(e.toNodeId ?? e.to));
          return a && b ? { id: e.id, road: e.type === "ROAD", line: [a, b] as LatLng[] } : null;
        })
        .filter(Boolean) as { id: string; road: boolean; line: LatLng[] }[],
    [data.edges, nodeById]
  );

  const boundary = useMemo(() => ((data.boundary || []) as { lat: number; lng: number }[]).map((p) => [p.lat, p.lng] as LatLng), [data.boundary]);

  const routeLine = useMemo(() => (route?.nodes || []).map(nodeLatLng).filter(Boolean) as LatLng[], [route]);
  const altLine = useMemo(() => (alternativeRoute?.nodes || []).map(nodeLatLng).filter(Boolean) as LatLng[], [alternativeRoute]);

  const destNode = useMemo(() => {
    const id = toSelected?.nodeId ?? toSelected?.id;
    return (id && nodeById.get(id)) || route?.nodes[route.nodes.length - 1] || null;
  }, [toSelected, nodeById, route]);
  const startNode = useMemo(() => {
    const id = fromSelected?.nodeId ?? fromSelected?.id;
    return (id && nodeById.get(id)) || route?.nodes[0] || null;
  }, [fromSelected, nodeById, route]);

  const gpsPos: LatLng | null = gps?.isGpsActive && typeof gps.lat === "number" && typeof gps.lng === "number" ? [gps.lat, gps.lng] : null;

  const campusBounds = useMemo(() => {
    const pts = boundary.length ? boundary : buildings.flatMap((x) => x.ring);
    return pts.length ? L.latLngBounds(pts) : null;
  }, [boundary, buildings]);
  const viewBounds = useMemo(() => (routeLine.length >= 2 ? L.latLngBounds(routeLine) : campusBounds), [routeLine, campusBounds]);
  const centre: LatLng = campusBounds ? [campusBounds.getCenter().lat, campusBounds.getCenter().lng] : [11.4965, 77.2774];

  // Starting a route replaces the building card.
  useEffect(() => {
    if (route) setSelectedId(null);
  }, [route]);

  const selected = buildings.find((x) => x.b.id === selectedId) ?? null;
  const selectedPhoto = selected ? buildingPhoto(selected.b.id) : null;

  const labelItems = useMemo<LabelCandidate[]>(
    () =>
      buildings
        .filter((x) => x.kind !== "water")
        .map((x) => ({ id: x.b.id, name: x.b.name, short: x.b.shortCode, at: x.centre, priority: x.area })),
    [buildings]
  );

  function routeTo(b: Building) {
    const entrance = nodeById.get(`${b.id}-ent`);
    if (!entrance || !onNavigateToDest) return;
    onNavigateToDest({
      id: entrance.id,
      nodeId: entrance.id,
      name: entrance.name || b.name,
      category: "Academic",
      aliases: [b.name, b.shortCode ?? ""].filter(Boolean),
      floorId: entrance.floorId,
      buildingId: b.id,
    });
    setSelectedId(null);
  }

  const walkerStill = useMemo(() => walkerIcon(false), []);
  const livePos = nodeLatLng(livePosition);
  const roadPx = metresToPx(zoom, 7);
  const walkPx = metresToPx(zoom, 3.5);

  return (
    <div className="cm-root relative isolate h-full w-full">
      <MapContainer center={centre} zoom={17} minZoom={14} maxZoom={21} zoomSnap={0.25} zoomDelta={0.5} zoomControl={false} attributionControl={false} className="h-full w-full" ref={setMap}>
        <ViewWatcher onChange={setZoom} />
        <FitView bounds={viewBounds} routeKey={route?.id ?? "campus"} />

        {/* Campus ground */}
        {boundary.length >= 3 && (
          <Polygon positions={boundary} interactive={false} pathOptions={{ color: C.groundEdge, weight: 1.2, fillColor: C.ground, fillOpacity: 1 }} />
        )}

        {/* Paths: soft grey, drawn to scale as on a printed campus map. */}
        {paths.map((p) => (
          <Polyline key={`${p.id}-e`} positions={p.line} interactive={false} pathOptions={{ color: C.pathEdge, weight: Math.max(2.5, Math.min(26, (p.road ? roadPx : walkPx) + 1.5)), lineCap: "round", lineJoin: "round" }} />
        ))}
        {paths.map((p) => (
          <Polyline key={p.id} positions={p.line} interactive={false} pathOptions={{ color: C.path, weight: Math.max(1.5, Math.min(24, p.road ? roadPx : walkPx)), lineCap: "round", lineJoin: "round" }} />
        ))}

        {/* Buildings: white blocks with a fine outline; grounds green, ponds blue. */}
        {buildings.map(({ b, ring, kind }) => {
          const isSel = b.id === selectedId;
          const isDest = destNode?.id === `${b.id}-ent`;
          const fill = isSel || isDest ? C.selected : kind === "water" ? C.water : kind === "green" ? C.green : C.building;
          const edge = isSel || isDest ? C.selectedEdge : kind === "water" ? C.waterEdge : kind === "green" ? C.greenEdge : C.buildingEdge;
          return (
            <Polygon
              key={b.id}
              positions={ring}
              eventHandlers={{ click: () => setSelectedId(b.id) }}
              pathOptions={{ color: edge, weight: isSel || isDest ? 2 : 1, fillColor: fill, fillOpacity: 1 }}
            />
          );
        })}

        {/* Dotted walking route over a soft band; alternative in grey. */}
        {altLine.length >= 2 && (
          <Polyline positions={altLine} pathOptions={{ color: "#9aa3ad", weight: 5, dashArray: "1 10", lineCap: "round" }} eventHandlers={{ click: () => onSelectAlternativeRoute?.() }} />
        )}
        {routeLine.length >= 2 && (
          <>
            <Polyline positions={routeLine} interactive={false} pathOptions={{ color: C.route, weight: 12, opacity: 0.18, lineCap: "round", lineJoin: "round" }} />
            <Polyline positions={routeLine} interactive={false} pathOptions={{ color: C.route, weight: 6, dashArray: "0.1 11", lineCap: "round", lineJoin: "round" }} />
            <RouteWalker line={routeLine} />
          </>
        )}

        <BuildingLabels items={labelItems} hiddenId={selectedId} onSelect={setSelectedId} />

        {selected && <Marker position={selected.centre} icon={bubbleIcon(selectedPhoto?.thumb ?? null)} zIndexOffset={1300} interactive={false} />}

        {nodeLatLng(startNode) && <Marker position={nodeLatLng(startNode)!} icon={walkerStill} zIndexOffset={800} interactive={false} />}
        {nodeLatLng(destNode) && <Marker position={nodeLatLng(destNode)!} icon={DEST_PIN} zIndexOffset={1000} interactive={false} />}
        {livePos && <Marker position={livePos} icon={walkerIcon(true)} zIndexOffset={1100} interactive={false} />}
        {gpsPos && (
          <>
            <Circle center={gpsPos} radius={Math.min(gps?.accuracy || 15, 80)} interactive={false} pathOptions={{ color: C.route, weight: 1, fillColor: C.route, fillOpacity: 0.12 }} />
            <Marker position={gpsPos} icon={GPS_DOT} zIndexOffset={1200} interactive={false} />
          </>
        )}
      </MapContainer>

      {/* One narrow column of round buttons on the right: zoom, locate, fit. */}
      <div className="pointer-events-none absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
        <button type="button" className="cm-round pointer-events-auto" title="Zoom in" onClick={() => map?.zoomIn()}>
          <Plus className="h-5 w-5" />
        </button>
        <button type="button" className="cm-round pointer-events-auto" title="Zoom out" onClick={() => map?.zoomOut()}>
          <Minus className="h-5 w-5" />
        </button>
        <button type="button" className="cm-round pointer-events-auto" title="Show my location" onClick={() => (gpsPos ? map?.flyTo(gpsPos, 19) : map?.locate({ setView: true, maxZoom: 19 }))}>
          <LocateFixed className={`h-5 w-5 ${gpsPos ? "text-[#1a73e8]" : ""}`} />
        </button>
        <button type="button" className="cm-round pointer-events-auto" title={routeLine.length ? "Show whole route" : "Show whole campus"} onClick={() => viewBounds && map?.fitBounds(viewBounds, { padding: [30, 30], maxZoom: 19 })}>
          <Maximize className="h-[18px] w-[18px]" />
        </button>
      </div>

      {/* Building card, as on a campus wayfinding app. */}
      {selected && (
        <div className="absolute inset-x-3 bottom-[88px] z-[1000] mx-auto max-w-md md:bottom-4">
          <div className="cm-card">
            <button type="button" className="cm-card-close" title="Close" onClick={() => setSelectedId(null)}>
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 pt-1">
                <div className="truncate text-[17px] font-semibold text-[#202124]">{selected.b.name}</div>
                <div className="mt-0.5 text-[13px] text-[#5f6368]">{CAMPUS_NAME}</div>
                {selected.b.shortCode && <div className="mt-1 text-[12px] font-medium text-[#0b57d0]">{selected.b.shortCode}</div>}
              </div>
              {selectedPhoto && <div className="cm-card-photo" style={{ backgroundImage: `url('${selectedPhoto.full}')` }} />}
            </div>
            {nodeById.has(`${selected.b.id}-ent`) && (
              <button type="button" className="cm-route-btn" onClick={() => routeTo(selected.b)}>
                <Navigation className="h-4 w-4" />
                Route
              </button>
            )}
          </div>
        </div>
      )}

      <style>{MAP_CSS}</style>
    </div>
  );
}

const MAP_CSS = `
.cm-root .leaflet-container { background: ${C.outside}; font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif; }
.cm-bare { background: transparent; border: 0; }
.cm-label { display: flex; align-items: center; gap: 2px; white-space: nowrap; cursor: pointer;
  color: ${C.pin}; font-size: 12px; font-weight: 600; letter-spacing: .1px;
  text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff, 0 0 4px #fff; }
.cm-label svg { flex: none; filter: drop-shadow(0 1px 1px rgba(0,0,0,.2)); }
.cm-round { width: 40px; height: 40px; border-radius: 9999px; display: flex; align-items: center; justify-content: center;
  background: #fff; color: #202124; border: 1.5px solid #3c4043; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.cm-round:hover { background: #f8f9fa; }
.cm-walker { width: 32px; height: 32px; border-radius: 50%; background: ${C.route}; border: 3px solid #fff;
  box-shadow: 0 2px 6px rgba(0,0,0,.3); display: flex; align-items: center; justify-content: center; }
.cm-walker--moving svg { animation: cm-step .5s ease-in-out infinite alternate; transform-origin: 50% 90%; }
@keyframes cm-step { from { transform: translateY(0) rotate(-6deg); } to { transform: translateY(-1.5px) rotate(6deg); } }
.cm-gps { width: 20px; height: 20px; border-radius: 50%; background: #4285f4; border: 3px solid #fff;
  box-shadow: 0 0 0 6px rgba(66,133,244,.22), 0 1px 4px rgba(0,0,0,.3); }
.cm-drop { filter: drop-shadow(0 2px 2px rgba(0,0,0,.35)); }
.cm-bubble { position: relative; width: 64px; height: 86px; display: flex; flex-direction: column; align-items: center; }
.cm-bubble-img { width: 64px; height: 64px; border-radius: 50%; border: 3px solid #fff; background-size: cover; background-position: center;
  box-shadow: 0 3px 10px rgba(0,0,0,.25); }
.cm-bubble-tip { margin-top: -10px; }
.cm-bubble--pin { justify-content: flex-end; }
.cm-card { position: relative; background: #fff; border-radius: 18px; padding: 16px; box-shadow: 0 8px 28px rgba(0,0,0,.18); }
.cm-card-close { position: absolute; top: 10px; right: 10px; width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; background: #f1f3f4; color: #5f6368; z-index: 1; }
.cm-card-photo { width: 104px; height: 78px; border-radius: 12px; background-size: cover; background-position: center; flex: none; margin-right: 26px; }
.cm-route-btn { margin-top: 14px; width: 100%; height: 44px; border-radius: 10px; background: ${C.route}; color: #fff;
  font-size: 15px; font-weight: 600; display: flex; align-items: center; justify-content: center; gap: 8px; }
.cm-route-btn:hover { background: #1765cc; }
`;
