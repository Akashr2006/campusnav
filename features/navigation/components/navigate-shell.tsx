"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Navigation2,
  MapPin,
  X,
  Plus,
  ArrowRight,
  Sparkles,
  Ruler,
  Timer,
  Share2,
  Layers,
  Building2,
  Check,
  Camera,
  AlertTriangle,
  DoorOpen,
  DoorClosed,
  Footprints,
  Car,
} from "lucide-react";
import { campusStore } from "@/shared/lib/campus-store";
import type { Destination, Node as CampusNode, Edge } from "@/shared/data/campus";
import { shortestPath, findAlternativeRoutes, type Route, type RouteInstruction } from "@/features/navigation/services/graph";
import { cn } from "@/shared/lib/utils";
import { Input } from "@/shared/components/ui/input";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { EmptyState } from "@/shared/components/ui/empty-state";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { findContextAwareNearestNode, findContextAwareNearestNodes } from "@/lib/geo/haversine";
import { isPointInsideBuilding } from "@/lib/geo/building-geometry";
import { detectBuildingAtGps } from "@/lib/geo/containment";
import { gpsToCanvas } from "@/lib/geo/projection";
import { useNavigationStore } from "@/features/navigation/navigation-store";
import dynamic from "next/dynamic";

// Leaflet touches `window` on import, so the map only loads in the browser.
const GoogleCampusMap = dynamic(() => import("./google-campus-map").then((m) => m.GoogleCampusMap), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-[#f1f3f4]" />,
});
import { LiveRoutePanel } from "./live-route-panel";
import { TurnByTurnBar } from "./turn-by-turn-bar";
import type { TravelMode } from "@/lib/routing/edge-accessibility";
import { getValidNavigationDestinations } from "@/shared/lib/destination-utils";

type StopEntry = {
  dest: Destination | null;
  query: string;
  focus: boolean;
};

const YOUR_LOCATION_ID = "dest-live-user-location";
const YOUR_LOCATION_DEST: Destination = {
  id: YOUR_LOCATION_ID,
  name: "Your Location",
  category: "GPS Location",
  aliases: ["my location", "current location", "me", "gps", "here"],
};

