"use client";

/**
 * The 2D campus map on /navigate: the 3D view's campus drawn flat, in the
 * style of Google Maps. No outside map tiles: just the campus ground, the
 * buildings at their surveyed GPS footprints (the same 48 the 3D view
 * extrudes), the path network, a blue route line, a red destination pin and
 * a walking-person start marker that walks the route. Leaflet provides the
 * pan, pinch and zoom.
 *
 * Takes the same props as the older SVG `CampusMap`, so `NavigateShell` can
 * swap between them without any change to routing or search.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapContainer, Polygon, Polyline, Marker, Circle, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { LocateFixed, Minus, Plus, Maximize } from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import type { Building, Destination, Node } from "@/shared/data/campus";
import type { Route } from "@/features/navigation/services/graph";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";

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


/** Labels only appear once blocks are big enough on screen to hold them. */
const LABEL_MIN_ZOOM = 16;
/** Approximate advance width of the 11 px label font, in pixels per character. */
const LABEL_PX_PER_CHAR = 6.2;

/**
 * The label a block can carry at this zoom: its name if that fits inside the
 * footprint, its short code if only that fits, otherwise none. Prevents the
 * dense academic core from turning into overlapping text, as Google declutters.
 */
function fittingLabel(b: Building, ring: LatLng[], zoom: number): string | null {
  const lats = ring.map((p) => p[0]);
  const lngs = ring.map((p) => p[1]);
  const mPerDegLat = 110574;
  const mPerDegLng = 111320 * Math.cos((lats[0] * Math.PI) / 180);
  const widthM = (Math.max(...lngs) - Math.min(...lngs)) * mPerDegLng;
  const heightM = (Math.max(...lats) - Math.min(...lats)) * mPerDegLat;
  const mpp = (156543.03 * Math.cos((lats[0] * Math.PI) / 180)) / 2 ** zoom;
  const widthPx = widthM / mpp;
  const heightPx = heightM / mpp;
  if (heightPx < 14) return null;
  const room = widthPx - 8;
  if (b.name.length * LABEL_PX_PER_CHAR <= room) return b.name;
  if (b.shortCode && b.shortCode.length * LABEL_PX_PER_CHAR <= room) return b.shortCode;
  return null;
}

/* --------------------------------------------------------------- markers */

// Material "directions_walk" (Apache-2.0).
const WALK_PATH =
  "M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7";

function walkerIcon(moving: boolean) {
  return L.divIcon({
    className: "gm-walker-icon",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="gm-walker${moving ? " gm-walker--moving" : ""}">
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="#fff" d="${WALK_PATH}"/></svg>
    </div>`,
  });
}

/** Google's red destination pin: teardrop with a dark core. */
const DEST_PIN = L.divIcon({
  className: "gm-pin-icon",
  iconSize: [32, 44],
  iconAnchor: [16, 42],
  html: `<svg viewBox="0 0 32 44" width="32" height="44" aria-hidden="true">
    <path d="M16 1.5C8 1.5 1.5 7.8 1.5 15.7c0 10.4 14.5 26.8 14.5 26.8s14.5-16.4 14.5-26.8C30.5 7.8 24 1.5 16 1.5z" fill="#EA4335" stroke="#B31412" stroke-width="1.5"/>
    <circle cx="16" cy="15.5" r="5.2" fill="#7A0C0C"/>
  </svg>`,
});

const GPS_DOT = L.divIcon({
  className: "gm-gps-icon",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div class="gm-gps-dot"></div>`,
});

/* ------------------------------------------------------------ geometry */

function nodeLatLng(n?: Node | null): LatLng | null {
  return n && typeof n.lat === "number" && typeof n.lng === "number" ? [n.lat, n.lng] : null;
}

function buildingRing(b: Building): LatLng[] {
  const fp = (b as Building & { footprint?: { lat: number; lng: number }[] }).footprint ?? [];
  return fp.map((p) => [p.lat, p.lng]);
}

function metresBetween(a: LatLng, b: LatLng) {
  const r = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const la = (a[0] * Math.PI) / 180;
  const lb = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

/** Point `t` metres along a polyline. */
function pointAlong(line: LatLng[], cum: number[], t: number): LatLng {
  const total = cum[cum.length - 1];
  const d = Math.max(0, Math.min(total, t));
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1] || 1;
  const k = (d - cum[i - 1]) / seg;
  const a = line[i - 1];
  const b = line[i];
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

/* ------------------------------------------------------- map behaviour */

/** Frames the route when there is one, the whole campus otherwise. */
function FitView({ bounds, routeKey }: { bounds: L.LatLngBounds | null; routeKey: string }) {
  const map = useMap();
  useEffect(() => {
    if (!bounds || !bounds.isValid()) return;
    const fit = () => {
      // The map mounts before the page layout settles; measure again first.
      map.invalidateSize();
      const mobile = map.getContainer().clientWidth < 768;
      map.fitBounds(bounds, {
        // The planner sheet covers the bottom of the screen on phones.
        paddingTopLeft: [30, mobile ? 70 : 40],
        paddingBottomRight: [30, mobile ? 240 : 40],
        maxZoom: 19,
        animate: true,
      });
    };
    fit();
    const t = setTimeout(fit, 350);
    return () => clearTimeout(t);
  }, [map, bounds, routeKey]);
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => onZoom(map.getZoom()), [map, onZoom]);
  return null;
}

/** Walking person that loops along the route at an easy walking pace. */
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
    // Real walking pace would take minutes; ~60 m/s previews the route in seconds.
    const speed = Math.max(30, total / 12);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (((now - start) / 1000) * speed) % (total + speed); // brief pause at the end
      setPos(pointAlong(line, cum, t));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [line, cum]);
  const icon = useMemo(() => walkerIcon(true), []);
  if (!pos) return null;
  return <Marker position={pos} icon={icon} zIndexOffset={900} interactive={false} />;
}

