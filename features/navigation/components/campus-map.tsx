"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import { campusStore } from "@/shared/lib/campus-store";
import type { Node, Building, Floor, Edge, Destination } from "@/shared/data/campus";
import type { Route } from "@/features/navigation/services/graph";
import { getObstructedEdgeIds } from "@/lib/routing/graph";
import { Building2, Layers, Compass, Locate, AlertTriangle, ZoomIn, ZoomOut, Maximize2, Minimize2, ChevronDown, Navigation, Tag, CircleDot, EyeOff, RotateCcw, RotateCw, Map as MapIcon, Satellite, View } from "lucide-react";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { PIXELS_PER_METER, gpsToCanvas } from "@/lib/geo/projection";
import { DEFAULT_TILE_ATTRIBUTION, getTilesForCanvasRect } from "@/lib/geo/tiles";
import { getBuildingCanvasPoints, getBuildingCenter, getPolygonSvgPath, isPointInsideBuilding, isPointOutsideAllBuildings } from "@/lib/geo/building-geometry";
import { detectBuildingAtGps } from "@/lib/geo/containment";
import { calculateShortestAngleDelta } from "@/lib/geo/haversine";
import { DestinationDetailsDrawer } from "./destination-details-drawer";
import { PanoramaViewer } from "./panorama-viewer";
import { TOUR_SCENES, findTourScene, type TourScene } from "@/shared/data/campus-tour";
import { useNavigationStore } from "@/features/navigation/navigation-store";
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM, DESKTOP_DEFAULT_ZOOM, computeDesktopWheelMultiplier, cleanStairLiftDisplayName } from "@/shared/lib/map-config";

export type NodeDisplayMode = "ALL" | "CIRCLES_ONLY" | "HIDDEN";

/** Human-readable category for a node type, used by the detail sheet. */
function nodeCategoryLabel(type?: string) {
  switch (type) {
    case "GATE":
      return "Gate / Entrance";
    case "BUILDING_ENTRANCE":
    case "ROOM_ENTRANCE":
      return "Entrance";
    case "RECEPTION":
      return "Reception";
    case "LABORATORY":
      return "Laboratory";
    case "OFFICE":
      return "Office";
    case "ROOM":
      return "Room";
    case "WASHROOM":
      return "Washroom";
    case "PARKING":
      return "Parking";
    case "FACILITY":
      return "Facility";
    default:
      return "Campus location";
  }
}

/** Carriageway width in metres, drawn to the same metric scale as the plan. */
const ROAD_WIDTH_M = 7;
const ROAD_WIDTH_PX = ROAD_WIDTH_M * PIXELS_PER_METER;
/** Paved footpath width in metres. */
const PATH_WIDTH_M = 2;
const PATH_WIDTH_PX = PATH_WIDTH_M * PIXELS_PER_METER;

/** Typical storey height in metres, used to give each block a real extrusion depth. */
const METRES_PER_STOREY = 3.5;
/**
 * Vertical exaggeration, as terrain and 3D map renderers use. A true-to-scale
 * 3-storey block is only about a fifth as tall as it is wide, which reads as
 * flat from above; drawing it taller makes the massing legible.
 */
const HEIGHT_EXAGGERATION = 3.5;

/**
 * Plan view is flat, so a single fill makes 48 blocks read as one mass. Opacity
 * over the darker ground stands in for height: taller blocks sit lighter. Hue is
 * deliberately not used — that would be decoration rather than information.
 */
/** Rough advance width of Inter/system-sans at weight 600, in ems per character. */
const CHAR_EM = 0.55;

/**
 * Lay a block name out inside its own footprint, the way the campus is labelled
 * on a paper plan. Wraps onto at most three lines and picks the largest size
 * that fits both the width and the height; returns null when the block is too
 * small on screen to carry its name legibly, so the map declutters itself.
 */
function fitLabel(
  name: string,
  boxW: number,
  boxH: number
): { lines: string[]; fontSize: number; lineHeight: number } | null {
  if (!name || boxW <= 0 || boxH <= 0) return null;
  const innerW = boxW * 0.88;
  const innerH = boxH * 0.82;
  const words = name.split(/\s+/).filter(Boolean);
  if (!words.length) return null;

  let best: { lines: string[]; fontSize: number; lineHeight: number } | null = null;

  for (let maxLines = 1; maxLines <= 3; maxLines++) {
    // Greedy wrap into exactly `maxLines` buckets, balancing by character count.
    const target = Math.ceil(name.length / maxLines);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      if (!cur) cur = w;
      else if (cur.length + 1 + w.length <= target || lines.length === maxLines - 1) cur += " " + w;
      else { lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) continue;

    const longest = Math.max(...lines.map((l) => l.length));
    const byWidth = innerW / (longest * CHAR_EM);
    const byHeight = innerH / (lines.length * 1.18);
    const fontSize = Math.min(byWidth, byHeight);
    if (!best || fontSize > best.fontSize) {
      best = { lines, fontSize, lineHeight: fontSize * 1.18 };
    }
  }

  // Below this the name is unreadable and just adds noise.
  if (!best || best.fontSize < 3.4) return null;
  best.fontSize = Math.min(best.fontSize, 26);
  best.lineHeight = best.fontSize * 1.18;
  return best;
}

function planFillOpacity(storeys: number): number {
  const clamped = Math.min(5, Math.max(1, storeys || 1));
  return 0.72 + (clamped - 1) * 0.07;
}
/** Direction the extrusion leans, so every block shares one light/camera setup. */
const EXTRUSION_VECTOR = { x: -0.34, y: -0.86 };

/**
 * Height in canvas units for one building. Uses an explicit height in metres when
 * the record carries one, otherwise the building's real storey count.
 */
export function getBuildingExtrusionHeight(building: {
  heightMeters?: number;
  floorsCount?: number;
}, storeysFromFloors?: number) {
  if (typeof building.heightMeters === "number" && building.heightMeters > 0) {
    return building.heightMeters * PIXELS_PER_METER * HEIGHT_EXAGGERATION;
  }
  const storeys = Math.max(1, storeysFromFloors ?? building.floorsCount ?? 1);
  return storeys * METRES_PER_STOREY * PIXELS_PER_METER * HEIGHT_EXAGGERATION;
}

/** Roof polygon: the footprint lifted along the shared extrusion vector. */
function getExtrudedRoofPoints(pts: { x: number; y: number }[], height: number) {
  return pts.map((p) => ({
    x: p.x + EXTRUSION_VECTOR.x * height,
    y: p.y + EXTRUSION_VECTOR.y * height,
  }));
}

/**
 * Wall quads between footprint and roof. Only faces pointing towards the camera
 * are returned, so the far side of a block never paints over its own roof.
 */
function getWallFacets(
  basePts: { x: number; y: number }[],
  roofPts: { x: number; y: number }[],
  storeys = 1
) {
  const n = basePts.length;
  const facets: { path: string; bands: string[]; shade: number; depth: number }[] = [];
  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    const p1 = basePts[i];
    const p2 = basePts[nextIdx];
    const r1 = roofPts[i];
    const r2 = roofPts[nextIdx];

    // Outward normal of this edge; skip walls facing away from the viewer.
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const len = Math.hypot(ex, ey) || 1;
    const nx = ey / len;
    const ny = -ex / len;
    const facing = nx * EXTRUSION_VECTOR.x + ny * EXTRUSION_VECTOR.y;
    if (facing >= 0) continue;

    // Only walls facing the camera survive culling, so the key light has to sit
    // on the viewer's side; pointing it along the extrusion left every visible
    // face at zero and the whole block rendered flat.
    const lightX = 0.62;
    const lightY = 0.78;
    const lambert = Math.max(0, nx * lightX + ny * lightY);
    // One line per storey across this face, so the wall reads as floors.
    const bands: string[] = [];
    for (let level = 1; level < storeys; level++) {
      const t = level / storeys;
      bands.push(
        `M ${p1.x + (r1.x - p1.x) * t} ${p1.y + (r1.y - p1.y) * t} ` +
          `L ${p2.x + (r2.x - p2.x) * t} ${p2.y + (r2.y - p2.y) * t}`
      );
    }

    facets.push({
      path: `M ${p1.x} ${p1.y} L ${p2.x} ${p2.y} L ${r2.x} ${r2.y} L ${r1.x} ${r1.y} Z`,
      bands,
      shade: 0.3 + lambert * 0.7,
      depth: (p1.y + p2.y) / 2,
    });
  }
  return facets.sort((a, b) => a.depth - b.depth);
}

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

