"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Navigation,
  LocateFixed,
  Locate,
  Footprints,
  Zap,
  X,
  Route,
  MapPin,
  Sparkles,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/lib/utils";
import { canvasToGps } from "@/lib/geo/projection";
import { calculateGeographicDistance } from "@/lib/geo/haversine";
import { buildAdjacencyGraph } from "@/lib/routing/graph";
import { findShortestPath, type PathResult } from "@/lib/routing/dijkstra";
import { isPointInsideBuilding } from "@/lib/geo/building-geometry";
import { computeEdgeSnappedShortestPath } from "@/lib/geo/edge-snapping";
import type { TravelMode } from "@/lib/routing/edge-accessibility";
import type { Node, Edge, Obstacle, Destination, Building, Floor } from "@/shared/data/campus";

export interface FakeLocationState {
  isActive: boolean;
  pos: { x: number; y: number; lat: number; lng: number; floorId: string } | null;
  targetNodeId: string;
  travelMode: TravelMode;
  matchedNode: Node | null;
  matchedDistanceMeters: number;
  routeResult: PathResult | null;
  isDragging: boolean;
}

export interface UseCadFakeLocationProps {
  nodes: Node[];
  edges: Edge[];
  obstacles: Obstacle[];
  destinations: Destination[];
  buildings?: Building[];
  floors?: Floor[];
  activeFloorId: string;
}

export function useCadFakeLocation({
  nodes,
  edges,
  obstacles,
  destinations,
  buildings,
  floors,
  activeFloorId,
}: UseCadFakeLocationProps) {
  const [isActive, setIsActive] = useState(false);
  const [pos, setPos] = useState<{
    x: number;
    y: number;
    lat: number;
    lng: number;
    floorId: string;
  } | null>(null);
  const [targetNodeId, setTargetNodeId] = useState<string>("");
  const [travelMode, setTravelMode] = useState<TravelMode>("WALK");
  const [isDragging, setIsDragging] = useState(false);

  // Helper to find nearby candidate nodes sorted by proximity to the pin
  const findNearbyCandidateNodes = useCallback(
    (x: number, y: number, floorId: string): { node: Node; distanceMeters: number }[] => {
      if (!nodes || nodes.length === 0) return [];

      const { lat, lng } = canvasToGps(x, y);

      // 1. Detect if the pin is physically inside any building polygon
      const userBuilding = (buildings && buildings.length > 0)
        ? buildings.find((b) => isPointInsideBuilding(x, y, b, 0))
        : null;

      let candidateNodes: Node[] = [];

      if (userBuilding) {
        // Pin is INSIDE a building: candidates MUST be this building's indoor nodes or entrance doors
        const bldFloorIds = new Set((floors || []).filter((f) => f.buildingId === userBuilding.id).map((f) => f.id));
        candidateNodes = nodes.filter((n) => {
          const isEntrance = Boolean(
            n.isEntranceNode ||
            n.type === "BUILDING_ENTRANCE" ||
            n.type === "ENTRANCE" ||
            (n.name && n.name.toLowerCase().includes("entrance"))
          );
          const isFloorMatch = n.floorId && bldFloorIds.has(n.floorId);
          const isBuildingDirect = (n as any).buildingId === userBuilding.id;
          return isEntrance || isFloorMatch || isBuildingDirect;
        });
      } else {
        // Pin is OUTDOORS: candidates MUST be outdoor walkways, roads, gates, or building entrance doors.
        // Strictly exclude indoor rooms, staircases, and lifts inside other buildings to prevent wall penetration!
        candidateNodes = nodes.filter((n) => {
          const isIndoorStructural =
            n.type === "STAIR" ||
            n.type === "LIFT" ||
            n.type === "LABORATORY" ||
            n.type === "OFFICE" ||
            n.type === "WASHROOM";

          if (isIndoorStructural && n.floorId !== "f-out" && !n.isEntranceNode) {
            return false;
          }

          const isOutdoorFloor = n.floorId === "f-out" || n.floorId === "outdoor" || !n.floorId;
          const isOutdoorType =
            n.type === "OUTDOOR" ||
            n.type === "OUTDOOR_PATH" ||
            n.type === "ROAD_JUNCTION" ||
            n.type === "GATE" ||
            n.type === "BUILDING_ENTRANCE" ||
            n.type === "CORRIDOR" ||
            n.type === "JUNCTION" ||
            n.type === "ENTRANCE" ||
            n.type === "EXIT" ||
            n.isEntranceNode;

          return isOutdoorFloor || isOutdoorType;
        });
      }

      const pool = candidateNodes.length > 0 ? candidateNodes : nodes;

      const scored = pool.map((n) => {
        let dist = 0;
        if (n.lat && n.lng && lat && lng) {
          dist = calculateGeographicDistance(lat, lng, n.lat, n.lng);
        } else {
          const dx = n.x - x;
          const dy = n.y - y;
          dist = Math.sqrt(dx * dx + dy * dy) * 0.4;
        }
        return {
          node: n,
          distanceMeters: Math.round(dist * 10) / 10,
        };
      });

      // Sort by proximity to pin and keep top 10 closest candidates
      return scored.sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 10);
    },
    [nodes, buildings, floors]
  );

  // Real-World Continuous Pathfinding Entry Resolution:
  // Dynamically snaps the user to the nearest edge projection point or closest node,
  // connecting anywhere along the edge without forcing backtracking.
  const { matchedNode, matchedDistanceMeters, routeResult } = useMemo(() => {
    if (!pos) {
      return { matchedNode: null, matchedDistanceMeters: 0, routeResult: null };
    }

    return computeEdgeSnappedShortestPath(
      pos.x,
      pos.y,
      targetNodeId,
      nodes,
      edges,
      obstacles,
      travelMode,
      pos.floorId,
      pos.lat,
      pos.lng
    );
  }, [pos, targetNodeId, nodes, edges, obstacles, travelMode]);

  // Set fake position at given canvas coordinates
  const setFakePosition = useCallback(
    (x: number, y: number, floorId?: string) => {
      const currentFloor = floorId ?? activeFloorId;
      const { lat, lng } = canvasToGps(x, y);
      setPos({
        x,
        y,
        lat: Number(lat.toFixed(9)),
        lng: Number(lng.toFixed(9)),
        floorId: currentFloor,
      });
    },
    [activeFloorId]
  );

  const clearFakePosition = useCallback(() => {
    setPos(null);
    setTargetNodeId("");
  }, []);

  const toggleActive = useCallback(() => {
    setIsActive((prev) => {
      const next = !prev;
      if (!next) {
        setPos(null);
      }
      return next;
    });
  }, []);

  return {
    isActive,
    setIsActive,
    toggleActive,
    pos,
    setFakePosition,
    clearFakePosition,
    targetNodeId,
    setTargetNodeId,
    travelMode,
    setTravelMode,
    matchedNode,
    matchedDistanceMeters,
    routeResult,
    isDragging,
    setIsDragging,
  };
}

