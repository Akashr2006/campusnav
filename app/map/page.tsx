"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Navigation2, ZoomIn, ZoomOut, RotateCcw, RotateCw, Compass, Locate } from "lucide-react";
import { useToast } from "@/shared/components/ui/toast";
import { campusStore } from "@/shared/lib/campus-store";
import type { Building, Floor, Node, Edge, Destination, Obstacle } from "@/shared/data/campus";
import { shortestPath as computeShortestPath } from "@/features/navigation/services/graph";
import { getObstructedEdgeIds } from "@/lib/routing/graph";
import { generateDirections, type DirectionStep } from "@/lib/routing/directions";
import { VisitorSearchSheet } from "./components/search-sheet";
import { NavigationView } from "./components/navigation-view";
import { getValidNavigationDestinations } from "@/shared/lib/destination-utils";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { GpsStatusIndicator } from "@/features/location/components/gps-status-indicator";
import { getBuildingCanvasPoints, getBuildingCenter, getPolygonPointsString } from "@/lib/geo/building-geometry";
import { computeDesktopWheelMultiplier } from "@/shared/lib/map-config";

// Pan/Zoom/Rotation types
type Transform = { x: number; y: number; scale: number; rotation: number };
const MIN_SCALE = 0.2;
const MAX_SCALE = 8;
const ZOOM_STEP = 0.15;