export function CampusMap({
  route,
  alternativeRoute,
  onSelectAlternativeRoute,
  livePosition,
  progress,
  gps: passedGps,
  onNavigateToDest,
  fromSelected,
  toSelected,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [publishedData, setPublishedData] = useState(() => campusStore.getPublishedData());
  const [view, setView] = useState<string>("f-out");
  const [selectedDestForDetails, setSelectedDestForDetails] = useState<Destination | null>(null);
  // Active navigation session state
  const navStatus = useNavigationStore((s) => s.status);
  const isNavigating = navStatus === "NAVIGATING" || navStatus === "OFF_ROUTE" || navStatus === "REROUTING";

  // Floor selector hide/unhide state
  const [isFloorMenuOpen, setIsFloorMenuOpen] = useState(false);

  // Map Zoom, Bearing & Pan state passed down to MapCanvas
  const [zoomLevel, setZoomLevel] = useState(1);
  const [bearing, setBearing] = useState(0); // 0 = True North Up
  const [tiltDegrees, setTiltDegrees] = useState(0); // 0 = plan view, higher = oblique "3D" camera
  const [showSatellite, setShowSatellite] = useState(false);
  const [panoramaScene, setPanoramaScene] = useState<TourScene | null>(null);
  const [resetTrigger, setResetTrigger] = useState(0);
  const [isFollowingUser, setIsFollowingUser] = useState(true);

  // User Layer Toggle for Obstacles & Object/Node Names / Circles
  const [showObstacles, setShowObstacles] = useState(true);
  const [nodeDisplayMode, setNodeDisplayMode] = useState<NodeDisplayMode>(isNavigating ? "HIDDEN" : "ALL");

  const cycleNodeDisplayMode = useCallback(() => {
    setNodeDisplayMode((prev) => {
      if (prev === "ALL") return "CIRCLES_ONLY";
      if (prev === "CIRCLES_ONLY") return "HIDDEN";
      return "ALL";
    });
  }, []);

  // Avoid duplicate geolocation watcher by instantiating hook only when passedGps is missing
  const internalGps = useVisitorGps(undefined, { autoStart: !passedGps });
  const gps = passedGps ?? internalGps;

  useEffect(() => {
    setMounted(true);
    let isCancelled = false;
    setPublishedData(campusStore.getPublishedData());

    campusStore.fetchPublishedData().then((freshData) => {
      if (!isCancelled && freshData) {
        setPublishedData(freshData);
      }
    });

    const unsub = campusStore.subscribe(() => {
      if (!isCancelled) {
        setPublishedData(campusStore.getPublishedData());
      }
    });

    return () => {
      isCancelled = true;
      unsub();
    };
  }, []);

  const navFloorId = useNavigationStore((s) => s.currentFloorId);
  const activeNavRoute = useNavigationStore((s) => s.activeRoute);
  const currentNavSegIdx = useNavigationStore((s) => s.currentSegmentIndex);

  // Auto-select starting floor on launch & auto-switch when route advances to a different floor
  const prevNavFloorRef = useRef<string | null>(null);
  const prevNavSegIdxRef = useRef<number | null>(null);
  const prevNavStatusRef = useRef(navStatus);

  useEffect(() => {
    const isNowNavigating = navStatus === "NAVIGATING" || navStatus === "OFF_ROUTE" || navStatus === "REROUTING" || isNavigating;
    const wasNavigating = prevNavStatusRef.current === "NAVIGATING" || prevNavStatusRef.current === "OFF_ROUTE" || prevNavStatusRef.current === "REROUTING";

    if (isNowNavigating && (!wasNavigating || !isNavigating)) {
      // Auto-hide all object and node names & background circles instantly when navigation starts
      setNodeDisplayMode("HIDDEN");
    }

    if (isNowNavigating) {
      // Find the active floor from navigation store, current route segment, or live position
      const activeFloor =
        (navFloorId && navFloorId !== "outdoor")
          ? navFloorId
          : (activeNavRoute?.nodes[currentNavSegIdx]?.floorId && activeNavRoute.nodes[currentNavSegIdx].floorId !== "outdoor")
          ? activeNavRoute.nodes[currentNavSegIdx].floorId
          : (fromSelected?.floorId && fromSelected.floorId !== "outdoor")
          ? fromSelected.floorId
          : (route?.nodes[0]?.floorId && route.nodes[0].floorId !== "outdoor")
          ? route.nodes[0].floorId
          : (gps.canvasPos?.floorId && gps.canvasPos.floorId !== "outdoor")
          ? gps.canvasPos.floorId
          : "f-out";

      // Only auto-switch floor when navigation first begins, or when navigation actually advances to a new floor/segment
      const navJustStarted = !wasNavigating;
      const navFloorChanged = prevNavFloorRef.current !== activeFloor;
      const navSegChanged = prevNavSegIdxRef.current !== currentNavSegIdx;

      if (activeFloor && (navJustStarted || navFloorChanged || navSegChanged)) {
        setView(activeFloor);
        prevNavFloorRef.current = activeFloor;
        prevNavSegIdxRef.current = currentNavSegIdx;
      }
    } else {
      prevNavFloorRef.current = null;
      prevNavSegIdxRef.current = null;
    }
    prevNavStatusRef.current = navStatus;
  }, [navStatus, isNavigating, navFloorId, activeNavRoute, currentNavSegIdx, fromSelected?.floorId, route, gps.canvasPos?.floorId]);

  // Contextual Floor Filter
  const indoorFloors = useMemo(() => {
    const allFloors = publishedData.floors || [];
    const allBuildings = publishedData.buildings || [];
    const allNodes = publishedData.nodes || [];

    const getBuildingIdForNode = (node: Node | null | undefined): string | null => {
      if (!node) return null;
      if (node.floorId && node.floorId !== "f-out" && node.floorId !== "outdoor") {
        const fl = allFloors.find((f) => f.id === node.floorId);
        if (fl?.buildingId) return fl.buildingId;
      }
      const bld = allBuildings.find((b) => isPointInsideBuilding(node.x, node.y, b));
      return bld?.id || null;
    };

    const getBuildingIdForDest = (dest: Destination | null | undefined): string | null => {
      if (!dest) return null;
      if (dest.id === "dest-live-user-location") {
        if (gps.isGpsActive && gps.lat && gps.lng) {
          const containment = detectBuildingAtGps(gps.lat, gps.lng, gps.accuracy || 10, allBuildings);
          if (containment.isInside && containment.building) return containment.building.id;
          const canvasPos = gps.canvasPos || gpsToCanvas(gps.lat, gps.lng);
          const bld = allBuildings.find((b) => isPointInsideBuilding(canvasPos.x, canvasPos.y, b));
          if (bld) return bld.id;
        }
        if (livePosition) {
          return getBuildingIdForNode(livePosition);
        }
        return null;
      }
      if (dest.buildingId) return dest.buildingId;
      if (dest.floorId && dest.floorId !== "f-out" && dest.floorId !== "outdoor") {
        const fl = allFloors.find((f) => f.id === dest.floorId);
        if (fl?.buildingId) return fl.buildingId;
      }
      if (dest.nodeId) {
        const node = allNodes.find((n) => n.id === dest.nodeId);
        if (node) {
          return getBuildingIdForNode(node);
        }
      }
      return null;
    };

    const targetBuildingIds = new Set<string>();

    if (fromSelected || toSelected || (route && route.nodes.length > 0)) {
      const fromBldId = getBuildingIdForDest(fromSelected);
      const toBldId = getBuildingIdForDest(toSelected);
      if (fromBldId) targetBuildingIds.add(fromBldId);
      if (toBldId) targetBuildingIds.add(toBldId);

      if (route && route.nodes.length > 0) {
        route.nodes.forEach((n) => {
          const bId = getBuildingIdForNode(n);
          if (bId) targetBuildingIds.add(bId);
        });
      }
    }

    if (gps.isGpsActive && gps.lat && gps.lng) {
      const containment = detectBuildingAtGps(gps.lat, gps.lng, gps.accuracy || 10, allBuildings);
      if (containment.isInside && containment.building) {
        targetBuildingIds.add(containment.building.id);
      }
    }

    if (livePosition) {
      const bldId = getBuildingIdForNode(livePosition);
      if (bldId) targetBuildingIds.add(bldId);
    }

    // If specific target buildings are identified in the route or location, show those floors
    if (targetBuildingIds.size > 0) {
      const targetFloors = allFloors
        .filter((f) => targetBuildingIds.has(f.buildingId))
        .sort((a, b) => a.ordinal - b.ordinal)
        .map((f) => f.id);
      if (targetFloors.length > 0) return targetFloors;
    }

    // Default fallback: Always return all available campus floors
    return allFloors
      .sort((a, b) => a.ordinal - b.ordinal)
      .map((f) => f.id);
  }, [publishedData, fromSelected, toSelected, route, livePosition, gps.isGpsActive, gps.lat, gps.lng]);

  const validFloorIds = useMemo(() => {
    const ids = new Set(["f-out", ...indoorFloors]);
    return ids;
  }, [indoorFloors]);

  const activeView = validFloorIds.has(view) ? view : "f-out";

  // Helper to resolve building for a floor with geometry / node containment & alias fallback
  const getBuildingForFloor = useCallback((f: Floor | undefined): Building | undefined => {
    if (!f) return undefined;
    if (f.buildingId) {
      const b = publishedData.buildings.find((x) => x.id === f.buildingId);
      if (b) return b;
    }
    // Try geometry / nodes detection: find nodes on this floor and check containment
    const floorNodes = (publishedData.nodes || []).filter((n) => n.floorId === f.id);
    for (const n of floorNodes) {
      const b = publishedData.buildings.find((bld) => isPointInsideBuilding(n.x, n.y, bld));
      if (b) return b;
    }
    // Try matching building shortCode or name in floor name / floor ID (e.g. "sf-floor-1", "RP Ground")
    const fLower = `${f.name || ""} ${f.id || ""}`.toLowerCase();
    for (const b of publishedData.buildings) {
      if (b.shortCode && fLower.includes(b.shortCode.toLowerCase())) return b;
      if (b.name && fLower.includes(b.name.toLowerCase())) return b;
    }
    return undefined;
  }, [publishedData.buildings, publishedData.nodes]);

  const resolveCleanBuildingCode = useCallback((b: Building | undefined, nameFallback = ""): string => {
    if (!b && !nameFallback) return "";
    const name = ((b?.name || nameFallback) || "").trim();
    const rawCode = (b?.shortCode || "").trim().toUpperCase();

    // If shortCode is already a valid custom code other than "BLD", use it
    if (rawCode && rawCode !== "BLD") {
      return rawCode;
    }

    // Derive intelligent acronym from building name
    const nameUpper = name.toUpperCase();
    if (nameUpper.includes("SCIENCE") || nameUpper.includes("FACULTY") || nameUpper === "SF") return "SF";
    if (nameUpper.includes("RADHAKRISHNAN") || nameUpper.includes("RP") || nameUpper === "RP BLOCK") return "RP";
    if (nameUpper.includes("MECHANICAL") || nameUpper.includes("MECH")) return "MECH";
    if (nameUpper.includes("PEARL")) return "PEARL";

    // General acronym extractor (e.g. "Civil Block" -> "CIVIL", "Main Building" -> "MB")
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const acronym = words.map((w) => w[0]).join("").toUpperCase();
      if (acronym !== "BLD") return acronym;
    }
    if (name.length <= 5 && name.toUpperCase() !== "BLD") return name.toUpperCase();
    const cleanFirst = name.split(/\s+/)[0].replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return cleanFirst !== "BLD" && cleanFirst.length > 0 ? cleanFirst.slice(0, 5) : (name || "Campus");
  }, []);

  const cleanFloorName = (name: string | undefined | null): string => {
    if (!name) return "Floor";
    return name
      .replace(/Level\s*[-–]?\s*1\s*[-–:\s]*Basement/gi, "Basement")
      .replace(/Level\s*[-–]\s*1\s*[-–:\s]*Basement/gi, "Basement")
      .replace(/Level\s*[-–]\s*1\b/gi, "Basement")
      .replace(/\s+/g, " ")
      .trim();
  };

  const getFloorButtonLabel = useCallback((f: Floor | undefined): string => {
    if (!f) return "Floor";
    const b = getBuildingForFloor(f);
    const bCode = resolveCleanBuildingCode(b, f.buildingId);
    const rawFloorName = cleanFloorName(f.name);
    return bCode ? `${bCode} - ${rawFloorName}` : rawFloorName;
  }, [getBuildingForFloor, resolveCleanBuildingCode]);

  const activeFloorLabel = useMemo(() => {
    if (activeView === "f-out") return "Outdoor";
    const f = publishedData.floors.find((x) => x.id === activeView);
    return getFloorButtonLabel(f);
  }, [activeView, publishedData.floors, getFloorButtonLabel]);

  const allBuildings = publishedData.buildings;
  const allFloors = publishedData.floors;

  // Smooth North-Up / Bearing Reset
  const resetBearingToNorth = useCallback(() => {
    setBearing(0);
  }, []);

  const rotateMapBy = useCallback((deltaDegrees: number) => {
    setIsFollowingUser(false);
    setBearing((prev) => {
      let next = (prev + deltaDegrees + 360) % 360;
      if (Math.abs(next) < 2.5 || Math.abs(next - 360) < 2.5) {
        next = 0;
      }
      return next;
    });
  }, []);

  // Smooth North-Up Reset when Navigation Session Ends/Exits
  const prevNavigatingRef = useRef(isNavigating);
  useEffect(() => {
    if (prevNavigatingRef.current && !isNavigating) {
      resetBearingToNorth();
    }
    prevNavigatingRef.current = isNavigating;
  }, [isNavigating, resetBearingToNorth]);

  // Manual-Only Follow Mode State (No Auto-Recenter Timer)
  const handleUserPan = useCallback(() => {
    setIsFollowingUser(false);
  }, []);

  // Fullscreen Toggle
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        const elem = mapContainerRef.current || document.documentElement;
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if ((elem as any).webkitRequestFullscreen) {
          await (elem as any).webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
      }
    } catch (err) {
      console.warn("Fullscreen toggle error:", err);
    }
  }, []);

  // Re-center Location Action (Only on explicit click)
  const handleRecenter = useCallback(() => {
    if (gps && !gps.isTracking) {
      gps.startTracking();
    }
    useNavigationStore.getState().resetManualStepping();
    setIsFollowingUser(true);
    setBearing(0);
    setZoomLevel(1);
    setResetTrigger((t) => t + 1);
  }, [gps]);

  if (!mounted) {
    return (
      <div className="relative h-full w-full select-none overflow-hidden touch-none bg-[var(--map-bg)] flex items-center justify-center" suppressHydrationWarning>
        <div className="flex items-center gap-2 text-xs text-[rgb(var(--muted-fg))]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          <span>Loading map…</span>
        </div>
      </div>
    );
  }

  return (
    <div ref={mapContainerRef} className="relative h-full w-full select-none overflow-hidden touch-none" suppressHydrationWarning>
      {(publishedData.buildings ?? []).length === 0 && (publishedData.nodes ?? []).length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-6">
          <div className="pointer-events-auto max-w-sm rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))]/95 px-6 py-7 text-center shadow-[var(--shadow-lg)] backdrop-blur-md">
            <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--muted))]">
              <MapIcon className="h-5 w-5 text-[rgb(var(--muted-fg))]" />
            </div>
            <h3 className="text-base font-semibold tracking-tight">No map published yet</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[rgb(var(--muted-fg))]">
              Build the campus in the admin panel — add buildings, floors and paths — then choose
              Publish to make it available here.
            </p>
            <Link
              href="/admin"
              className="mt-4 inline-flex h-8 items-center gap-1.5 rounded-md gradient-primary px-3 text-xs font-medium text-white shadow-[var(--shadow-sm)] transition-all hover:brightness-110"
            >
              Open admin panel
            </Link>
          </div>
        </div>
      )}
      <MapCanvas
        floorId={activeView === "f-out" ? "f-out" : activeView}
        route={route}
        alternativeRoute={alternativeRoute}
        onSelectAlternativeRoute={onSelectAlternativeRoute}
        livePosition={livePosition}
        progress={progress}
        publishedData={publishedData}
        gps={gps}
        bearing={bearing}
        onBearingChange={setBearing}
        tiltDegrees={tiltDegrees}
        showSatellite={showSatellite}
        showObstacles={showObstacles}
        nodeDisplayMode={nodeDisplayMode}
        externalZoom={zoomLevel}
        resetTrigger={resetTrigger}
        isFollowingUser={isFollowingUser}
        isNavigating={isNavigating}
        onUserPan={handleUserPan}
        onSelectDestination={(dest) => setSelectedDestForDetails(dest)}
        fromSelected={fromSelected}
        toSelected={toSelected}
      />

      {/* Top-Right Floor Selection Controls (Non-Colliding, Sleek Hide/Unhide) */}
      <div className={cn(
        "absolute right-3 z-30 pointer-events-auto flex flex-col items-end gap-1.5 transition-all duration-300",
        isNavigating ? "top-24 md:top-28" : "top-3"
      )}>
        {/* Sleek Hide/Unhide Floating Trigger Pill */}
        <button
          onClick={() => setIsFloorMenuOpen((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 rounded-2xl border px-3.5 py-2 text-xs font-bold shadow-lg backdrop-blur-md transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer",
            isFloorMenuOpen
              ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-500/30 ring-2 ring-indigo-400"
              : activeView !== "f-out"
              ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-500/20"
              : "bg-[rgb(var(--card))] text-[rgb(var(--fg))] hover:text-indigo-600 dark:hover:text-indigo-400 border-[rgb(var(--border))] shadow-md hover:bg-indigo-500/10"
          )}
          aria-label={isFloorMenuOpen ? "Hide Floor Stack" : "Show Floor Stack"}
        >
          <Layers className={cn("h-4 w-4 shrink-0", (isFloorMenuOpen || activeView !== "f-out") ? "text-white" : "text-indigo-600")} />
          <span className="max-w-[150px] truncate">{activeFloorLabel}</span>
          <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform duration-200", isFloorMenuOpen && "rotate-180")} />
        </button>

        {/* Expandable Floor Selector Dropdown Stack */}
        {isFloorMenuOpen && (
          <div className="flex flex-col gap-1 rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-2 shadow-2xl backdrop-blur-md max-h-[55vh] overflow-y-auto w-56 animate-in fade-in slide-in-from-top-2 duration-200">
            {/* Outdoor Button */}
            <FloorButton
              active={activeView === "f-out"}
              onClick={() => {
                setView("f-out");
                setIsFloorMenuOpen(false);
              }}
              icon={<Compass className={cn("h-4 w-4 shrink-0", activeView === "f-out" ? "text-emerald-300" : "text-emerald-600")} />}
              label="Campus Outdoor"
            />

            {indoorFloors.length > 0 && (
              <div className="my-1 border-t border-[rgb(var(--border))] px-2 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
                Indoor Floors
              </div>
            )}

            {indoorFloors.map((fid) => {
              const f = publishedData.floors.find((x) => x.id === fid);
              if (!f) return null;
              const b = getBuildingForFloor(f);
              const bCode = resolveCleanBuildingCode(b, f.buildingId);
              const floorDisplay = cleanFloorName(f.name);
              const cleanLabel = bCode ? `${bCode} - ${floorDisplay}` : floorDisplay;

              return (
                <FloorButton
                  key={fid}
                  active={activeView === fid}
                  onClick={() => {
                    setView(fid);
                    setIsFloorMenuOpen(false);
                  }}
                  icon={<Building2 className={cn("h-4 w-4 shrink-0", activeView === fid ? "text-indigo-200" : "text-indigo-600")} />}
                  label={cleanLabel}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Mid-Right Floating Map Tool Controls (Zoom, Fullscreen, Hazards, Node Labels, Compass) */}
      <div className={cn(
        "absolute right-3 z-20 pointer-events-auto flex flex-col items-end gap-2 transition-all duration-300",
        isNavigating ? "top-40 md:top-44" : "top-20"
      )}>
        {/* Reset Bearing Compass FAB (Sleek Smooth Reset) */}
        {Math.abs(bearing) > 0.5 && (
          <button
            onClick={resetBearingToNorth}
            className="flex h-11 w-11 items-center justify-center rounded-2xl border border-indigo-200/60 dark:border-indigo-800/60 bg-white/95 dark:bg-slate-900/95 shadow-lg backdrop-blur-md active:scale-95 transition-all text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer animate-in fade-in zoom-in duration-200"
            title="Reset Map to True North (0°)"
            aria-label="Compass - Reset to North"
          >
            <div
              className="relative flex items-center justify-center h-6 w-6 transition-transform duration-75"
              style={{ transform: `rotate(${-bearing}deg)` }}
            >
              <Compass className="h-6 w-6 text-indigo-600 dark:text-indigo-400 stroke-[2.25]" />
              <div className="absolute top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />
            </div>
          </button>
        )}

        {/* Zoom & Fullscreen Control Stack */}
        <div className="flex flex-col gap-1 rounded-2xl border bg-[rgb(var(--card))]/90 p-1 shadow-lg backdrop-blur-md w-fit">
          <button
            onClick={() => setZoomLevel((z) => Math.min(MAX_MAP_ZOOM, z * 1.25))}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
            title="Zoom In"
            aria-label="Zoom In"
          >
            <ZoomIn className="h-5 w-5 stroke-[2.25]" />
          </button>
          <button
            onClick={() => setZoomLevel((z) => Math.max(MIN_MAP_ZOOM, z * 0.8))}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
            title="Zoom Out"
            aria-label="Zoom Out"
          >
            <ZoomOut className="h-5 w-5 stroke-[2.25]" />
          </button>
          <div className="mx-1.5 border-t border-[rgb(var(--border))]/60" />
          <button
            onClick={toggleFullscreen}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
            title={isFullscreen ? "Exit Fullscreen Map" : "Fullscreen Map"}
            aria-label={isFullscreen ? "Exit Fullscreen" : "Fullscreen Map"}
          >
            {isFullscreen ? (
              <Minimize2 className="h-5 w-5 stroke-[2.25] text-indigo-600 dark:text-indigo-400" />
            ) : (
              <Maximize2 className="h-5 w-5 stroke-[2.25]" />
            )}
          </button>
        </div>

        {/* Satellite basemap + camera pitch */}
        <div className="flex flex-col gap-1 rounded-2xl border bg-[rgb(var(--card))]/90 p-1 shadow-lg backdrop-blur-md w-fit">
          <button
            onClick={() => setShowSatellite((prev) => !prev)}
            className={`flex h-11 w-11 items-center justify-center rounded-xl active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer ${
              showSatellite
                ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 shadow-xs"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
            }`}
            title={showSatellite ? "Satellite imagery on — click for the plain map" : "Show satellite imagery"}
            aria-label={`Satellite imagery ${showSatellite ? "on" : "off"}`}
            aria-pressed={showSatellite}
          >
            <Satellite className="h-5 w-5 stroke-[2.25]" />
          </button>
          <button
            onClick={() => setPanoramaScene(findTourScene("BIT Main Gate") ?? TOUR_SCENES[0])}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-[rgb(var(--muted-fg))] transition-all hover:bg-[rgb(var(--muted))] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer"
            title="Walk the campus in 360°"
            aria-label="Open 360 degree campus tour"
          >
            <View className="h-5 w-5 stroke-[2.25]" />
          </button>
        </div>

        <div className="flex flex-col gap-1 rounded-2xl border bg-[rgb(var(--card))]/90 p-1 shadow-lg backdrop-blur-md w-fit">
          <button
            onClick={() => setTiltDegrees((prev) => (prev >= 65 ? 0 : prev === 0 ? 45 : 65))}
            className={`flex h-11 w-11 items-center justify-center rounded-xl text-[11px] font-bold active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer ${
              tiltDegrees > 0
                ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 shadow-xs"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
            }`}
            title={tiltDegrees === 0 ? "Plan view — click to tilt the camera" : `Camera tilt ${tiltDegrees}° — click to change`}
            aria-label={`Camera tilt: ${tiltDegrees} degrees`}
          >
            {tiltDegrees === 0 ? "2D" : `${tiltDegrees}°`}
          </button>
        </div>

        {/* Layer Toggles Stack (3-State Node Display Mode: All -> Circles Only -> Hidden & Hazards) */}
        <div className="flex flex-col gap-1 rounded-2xl border bg-[rgb(var(--card))]/90 p-1 shadow-lg backdrop-blur-md w-fit">
          <button
            onClick={cycleNodeDisplayMode}
            className={`flex h-11 w-11 items-center justify-center rounded-xl text-[11px] font-semibold active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 cursor-pointer ${
              nodeDisplayMode === "ALL"
                ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 shadow-xs"
                : nodeDisplayMode === "CIRCLES_ONLY"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 shadow-xs"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
            }`}
            title={
              nodeDisplayMode === "ALL"
                ? "Showing: Circles & Names (Click for Circles Only)"
                : nodeDisplayMode === "CIRCLES_ONLY"
                ? "Showing: Circles Only (Click to Hide All)"
                : "Showing: Clean Map (Click to Show All)"
            }
            aria-label={`Node Display Mode: ${nodeDisplayMode}`}
          >
            {nodeDisplayMode === "ALL" ? (
              <Tag className="h-5 w-5 shrink-0 stroke-[2.25] text-indigo-500" />
            ) : nodeDisplayMode === "CIRCLES_ONLY" ? (
              <CircleDot className="h-5 w-5 shrink-0 stroke-[2.25] text-amber-500" />
            ) : (
              <EyeOff className="h-5 w-5 shrink-0 stroke-[2.25] opacity-40" />
            )}
          </button>
          <button
            onClick={() => setShowObstacles(!showObstacles)}
            className={`flex h-11 w-11 items-center justify-center rounded-xl text-[11px] font-semibold active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 cursor-pointer ${showObstacles
                ? "bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30 shadow-xs"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
              }`}
            title="Toggle Hazards & Obstacles"
            aria-label="Toggle Hazards"
          >
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0 stroke-[2.25]" />
          </button>
        </div>
      </div>

      {/* Bottom-Right Recenter / Follow Location Floating Action Button (FAB) */}
      <div className={cn(
        "absolute right-3.5 z-25 pointer-events-auto flex items-center transition-all duration-300",
        isNavigating || route ? "bottom-36 md:bottom-32" : "bottom-24 md:bottom-28"
      )}>
        <button
          onClick={handleRecenter}
          className={`flex h-12 w-12 items-center justify-center rounded-2xl border shadow-xl backdrop-blur-md active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 cursor-pointer ${isFollowingUser
              ? "bg-blue-600 text-white border-blue-500 shadow-blue-500/30"
              : "bg-[rgb(var(--card))]/95 text-[rgb(var(--fg))] border-[rgb(var(--border))] hover:bg-[rgb(var(--muted))]"
            }`}
          title="Center on My Location"
          aria-label="Center on My Location"
        >
          <Locate className={`h-5 w-5 stroke-[2.25] ${isFollowingUser ? "animate-pulse" : ""}`} />
        </button>
      </div>

      {/* Destination Details Drawer */}
      <DestinationDetailsDrawer
        destination={selectedDestForDetails}
        building={getBuildingForFloor(allFloors.find((f) => f.id === selectedDestForDetails?.floorId))}
        floorName={allFloors.find((f) => f.id === selectedDestForDetails?.floorId)?.name}
        onOpen360={(index, label) => setPanoramaScene({ index, label })}
        onClose={() => setSelectedDestForDetails(null)}
        onNavigate={(dest) => {
          setSelectedDestForDetails(null);
          if (onNavigateToDest) onNavigateToDest(dest);
        }}
      />

      <PanoramaViewer
        scene={panoramaScene}
        onClose={() => setPanoramaScene(null)}
        onSelectScene={(s) => setPanoramaScene(s)}
      />
    </div>
  );
}

function FloorButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      suppressHydrationWarning
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 min-h-[38px] cursor-pointer ${
        active
          ? "bg-indigo-600 text-white font-bold shadow-md shadow-indigo-500/25 ring-1 ring-indigo-400/80"
          : "bg-transparent hover:bg-indigo-500/10 text-[rgb(var(--fg-soft))] hover:text-indigo-700 dark:hover:text-indigo-300 font-semibold"
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function MapCanvas({
  floorId,
  route,
  alternativeRoute,
  onSelectAlternativeRoute,
  livePosition,
  progress,
  publishedData,
  gps,
  bearing = 0,
  onBearingChange,
  tiltDegrees = 0,
  showSatellite = false,
  showObstacles = true,
  nodeDisplayMode = "ALL",
  showEvents = true,
  externalZoom = 1,
  resetTrigger = 0,
  isFollowingUser = true,
  isNavigating = false,
  onUserPan,
  onSelectDestination,
  fromSelected,
  toSelected,
}: {
  floorId: string;
  route: Route | null;
  alternativeRoute?: Route | null;
  onSelectAlternativeRoute?: () => void;
  livePosition?: Node | null;
  progress?: number;
  publishedData: ReturnType<typeof campusStore.getPublishedData>;
  gps?: ReturnType<typeof useVisitorGps>;
  bearing?: number;
  onBearingChange?: (bearing: number) => void;
  tiltDegrees?: number;
  showSatellite?: boolean;
  showObstacles?: boolean;
  nodeDisplayMode?: NodeDisplayMode;
  showEvents?: boolean;
  externalZoom?: number;
  resetTrigger?: number;
  isFollowingUser?: boolean;
  isNavigating?: boolean;
  onUserPan?: () => void;
  onSelectDestination?: (dest: Destination) => void;
  fromSelected?: Destination | null;
  toSelected?: Destination | null;
}) {
  const { buildings, nodes: allNodes, edges: allEdges, destinations: allDestinations, events: allEvents } = publishedData;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const showNames = nodeDisplayMode === "ALL";
  const currentNavSegIdx = useNavigationStore((s) => s.currentSegmentIndex);

  // Interactive Pan & Zoom State
  const [internalZoom, setInternalZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const mouseRafRef = useRef<number | null>(null);
  const touchRafRef = useRef<number | null>(null);

  // Camera Smooth Animation Refs
  const panRef = useRef(pan);
  panRef.current = pan;
  const internalZoomRef = useRef(internalZoom);
  internalZoomRef.current = internalZoom;
  const bearingRef = useRef(bearing);

  // Velocity tracking & Momentum Inertia Panning
  const velocityRef = useRef<{ vx: number; vy: number }>({ vx: 0, vy: 0 });
  const isInteractingRef = useRef<boolean>(false);
  const lastTouchTimeRef = useRef<number>(0);
  const lastTouchPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const lastBearingReportTimeRef = useRef<number>(0);
  const animFrameRef = useRef<number | null>(null);
  const lastTapTimeRef = useRef<number>(0);

  const externalZoomRef = useRef(externalZoom);
  externalZoomRef.current = externalZoom;

  // Smooth Visual Zoom State (Interpolated Glide via RAF loop)
  const targetZoom = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, externalZoom * internalZoom));
  const targetZoomRef = useRef(targetZoom);
  targetZoomRef.current = targetZoom;

  const [visualZoom, setVisualZoom] = useState(targetZoom);
  const visualZoomRef = useRef(visualZoom);
  visualZoomRef.current = visualZoom;
  // Labels are drawn in map units, so without this they shrink as the camera
  // pulls back. Counter-scaling by the live zoom keeps them at a readable,
  // near-constant on-screen size; the clamp stops them overwhelming the map at
  // the extremes of the zoom range.
  const labelScale = Math.min(1.7, Math.max(0.62, 1 / Math.max(visualZoom, 0.001)));
  /** A label needs its feature to be big enough on screen to belong to it. */
  const labelFits = (footprintWidth: number) => footprintWidth * visualZoom > 38;

  // Smooth Visual Bearing State (Interpolated Glide at 60/120 FPS via RAF loop)
  const [visualBearing, setVisualBearing] = useState(bearing);
  const visualBearingRef = useRef(bearing);
  visualBearingRef.current = visualBearing;
  const targetBearingRef = useRef(bearing);

  useEffect(() => {
    if (!isInteractingRef.current) {
      bearingRef.current = bearing;
      targetBearingRef.current = bearing;
    }
  }, [bearing]);

  // Smooth Visual GPS Marker State (Interpolated Glide)
  const [visualGps, setVisualGps] = useState<{ x: number; y: number; heading: number }>({
    x: 400,
    y: 300,
    heading: 0,
  });
  const visualGpsRef = useRef(visualGps);
  visualGpsRef.current = visualGps;
  const hasGpsFixRef = useRef(false);

  // Target GPS position with route line snapping during navigation
  const targetGpsPos = useMemo(() => {
    let rawPos: { x: number; y: number; floorId?: string } | null = null;
    if (gps && gps.isGpsActive && gps.lat && gps.lng) {
      rawPos = gpsToCanvas(gps.lat, gps.lng);
    } else if (gps && gps.isGpsActive && gps.canvasPos) {
      rawPos = gps.canvasPos;
    }

    if (!rawPos) return null;

    // If navigating along a route on the current floor, snap smoothly to the active route segment
    if (route && route.nodes && route.nodes.length >= 2) {
      const currentFloorNodes = route.nodes.filter(
        (n) => !n.floorId || n.floorId === floorId || ((floorId === "f-out" || floorId === "outdoor") && (!n.floorId || n.floorId === "f-out" || n.floorId === "outdoor"))
      );
      if (currentFloorNodes.length >= 2) {
        let bestSnap = rawPos;
        let minSqDist = 30 * 30; // 30 canvas units threshold (~15 meters snapping corridor)

        for (let i = 0; i < currentFloorNodes.length - 1; i++) {
          const p1 = currentFloorNodes[i];
          const p2 = currentFloorNodes[i + 1];
          if (typeof p1.x !== "number" || typeof p2.x !== "number") continue;

          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const lenSq = dx * dx + dy * dy;
          if (lenSq === 0) continue;

          // Projection factor t clamped to segment [0, 1]
          const t = Math.max(0, Math.min(1, ((rawPos.x - p1.x) * dx + (rawPos.y - p1.y) * dy) / lenSq));
          const projX = p1.x + t * dx;
          const projY = p1.y + t * dy;
          const sqDist = (rawPos.x - projX) * (rawPos.x - projX) + (rawPos.y - projY) * (rawPos.y - projY);

          if (sqDist < minSqDist) {
            minSqDist = sqDist;
            bestSnap = { x: projX, y: projY, floorId: rawPos.floorId };
          }
        }
        return bestSnap;
      }
    }

    return rawPos;
  }, [gps?.isGpsActive, gps?.lat, gps?.lng, gps?.canvasPos, route, floorId]);

  const targetHeading = gps?.heading ?? 0;

  // Navigation Start/End Initial Bearing Alignment
  const prevNavigatingRef = useRef(isNavigating);
  useEffect(() => {
    prevNavigatingRef.current = isNavigating;
  }, [isNavigating, route, gps?.heading, onBearingChange]);

  // Dynamic SVG bounding box calculation
  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    buildings.forEach((b) => {
      const bx = b.x ?? 100;
      const by = b.y ?? 100;
      const bw = b.width ?? 180;
      const bh = b.height ?? 120;
      minX = Math.min(minX, bx - 50);
      minY = Math.min(minY, by - 50);
      maxX = Math.max(maxX, bx + bw + 50);
      maxY = Math.max(maxY, by + bh + 50);
    });
    allNodes.forEach((n) => {
      if (n.x !== undefined && n.y !== undefined) {
        minX = Math.min(minX, n.x - 60);
        minY = Math.min(minY, n.y - 60);
        maxX = Math.max(maxX, n.x + 60);
        maxY = Math.max(maxY, n.y + 60);
      }
    });
    if (!isFinite(minX) || !isFinite(minY)) {
      return { x: 0, y: 0, w: 1000, h: 700 };
    }
    // Campus coordinates are free to be negative — clamping the origin to 0
    // pushed anything above/left of the origin outside the viewBox entirely.
    const bX = Math.floor(minX);
    const bY = Math.floor(minY);
    return {
      x: bX,
      y: bY,
      w: Math.max(800, Math.ceil(maxX - bX)),
      h: Math.max(600, Math.ceil(maxY - bY)),
    };
  }, [buildings, allNodes]);

  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;

  // Single Authoritative RAF loop for smooth marker gliding & continuous camera following using Delta-Time Exponential Smoothing
  const lastTimeRef = useRef<number>(0);
  const lastReportedBearingRef = useRef<number>(bearing);

  // Unified Master Camera & Marker Animation Controller (Single Authoritative RAF Loop)
  useEffect(() => {
    let active = true;
    lastTimeRef.current = performance.now();

    const animateMarkerAndCamera = (timestamp: number) => {
      if (!active) return;

      const now = timestamp || performance.now();
      const dt = Math.min(0.064, Math.max(0.001, (now - (lastTimeRef.current || now)) / 1000));
      lastTimeRef.current = now;

      // 0. Smooth Visual Zoom Glide (Delta-Time Exponential Smoothing, snappy ~60ms convergence)
      const targetZ = targetZoomRef.current;
      const curZ = visualZoomRef.current;
      const dZ = targetZ - curZ;
      if (Math.abs(dZ) > 0.0004) {
        const zoomAlpha = 1 - Math.exp(-24.0 * dt);
        const nextZ = curZ + dZ * zoomAlpha;
        visualZoomRef.current = nextZ;
        setVisualZoom(nextZ);
        setPan(panRef.current);
        setInternalZoom(internalZoomRef.current);
      } else if (curZ !== targetZ) {
        visualZoomRef.current = targetZ;
        setVisualZoom(targetZ);
        setPan(panRef.current);
        setInternalZoom(internalZoomRef.current);
      }

      // 0c. Smooth Visual Bearing Glide (Shortest-angle continuous circular interpolation)
      if (!isInteractingRef.current) {
        const targetB = targetBearingRef.current;
        const curB = visualBearingRef.current;
        const dB = (((targetB - curB + 540) % 360) - 180);
        if (Math.abs(dB) > 0.04) {
          const rotSpeed = 18.0;
          const rotAlpha = 1 - Math.exp(-rotSpeed * dt);
          const nextB = (curB + dB * rotAlpha + 360) % 360;
          visualBearingRef.current = nextB;
          setVisualBearing(nextB);
        } else if (curB !== targetB) {
          visualBearingRef.current = targetB;
          setVisualBearing(targetB);
        }
      }

      // 1. Visual GPS Marker Smooth Gliding
      if (targetGpsPos && gps?.isGpsActive) {
        if (!hasGpsFixRef.current) {
          hasGpsFixRef.current = true;
          visualGpsRef.current = { x: targetGpsPos.x, y: targetGpsPos.y, heading: targetHeading };
          setVisualGps({
            x: targetGpsPos.x,
            y: targetGpsPos.y,
            heading: targetHeading,
          });
        } else {
          const cur = visualGpsRef.current;
          const dx = targetGpsPos.x - cur.x;
          const dy = targetGpsPos.y - cur.y;

          // Circular shortest angle interpolation for heading
          const dHeading = (((targetHeading - cur.heading + 540) % 360) - 180);

          // Continuous Delta-Time Exponential Smoothing (60Hz / 90Hz / 120Hz invariant)
          const gpsAlpha = 1 - Math.exp(-9.0 * dt);
          const headingAlpha = 1 - Math.exp(-7.0 * dt);

          if (Math.abs(dx) > 0.35 || Math.abs(dy) > 0.35 || Math.abs(dHeading) > 0.8) {
            const nextX = cur.x + dx * gpsAlpha;
            const nextY = cur.y + dy * gpsAlpha;
            const nextHeading = (cur.heading + dHeading * headingAlpha + 360) % 360;

            visualGpsRef.current = { x: nextX, y: nextY, heading: nextHeading };
            setVisualGps({
              x: nextX,
              y: nextY,
              heading: nextHeading,
            });
          }
        }
      } else {
        hasGpsFixRef.current = false;
      }

      // 2. Momentum Inertia Panning (when user released gesture)
      if (!isInteractingRef.current && (Math.abs(velocityRef.current.vx) > 0.15 || Math.abs(velocityRef.current.vy) > 0.15)) {
        const friction = Math.pow(0.92, dt / 0.016);
        velocityRef.current.vx *= friction;
        velocityRef.current.vy *= friction;

        if (Math.hypot(velocityRef.current.vx, velocityRef.current.vy) < 0.15) {
          velocityRef.current = { vx: 0, vy: 0 };
        } else {
          const curPan = panRef.current;
          const nextPanX = curPan.x + velocityRef.current.vx;
          const nextPanY = curPan.y + velocityRef.current.vy;
          panRef.current = { x: nextPanX, y: nextPanY };
          setPan({ x: nextPanX, y: nextPanY });
        }
      }

      // 3. Navigation Follow Mode (Glide camera pan & rotate map when user is not manually dragging)
      if (isFollowingUser && !isInteractingRef.current && Math.hypot(velocityRef.current.vx, velocityRef.current.vy) < 0.15) {
        const curMarker = visualGpsRef.current;
        const targetFollowX = targetGpsPos ? targetGpsPos.x : curMarker.x;
        const targetFollowY = targetGpsPos ? targetGpsPos.y : curMarker.y;

        const centerX = boundsRef.current.x + boundsRef.current.w / 2;
        const centerY = boundsRef.current.y + boundsRef.current.h / 2;

        const targetPanX = centerX - targetFollowX;
        const targetPanY = centerY - targetFollowY;

        const curPan = panRef.current;
        const panDx = targetPanX - curPan.x;
        const panDy = targetPanY - curPan.y;

        const panAlpha = 1 - Math.exp(-7.5 * dt);

        if (Math.abs(panDx) > 0.35 || Math.abs(panDy) > 0.35) {
          const nextPanX = curPan.x + panDx * panAlpha;
          const nextPanY = curPan.y + panDy * panAlpha;
          panRef.current = { x: nextPanX, y: nextPanY };
          setPan({
            x: nextPanX,
            y: nextPanY,
          });
        }
      }

      requestAnimationFrame(animateMarkerAndCamera);
    };

    const handle = requestAnimationFrame(animateMarkerAndCamera);
    return () => {
      active = false;
      cancelAnimationFrame(handle);
    };
  }, [targetGpsPos, targetHeading, isFollowingUser, isNavigating, onBearingChange, gps?.speed, gps?.heading, gps?.isGpsActive]);

  const nodeLookupMap = useMemo(() => {
    const map = new Map<string, Node>();
    allNodes.forEach((n) => map.set(n.id, n));
    if (route?.nodes) {
      route.nodes.forEach((n) => map.set(n.id, n));
    }
    return map;
  }, [allNodes, route]);

  const findNode = useCallback((id: string) => nodeLookupMap.get(id), [nodeLookupMap]);

  // Recenter / Reset Action Trigger
  useEffect(() => {
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    targetBearingRef.current = 0;
    bearingRef.current = 0;
    visualBearingRef.current = 0;
    setVisualBearing(0);
    // Intelligent Auto-Fit for Active Route or Destination Pair
    if (route && route.nodes && route.nodes.length >= 2) {
      let minRx = Infinity, minRy = Infinity, maxRx = -Infinity, maxRy = -Infinity;
      route.nodes.forEach((n) => {
        if (typeof n.x === "number" && typeof n.y === "number" && !isNaN(n.x) && !isNaN(n.y)) {
          minRx = Math.min(minRx, n.x);
          minRy = Math.min(minRy, n.y);
          maxRx = Math.max(maxRx, n.x);
          maxRy = Math.max(maxRy, n.y);
        }
      });

      if (isFinite(minRx) && isFinite(maxRx) && maxRx >= minRx) {
        const routeCenterX = (minRx + maxRx) / 2;
        const routeCenterY = (minRy + maxRy) / 2;
        const routeSpanX = Math.max(140, maxRx - minRx);
        const routeSpanY = Math.max(140, maxRy - minRy);

        const centerX = bounds.x + bounds.w / 2;
        const centerY = bounds.y + bounds.h / 2;

        const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
        // Provide generous comfortable margin around route geometry so neither end is cramped
        const availW = Math.max(280, isMobile ? bounds.w * 0.76 : bounds.w * 0.72);
        const availH = Math.max(280, isMobile ? bounds.h * 0.56 : bounds.h * 0.68);

        const fitZoomX = availW / routeSpanX;
        const fitZoomY = availH / routeSpanY;
        const routeFitZoom = Math.min(1.35, Math.max(0.45, Math.min(fitZoomX, fitZoomY)));

        const nextPan = { x: centerX - routeCenterX, y: centerY - routeCenterY };
        panRef.current = nextPan;
        visualZoomRef.current = routeFitZoom;
        internalZoomRef.current = routeFitZoom;
        targetZoomRef.current = routeFitZoom;
        setPan(nextPan);
        setVisualZoom(routeFitZoom);
        setInternalZoom(routeFitZoom);
        return;
      }
    }

    // Auto-Fit Selected Start and Destination Nodes
    const startNode = fromSelected?.nodeId ? findNode(fromSelected.nodeId) : null;
    const endNode = toSelected?.nodeId ? findNode(toSelected.nodeId) : null;

    if (startNode && endNode) {
      const minX = Math.min(startNode.x, endNode.x);
      const maxX = Math.max(startNode.x, endNode.x);
      const minY = Math.min(startNode.y, endNode.y);
      const maxY = Math.max(startNode.y, endNode.y);
      const spanX = Math.max(140, maxX - minX);
      const spanY = Math.max(140, maxY - minY);
      const cX = (minX + maxX) / 2;
      const cY = (minY + maxY) / 2;

      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;

      const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
      const availW = Math.max(280, isMobile ? bounds.w * 0.76 : bounds.w * 0.72);
      const availH = Math.max(280, isMobile ? bounds.h * 0.56 : bounds.h * 0.68);
      const fitZoom = Math.min(1.35, Math.max(0.45, Math.min(availW / spanX, availH / spanY)));
      const nextPan = { x: centerX - cX, y: centerY - cY };

      panRef.current = nextPan;
      visualZoomRef.current = fitZoom;
      internalZoomRef.current = fitZoom;
      targetZoomRef.current = fitZoom;
      setPan(nextPan);
      setVisualZoom(fitZoom);
      setInternalZoom(fitZoom);
      return;
    }

    const hasLiveGps = Boolean(
      gps &&
      gps.isGpsActive &&
      (gps.lat !== 0 || (gps.canvasPos && (gps.canvasPos.x !== 400 || gps.canvasPos.y !== 300)))
    );
    if (hasLiveGps && gps) {
      const targetCanvas = (gps.lat && gps.lng) ? gpsToCanvas(gps.lat, gps.lng) : gps.canvasPos;
      if (targetCanvas) {
        const centerX = bounds.x + bounds.w / 2;
        const centerY = bounds.y + bounds.h / 2;
        const nextPan = { x: centerX - targetCanvas.x, y: centerY - targetCanvas.y };
        panRef.current = nextPan;
        visualZoomRef.current = 0.85;
        internalZoomRef.current = 0.85;
        targetZoomRef.current = 0.85;
        setPan(nextPan);
        setVisualZoom(0.85);
        setInternalZoom(0.85);
      }
    } else if (livePosition) {
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;
      const nextPan = { x: centerX - livePosition.x, y: centerY - livePosition.y };
      panRef.current = nextPan;
      visualZoomRef.current = 0.85;
      internalZoomRef.current = 0.85;
      targetZoomRef.current = 0.85;
      setPan(nextPan);
      setVisualZoom(0.85);
      setInternalZoom(0.85);
    } else if (startNode) {
      const centerX = bounds.x + bounds.w / 2;
      const centerY = bounds.y + bounds.h / 2;
      const nextPan = { x: centerX - startNode.x, y: centerY - startNode.y };
      panRef.current = nextPan;
      visualZoomRef.current = 0.85;
      internalZoomRef.current = 0.85;
      targetZoomRef.current = 0.85;
      setPan(nextPan);
      setVisualZoom(0.85);
      setInternalZoom(0.85);
    } else {
      panRef.current = { x: 0, y: 0 };
      visualZoomRef.current = 1;
      internalZoomRef.current = 1;
      targetZoomRef.current = 1;
      setPan({ x: 0, y: 0 });
      setVisualZoom(1);
      setInternalZoom(1);
    }
  }, [resetTrigger, route?.id, fromSelected?.id, toSelected?.id]);

  const floorById = useMemo(() => {
    const map = new Map<string, Floor>();
    publishedData.floors.forEach((f) => map.set(f.id, f));
    return map;
  }, [publishedData.floors]);

  const currentFloorObj = useMemo(
    () => floorById.get(floorId),
    [floorById, floorId]
  );
  const isOutdoorFloor = floorId === "f-out" || floorId === "outdoor";

  const groundFloorIdSet = useMemo(() => {
    const set = new Set<string>();
    publishedData.floors.forEach((f) => {
      if (f.ordinal === 0) set.add(f.id);
      const fName = (f.name || "").toLowerCase();
      const fId = (f.id || "").toLowerCase();
      if (
        fName.includes("ground") ||
        fName.includes("gnd") ||
        fName.includes("floor 0") ||
        fName.includes("level 0") ||
        fId.endsWith("-0") ||
        fId.endsWith("-g") ||
        fId.includes("ground")
      ) {
        set.add(f.id);
      }
    });
    return set;
  }, [publishedData.floors]);

  const isGroundFloor = useMemo(() => {
    if (isOutdoorFloor) return false;
    const fl = floorById.get(floorId);
    return fl ? fl.ordinal === 0 : groundFloorIdSet.has(floorId);
  }, [floorId, isOutdoorFloor, floorById, groundFloorIdSet]);

  const isEntranceNode = useCallback((n?: Node | null) => {
    if (!n) return false;
    return (
      n.type === "BUILDING_ENTRANCE" ||
      n.type === "ENTRANCE" ||
      Boolean(n.isEntranceNode) ||
      (typeof n.name === "string" && n.name.toLowerCase().includes("entrance"))
    );
  }, []);

  const isNodeOutdoor = useCallback((n?: Node | null) => {
    if (!n) return false;
    const fId = n.floorId || "f-out";
    return (
      fId === "f-out" ||
      fId === "outdoor" ||
      n.type === "GATE" ||
      n.type === "ROAD_JUNCTION" ||
      n.type === "OUTDOOR_PATH" ||
      n.type === "PARKING"
    );
  }, []);

  const isGroundFloorNode = useCallback(
    (n?: Node | null) => {
      if (!n) return false;
      if (!n.floorId || n.floorId === "f-out" || n.floorId === "outdoor") return true;
      return groundFloorIdSet.has(n.floorId);
    },
    [groundFloorIdSet]
  );

  const isNodeOnActiveFloor = useCallback(
    (n: Node) => {
      if (isOutdoorFloor) {
        return isNodeOutdoor(n) || isEntranceNode(n) || isGroundFloorNode(n);
      }
      if (n.floorId === floorId) {
        return true;
      }
      if (isGroundFloor) {
        return isNodeOutdoor(n) || isEntranceNode(n) || isGroundFloorNode(n);
      }
      return false;
    },
    [isOutdoorFloor, isNodeOutdoor, isEntranceNode, isGroundFloorNode, isGroundFloor, floorId]
  );

  const scopeNodes = useMemo(() => {
    return allNodes.filter(isNodeOnActiveFloor);
  }, [allNodes, isNodeOnActiveFloor]);

  // Single-pass categorization for 60/120 FPS render performance
  const categorizedScopeNodes = useMemo(() => {
    const parking: Node[] = [];
    const gates: Node[] = [];
    const entrances: Node[] = [];
    const stairsAndLifts: Node[] = [];
    const amenities: Node[] = [];
    const others: Node[] = [];

    for (const n of scopeNodes) {
      if (n.type === "PARKING" || (n.name && n.name.toLowerCase().includes("parking"))) {
        parking.push(n);
      } else if (n.type === "GATE" || (n.name && n.name.toLowerCase().includes("gate"))) {
        gates.push(n);
      } else if (n.type === "BUILDING_ENTRANCE" || n.isEntranceNode || (n.type === "ENTRANCE" && floorId === "f-out")) {
        entrances.push(n);
      } else if (n.type === "STAIR" || n.type === "LIFT" || (n.name && (n.name.toLowerCase().includes("stair") || n.name.toLowerCase().includes("lift")))) {
        stairsAndLifts.push(n);
      } else if (n.type === "WASHROOM" || n.type === "FACILITY") {
        amenities.push(n);
      } else {
        others.push(n);
      }
    }

    return { parking, gates, entrances, stairsAndLifts, amenities, others };
  }, [scopeNodes, floorId]);

  // Precompute building geometries to eliminate repeated trigonometric math during drag & twist
  // Walls only have visible height once the camera is pitched; at plan view the
  // extrusion collapses, which is geometrically what looking straight down means.
  const tiltFactor = Math.max(0.12, Math.sin((tiltDegrees * Math.PI) / 180) + 0.12);
  const isTilted = tiltDegrees > 0.5;

  const memoizedBuildingGeometries = useMemo(() => {
    return buildings
      .map((b) => {
        const canvasPts = getBuildingCanvasPoints(b);
        const svgPath = getPolygonSvgPath(canvasPts);
        const centerPos = getBuildingCenter(b);
        const bName = b.name;
        const badgeWidth = Math.max(140, bName.length * 8.5 + 32);
        const buildingEvent = publishedData.events.find((ev) => ev.buildingId === b.id);
        // Buildings share the cartographic token palette; a hue is spent only on
        // buildings carrying an event, so colour on the map means something.
        const strokeColor = buildingEvent?.color || "var(--map-building-edge)";

        // Real extrusion depth: prefer the building's own floor records over the
        // denormalised count, so each block stands at its true height.
        const storeys = (publishedData.floors ?? []).filter((f) => f.buildingId === b.id).length;
        const height =
          getBuildingExtrusionHeight(b as { heightMeters?: number; floorsCount?: number }, storeys || undefined) *
          tiltFactor;
        const roofPts = getExtrudedRoofPoints(canvasPts, height);
        const roofPath = getPolygonSvgPath(roofPts);
        const walls = getWallFacets(canvasPts, roofPts, Math.max(1, storeys || b.floorsCount || 1));
        const roofCenter = {
          x: centerPos.x + EXTRUSION_VECTOR.x * height,
          y: centerPos.y + EXTRUSION_VECTOR.y * height,
        };

        // Widest span of the footprint, used to suppress labels on blocks that
        // are too small on screen to carry one.
        const xs = canvasPts.map((p) => p.x);
        const ys = canvasPts.map((p) => p.y);
        const footprintWidth = canvasPts.length ? Math.max(...xs) - Math.min(...xs) : 0;
        const footprintHeight = canvasPts.length ? Math.max(...ys) - Math.min(...ys) : 0;

        return {
          b,
          svgPath,
          roofPath,
          walls,
          height,
          roofCenter,
          centerPos,
          badgeWidth,
          footprintWidth,
          footprintHeight,
          storeys,
          buildingEvent,
          strokeColor,
          bName,
        };
      })
      // Painter's algorithm: draw far (north) blocks first so nearer ones occlude them.
      .sort((a, b) => a.centerPos.y - b.centerPos.y);
  }, [buildings, publishedData.events, publishedData.floors, tiltFactor]);

  const scopeEdges = useMemo(() => {
    return allEdges.filter((e) => {
      const from = findNode(e.fromNodeId ?? e.from);
      const to = findNode(e.toNodeId ?? e.to);
      if (!from || !to) return false;

      if (isOutdoorFloor) {
        const fromActive = isNodeOnActiveFloor(from);
        const toActive = isNodeOnActiveFloor(to);
        return fromActive && toActive;
      }

      if (isGroundFloor) {
        const fromThisFloor = from.floorId === floorId;
        const toThisFloor = to.floorId === floorId;
        const isFromOut = isNodeOutdoor(from);
        const isToOut = isNodeOutdoor(to);
        const fromEnt = isEntranceNode(from);
        const toEnt = isEntranceNode(to);

        // 1. Both nodes on this specific ground floor
        if (fromThisFloor && toThisFloor) return true;
        // 2. Both nodes are outdoor (seamless campus pathways)
        if (isFromOut && isToOut) return true;
        // 3. Ground floor connecting to entrance or outdoor path
        if ((fromThisFloor && (toEnt || isToOut)) || (toThisFloor && (fromEnt || isFromOut))) return true;
        // 4. Entrance connecting to outdoor
        if ((fromEnt && isToOut) || (toEnt && isFromOut)) return true;
        // 5. General ground floor nodes
        if (isGroundFloorNode(from) && isGroundFloorNode(to)) return true;
      }

      const fromThisFloor = from.floorId === floorId;
      const toThisFloor = to.floorId === floorId;
      const fromEnt = isGroundFloor && isEntranceNode(from);
      const toEnt = isGroundFloor && isEntranceNode(to);

      return (fromThisFloor && toThisFloor) || (fromThisFloor && toEnt) || (toThisFloor && fromEnt);
    });
  }, [allEdges, findNode, isOutdoorFloor, isNodeOutdoor, isEntranceNode, isGroundFloor, isGroundFloorNode, floorId, isNodeOnActiveFloor]);

  const routeNodes = useMemo(() => {
    if (!route?.nodes) return [];
    return route.nodes.filter(isNodeOnActiveFloor);
  }, [route?.nodes, isNodeOnActiveFloor]);

  // Labels are drawn in map units, so two that collide do so at every zoom level.
  // Lay them out once, highest priority first, and drop whatever cannot fit.
  const visibleLabelIds = useMemo(() => {
    type Box = { x: number; y: number; w: number; h: number };
    const placed: Box[] = [];
    const kept = new Set<string>();
    const overlaps = (a: Box, b: Box) =>
      Math.abs(a.x - b.x) * 2 < a.w + b.w + 6 && Math.abs(a.y - b.y) * 2 < a.h + b.h + 4;

    const destinationNodeId = route?.nodes?.[route.nodes.length - 1]?.id;
    const candidates: { id: string; box: Box; priority: number }[] = [];

    allDestinations.forEach((d) => {
      const node = allNodes.find((n) => n.id === d.nodeId);
      if (!node || node.visibleToUser === false) return;
      if (!isNodeOnActiveFloor(node) && floorId !== "f-out") return;
      const isSelected = toSelected?.id === d.id || toSelected?.nodeId === node.id;
      const onRoute = routeNodes.some((rn) => rn.id === node.id);
      const width = Math.max(50, `${d.name}`.length * 6.2 + 30);
      candidates.push({
        id: `dest:${d.id}`,
        box: { x: node.x, y: node.y, w: width, h: 20 },
        priority: isSelected ? 100 : onRoute ? 80 : 40,
      });
    });

    scopeNodes.forEach((n) => {
      if (!n.name || n.visibleToUser === false) return;
      if (allDestinations.some((d) => d.nodeId === n.id)) return;
      const onRoute = routeNodes.some((rn) => rn.id === n.id);
      const isDest = destinationNodeId === n.id;
      const isStairOrLift =
        n.type === "STAIR" || n.type === "LIFT" || n.name.toLowerCase().includes("stair") || n.name.toLowerCase().includes("lift");
      const width = Math.max(70, n.name.length * 7 + 16);
      candidates.push({
        id: `node:${n.id}`,
        box: { x: n.x, y: isStairOrLift ? n.y - 20 : n.y + 14, w: width, h: isStairOrLift ? 22 : 19 },
        priority: isDest ? 95 : onRoute ? 75 : isStairOrLift ? 55 : 30,
      });
    });

    candidates
      .sort((a, b) => b.priority - a.priority)
      .forEach((c) => {
        if (placed.some((p) => overlaps(p, c.box))) return;
        placed.push(c.box);
        kept.add(c.id);
      });

    return kept;
  }, [allDestinations, allNodes, scopeNodes, routeNodes, route?.nodes, toSelected, isNodeOnActiveFloor, floorId]);

  const routeEdges = useMemo(() => {
    if (!route?.edges) return [];
    return route.edges.filter((e) => {
      const from = findNode(e.from);
      const to = findNode(e.to);
      if (!from || !to) return false;

      if (isOutdoorFloor) {
        const fromOut = isNodeOutdoor(from);
        const toOut = isNodeOutdoor(to);
        const fromEnt = isEntranceNode(from) && (from.floorId === "f-out" || from.floorId === "outdoor" || !from.floorId);
        const toEnt = isEntranceNode(to) && (to.floorId === "f-out" || to.floorId === "outdoor" || !to.floorId);
        return (fromOut && toOut) || (fromOut && toEnt) || (toOut && fromEnt);
      }

      if (isGroundFloor) {
        const fromThisFloor = from.floorId === floorId;
        const toThisFloor = to.floorId === floorId;
        const isFromOut = isNodeOutdoor(from);
        const isToOut = isNodeOutdoor(to);
        const fromEnt = isEntranceNode(from);
        const toEnt = isEntranceNode(to);

        if (fromThisFloor && toThisFloor) return true;
        if (isFromOut && isToOut) return true;
        if ((fromThisFloor && (toEnt || isToOut)) || (toThisFloor && (fromEnt || isFromOut))) return true;
        if ((fromEnt && isToOut) || (toEnt && isFromOut)) return true;
        if (isGroundFloorNode(from) && isGroundFloorNode(to)) return true;
      }

      const fromThisFloor = from.floorId === floorId;
      const toThisFloor = to.floorId === floorId;
      const fromEnt = isGroundFloor && isEntranceNode(from);
      const toEnt = isGroundFloor && isEntranceNode(to);

      return (fromThisFloor && toThisFloor) || (fromThisFloor && toEnt) || (toThisFloor && fromEnt);
    });
  }, [route?.edges, findNode, isOutdoorFloor, isNodeOutdoor, isEntranceNode, isGroundFloor, isGroundFloorNode, floorId]);

  const alternativeRouteEdges = useMemo(() => {
    if (!alternativeRoute?.edges) return [];
    return alternativeRoute.edges.filter((e) => {
      const from = findNode(e.from);
      const to = findNode(e.to);
      if (!from || !to) return false;

      if (isOutdoorFloor) {
        const fromOut = isNodeOutdoor(from);
        const toOut = isNodeOutdoor(to);
        const fromEnt = isEntranceNode(from) && (from.floorId === "f-out" || from.floorId === "outdoor" || !from.floorId);
        const toEnt = isEntranceNode(to) && (to.floorId === "f-out" || to.floorId === "outdoor" || !to.floorId);
        return (fromOut && toOut) || (fromOut && toEnt) || (toOut && fromEnt);
      }

      if (isGroundFloor) {
        const fromThisFloor = from.floorId === floorId;
        const toThisFloor = to.floorId === floorId;
        const isFromOut = isNodeOutdoor(from);
        const isToOut = isNodeOutdoor(to);
        const fromEnt = isEntranceNode(from);
        const toEnt = isEntranceNode(to);

        if (fromThisFloor && toThisFloor) return true;
        if (isFromOut && isToOut) return true;
        if ((fromThisFloor && (toEnt || isToOut)) || (toThisFloor && (fromEnt || isFromOut))) return true;
        if ((fromEnt && isToOut) || (toEnt && isFromOut)) return true;
        if (isGroundFloorNode(from) && isGroundFloorNode(to)) return true;
      }

      const fromThisFloor = from.floorId === floorId;
      const toThisFloor = to.floorId === floorId;
      const fromEnt = isGroundFloor && isEntranceNode(from);
      const toEnt = isGroundFloor && isEntranceNode(to);

      return (fromThisFloor && toThisFloor) || (fromThisFloor && toEnt) || (toThisFloor && fromEnt);
    });
  }, [alternativeRoute?.edges, findNode, isOutdoorFloor, isNodeOutdoor, isEntranceNode, isGroundFloor, isGroundFloorNode, floorId]);

  const alternativeBadgePos = useMemo(() => {
    if (!alternativeRoute?.nodes || alternativeRoute.nodes.length < 2) return null;
    const midIdx = Math.floor(alternativeRoute.nodes.length / 2);
    const midNode = alternativeRoute.nodes[midIdx];
    if (!midNode) return null;
    return { x: midNode.x, y: midNode.y };
  }, [alternativeRoute?.nodes]);

  const blockedEdgeIds = useMemo(() => {
    return getObstructedEdgeIds(allNodes, allEdges, publishedData.obstacles);
  }, [allNodes, allEdges, publishedData.obstacles]);

  const destination = route?.nodes[route.nodes.length - 1];
  const showLiveHere = livePosition && isNodeOnActiveFloor(livePosition);

  const effectiveW = bounds.w / visualZoom;
  const effectiveH = bounds.h / visualZoom;
  const effectiveX = bounds.x + (bounds.w - effectiveW) / 2 - pan.x;
  const effectiveY = bounds.y + (bounds.h - effectiveH) / 2 - pan.y;
  const viewBoxStr = `${effectiveX} ${effectiveY} ${effectiveW} ${effectiveH}`;

  // The surveyed campus perimeter, so buildings sit on grounds rather than on
  // an empty grey field.
  const campusGroundPath = useMemo(() => {
    const ring = (publishedData as { boundary?: { lat: number; lng: number }[] }).boundary;
    if (!ring || ring.length < 3) return null;
    const pts = ring.map((p) => gpsToCanvas(p.lat, p.lng));
    return `${pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ")} Z`;
  }, [publishedData]);

  // Satellite imagery covering the current view, aligned by projecting each
  // tile's own corners so it lands on the surveyed geometry.
  const satelliteTiles = useMemo(() => {
    if (!showSatellite) return null;
    // Fetch past the visible rectangle: the view rotates and tilts around its
    // pivot, and tile edges never align with the viewport, so an unpadded rect
    // leaves a bare strip along whichever edge the last tile column falls short
    // of. A third of the view each side covers any bearing.
    const padX = effectiveW * 0.35;
    const padY = effectiveH * 0.35;
    return getTilesForCanvasRect(
      { x: effectiveX - padX, y: effectiveY - padY, w: effectiveW + padX * 2, h: effectiveH + padY * 2 },
      { maxTiles: 80 }
    );
  }, [showSatellite, effectiveX, effectiveY, effectiveW, effectiveH]);

  // Scale bar: the canvas is metric (PIXELS_PER_METER), so pick a round distance
  // that fills about a sixth of the view and label it exactly.
  const scaleBar = (() => {
    const targetMetres = (effectiveW / 6) / PIXELS_PER_METER;
    const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
    const metres = steps.reduce((best, step) =>
      Math.abs(step - targetMetres) < Math.abs(best - targetMetres) ? step : best
    , steps[0]);
    return { metres, length: metres * PIXELS_PER_METER };
  })();

  const stopInertia = () => {
    velocityRef.current = { vx: 0, vy: 0 };
  };

  const handleMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    stopInertia();
    isInteractingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastTouchPosRef.current = { x: e.clientX, y: e.clientY };
    lastTouchTimeRef.current = Date.now();
    velocityRef.current = { vx: 0, vy: 0 };
    onUserPan?.();
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!isDragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const curEffW = boundsRef.current.w / (visualZoomRef.current || 1);
    const curEffH = boundsRef.current.h / (visualZoomRef.current || 1);
    const uniformScale = Math.max(curEffW / (rect.width || 1), curEffH / (rect.height || 1));
    const now = Date.now();
    const dt = Math.max(1, now - (lastTouchTimeRef.current || now));

    const rawDx = (e.clientX - dragStartRef.current.x) * uniformScale;
    const rawDy = (e.clientY - dragStartRef.current.y) * uniformScale;

    const rad = (-bearingRef.current * Math.PI) / 180;
    const dx = rawDx * Math.cos(rad) - rawDy * Math.sin(rad);
    const dy = rawDx * Math.sin(rad) + rawDy * Math.cos(rad);

    const rawVx = ((e.clientX - lastTouchPosRef.current.x) * uniformScale) / (dt / 16);
    const rawVy = ((e.clientY - lastTouchPosRef.current.y) * uniformScale) / (dt / 16);
    const vx = rawVx * Math.cos(rad) - rawVy * Math.sin(rad);
    const vy = rawVx * Math.sin(rad) + rawVy * Math.cos(rad);
    velocityRef.current = { vx, vy };

    const nextPan = { x: panRef.current.x + dx, y: panRef.current.y + dy };
    panRef.current = nextPan;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    lastTouchPosRef.current = { x: e.clientX, y: e.clientY };
    lastTouchTimeRef.current = now;

    if (mouseRafRef.current === null) {
      mouseRafRef.current = requestAnimationFrame(() => {
        mouseRafRef.current = null;
        setPan(panRef.current);
      });
    }
  };

  const handleMouseUp = () => {
    isInteractingRef.current = false;
    setIsDragging(false);
    if (mouseRafRef.current !== null) {
      cancelAnimationFrame(mouseRafRef.current);
      mouseRafRef.current = null;
      setPan(panRef.current);
    }
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      onUserPan?.();

      const zoomMultiplier = computeDesktopWheelMultiplier(e.deltaY, e.ctrlKey, e.deltaMode);

      const prevVisualZoom = visualZoomRef.current || 1;
      const targetTotal = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, prevVisualZoom * zoomMultiplier));
      if (Math.abs(targetTotal - prevVisualZoom) < 0.0001) return;

      const extZ = externalZoomRef.current || 1;
      const newInternal = targetTotal / extZ;
      internalZoomRef.current = newInternal;
      targetZoomRef.current = targetTotal;
      visualZoomRef.current = targetTotal;

      const rect = svg.getBoundingClientRect();
      const mouseRatioX = (e.clientX - rect.left) / (rect.width || 1);
      const mouseRatioY = (e.clientY - rect.top) / (rect.height || 1);

      const bW = boundsRef.current.w;
      const bH = boundsRef.current.h;
      const oldW = bW / prevVisualZoom;
      const oldH = bH / prevVisualZoom;
      const newW = bW / targetTotal;
      const newH = bH / targetTotal;

      const rawDPanX = (oldW - newW) * (0.5 - mouseRatioX);
      const rawDPanY = (oldH - newH) * (0.5 - mouseRatioY);

      const rad = (-bearingRef.current * Math.PI) / 180;
      const dPanX = rawDPanX * Math.cos(rad) - rawDPanY * Math.sin(rad);
      const dPanY = rawDPanX * Math.sin(rad) + rawDPanY * Math.cos(rad);

      const nextPan = { x: panRef.current.x + dPanX, y: panRef.current.y + dPanY };
      panRef.current = nextPan;

      setVisualZoom(targetTotal);
      setInternalZoom(newInternal);
      setPan(nextPan);
    };

    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [onUserPan]);

  const touchGestureRef = useRef<{
    mode: "NONE" | "PAN" | "PINCH_ROTATE";
    initialDist: number;
    initialAngle: number;
    initialBearing: number;
    initialZoom: number;
    lastPos: { x: number; y: number };
    lastCenter: { x: number; y: number };
  }>({
    mode: "NONE",
    initialDist: 0,
    initialAngle: 0,
    initialBearing: 0,
    initialZoom: 1,
    lastPos: { x: 0, y: 0 },
    lastCenter: { x: 0, y: 0 },
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const getDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const getAngle = (t1: Touch, t2: Touch) =>
      (Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * 180) / Math.PI;

    const getCenter = (t1: Touch, t2: Touch) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });

    const handleTouchStart = (e: TouchEvent) => {
      stopInertia();
      isInteractingRef.current = true;
      const now = Date.now();

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        if (now - lastTapTimeRef.current < 300) {
          e.preventDefault();
          const prevVisualZoom = visualZoomRef.current || 1;
          const targetTotal = Math.min(MAX_MAP_ZOOM, prevVisualZoom * 1.5);
          const extZ = externalZoomRef.current || 1;
          const newInternal = targetTotal / extZ;
          internalZoomRef.current = newInternal;
          targetZoomRef.current = targetTotal;
          visualZoomRef.current = targetTotal;
          setVisualZoom(targetTotal);

          const rect = svg.getBoundingClientRect();
          const mouseRatioX = (touch.clientX - rect.left) / (rect.width || 1);
          const mouseRatioY = (touch.clientY - rect.top) / (rect.height || 1);

          const bW = boundsRef.current.w;
          const bH = boundsRef.current.h;
          const oldW = bW / prevVisualZoom;
          const oldH = bH / prevVisualZoom;
          const newW = bW / targetTotal;
          const newH = bH / targetTotal;

          const rawDPanX = (oldW - newW) * (0.5 - mouseRatioX);
          const rawDPanY = (oldH - newH) * (0.5 - mouseRatioY);
          const rad = (-bearingRef.current * Math.PI) / 180;
          const dPanX = rawDPanX * Math.cos(rad) - rawDPanY * Math.sin(rad);
          const dPanY = rawDPanX * Math.sin(rad) + rawDPanY * Math.cos(rad);

          const nextPan = { x: panRef.current.x + dPanX, y: panRef.current.y + dPanY };
          panRef.current = nextPan;
          setPan(nextPan);
          setInternalZoom(newInternal);
          lastTapTimeRef.current = 0;
          touchGestureRef.current.mode = "NONE";
          return;
        }
        lastTapTimeRef.current = now;

        touchGestureRef.current = {
          mode: "PAN",
          initialDist: 0,
          initialAngle: 0,
          initialBearing: bearingRef.current,
          initialZoom: internalZoomRef.current,
          lastPos: { x: touch.clientX, y: touch.clientY },
          lastCenter: { x: touch.clientX, y: touch.clientY },
        };
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
        lastTouchTimeRef.current = now;
        velocityRef.current = { vx: 0, vy: 0 };
      } else if (e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = getDistance(t1, t2);
        const angle = getAngle(t1, t2);
        const center = getCenter(t1, t2);

        touchGestureRef.current = {
          mode: "PINCH_ROTATE",
          initialDist: dist || 1,
          initialAngle: angle,
          initialBearing: bearingRef.current,
          initialZoom: internalZoomRef.current,
          lastPos: center,
          lastCenter: center,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!svgRef.current) return;
      const gState = touchGestureRef.current;
      if (gState.mode === "NONE") return;

      const rect = svgRef.current.getBoundingClientRect();
      const bW = boundsRef.current.w;
      const bH = boundsRef.current.h;
      const curEffW = bW / (visualZoomRef.current || 1);
      const curEffH = bH / (visualZoomRef.current || 1);
      const uniformScale = Math.max(curEffW / (rect.width || 1), curEffH / (rect.height || 1));
      const now = Date.now();
      const dt = Math.max(1, now - (lastTouchTimeRef.current || now));

      if (e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = getDistance(t1, t2);
        const currentAngle = getAngle(t1, t2);
        const currentCenter = getCenter(t1, t2);

        if (gState.mode !== "PINCH_ROTATE" || !gState.initialDist) {
          touchGestureRef.current = {
            mode: "PINCH_ROTATE",
            initialDist: currentDist || 1,
            initialAngle: currentAngle,
            initialBearing: bearingRef.current,
            initialZoom: internalZoomRef.current,
            lastPos: currentCenter,
            lastCenter: currentCenter,
          };
          return;
        }

        const ratio = currentDist / gState.initialDist;
        const extZ = externalZoomRef.current || 1;
        const targetTotal = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, gState.initialZoom * ratio));
        const newInternal = targetTotal / extZ;
        internalZoomRef.current = newInternal;
        targetZoomRef.current = targetTotal;
        visualZoomRef.current = targetTotal;

        const rawDx = (currentCenter.x - gState.lastCenter.x) * uniformScale;
        const rawDy = (currentCenter.y - gState.lastCenter.y) * uniformScale;
        const nextPan = { x: panRef.current.x + rawDx, y: panRef.current.y + rawDy };
        panRef.current = nextPan;
        gState.lastCenter = currentCenter;

        const angleDelta = currentAngle - gState.initialAngle;
        let newBearing = (gState.initialBearing + angleDelta + 360) % 360;
        if (Math.abs(newBearing) < 2.0 || Math.abs(newBearing - 360) < 2.0) {
          newBearing = 0;
        }
        targetBearingRef.current = newBearing;
        bearingRef.current = newBearing;
        visualBearingRef.current = newBearing;

        if (now - lastBearingReportTimeRef.current > 40) {
          lastBearingReportTimeRef.current = now;
          onBearingChange?.(newBearing);
        }
        onUserPan?.();

        if (touchRafRef.current === null) {
          touchRafRef.current = requestAnimationFrame(() => {
            touchRafRef.current = null;
            setVisualZoom(visualZoomRef.current);
            setInternalZoom(internalZoomRef.current);
            setPan(panRef.current);
            setVisualBearing(visualBearingRef.current);
          });
        }
      } else if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];
        if (gState.mode === "PINCH_ROTATE") {
          touchGestureRef.current = {
            mode: "PAN",
            initialDist: 0,
            initialAngle: 0,
            initialBearing: bearingRef.current,
            initialZoom: internalZoomRef.current,
            lastPos: { x: touch.clientX, y: touch.clientY },
            lastCenter: { x: touch.clientX, y: touch.clientY },
          };
          lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
          lastTouchTimeRef.current = now;
          velocityRef.current = { vx: 0, vy: 0 };
          return;
        }

        const rawDx = (touch.clientX - gState.lastPos.x) * uniformScale;
        const rawDy = (touch.clientY - gState.lastPos.y) * uniformScale;
        const rad = (-bearingRef.current * Math.PI) / 180;
        const dx = rawDx * Math.cos(rad) - rawDy * Math.sin(rad);
        const dy = rawDx * Math.sin(rad) + rawDy * Math.cos(rad);

        const nextPan = { x: panRef.current.x + dx, y: panRef.current.y + dy };
        panRef.current = nextPan;

        const rawVx = ((touch.clientX - lastTouchPosRef.current.x) * uniformScale) / (dt / 16);
        const rawVy = ((touch.clientY - lastTouchPosRef.current.y) * uniformScale) / (dt / 16);
        const vx = rawVx * Math.cos(rad) - rawVy * Math.sin(rad);
        const vy = rawVx * Math.sin(rad) + rawVy * Math.cos(rad);
        velocityRef.current = { vx, vy };

        gState.lastPos = { x: touch.clientX, y: touch.clientY };
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
        lastTouchTimeRef.current = now;

        if (touchRafRef.current === null) {
          touchRafRef.current = requestAnimationFrame(() => {
            touchRafRef.current = null;
            setPan(panRef.current);
          });
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      isInteractingRef.current = false;
      if (touchRafRef.current !== null) {
        cancelAnimationFrame(touchRafRef.current);
        touchRafRef.current = null;
        setVisualZoom(visualZoomRef.current);
        setInternalZoom(internalZoomRef.current);
        setPan(panRef.current);
        setVisualBearing(visualBearingRef.current);
      }
      onBearingChange?.(bearingRef.current);
      const gState = touchGestureRef.current;
      if (e.touches.length === 0) {
        touchGestureRef.current = {
          mode: "NONE",
          initialDist: 0,
          initialAngle: 0,
          initialBearing: 0,
          initialZoom: 1,
          lastPos: { x: 0, y: 0 },
          lastCenter: { x: 0, y: 0 },
        };
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        touchGestureRef.current = {
          mode: "PAN",
          initialDist: 0,
          initialAngle: 0,
          initialBearing: bearingRef.current,
          initialZoom: internalZoomRef.current,
          lastPos: { x: touch.clientX, y: touch.clientY },
          lastCenter: { x: touch.clientX, y: touch.clientY },
        };
        lastTouchPosRef.current = { x: touch.clientX, y: touch.clientY };
        lastTouchTimeRef.current = Date.now();
        velocityRef.current = { vx: 0, vy: 0 };
      }
    };

    const handleTouchCancel = () => {
      isInteractingRef.current = false;
      if (touchRafRef.current !== null) {
        cancelAnimationFrame(touchRafRef.current);
        touchRafRef.current = null;
        setVisualZoom(visualZoomRef.current);
        setInternalZoom(internalZoomRef.current);
        setPan(panRef.current);
        setVisualBearing(visualBearingRef.current);
      }
      touchGestureRef.current = {
        mode: "NONE",
        initialDist: 0,
        initialAngle: 0,
        initialBearing: 0,
        initialZoom: 1,
        lastPos: { x: 0, y: 0 },
        lastCenter: { x: 0, y: 0 },
      };
      velocityRef.current = { vx: 0, vy: 0 };
    };

    svg.addEventListener("touchstart", handleTouchStart, { passive: false });
    svg.addEventListener("touchmove", handleTouchMove, { passive: false });
    svg.addEventListener("touchend", handleTouchEnd, { passive: false });
    svg.addEventListener("touchcancel", handleTouchCancel, { passive: false });

    return () => {
      svg.removeEventListener("touchstart", handleTouchStart);
      svg.removeEventListener("touchmove", handleTouchMove);
      svg.removeEventListener("touchend", handleTouchEnd);
      svg.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [onUserPan, onBearingChange]);



  const boundsCenterX = bounds.x + bounds.w / 2;
  const boundsCenterY = bounds.y + bounds.h / 2;

  // Canonical Camera Rotation & Navigation Tilt Pivot
  // During navigation follow mode, pivot directly around the user's world position (visualGps.x, visualGps.y).
  // This eliminates marker shifting across the screen when the map rotates or tilts!
  const rotationPivotX = (isFollowingUser || isNavigating) && targetGpsPos ? visualGps.x : boundsCenterX - pan.x;
  const rotationPivotY = (isFollowingUser || isNavigating) && targetGpsPos ? visualGps.y : boundsCenterY - pan.y;

  // Compute pure 2D SVG transformation string with smooth visual bearing
  // Oblique camera: foreshorten the ground plane vertically, exactly as a camera
  // pitched down by `tiltDegrees` would. 0deg = straight-down plan view.
  const mainTransform = useMemo(() => {
    const parts: string[] = [];
    if (Math.abs(visualBearing) > 0.05) {
      parts.push(`rotate(${visualBearing} ${rotationPivotX} ${rotationPivotY})`);
    }
    if (tiltDegrees > 0.05) {
      const k = Math.cos((tiltDegrees * Math.PI) / 180);
      parts.push(`translate(0 ${rotationPivotY}) scale(1 ${k}) translate(0 ${-rotationPivotY})`);
    }
    return parts.length ? parts.join(" ") : undefined;
  }, [visualBearing, rotationPivotX, rotationPivotY, tiltDegrees]);

  return (
    <svg
      ref={svgRef}
      viewBox={viewBoxStr}
      suppressHydrationWarning
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      style={{ willChange: "transform", transform: "translateZ(0)" }}
      className={cn(
        "h-full w-full touch-none select-none transition-cursor bg-[var(--map-bg)]",
        isDragging ? "cursor-grabbing" : "cursor-grab"
      )}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path
            d="M 32 0 L 0 0 0 32"
            fill="none"
            stroke="var(--map-grid)"
            strokeOpacity="0.75"
            strokeWidth="0.75"
          />
        </pattern>
        <linearGradient id="bldFillGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="bldRoofGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--map-roof-hi)" />
          <stop offset="60%" stopColor="var(--map-roof-mid)" />
          <stop offset="100%" stopColor="var(--map-roof-lo)" />
        </linearGradient>
        <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>

      {/* Background terrain covering all zoom levels */}
      <rect x="-100000" y="-100000" width="200000" height="200000" fill="var(--map-bg)" />
      <rect x="-100000" y="-100000" width="200000" height="200000" fill="url(#grid)" />

      {/* Main Transform Group (Supports Bearing Rotation & Visual Pitch Tilt around User Pivot) */}
      <g transform={mainTransform}>
        {campusGroundPath && !showSatellite && (
          <g className="pointer-events-none">
            <path
              d={campusGroundPath}
              fill="var(--map-green)"
              stroke="var(--map-green-edge)"
              strokeWidth="3"
              strokeLinejoin="round"
            />
            <path
              d={campusGroundPath}
              fill="none"
              stroke="var(--map-green-edge)"
              strokeOpacity="0.8"
              strokeWidth="1"
              strokeDasharray="10 7"
              strokeLinejoin="round"
            />
          </g>
        )}
        {satelliteTiles && (
          <g className="pointer-events-none">
            {satelliteTiles.tiles.map((tile) => (
              <image
                key={tile.key}
                href={tile.url}
                x={tile.x}
                y={tile.y}
                width={tile.width}
                height={tile.height}
                preserveAspectRatio="none"
              />
            ))}
            {/* Lift the vector layers off the photography so labels stay readable */}
            <rect
              x={effectiveX}
              y={effectiveY}
              width={effectiveW}
              height={effectiveH}
              fill="var(--map-bg)"
              opacity="0.18"
            />
          </g>
        )}
        {/* 1. Parking Lots Layer */}
        {categorizedScopeNodes.parking.map((pn) => (
          <g key={`parking-bay-${pn.id}`} transform={`translate(${pn.x}, ${pn.y})`}>
            {/* Parking Pad Area */}
            <rect
              x="-36"
              y="-24"
              width="72"
              height="48"
              rx="6"
              fill="var(--map-ink)"
              fillOpacity="0.08"
              stroke="var(--map-ink-soft)"
              strokeWidth="1.5"
              strokeDasharray="4 3"
            />
            {/* Parking Stall Divider Markings */}
            <line x1="-18" y1="-22" x2="-18" y2="22" stroke="var(--map-ink-faint)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <line x1="0" y1="-22" x2="0" y2="22" stroke="var(--map-ink-faint)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <line x1="18" y1="-22" x2="18" y2="22" stroke="var(--map-ink-faint)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            {/* Distinct Parking Badge */}
            <g transform="translate(0, -28)">
              <rect
                x="-32"
                y="-9"
                width="64"
                height="18"
                rx="9"
                fill="#0284c7"
                stroke="var(--map-halo)"
                strokeWidth="1.5"
                className="shadow-sm"
              />
              <text
                x="0"
                y="3"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="8.5"
                fontWeight="800"
                letterSpacing="0.02em"
              >
                Parking
              </text>
            </g>
          </g>
        ))}

        {/* 3. Roadway Network (Asphalt Roads with Dual Curbing & Centerline Markings) */}
        {scopeEdges
          .filter((e) => e.type === "ROAD" || e.pathType === "EV" || String(e.type).toUpperCase() === "ROAD" || String(e.pathType).toUpperCase() === "EV")
          .map((e) => {
            const from = findNode(e.fromNodeId ?? e.from);
            const to = findNode(e.toNodeId ?? e.to);
            if (!from || !to) return null;

            const baseId = e.id.replace(/_rev$/, "");
            const isBlocked = showObstacles && (
              blockedEdgeIds.has(e.id) ||
              blockedEdgeIds.has(baseId) ||
              blockedEdgeIds.has(`${baseId}_rev`)
            );

            return (
              <g key={`road-${e.id}`}>
                {/* Outer Curb Casing */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#ef4444" : "var(--map-road-edge)"}
                  strokeWidth={ROAD_WIDTH_PX + 5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.95}
                />
                {/* Asphalt Core Roadbed */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#fee2e2" : "var(--map-road)"}
                  strokeWidth={ROAD_WIDTH_PX}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Road Lane Centerline Divider */}
                {!isBlocked && (
                  <line
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke="var(--map-road-mark)"
                    strokeWidth={Math.max(1, PIXELS_PER_METER * 0.14)}
                    strokeDasharray={`${PIXELS_PER_METER * 2} ${PIXELS_PER_METER * 2}`}
                    strokeOpacity="0.8"
                    strokeLinecap="butt"
                  />
                )}
                {/* Direction chevrons, the way the campus is drawn by hand.
                    Spaced along the segment so long roads get several and short
                    links get none, rather than one arrow crowding a junction. */}
                {!isBlocked && (() => {
                  const dx = to.x - from.x;
                  const dy = to.y - from.y;
                  const len = Math.hypot(dx, dy);
                  const spacing = PIXELS_PER_METER * 28;
                  const count = Math.floor(len / spacing);
                  if (count < 1) return null;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
                  const size = Math.max(2.5, ROAD_WIDTH_PX * 0.3);
                  return Array.from({ length: count }, (_, i) => {
                    const t = (i + 1) / (count + 1);
                    return (
                      <g
                        key={`arw-${e.id}-${i}`}
                        transform={`translate(${from.x + dx * t}, ${from.y + dy * t}) rotate(${angle})`}
                        aria-hidden="true"
                      >
                        <path
                          d={`M ${-size},${-size * 0.8} L ${size * 0.75},0 L ${-size},${size * 0.8} Z`}
                          fill="var(--map-ink-faint)"
                          fillOpacity="0.75"
                        />
                      </g>
                    );
                  });
                })()}
              </g>
            );
          })}

        {/* 4. Pedestrian Walking Paths (Paved Walkways) */}
        {scopeEdges
          .filter((e) => e.type !== "ROAD" && e.pathType !== "EV" && String(e.type).toUpperCase() !== "ROAD" && String(e.pathType).toUpperCase() !== "EV")
          .map((e) => {
            const from = findNode(e.fromNodeId ?? e.from);
            const to = findNode(e.toNodeId ?? e.to);
            if (!from || !to) return null;

            const baseId = e.id.replace(/_rev$/, "");
            const isBlocked = showObstacles && (
              blockedEdgeIds.has(e.id) ||
              blockedEdgeIds.has(baseId) ||
              blockedEdgeIds.has(`${baseId}_rev`)
            );

            return (
              <g key={`walk-${e.id}`}>
                {/* Outer Paver Casing */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#ef4444" : "var(--map-path-edge)"}
                  strokeWidth={PATH_WIDTH_PX + 2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={0.95}
                />
                {/* Paved Stone Core */}
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={isBlocked ? "#fee2e2" : "var(--map-path)"}
                  strokeWidth={PATH_WIDTH_PX}
                  strokeDasharray={isBlocked ? "4 3" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            );
          })}

        {/* 5. N-Corner Polygon Buildings Geometry (Styled 1-to-1 with Admin Digital Twin Editor) */}
        <g>
          {memoizedBuildingGeometries.map(({ b, svgPath, roofPath, walls, height, roofCenter, centerPos, badgeWidth, footprintWidth, footprintHeight, storeys, buildingEvent, strokeColor, bName }) => (
            <g key={`bld-poly-${b.id}`} pointerEvents="none" className="select-none">
              {isTilted ? (
                <>
                  {/* Ground shadow, offset opposite the extrusion so blocks sit on the plan */}
                  <path
                    d={svgPath}
                    fill="var(--map-ground-shadow)"
                    transform={`translate(${height * 0.06}, ${height * 0.1})`}
                    style={{ filter: "blur(4px)" }}
                  />
                  {/* Surveyed footprint at ground level */}
                  <path
                    d={svgPath}
                    fill="var(--map-building-soft)"
                    fillOpacity="0.5"
                    stroke="var(--map-building-edge)"
                    strokeWidth="1"
                    strokeOpacity="0.5"
                    strokeLinejoin="round"
                  />
                  {/* Extruded walls, shaded per face from a fixed key light */}
                  {walls.map((facet, i) => (
                    <g key={`wall-${b.id}-${i}`}>
                      <path
                        d={facet.path}
                        fill="var(--map-wall-lit)"
                        fillOpacity={0.45 + facet.shade * 0.55}
                        stroke="var(--map-roof-edge)"
                        strokeOpacity="0.55"
                        strokeWidth="0.6"
                        strokeLinejoin="round"
                      />
                      {facet.bands.map((band, k) => (
                        <path
                          key={`band-${k}`}
                          d={band}
                          fill="none"
                          stroke="var(--map-roof-edge)"
                          strokeOpacity="0.4"
                          strokeWidth="0.7"
                        />
                      ))}
                    </g>
                  ))}
                  {/* Roof slab */}
                  <path
                    d={roofPath}
                    fill="var(--map-roof)"
                    stroke="var(--map-roof-edge)"
                    strokeWidth={buildingEvent ? "1.6" : "1.1"}
                    strokeLinejoin="round"
                  />
                  {/* Parapet: a thin inset line reads as a roof edge rather than a sticker */}
                  <path
                    d={roofPath}
                    fill="none"
                    stroke={buildingEvent?.color || "var(--map-building-edge)"}
                    strokeOpacity="0.5"
                    strokeWidth="0.8"
                    strokeLinejoin="round"
                    transform={`translate(${roofCenter.x}, ${roofCenter.y}) scale(0.93) translate(${-roofCenter.x}, ${-roofCenter.y})`}
                  />
                </>
              ) : (
                /* Plan view: a soft cast shadow and an inset seam keep the
                   footprints reading as buildings, not coloured rectangles. */
                <>
                  <path
                    d={svgPath}
                    fill="var(--map-ground-shadow)"
                    transform="translate(1.5, 2.5)"
                    style={{ filter: "blur(2.5px)" }}
                  />
                  <path
                    d={svgPath}
                    fill={buildingEvent?.color || "var(--map-building)"}
                    fillOpacity={buildingEvent ? 0.92 : planFillOpacity(storeys)}
                    stroke={strokeColor}
                    strokeWidth={buildingEvent ? "1.8" : "1.2"}
                    strokeDasharray={floorId !== "f-out" && !isGroundFloor ? "6 4" : undefined}
                    strokeLinejoin="round"
                  />
                  <path
                    d={svgPath}
                    fill="none"
                    stroke="#ffffff"
                    strokeOpacity="0.32"
                    strokeWidth="0.9"
                    strokeLinejoin="round"
                    transform={`translate(${centerPos.x}, ${centerPos.y}) scale(0.94) translate(${-centerPos.x}, ${-centerPos.y})`}
                  />
                </>
              )}

              {/* 4. Block name written inside the footprint, the way the campus
                     is labelled on paper: no pill, no pin, just the name in its
                     own box, sized so it always fits. */}
              {showNames && (() => {
                const box = fitLabel(bName, footprintWidth, footprintHeight);
                if (!box) return null;
                const anchor = isTilted ? roofCenter : centerPos;
                const top = -((box.lines.length - 1) * box.lineHeight) / 2;
                return (
                  <g
                    transform={`translate(${anchor.x}, ${anchor.y})`}
                    className="select-none pointer-events-none"
                  >
                    {box.lines.map((line, li) => (
                      <text
                        key={li}
                        x="0"
                        y={top + li * box.lineHeight + box.fontSize * 0.34}
                        textAnchor="middle"
                        fontSize={box.fontSize}
                        fontWeight="600"
                        fill="var(--map-building-ink)"
                        stroke="var(--map-halo)"
                        strokeWidth={box.fontSize * 0.16}
                        paintOrder="stroke"
                        strokeLinejoin="round"
                      >
                        {line}
                      </text>
                    ))}
                  </g>
                );
              })()}
            </g>
          ))}
        </g>

        {/* 6. Campus Gates Layer */}
        {categorizedScopeNodes.gates.map((gn) => {
          const gateName = gn.name || "Campus Gate";
          const gateWidth = Math.max(90, gateName.length * 7 + 28);
          return (
            <g key={`gate-${gn.id}`} transform={`translate(${gn.x}, ${gn.y})`}>
              {/* Gate Security Barrier Indicator */}
              <line x1="-18" y1="0" x2="18" y2="0" stroke="#f59e0b" strokeWidth="3" strokeDasharray="4 2" strokeLinecap="round" />
              {/* Left & Right Security Pillars */}
              <rect x="-22" y="-5" width="6" height="10" rx="2" fill="#d97706" stroke="var(--map-halo)" strokeWidth="1" />
              <rect x="16" y="-5" width="6" height="10" rx="2" fill="#d97706" stroke="var(--map-halo)" strokeWidth="1" />
              {/* Gate Badge */}
              {showNames && (
                <g transform="translate(0, -18)">
                  <rect
                    x={-gateWidth / 2}
                    y="-10"
                    width={gateWidth}
                    height="20"
                    rx="10"
                    fill="#d97706"
                    stroke="var(--map-halo)"
                    strokeWidth="1.5"
                    className="shadow-md"
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="9.5"
                    fontWeight="900"
                    letterSpacing="0.02em"
                  >
                    ⛩{gateName}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* 7. Building Entrances Layer */}
        {categorizedScopeNodes.entrances.map((en) => {
          const entranceName = en.name || "Entrance";
          const badgeW = Math.max(75, entranceName.length * 6 + 22);
          return (
            <g key={`entrance-${en.id}`} transform={`translate(${en.x}, ${en.y})`}>
              {/* Entrance Canopy Pill Badge */}
              {showNames && (
                <>
                  <rect
                    x={-badgeW / 2}
                    y="-9"
                    width={badgeW}
                    height="18"
                    rx="9"
                    fill="#059669"
                    stroke="var(--map-halo)"
                    strokeWidth="1.5"
                    className="shadow-sm"
                  />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="8.5"
                    fontWeight="800"
                  >
                    {entranceName}
                  </text>
                </>
              )}
            </g>
          );
        })}

        {/* Published Obstacles / Hazards Layer */}
        {showObstacles && (
          <g>
            {publishedData.obstacles
              .filter((obs) => {
                const obsFloor = obs.floorId ?? "f-out";
                if (floorId === "f-out") {
                  return obsFloor === "f-out";
                }
                if (obsFloor === floorId) return true;
                const obsFloorObj = publishedData.floors.find((f) => f.id === obsFloor);
                const curFloorObj = publishedData.floors.find((f) => f.id === floorId);
                return Boolean(
                  obsFloorObj &&
                  curFloorObj &&
                  obsFloorObj.ordinal === curFloorObj.ordinal &&
                  obsFloorObj.buildingId === curFloorObj.buildingId
                );
              })
              .map((obs) => {
                const targetNode = obs.nodeId ? findNode(obs.nodeId) : null;
                const obsX = obs.x ?? targetNode?.x ?? 400;
                const obsY = obs.y ?? targetNode?.y ?? 300;
                const isRouteOnly = Boolean(obs.edgeIds && obs.edgeIds.length > 0);
                const hasRadius = !isRouteOnly && typeof obs.radius === "number" && obs.radius > 0;
                const radius = hasRadius ? obs.radius! : 0;
                const label = obs.reason || "Hazard / Blocked";
                const labelText = isRouteOnly ? `⚠ ${label}` : `⚠ ${label}${hasRadius ? ` (${radius}px)` : ""}`;
                const pillWidth = Math.max(75, labelText.length * 6 + 26);

                return (
                  <g key={`user-obs-${obs.id}`} transform={`translate(${obsX}, ${obsY})`}>
                    {hasRadius && (
                      <circle
                        r={radius}
                        fill="rgba(239, 68, 68, 0.18)"
                        stroke="#ef4444"
                        strokeWidth="1.5"
                        strokeDasharray="4 3"
                        className="animate-pulse"
                      />
                    )}
                    <g transform={`translate(0, ${hasRadius ? -radius - 8 : -14})`}>
                      <rect
                        x={-pillWidth / 2}
                        y="-10"
                        width={pillWidth}
                        height="20"
                        rx="6"
                        fill="#ef4444"
                        fillOpacity="0.95"
                        stroke="var(--map-halo)"
                        strokeWidth="1.5"
                        className="shadow-md"
                      />
                      <text
                        x="0"
                        y="3"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="9.5"
                        fontWeight="bold"
                      >
                        {labelText}
                      </text>
                    </g>
                  </g>
                );
              })}
          </g>
        )}

        {/* Secondary / Alternative Route Lines (Muted Light Opacity with Interactive Hitbox) */}
        {alternativeRouteEdges.map((e, i) => {
          const from = findNode(e.from);
          const to = findNode(e.to);
          if (!from || !to) return null;

          return (
            <g
              key={`alt-edge-${e.id}-${i}`}
              onClick={onSelectAlternativeRoute}
              className="cursor-pointer group"
            >
              {/* Wide Invisible Hitbox for Easy Tap / Click on Canvas */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="transparent"
                strokeWidth={28}
                strokeLinecap="round"
              />
              {/* Outer Muted Glow */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--map-ink-soft)"
                strokeWidth={7}
                strokeOpacity={0.35}
                strokeLinecap="round"
                strokeDasharray="6 4"
              />
              {/* Core Alternative Line */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--map-ink-faint)"
                strokeWidth={4}
                strokeOpacity={0.85}
                strokeLinecap="round"
                strokeDasharray="6 4"
                className="group-hover:stroke-indigo-500 transition-colors"
              />
            </g>
          );
        })}

        {/* Alternative Route Midpoint Interactive Pill */}
        {alternativeRoute && alternativeBadgePos && (
          <g
            transform={`translate(${alternativeBadgePos.x}, ${alternativeBadgePos.y - 14})`}
            onClick={onSelectAlternativeRoute}
            className="cursor-pointer select-none group"
          >
            <rect
              x="-56"
              y="-11"
              width="112"
              height="22"
              rx="11"
              fill="var(--map-surface)"
              stroke="var(--map-ink-soft)"
              strokeWidth="1.5"
              className="shadow-md group-hover:fill-indigo-50 group-hover:stroke-indigo-600 transition-colors"
            />
            <text
              x="0"
              y="3.5"
              textAnchor="middle"
              fill="var(--map-ink)"
              fontSize="9"
              fontWeight="800"
              className="pointer-events-none"
            >
              Alt Route · {Math.round(alternativeRoute.distance)}m
            </text>
          </g>
        )}

        {/* Stable Vibrant Route Highlight Lines with Completed vs Active Segments */}
        {routeEdges.map((e, i) => {
          const from = findNode(e.from);
          const to = findNode(e.to);
          if (!from || !to) return null;

          const baseId = e.id.replace(/_rev$/, "");
          const isSegmentBlocked =
            blockedEdgeIds.has(e.id) ||
            blockedEdgeIds.has(baseId) ||
            blockedEdgeIds.has(`${baseId}_rev`);

          const isEvEdge = e.pathType === "EV";

          // Determine if this segment is already completed (past the current active segment)
          const routeEdgeIndex = route?.edges
            ? route.edges.findIndex((re) => re.id === e.id || (re.from === e.from && re.to === e.to) || (re.from === e.to && re.to === e.from))
            : -1;
          const isCompletedSegment = isNavigating && routeEdgeIndex >= 0 && routeEdgeIndex < currentNavSegIdx;

          const strokeGlow = isSegmentBlocked
            ? "#ef4444"
            : isCompletedSegment
              ? "var(--map-ink-faint)"
              : isEvEdge
                ? "#059669"
                : "#2563eb";

          const strokeCore = isSegmentBlocked
            ? "#ef4444"
            : isCompletedSegment
              ? "var(--map-ink-faint)"
              : isEvEdge
                ? "#10b981"
                : "var(--map-route)";

          return (
            <g key={`r-group-${e.id}-${i}`}>
              {/* Outer Glow Line */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--map-halo)"
                strokeWidth={isEvEdge ? 13 : 11}
                strokeOpacity={isCompletedSegment ? 0.35 : 0.9}
                strokeLinecap="round"
              />
              {/* Inner Solid High-Contrast Path Line */}
              <line
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke={strokeCore}
                strokeWidth={isEvEdge ? 6 : 5}
                strokeOpacity={isCompletedSegment ? 0.4 : 1}
                /* Dotted trail: round caps on a zero-length dash draw true dots */
                strokeDasharray={`0.1 ${isEvEdge ? 11 : 9}`}
                strokeLinecap="round"
              />
            </g>
          );
        })}

        {/* Multimodal Transfer Node Badge: Only show when EV Mode is selected and transitions to a pedestrian-only walkway */}
        {route?.transferNodeId && (route.travelMode === "EV" || route.travelMode === "MULTIMODAL") && (route.evDistance ?? 0) > 0 && (() => {
          const transNode = findNode(route.transferNodeId);
          if (!transNode || (transNode.floorId !== floorId && floorId !== "f-out")) return null;
          return (
            <g transform={`translate(${transNode.x}, ${transNode.y - 18})`}>
              <rect
                x="-52"
                y="-10"
                width="104"
                height="20"
                rx="10"
                fill="#059669"
                stroke="var(--map-halo)"
                strokeWidth="1.5"
                className="shadow-lg"
              />
              <text
                x="0"
                y="3.5"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="9"
                fontWeight="800"
              >
                Switch to Walk
              </text>
            </g>
          );
        })()}

        {/* Nodes & Named Labels (Render only user-visible nodes on user map) */}
        {scopeNodes
          .filter((n) => n.visibleToUser !== false && !allDestinations.some((d) => d.nodeId === n.id) && n.type !== "GATE" && n.type !== "PARKING" && n.type !== "BUILDING_ENTRANCE")
          .map((n) => {
            const onRoute = routeNodes.some((rn) => rn.id === n.id);
            const isDest = destination?.id === n.id;
            const isStair = n.type === "STAIR" || (n.name && n.name.toLowerCase().includes("stair"));
            const isLift = n.type === "LIFT" || (n.name && n.name.toLowerCase().includes("lift"));
            const isRoom = n.type === "ROOM" || n.type === "LABORATORY" || n.type === "OFFICE" || n.type === "WASHROOM";
            const isStairOrLift = isStair || isLift;

            // When nodeDisplayMode === "HIDDEN", keep only on-route nodes & destination nodes visible
            const shouldRenderCircle = nodeDisplayMode !== "HIDDEN" || onRoute || isDest;
            if (!shouldRenderCircle) return null;

            const shouldRenderName = nodeDisplayMode === "ALL" && visibleLabelIds.has(`node:${n.id}`);

            const nodeColor = isDest
              ? "#10b981"
              : isStairOrLift
                ? "#f59e0b"
                : onRoute
                  ? "#2563eb"
                  : isRoom
                    ? "#8b5cf6"
                    : "var(--map-ink-soft)";
            const nodeRadius = isDest ? 9 : isStairOrLift ? 7 : isRoom ? 6 : onRoute ? 6.5 : 4.5;

            const rawName = n.name || "";
            const cleanedName = isStairOrLift ? cleanStairLiftDisplayName(rawName) : rawName;
            const displayName = (isStair ? `𓊍 ${cleanedName}` : isLift ? `🛗 ${cleanedName}` : rawName);
            const labelWidth = Math.max(70, displayName.length * 7 + (isStair ? 20 : n.photoUrl ? 20 : 16));
            const badgeHeight = isStairOrLift ? 22 : 19;

            const labelY = isStairOrLift
              ? n.y - 20
              : n.y + (isDest ? 20 : onRoute ? 17 : 14);

            // Campuses that keep their places as named nodes rather than
            // destination records still need a tappable detail sheet.
            const isNamedPlace = rawName.trim().length > 0 && !isStairOrLift;

            return (
              <g
                key={n.id}
                className={isNamedPlace ? "cursor-pointer" : undefined}
                onClick={
                  isNamedPlace && onSelectDestination
                    ? () => {
                        onSelectDestination({
                          id: `node:${n.id}`,
                          name: rawName,
                          category: nodeCategoryLabel(n.type),
                          floorId: n.floorId,
                          nodeId: n.id,
                          aliases: [rawName],
                          ...(n.photoUrl ? { photoUrl: n.photoUrl } : {}),
                        } as Destination);
                      }
                    : undefined
                }
              >
                {isNamedPlace && (
                  /* Invisible, finger-sized hit area around the marker */
                  <circle cx={n.x} cy={n.y} r={16} fill="transparent" />
                )}
                {isStairOrLift && (
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={10}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="2"
                    strokeOpacity="0.4"
                    className="animate-pulse"
                  />
                )}

                <circle
                  cx={n.x}
                  cy={n.y}
                  r={nodeRadius}
                  fill={nodeColor}
                  stroke="var(--map-halo)"
                  strokeWidth={isDest ? 2.5 : isStairOrLift ? 2 : onRoute ? 2 : 1.5}
                  opacity={onRoute || isDest || isStairOrLift ? 1 : 0.85}
                  className={isDest ? "animate-pulse" : undefined}
                />

                {rawName.length > 0 && shouldRenderName && (
                  <g transform={`translate(${n.x}, ${labelY})`}>
                    <rect
                      x={-labelWidth / 2}
                      y={-badgeHeight / 2}
                      width={labelWidth}
                      height={badgeHeight}
                      rx="5"
                      fill="var(--map-surface)"
                      stroke={isDest ? "#10b981" : isStairOrLift ? "#f59e0b" : onRoute ? "#2563eb" : "var(--map-ink-faint)"}
                      strokeWidth="1.5"
                      className="shadow-md"
                    />
                    <text
                      x="0"
                      y="3.5"
                      textAnchor="middle"
                      fill={isDest ? "#065f46" : isStairOrLift ? "#92400e" : onRoute ? "#1e40af" : "var(--map-ink)"}
                      fontSize="9.5"
                      fontWeight="bold"
                    >
                      {displayName}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

        {/* Floor Transition Badges for Stair & Lift Nodes on Route */}
        {route && nodeDisplayMode !== "HIDDEN" &&
          routeNodes.map((n, idx) => {
            if (n.type !== "STAIR" && n.type !== "LIFT") return null;
            const nodeIdx = route.nodes.findIndex((rn) => rn.id === n.id);
            if (nodeIdx === -1) return null;

            const nextDifferentFloorNode = route.nodes.slice(nodeIdx + 1).find((rn) => rn.floorId !== n.floorId);
            if (!nextDifferentFloorNode) return null;

            const badgeText = `${n.type === "LIFT" ? "Take Lift" : "Take Stairs"} ↗`;
            const badgeWidth = badgeText.length * 7.5 + 20;

            return (
              <g key={`stair-badge-${n.id}-${idx}`} transform={`translate(${n.x}, ${n.y - 45})`}>
                <rect
                  x={-badgeWidth / 2}
                  y="-12"
                  width={badgeWidth}
                  height="24"
                  rx="7"
                  fill="#0284c7"
                  stroke="var(--map-halo)"
                  strokeWidth="2"
                  className="shadow-lg"
                />
                <text
                  x="0"
                  y="3.5"
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="800"
                >
                  {badgeText}
                </text>
              </g>
            );
          })}

        {/* Destinations Labels & Markers */}
        {allDestinations.map((d) => {
          const linkedNode = allNodes.find((n) => n.id === d.nodeId);
          if (!linkedNode || (!isNodeOnActiveFloor(linkedNode) && floorId !== "f-out")) return null;
          if (linkedNode.visibleToUser === false) return null;
          const isSelected = toSelected?.id === d.id || toSelected?.nodeId === linkedNode.id;
          const showLabel = isSelected || visibleLabelIds.has(`dest:${d.id}`);
          const icon = (d.category || "").toLowerCase().includes("lab") ? "🧪" : "🚪";
          const nameStr = `${icon} ${d.name}${d.roomNumber ? ` (#${d.roomNumber})` : ""}`;
          const pillWidth = Math.max(50, nameStr.length * 6.2 + 18);
          return (
            <g
              key={d.id}
              transform={`translate(${linkedNode.x}, ${linkedNode.y})`}
              onClick={() => {
                onUserPan?.();
                const centerX = bounds.x + bounds.w / 2;
                const centerY = bounds.y + bounds.h / 2;
                setPan({ x: centerX - linkedNode.x, y: centerY - linkedNode.y });
                if (onSelectDestination) onSelectDestination(d);
              }}
              className="cursor-pointer select-none transition-transform active:scale-95"
            >
              {showLabel ? (
                <>
                  <rect
                    x={-pillWidth / 2}
                    y="-10"
                    width={pillWidth}
                    height="20"
                    rx="6"
                    fill={isSelected ? "#10b981" : "var(--map-surface)"}
                    stroke={isSelected ? "#059669" : "#8b5cf6"}
                    strokeWidth={isSelected ? "2" : "1.5"}
                    className="shadow-md"
                  />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fill={isSelected ? "#ffffff" : "var(--map-ink)"}
                    fontSize="10"
                    fontWeight="700"
                  >
                    {nameStr}
                  </text>
                </>
              ) : (
                /* Crowded out by a higher-priority label — keep the place tappable as a dot */
                <>
                  <title>{d.name}</title>
                  <circle r="5.5" fill="var(--map-surface)" stroke="#8b5cf6" strokeWidth="1.75" />
                  <circle r="2" fill="#8b5cf6" />
                </>
              )}
            </g>
          );
        })}

        {/* Smoothed Device GPS Live Marker with Directional Cone & Accuracy Ring */}
        {targetGpsPos && gps?.isGpsActive && (
          <g transform={`translate(${visualGps.x}, ${visualGps.y})`}>
            {/* Accuracy Ring */}
            <circle
              r={Math.max(14, (gps?.accuracy || 8) * PIXELS_PER_METER)}
              fill="rgba(59, 130, 246, 0.15)"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              className="animate-pulse"
            />
            {/* Directional Cone Pointer with Smoothed Heading */}
            <path
              d="M 0 -18 L 8 4 L 0 0 L -8 4 Z"
              fill="#2563eb"
              transform={`rotate(${visualGps.heading || 0})`}
            />
            {/* Pulsing Outer Ring */}
            <circle r="13" fill="rgba(37, 99, 235, 0.25)" className="animate-ping" />
            {/* Solid Blue Core GPS Dot */}
            <circle r="8.5" fill="#2563eb" stroke="var(--map-halo)" strokeWidth="2.5" className="shadow-lg" />
            <circle r="3.5" fill="#ffffff" />

            {/* YOU ARE HERE Badge */}
            <g transform="translate(0, 22)">
              <rect
                x="-44"
                y="-10"
                width="88"
                height="20"
                rx="10"
                fill="#1d4ed8"
                stroke="var(--map-halo)"
                strokeWidth="1.5"
                className="shadow-lg"
              />
              <text
                x="0"
                y="3.5"
                textAnchor="middle"
                fill="#ffffff"
                fontSize="9"
                fontWeight="800"
                letterSpacing="0.03em"
              >
                YOU ARE HERE
              </text>
            </g>
          </g>
        )}

        {/* Dynamic Connector Line: Live GPS to Nearest Route Entry Node */}
        {targetGpsPos && gps?.isGpsActive && fromSelected?.id === "dest-live-user-location" && route && route.nodes.length > 0 && (route.nodes[0].floorId === floorId || floorId === "f-out") && (
          <g pointerEvents="none">
            <line
              x1={visualGps.x}
              y1={visualGps.y}
              x2={route.nodes[0].x}
              y2={route.nodes[0].y}
              stroke="#3b82f6"
              strokeWidth="2"
              strokeDasharray="4 4"
              strokeOpacity="0.85"
              strokeLinecap="round"
            />
            <circle
              cx={route.nodes[0].x}
              cy={route.nodes[0].y}
              r="3.5"
              fill="#3b82f6"
              stroke="var(--map-halo)"
              strokeWidth="1.5"
            />
          </g>
        )}

        {/* Fallback Live Position marker (e.g. simulated route navigation) */}
        {showLiveHere && livePosition && !gps?.isGpsActive && (
          <g>
            <circle
              cx={livePosition.x}
              cy={livePosition.y}
              r={12}
              fill="rgba(37, 99, 235, 0.18)"
              stroke="#3b82f6"
              strokeWidth={1}
            />
            <circle
              cx={livePosition.x}
              cy={livePosition.y}
              r={5.5}
              fill="#2563eb"
              stroke="var(--map-halo)"
              strokeWidth={2}
            />
          </g>
        )}

        {progress !== undefined && route && (
          <g>
            <rect x="20" y="20" width="200" height="6" rx="3" fill="rgb(var(--muted))" />
            <rect
              x="20"
              y="20"
              width={200 * progress}
              height="6"
              rx="3"
              fill="rgb(var(--primary))"
              className="transition-all duration-300"
            />
          </g>
        )}
      </g>

      {/* Map furniture: fixed to the view, never rotated or panned with the plan */}
      <g
        transform={`translate(${effectiveX + effectiveW * 0.02}, ${effectiveY + effectiveH * 0.965})`}
        pointerEvents="none"
        className="select-none"
      >
        <line
          x1="0"
          y1="0"
          x2={scaleBar.length}
          y2="0"
          stroke="var(--map-ink)"
          strokeWidth={effectiveW * 0.0018}
          strokeLinecap="butt"
        />
        <line x1="0" y1={-effectiveH * 0.006} x2="0" y2={effectiveH * 0.006} stroke="var(--map-ink)" strokeWidth={effectiveW * 0.0018} />
        <line
          x1={scaleBar.length}
          y1={-effectiveH * 0.006}
          x2={scaleBar.length}
          y2={effectiveH * 0.006}
          stroke="var(--map-ink)"
          strokeWidth={effectiveW * 0.0018}
        />
        <text
          x={scaleBar.length / 2}
          y={-effectiveH * 0.012}
          textAnchor="middle"
          fill="var(--map-ink)"
          fontSize={effectiveH * 0.022}
          fontWeight="700"
        >
          {scaleBar.metres} m
        </text>
      </g>

      <g
        transform={`translate(${effectiveX + effectiveW * 0.96}, ${effectiveY + effectiveH * 0.94}) rotate(${-bearing})`}
        pointerEvents="none"
        className="select-none"
      >
        <path
          d={`M 0 ${-effectiveH * 0.03} L ${effectiveW * 0.012} ${effectiveH * 0.012} L 0 ${effectiveH * 0.004} L ${-effectiveW * 0.012} ${effectiveH * 0.012} Z`}
          fill="var(--map-ink)"
          fillOpacity="0.85"
        />
        <text
          x="0"
          y={effectiveH * 0.038}
          textAnchor="middle"
          fill="var(--map-ink)"
          fontSize={effectiveH * 0.024}
          fontWeight="800"
        >
          N
        </text>
      </g>
    </svg>
  );
}