export type CadFakeLocationHook = ReturnType<typeof useCadFakeLocation>;

// Quick Actions Sidebar Button & Control Panel

export function CadFakeLocationButton({
  fakeGps,
  nodes,
  destinations,
}: {
  fakeGps: CadFakeLocationHook;
  nodes: Node[];
  destinations: Destination[];
}) {
  const allowedDestinations = useMemo(() => {
    const destMap = new Map<string, string>();
    destinations.forEach((d) => {
      if (d.nodeId) {
        destMap.set(d.nodeId, `${d.name} ${d.roomNumber ? `(#${d.roomNumber})` : ""}`);
      }
    });

    return nodes
      .filter((n) => destMap.has(n.id) || (n.name && n.name.trim().length > 0))
      .map((n) => ({
        id: n.id,
        name: destMap.get(n.id) || n.name || n.id,
        type: n.type,
      }));
  }, [nodes, destinations]);

  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        onClick={fakeGps.toggleActive}
        className={cn(
          "w-full justify-start text-[11px] font-semibold transition-all relative overflow-hidden",
          fakeGps.isActive
            ? "bg-sky-600 text-white border-sky-500 shadow-md hover:bg-sky-700"
            : "text-sky-600 border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 dark:text-sky-400"
        )}
      >
        <LocateFixed
          className={cn(
            "mr-1.5 h-3.5 w-3.5",
            fakeGps.isActive ? "text-white animate-spin-slow" : "text-sky-500"
          )}
        />
        <span>{fakeGps.isActive ? "Fake GPS: Active" : "Test by Fake Location"}</span>
        {fakeGps.isActive && (
          <span className="ml-auto flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-300 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
          </span>
        )}
      </Button>

      {/* Expanded Route Testing Panel when Active */}
      {fakeGps.isActive && (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-2.5 space-y-2.5 text-xs animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="flex items-center justify-between">
            <span className="font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1 text-[11px]">
              <Sparkles className="h-3 w-3" /> Pin Route Tester
            </span>
            {fakeGps.pos && (
              <button
                type="button"
                onClick={fakeGps.clearFakePosition}
                className="text-[10px] text-[rgb(var(--muted-fg))] hover:text-red-500 flex items-center gap-0.5"
                title="Clear fake GPS pin"
              >
                <X className="h-3 w-3" /> Clear Pin
              </button>
            )}
          </div>

          <p className="text-[10px] text-[rgb(var(--muted-fg))] leading-tight">
            {fakeGps.pos
              ? "Drag pin anywhere on canvas to test live routing logic."
              : "Click anywhere on the CAD Canvas to drop fake live GPS pin."}
          </p>

          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-[rgb(var(--bg))] p-0.5 rounded-lg border">
            <button
              type="button"
              onClick={() => fakeGps.setTravelMode("WALK")}
              className={cn(
                "flex-1 py-1 text-center rounded text-[10px] font-semibold transition-all flex items-center justify-center gap-1",
                fakeGps.travelMode === "WALK"
                  ? "bg-sky-600 text-white shadow-2xs"
                  : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              )}
            >
              <Footprints className="h-3 w-3" /> Walk
            </button>
            <button
              type="button"
              onClick={() => fakeGps.setTravelMode("EV")}
              className={cn(
                "flex-1 py-1 text-center rounded text-[10px] font-semibold transition-all flex items-center justify-center gap-1",
                fakeGps.travelMode === "EV"
                  ? "bg-emerald-600 text-white shadow-2xs"
                  : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              )}
            >
              <Zap className="h-3 w-3" /> EV Mode
            </button>
          </div>

          {/* Target Destination Dropdown */}
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-[rgb(var(--fg))] flex items-center gap-1">
              <MapPin className="h-3 w-3 text-sky-500" /> Route To Destination:
            </label>
            <select
              value={fakeGps.targetNodeId}
              onChange={(e) => fakeGps.setTargetNodeId(e.target.value)}
              className="h-7 w-full rounded-md border bg-[rgb(var(--bg))] px-2 text-[11px] text-[rgb(var(--fg))] focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="">-- Select Destination Node --</option>
              {allowedDestinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.type})
                </option>
              ))}
            </select>
          </div>

          {/* Live Status & Route Metrics */}
          {fakeGps.pos && (
            <div className="rounded-lg bg-[rgb(var(--bg))] p-2 border border-sky-500/20 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[rgb(var(--muted-fg))]">Nearest Node:</span>
                <span className="font-semibold text-[rgb(var(--fg))] truncate max-w-[120px]" title={fakeGps.matchedNode?.name || fakeGps.matchedNode?.id || "None"}>
                  {fakeGps.matchedNode?.name || fakeGps.matchedNode?.id || "None"} ({fakeGps.matchedDistanceMeters}m)
                </span>
              </div>

              {fakeGps.routeResult ? (
                <div className="pt-1.5 border-t border-[rgb(var(--border))] space-y-1">
                  <div className="flex items-center justify-between font-bold text-sky-600 dark:text-sky-400">
                    <span className="flex items-center gap-1">
                      <Route className="h-3 w-3" /> Total Route:
                    </span>
                    <span>{fakeGps.routeResult.totalDistance} m</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[rgb(var(--muted-fg))]">
                    <span>Path Waypoints:</span>
                    <span>{fakeGps.routeResult.nodes.length} nodes</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-[rgb(var(--muted-fg))]">
                    <span>Est. Time:</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                      {Math.max(1, Math.round(fakeGps.routeResult.totalDistance / 70))} min
                    </span>
                  </div>
                </div>
              ) : fakeGps.targetNodeId ? (
                <div className="pt-1 text-[10px] text-amber-500 font-medium text-center">
                  ⚠ No path found to selected destination
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// SVG Canvas Layer (Pin, Tether, and Route Path)

export function CadFakeLocationSvgLayer({
  fakeGps,
  activeFloorId,
  getCanvasCoords,
}: {
  fakeGps: CadFakeLocationHook;
  activeFloorId: string;
  getCanvasCoords: (e: React.MouseEvent | MouseEvent) => { x: number; y: number };
}) {
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const rafRef = useRef<number | null>(null);
  const nextDragPosRef = useRef<{ x: number; y: number } | null>(null);

  if (!fakeGps.isActive || !fakeGps.pos) {
    return null;
  }

  const { x, y, floorId } = fakeGps.pos;
  const isFloorMatch =
    floorId === "f-out" ||
    activeFloorId === "f-out" ||
    activeFloorId === "f-all" ||
    floorId === activeFloorId;

  if (!isFloorMatch) {
    return null;
  }

  const matched = fakeGps.matchedNode;

  return (
    <g className="cad-fake-location-layer pointer-events-auto">
      {/* Route Path highlight polyline from Dijkstra Path Result */}
      {fakeGps.routeResult && fakeGps.routeResult.nodes.length > 1 && (
        <g>
          {/* Glowing underlay */}
          <polyline
            points={fakeGps.routeResult.nodes.map((n) => `${n.x},${n.y}`).join(" ")}
            fill="none"
            stroke="rgba(14, 165, 233, 0.35)"
            strokeWidth="12"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Main animated route line */}
          <polyline
            points={fakeGps.routeResult.nodes.map((n) => `${n.x},${n.y}`).join(" ")}
            fill="none"
            stroke="#0284c7"
            strokeWidth="4"
            strokeDasharray="8 6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="animate-pulse"
          />
          {/* Waypoint circles along the route */}
          {fakeGps.routeResult.nodes.map((n, i) => (
            <circle
              key={`route-wpt-${n.id}-${i}`}
              cx={n.x}
              cy={n.y}
              r={i === 0 || i === fakeGps.routeResult!.nodes.length - 1 ? 6 : 3.5}
              fill={i === fakeGps.routeResult!.nodes.length - 1 ? "#ef4444" : "#0284c7"}
              stroke="#ffffff"
              strokeWidth="2"
            />
          ))}
        </g>
      )}

      {/* Dashed Tether Line connecting Fake GPS Pin to Nearest Snapped Node */}
      {matched && (
        <g>
          <line
            x1={x}
            y1={y}
            x2={matched.x}
            y2={matched.y}
            stroke="#0284c7"
            strokeWidth="2"
            strokeDasharray="4 4"
            opacity="0.8"
          />
          <circle cx={matched.x} cy={matched.y} r="5" fill="#0284c7" stroke="var(--map-halo)" strokeWidth="2" />
        </g>
      )}

      {/* Draggable Live Fake GPS Pin Group */}
      <g
        transform={`translate(${x}, ${y})`}
        className="cursor-grab active:cursor-grabbing select-none"
        onMouseDown={(e) => {
          e.stopPropagation();
          fakeGps.setIsDragging(true);
          const startCoords = getCanvasCoords(e);
          dragStartPosRef.current = startCoords;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const curCoords = getCanvasCoords(moveEvent);
            nextDragPosRef.current = curCoords;
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null;
                if (nextDragPosRef.current) {
                  fakeGps.setFakePosition(nextDragPosRef.current.x, nextDragPosRef.current.y, activeFloorId);
                }
              });
            }
          };

          const handleMouseUp = () => {
            fakeGps.setIsDragging(false);
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
          };

          window.addEventListener("mousemove", handleMouseMove);
          window.addEventListener("mouseup", handleMouseUp);
        }}
      >
        {/* Pulsing Radar Wave 1 */}
        <circle r="32" fill="rgba(14, 165, 233, 0.18)" className="animate-ping" style={{ animationDuration: "2.4s" }} />

        {/* Outer Halo */}
        <circle r="20" fill="rgba(14, 165, 233, 0.25)" stroke="#38bdf8" strokeWidth="1.5" />

        {/* Center Blue GPS Orb */}
        <circle r="9" fill="#0284c7" stroke="var(--map-halo)" strokeWidth="3" className="drop-shadow-md" />

        {/* Directional Beacon Compass Arrow */}
        <path
          d="M 0 -14 L 4 -8 L -4 -8 Z"
          fill="#0284c7"
          stroke="#ffffff"
          strokeWidth="1"
        />

        {/* Text Badge Label */}
        <g transform="translate(0, -22)">
          <rect
            x="-45"
            y="-14"
            width="90"
            height="18"
            rx="9"
            fill="#0f172a"
            fillOpacity="0.9"
            stroke="#38bdf8"
            strokeWidth="1"
          />
          <text
            x="0"
            y="-2"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="9"
            fontWeight="bold"
            className="pointer-events-none select-none font-mono"
          >
            FAKE GPS PIN
          </text>
        </g>
      </g>
    </g>
  );
}