export function NavigateShell() {
  const [, startTransition] = useTransition();

  const [fromQuery, setFromQuery] = useState("");
  const [fromSelected, setFromSelected] = useState<Destination | null>(null);
  const [fromFocus, setFromFocus] = useState(false);

  const [toQuery, setToQuery] = useState("");
  const [toSelected, setToSelected] = useState<Destination | null>(null);
  const [toFocus, setToFocus] = useState(false);

  const [stops, setStops] = useState<StopEntry[]>([]);
  const [route, setRoute] = useState<Route | null>(null);
  const [alternativeRoute, setAlternativeRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(false);
  const [live, setLive] = useState(false);
  const [livePos, setLivePos] = useState<{ node: CampusNode; progress: number } | null>(null);

  // Travel Mode & Prompt State
  const [travelMode, setTravelMode] = useState<TravelMode>("WALK");
  const [showTransportPrompt, setShowTransportPrompt] = useState(false);

  // Phase 3 Indoor Floor Selection Modal state
  const [showFloorModal, setShowFloorModal] = useState(false);
  const [selectedFloorId, setSelectedFloorId] = useState<string>("f-out");

  // Mobile View Toggle: "panel" = search sheet, "map" = full interactive map view
  const [mobileView, setMobileView] = useState<"panel" | "map">("panel");

  // Real-world reference photo preview modal state
  const [previewingPhoto, setPreviewingPhoto] = useState<{ url: string; title: string; nodeId?: string } | null>(null);
  const [previewPhotoError, setPreviewPhotoError] = useState(false);

  const [publishedData, setPublishedData] = useState(() => campusStore.getPublishedData());
  const [mounted, setMounted] = useState(false);

  // Single GPS instance for the entire navigation flow
  const gps = useVisitorGps(undefined, { autoStart: true });

  const navSession = useNavigationStore();
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as HTMLElement)) {
        setFromFocus(false);
        setToFocus(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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

  const allDestinations = useMemo(() => {
    return getValidNavigationDestinations(publishedData);
  }, [publishedData]);

  // Detected building based on live GPS position
  // floorId -> "Building · Floor", so a result says where it actually is
  const locationByFloorId = useMemo(() => {
    const buildingNames = new Map((publishedData.buildings || []).map((b) => [b.id, b.name]));
    const map = new Map<string, string>();
    (publishedData.floors || []).forEach((f) => {
      map.set(f.id, [buildingNames.get(f.buildingId), f.name].filter(Boolean).join(" · "));
    });
    return map;
  }, [publishedData.buildings, publishedData.floors]);

  const locationOf = useCallback(
    (floorId?: string) => (floorId && locationByFloorId.get(floorId)) || "Outdoor campus",
    [locationByFloorId]
  );

  const detectedBuilding = useMemo(() => {
    if (!gps.isGpsActive || !gps.lat || !gps.lng) return null;
    const blds = publishedData.buildings || [];
    const containment = detectBuildingAtGps(gps.lat, gps.lng, gps.accuracy || 10, blds);
    if (containment.isInside && containment.building) {
      return containment.building;
    }
    const canvasPos = gps.canvasPos || gpsToCanvas(gps.lat, gps.lng);
    return blds.find((b) => isPointInsideBuilding(canvasPos.x, canvasPos.y, b, 0)) || null;
  }, [gps.isGpsActive, gps.lat, gps.lng, gps.accuracy, gps.canvasPos, publishedData.buildings]);

  // Check if detected building has multiple floors
  const hasMultipleFloors = useMemo(() => {
    if (!detectedBuilding) return false;
    const bldFloors = (publishedData.floors || []).filter((f) => f.buildingId === detectedBuilding.id);
    return bldFloors.length > 1;
  }, [detectedBuilding, publishedData.floors]);

  // Update live navigation store on GPS ticks
  useEffect(() => {
    if (!live || !gps.isGpsActive) return;
    const matchedNode = livePos?.node ?? null;
    useNavigationStore.getState().updateGpsProgress(
      gps.lat,
      gps.lng,
      matchedNode,
      publishedData.nodes || [],
      (fromId: string, toId: string) => shortestPath(fromId, toId, { travelMode }),
      {
        canvasPos: gps.canvasPos,
        heading: gps.heading,
        speed: gps.speed,
      }
    );
  }, [live, gps.lat, gps.lng, gps.isGpsActive, gps.canvasPos, gps.heading, gps.speed, livePos?.node, publishedData.nodes, travelMode]);

  // Handle URL query parameters for deep linking (?to=dest-id or ?from=dest-id)
  const deepLinkHandledRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (deepLinkHandledRef.current || allDestinations.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const toParam = params.get("to");
    const fromParam = params.get("from");
    if (!toParam && !fromParam) return;
    deepLinkHandledRef.current = true;

    const resolve = (param: string) =>
      allDestinations.find((d) => d.id === param || d.name.toLowerCase() === param.toLowerCase()) ?? null;

    let linkedTo: Destination | null = null;
    let linkedFrom: Destination | null = null;

    if (toParam) {
      linkedTo = resolve(toParam);
      if (linkedTo) {
        setToSelected(linkedTo);
        setToQuery(linkedTo.name);
      }
    }

    if (fromParam) {
      linkedFrom =
        fromParam === "me" || fromParam === YOUR_LOCATION_ID ? YOUR_LOCATION_DEST : resolve(fromParam);
      if (linkedFrom) {
        setFromSelected(linkedFrom);
        setFromQuery(linkedFrom.name);
      }
    }

    // Both ends known: draw the route straight away instead of leaving the
    // fields filled with nothing on the map.
    if (linkedFrom && linkedTo) {
      calculateRoute(linkedFrom, linkedTo, stops, selectedFloorId, detectedBuilding?.id, travelMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDestinations]);

  // Suggestions for FROM
  const fromSuggestions = useMemo(() => {
    const q = fromQuery.trim().toLowerCase();
    const list = [YOUR_LOCATION_DEST, ...allDestinations];
    const filtered = !q
      ? list
      : list.filter((d) => {
          const nameMatch = d.name.toLowerCase().includes(q);
          const catMatch = (d.category ?? "").toLowerCase().includes(q);
          const aliasMatch = (d.aliases ?? []).some((a) => a.toLowerCase().includes(q));
          return nameMatch || catMatch || aliasMatch;
        });

    return [...filtered].sort((a, b) => {
      if (a.id === YOUR_LOCATION_ID) return -1;
      if (b.id === YOUR_LOCATION_ID) return 1;
      if (q) {
        const aStarts = a.name.toLowerCase().startsWith(q);
        const bStarts = b.name.toLowerCase().startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
      }
      const aIsBld = a.category === "Building";
      const bIsBld = b.category === "Building";
      if (!aIsBld && bIsBld) return -1;
      if (aIsBld && !bIsBld) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [fromQuery, allDestinations]);

  // Suggestions for TO
  const toSuggestions = useMemo(() => {
    const q = toQuery.trim().toLowerCase();
    const filtered = !q
      ? allDestinations
      : allDestinations.filter((d) => {
          const nameMatch = d.name.toLowerCase().includes(q);
          const catMatch = (d.category ?? "").toLowerCase().includes(q);
          const aliasMatch = (d.aliases ?? []).some((a) => a.toLowerCase().includes(q));
          return nameMatch || catMatch || aliasMatch;
        });

    return [...filtered].sort((a, b) => {
      if (q) {
        const aStarts = a.name.toLowerCase().startsWith(q);
        const bStarts = b.name.toLowerCase().startsWith(q);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
      }
      const aIsBld = a.category === "Building";
      const bIsBld = b.category === "Building";
      if (!aIsBld && bIsBld) return -1;
      if (aIsBld && !bIsBld) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [toQuery, allDestinations]);

  async function calculateRoute(
    startDest: Destination | null,
    endDest: Destination | null,
    currentStops: StopEntry[] = stops,
    currentFloorId = selectedFloorId,
    currentBuildingId: string | null | undefined = detectedBuilding?.id,
    mode: TravelMode = travelMode
  ): Promise<Route | null> {
    if (!endDest || !startDest) {
      setRoute(null);
      setLive(false);
      setLivePos(null);
      return null;
    }
    setLoading(true);
    setRoute(null);
    setLive(false);
    setLivePos(null);

    // If startDest is Live Location, resolve context-aware candidate start nodes
    let liveStartCandidates: CampusNode[] = [];
    if (startDest.id === YOUR_LOCATION_ID) {
      const bld = detectedBuilding || (currentBuildingId ? (publishedData.buildings || []).find((b) => b.id === currentBuildingId) : null);
      const isInsideBld = Boolean(bld);
      liveStartCandidates = findContextAwareNearestNodes(
        gps.lat,
        gps.lng,
        publishedData.nodes || [],
        {
          isInside: isInsideBld,
          buildingId: bld?.id,
          buildingName: bld?.name,
          floorId: isInsideBld && currentFloorId !== "f-out" ? currentFloorId : "f-out",
          floors: publishedData.floors,
          userCanvasPos: gps.canvasPos,
        }
      );

      if (liveStartCandidates.length === 0) {
        setLoading(false);
        setRoute(null);
        setAlternativeRoute(null);
        return null;
      }
    }

    // Build ordered waypoints: start → stop1 → stop2 → ... → end
    const waypoints: Destination[] = [
      startDest,
      ...currentStops.map((s) => s.dest).filter((d): d is Destination => d !== null),
      endDest,
    ];

    // Compute alternative second shortest route if direct 2-point route and enabled in Admin settings
    const isAltRouteEnabled = campusStore.getShowAlternativeRoute();
    if (isAltRouteEnabled && waypoints.length === 2) {
      const segStart = waypoints[0];
      const segEnd = waypoints[1];
      const sId = segStart.id === YOUR_LOCATION_ID && liveStartCandidates.length > 0
        ? (liveStartCandidates[0]?.id || "n1")
        : (segStart.nodeId || segStart.id);
      const eId = segEnd.id === YOUR_LOCATION_ID
        ? (liveStartCandidates[0]?.id || segEnd.nodeId || "n1")
        : (segEnd.nodeId || segEnd.id);

      const altRes = findAlternativeRoutes(sId, eId, { travelMode: mode });
      if (altRes.alternative && altRes.alternative.distance > 0) {
        setAlternativeRoute(altRes.alternative);
      } else {
        setAlternativeRoute(null);
      }
    } else {
      setAlternativeRoute(null);
    }

    // Chain Dijkstra segments for each consecutive pair
    let totalDistance = 0;
    let totalDurationSec = 0;
    let combinedNodes: CampusNode[] = [];
    let combinedEdges: Edge[] = [];
    let combinedInstructions: RouteInstruction[] = [];
    let hasObstacles = false;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const segStart = waypoints[i];
      const segEnd = waypoints[i + 1];

      const segEndId =
        segEnd.id === YOUR_LOCATION_ID
          ? (liveStartCandidates[0]?.id || segEnd.nodeId || "n1")
          : (segEnd.nodeId || segEnd.id);

      let segRoute: Route | null = null;
      if (segStart.id === YOUR_LOCATION_ID && liveStartCandidates.length > 0) {
        for (const candidate of liveStartCandidates) {
          const candidateRoute = shortestPath(candidate.id, segEndId, { travelMode: mode });
          if (candidateRoute) {
            segRoute = candidateRoute;
            break;
          }
        }
      } else {
        const segStartId = segStart.nodeId || segStart.id;
        segRoute = shortestPath(segStartId, segEndId, { travelMode: mode });
      }

      if (!segRoute) {
        setLoading(false);
        setRoute(null);
        setAlternativeRoute(null);
        return null;
      }
      totalDistance += segRoute.distance;
      totalDurationSec += segRoute.durationSec;
      if (segRoute.hasObstacles) hasObstacles = true;

      // Merge (avoid duplicating connecting node)
      if (i === 0) {
        combinedNodes = [...segRoute.nodes];
        combinedEdges = [...segRoute.edges];
      } else {
        combinedNodes = [...combinedNodes, ...segRoute.nodes.slice(1)];
        combinedEdges = [...combinedEdges, ...segRoute.edges];
      }
      if (waypoints.length > 2 && i > 0) {
        combinedInstructions.push({ text: `Via ${segStart.name}`, distance: 0, transition: "arrive" });
      }
      combinedInstructions = combinedInstructions.concat(segRoute.instructions || []);
    }

    const isMultimodal = mode === "EV" && combinedEdges.some((e) => e.pathType === "EV") && combinedEdges.some((e) => e.pathType === "WALK");
    const evDist = mode === "EV" ? combinedEdges.filter((e) => e.pathType === "EV").reduce((acc, e) => acc + e.distance, 0) : 0;
    const walkDist = mode === "EV" ? combinedEdges.filter((e) => e.pathType !== "EV").reduce((acc, e) => acc + e.distance, 0) : totalDistance;
    const lastEvEdge = mode === "EV" ? combinedEdges.filter((e) => e.pathType === "EV").pop() : undefined;
    const isFallbackWalk = mode === "EV" && evDist === 0;

    const clientRoute: Route = {
      id: `multi-${Date.now()}`,
      nodes: combinedNodes,
      edges: combinedEdges,
      distance: totalDistance,
      durationSec: totalDurationSec,
      instructions: combinedInstructions,
      travelMode: isFallbackWalk ? "WALK" : (isMultimodal ? "MULTIMODAL" : mode),
      evDistance: evDist,
      walkDistance: walkDist,
      transferNodeId: mode === "EV" && isMultimodal && lastEvEdge ? lastEvEdge.to : undefined,
      hasObstacles,
      isFallbackWalk,
      fallbackReason: isFallbackWalk ? "EV path not available, Showing walkable route" : undefined,
    };

    setRoute(clientRoute);
    setLoading(false);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setMobileView("map");
    }
    if (live && clientRoute) {
      navSession.startNavigationSession(startDest, endDest, clientRoute);
    }

    return clientRoute;
  }

  function handleSelectFloor(floorId: string) {
    setSelectedFloorId(floorId);
    setShowFloorModal(false);

    const bld = detectedBuilding;
    useNavigationStore.getState().setIndoorContext(
      bld?.id ?? null,
      floorId,
      "MANUAL_FLOOR_SELECTION",
      "HIGH"
    );

    const nearestResult = findContextAwareNearestNode(
      gps.lat,
      gps.lng,
      publishedData.nodes || [],
      {
        isInside: true,
        buildingId: bld?.id,
        floorId,
        floors: publishedData.floors,
      }
    );

    if (!nearestResult.node) {
      setRoute(null);
      setAlternativeRoute(null);
      return;
    }

    const updatedDest: Destination = {
      ...YOUR_LOCATION_DEST,
      nodeId: nearestResult.node.id,
      floorId,
    };
    setFromSelected(updatedDest);

    if (nearestResult.node) {
      setLivePos({ node: nearestResult.node, progress: 0 });
    }

    if (toSelected) {
      calculateRoute(updatedDest, toSelected, stops, floorId, bld?.id, travelMode);
    }
  }

  function handleSelectYourLocation() {
    if (gps.status === "unavailable") {
      return;
    }

    setFromSelected(YOUR_LOCATION_DEST);
    setFromQuery(YOUR_LOCATION_DEST.name);
    setFromFocus(false);

    if (detectedBuilding) {
      if (hasMultipleFloors) {
        setShowFloorModal(true);
      } else {
        const singleFloor = (publishedData.floors || []).find((f) => f.buildingId === detectedBuilding.id);
        const floorId = singleFloor?.id || "f-out";
        setSelectedFloorId(floorId);
        if (toSelected) {
          calculateRoute(YOUR_LOCATION_DEST, toSelected, stops, floorId, detectedBuilding.id, travelMode);
        }
      }
    } else {
      setSelectedFloorId("f-out");
      if (toSelected) {
        calculateRoute(YOUR_LOCATION_DEST, toSelected, stops, "f-out", null, travelMode);
      }
    }
  }

  function pickFromDestination(d: Destination) {
    if (d.id === YOUR_LOCATION_ID) {
      handleSelectYourLocation();
      return;
    }
    setFromSelected(d);
    setFromQuery(d.name);
    setFromFocus(false);
    calculateRoute(d, toSelected, stops, selectedFloorId, detectedBuilding?.id, travelMode);
  }

  function pickToDestination(d: Destination) {
    setToSelected(d);
    setToQuery(d.name);
    setToFocus(false);
    calculateRoute(fromSelected, d, stops, selectedFloorId, detectedBuilding?.id, travelMode);
  }

  function addStop() {
    setStops((prev) => [...prev, { dest: null, query: "", focus: false }]);
  }

  function removeStop(index: number) {
    const updated = stops.filter((_, i) => i !== index);
    setStops(updated);
    calculateRoute(fromSelected, toSelected, updated, selectedFloorId, detectedBuilding?.id, travelMode);
  }

  function updateStop(index: number, patch: Partial<StopEntry>) {
    const updated = stops.map((s, i) => (i === index ? { ...s, ...patch } : s));
    setStops(updated);
  }

  function pickStop(index: number, d: Destination) {
    const updated = stops.map((s, i) =>
      i === index ? { ...s, dest: d, query: d.name, focus: false } : s
    );
    setStops(updated);
    calculateRoute(fromSelected, toSelected, updated, selectedFloorId, detectedBuilding?.id, travelMode);
  }

  function reset() {
    setFromSelected(null);
    setFromQuery("");
    setToSelected(null);
    setToQuery("");
    setRoute(null);
    setLive(false);
    setStops([]);
    setShowFloorModal(false);
    setShowTransportPrompt(false);
  }

  function startLive(targetRoute: Route | null = route) {
    if (!fromSelected || !toSelected || !targetRoute) return;
    setLive(true);
    setMobileView("map");
    if (gps && !gps.isTracking) {
      gps.startTracking();
    }
    const isGpsValid = Boolean(
      gps?.isGpsActive &&
      typeof gps.lat === "number" &&
      typeof gps.lng === "number" &&
      (gps.lat !== 0 || gps.lng !== 0)
    );
    const liveUserPosOptions = {
      isGpsActive: isGpsValid,
      lat: isGpsValid ? gps.lat : undefined,
      lng: isGpsValid ? gps.lng : undefined,
      floorId: selectedFloorId,
      canvasPos: isGpsValid ? gps.canvasPos : undefined,
      x: isGpsValid ? gps.canvasPos?.x : undefined,
      y: isGpsValid ? gps.canvasPos?.y : undefined,
    };
    useNavigationStore.getState().startNavigationSession(fromSelected, toSelected, targetRoute, liveUserPosOptions);
  }

  async function handleConfirmTransportMode(mode: TravelMode) {
    setTravelMode(mode);
    setShowTransportPrompt(false);
    if (fromSelected && toSelected) {
      const computed = await calculateRoute(fromSelected, toSelected, stops, selectedFloorId, detectedBuilding?.id, mode);
      if (computed) {
        startLive(computed);
      }
    }
  }

  if (!mounted) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 p-6 text-sm text-[rgb(var(--muted-fg))]">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent" />
        <span>Loading navigation…</span>
      </div>
    );
  }

  return (
    <div className="relative flex flex-1 overflow-hidden">
      {/* Left panel */}
      <div
        suppressHydrationWarning
        className={cn(
          "z-10 w-full shrink-0 flex-col border-r bg-[rgb(var(--card))] md:flex md:w-80 xl:w-96 overflow-y-auto overscroll-contain touch-pan-y scrollbar-thin pb-24 md:pb-4",
          mobileView === "panel" ? "flex" : "hidden"
        )}
      >
        <div ref={searchContainerRef} suppressHydrationWarning className="border-b p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg gradient-primary text-white">
                <Navigation2 className="h-3 w-3" />
              </div>
              <h1 className="text-xs font-bold text-[rgb(var(--fg))]">Plan a Route</h1>
            </div>
            {live && (
              <Badge variant="success" className="text-[10px]">
                <span className="mr-1 inline-flex h-1.5 w-1.5 rounded-full bg-[rgb(var(--success))] pulse-dot" />
                Live
              </Badge>
            )}
          </div>

          {/* Travel Mode Toggle (Walk / EV) */}
          <div suppressHydrationWarning className="flex items-center rounded-xl bg-[rgb(var(--muted))] p-1 text-xs">
            <button
              type="button"
              onClick={() => {
                setTravelMode("WALK");
                if (fromSelected && toSelected) {
                  calculateRoute(fromSelected, toSelected, stops, selectedFloorId, detectedBuilding?.id, "WALK");
                }
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer min-h-[34px]",
                travelMode === "WALK"
                  ? "bg-[rgb(var(--card))] text-[rgb(var(--fg))] shadow-xs font-bold"
                  : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              )}
            >
              <Footprints className="h-3.5 w-3.5" />
              <span>Walk</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTravelMode("EV");
                if (fromSelected && toSelected) {
                  calculateRoute(fromSelected, toSelected, stops, selectedFloorId, detectedBuilding?.id, "EV");
                }
              }}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg font-semibold transition-all cursor-pointer min-h-[34px]",
                travelMode === "EV"
                  ? "bg-[rgb(var(--card))] text-[rgb(var(--fg))] shadow-xs font-bold"
                  : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              )}
            >
              <Car className="h-3.5 w-3.5" />
              <span>EV</span>
            </button>
          </div>

          {/* FROM Search Field */}
          <div className="relative">
            <label className="mb-0.5 block text-[10px] font-semibold text-[rgb(var(--muted-fg))]">
              From (Start Location)
            </label>
            <div className="flex h-9 items-center gap-2 rounded-xl border bg-[rgb(var(--bg))] px-2.5 transition-shadow focus-within:ring-2 focus-within:ring-[rgb(var(--ring))]">
              <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--success))]" />
              </span>
              <Input
                value={fromQuery}
                onFocus={() => setFromFocus(true)}
                onChange={(e) => {
                  setFromQuery(e.target.value);
                  setFromSelected(null);
                  setFromFocus(true);
                }}
                placeholder="Search start building, entrance..."
                className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
              />
              {fromQuery && (
                <button onClick={() => { setFromQuery(""); setFromSelected(null); }} aria-label="Clear From" className="shrink-0 p-1">
                  <X className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                </button>
              )}
            </div>

            {/* FROM Suggestions Dropdown */}
            <AnimatePresence>
              {fromFocus && fromSuggestions.length > 0 && !fromSelected && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="card absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto overscroll-contain touch-pan-y p-1.5 shadow-2xl border bg-[rgb(var(--card))]/98 backdrop-blur-md divide-y divide-[rgb(var(--border)/0.4)]"
                  >
                  {fromSuggestions.map((d) => {
                    const isBld = d.category === "Building";
                    const isLoc = d.id === YOUR_LOCATION_ID;
                    const isEnt = (d.category || "").toLowerCase().includes("entrance") || (d.category || "").toLowerCase().includes("gate");
                    const isRoom = (d.category || "").toLowerCase().includes("room") || (d.category || "").toLowerCase().includes("lab");

                    return (
                      <button
                        key={d.id}
                        onClick={() => pickFromDestination(d)}
                        className={cn(
                          "flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-[rgb(var(--muted))] cursor-pointer min-h-[46px]",
                          isLoc && "bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 mb-1"
                        )}
                      >
                        <div className={cn(
                          "rounded-lg p-2 shrink-0 flex items-center justify-center",
                          isLoc ? "bg-emerald-500 text-white" :
                          isBld ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" :
                          isEnt ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                          isRoom ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" :
                          "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                        )}>
                          {isLoc ? <Navigation2 className="h-3.5 w-3.5 animate-pulse" /> :
                           isBld ? <Building2 className="h-3.5 w-3.5" /> :
                           isEnt ? <DoorOpen className="h-3.5 w-3.5" /> :
                           isRoom ? <DoorClosed className="h-3.5 w-3.5" /> :
                           <MapPin className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className={cn("truncate text-xs font-semibold", isLoc && "text-emerald-600 dark:text-emerald-400")}>
                            {d.name}
                          </div>
                          <div className="truncate text-[10.5px] text-[rgb(var(--muted-fg))] font-medium">
                            {d.category || "Campus Location"}
                          </div>
                        </div>
                        {isLoc && (
                          <Badge variant="success" className="shrink-0 text-[9px] px-1.5 py-0">
                            Live GPS
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Contextual Live Location Info & Floor Switcher */}
            {fromSelected?.id === YOUR_LOCATION_ID && (
              <div className="mt-1.5 flex items-center justify-between rounded-xl border border-[rgb(var(--primary)/0.2)] bg-[rgb(var(--primary)/0.06)] px-2.5 py-1.5 text-xs shadow-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  {detectedBuilding ? (
                    <>
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--primary))]" />
                      <span className="truncate font-semibold text-[11px] text-[rgb(var(--fg))]">
                        Inside {detectedBuilding.name} · {publishedData.floors.find((f) => f.id === selectedFloorId)?.name || "Ground Floor"}
                      </span>
                    </>
                  ) : (
                    <>
                      <Navigation2 className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--primary))] animate-pulse" />
                      <span className="truncate font-semibold text-[11px] text-[rgb(var(--fg))]">
                        Outdoor Campus Grounds
                      </span>
                    </>
                  )}
                </div>
                {detectedBuilding && hasMultipleFloors && (
                  <button
                    onClick={() => setShowFloorModal(true)}
                    className="shrink-0 text-[10px] font-bold text-[rgb(var(--primary))] hover:underline flex items-center gap-1 pl-1 cursor-pointer"
                  >
                    <span>Switch Floor</span>
                    <Layers className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Intermediate Stops */}
          {stops.map((stop, idx) => (
            <div key={idx} className="relative">
              <label className="mb-0.5 block text-[10px] font-semibold text-[rgb(var(--muted-fg))]">
                Stop {idx + 1}
              </label>
              <div className="flex h-9 items-center gap-2 rounded-xl border bg-[rgb(var(--bg))] px-2.5 transition-shadow focus-within:ring-2 focus-within:ring-[rgb(var(--ring))]">
                <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                </span>
                <Input
                  value={stop.query}
                  onFocus={() => updateStop(idx, { focus: true })}
                  onChange={(e) => updateStop(idx, { query: e.target.value, dest: null, focus: true })}
                  placeholder={`Search stop ${idx + 1}...`}
                  className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                />
                <button onClick={() => removeStop(idx)} aria-label="Remove Stop" className="shrink-0 p-1">
                  <X className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                </button>
              </div>

              {/* Stop Suggestions Dropdown */}
              <AnimatePresence>
                {stop.focus && !stop.dest && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="card absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto overscroll-contain touch-pan-y p-1.5 shadow-2xl border bg-[rgb(var(--card))]/98 backdrop-blur-md divide-y divide-[rgb(var(--border)/0.4)]"
                  >
                    {allDestinations
                      .filter((d) => d.name.toLowerCase().includes(stop.query.toLowerCase()))
                      .map((d) => {
                        const isBld = d.category === "Building";
                        const isEnt = (d.category || "").toLowerCase().includes("entrance") || (d.category || "").toLowerCase().includes("gate");
                        const isRoom = (d.category || "").toLowerCase().includes("room") || (d.category || "").toLowerCase().includes("lab");

                        return (
                          <button
                            key={d.id}
                            onClick={() => pickStop(idx, d)}
                            className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left text-xs hover:bg-[rgb(var(--muted))] cursor-pointer min-h-[46px]"
                          >
                            <div className={cn(
                              "rounded-lg p-2 shrink-0 flex items-center justify-center",
                              isBld ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" :
                              isEnt ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                              isRoom ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" :
                              "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            )}>
                              {isBld ? <Building2 className="h-3.5 w-3.5" /> :
                               isEnt ? <DoorOpen className="h-3.5 w-3.5" /> :
                               isRoom ? <DoorClosed className="h-3.5 w-3.5" /> :
                               <MapPin className="h-3.5 w-3.5" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-semibold text-xs">{d.name}</div>
                              <div className="truncate text-[10.5px] text-[rgb(var(--muted-fg))] font-medium">{d.category || "Campus Location"}</div>
                            </div>
                          </button>
                        );
                      })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}

          {/* TO Search Field */}
          <div className="relative">
            <label className="mb-0.5 block text-[10px] font-semibold text-[rgb(var(--muted-fg))]">
              To (Destination)
            </label>
            <div className="flex h-9 items-center gap-2 rounded-xl border bg-[rgb(var(--bg))] px-2.5 transition-shadow focus-within:ring-2 focus-within:ring-[rgb(var(--ring))]">
              <span className="flex h-2 w-2 shrink-0 items-center justify-center">
                <span className="h-1.5 w-1.5 rounded-full bg-[rgb(var(--primary))]" />
              </span>
              <Input
                value={toQuery}
                onFocus={() => setToFocus(true)}
                onChange={(e) => {
                  setToQuery(e.target.value);
                  setToSelected(null);
                  setToFocus(true);
                }}
                placeholder="Search destination room, lab, gate..."
                className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
              />
              {toQuery && (
                <button onClick={() => { setToQuery(""); setToSelected(null); }} aria-label="Clear To" className="shrink-0 p-1">
                  <X className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                </button>
              )}
            </div>

            {/* TO Suggestions Dropdown */}
            <AnimatePresence>
              {toFocus && toSuggestions.length > 0 && !toSelected && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="card absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-y-auto overscroll-contain touch-pan-y p-1.5 shadow-2xl border bg-[rgb(var(--card))]/98 backdrop-blur-md divide-y divide-[rgb(var(--border)/0.4)]"
                  >
                  {toSuggestions.map((d) => {
                    const isBld = d.category === "Building";
                    const isEnt = (d.category || "").toLowerCase().includes("entrance") || (d.category || "").toLowerCase().includes("gate");
                    const isRoom = (d.category || "").toLowerCase().includes("room") || (d.category || "").toLowerCase().includes("lab");

                    return (
                      <button
                        key={d.id}
                        onClick={() => pickToDestination(d)}
                        className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-[rgb(var(--muted))] cursor-pointer min-h-[46px]"
                      >
                        <div className={cn(
                          "rounded-lg p-2 shrink-0 flex items-center justify-center",
                          isBld ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400" :
                          isEnt ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" :
                          isRoom ? "bg-purple-500/15 text-purple-600 dark:text-purple-400" :
                          "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                        )}>
                          {isBld ? <Building2 className="h-3.5 w-3.5" /> :
                           isEnt ? <DoorOpen className="h-3.5 w-3.5" /> :
                           isRoom ? <DoorClosed className="h-3.5 w-3.5" /> :
                           <MapPin className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold">{d.name}</div>
                          <div className="truncate text-[10.5px] text-[rgb(var(--muted-fg))] font-medium">
                            {d.category || "Campus Location"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Action Row: Add Stop, Clear Route */}
          <div className="flex items-center justify-between pt-1 text-xs">
            <button
              type="button"
              onClick={addStop}
              className="flex items-center gap-1 font-semibold text-[rgb(var(--primary))] hover:underline cursor-pointer min-h-[36px] py-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add stop</span>
            </button>
            {(fromSelected || toSelected || stops.length > 0) && (
              <button
                type="button"
                onClick={reset}
                className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))] cursor-pointer min-h-[36px] py-1"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Content area: Popular destinations or calculated route details */}
        <div className="flex-1 p-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-xs text-[rgb(var(--muted-fg))]">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-[rgb(var(--primary))] border-t-transparent" />
              <span>Calculating optimal path…</span>
            </div>
          ) : !route ? (
            <PopularList
              onPick={(d) => pickToDestination(d)}
              allDestinations={allDestinations}
              mounted={mounted}
              locationOf={locationOf}
            />
          ) : (
            <div className="space-y-3">
              {/* Route Summary Card */}
              <div className="card space-y-3 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <Badge variant={route.isFallbackWalk ? "warning" : "primary"} className="mb-1 text-[10px]">
                      {travelMode === "EV"
                        ? (route.isFallbackWalk ? "Walk (EV unavailable)" : "EV Route")
                        : "Walking Route"}
                    </Badge>
                    <h2 className="text-base font-bold text-[rgb(var(--fg))]">
                      To {toSelected?.name}
                    </h2>
                  </div>
                  <button
                    onClick={() => {
                      if (navigator.share) {
                        navigator.share({
                          title: `CampusNav Route to ${toSelected?.name}`,
                          url: window.location.href,
                        });
                      } else {
                        navigator.clipboard.writeText(window.location.href);
                      }
                    }}
                    className="rounded-xl p-2 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] transition-colors"
                    title="Share route"
                    aria-label="Share Route"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Stat icon={Ruler} label="Distance" value={`${Math.round(route.distance)} m`} />
                  <Stat icon={Timer} label="ETA" value={`${Math.round(route.durationSec / 60)} min`} />
                </div>

                {route.isFallbackWalk && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs shadow-xs">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                    <div className="space-y-0.5">
                      <div className="font-bold text-amber-900 dark:text-amber-200">
                        EV path not available, Showing walkable route
                      </div>
                    </div>
                  </div>
                )}

                {route.hasObstacles && (
                  <div className="mt-3 flex items-start gap-3 rounded-xl border border-[#fde047]/70 bg-[#fefce8] dark:border-[#78350f]/60 dark:bg-[#451a03]/40 p-3 shadow-xs">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#fef08a] text-[#b45309] dark:bg-[#78350f]/50 dark:text-[#fde047]">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <div className="space-y-0.5 text-xs">
                      <div className="font-bold text-[#451a03] dark:text-[#fef08a]">All Available Routes Have Obstacles</div>
                      <div className="text-[11px] text-[#78350f] dark:text-[#fde047] leading-relaxed font-medium">
                        Every path to this location is currently obstructed by hazards or construction zones. Navigation is routing through the path with minimal obstacles.
                      </div>
                    </div>
                  </div>
                )}

                {/* Start Live Navigation Action Button */}
                <Button
                  onClick={() => {
                    if (!live) {
                      setShowTransportPrompt(true);
                    }
                  }}
                  variant="gradient"
                  className="mt-3 w-full flex items-center justify-center gap-1.5 min-h-[44px] text-sm font-bold"
                  disabled={live}
                >
                  <span>{live ? "Navigating live…" : "Start live navigation"}</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Turn-by-Turn Timeline Card */}
              {route.instructions && route.instructions.length > 0 && !live && (
                <div className="card space-y-3 p-4">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
                    Turn-by-Turn Guidance
                  </div>
                  <div className="relative space-y-4 pl-1 pt-1">
                    {route.instructions.map((inst, idx) => {
                      const isLast = idx === route.instructions.length - 1;
                      const stepNum = idx + 1;
                      const stepPhotoUrl = inst.photoUrl || (inst.targetNodeId ? publishedData.nodes.find((n) => n.id === inst.targetNodeId)?.photoUrl : undefined);

                      return (
                        <div key={idx} className="relative flex items-start gap-3">
                          {!isLast && (
                            <span
                              className="absolute left-[13px] top-[26px] bottom-[-16px] w-[2px] bg-slate-200 dark:bg-slate-700"
                              aria-hidden="true"
                            />
                          )}
                          <div
                            className={cn(
                              "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm transition-all",
                              isLast
                                ? "bg-[rgb(var(--primary))] text-white ring-2 ring-[rgb(var(--primary)/0.3)]"
                                : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            )}
                          >
                            {stepNum}
                          </div>
                          <div className="min-w-0 flex-1 pt-0.5">
                            <div className="text-xs font-medium text-[rgb(var(--fg))]">
                              {inst.text}
                            </div>
                            {inst.distance > 0 ? (
                              <div className="mt-0.5 text-[11px] text-[rgb(var(--muted-fg))]">
                                {Math.round(inst.distance)} m
                                {inst.floor ? ` · ${inst.floor}` : inst.building ? ` · ${inst.building}` : " · Outdoor"}
                              </div>
                            ) : (
                              <div className="mt-0.5 text-[11px] font-medium text-[rgb(var(--primary))]">
                                Destination reached
                              </div>
                            )}

                            {/* Reference Photo Button on Step */}
                            {stepPhotoUrl && (
                              <button
                                type="button"
                                onClick={() => setPreviewingPhoto({
                                  url: stepPhotoUrl,
                                  title: inst.targetNodeName || inst.text,
                                  nodeId: inst.targetNodeId,
                                })}
                                className="mt-1.5 inline-flex items-center gap-1.5 rounded-xl border border-[rgb(var(--primary)/0.3)] bg-[rgb(var(--primary)/0.08)] px-2.5 py-1 text-[11px] font-semibold text-[rgb(var(--primary))] hover:bg-[rgb(var(--primary)/0.15)] transition-all cursor-pointer shadow-xs active:scale-95 min-h-[36px]"
                              >
                                <Camera className="h-3.5 w-3.5" />
                                <span>Reference Photo</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {live && toSelected && (
                <LiveRoutePanel
                  destinationId={toSelected.id}
                  fromId={fromSelected?.id || (route?.nodes[0]?.id)}
                  onPosition={(p) => setLivePos(p)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Map view area */}
      <div className="relative flex-1 bg-[rgb(var(--card))]/30">
        <GoogleCampusMap
          route={route}
          alternativeRoute={alternativeRoute}
          onSelectAlternativeRoute={() => {
            if (!alternativeRoute) return;
            const temp = route;
            setRoute(alternativeRoute);
            setAlternativeRoute(temp);
            if (live && fromSelected && toSelected) {
              navSession.startNavigationSession(fromSelected, toSelected, alternativeRoute);
            }
          }}
          livePosition={livePos?.node}
          progress={livePos?.progress}
          gps={gps}
          fromSelected={fromSelected}
          toSelected={toSelected}
          onNavigateToDest={(dest) => pickToDestination(dest)}
        />

        {/* Turn-by-turn Guidance Banner */}
        {live && (navSession.status === "NAVIGATING" || navSession.status === "OFF_ROUTE" || navSession.status === "REROUTING" || navSession.status === "ARRIVED" || navSession.status === "GPS_SIGNAL_LOST") && (() => {
          const allRouteSteps = navSession.activeRoute?.instructions || route?.instructions || [];
          const stepIndex = Math.max(0, Math.min(Math.max(0, allRouteSteps.length - 1), navSession.currentSegmentIndex));
          const activeStep = allRouteSteps[stepIndex] || navSession.currentInstruction || null;
          const upcomingStep = allRouteSteps[stepIndex + 1] || navSession.nextInstruction || null;

          return (
            <TurnByTurnBar
              currentStep={
                activeStep
                  ? {
                      text: activeStep.text,
                      distanceMeters: Math.round(activeStep.distance),
                      icon: activeStep.icon ?? (activeStep.transition === "arrive" ? "arrive" : "straight"),
                      targetNodeId: activeStep.targetNodeId ?? "",
                      targetNodeName: activeStep.targetNodeName,
                      photoUrl: activeStep.photoUrl,
                    }
                  : null
              }
              nextStep={
                upcomingStep
                  ? {
                      text: upcomingStep.text,
                      distanceMeters: Math.round(upcomingStep.distance),
                      icon: upcomingStep.icon ?? (upcomingStep.transition === "arrive" ? "arrive" : "straight"),
                      targetNodeId: upcomingStep.targetNodeId ?? "",
                      targetNodeName: upcomingStep.targetNodeName,
                      photoUrl: upcomingStep.photoUrl,
                    }
                  : null
              }
              allSteps={allRouteSteps}
              totalDistanceMeters={Math.round(navSession.activeRoute?.distance ?? route?.distance ?? 0)}
              remainingDistanceMeters={navSession.distanceRemaining}
              currentStepIndex={stepIndex}
              totalStepsCount={Math.max(1, allRouteSteps.length)}
              isOffRoute={navSession.status === "OFF_ROUTE" || navSession.status === "REROUTING"}
              onEndNavigation={() => {
                setLive(false);
                navSession.cancelNavigationSession();
              }}
              onRecalculate={() => {
                if (fromSelected && toSelected) calculateRoute(fromSelected, toSelected, stops, selectedFloorId, detectedBuilding?.id, travelMode);
              }}
              onNextStep={() => {
                navSession.advanceToNextStep();
              }}
              onPrevStep={() => {
                navSession.advanceToPrevStep();
              }}
              onJumpToStep={(idx) => {
                navSession.jumpToStep(idx);
              }}
            />
          );
        })()}

        {/* Floating Route Summary Bar on Mobile (when route is calculated and viewing map) */}
        {!live && route && mobileView === "map" && toSelected && (
          <div className="fixed bottom-16 left-3 right-3 z-40 md:hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))]/95 p-3.5 shadow-2xl backdrop-blur-md space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold truncate text-[rgb(var(--fg))]">
                      To {toSelected.name}
                    </span>
                    <Badge variant={route.isFallbackWalk ? "warning" : "primary"} className="text-[9px] px-1.5 py-0">
                      {travelMode === "EV" ? (route.isFallbackWalk ? "Walk" : "EV") : "Walk"}
                    </Badge>
                  </div>
                  <div className="text-[11px] font-semibold text-[rgb(var(--muted-fg))] mt-0.5">
                    {Math.round(route.distance)} m · ~{Math.max(1, Math.round(route.durationSec / 60))} min ETA
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMobileView("panel")}
                  className="shrink-0 rounded-xl bg-[rgb(var(--muted))] px-2.5 py-1.5 text-xs font-semibold text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted)/0.8)] transition-colors cursor-pointer"
                >
                  Steps & Details
                </button>
              </div>

              <Button
                onClick={() => {
                  if (!live) {
                    setShowTransportPrompt(true);
                  }
                }}
                variant="gradient"
                className="w-full flex items-center justify-center gap-2 py-2.5 min-h-[42px] text-xs font-bold shadow-md"
              >
                <Navigation2 className="h-3.5 w-3.5" />
                <span>Start Live Navigation</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom Mobile Navigation Bar (Mobile Screens Only, Hidden when Live Navigating) */}
      {!live && (
        <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-[rgb(var(--card))]/95 p-1.5 backdrop-blur-md md:hidden shadow-lg">
          <button
            onClick={() => setMobileView("panel")}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all cursor-pointer min-h-[44px]",
              mobileView === "panel"
                ? "bg-[rgb(var(--primary))] text-white shadow-xs"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
            )}
          >
            <Navigation2 className="h-4 w-4" />
            <span>Route Planner</span>
          </button>
          <button
            onClick={() => {
              setMobileView("map");
              if (gps && !gps.isTracking) {
                gps.startTracking();
              }
            }}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition-all cursor-pointer min-h-[44px]",
              mobileView === "map"
                ? "bg-[rgb(var(--primary))] text-white shadow-xs"
                : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
            )}
          >
            <MapPin className="h-4 w-4" />
            <span>Map Focus</span>
            {route && <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />}
          </button>
        </div>
      )}

      {/* Transport Mode Selection Modal ("How are you travelling?") */}
      <AnimatePresence>
        {showTransportPrompt && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              className="w-full max-w-sm rounded-3xl border bg-[rgb(var(--card))] p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <div>
                  <h2 className="text-base font-bold text-[rgb(var(--fg))]">How are you travelling?</h2>
                  <p className="text-xs text-[rgb(var(--muted-fg))]">Select your travel mode for live navigation</p>
                </div>
                <button
                  onClick={() => setShowTransportPrompt(false)}
                  className="rounded-full p-2 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] transition-colors min-h-[36px]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => handleConfirmTransportMode("WALK")}
                  className={cn(
                    "flex flex-col items-center gap-2.5 rounded-2xl border p-4 transition-all active:scale-95 text-center cursor-pointer min-h-[100px]",
                    travelMode === "WALK"
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 ring-2 ring-emerald-500/30 font-bold"
                      : "hover:bg-[rgb(var(--muted))] text-[rgb(var(--fg))]"
                  )}
                >
                  <Footprints className="h-7 w-7" />
                  <div>
                    <div className="text-sm font-bold">Walk</div>
                    <div className="text-[10px] text-[rgb(var(--muted-fg))] mt-0.5">Corridors, stairs & paths</div>
                  </div>
                </button>

                <button
                  onClick={() => handleConfirmTransportMode("EV")}
                  className={cn(
                    "flex flex-col items-center gap-2.5 rounded-2xl border p-4 transition-all active:scale-95 text-center cursor-pointer min-h-[100px]",
                    travelMode === "EV"
                      ? "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-2 ring-blue-500/30 font-bold"
                      : "hover:bg-[rgb(var(--muted))] text-[rgb(var(--fg))]"
                  )}
                >
                  <Car className="h-7 w-7" />
                  <div>
                    <div className="text-sm font-bold">EV Mode</div>
                    <div className="text-[10px] text-[rgb(var(--muted-fg))] mt-0.5">EV-accessible roadways</div>
                  </div>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Indoor Floor Selection Modal */}
      <AnimatePresence>
        {showFloorModal && detectedBuilding && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 12 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-sm rounded-2xl border bg-[rgb(var(--card))] p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))] shrink-0">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[rgb(var(--primary))]">
                      Indoor Floor Detection
                    </div>
                    <h2 className="text-sm font-bold text-[rgb(var(--fg))]">
                      You're inside {detectedBuilding.name}
                    </h2>
                  </div>
                </div>
                <button
                  onClick={() => setShowFloorModal(false)}
                  className="rounded-lg p-2 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))] transition-colors cursor-pointer min-h-[36px]"
                  aria-label="Close Floor Selection"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-xs text-[rgb(var(--muted-fg))] leading-relaxed">
                Which floor are you currently on?
              </p>

              <div className="space-y-1.5 max-h-60 overflow-y-auto">
                {publishedData.floors
                  .filter((f) => f.buildingId === detectedBuilding.id)
                  .sort((a, b) => a.ordinal - b.ordinal)
                  .map((f) => {
                    const isSelected = selectedFloorId === f.id;
                    return (
                      <button
                        key={f.id}
                        onClick={() => handleSelectFloor(f.id)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border p-3 text-left transition-all text-xs font-semibold cursor-pointer min-h-[44px]",
                          isSelected
                            ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.1)] text-[rgb(var(--primary))] ring-1 ring-[rgb(var(--primary))]"
                            : "border-[rgb(var(--border))] hover:bg-[rgb(var(--muted))] text-[rgb(var(--fg))]"
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <Layers className="h-4 w-4 shrink-0 text-[rgb(var(--muted-fg))]" />
                          <span>{f.name}</span>
                        </div>
                        {isSelected ? (
                          <div className="flex items-center gap-1 text-[11px] text-[rgb(var(--primary))] font-bold">
                            <Check className="h-3.5 w-3.5" />
                            <span>Selected</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[rgb(var(--muted-fg))]">{f.code || `L${f.ordinal}`}</span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reference Photo Preview Modal */}
      <AnimatePresence>
        {previewingPhoto && (
          <div className="fixed inset-0 w-screen h-screen min-w-full min-h-full z-[100000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs animate-in fade-in duration-200 overflow-hidden select-none">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-lg rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2">
                  <Camera className="h-5 w-5 text-[rgb(var(--primary))]" />
                  <div>
                    <h3 className="font-bold text-base text-[rgb(var(--fg))]">{previewingPhoto.title}</h3>
                    <p className="text-[11px] text-[rgb(var(--muted-fg))]">Reference Location Photo</p>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => { setPreviewingPhoto(null); setPreviewPhotoError(false); }} className="h-8 w-8 p-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="relative w-full overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] flex items-center justify-center min-h-[160px]">
                {previewPhotoError ? (
                  <div className="flex flex-col items-center justify-center p-8 text-center text-[rgb(var(--muted-fg))] space-y-2">
                    <Camera className="h-10 w-10 text-[rgb(var(--muted-fg)/0.4)]" />
                    <p className="text-sm font-semibold text-[rgb(var(--fg))]">Photo Not Available</p>
                    <p className="text-xs text-[rgb(var(--muted-fg))] max-w-xs">
                      Reference image for <span className="font-medium text-[rgb(var(--fg))]">{previewingPhoto.title}</span> is not stored on the cloud server.
                    </p>
                  </div>
                ) : (
                  <img
                    src={previewingPhoto.url}
                    alt={`Reference for ${previewingPhoto.title}`}
                    className="w-full h-auto max-h-[70vh] object-contain rounded-xl"
                    onError={(e) => {
                      const apiFallback = previewingPhoto.nodeId ? `/api/nodes/${previewingPhoto.nodeId}/photo` : null;
                      const targetNode = publishedData.nodes.find((n) => n.id === previewingPhoto.nodeId);
                      const imgEl = e.target as HTMLImageElement;

                      if (apiFallback && !imgEl.src.endsWith(apiFallback)) {
                        imgEl.src = apiFallback;
                      } else if (targetNode?.photoUrl && !imgEl.src.endsWith(targetNode.photoUrl)) {
                        imgEl.src = targetNode.photoUrl;
                      } else {
                        setPreviewPhotoError(true);
                      }
                    }}
                  />
                )}
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-[rgb(var(--muted-fg))]">Visual Landmark Guidance</span>
                <Button size="sm" onClick={() => { setPreviewingPhoto(null); setPreviewPhotoError(false); }} className="bg-[rgb(var(--primary))] text-white px-5 min-h-[38px]">
                  Close
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-[rgb(var(--bg))] p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-[rgb(var(--muted-fg))]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-lg font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function PopularList({
  onPick,
  allDestinations,
  mounted,
  locationOf,
}: {
  onPick: (d: Destination) => void;
  allDestinations: Destination[];
  mounted?: boolean;
  locationOf: (floorId?: string) => string;
}) {
  const items = useMemo(() => allDestinations.slice(0, 6), [allDestinations]);

  if (mounted !== undefined && !mounted) return null;

  if (items.length === 0) {
    return (
      <EmptyState
        compact
        icon={MapPin}
        title="Nothing to navigate to yet"
        description="Once a campus map is published, popular destinations appear here and you can search for any room, lab or gate."
      />
    );
  }

  return (
    <div suppressHydrationWarning>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-[rgb(var(--muted-fg))]">
        Popular destinations
      </div>
      <div className="space-y-2">
        {items.map((d) => (
          <button
            key={d.id}
            suppressHydrationWarning
            onClick={() => onPick(d)}
            className="group flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all hover:border-[rgb(var(--border-strong))] hover:bg-[rgb(var(--muted))] hover:shadow-[var(--shadow-sm)] cursor-pointer min-h-[44px]"
          >
            <div className="rounded-lg bg-[rgb(var(--primary)/0.1)] p-2 text-[rgb(var(--primary))]">
              <MapPin className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{d.name}</div>
              <div className="truncate text-xs text-[rgb(var(--muted-fg))]">
                {d.category} · {locationOf(d.floorId)}
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))] opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}