/* ------------------------------------------------------------ component */

export function GoogleCampusMap({
  route,
  alternativeRoute,
  onSelectAlternativeRoute,
  livePosition,
  gps,
  onNavigateToDest,
  fromSelected,
  toSelected,
}: Props) {
  const [data, setData] = useState(() => campusStore.getPublishedData());
  const [zoom, setZoom] = useState(17);
  const [map, setMap] = useState<L.Map | null>(null);
  const [locating, setLocating] = useState(false);

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
        .map((b) => ({ b, ring: buildingRing(b) }))
        .filter((x) => x.ring.length >= 3),
    [data.buildings]
  );

  // Grounds, courts and ponds are part of the campus but not blocks to enter.
  const isSite = (b: Building) => b.id.startsWith("s-") || /pond/i.test(b.id);

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

  const boundary = useMemo(
    () => ((data.boundary || []) as { lat: number; lng: number }[]).map((p) => [p.lat, p.lng] as LatLng),
    [data.boundary]
  );

  const routeLine = useMemo(
    () => (route?.nodes || []).map(nodeLatLng).filter(Boolean) as LatLng[],
    [route]
  );
  const altLine = useMemo(
    () => (alternativeRoute?.nodes || []).map(nodeLatLng).filter(Boolean) as LatLng[],
    [alternativeRoute]
  );

  const destNode = useMemo(() => {
    const id = toSelected?.nodeId ?? toSelected?.id;
    return (id && nodeById.get(id)) || route?.nodes[route.nodes.length - 1] || null;
  }, [toSelected, nodeById, route]);
  const startNode = useMemo(() => {
    const id = fromSelected?.nodeId ?? fromSelected?.id;
    return (id && nodeById.get(id)) || route?.nodes[0] || null;
  }, [fromSelected, nodeById, route]);

  const gpsPos: LatLng | null =
    gps?.isGpsActive && typeof gps.lat === "number" && typeof gps.lng === "number" ? [gps.lat, gps.lng] : null;

  const campusBounds = useMemo(() => {
    const pts = boundary.length ? boundary : buildings.flatMap((x) => x.ring);
    return pts.length ? L.latLngBounds(pts) : null;
  }, [boundary, buildings]);

  const viewBounds = useMemo(
    () => (routeLine.length >= 2 ? L.latLngBounds(routeLine) : campusBounds),
    [routeLine, campusBounds]
  );
  const routeKey = route?.id ?? "campus";

  const centre: LatLng = campusBounds ? [campusBounds.getCenter().lat, campusBounds.getCenter().lng] : [11.4965, 77.2774];
  const showLabels = zoom >= LABEL_MIN_ZOOM;

  function directionsTo(b: Building) {
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
  }

  const walkerStill = useMemo(() => walkerIcon(false), []);
  const livePos = nodeLatLng(livePosition);

  return (
    <div className="gm-root relative h-full w-full">
      <MapContainer
        center={centre}
        zoom={17}
        minZoom={15}
        maxZoom={21}
        zoomControl={false}
        attributionControl={false}
        className="h-full w-full"
        ref={setMap}
        preferCanvas={false}
      >
        <ZoomWatcher onZoom={setZoom} />
        <FitView bounds={viewBounds} routeKey={routeKey} />

        {/* Campus ground: the boundary filled, as Google marks a campus. */}
        {boundary.length >= 3 && (
          <Polygon
            positions={boundary}
            interactive={false}
            pathOptions={{
              color: "#b9cdb2",
              weight: 1.5,
              opacity: 1,
              // The 3D view's ground, flattened: a Google-style campus green.
              fillColor: "#e4efdd",
              fillOpacity: 1,
            }}
          />
        )}

        {/* Path network: roads as white carriageways with a grey casing,
            footpaths as narrower lighter lines, both scaled with zoom. */}
        {paths.map((p) => (
          <Polyline
            key={`${p.id}-casing`}
            positions={p.line}
            interactive={false}
            pathOptions={{ color: "#c7ccd3", weight: p.road ? zoomWidth(zoom, 7) + 2 : zoomWidth(zoom, 3.5) + 2, lineCap: "round", lineJoin: "round" }}
          />
        ))}
        {paths.map((p) => (
          <Polyline
            key={p.id}
            positions={p.line}
            interactive={false}
            pathOptions={{ color: p.road ? "#ffffff" : "#fbfcfd", weight: p.road ? zoomWidth(zoom, 7) : zoomWidth(zoom, 3.5), lineCap: "round", lineJoin: "round" }}
          />
        ))}

        {/* Buildings: Google-grey blocks with the name inside once legible. */}
        {buildings.map(({ b, ring }) => {
          const site = isSite(b);
          const isDest = toSelected?.buildingId === b.id || destNode?.id === `${b.id}-ent`;
          const label = showLabels ? fittingLabel(b, ring, zoom) : null;
          return (
            <Polygon
              key={b.id}
              positions={ring}
              eventHandlers={{ click: () => directionsTo(b) }}
              pathOptions={{
                color: isDest ? "#d93025" : site ? "#a8c69f" : "#cfd3d8",
                weight: isDest ? 2.5 : 1.2,
                fillColor: isDest ? "#fde2df" : site ? "#c8e3bf" : "#eceef1",
                fillOpacity: 1,
              }}
            >
              {label ? (
                <Tooltip key={`l-${label}`} permanent direction="center" className="gm-label" interactive={false}>
                  {label}
                </Tooltip>
              ) : (
                <Tooltip key="hover" direction="top" className="gm-hover" sticky>
                  {b.name}
                </Tooltip>
              )}
            </Polygon>
          );
        })}

        {/* Alternative route: grey, tap to switch, as in Google Maps. */}
        {altLine.length >= 2 && (
          <>
            <Polyline positions={altLine} pathOptions={{ color: "#8f9aa7", weight: 9, opacity: 0.9, lineCap: "round", lineJoin: "round" }} eventHandlers={{ click: () => onSelectAlternativeRoute?.() }} />
            <Polyline positions={altLine} pathOptions={{ color: "#bcc5cf", weight: 6, opacity: 1, lineCap: "round", lineJoin: "round" }} eventHandlers={{ click: () => onSelectAlternativeRoute?.() }} />
          </>
        )}

        {/* Active route: Google blue with a darker casing. */}
        {routeLine.length >= 2 && (
          <>
            <Polyline positions={routeLine} interactive={false} pathOptions={{ color: "#1967d2", weight: 11, opacity: 1, lineCap: "round", lineJoin: "round" }} />
            <Polyline positions={routeLine} interactive={false} pathOptions={{ color: "#4285f4", weight: 7, opacity: 1, lineCap: "round", lineJoin: "round" }} />
            <RouteWalker line={routeLine} />
          </>
        )}

        {/* Start: a walking person where the journey begins. */}
        {nodeLatLng(startNode) && (
          <Marker position={nodeLatLng(startNode)!} icon={walkerStill} zIndexOffset={800}>
            <Tooltip direction="top" offset={[0, -16]} className="gm-hover">
              Start: {fromSelected?.name ?? startNode?.name ?? "Start"}
            </Tooltip>
          </Marker>
        )}

        {/* Destination: the red pin. */}
        {nodeLatLng(destNode) && (
          <Marker position={nodeLatLng(destNode)!} icon={DEST_PIN} zIndexOffset={1000}>
            <Tooltip direction="top" offset={[0, -40]} className="gm-hover">
              {toSelected?.name ?? destNode?.name ?? "Destination"}
            </Tooltip>
          </Marker>
        )}

        {/* Live navigation position, when the shell is tracking one. */}
        {livePos && <Marker position={livePos} icon={walkerIcon(true)} zIndexOffset={1100} interactive={false} />}

        {/* The visitor's own GPS: blue dot with accuracy halo. */}
        {gpsPos && (
          <>
            <Circle center={gpsPos} radius={Math.min(gps?.accuracy || 15, 80)} interactive={false} pathOptions={{ color: "#4285f4", weight: 1, fillColor: "#4285f4", fillOpacity: 0.12 }} />
            <Marker position={gpsPos} icon={GPS_DOT} zIndexOffset={1200} interactive={false} />
          </>
        )}
      </MapContainer>

      {/* Google-style controls, bottom-right. */}
      <div className="pointer-events-none absolute bottom-[200px] right-3 z-[1000] flex flex-col gap-2 md:bottom-8">
        <button
          type="button"
          className="gm-ctrl pointer-events-auto"
          title="Show my location"
          onClick={() => {
            if (gpsPos) map?.flyTo(gpsPos, 19);
            else {
              setLocating(true);
              map?.locate({ setView: true, maxZoom: 19 });
              map?.once("locationfound locationerror", () => setLocating(false));
            }
          }}
        >
          <LocateFixed className={`h-5 w-5 ${gpsPos ? "text-[#1a73e8]" : ""} ${locating ? "animate-pulse" : ""}`} />
        </button>
        <button
          type="button"
          className="gm-ctrl pointer-events-auto"
          title={routeLine.length ? "Show whole route" : "Show whole campus"}
          onClick={() => viewBounds && map?.fitBounds(viewBounds, { padding: [40, 40], maxZoom: 19 })}
        >
          <Maximize className="h-5 w-5" />
        </button>
        <div className="gm-ctrl pointer-events-auto flex !h-auto flex-col !p-0">
          <button type="button" className="flex h-10 w-10 items-center justify-center" title="Zoom in" onClick={() => map?.zoomIn()}>
            <Plus className="h-5 w-5" />
          </button>
          <span className="mx-2 h-px bg-black/10" />
          <button type="button" className="flex h-10 w-10 items-center justify-center" title="Zoom out" onClick={() => map?.zoomOut()}>
            <Minus className="h-5 w-5" />
          </button>
        </div>
      </div>

      <style>{MAP_CSS}</style>
    </div>
  );
}