export default function VisitorPage() {
  const [publishedData, setPublishedData] = useState<{
    buildings: Building[];
    floors: Floor[];
    nodes: Node[];
    edges: Edge[];
    destinations: Destination[];
    obstacles: Obstacle[];
  }>(() => campusStore.getPublishedData());

  const [version, setVersion] = useState(() => campusStore.getPublishedVersion());
  const [activeFloorId, setActiveFloorId] = useState<string>("f-out");

  // Navigation State
  const [selectedDest, setSelectedDest] = useState<Destination | null>(null);
  const [routeNodes, setRouteNodes] = useState<Node[]>([]);
  const [directionSteps, setDirectionSteps] = useState<DirectionStep[]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);

  // UI Panel Modes
  const [activePanel, setActivePanel] = useState<"SEARCH" | "NAVIGATE" | "IDLE">("SEARCH");

  const validNavDestinations = useMemo(() => {
    return getValidNavigationDestinations(publishedData);
  }, [publishedData]);

  // Pan / Zoom / Rotation State
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1, rotation: 0 });
  const isPanning = useRef(false);
  const isRotating = useRef(false);
  const panStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });
  const rotateStart = useRef({ x: 0, initialRotation: 0 });
  const svgContainerRef = useRef<HTMLDivElement>(null);

  const { toast } = useToast();
  const gps = useVisitorGps();

  // Handle Step Selection & Automatic Floor Switch
  const handleStepSelect = useCallback(
    (step: DirectionStep, idx: number) => {
      setActiveStepIndex(idx);
      const targetNode = publishedData.nodes.find((n) => n.id === step.targetNodeId);
      if (targetNode) {
        if (targetNode.floorId && targetNode.floorId !== activeFloorId) {
          const targetFloor = publishedData.floors.find((f) => f.id === targetNode.floorId);
          const floorName =
            targetFloor?.name ?? (targetNode.floorId === "f-out" ? "Outdoor Map" : targetNode.floorId);
          setActiveFloorId(targetNode.floorId);
          toast({
            type: "info",
            title: "Auto-Switched Floor",
            description: `Map auto-switched to ${floorName} for active navigation step.`,
          });
        }
        // Pan SVG container to center on targetNode
        const container = svgContainerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const targetScale = 1.2;
          setTransform((prev) => ({
            x: rect.width / 2 - targetNode.x * targetScale,
            y: rect.height / 2 - targetNode.y * targetScale,
            scale: targetScale,
            rotation: prev.rotation,
          }));
        }
      }
    },
    [publishedData.nodes, publishedData.floors, activeFloorId, toast]
  );

  // Auto-play live walk simulation timer
  useEffect(() => {
    if (!isSimulating || directionSteps.length === 0) return;
    const interval = setInterval(() => {
      setActiveStepIndex((prev) => {
        const nextIdx = prev + 1;
        if (nextIdx >= directionSteps.length) {
          setIsSimulating(false);
          toast({
            type: "success",
            title: "Destination Arrived",
            description: `You have arrived at ${selectedDest?.name ?? "your destination"}.`,
          });
          return prev;
        }
        const step = directionSteps[nextIdx];
        handleStepSelect(step, nextIdx);
        return nextIdx;
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [isSimulating, directionSteps, handleStepSelect, selectedDest, toast]);

  // Load Published Graph Snapshot
  const fetchPublishedGraph = async () => {
    try {
      const res = await fetch(`/api/published-graph?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache, no-store, must-revalidate" },
      });
      if (res.ok) {
        const json = await res.json();
        const graph = json.graph;
        if (graph) {
          setPublishedData(graph);
          setVersion(json.version ? `v${json.version}` : "v1.0");
          return;
        }
      }

      const storePub = await campusStore.fetchPublishedData(true);
      setPublishedData(storePub);
      setVersion(campusStore.getPublishedVersion());
    } catch {
      const storePub = campusStore.getPublishedData();
      setPublishedData(storePub);
      setVersion(campusStore.getPublishedVersion());
    }
  };

  useEffect(() => {
    fetchPublishedGraph();

    // Subscribe to memory store publish updates instantly
    const unsubStore = campusStore.subscribe(() => {
      const storePub = campusStore.getPublishedData();
      const storeVer = campusStore.getPublishedVersion();
      setPublishedData(storePub);
      setVersion(storeVer);
    });

    // Subscribe to Realtime SSE Stream
    const eventSource = new EventSource("/api/campus/stream");
    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.version) {
          toast({
            type: "info",
            title: "Live Map Updated",
            description: `Map version ${payload.version} published. Syncing route...`,
          });
          fetchPublishedGraph();
        }
      } catch {
        // SSE parsing
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      unsubStore();
      eventSource.close();
    };
  }, [toast]);

  const wheelRafRef = useRef<number | null>(null);
  const targetTransformRef = useRef(transform);
  targetTransformRef.current = transform;

  // Wheel zoom (Instant, Responsive & Cursor-Anchored)
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = svgContainerRef.current;
    if (!container) return;

    const zoomMultiplier = computeDesktopWheelMultiplier(e.deltaY, e.ctrlKey, e.deltaMode);

    const prev = targetTransformRef.current;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev.scale * zoomMultiplier));
    if (Math.abs(newScale - prev.scale) < 0.0001) return;

    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const scaleDiff = newScale / prev.scale;
    const newX = mouseX - scaleDiff * (mouseX - prev.x);
    const newY = mouseY - scaleDiff * (mouseY - prev.y);

    targetTransformRef.current = { x: newX, y: newY, scale: newScale, rotation: prev.rotation };

    if (wheelRafRef.current === null) {
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = null;
        setTransform(targetTransformRef.current);
      });
    }
  }, []);

  // Attach wheel listener with { passive: false } so we can preventDefault
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container) return;
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      if (wheelRafRef.current !== null) {
        cancelAnimationFrame(wheelRafRef.current);
      }
    };
  }, [handleWheel]);

  const transformRef = useRef(transform);
  transformRef.current = transform;

  const touchStateRef = useRef<{
    mode: "NONE" | "PAN" | "PINCH";
    initialDist: number;
    initialScale: number;
    lastPos: { x: number; y: number };
    lastCenter: { x: number; y: number };
    lastTapTime: number;
    initialAngle?: number;
    initialRotation?: number;
  }>({
    mode: "NONE",
    initialDist: 0,
    initialScale: 1,
    lastPos: { x: 0, y: 0 },
    lastCenter: { x: 0, y: 0 },
    lastTapTime: 0,
  });

  // Native Non-Passive Touch Listeners for mobile 2-finger pinch zoom & 1-finger pan
  useEffect(() => {
    const container = svgContainerRef.current;
    if (!container) return;

    const getDistance = (t1: Touch, t2: Touch) =>
      Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);

    const getCenter = (t1: Touch, t2: Touch) => ({
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2,
    });

    const handleTouchStart = (e: TouchEvent) => {
      const now = Date.now();
      const tState = touchStateRef.current;

      if (e.touches.length === 1) {
        const touch = e.touches[0];
        // Double-tap zoom detection (<300ms)
        if (now - tState.lastTapTime < 300) {
          e.preventDefault();
          const rect = container.getBoundingClientRect();
          const mouseX = touch.clientX - rect.left;
          const mouseY = touch.clientY - rect.top;
          setTransform((prev) => {
            const newScale = Math.min(MAX_SCALE, prev.scale * 1.5);
            const scaleDiff = newScale / prev.scale;
            return {
              x: mouseX - scaleDiff * (mouseX - prev.x),
              y: mouseY - scaleDiff * (mouseY - prev.y),
              scale: newScale,
              rotation: prev.rotation,
            };
          });
          tState.lastTapTime = 0;
          tState.mode = "NONE";
          return;
        }
        tState.lastTapTime = now;
        tState.mode = "PAN";
        tState.lastPos = { x: touch.clientX, y: touch.clientY };
      } else if (e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = getDistance(t1, t2);
        const center = getCenter(t1, t2);
        const angle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);

        tState.mode = "PINCH";
        tState.initialDist = dist || 1;
        tState.initialScale = transformRef.current.scale;
        tState.initialAngle = angle;
        tState.initialRotation = transformRef.current.rotation;
        tState.lastCenter = center;
        tState.lastPos = center;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      const tState = touchStateRef.current;
      if (tState.mode === "NONE") return;

      if (e.touches.length >= 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const currentDist = getDistance(t1, t2);
        const currentCenter = getCenter(t1, t2);
        const currentAngle = Math.atan2(t2.clientY - t1.clientY, t2.clientX - t1.clientX) * (180 / Math.PI);

        if (tState.mode !== "PINCH" || !tState.initialDist) {
          tState.mode = "PINCH";
          tState.initialDist = currentDist || 1;
          tState.initialScale = transformRef.current.scale;
          tState.initialAngle = currentAngle;
          tState.initialRotation = transformRef.current.rotation;
          tState.lastCenter = currentCenter;
          tState.lastPos = currentCenter;
          return;
        }

        const ratio = currentDist / tState.initialDist;
        const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, tState.initialScale * ratio));

        const angleDiff = currentAngle - (tState.initialAngle ?? currentAngle);
        let newRot = ((tState.initialRotation ?? 0) + angleDiff + 360) % 360;
        if (Math.abs(newRot) < 2.5 || Math.abs(newRot - 360) < 2.5) {
          newRot = 0;
        }

        const dx = currentCenter.x - tState.lastCenter.x;
        const dy = currentCenter.y - tState.lastCenter.y;

        setTransform((prev) => {
          const rect = container.getBoundingClientRect();
          const mouseX = currentCenter.x - rect.left;
          const mouseY = currentCenter.y - rect.top;
          const scaleDiff = newScale / (prev.scale || 1);
          const newX = mouseX - scaleDiff * (mouseX - prev.x) + dx;
          const newY = mouseY - scaleDiff * (mouseY - prev.y) + dy;
          return { x: newX, y: newY, scale: newScale, rotation: newRot };
        });

        tState.lastCenter = currentCenter;
      } else if (e.touches.length === 1) {
        e.preventDefault();
        const touch = e.touches[0];

        if (tState.mode === "PINCH") {
          tState.mode = "PAN";
          tState.lastPos = { x: touch.clientX, y: touch.clientY };
          return;
        }

        const dx = touch.clientX - tState.lastPos.x;
        const dy = touch.clientY - tState.lastPos.y;

        setTransform((prev) => ({
          ...prev,
          x: prev.x + dx,
          y: prev.y + dy,
        }));

        tState.lastPos = { x: touch.clientX, y: touch.clientY };
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const tState = touchStateRef.current;
      if (e.touches.length === 0) {
        tState.mode = "NONE";
        delete tState.initialAngle;
        delete tState.initialRotation;
      } else if (e.touches.length === 1) {
        const touch = e.touches[0];
        tState.mode = "PAN";
        tState.lastPos = { x: touch.clientX, y: touch.clientY };
        delete tState.initialAngle;
        delete tState.initialRotation;
      }
    };

    const handleTouchCancel = () => {
      touchStateRef.current.mode = "NONE";
      delete touchStateRef.current.initialAngle;
      delete touchStateRef.current.initialRotation;
    };

    container.addEventListener("touchstart", handleTouchStart, { passive: false });
    container.addEventListener("touchmove", handleTouchMove, { passive: false });
    container.addEventListener("touchend", handleTouchEnd, { passive: false });
    container.addEventListener("touchcancel", handleTouchCancel, { passive: false });

    return () => {
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", handleTouchEnd);
      container.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, []);

  // Pointer pan & rotate
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 2 || e.altKey || e.shiftKey) {
      e.preventDefault();
      isRotating.current = true;
      rotateStart.current = { x: e.clientX, initialRotation: transform.rotation };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0 && e.pointerType !== "touch") return;
    isPanning.current = true;
    panStart.current = {
      x: e.clientX,
      y: e.clientY,
      tx: transform.x,
      ty: transform.y,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [transform.x, transform.y, transform.rotation]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (isRotating.current) {
      const dx = e.clientX - rotateStart.current.x;
      const newRot = (rotateStart.current.initialRotation + dx * 0.45) % 360;
      setTransform((prev) => ({ ...prev, rotation: newRot }));
      return;
    }
    if (!isPanning.current) return;
    const dx = e.clientX - panStart.current.x;
    const dy = e.clientY - panStart.current.y;
    setTransform((prev) => ({
      ...prev,
      x: panStart.current.tx + dx,
      y: panStart.current.ty + dy,
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    isPanning.current = false;
    isRotating.current = false;
  }, []);

  // Zoom & Rotation control buttons
  const zoomIn = () =>
    setTransform((prev) => {
      const newScale = Math.min(MAX_SCALE, prev.scale * (1 + ZOOM_STEP));
      return { ...prev, scale: newScale };
    });

  const zoomOut = () =>
    setTransform((prev) => {
      const newScale = Math.max(MIN_SCALE, prev.scale * (1 - ZOOM_STEP));
      return { ...prev, scale: newScale };
    });

  const rotateCcw = () =>
    setTransform((prev) => ({ ...prev, rotation: (prev.rotation - 15 + 360) % 360 }));

  const rotateCw = () =>
    setTransform((prev) => ({ ...prev, rotation: (prev.rotation + 15) % 360 }));

  const resetRotation = () =>
    setTransform((prev) => ({ ...prev, rotation: 0 }));

  const resetView = () => setTransform({ x: 0, y: 0, scale: 1, rotation: 0 });

  // Compute Shortest Route when destination changes
  const handleCalculateRoute = (dest: Destination) => {
    setSelectedDest(dest);
    const startNode = publishedData.nodes[0];

    if (!startNode) {
      toast({ type: "error", title: "Route Error", description: "No start node found in published graph." });
      return;
    }

    const route = computeShortestPath(startNode.id, dest.id);

    if (!route) {
      toast({ type: "error", title: "No Route Found", description: "No valid path available to destination." });
      return;
    }

    if (route.hasObstacles) {
      toast({
        type: "warning",
        title: "All Routes Have Obstacles",
        description: "No 100% obstacle-free path exists. Routing through the least obstructed path.",
      });
    }

    setRouteNodes(route.nodes);
    setTotalDistance(route.distance);

    const steps = generateDirections(
      route.nodes,
      route.edges.map((e) => ({
        edgeId: e.id,
        from: e.from,
        to: e.to,
        type: e.type,
        distance: e.distance,
        bidirectional: e.bidirectional ?? true,
        weight: e.distance,
      }))
    );
    setDirectionSteps(steps);
    setActiveStepIndex(0);
    setIsSimulating(false);

    // Auto-set initial active floor to start node's floor or outdoor
    if (startNode.floorId && startNode.floorId !== activeFloorId) {
      setActiveFloorId(startNode.floorId);
    }

    setActivePanel("NAVIGATE");
  };

  const isGroundActive = useMemo(() => {
    if (activeFloorId === "f-all-g") return true;
    const fl = publishedData.floors.find((f) => f.id === activeFloorId);
    if (fl && fl.ordinal === 0) return true;
    const fName = (fl?.name || activeFloorId).toLowerCase();
    return fName.includes("ground") || fName.includes("gnd") || activeFloorId.endsWith("-0") || activeFloorId.endsWith("-g");
  }, [activeFloorId, publishedData.floors]);

  const currentFloorNodes = publishedData.nodes.filter((n) => {
    if (activeFloorId === "f-out") return n.floorId === "f-out" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode;
    if (isGroundActive) {
      if (!n.floorId || n.floorId === "f-out" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode) return true;
      if (activeFloorId === "f-all-g") {
        const fl = publishedData.floors.find((f) => f.id === n.floorId);
        return fl?.ordinal === 0;
      }
      return n.floorId === activeFloorId;
    }
    if (activeFloorId === "f-all-1") {
      const fl = publishedData.floors.find((f) => f.id === n.floorId);
      return fl?.ordinal === 1;
    }
    if (activeFloorId === "f-all") return n.floorId !== "f-out";
    return n.floorId === activeFloorId;
  });

  const currentFloorEdges = publishedData.edges.filter((e) => {
    const fromN = publishedData.nodes.find((n) => n.id === (e.fromNodeId ?? e.from));
    const toN = publishedData.nodes.find((n) => n.id === (e.toNodeId ?? e.to));
    if (!fromN || !toN) return false;
    if (activeFloorId === "f-out") return fromN.floorId === "f-out" || toN.floorId === "f-out";
    if (isGroundActive) {
      const isFromOut = !fromN.floorId || fromN.floorId === "f-out" || fromN.type === "BUILDING_ENTRANCE" || fromN.isEntranceNode;
      const isToOut = !toN.floorId || toN.floorId === "f-out" || toN.type === "BUILDING_ENTRANCE" || toN.isEntranceNode;
      const isFromThis = fromN.floorId === activeFloorId || (activeFloorId === "f-all-g" && publishedData.floors.find((f) => f.id === fromN.floorId)?.ordinal === 0);
      const isToThis = toN.floorId === activeFloorId || (activeFloorId === "f-all-g" && publishedData.floors.find((f) => f.id === toN.floorId)?.ordinal === 0);
      return (isFromThis && isToThis) || (isFromOut && isToOut) || (isFromThis && isToOut) || (isToThis && isFromOut);
    }
    if (activeFloorId === "f-all-1") {
      const fl1 = publishedData.floors.find((f) => f.id === fromN.floorId);
      const fl2 = publishedData.floors.find((f) => f.id === toN.floorId);
      return fl1?.ordinal === 1 || fl2?.ordinal === 1;
    }
    if (activeFloorId === "f-all") return fromN.floorId !== "f-out" || toN.floorId !== "f-out";
    return fromN.floorId === activeFloorId || toN.floorId === activeFloorId;
  });

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[rgb(var(--bg))] text-[rgb(var(--fg))]">
      {/* Top Floating Header */}
      <div className="absolute top-3 sm:top-4 left-3 sm:left-4 right-3 sm:right-4 z-20 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 rounded-2xl border bg-[rgb(var(--card))]/90 px-3 sm:px-4 py-2.5 shadow-lg backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-tr from-[rgb(var(--primary))] to-indigo-500 text-white shadow-sm shrink-0">
            <Navigation2 className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xs font-bold tracking-tight truncate">CampusNav Pro</h1>
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[rgb(var(--muted-fg))]">
              <span className="flex h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span>Live · {version}</span>
              <GpsStatusIndicator status={gps.status} />
              {gps.isGpsActive && gps.lat !== 0 && (
                <span className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 font-semibold truncate" title="9-Decimal High-Precision GPS Coordinates">
                  {gps.lat.toFixed(9)}, {gps.lng.toFixed(9)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Floor Layer Selector */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border bg-[rgb(var(--muted))]/50 p-1 text-[11px] scrollbar-none max-w-full">
          <button
            onClick={() => setActiveFloorId("f-out")}
            className={`rounded px-2.5 py-1 font-medium transition-all ${
              activeFloorId === "f-out"
                ? "bg-[rgb(var(--card))] text-[rgb(var(--fg))] shadow-sm font-semibold"
                : "text-[rgb(var(--muted-fg))]"
            }`}
          >
            Outdoor Map
          </button>
          <button
            onClick={() => setActiveFloorId("f-all-g")}
            className={`rounded px-2.5 py-1 font-medium transition-all ${
              activeFloorId === "f-all-g"
                ? "bg-[rgb(var(--primary))] text-white shadow-sm font-semibold"
                : "text-[rgb(var(--muted-fg))]"
            }`}
          >
            All Ground Floors
          </button>
          <button
            onClick={() => setActiveFloorId("f-all-1")}
            className={`rounded px-2.5 py-1 font-medium transition-all ${
              activeFloorId === "f-all-1"
                ? "bg-[rgb(var(--primary))] text-white shadow-sm font-semibold"
                : "text-[rgb(var(--muted-fg))]"
            }`}
          >
            All 1st Floors
          </button>
          {publishedData.floors.map((f) => {
            const bld = publishedData.buildings.find((b) => b.id === f.buildingId);
            return (
              <button
                key={f.id}
                onClick={() => setActiveFloorId(f.id)}
                className={`rounded px-2.5 py-1 font-medium transition-all ${
                  activeFloorId === f.id
                    ? "bg-[rgb(var(--card))] text-[rgb(var(--fg))] shadow-sm font-semibold"
                    : "text-[rgb(var(--muted-fg))]"
                }`}
              >
                {bld?.name ? `${bld.name} ${f.name}` : f.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* SVG Map Canvas (pan + zoom) */}
      <div
        ref={svgContainerRef}
        className="relative flex-1 bg-[rgb(var(--card))]/30 overflow-hidden touch-none select-none"
        style={{ cursor: isPanning.current ? "grabbing" : isRotating.current ? "ew-resize" : "grab" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg
          className="h-full w-full select-none"
          style={{
            transformOrigin: "center center",
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`,
            transition: isPanning.current || isRotating.current ? "none" : "transform 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
            willChange: "transform",
          }}
        >
          <defs>
            <pattern id="visitor-grid" width="30" height="30" patternUnits="userSpaceOnUse">
              <path d="M 30 0 L 0 0 0 30" fill="none" stroke="currentColor" strokeWidth="0.5" className="text-[rgb(var(--border))]/40" />
            </pattern>
          </defs>
          <rect width="10000" height="10000" x="-5000" y="-5000" fill="url(#visitor-grid)" />

          {/* Buildings Footprint — True N-Corner Polygon */}
          {publishedData.buildings.map((b) => {
            const canvasPts = getBuildingCanvasPoints(b);
            const ptsStr = getPolygonPointsString(canvasPts);
            const centerPos = getBuildingCenter(b);

            return (
              <g key={b.id}>
                <polygon
                  points={ptsStr}
                  fill={b.color ?? "#4f46e5"}
                  fillOpacity={0.15}
                  stroke={b.color ?? "#4f46e5"}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <text x={centerPos.x} y={centerPos.y + 4} textAnchor="middle" fill="currentColor" className="text-xs font-semibold select-none">
                  {b.name}
                </text>
              </g>
            );
          })}

          {/* Edges */}
          {currentFloorEdges.map((e) => {
            const fromN = publishedData.nodes.find((n) => n.id === (e.fromNodeId ?? e.from));
            const toN = publishedData.nodes.find((n) => n.id === (e.toNodeId ?? e.to));
            if (!fromN || !toN) return null;
            return (
              <line
                key={e.id}
                x1={fromN.x}
                y1={fromN.y}
                x2={toN.x}
                y2={toN.y}
                stroke={e.type === "STAIRS" ? "#ea580c" : e.type === "LIFT" ? "#9333ea" : "#94a3b8"}
                strokeWidth="1.5"
                strokeDasharray={e.type === "STAIRS" || e.type === "LIFT" ? "4,4" : undefined}
                opacity="0.6"
              />
            );
          })}

          {/* Active Route Segments (Blue for clear, Red Dotted for obstructed) */}
          {routeNodes.length > 1 && (
            <g>
              {(() => {
                const blockedEdgeIds = getObstructedEdgeIds(
                  publishedData.nodes,
                  publishedData.edges,
                  publishedData.obstacles ?? []
                );

                const segments = [];
                for (let i = 0; i < routeNodes.length - 1; i++) {
                  const fromN = routeNodes[i];
                  const toN = routeNodes[i + 1];
                  const matchingEdge = publishedData.edges.find(
                    (e) =>
                      (e.from === fromN.id && e.to === toN.id) ||
                      (e.from === toN.id && e.to === fromN.id) ||
                      (e.fromNodeId === fromN.id && e.toNodeId === toN.id) ||
                      (e.fromNodeId === toN.id && e.toNodeId === fromN.id)
                  );

                  let isObstructed = false;
                  if (matchingEdge) {
                    const baseId = matchingEdge.id.replace(/_rev$/, "");
                    isObstructed =
                      blockedEdgeIds.has(matchingEdge.id) ||
                      blockedEdgeIds.has(baseId) ||
                      blockedEdgeIds.has(`${baseId}_rev`);
                  } else {
                    const activeObs = (publishedData.obstacles ?? []).filter((obs) => {
                      if (!obs.expiresAt) return true;
                      return new Date(obs.expiresAt).getTime() > Date.now();
                    });
                    isObstructed = activeObs.some((obs) => {
                      const radius = obs.radius ?? 20;
                      const dx = toN.x - fromN.x;
                      const dy = toN.y - fromN.y;
                      const lenSq = dx * dx + dy * dy;
                      let t = lenSq === 0 ? 0 : ((obs.x - fromN.x) * dx + (obs.y - fromN.y) * dy) / lenSq;
                      t = Math.max(0, Math.min(1, t));
                      const projX = fromN.x + t * dx;
                      const projY = fromN.y + t * dy;
                      return Math.hypot(obs.x - projX, obs.y - projY) <= radius;
                    });
                  }

                  segments.push(
                    <g key={`user-nav-seg-${i}`}>
                      {/* Outer Glow */}
                      <line
                        x1={fromN.x}
                        y1={fromN.y}
                        x2={toN.x}
                        y2={toN.y}
                        stroke={isObstructed ? "#ef4444" : "#0284c7"}
                        strokeWidth={isObstructed ? 6 : 5}
                        strokeOpacity={isObstructed ? 0.35 : 0.3}
                        strokeDasharray={isObstructed ? "6 4" : undefined}
                        strokeLinecap="round"
                      />
                      {/* Path Line */}
                      <line
                        x1={fromN.x}
                        y1={fromN.y}
                        x2={toN.x}
                        y2={toN.y}
                        stroke={isObstructed ? "#ef4444" : "#0284c7"}
                        strokeWidth={isObstructed ? 4 : 3.5}
                        strokeDasharray={isObstructed ? "6 4" : undefined}
                        strokeLinecap="round"
                        className="animate-pulse"
                      />
                    </g>
                  );
                }
                return segments;
              })()}
            </g>
          )}

          {/* Nodes */}
          {currentFloorNodes.filter((n) => n.visibleToUser !== false || Boolean(n.photoUrl)).map((n) => {
            const isRouteNode = routeNodes.some((rn) => rn.id === n.id);
            return (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <circle
                  r={isRouteNode ? 6 : 4}
                  fill={isRouteNode ? "rgb(var(--primary))" : "#64748b"}
                  stroke="white"
                  strokeWidth="1.5"
                />
              </g>
            );
          })}

          {/* Destinations */}
          {publishedData.destinations.map((d) => {
            const linkedNode = publishedData.nodes.find((n) => n.id === d.nodeId);
            if (!linkedNode) return null;
            const isSelected = selectedDest?.id === d.id;
            return (
              <g
                key={d.id}
                onClick={() => handleCalculateRoute(d)}
                className="cursor-pointer"
              >
                <circle
                  cx={linkedNode.x}
                  cy={linkedNode.y}
                  r={isSelected ? 6.5 : 4.5}
                  fill={isSelected ? "#10b981" : "#64748b"}
                  stroke="white"
                  strokeWidth={isSelected ? 2 : 1.5}
                  opacity={0.9}
                />
                <text
                  x={linkedNode.x + 8}
                  y={linkedNode.y - 4}
                  fill="currentColor"
                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400"
                >
                  {d.name}
                </text>
              </g>
            );
          })}

          {/* Device GPS Live Marker with Accuracy Circle & Heading Cone */}
          {gps.isGpsActive && (
            <g transform={`translate(${gps.canvasPos.x}, ${gps.canvasPos.y})`}>
              {/* Accuracy Ring */}
              <circle
                r={gps.accuracy * 2.5}
                fill="rgba(59, 130, 246, 0.15)"
                stroke="#3b82f6"
                strokeWidth="1.5"
                strokeDasharray="4 3"
                className="animate-pulse"
              />
              {/* Directional Cone Pointer */}
              <path
                d="M 0 -18 L 8 4 L 0 0 L -8 4 Z"
                fill="#3b82f6"
                transform={`rotate(${gps.heading})`}
              />
              {/* Pulsing Blue GPS Marker Dot */}
              <circle r="8" fill="#3b82f6" stroke="var(--map-halo)" strokeWidth="2.5" className="shadow-md" />
            </g>
          )}
        </svg>

        {/* Zoom & Rotation Control Buttons */}
        <div className="absolute right-4 bottom-32 z-10 flex flex-col gap-1.5">
          {/* Compass / Reset Rotation Dial */}
          <button
            onClick={resetRotation}
            title={transform.rotation !== 0 ? `Reset Rotation (${Math.round((transform.rotation + 360) % 360)}°)` : "North Up"}
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-[rgb(var(--card))]/90 shadow-md backdrop-blur-sm text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors relative"
            aria-label="Reset map rotation to North"
          >
            <Compass
              className="h-5 w-5 text-indigo-500 transition-transform duration-200"
              style={{ transform: `rotate(${-transform.rotation}deg)` }}
            />
          </button>
          <button
            onClick={rotateCcw}
            title="Rotate 15° Left"
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-[rgb(var(--card))]/90 shadow-md backdrop-blur-sm text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            onClick={rotateCw}
            title="Rotate 15° Right"
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-[rgb(var(--card))]/90 shadow-md backdrop-blur-sm text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <button
            onClick={zoomIn}
            title="Zoom In"
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-[rgb(var(--card))]/90 shadow-md backdrop-blur-sm text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            onClick={zoomOut}
            title="Zoom Out"
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-[rgb(var(--card))]/90 shadow-md backdrop-blur-sm text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            onClick={resetView}
            title="Reset Map Position & Rotation"
            className="flex h-9 w-9 items-center justify-center rounded-xl border bg-[rgb(var(--card))]/90 shadow-md backdrop-blur-sm text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors"
          >
            <RotateCcw className="h-4 w-4 text-amber-500" />
          </button>
          {/* Scale & Rotation indicator */}
          <div className="mt-0.5 flex h-7 items-center justify-center rounded-lg border bg-[rgb(var(--card))]/90 px-2 text-[10px] font-mono text-[rgb(var(--muted-fg))] backdrop-blur-sm shadow">
            {Math.round(transform.scale * 100)}% · {Math.round((transform.rotation + 360) % 360)}°
          </div>
          {/* Locate Me / Recenter Button */}
          <button
            onClick={() => {
              if (!gps.isTracking) gps.startTracking();
              const container = svgContainerRef.current;
              const defaultScale = 2;
              if (container) {
                const rect = container.getBoundingClientRect();
                if (gps.isGpsActive && gps.canvasPos) {
                  setTransform({
                    x: rect.width / 2 - gps.canvasPos.x * defaultScale,
                    y: rect.height / 2 - gps.canvasPos.y * defaultScale,
                    scale: defaultScale,
                    rotation: 0,
                  });
                } else {
                  setTransform({
                    x: 0,
                    y: 0,
                    scale: defaultScale,
                    rotation: 0,
                  });
                }
              } else {
                setTransform((prev) => ({ ...prev, scale: defaultScale, rotation: 0 }));
              }
            }}
            title="Recenter Map & Locate Me (0° North, 100% Zoom)"
            className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-md backdrop-blur-sm transition-colors ${
              gps.isGpsActive
                ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30"
                : "bg-[rgb(var(--card))]/90 text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))]"
            }`}
            aria-label="Recenter map to default zoom and 0° North"
          >
            <Locate className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Bottom Overlay Panel */}
      <div className="absolute bottom-4 left-4 right-4 z-30 max-w-lg mx-auto">
        <AnimatePresence mode="wait">
          {activePanel === "SEARCH" && (
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
              <VisitorSearchSheet
                destinations={validNavDestinations}
                onSelectDestination={handleCalculateRoute}
              />
            </motion.div>
          )}

          {activePanel === "NAVIGATE" && (
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}>
              <NavigationView
                destinationName={selectedDest?.name ?? "Destination"}
                steps={directionSteps}
                totalDistance={totalDistance}
                activeStepIndex={activeStepIndex}
                onStepSelect={handleStepSelect}
                onSimulateWalk={() => setIsSimulating((prev) => !prev)}
                isSimulating={isSimulating}
                onCancel={() => {
                  setActivePanel("SEARCH");
                  setRouteNodes([]);
                  setSelectedDest(null);
                  setIsSimulating(false);
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