/** Line widths in screen pixels that follow the map's scale, like Google's roads. */
function zoomWidth(zoom: number, metres: number) {
  // ~0.6 m/px at z18 near the equator; clamp so lines stay legible zoomed out.
  const metresPerPixel = 156543.03 * Math.cos((11.5 * Math.PI) / 180) / 2 ** zoom;
  return Math.max(2, Math.min(28, metres / metresPerPixel));
}

const MAP_CSS = `
.gm-root .leaflet-container { background: #f1f3f4; font-family: Roboto, "Google Sans", Arial, sans-serif; }
.gm-ctrl { height: 40px; min-width: 40px; display: flex; align-items: center; justify-content: center;
  background: #fff; color: #3c4043; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.3); transition: background .15s; }
.gm-ctrl:hover { background: #f8f9fa; }
.gm-label { background: transparent; border: 0; box-shadow: none; padding: 0; color: #5f6368;
  font-size: 11px; font-weight: 600; text-align: center; white-space: nowrap;
  text-shadow: 0 0 2px #fff, 0 0 2px #fff, 0 0 3px #fff; pointer-events: none; }
.gm-label::before { display: none; }
.gm-hover { font-size: 12px; font-weight: 500; color: #202124; border-radius: 6px; box-shadow: 0 1px 4px rgba(0,0,0,.25); border: 0; }
.gm-walker-icon, .gm-pin-icon, .gm-gps-icon { background: transparent; border: 0; }
.gm-walker { width: 34px; height: 34px; border-radius: 50%; background: #1a73e8; border: 3px solid #fff;
  box-shadow: 0 2px 6px rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; }
.gm-walker--moving svg { animation: gm-step .5s ease-in-out infinite alternate; transform-origin: 50% 90%; }
@keyframes gm-step { from { transform: translateY(0) rotate(-6deg); } to { transform: translateY(-1.5px) rotate(6deg); } }
.gm-gps-dot { width: 22px; height: 22px; border-radius: 50%; background: #4285f4; border: 3px solid #fff;
  box-shadow: 0 0 0 6px rgba(66,133,244,.25), 0 1px 4px rgba(0,0,0,.3); }
.gm-pin-icon svg { filter: drop-shadow(0 2px 2px rgba(0,0,0,.35)); }
`;
