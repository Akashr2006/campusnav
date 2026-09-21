"use client";

import React, { useCallback, useEffect, useState, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2,
  Layers,
  Waypoints,
  GitFork,
  DoorOpen,
  Undo2,
  Redo2,
  Rocket,
  Trash2,
  Plus,
  Maximize2,
  Minimize2,
  Check,
  X,
  AlertTriangle,
  Sparkles,
  Activity,
  Navigation,
  Compass,
  Play,
  Zap,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Network,
  Search,
  Copy,
  CheckCheck,
  MousePointer,
  XCircle,
  History,
  Pencil,
  RefreshCw,
  Locate,
  Share2,
  Camera,
  CheckCircle2,
  Hash,
  Spline,
  CornerDownRight,
  ShieldCheck,
  Filter,
  Grid,
  FileCode,
  Crosshair,
  Sliders,
  ChevronDown,
  ChevronRight,
  CornerUpRight,
  FileSpreadsheet,
  Image as ImageIcon,
  FolderOpen,
  Download,
  Upload,
  ArrowRight,
  Route as RouteIcon,
  HelpCircle,
  Info,
  ShieldAlert,
  Loader2,
  MapPin,
  Flame,
  Accessibility,
} from "lucide-react";
import { MAX_MAP_ZOOM, MIN_MAP_ZOOM, computeDesktopWheelMultiplier, cleanStairLiftDisplayName } from "@/shared/lib/map-config";

import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { isPointInCampusBoundary, CAMPUS_POLYGON_COORDS } from "@/lib/geo/boundary";
import { canvasToGps, gpsToCanvas } from "@/lib/geo/projection";
import { getBuildingCanvasPoints, getBuildingCenter, getPolygonSvgPath, getPolygonPointsString, isPointInsideBuilding, isPointOutsideAllBuildings } from "@/lib/geo/building-geometry";
import { calculateGeographicDistance } from "@/lib/geo/haversine";
import { Badge } from "@/shared/components/ui/badge";
import { useToast } from "@/shared/components/ui/toast";
import { cn } from "@/shared/lib/utils";
import { campusStore, type PendingChange } from "@/shared/lib/campus-store";
import { generateShortId } from "@/shared/lib/id-generator";
import { PublishModal } from "@/shared/components/publish-modal";
import { isEventActive, getEventStatus } from "@/shared/lib/event-utils";
import { useVisitorGps } from "@/shared/hooks/use-visitor-gps";
import { useCadFakeLocation, CadFakeLocationButton, CadFakeLocationSvgLayer } from "./cad-fake-location";
import { GpsStatusIndicator } from "@/features/location/components/gps-status-indicator";
import { GpsDiagnosticsPanel } from "@/features/location/components/gps-diagnostics-panel";
import {
  getFloorCode,
  type Building,
  type Floor,
  type Node,
  type Edge,
  type Destination,
  type NodeType,
  type EdgeType,
  type PathType,
  type Event,
  type Obstacle,
  type Door,
  type DoorType,
  type SuggestedNode,
  type SuggestedEdge,
} from "@/shared/data/campus";
import {
  validateCampusGraph,
  SOFT_CAMPUS_BOUNDS,
  type GraphValidationReport,
} from "@/lib/validation/graph-validator";
import { buildAdjacencyGraph, getObstructedEdgeIds } from "@/lib/routing/graph";
import { findShortestPath, findMultiWaypointPath, type PathResult } from "@/lib/routing/dijkstra";
import { getEdgePathType, getPathTypeLabel, type TravelMode } from "@/lib/routing/edge-accessibility";

type ToolMode =
  | "BUILDING"
  | "FLOOR"
  | "NODE"
  | "EDGE"
  | "DESTINATION"
  | "ROOM"
  | "DOOR"
  | "OBSTACLE"
  | "EVENT"
  | "SIMULATE"
  | "SELECT"
  | "PLACE_VERTICAL";

function DimensionInput({
  label,
  value,
  min = 50,
  max = 10000,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
}) {
  const [localVal, setLocalVal] = useState(String(value));

  useEffect(() => {
    setLocalVal(String(value));
  }, [value]);

  const handleChange = (inputVal: string) => {
    setLocalVal(inputVal);
    const cleanStr = inputVal.replace(/px/gi, "").trim();
    if (cleanStr === "") return;
    const num = Number(cleanStr);
    if (!isNaN(num) && num >= min && num <= max) {
      onChange(num);
    }
  };

  const handleBlur = () => {
    const cleanStr = localVal.replace(/px/gi, "").trim();
    let num = Number(cleanStr);
    if (isNaN(num) || num < min) {
      num = min;
    } else if (num > max) {
      num = max;
    }
    setLocalVal(String(num));
    onChange(num);
    if (onCommit) onCommit(num);
  };

  return (
    <div>
      <label className="mb-1 block font-medium">{label}</label>
      <Input
        type="text"
        value={localVal}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleBlur();
          }
        }}
        className="h-8 text-xs font-mono"
      />
    </div>
  );
}

export function DigitalTwinEditor({ initialTool = "SELECT" }: { initialTool?: ToolMode }) {
  const [storeData, setStoreData] = useState(campusStore.getWorkingData());
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>(campusStore.getPendingChanges());
  const [showMobilePanels, setShowMobilePanels] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [activeTool, setActiveTool] = useState<ToolMode>(initialTool);
  const [activeFloorId, setActiveFloorId] = useState<string>("f-out");
  const gps = useVisitorGps();

  // Standalone Fake Live Location Tool Hook for CAD route testing
  const fakeGps = useCadFakeLocation({
    nodes: storeData.nodes,
    edges: storeData.edges,
    obstacles: storeData.obstacles,
    destinations: storeData.destinations,
    buildings: storeData.buildings,
    floors: storeData.floors,
    activeFloorId,
  });

  // Subscribe to live campusStore changes and sync with database on mount
  useEffect(() => {
    setStoreData(campusStore.getWorkingData());
    setPendingChanges(campusStore.getPendingChanges());
    campusStore.syncWithServer().then(() => {
      setStoreData(campusStore.getWorkingData());
      setPendingChanges(campusStore.getPendingChanges());
    });
    const unsubscribe = campusStore.subscribe(() => {
      setStoreData(campusStore.getWorkingData());
      setPendingChanges(campusStore.getPendingChanges());
    });
    return unsubscribe;
  }, []);



  // In-Editor Search State
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocusedId, setSearchFocusedId] = useState<string | null>(null);

  // Canvas Multi-Select & Box Selection State
  const [selectedEntityIds, setSelectedEntityIds] = useState<Set<string>>(new Set());
  const [isBoxSelecting, setIsBoxSelecting] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxEnd, setBoxEnd] = useState<{ x: number; y: number } | null>(null);

  // Interactive Room Tool Form & Drag State
  const [roomCategory, setRoomCategory] = useState<string>("Classroom");
  const [roomNumber, setRoomNumber] = useState("101");
  const [roomNameInput, setRoomNameInput] = useState("Classroom A");
  const [isDrawingRoom, setIsDrawingRoom] = useState(false);
  const [roomDragStart, setRoomDragStart] = useState<{ x: number; y: number } | null>(null);
  const [roomDragCurrent, setRoomDragCurrent] = useState<{ x: number; y: number } | null>(null);



  // Door Tool & Connection State
  const [doorType, setDoorType] = useState<DoorType>("ROOM_DOOR");
  const [edgeStartDoorId, setEdgeStartDoorId] = useState<string | null>(null);

  // Mini-Map Navigation State
  const [isAnimatingPan, setIsAnimatingPan] = useState(false);

  // Selective Node Reference Photo Modal State
  const [viewingPhotoNode, setViewingPhotoNode] = useState<{ id: string; name: string; photoUrl: string; lat?: number; lng?: number; physicalVerified?: boolean } | null>(null);



  // Dynamic Clock State for Real-Time Event Expiration
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Auto-Save Indicator State
  const [autoSaveStatus, setAutoSaveStatus] = useState("Auto-Save Active");

  // Filtered nodes that are valid user-navigatable destinations (similar to navigate-shell.tsx)
  const allowedNodes = useMemo(() => {
    const destNodeIds = new Set(
      (storeData.destinations || [])
        .filter((d) => d.category !== "Building")
        .map((d) => d.nodeId)
    );

    return (storeData.nodes || []).filter((n) => {
      if (destNodeIds.has(n.id)) return true;
      if (n.name && n.name.trim().length > 0) {
        const typeLabel =
          n.type === "GATE"
            ? "Gate / Entrance"
            : n.type === "BUILDING_ENTRANCE" || n.type === "ROOM_ENTRANCE"
              ? "Entrance"
              : n.type === "STAIR" || n.type === "LIFT"
                ? "Floor Transition"
                : n.type === "RECEPTION"
                  ? "Reception"
                  : n.type === "ROOM" || n.type === "LABORATORY" || n.type === "OFFICE"
                    ? "Classroom / Room"
                    : n.type === "OUTDOOR" || n.type === "OUTDOOR_PATH" || n.type === "ROAD_JUNCTION"
                      ? "Campus Landmark"
                      : "Map Location";
        return true;
      }
      return false;
    });
  }, [storeData]);

  // Bulk Edit Form State
  const [bulkCategoryInput, setBulkCategoryInput] = useState("Classroom");
  const [bulkRenameInput, setBulkRenameInput] = useState("Room");


  // Stair / Lift Group Modal State (Merged)
  const [isVerticalModalOpen, setIsVerticalModalOpen] = useState(false);
  const [verticalType, setVerticalType] = useState<"STAIR" | "LIFT">("STAIR");
  const [verticalName, setVerticalName] = useState("Main Staircase A");
  const [verticalBuildingId, setVerticalBuildingId] = useState("");
  const [verticalSelectedFloorIds, setVerticalSelectedFloorIds] = useState<string[]>([]);

  // Pending vertical connection placement state
  const [pendingVerticalConnection, setPendingVerticalConnection] = useState<{
    type: "STAIR" | "LIFT";
    name: string;
    buildingId: string;
    selectedFloorIds: string[];
  } | null>(null);

  // Rename Modal State
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameInputValue, setRenameInputValue] = useState("");
  const [renameShortCodeValue, setRenameShortCodeValue] = useState("");

  // Delete All Confirmation Modal State
  const [isDeleteAllModalOpen, setIsDeleteAllModalOpen] = useState(false);

  // Obstacle Tool Form State
  const [obstacleReason, setObstacleReason] = useState("Under Construction");
  const [obstacleRadius, setObstacleRadius] = useState(30);
  const [obstacleExpiresAt, setObstacleExpiresAt] = useState("");

  const [selectedElement, setSelectedElement] = useState<{
    type: "building" | "floor" | "node" | "edge" | "destination" | "event" | "obstacle" | "stairGroup" | "liftGroup" | "door";
    id: string;
  } | null>(null);

  // Layer Visibility State for Quick Actions Hierarchy
  const [visibleLayers, setVisibleLayers] = useState({
    buildings: true,
    nodes: true,
    edges: true,
    rooms: true,
    obstacles: true,
    events: true,
    outdoor: true,
  });

  // State to toggle hiding node names while keeping node circles visible & interactive
  const [hideNodeNames, setHideNodeNames] = useState(false);

  // Dragging State for Direct Element Dragging
  const [draggingId, setDraggingId] = useState<{
    type: "node" | "building" | "obstacle" | "event" | "door";
    id: string;
  } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Pan & Zoom Viewport State
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showSoftBounds, setShowSoftBounds] = useState(true);
  const [zoom, setZoom] = useState(0.20);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Refs to prevent accidental element placement during map pan/drag
  const hasDraggedRef = useRef(false);
  const mouseDownScreenPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDownCanvasPosRef = useRef<{ x: number; y: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const dragTargetPosRef = useRef<{ x: number; y: number } | null>(null);



  const [edgeStartNodeId, setEdgeStartNodeId] = useState<string | null>(null);
  const mouseCanvasPosRef = useRef<{ x: number; y: number }>({ x: 400, y: 400 });
  const panRafRef = useRef<number | null>(null);
  const nextPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const getCanvasCoords = (e: React.MouseEvent | MouseEvent) => {
    if (!canvasRef.current) return { x: 400, y: 300 };
    const rect = canvasRef.current.getBoundingClientRect();
    const curPan = panOffsetRef.current;
    const curZoom = zoomRef.current || 1;
    let x = Math.round((e.clientX - rect.left - curPan.x) / curZoom);
    let y = Math.round((e.clientY - rect.top - curPan.y) / curZoom);
    if (snapToGrid) {
      x = Math.round(x / 20) * 20;
      y = Math.round(y / 20) * 20;
    }
    return { x, y };
  };

  // Drawers & Modals State
  const [showPendingDrawer, setShowPendingDrawer] = useState(false);
  const [showDiagnosticsPanel, setShowDiagnosticsPanel] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  // Forms State
  const [nodeType, setNodeType] = useState<NodeType>("CORRIDOR");
  const [nodeName, setNodeName] = useState("");
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [nodeTargetBuildingId, setNodeTargetBuildingId] = useState<string>("outdoor");
  const [nodeTargetFloorId, setNodeTargetFloorId] = useState<string>("f-out");
  const [buildingName, setBuildingName] = useState("");
  const [buildingCode, setBuildingCode] = useState("");
  const [buildingColor, setBuildingColor] = useState("#4f46e5");
  const [edgeType, setEdgeType] = useState<EdgeType>("WALK");
  const [pendingEdgeModal, setPendingEdgeModal] = useState<{
    startNodeId: string;
    endNodeId: string;
    dist: number;
  } | null>(null);
  const [edgeModalPathType, setEdgeModalPathType] = useState<PathType | "">("");
  const [edgeModalType, setEdgeModalType] = useState<EdgeType>("WALK");
  const [simTravelMode, setSimTravelMode] = useState<TravelMode>("WALK");
  const [destName, setDestName] = useState("");
  const [destCategory, setDestCategory] = useState("Academic");
  const [destAliases, setDestAliases] = useState("");

  // Sync node placement building & floor when activeFloorId changes
  useEffect(() => {
    if (activeFloorId === "f-out") {
      setNodeTargetBuildingId("outdoor");
      setNodeTargetFloorId("f-out");
    } else if (!activeFloorId.startsWith("f-all")) {
      const curFloor = storeData.floors.find((f) => f.id === activeFloorId);
      if (curFloor) {
        setNodeTargetBuildingId((prev) => (prev !== curFloor.buildingId ? curFloor.buildingId : prev));
        setNodeTargetFloorId((prev) => (prev !== curFloor.id ? curFloor.id : prev));
      }
    }
  }, [activeFloorId]);



  // Route Simulator State
  const [simStartNodeId, setSimStartNodeId] = useState<string>("");
  const [simEndNodeId, setSimEndNodeId] = useState<string>("");
  const [simResult, setSimResult] = useState<PathResult | null>(null);
  const [altSimResult, setAltSimResult] = useState<PathResult | null>(null);

  const { toast } = useToast();
  const canvasRef = useRef<SVGSVGElement | null>(null);
  // Refs to keep current zoom/pan values synchronously accessible (single source of truth for high-frequency gestures)
  const zoomRef = useRef(zoom);
  const panOffsetRef = useRef(panOffset);

  // Handle URL focus query parameter to automatically center and highlight target entity on CAD canvas
  const searchParams = useSearchParams();
  const focusParamId = searchParams.get("focus") || searchParams.get("select");

  const hasAutoCenteredRef = useRef(false);

  /**
   * Frame everything on the canvas: derive the zoom from the content bounds
   * rather than assuming a fixed one, then centre what is left.
   */
  const fitToContent = useCallback(() => {
    if (!canvasRef.current) return false;

    const elements = [
      ...storeData.buildings
        .filter((b) => b.x !== undefined && b.y !== undefined)
        .flatMap((b) => [
          { x: b.x!, y: b.y! },
          { x: b.x! + (b.width ?? 180), y: b.y! + (b.height ?? 120) },
        ]),
      ...storeData.nodes.map((n) => ({ x: n.x, y: n.y })),
    ];
    if (elements.length === 0) return false;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    elements.forEach((el) => {
      if (el.x < minX) minX = el.x;
      if (el.x > maxX) maxX = el.x;
      if (el.y < minY) minY = el.y;
      if (el.y > maxY) maxY = el.y;
    });

    const rect = canvasRef.current.getBoundingClientRect();
    const PADDING = 80;
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);
    const nextZoom = Math.min(
      2,
      Math.max(0.1, Math.min((rect.width - PADDING) / spanX, (rect.height - PADDING) / spanY))
    );

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const nextPan = {
      x: rect.width / 2 - cx * nextZoom,
      y: rect.height / 2 - cy * nextZoom,
    };

    zoomRef.current = nextZoom;
    panOffsetRef.current = nextPan;
    setZoom(nextZoom);
    setPanOffset(nextPan);
    return true;
  }, [storeData.buildings, storeData.nodes]);

  useEffect(() => {
    if (hasAutoCenteredRef.current || focusParamId || !canvasRef.current) return;
    if (fitToContent()) {
      hasAutoCenteredRef.current = true;
    }
  }, [focusParamId, fitToContent]);

  const lastFocusedParamRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focusParamId || lastFocusedParamRef.current === focusParamId) return;

    let targetX: number | null = null;
    let targetY: number | null = null;
    let targetFloorId: string | null = null;
    let selectedType: any = null;

    // 1. Building
    const bld = storeData.buildings.find((b) => b.id === focusParamId);
    if (bld && bld.x !== undefined && bld.y !== undefined) {
      targetX = bld.x + (bld.width ?? 180) / 2;
      targetY = bld.y + (bld.height ?? 120) / 2;
      selectedType = { type: "building", id: bld.id };
      setVisibleLayers((l) => ({ ...l, buildings: true }));
    }

    // 2. Node
    if (targetX === null) {
      const node = storeData.nodes.find((n) => n.id === focusParamId);
      if (node) {
        targetX = node.x;
        targetY = node.y;
        targetFloorId = node.floorId;
        selectedType = { type: "node", id: node.id };
        setVisibleLayers((l) => ({ ...l, nodes: true }));
      }
    }

    // 3. Destination / Room
    if (targetX === null) {
      const dest = storeData.destinations.find((d) => d.id === focusParamId);
      if (dest) {
        const linkedNode = storeData.nodes.find((n) => n.id === dest.nodeId);
        targetX = dest.x !== undefined ? dest.x : linkedNode?.x ?? null;
        targetY = dest.y !== undefined ? dest.y : linkedNode?.y ?? null;
        targetFloorId = dest.floorId || linkedNode?.floorId || null;
        selectedType = { type: "destination", id: dest.id };
        setVisibleLayers((l) => ({ ...l, rooms: true }));
      }
    }

    // 4. Floor
    if (targetX === null) {
      const fl = storeData.floors.find((f) => f.id === focusParamId);
      if (fl) {
        targetFloorId = fl.id;
        const bldOfFloor = storeData.buildings.find((b) => b.id === fl.buildingId);
        if (bldOfFloor && bldOfFloor.x !== undefined && bldOfFloor.y !== undefined) {
          targetX = bldOfFloor.x + (bldOfFloor.width ?? 180) / 2;
          targetY = bldOfFloor.y + (bldOfFloor.height ?? 120) / 2;
        }
      }
    }

    // 5. Edge
    if (targetX === null) {
      const edge = storeData.edges.find((e) => e.id === focusParamId);
      if (edge) {
        const fromNode = storeData.nodes.find((n) => n.id === edge.from);
        if (fromNode) {
          targetX = fromNode.x;
          targetY = fromNode.y;
          targetFloorId = fromNode.floorId;
          selectedType = { type: "edge", id: edge.id };
          setVisibleLayers((l) => ({ ...l, edges: true }));
        }
      }
    }

    // 6. Stair Group
    if (targetX === null) {
      const stairNode = storeData.nodes.find((n) => n.stairGroupId === focusParamId);
      if (stairNode) {
        targetX = stairNode.x;
        targetY = stairNode.y;
        targetFloorId = stairNode.floorId;
        selectedType = { type: "stairGroup", id: focusParamId };
        setVisibleLayers((l) => ({ ...l, nodes: true }));
      }
    }

    // 7. Lift Group
    if (targetX === null) {
      const liftNode = storeData.nodes.find((n) => n.liftGroupId === focusParamId);
      if (liftNode) {
        targetX = liftNode.x;
        targetY = liftNode.y;
        targetFloorId = liftNode.floorId;
        selectedType = { type: "liftGroup", id: focusParamId };
        setVisibleLayers((l) => ({ ...l, nodes: true }));
      }
    }

    // 8. Obstacle
    if (targetX === null) {
      const obs = (storeData.obstacles || []).find((o) => o.id === focusParamId);
      if (obs && obs.x !== undefined && obs.y !== undefined) {
        targetX = obs.x;
        targetY = obs.y;
        targetFloorId = obs.floorId || null;
        selectedType = { type: "obstacle", id: obs.id };
        setVisibleLayers((l) => ({ ...l, obstacles: true }));
      }
    }

    if (targetX !== null && targetY !== null) {
      lastFocusedParamRef.current = focusParamId;
      if (targetFloorId) {
        setActiveFloorId(targetFloorId);
      }

      const curZoom = zoomRef.current || 0.8;
      const centeredPanX = 500 - targetX * curZoom;
      const centeredPanY = 350 - targetY * curZoom;

      panOffsetRef.current = { x: centeredPanX, y: centeredPanY };
      setPanOffset(panOffsetRef.current);

      if (selectedType) {
        setSelectedElement(selectedType);
        setSelectedEntityIds(new Set([focusParamId]));
      }

      toast({
        type: "info",
        title: "Focused Target Entity",
        description: `Centered CAD canvas viewport on object (${focusParamId}).`,
      });
    }
  }, [focusParamId]);


  // Event Tool Form State Helpers
  const getCurrentDateTimeISO = () => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const getDefaultEndDateTimeISO = (startDateStr?: string) => {
    const baseDate = startDateStr ? new Date(startDateStr) : new Date();
    if (isNaN(baseDate.getTime())) {
      const d = new Date(Date.now() + 8 * 3600 * 1000);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${d.getHours()}:${pad(d.getMinutes())}`;
    }
    const d = new Date(baseDate.getTime() + 8 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${d.getHours()}:${pad(d.getMinutes())}`;
  };

  const [isAddEventOpen, setIsAddEventOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDesc, setEventDesc] = useState("");
  const [eventBuildingId, setEventBuildingId] = useState("");
  const [eventColor, setEventColor] = useState("#f59e0b");
  const [eventStartsAt, setEventStartsAt] = useState(() => getCurrentDateTimeISO());
  const [eventEndsAt, setEventEndsAt] = useState(() => getDefaultEndDateTimeISO());

  // Sync selected event data to inspector form fields when an event is clicked/selected
  useEffect(() => {
    if (selectedElement?.type === "event" && selectedElement.id) {
      const ev = storeData.events.find((e) => e.id === selectedElement.id);
      if (ev) {
        setEventTitle(ev.title || "");
        setEventDesc(ev.description || "");
        setEventBuildingId(ev.buildingId || "");
        setEventColor(ev.color || "#f59e0b");
        const start = ev.startsAt || getCurrentDateTimeISO();
        setEventStartsAt(start);
        setEventEndsAt(ev.endsAt || getDefaultEndDateTimeISO(start));
      }
    }
  }, [selectedElement?.id, selectedElement?.type]);

  const handleCreateEventSubmit = () => {
    const title = eventTitle.trim() || "Campus Event";
    const isEditing = selectedElement?.type === "event";

    const startDate = new Date(eventStartsAt);
    const endDate = new Date(eventEndsAt);

    if (isNaN(startDate.getTime())) {
      toast({
        type: "error",
        title: "Invalid Start Date",
        description: "Please select a valid event start date & time.",
      });
      return;
    }

    if (isNaN(endDate.getTime()) || endDate <= startDate) {
      toast({
        type: "error",
        title: "Invalid End Date",
        description: "Event End Date & Time must be strictly AFTER the Start Date & Time.",
      });
      return;
    }

    const evId = isEditing ? selectedElement.id : generateShortId("ev", storeData.events.map((e) => e.id));
    const targetBld = storeData.buildings.find((b) => b.id === eventBuildingId);
    const evX = targetBld ? (targetBld.x ?? 0) + (targetBld.width ?? 180) / 2 : 400;
    const evY = targetBld ? (targetBld.y ?? 0) + (targetBld.height ?? 120) / 2 : 300;

    const eventPayload: Event = {
      id: evId,
      campusId: "c1",
      title,
      description: eventDesc.trim() || undefined,
      buildingId: eventBuildingId || undefined,
      color: eventColor,
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      x: evX,
      y: evY,
    };

    if (isEditing) {
      campusStore.updateEvent(evId, eventPayload);
      toast({
        type: "success",
        title: "Event Updated",
        description: `Updated campus event "${title}".`,
      });
    } else {
      campusStore.addEvent(eventPayload);
      setSelectedElement({ type: "event", id: evId });
      toast({
        type: "success",
        title: "Event Created",
        description: `Created campus event "${title}".`,
      });
    }
    setIsAddEventOpen(false);
  };

  // Scroll-Wheel & Touchpad Zoom (Instant, Smooth & Cursor-Anchored with RAF Batching)
  const zoomRafRef = useRef<number | null>(null);
  const touchStateRef = useRef<{
    initialDist: number;
    initialZoom: number;
    lastCenter: { x: number; y: number };
  }>({
    initialDist: 0,
    initialZoom: 1,
    lastCenter: { x: 0, y: 0 },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const zoomMultiplier = computeDesktopWheelMultiplier(e.deltaY, e.ctrlKey, e.deltaMode);

      const currentZoom = zoomRef.current || 1;
      const currentPan = panOffsetRef.current;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Exact world coordinates under cursor before zoom
      const worldX = (mouseX - currentPan.x) / currentZoom;
      const worldY = (mouseY - currentPan.y) / currentZoom;

      const nextZoom = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, currentZoom * zoomMultiplier));
      if (Math.abs(nextZoom - currentZoom) < 0.00001) return;

      // Exact new pan to keep worldX, worldY precisely pinned to mouseX, mouseY (zero shake)
      const newPanX = mouseX - worldX * nextZoom;
      const newPanY = mouseY - worldY * nextZoom;

      zoomRef.current = nextZoom;
      panOffsetRef.current = { x: newPanX, y: newPanY };

      // High-frequency input is recorded immediately in refs.
      // Batch visual React state render to single RAF frame to prevent render backlog.
      if (zoomRafRef.current === null) {
        zoomRafRef.current = requestAnimationFrame(() => {
          zoomRafRef.current = null;
          setZoom(zoomRef.current);
          setPanOffset(panOffsetRef.current);
        });
      }
    };

    // Mobile / Touchscreen 2-finger pinch-to-zoom support for CAD Editor
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        touchStateRef.current = {
          initialDist: dist || 1,
          initialZoom: zoomRef.current || 1,
          lastCenter: center,
        };
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
        const center = {
          x: (t1.clientX + t2.clientX) / 2,
          y: (t1.clientY + t2.clientY) / 2,
        };
        const state = touchStateRef.current;
        if (!state.initialDist) return;

        const ratio = dist / state.initialDist;
        const currentZoom = zoomRef.current || 1;
        const currentPan = panOffsetRef.current;
        const nextZoom = Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, state.initialZoom * ratio));
        if (Math.abs(nextZoom - currentZoom) < 0.00001) return;

        const rect = canvas.getBoundingClientRect();
        const mouseX = center.x - rect.left;
        const mouseY = center.y - rect.top;

        const dx = center.x - state.lastCenter.x;
        const dy = center.y - state.lastCenter.y;

        const adjustedPanX = currentPan.x + dx;
        const adjustedPanY = currentPan.y + dy;

        const worldX = (mouseX - adjustedPanX) / currentZoom;
        const worldY = (mouseY - adjustedPanY) / currentZoom;

        const newPanX = mouseX - worldX * nextZoom;
        const newPanY = mouseY - worldY * nextZoom;

        state.lastCenter = center;
        zoomRef.current = nextZoom;
        panOffsetRef.current = { x: newPanX, y: newPanY };

        if (zoomRafRef.current === null) {
          zoomRafRef.current = requestAnimationFrame(() => {
            zoomRafRef.current = null;
            setZoom(zoomRef.current);
            setPanOffset(panOffsetRef.current);
          });
        }
      }
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      if (zoomRafRef.current !== null) {
        cancelAnimationFrame(zoomRafRef.current);
      }
    };
  }, []);

  // Unified Global Keyboard Shortcuts (Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+Y, Delete, Backspace, Escape)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      // Ctrl+Z Undo / Ctrl+Y Redo
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl+A Select All Nodes on Floor
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const activeNodes = storeData.nodes.filter((n) =>
          activeFloorId === "f-all" || isGroundFloorView
            ? n.floorId === "f-out" || n.floorId === activeFloorId || storeData.floors.find((f) => f.id === n.floorId)?.ordinal === 0
            : n.floorId === activeFloorId
        );
        const activeIds = activeNodes.map((n) => n.id);
        setSelectedEntityIds(new Set(activeIds));
        toast({ type: "info", title: "Selected All Floor Objects", description: `Selected ${activeIds.length} nodes.` });
        return;
      }

      // Ctrl+C Copy
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const idsToCopy = Array.from(selectedEntityIds);
        if (selectedElement && !idsToCopy.includes(selectedElement.id)) {
          idsToCopy.push(selectedElement.id);
        }
        if (idsToCopy.length > 0) {
          campusStore.copySelectedEntities(idsToCopy);
          toast({ type: "info", title: "Copied Elements", description: `Copied ${idsToCopy.length} objects to clipboard.` });
        }
        return;
      }

      // Ctrl+V Paste
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        const pastedIds = campusStore.pasteEntities(activeFloorId, { x: 40, y: 40 });
        if (pastedIds.length > 0) {
          setSelectedEntityIds(new Set(pastedIds));
          toast({ type: "success", title: "Pasted Elements", description: `Pasted ${pastedIds.length} objects onto floor.` });
        }
        return;
      }

      // Single-Key & Number Hotkey Tool Switching (V, D, N, E, T/R, B, O)
      const activeEl = document.activeElement;
      const isInputFocused =
        activeEl &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName);

      if (!isInputFocused && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "v") {
          setActiveTool("SELECT");
          toast({ type: "info", title: "Select Tool Activated (V)" });
          return;
        }
        if (key === "d") {
          setActiveTool("DOOR");
          toast({ type: "info", title: "Door Placement Mode (D)" });
          return;
        }
        if (key === "n") {
          setActiveTool("NODE");
          toast({ type: "info", title: "Node Placement Mode (N)" });
          return;
        }
        if (key === "e") {
          setActiveTool("EDGE");
          toast({ type: "info", title: "Edge Connection Mode (E)" });
          return;
        }

        if (key === "b") {
          setActiveTool("BUILDING");
          toast({ type: "info", title: "Building Placement Mode (B)" });
          return;
        }
        if (key === "o") {
          setActiveTool("OBSTACLE");
          toast({ type: "info", title: "Obstacle Hazard Mode (O)" });
          return;
        }
      }

      if (["1", "2", "3", "4", "5", "6", "7", "8", "9"].includes(e.key) && !e.ctrlKey && !e.metaKey) {
        const toolMap: Record<string, ToolMode> = {
          "1": "SELECT",
          "2": "BUILDING",
          "3": "FLOOR",
          "4": "NODE",
          "5": "EDGE",
          "6": "ROOM",
          "7": "DOOR",
          "8": "OBSTACLE",
        };
        const selectedTool = toolMap[e.key];
        if (selectedTool) {
          setActiveTool(selectedTool);
          toast({ type: "info", title: `Tool Mode: ${selectedTool}` });
          return;
        }
      }

      // Toggle Grid (G) / Snapping (S)
      if (e.key.toLowerCase() === "g" && !e.ctrlKey && !e.metaKey) {
        setSnapToGrid((prev) => !prev);
        toast({ type: "info", title: snapToGrid ? "Grid Snap Disabled" : "Grid Snap Enabled" });
        return;
      }

      // Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedEntityIds.size > 0) {
          e.preventDefault();
          campusStore.bulkDelete(Array.from(selectedEntityIds));
          setSelectedEntityIds(new Set());
          setSelectedElement(null);
          toast({ type: "info", title: "Deleted Selected Objects" });
        } else if (selectedElement) {
          e.preventDefault();
          if (selectedElement.type === "building") campusStore.deleteBuilding(selectedElement.id);
          else if (selectedElement.type === "floor") campusStore.deleteFloor(selectedElement.id);
          else if (selectedElement.type === "node") campusStore.deleteNode(selectedElement.id);
          else if (selectedElement.type === "edge") campusStore.deleteEdge(selectedElement.id);
          else if (selectedElement.type === "destination") campusStore.deleteDestination(selectedElement.id);
          else if (selectedElement.type === "event") campusStore.deleteEvent(selectedElement.id);
          else if (selectedElement.type === "obstacle") campusStore.deleteObstacle(selectedElement.id);
          else campusStore.bulkDelete([selectedElement.id]);

          setSelectedElement(null);
          toast({ type: "info", title: "Deleted Object", description: `Removed selected ${selectedElement.type}.` });
        }
        return;
      }

      // F2 Rename Shortcut
      if (e.key === "F2" && selectedElement) {
        e.preventDefault();
        let currentName = "";
        let currentShortCode = "";

        const { type, id } = selectedElement;
        if (type === "building") {
          const b = storeData.buildings.find((x) => x.id === id);
          currentName = b?.name || "";
          currentShortCode = b?.shortCode || "";
        } else if (type === "node") {
          const n = storeData.nodes.find((x) => x.id === id);
          currentName = n?.name || "";
        } else if (type === "destination") {
          const d = storeData.destinations.find((x) => x.id === id);
          currentName = d?.name || "";
        } else if (type === "door") {
          const d = storeData.doors.find((x) => x.id === id);
          currentName = d?.name || "";
        } else if (type === "obstacle") {
          const o = storeData.obstacles.find((x) => x.id === id);
          currentName = o?.reason || "";
        } else if (type === "event") {
          const ev = storeData.events.find((x) => x.id === id);
          currentName = ev?.title || "";
        } else if (type === "stairGroup") {
          const sg = storeData.stairGroups?.find((x) => x.id === id);
          currentName = sg?.name || "";
        } else if (type === "liftGroup") {
          const lg = storeData.liftGroups?.find((x) => x.id === id);
          currentName = lg?.name || "";
        }

        setRenameInputValue(currentName);
        setRenameShortCodeValue(currentShortCode);
        setIsRenameModalOpen(true);
        return;
      }

      // Escape Clear Selection / Close Modals
      if (e.key === "Escape") {
        setSelectedEntityIds(new Set());
        setSelectedElement(null);
        setIsDrawingRoom(false);
        setShowPublishModal(false);
        setShowDiagnosticsPanel(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedEntityIds, selectedElement, activeFloorId, toast, storeData]);

  // Auto-Save Effect
  useEffect(() => {
    const interval = setInterval(() => {
      setAutoSaveStatus("Auto-Saved");
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeTool === "EVENT") {
      setIsAddEventOpen(true);
    }
  }, [activeTool]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    const target = document.documentElement;
    const isCurrentlyFS = !!(
      document.fullscreenElement ||
      (document as any).webkitFullscreenElement ||
      (document as any).mozFullScreenElement ||
      (document as any).msFullscreenElement
    );
    const nextState = !isCurrentlyFS;

    if (nextState) {
      if (target.requestFullscreen) {
        target.requestFullscreen().catch(() => { });
      } else if ((target as any).webkitRequestFullscreen) {
        (target as any).webkitRequestFullscreen();
      } else if ((target as any).msRequestFullscreen) {
        (target as any).msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen && document.fullscreenElement) {
        document.exitFullscreen().catch(() => { });
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    }
  };

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await campusStore.syncWithServer();
    } catch (e) {
      console.warn("Soft refresh database sync notice:", e);
    } finally {
      setStoreData(campusStore.getWorkingData());
      setSelectedElement(null);
      toast({
        type: "success",
        title: "CAD Canvas Refreshed",
        description: "Editor graph & campus data re-synchronized from database.",
      });
      setTimeout(() => setIsRefreshing(false), 400);
    }
  };

  useEffect(() => {
    const handleFSChange = () => {
      const isNativeFS = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
      setIsFullscreen(isNativeFS);
      if (typeof window !== "undefined") {
        sessionStorage.setItem("cad_editor_fullscreen_active", String(isNativeFS));
      }
    };

    handleFSChange();

    document.addEventListener("fullscreenchange", handleFSChange);
    document.addEventListener("webkitfullscreenchange", handleFSChange);
    document.addEventListener("mozfullscreenchange", handleFSChange);
    document.addEventListener("MSFullscreenChange", handleFSChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFSChange);
      document.removeEventListener("webkitfullscreenchange", handleFSChange);
      document.removeEventListener("mozfullscreenchange", handleFSChange);
      document.removeEventListener("MSFullscreenChange", handleFSChange);
    };
  }, []);

  // Periodic 5-second ticker to update real-time clock state for automatic event expiration
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Auto-deselect completed events when end time passes
  useEffect(() => {
    if (selectedElement?.type === "event") {
      const ev = storeData.events.find((e) => e.id === selectedElement.id);
      if (!ev || getEventStatus(ev, nowMs) === "COMPLETED") {
        setSelectedElement(null);
      }
    }
  }, [nowMs, selectedElement, storeData.events]);

  // Subscribe to CampusStore updates
  useEffect(() => {
    const unsubscribe = campusStore.subscribe(() => {
      setStoreData(campusStore.getWorkingData());
      setPendingChanges([...campusStore.getPendingChanges()]);
    });
    return () => unsubscribe();
  }, []);

  const handleUndo = () => {
    const res = campusStore.undo();
    if (res.success) {
      setStoreData(campusStore.getWorkingData());
      setPendingChanges([...campusStore.getPendingChanges()]);
      toast({
        type: "info",
        title: "Undid Action",
        description: res.description ? `Undid: ${res.description}` : "Reverted previous edit step.",
      });
    } else {
      toast({
        type: "info",
        title: "Nothing to Undo",
        description: "Undo history stack is empty.",
      });
    }
  };

  const handleRedo = () => {
    const res = campusStore.redo();
    if (res.success) {
      setStoreData(campusStore.getWorkingData());
      setPendingChanges([...campusStore.getPendingChanges()]);
      toast({
        type: "info",
        title: "Redid Action",
        description: res.description ? `Redid: ${res.description}` : "Restored reverted edit step.",
      });
    } else {
      toast({
        type: "info",
        title: "Nothing to Redo",
        description: "Redo stack is empty.",
      });
    }
  };

  const handleDeleteAll = () => {
    setIsDeleteAllModalOpen(true);
  };

  const confirmDeleteAll = () => {
    setSelectedElement(null);
    setSelectedEntityIds(new Set());
    setSimResult(null);

    setEdgeStartNodeId(null);
    campusStore.clearAll();
    setIsDeleteAllModalOpen(false);
    toast({
      type: "info",
      title: "All Elements Deleted",
      description: "Cleared all campus graph data.",
    });
  };



  // Compute live Graph Validation Report
  const validationReport: GraphValidationReport = useMemo(() => {
    return validateCampusGraph(
      storeData.buildings,
      storeData.floors,
      storeData.nodes,
      storeData.edges,
      storeData.destinations,
      storeData.obstacles
    );
  }, [storeData]);

  const connectedNodeIdsToActiveFloor = useMemo(() => {
    if (!activeFloorId || activeFloorId.startsWith("f-all")) return new Set<string>();
    const activeNodes = new Set(
      storeData.nodes.filter((n) => n.floorId === activeFloorId).map((n) => n.id)
    );
    const connected = new Set<string>();
    storeData.edges.forEach((e) => {
      const fromN = storeData.nodes.find((n) => n.id === e.from);
      const toN = storeData.nodes.find((n) => n.id === e.to);
      if (!fromN || !toN) return;

      // Only allow vertical stair/lift connections across floors to active floor view
      const isVertical =
        e.type === "STAIRS" ||
        e.type === "LIFT" ||
        Boolean(fromN.stairGroupId) ||
        Boolean(toN.stairGroupId) ||
        Boolean(fromN.liftGroupId) ||
        Boolean(toN.liftGroupId);

      if (isVertical) {
        if (activeNodes.has(e.from)) connected.add(e.to);
        if (activeNodes.has(e.to)) connected.add(e.from);
      }
    });
    return connected;
  }, [storeData.nodes, storeData.edges, activeFloorId]);

  // Set of stair/lift group IDs that have a node on the active floor
  const activeFloorStairGroupIds = useMemo(() => {
    const ids = new Set<string>();
    storeData.nodes.forEach((n) => {
      if (n.floorId === activeFloorId) {
        if (n.stairGroupId) ids.add(n.stairGroupId);
        if (n.liftGroupId) ids.add(n.liftGroupId);
      }
    });
    return ids;
  }, [storeData.nodes, activeFloorId]);

  // Current floor nodes, edges, and obstacles filtering (combines Outdoor Campus & Ground Floor)
  const activeFloorObj = useMemo(
    () => storeData.floors.find((f) => f.id === activeFloorId),
    [storeData.floors, activeFloorId]
  );
  const isGroundFloorView =
    activeFloorId === "f-out" ||
    activeFloorId === "f-all-g" ||
    activeFloorObj?.ordinal === 0;

  // Helper to reliably check if a node or target floor belongs to the ground floor level
  const isGroundFloorEntity = (floorId?: string) => {
    if (!floorId || floorId === "f-out" || floorId === "outdoor") return true;
    if (floorId.includes("gnd") || floorId.includes("-g") || floorId.includes("-0") || floorId.includes("ground")) return true;
    const fl = storeData.floors.find((f) => f.id === floorId);
    return fl ? fl.ordinal === 0 : true; // Default to true if floor record is missing so nodes never disappear
  };

  // Truly Outdoor nodes (campus walkways, roads, building entrances, outdoor corner nodes)
  const isOutdoorNode = (n: any) => {
    if (!n) return false;
    if (n.floorId === "f-out" || n.floorId === "outdoor" || !n.floorId) return true;
    if (
      n.type === "OUTDOOR" ||
      n.type === "OUTDOOR_PATH" ||
      n.type === "BUILDING_ENTRANCE" ||
      n.type === "ENTRANCE" ||
      n.type === "GATE" ||
      n.type === "ROAD_JUNCTION" ||
      n.isEntranceNode ||
      Boolean(n.outdoorNodeId) ||
      (n.name && /entrance|gate/i.test(n.name))
    ) {
      return true;
    }
    // Any node physically located outside all building rectangles is an outdoor campus node
    return isPointOutsideAllBuildings(n.x, n.y, storeData.buildings);
  };

  const isOutdoorEdge = (fromN: any, toN: any) => {
    if (!fromN || !toN) return false;
    return isOutdoorNode(fromN) || isOutdoorNode(toN);
  };

  const floorNodes = storeData.nodes.filter((n) => {
    // Keep currently dragged or selected node always visible on canvas
    if (draggingId?.id === n.id || selectedElement?.id === n.id) return true;

    // 1. Nodes belonging to current active floor (e.g. Basement f-sf-b1)
    if (n.floorId === activeFloorId) return true;

    // 2. Outdoor Campus nodes & border entrances show for ALL floor views
    if (isOutdoorNode(n)) return true;

    // 3. Ground floor INDOOR & STAIR nodes show when viewing Ground Floor view!
    if (isGroundFloorView) {
      if (isGroundFloorEntity(n.floorId)) return true;
    }

    if (activeFloorId === "f-all-1") {
      const fl = storeData.floors.find((f) => f.id === n.floorId);
      return fl?.ordinal === 1 || n.floorId.includes("-1");
    }
    if (activeFloorId === "f-all") return true;
    return false;
  });

  const floorEdges = storeData.edges.filter((e) => {
    const fromN = storeData.nodes.find((n) => n.id === e.from);
    const toN = storeData.nodes.find((n) => n.id === e.to);
    if (!fromN || !toN) return false;

    const fromOutdoor = isOutdoorNode(fromN);
    const toOutdoor = isOutdoorNode(toN);

    // Hide inter-floor indoor vertical edges in 2D single-floor view
    if (activeFloorId !== "f-all" && fromN.floorId !== toN.floorId) {
      if (!fromOutdoor && !toOutdoor) {
        return false;
      }
    }

    // Edge connected to active floor
    if (fromN.floorId === activeFloorId || toN.floorId === activeFloorId) {
      return true;
    }

    // Outdoor edges (both endpoints outside or border entrances) show for ALL floor views (including Basement)
    if (fromOutdoor && toOutdoor) {
      return true;
    }

    // Ground floor indoor edges show ONLY when viewing Ground Floor
    if (isGroundFloorView) {
      if (isGroundFloorEntity(fromN.floorId) || isGroundFloorEntity(toN.floorId)) {
        return true;
      }
    }

    if (activeFloorId === "f-all-1") {
      const fl1 = storeData.floors.find((f) => f.id === fromN.floorId);
      const fl2 = storeData.floors.find((f) => f.id === toN.floorId);
      return fl1?.ordinal === 1 || fl2?.ordinal === 1 || fromN.floorId.includes("-1") || toN.floorId.includes("-1");
    }
    if (activeFloorId === "f-all") return true;
    return false;
  });

  const floorDestinations = storeData.destinations.filter((d) => {
    // Keep currently dragged or selected destination or destination for dragged node always visible
    if (
      draggingId?.id === d.id ||
      selectedElement?.id === d.id ||
      (d.nodeId && (draggingId?.id === d.nodeId || selectedElement?.id === d.nodeId))
    ) {
      return true;
    }

    const node = storeData.nodes.find((n) => n.id === d.nodeId);
    const targetFloorId = d.floorId || node?.floorId;
    if (targetFloorId === activeFloorId) return true;

    // Outdoor destinations & Entrances show for all floors
    if (
      targetFloorId === "f-out" ||
      targetFloorId === "outdoor" ||
      !targetFloorId ||
      (node && isOutdoorNode(node)) ||
      (d.name && /entrance|gate/i.test(d.name))
    ) {
      if (!isGroundFloorView && targetFloorId && targetFloorId !== "f-out" && !isGroundFloorEntity(targetFloorId)) {
        return false;
      }
      return true;
    }

    if (isGroundFloorView) {
      return isGroundFloorEntity(targetFloorId);
    }

    if (activeFloorId === "f-all-1") {
      const fl = storeData.floors.find((f) => f.id === targetFloorId);
      return fl?.ordinal === 1 || (targetFloorId ? targetFloorId.includes("-1") : false);
    }
    if (activeFloorId === "f-all") return true;
    return false;
  });

  // Node IDs that already have a room/destination chip rendered — suppress their inline text label
  const roomLinkedNodeIds = new Set(floorDestinations.map((d) => d.nodeId).filter(Boolean));

  const floorObstacles = storeData.obstacles.filter((obs) => {
    // 1. If obstacle explicitly blocks a route/edge present on the active floor canvas, include it
    if (obs.edgeIds && obs.edgeIds.some((eId) => floorEdges.some((fe) => fe.id === eId || fe.id === eId.replace(/_rev$/, "")))) {
      return true;
    }
    const obsFloor = obs.floorId ?? "f-out";
    if (visibleLayers.outdoor && obsFloor === "f-out") return true;
    if (isGroundFloorView) {
      const fl = storeData.floors.find((f) => f.id === obsFloor);
      return (
        obsFloor === "f-out" ||
        obsFloor === activeFloorId ||
        obsFloor.includes("gnd") ||
        fl?.ordinal === 0
      );
    }
    if (activeFloorId === "f-all-1") {
      const fl = storeData.floors.find((f) => f.id === obsFloor);
      return fl?.ordinal === 1;
    }
    if (activeFloorId === "f-all") return obsFloor !== "f-out";

    if (obsFloor === activeFloorId) return true;
    const obsFl = storeData.floors.find((f) => f.id === obsFloor);
    const actFl = storeData.floors.find((f) => f.id === activeFloorId);
    return Boolean(obsFl && actFl && obsFl.ordinal === actFl.ordinal && obsFl.buildingId === actFl.buildingId);
  });
  // Pan Canvas to specific coordinate
  const zoomToPos = (x: number, y: number, floorId?: string) => {
    if (floorId) setActiveFloorId(floorId);
    zoomRef.current = 1.4;
    panOffsetRef.current = { x: 400 - x * 1.4, y: 300 - y * 1.4 };
    setZoom(1.4);
    setPanOffset(panOffsetRef.current);
  };

  // Run Route Simulation
  const handleRunSimulation = () => {
    if (!simStartNodeId || !simEndNodeId) {
      toast({ type: "error", title: "Select Route Points", description: "Please select both Start and Destination nodes." });
      return;
    }
    const { graph, nodeMap } = buildAdjacencyGraph(storeData.nodes, storeData.edges, { obstacles: storeData.obstacles, allowObstaclePenalties: true, travelMode: simTravelMode });
    const path = findShortestPath(graph, nodeMap, simStartNodeId, simEndNodeId);

    const { graph: altGraph, nodeMap: altMap } = buildAdjacencyGraph(storeData.nodes, storeData.edges, { obstacles: storeData.obstacles, allowObstaclePenalties: false, travelMode: simTravelMode });
    const altPath = findShortestPath(altGraph, altMap, simStartNodeId, simEndNodeId);

    if (path) {
      setSimResult(path);
      setAltSimResult(altPath);
      toast({
        type: "success",
        title: "Route Simulated",
        description: `Found ${path.totalDistance}m path (${simTravelMode === "EV" ? "EV Mode" : "Walking"})${altPath ? ` | Alt: ${altPath.totalDistance}m` : ""}.`,
      });
    } else {
      setSimResult(null);
      setAltSimResult(null);
      toast({
        type: "error",
        title: "No Path Found",
        description: simTravelMode === "EV" ? "No EV-accessible path connects these nodes (requires EV Path edges)." : "Dijkstra routing engine could not connect the selected nodes.",
      });
    }
  };

  // Canvas Mouse Handlers for Pan & Direct Element Dragging
  const handleCanvasMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    hasDraggedRef.current = false;
    mouseDownScreenPosRef.current = { x: e.clientX, y: e.clientY };
    mouseDownCanvasPosRef.current = getCanvasCoords(e);

    // Pan initiation via Middle click (1), Right click (2), Shift + click, or Left click in SELECT tool
    if (e.button === 1 || e.button === 2 || e.shiftKey) {
      e.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffsetRef.current.x, y: e.clientY - panOffsetRef.current.y });
      return;
    }

    const target = e.target as HTMLElement;
    const isBackground =
      (target as unknown) === canvasRef.current ||
      target.tagName.toLowerCase() === "svg" ||
      target.getAttribute("fill")?.includes("cad-grid") ||
      target.id === "cad-grid-rect";

    // Only allow left-click background panning when in SELECT mode.
    // In placement tools (NODE, BUILDING, OBSTACLE, ROOM, DOOR, etc.), left-click is strictly dedicated to object creation.
    if (isBackground && e.button === 0 && activeTool === "SELECT") {
      setIsPanning(true);
      setPanStart({ x: e.clientX - panOffsetRef.current.x, y: e.clientY - panOffsetRef.current.y });
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const moveDist = Math.hypot(
      e.clientX - mouseDownScreenPosRef.current.x,
      e.clientY - mouseDownScreenPosRef.current.y
    );
    if (moveDist > 4) {
      hasDraggedRef.current = true;
    }

    if (isPanning) {
      if (hasDraggedRef.current) {
        nextPanRef.current = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
        panOffsetRef.current = nextPanRef.current;
        if (panRafRef.current === null) {
          panRafRef.current = requestAnimationFrame(() => {
            panRafRef.current = null;
            setPanOffset(nextPanRef.current);
          });
        }
      }
      return;
    }

    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const curPan = panOffsetRef.current;
    const curZoom = zoomRef.current || 1;
    let x = Math.round((e.clientX - rect.left - curPan.x) / curZoom);
    let y = Math.round((e.clientY - rect.top - curPan.y) / curZoom);
    if (snapToGrid) {
      x = Math.round(x / 20) * 20;
      y = Math.round(y / 20) * 20;
    }
    mouseCanvasPosRef.current = { x, y };

    // Handle Direct Element Dragging with 60/120fps RAF Throttle
    if (draggingId) {
      let targetX = x - dragOffset.x;
      let targetY = y - dragOffset.y;
      if (snapToGrid) {
        targetX = Math.round(targetX / 20) * 20;
        targetY = Math.round(targetY / 20) * 20;
      }
      dragTargetPosRef.current = { x: targetX, y: targetY };

      if (dragRafRef.current === null) {
        dragRafRef.current = requestAnimationFrame(() => {
          dragRafRef.current = null;
          const pos = dragTargetPosRef.current;
          if (!pos || !draggingId) return;

          if (draggingId.type === "node") {
            campusStore.updateNode(draggingId.id, { x: pos.x, y: pos.y }, false);
          } else if (draggingId.type === "building") {
            campusStore.updateBuilding(draggingId.id, { x: pos.x, y: pos.y }, false);
          } else if (draggingId.type === "obstacle") {
            campusStore.updateObstacle(draggingId.id, { x: pos.x, y: pos.y }, false);
          } else if (draggingId.type === "event") {
            campusStore.updateEvent(draggingId.id, { x: pos.x, y: pos.y });
          } else if (draggingId.type === "door") {
            campusStore.updateDoor(draggingId.id, { x: pos.x, y: pos.y }, false);
          }
        });
      }
    }
  };

  const handleCanvasMouseUp = () => {
    if (isPanning) {
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
        panRafRef.current = null;
      }
      setPanOffset(nextPanRef.current);
      setIsPanning(false);
    }

    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }

    if (draggingId) {
      // Finalize position without recording duplicate undo history (onMouseDown already recorded the before-drag state)
      const liveData = campusStore.getWorkingData();
      if (draggingId.type === "node") {
        const n = liveData.nodes.find((item) => item.id === draggingId.id);
        if (n) {
          const { lat, lng } = canvasToGps(n.x, n.y);
          campusStore.updateNode(n.id, { x: n.x, y: n.y, lat, lng }, false);
        }
      } else if (draggingId.type === "building") {
        const b = liveData.buildings.find((item) => item.id === draggingId.id);
        if (b) {
          campusStore.updateBuilding(b.id, { x: b.x, y: b.y }, false);
        }
      } else if (draggingId.type === "obstacle") {
        const obs = liveData.obstacles.find((item) => item.id === draggingId.id);
        if (obs) campusStore.updateObstacle(obs.id, { x: obs.x, y: obs.y }, false);
      } else if (draggingId.type === "door") {
        const door = liveData.doors?.find((item) => item.id === draggingId.id);
        if (door) campusStore.updateDoor(door.id, { x: door.x, y: door.y }, false);
      }
      dragTargetPosRef.current = null;
      setDraggingId(null);
    }
  };

  const createBuildingAtPos = (x: number, y: number) => {
    const name = buildingName.trim() || `Building ${storeData.buildings.length + 1}`;
    const code = buildingCode.trim().toUpperCase() || `B${storeData.buildings.length + 1}`;
    const newBldId = generateShortId("b", storeData.buildings.map((b) => b.id));
    const W = 180, H = 120;
    // Canonical Convention: (x, y) is the CANVAS CENTER
    const { lat, lng } = canvasToGps(x, y);
    const newBuilding: Building = {
      id: newBldId,
      campusId: "c1",
      name,
      shortCode: code,
      color: buildingColor,
      x,
      y,
      lat,
      lng,
      width: W,
      height: H,
    };
    campusStore.addBuilding(newBuilding);
    setSelectedElement({ type: "building", id: newBldId });
    toast({
      type: "success",
      title: "Building Created",
      description: `Placed "${newBuilding.name}" with auto Ground Floor.`,
    });
    setBuildingName("");
    setBuildingCode("");
  };

  const handleRenameSubmit = () => {
    if (!selectedElement) return;
    const { type, id } = selectedElement;
    const cleanName = renameInputValue.trim();
    if (!cleanName) return;

    if (type === "building") {
      const patch: Partial<Building> = { name: cleanName };
      const cleanCode = renameShortCodeValue.trim().toUpperCase();
      if (cleanCode) patch.shortCode = cleanCode;
      campusStore.updateBuilding(id, patch);
    } else if (type === "node") {
      campusStore.updateNode(id, { name: cleanName });
    } else if (type === "destination") {
      campusStore.updateDestination(id, { name: cleanName });
    } else if (type === "door") {
      campusStore.updateDoor(id, { name: cleanName });
    } else if (type === "obstacle") {
      campusStore.updateObstacle(id, { reason: cleanName });
    } else if (type === "event") {
      campusStore.updateEvent(id, { title: cleanName });
    } else if (type === "stairGroup") {
      campusStore.updateStairGroup(id, { name: cleanName });
    } else if (type === "liftGroup") {
      campusStore.updateLiftGroup(id, { name: cleanName });
    } else if (type === "floor") {
      campusStore.updateFloor(id, { name: cleanName });
    }

    setIsRenameModalOpen(false);
    toast({
      type: "success",
      title: "Element Renamed",
      description: `Renamed to "${cleanName}".`,
    });
  };

  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (hasDraggedRef.current) {
      hasDraggedRef.current = false;
      return;
    }

    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    const isNodeOrEdgeTarget = tagName === "circle" || tagName === "line";

    if (isNodeOrEdgeTarget) return;

    // Use the exact coordinates captured on mouse down to prevent micro-pan displacement
    const { x, y } = mouseDownCanvasPosRef.current || getCanvasCoords(e);

    // If Fake GPS tool is active, place fake pin on click
    if (fakeGps.isActive) {
      fakeGps.setFakePosition(x, y, activeFloorId);
      return;
    }
    const effectiveFloorId =
      activeFloorId === "f-out"
        ? "f-out"
        : activeFloorId === "f-all-g"
          ? (storeData.floors.find((f) => f.ordinal === 0 || f.id.includes("gnd"))?.id || "f-out")
          : activeFloorId === "f-all-1"
            ? (storeData.floors.find((f) => f.ordinal === 1)?.id || storeData.floors[0]?.id || "f-out")
            : activeFloorId.startsWith("f-all")
              ? (storeData.floors.find((f) => f.ordinal > 0)?.id || storeData.floors[0]?.id || "f-out")
              : activeFloorId;

    if (activeTool === "NODE") {
      const newNodeId = generateShortId("n", storeData.nodes.map((n) => n.id));
      let targetFloor = nodeTargetFloorId && !nodeTargetFloorId.startsWith("f-all")
        ? nodeTargetFloorId
        : effectiveFloorId;

      if (targetFloor === "f-out") {
        const bldAtPos = storeData.buildings.find(
          (b) => x >= (b.x ?? 0) && x <= (b.x ?? 0) + (b.width ?? 180) && y >= (b.y ?? 0) && y <= (b.y ?? 0) + (b.height ?? 120)
        );
        if (bldAtPos) {
          const bGf = storeData.floors.find((f) => f.buildingId === bldAtPos.id && f.ordinal === 0) ||
            storeData.floors.find((f) => f.buildingId === bldAtPos.id);
          if (bGf) {
            targetFloor = bGf.id;
          }
        }
      }

      const newNode: Node = {
        id: newNodeId,
        type: nodeType,
        name: nodeName.trim() || undefined,
        floorId: targetFloor,
        x,
        y,
        searchable: true,
        visibleToUser: true,
      };
      campusStore.addNode(newNode, false); // Never auto-add edges when node is added
      setSelectedElement({ type: "node", id: newNodeId });
      const targetFloorObj = storeData.floors.find((f) => f.id === targetFloor);
      const targetFloorName = targetFloorObj ? targetFloorObj.name : (targetFloor === "f-out" ? "Outdoor & Ground Floor" : targetFloor);
      toast({
        type: "success",
        title: "Node Placed",
        description: `Placed ${nodeType} node on ${targetFloorName} at (${Math.round(x)}, ${Math.round(y)}).`,
      });
      setNodeName("");
    } else if (activeTool === "BUILDING") {
      createBuildingAtPos(x, y);
    } else if (activeTool === "ROOM") {
      const targetBuilding = storeData.buildings.find(
        (b) => x >= (b.x ?? 0) && x <= (b.x ?? 0) + (b.width ?? 180) && y >= (b.y ?? 0) && y <= (b.y ?? 0) + (b.height ?? 120)
      );
      const floorIdToAssign = targetBuilding
        ? (storeData.floors.find((f) => f.buildingId === targetBuilding.id && f.ordinal === 0)?.id ||
          storeData.floors.find((f) => f.buildingId === targetBuilding.id)?.id ||
          effectiveFloorId)
        : effectiveFloorId;

      const name = roomNameInput.trim() || `Room ${roomNumber}`;
      const autoNodeId = generateShortId("n", storeData.nodes.map((n) => n.id));
      const roomNode: Node = {
        id: autoNodeId,
        type: "ROOM",
        name: `${name} Entry`,
        floorId: floorIdToAssign,
        x: x + 15,
        y: y + 15,
        searchable: true,
        visibleToUser: true,
      };
      campusStore.addNode(roomNode, false);

      const newRoomId = generateShortId("d", storeData.destinations.map((d) => d.id));
      const newRoom: Destination = {
        id: newRoomId,
        nodeId: autoNodeId,
        name,
        category: roomCategory,
        roomNumber,
        aliases: [roomNumber],
        x,
        y,
        width: 80,
        height: 60,
        floorId: floorIdToAssign,
      };
      campusStore.addDestination(newRoom);
      campusStore.generateGraphSuggestions(floorIdToAssign);
      setSelectedElement({ type: "destination", id: newRoomId });
      toast({ type: "success", title: "Room Placed", description: `Created ${roomCategory} "${name}" (#${roomNumber}).` });
    } else if (activeTool === "DOOR") {
      const doorId = generateShortId("door", storeData.doors.map((d) => d.id));
      const targetBuilding = storeData.buildings.find(
        (b) => x >= (b.x ?? 0) && x <= (b.x ?? 0) + (b.width ?? 180) && y >= (b.y ?? 0) && y <= (b.y ?? 0) + (b.height ?? 120)
      );
      const floorIdToAssign = targetBuilding
        ? (storeData.floors.find((f) => f.buildingId === targetBuilding.id && f.ordinal === 0)?.id ||
          storeData.floors.find((f) => f.buildingId === targetBuilding.id)?.id ||
          effectiveFloorId)
        : effectiveFloorId;

      campusStore.addDoor({
        id: doorId,
        floorId: floorIdToAssign,
        type: doorType,
        name: `${doorType === "BUILDING_ENTRANCE" ? "Main Entrance" : "Door"}`,
        x,
        y,
      });
      setSelectedElement({ type: "door", id: doorId });
      toast({ type: "success", title: "Door Placed", description: `Placed ${doorType} at (${x}, ${y}).` });
    } else if (activeTool === "DESTINATION") {
      const name = destName.trim() || `Room ${storeData.destinations.length + 1}`;
      const closestItem = floorNodes.reduce(
        (closest, n) => {
          const d = Math.hypot(n.x - x, n.y - y);
          return d < closest.dist ? { node: n, dist: d } : closest;
        },
        { node: null as Node | null, dist: Infinity }
      );

      let nearestNode: Node;
      if (!closestItem.node || closestItem.dist > 60) {
        const autoNodeId = generateShortId("n", storeData.nodes.map((n) => n.id));
        const autoNode: Node = {
          id: autoNodeId,
          type: "ROOM",
          name: name,
          floorId: effectiveFloorId,
          x,
          y,
          searchable: true,
        };
        campusStore.addNode(autoNode, false);
        nearestNode = autoNode;
      } else {
        nearestNode = closestItem.node;
        campusStore.updateNode(nearestNode.id, { name: name }, false);
      }

      const newDestId = generateShortId("d", storeData.destinations.map((d) => d.id));
      const newDest: Destination = {
        id: newDestId,
        nodeId: nearestNode.id,
        name,
        category: destCategory,
        aliases: destAliases.split(",").map((s) => s.trim()).filter(Boolean),
      };
      campusStore.addDestination(newDest);
      setSelectedElement({ type: "destination", id: newDestId });
      toast({
        type: "success",
        title: "Room Placed",
        description: `Created "${newDest.name}" linked to node at (${nearestNode.x}, ${nearestNode.y}).`,
      });
      setDestName("");
      setDestAliases("");
    } else if (activeTool === "OBSTACLE") {
      let obsX = x;
      let obsY = y;
      let targetNodeId: string | undefined = undefined;
      let targetEdgeId: string | undefined = undefined;

      const closestEdge = floorEdges.find((e) => {
        const fn = floorNodes.find((n) => n.id === e.from);
        const tn = floorNodes.find((n) => n.id === e.to);
        if (!fn || !tn) return false;
        const l2 = (tn.x - fn.x) ** 2 + (tn.y - fn.y) ** 2;
        if (l2 === 0) return Math.hypot(x - fn.x, y - fn.y) <= 30;
        let t = ((x - fn.x) * (tn.x - fn.x) + (y - fn.y) * (tn.y - fn.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        const projX = fn.x + t * (tn.x - fn.x);
        const projY = fn.y + t * (tn.y - fn.y);
        return Math.hypot(x - projX, y - projY) <= 30;
      });

      if (closestEdge) {
        targetEdgeId = closestEdge.id;
        const fn = floorNodes.find((n) => n.id === closestEdge.from)!;
        const tn = floorNodes.find((n) => n.id === closestEdge.to)!;
        const l2 = (tn.x - fn.x) ** 2 + (tn.y - fn.y) ** 2;
        let t = ((x - fn.x) * (tn.x - fn.x) + (y - fn.y) * (tn.y - fn.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        obsX = Math.round(fn.x + t * (tn.x - fn.x));
        obsY = Math.round(fn.y + t * (tn.y - fn.y));
      } else {
        const closestNode = floorNodes.find((n) => Math.hypot(n.x - x, n.y - y) <= 35);
        if (closestNode) {
          obsX = closestNode.x;
          obsY = closestNode.y;
          targetNodeId = closestNode.id;
        }
      }

      // Default to Route-Only mode by assigning target edge or first available edge
      const obsId = generateShortId("obs", storeData.obstacles.map((o) => o.id));
      const defaultBlockedEdgeId =
        targetEdgeId ||
        floorEdges[0]?.id ||
        storeData.edges[0]?.id ||
        `e-blocked-${obsId}`;

      const newObs: Obstacle = {
        id: obsId,
        campusId: "c1",
        floorId: activeFloorId === "f-out" ? "f-out" : (effectiveFloorId ?? "f-out"),
        x: obsX,
        y: obsY,
        radius: obstacleRadius,
        edgeIds: [defaultBlockedEdgeId],
        reason: obstacleReason.trim() || "Hazard / Obstacle",
        expiresAt: obstacleExpiresAt || null,
        severity: "HIGH",
      };
      campusStore.addObstacle(newObs);
      setSelectedElement({ type: "obstacle", id: obsId });
      toast({
        type: "warning",
        title: "Obstacle Placed (Route-Only)",
        description: `Created hazard obstacle blocking edge "${defaultBlockedEdgeId}" at (${obsX}, ${obsY}).`,
      });
    } else if (activeTool === "EVENT") {
      const clickedBuilding = storeData.buildings.find(
        (b) =>
          x >= (b.x ?? 0) &&
          x <= (b.x ?? 0) + (b.width ?? 180) &&
          y >= (b.y ?? 0) &&
          y <= (b.y ?? 0) + (b.height ?? 120)
      );
      if (clickedBuilding) {
        setEventBuildingId(clickedBuilding.id);
      }
      setIsAddEventOpen(true);
    } else if (activeTool === "PLACE_VERTICAL") {
      if (pendingVerticalConnection) {
        const { type, name, buildingId, selectedFloorIds } = pendingVerticalConnection;
        if (type === "STAIR") {
          campusStore.createStairGroup(buildingId, name, selectedFloorIds, { x, y });
          toast({
            type: "success",
            title: "Stair Group Placed",
            description: `Placed staircase "${name}" at (${Math.round(x)}, ${Math.round(y)}).`,
          });
        } else {
          campusStore.createLiftGroup(buildingId, name, selectedFloorIds, { x, y });
          toast({
            type: "success",
            title: "Lift Group Placed",
            description: `Placed elevator "${name}" at (${Math.round(x)}, ${Math.round(y)}).`,
          });
        }
        if (selectedFloorIds.length > 0 && !selectedFloorIds.includes(activeFloorId) && activeFloorId !== "f-out") {
          setActiveFloorId(selectedFloorIds[0]);
        }
      }
      setPendingVerticalConnection(null);
      setActiveTool("SELECT");
    }
  };

  const handleNodeClick = (node: Node, e: React.MouseEvent) => {
    e.stopPropagation();


    if (activeTool === "SIMULATE") {
      if (!simStartNodeId || (simStartNodeId && simEndNodeId)) {
        setSimStartNodeId(node.id);
        setSimEndNodeId("");
        setSimResult(null);
        toast({ type: "info", title: "Start Node Selected", description: `Start: ${node.name ?? node.id}` });
      } else if (simStartNodeId === node.id) {
        setSimStartNodeId("");
      } else {
        setSimEndNodeId(node.id);
        const { graph, nodeMap } = buildAdjacencyGraph(storeData.nodes, storeData.edges);
        const path = findShortestPath(graph, nodeMap, simStartNodeId, node.id);
        setSimResult(path);
        if (path) {
          toast({ type: "success", title: "Route Calculated", description: `Distance: ${Math.round(path.totalDistance)}m via ${path.nodes.length} nodes.` });
        }
      }
      return;
    }

    if (activeTool === "EDGE") {
      if (edgeStartDoorId) {
        campusStore.updateDoor(edgeStartDoorId, { connectedNodeId: node.id });
        toast({ type: "success", title: "Door Connected", description: `Linked door to node ${node.name ?? node.id}.` });
        setEdgeStartDoorId(null);
        return;
      }
      if (!edgeStartNodeId) {
        setEdgeStartNodeId(node.id);
        toast({
          type: "info",
          title: "Edge Connection Started",
          description: `First node (${node.name ?? node.id}) selected. Click second node or door to create connection.`,
        });
      } else if (edgeStartNodeId === node.id) {
        setEdgeStartNodeId(null);
      } else {
        const startN = storeData.nodes.find((n) => n.id === edgeStartNodeId);
        const sGps = startN ? (startN.lat && startN.lng ? { lat: startN.lat, lng: startN.lng } : canvasToGps(startN.x, startN.y)) : canvasToGps(0, 0);
        const nGps = node.lat && node.lng ? { lat: node.lat, lng: node.lng } : canvasToGps(node.x, node.y);
        const dist = calculateGeographicDistance(sGps.lat, sGps.lng, nGps.lat, nGps.lng);
        const roundedDist = Math.max(1, Math.round(dist > 0 ? dist : 15));

        setPendingEdgeModal({
          startNodeId: edgeStartNodeId,
          endNodeId: node.id,
          dist: roundedDist,
        });
        setEdgeModalPathType(""); // Required to be selected
        setEdgeModalType(edgeType);
        setEdgeStartNodeId(null);
      }
    } else {
      setSelectedElement({ type: "node", id: node.id });
    }
  };



  useEffect(() => {
    if (selectedElement?.type === "building") {
      const bld = storeData.buildings.find((b) => b.id === selectedElement.id);
      if (bld) {
        const bldFloors = storeData.floors.filter((f) => f.buildingId === bld.id);
        const curFloor = storeData.floors.find((f) => f.id === activeFloorId);
        if (!curFloor || curFloor.buildingId !== bld.id) {
          const gndFloor = bldFloors.find((f) => f.ordinal === 0) || bldFloors[0];
          if (gndFloor) {
            setActiveFloorId(gndFloor.id);
          }
        }
      }
    }
  }, [selectedElement, storeData.buildings, storeData.floors, activeFloorId]);

  const activeBuildingForSelector = useMemo(() => {
    if (selectedElement?.type === "building") {
      const b = storeData.buildings.find((b) => b.id === selectedElement.id);
      if (b) return b;
    }
    if (selectedElement?.type === "node") {
      const node = storeData.nodes.find((n) => n.id === selectedElement.id);
      if (node?.floorId) {
        const fl = storeData.floors.find((f) => f.id === node.floorId);
        if (fl) {
          const b = storeData.buildings.find((b) => b.id === fl.buildingId);
          if (b) return b;
        }
      }
    }
    if (activeFloorId !== "f-out") {
      const fl = storeData.floors.find((f) => f.id === activeFloorId);
      if (fl) {
        const b = storeData.buildings.find((b) => b.id === fl.buildingId);
        if (b) return b;
      }
    }
    return storeData.buildings[0];
  }, [activeFloorId, selectedElement, storeData.floors, storeData.buildings, storeData.nodes]);

  const buildingFloorsForSelector = useMemo(() => {
    if (!activeBuildingForSelector) return [];
    return storeData.floors
      .filter((f) => f.buildingId === activeBuildingForSelector.id)
      .sort((a, b) => b.ordinal - a.ordinal);
  }, [activeBuildingForSelector, storeData.floors]);

  const selectedNode = selectedElement?.type === "node" ? storeData.nodes.find((n) => n.id === selectedElement.id) : null;
  const selectedEdge = selectedElement?.type === "edge" ? storeData.edges.find((e) => e.id === selectedElement.id) : null;
  const selectedBuilding = selectedElement?.type === "building" ? storeData.buildings.find((b) => b.id === selectedElement.id) : null;
  const selectedDest = selectedElement?.type === "destination" ? storeData.destinations.find((d) => d.id === selectedElement.id) : null;
  const selectedObstacle = selectedElement?.type === "obstacle" ? storeData.obstacles.find((o) => o.id === selectedElement.id) : null;
  // Dynamic Campus Centering & Auto-Fit Bounding Box
  const campusBounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];

    storeData.buildings.forEach((b) => {
      const pts = getBuildingCanvasPoints(b);
      pts.forEach((p) => {
        xs.push(p.x);
        ys.push(p.y);
      });
    });

    storeData.nodes.forEach((n) => {
      xs.push(n.x);
      ys.push(n.y);
    });

    let minX = 0;
    let minY = 0;
    let maxX = 2500;
    let maxY = 1800;

    if (xs.length > 0 && ys.length > 0) {
      minX = Math.min(...xs) - 180;
      minY = Math.min(...ys) - 180;
      maxX = Math.max(...xs) + 180;
      maxY = Math.max(...ys) + 180;
    }

    const width = Math.max(1000, maxX - minX);
    const height = Math.max(700, maxY - minY);

    return { minX, minY, width, height, centerX: minX + width / 2, centerY: minY + height / 2 };
  }, [storeData.buildings, storeData.nodes]);



  return (
    <div
      ref={containerRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-[9999] flex h-screen w-screen min-h-screen min-w-full flex-col overflow-hidden bg-[rgb(var(--bg))]"
          : "relative flex h-full min-h-[500px] max-h-[calc(100vh-4.5rem)] flex-1 flex-col overflow-hidden rounded-xl border bg-[rgb(var(--bg-elev))] shadow-[var(--shadow-md)]"
      }
    >
      {/* Top Header Toolbar - Compacted to extend Graph Map to top */}
      <div className="flex flex-nowrap items-center justify-between gap-2 border-b bg-[rgb(var(--card))]/95 px-3 py-1.5 backdrop-blur-md z-10 shrink-0 min-h-[46px] overflow-x-auto scrollbar-none">
        {/* Left Tools Group */}
        <div className="flex items-center gap-1.5 shrink-0">
          <ToolButton
            active={activeTool === "SELECT"}
            onClick={() => {
              setActiveTool("SELECT");
              toast({ type: "info", title: "Select Tool (V)", description: "Click elements to select, drag, edit properties, or delete." });
            }}
            icon={MousePointer}
            label="Select (V)"
          />
          <ToolButton
            active={activeTool === "DOOR"}
            onClick={() => {
              const next = activeTool === "DOOR" ? "SELECT" : "DOOR";
              setActiveTool(next);
              if (next === "DOOR") {
                toast({ type: "info", title: "Door Tool (D)", description: "Click building wall or corridor boundary to place entrance/door." });
              }
            }}
            icon={DoorOpen}
            label="Door Tool (D)"
          />
          <ToolButton
            active={activeTool === "NODE"}
            onClick={() => {
              const next = activeTool === "NODE" ? "SELECT" : "NODE";
              setActiveTool(next);
              if (next === "NODE") {
                toast({ type: "info", title: "Node Placement (N)", description: "Click anywhere on CAD Canvas to place a navigation node." });
              }
            }}
            icon={Waypoints}
            label="Node (N)"
          />
          <ToolButton
            active={activeTool === "EDGE"}
            onClick={() => {
              const next = activeTool === "EDGE" ? "SELECT" : "EDGE";
              setActiveTool(next);
              if (next === "EDGE") {
                toast({ type: "info", title: "Edge Connection Mode (E)", description: "Click Node 1, then click Node 2 to connect walkway edge." });
              }
            }}
            icon={GitFork}
            label="Edge (E)"
          />

          <ToolButton
            active={activeTool === "BUILDING"}
            onClick={() => {
              const next = activeTool === "BUILDING" ? "SELECT" : "BUILDING";
              setActiveTool(next);
              if (next === "BUILDING") {
                toast({ type: "info", title: "Building Placement Mode (B)", description: "Click CAD Canvas to place building footprint at cursor." });
              }
            }}
            icon={Building2}
            label="Building (B)"
          />
          <ToolButton
            active={activeTool === "OBSTACLE"}
            onClick={() => {
              const next = activeTool === "OBSTACLE" ? "SELECT" : "OBSTACLE";
              setActiveTool(next);
              if (next === "OBSTACLE") {
                toast({ type: "info", title: "Obstacle Hazard Mode (O)", description: "Click node or walkway to place routing hazard/obstacle." });
              }
            }}
            icon={AlertTriangle}
            label="Obstacle (O)"
          />
        </div>

        {/* Right Actions: Floor View Selector, Draft Status, Fullscreen & Publish */}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          {/* Floor View Selector Dropdown */}
          <select
            value={activeFloorId}
            onChange={(e) => setActiveFloorId(e.target.value)}
            className="h-8 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-2.5 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[rgb(var(--primary))] shadow-2xs cursor-pointer max-w-[200px] sm:max-w-none truncate shrink-0"
          >
            <option value="f-out">Outdoor & Ground Floor</option>
            <option value="f-all-1">All 1st Floors</option>
            <option value="f-all">All Upper Indoor Floors</option>
            <optgroup label="Specific Floors">
              {storeData.floors.map((f) => {
                const bld = storeData.buildings.find((b) => b.id === f.buildingId);
                return (
                  <option key={f.id} value={f.id}>
                    {bld?.name ? `${bld.name} - ` : ""}{f.name}
                  </option>
                );
              })}
            </optgroup>
          </select>

          {/* Draft Status Badge */}
          <div className="h-8 flex items-center gap-1.5 rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-2.5 text-xs shrink-0 select-none">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                campusStore.hasUnsavedEdits() ? "bg-amber-500 animate-pulse" : "bg-emerald-500"
              )}
            />
            <span className="font-medium text-[rgb(var(--muted-fg))] text-[11px] whitespace-nowrap">
              {campusStore.hasUnsavedEdits() ? "Unsaved Draft" : "Draft Clean"}
            </span>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowMobilePanels((prev) => !prev)}
            className="h-8 px-2.5 text-xs font-semibold md:hidden border-[rgb(var(--border))] text-[rgb(var(--fg))] rounded-lg shrink-0"
            title={showMobilePanels ? "Hide Side Panels" : "Show Side Panels"}
          >
            <Layers className="h-3.5 w-3.5 mr-1" />
            {showMobilePanels ? "Hide Panels" : "Show Panels"}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={toggleFullscreen}
            className="h-8 w-8 p-0 rounded-lg flex items-center justify-center text-xs font-medium shrink-0 border-[rgb(var(--border))] text-[rgb(var(--fg))]"
            title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="h-8 w-8 p-0 rounded-lg flex items-center justify-center text-xs font-medium shrink-0 border-[rgb(var(--border))] text-[rgb(var(--fg))]"
            title="Soft Refresh Canvas & Store (Preserves Fullscreen)"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")} />
          </Button>

          <Button
            size="sm"
            onClick={() => setShowPublishModal(true)}
            className="h-8 px-3.5 text-xs font-semibold rounded-lg bg-[rgb(var(--primary))] text-white shadow-md hover:brightness-110 shrink-0 flex items-center gap-1.5"
          >
            <Rocket className="h-3.5 w-3.5" /> Publish
          </Button>
        </div>
      </div>

      {/* Main Layout */}
      <div className="relative flex flex-1 overflow-hidden">
        {/* Requirement #3: Functional Quick Actions & Layer Hierarchy */}
        <div className={cn("w-56 border-r bg-[rgb(var(--card))]/50 p-3 overflow-y-auto space-y-3 text-xs shrink-0 backdrop-blur-xs transition-all duration-300", !showMobilePanels ? "hidden md:block" : "block")}>
          {/* Search Bar Input above Health */}
          <div className="relative flex items-center w-full">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
            <Input
              type="text"
              placeholder="Search Room #, Name, Node..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 w-full pl-8 pr-3 text-xs bg-[rgb(var(--bg))]"
            />
            {searchQuery && (
              <div className="absolute top-10 left-0 right-0 z-30 max-h-56 overflow-y-auto rounded-lg border bg-[rgb(var(--card))] p-1 shadow-xl text-xs space-y-1">
                {[
                  ...storeData.destinations
                    .filter(
                      (d) =>
                        d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (d.roomNumber && d.roomNumber.toLowerCase().includes(searchQuery.toLowerCase()))
                    )
                    .map((d) => ({
                      id: d.id,
                      type: "destination",
                      label: `⭐ ${d.name} ${d.roomNumber ? `(#${d.roomNumber})` : ""}`,
                      floorId: d.floorId,
                      x: d.x ?? 100,
                      y: d.y ?? 100,
                    })),
                  ...storeData.nodes
                    .filter((n) => n.id.toLowerCase().includes(searchQuery.toLowerCase()) || (n.name && n.name.toLowerCase().includes(searchQuery.toLowerCase())))
                    .map((n) => ({
                      id: n.id,
                      type: "node",
                      label: `${n.name ?? n.id} (${n.type})`,
                      floorId: n.floorId,
                      x: n.x,
                      y: n.y,
                    })),
                  ...storeData.buildings
                    .filter((b) => b.name.toLowerCase().includes(searchQuery.toLowerCase()) || (b.shortCode ?? "").toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((b) => ({
                      id: b.id,
                      type: "building",
                      label: `🏢 ${b.name}`,
                      floorId: "f-out",
                      x: b.x ?? 100,
                      y: b.y ?? 100,
                    })),
                ].map((res) => (
                  <div
                    key={res.id}
                    onClick={() => {
                      if (res.floorId) setActiveFloorId(res.floorId);
                      zoomToPos(res.x, res.y, res.floorId);
                      setSelectedElement({ type: res.type as any, id: res.id });
                      setSearchQuery("");
                    }}
                    className="cursor-pointer rounded px-2 py-1.5 hover:bg-[rgb(var(--muted))] flex items-center justify-between"
                  >
                    <span className="font-semibold">{res.label}</span>
                    <span className="text-[10px] text-[rgb(var(--muted-fg))]">Zoom to</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Review, Undo, Redo & Action History Controls */}
          <div className="flex items-center gap-1.5 pb-3 border-b border-[rgb(var(--border))]">
            <button
              onClick={() => setShowDiagnosticsPanel(!showDiagnosticsPanel)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold shadow-xs border transition-all ${validationReport.status === "EXCELLENT" || validationReport.status === "GOOD"
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                  : validationReport.status === "WARNINGS"
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                    : "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/20 animate-pulse"
                }`}
              title="Graph Review - Click for Diagnostics"
            >
              <Activity className="h-3.5 w-3.5" />
              <span>Review</span>
            </button>

            <Button
              size="sm"
              variant="outline"
              disabled={!campusStore.canUndo()}
              onClick={handleUndo}
              className="h-8 w-8 p-0 shrink-0 relative flex items-center justify-center"
              title={campusStore.canUndo() ? `Undo: ${campusStore.getLatestUndoDescription()} (Ctrl+Z)` : "Undo (Ctrl+Z)"}
            >
              <Undo2 className="h-3.5 w-3.5" />
              {campusStore.getUndoCount() > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-[rgb(var(--primary))] px-1 text-[9px] font-bold text-white shadow-xs">
                  {campusStore.getUndoCount()}
                </span>
              )}
            </Button>

            <Button
              size="sm"
              variant="outline"
              disabled={!campusStore.canRedo()}
              onClick={handleRedo}
              className="h-8 w-8 p-0 shrink-0 relative flex items-center justify-center"
              title={campusStore.canRedo() ? `Redo: ${campusStore.getLatestRedoDescription()} (Ctrl+Y)` : "Redo (Ctrl+Y)"}
            >
              <Redo2 className="h-3.5 w-3.5" />
              {campusStore.getRedoCount() > 0 && (
                <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white shadow-xs">
                  {campusStore.getRedoCount()}
                </span>
              )}
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowHistoryModal(true)}
              className="h-8 w-8 p-0 shrink-0 border-purple-500/30 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10"
              title="Action History Timeline & Multi-step Undo"
            >
              <History className="h-3.5 w-3.5" />
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const res = campusStore.compactAllIds();
                toast({
                  type: "success",
                  title: "IDs Cleaned & Shortened",
                  description: `Shortened ${res.stats.nodes} nodes, ${res.stats.edges} edges, ${res.stats.buildings} buildings, ${res.stats.destinations} rooms into clean unique short IDs.`,
                });
              }}
              className="h-8 w-8 p-0 shrink-0 border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
              title="Clean & Shorten All Object IDs (e.g. n-k4a2, e-7b9x, b-r3m1)"
            >
              <Hash className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div>
            <h4 className="mb-2 font-semibold text-[rgb(var(--fg))] flex items-center justify-between">
              <span>Quick Actions</span>
              <Zap className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
            </h4>
            <div className="space-y-1.5">

              {/* Fake Live Location Tool (Isolated Modular Route Tester) */}
              <CadFakeLocationButton
                fakeGps={fakeGps}
                nodes={storeData.nodes}
                destinations={storeData.destinations}
              />

              {/* Add Room tool (places room node on canvas, editable in Element Inspector) */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setActiveTool(activeTool === "DESTINATION" ? "SELECT" : "DESTINATION");
                  toast({
                    type: "info",
                    title: "Add Room Tool Active",
                    description: "Click on graph canvas to place a room node. Name can be changed in Element Inspector.",
                  });
                }}
                className={cn(
                  "w-full justify-start text-[11px] font-semibold transition-all",
                  activeTool === "DESTINATION"
                    ? "bg-[rgb(var(--primary))] text-white border-[rgb(var(--primary))]"
                    : "text-emerald-600 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 dark:text-emerald-400"
                )}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5 text-emerald-500" /> Add Room
              </Button>

              {/* Combined Stair / Lift Group Tool */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (storeData.buildings.length === 0) {
                    toast({ type: "error", title: "No Buildings", description: "Create a building first before creating vertical connections." });
                    return;
                  }
                  const firstBldId = verticalBuildingId || storeData.buildings[0].id;
                  setVerticalBuildingId(firstBldId);
                  const bFloors = storeData.floors.filter((f) => f.buildingId === firstBldId);
                  setVerticalSelectedFloorIds(bFloors.map((f) => f.id));
                  setVerticalType("STAIR");
                  setVerticalName("Main Staircase A");
                  setIsVerticalModalOpen(true);
                }}
                className="w-full justify-start text-[11px] text-indigo-600 border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 dark:text-indigo-400"
              >
                <Layers className="mr-1.5 h-3.5 w-3.5 text-indigo-500" /> Create Stair / Lift Group
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (fitToContent()) {
                    toast({ type: "info", title: "Viewport Reset", description: "Zoomed to fit all campus elements." });
                  } else {
                    panOffsetRef.current = { x: 0, y: 0 };
                    zoomRef.current = 1;
                    setPanOffset({ x: 0, y: 0 });
                    setZoom(1);
                    toast({ type: "info", title: "Viewport Reset", description: "Nothing on the canvas yet — zoom set to 100%." });
                  }
                }}
                className="w-full justify-start text-[11px]"
              >
                <Maximize2 className="mr-1.5 h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" /> Reset Viewport
              </Button>

              {/* Delete All Button - Positioned Below Reset Viewport in Quick Actions */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteAll}
                className="w-full justify-start text-[11px] text-red-500 border-red-500/30 hover:bg-red-500/10"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5 text-red-500" /> Delete All Elements
              </Button>
            </div>
          </div>

          <div>
            <h4 className="mb-2 font-semibold text-[rgb(var(--fg))] flex items-center justify-between">
              <span>Layer Hierarchy</span>
              <Layers className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
            </h4>
            <div className="space-y-1 text-[11px]">
              <button
                onClick={() => setVisibleLayers((l) => ({ ...l, buildings: !l.buildings }))}
                className="flex w-full items-center justify-between rounded px-2 py-1 bg-[rgb(var(--muted))]/40 hover:bg-[rgb(var(--muted))]"
              >
                <span className="font-medium">Buildings ({storeData.buildings.length})</span>
                {visibleLayers.buildings ? (
                  <Eye className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                )}
              </button>
              <button
                onClick={() => setVisibleLayers((l) => ({ ...l, nodes: !l.nodes }))}
                className="flex w-full items-center justify-between rounded px-2 py-1 bg-[rgb(var(--muted))]/40 hover:bg-[rgb(var(--muted))]"
              >
                <span className="font-medium">Nodes ({storeData.nodes.length})</span>
                {visibleLayers.nodes ? (
                  <Eye className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                )}
              </button>
              <button
                onClick={() => setHideNodeNames((prev) => !prev)}
                className="flex w-full items-center justify-between rounded px-2 py-1 bg-[rgb(var(--muted))]/40 hover:bg-[rgb(var(--muted))]"
              >
                <span className="font-medium">Node Names</span>
                {!hideNodeNames ? (
                  <Eye className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                )}
              </button>
              <button
                onClick={() => setVisibleLayers((l) => ({ ...l, edges: !l.edges }))}
                className="flex w-full items-center justify-between rounded px-2 py-1 bg-[rgb(var(--muted))]/40 hover:bg-[rgb(var(--muted))]"
              >
                <span className="font-medium">Edges ({storeData.edges.length})</span>
                {visibleLayers.edges ? (
                  <Eye className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                )}
              </button>
              <button
                onClick={() => setVisibleLayers((l) => ({ ...l, rooms: !l.rooms }))}
                className="flex w-full items-center justify-between rounded px-2 py-1 bg-[rgb(var(--muted))]/40 hover:bg-[rgb(var(--muted))]"
              >
                <span className="font-medium">Rooms ({storeData.destinations.length})</span>
                {visibleLayers.rooms ? (
                  <Eye className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                )}
              </button>
              <button
                onClick={() => setVisibleLayers((l) => ({ ...l, obstacles: !l.obstacles }))}
                className="flex w-full items-center justify-between rounded px-2 py-1 bg-[rgb(var(--muted))]/40 hover:bg-[rgb(var(--muted))]"
              >
                <span className="font-medium">Obstacles ({storeData.obstacles.length})</span>
                {visibleLayers.obstacles ? (
                  <Eye className="h-3.5 w-3.5 text-red-500" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                )}
              </button>
              <button
                onClick={() => setVisibleLayers((l) => ({ ...l, outdoor: !l.outdoor }))}
                className="flex w-full items-center justify-between rounded px-2 py-1 bg-[rgb(var(--muted))]/40 hover:bg-[rgb(var(--muted))]"
              >
                <span className="font-medium">Outdoor Context</span>
                {visibleLayers.outdoor ? (
                  <Eye className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Vector Canvas */}
        <div className="relative flex-1 bg-[rgb(var(--bg))] overflow-hidden select-none cursor-crosshair">

          {/* Google Maps Style Floating Indoor Floor Selector Overlay */}
          {activeBuildingForSelector && buildingFloorsForSelector.length > 0 && (
            <div className="absolute right-4 top-4 z-20 flex flex-col items-center gap-1.5 rounded-2xl border bg-[rgb(var(--card))]/90 p-2 shadow-2xl backdrop-blur-md">
              <span className="text-[10px] font-bold text-[rgb(var(--primary))] uppercase tracking-wider block text-center truncate max-w-full">
                {activeBuildingForSelector.name}
              </span>
              <div className="flex flex-col gap-1 max-h-72 overflow-y-auto scrollbar-none">
                {buildingFloorsForSelector.map((fl) => {
                  const isActive = activeFloorId === fl.id;
                  const code = fl.code || getFloorCode(fl.ordinal, fl.name);
                  return (
                    <button
                      key={fl.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveFloorId(fl.id);
                      }}
                      title={`${fl.name} (Level ${fl.ordinal})`}
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-xl text-xs font-black transition-all shadow-xs",
                        isActive
                          ? "bg-[rgb(var(--primary))] text-white scale-110 shadow-md ring-2 ring-[rgb(var(--primary)/0.4)]"
                          : "bg-[rgb(var(--muted))]/80 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]"
                      )}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <svg
            ref={canvasRef}
            className="h-full w-full bg-[var(--map-bg)]"
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onClick={handleCanvasClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            <defs>
              <pattern id="cad-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                <path
                  d="M 28 0 L 0 0 0 28"
                  fill="none"
                  stroke="#cbd5e1"
                  strokeOpacity="0.5"
                  strokeWidth="0.8"
                />
              </pattern>
              <linearGradient id="bldFillGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#818cf8" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.08" />
              </linearGradient>
              <linearGradient id="routeGrad" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#2563eb" />
              </linearGradient>
            </defs>

            <rect id="cad-grid-rect" width="100%" height="100%" fill="url(#cad-grid)" />

            <g
              transform={`translate(${panOffset.x}, ${panOffset.y}) scale(${zoom})`}
              style={{
                willChange: "transform",
                ...(isAnimatingPan ? { transition: "transform 0.4s ease-out" } : {}),
              }}
            >

              {/* Requirement #1: RENDER OBSTACLES VISUALLY IN GRAPH */}
              {visibleLayers.obstacles &&
                floorObstacles.map((obs) => {
                  const isSelected = selectedElement?.type === "obstacle" && selectedElement.id === obs.id;
                  const isRouteOnly = Boolean(obs.edgeIds && obs.edgeIds.length > 0);

                  return (
                    <g
                      key={obs.id}
                      transform={`translate(${obs.x}, ${obs.y})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElement({ type: "obstacle", id: obs.id });
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        campusStore.saveSnapshotToUndo("Moved Obstacle");
                        const cPos = getCanvasCoords(e);
                        setDraggingId({ type: "obstacle", id: obs.id });
                        setDragOffset({ x: cPos.x - obs.x, y: cPos.y - obs.y });
                      }}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      {/* Draw translucent red circle ONLY for Area Hazards (NOT for Route-Only obstacles) */}
                      {!isRouteOnly && (
                        <circle
                          r={obs.radius}
                          fill="rgba(239, 68, 68, 0.25)"
                          stroke={isSelected ? "#b91c1c" : "#ef4444"}
                          strokeWidth={isSelected ? 3 : 2}
                          strokeDasharray="6 4"
                          className="animate-pulse"
                        />
                      )}

                      {/* Red pin removed */}

                      {/* Warning Icon & Reason Text Label */}
                      <text
                        y={isRouteOnly ? -12 : -obs.radius - 6}
                        textAnchor="middle"
                        fontSize="11"
                        fontWeight="bold"
                        fill="#dc2626"
                        className="drop-shadow-xs"
                      >
                        ⚠ {obs.reason ?? "Blocked"} {!isRouteOnly ? `(${obs.radius}px)` : ""}
                      </text>
                    </g>
                  );
                })}

              {/* Render Buildings — Styled 1-to-1 with User Navigation Map (True N-Corner Polygon) */}
              {visibleLayers.buildings &&
                storeData.buildings.map((b) => {
                  const canvasPts = getBuildingCanvasPoints(b);
                  const svgPath = getPolygonSvgPath(canvasPts);
                  const centerPos = getBuildingCenter(b);
                  const isSelected = selectedElement?.type === "building" && selectedElement.id === b.id;
                  const isPlacementTool = activeTool === "NODE" || activeTool === "DESTINATION" || activeTool === "OBSTACLE" || activeTool === "EVENT" || activeTool === "EDGE" || activeTool === "DOOR" || activeTool === "ROOM" || activeTool === "PLACE_VERTICAL";

                  const buildingEvent = storeData.events.find((ev) => ev.buildingId === b.id && isEventActive(ev, nowMs));
                  const bName = b.name;
                  const badgeWidth = Math.max(145, bName.length * 9.5 + 32);
                  const strokeColor = isSelected ? "#4f46e5" : buildingEvent?.color || b.color || "#4f46e5";

                  return (
                    <g
                      key={b.id}
                      onClick={(e) => {
                        if (isPlacementTool) return;
                        e.stopPropagation();
                        setSelectedElement({ type: "building", id: b.id });
                      }}
                      onMouseDown={(e) => {
                        if (isPlacementTool) return;
                        e.stopPropagation();
                        campusStore.saveSnapshotToUndo(`Moved Building "${b.name}"`);
                        const cPos = getCanvasCoords(e);
                        setDraggingId({ type: "building", id: b.id });
                        setDragOffset({ x: cPos.x - centerPos.x, y: cPos.y - centerPos.y });
                      }}
                      className={isPlacementTool ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"}
                    >
                      {/* Outer Glow Polygon Outline */}
                      <path
                        d={svgPath}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth="5"
                        strokeOpacity="0.2"
                        strokeLinejoin="round"
                      />
                      {/* Solid Light-Theme Building Polygon Footprint */}
                      <path
                        d={svgPath}
                        fill="url(#bldFillGrad)"
                        stroke={strokeColor}
                        strokeWidth={isSelected ? "3.5" : buildingEvent ? "3" : "2.5"}
                        strokeDasharray={activeFloorId !== "f-out" && !isGroundFloorView ? "6 4" : undefined}
                        strokeLinejoin="round"
                      />
                      {/* Inner Architectural Accent Polygon Line */}
                      <path
                        d={svgPath}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth="1"
                        strokeOpacity="0.3"
                        strokeDasharray="4 4"
                        strokeLinejoin="round"
                        transform={`translate(${centerPos.x}, ${centerPos.y}) scale(0.92) translate(${-centerPos.x}, ${-centerPos.y})`}
                      />

                      {/* Prominent White Building Header Badge Centered on Polygon Centroid */}
                      <g transform={`translate(${centerPos.x}, ${centerPos.y})`}>
                        <rect
                          x={-badgeWidth / 2}
                          y="-16"
                          width={badgeWidth}
                          height="32"
                          rx="16"
                          fill="var(--map-surface)"
                          stroke={strokeColor}
                          strokeWidth="2"
                          className="shadow-md"
                        />
                        <text
                          x="0"
                          y="4.5"
                          textAnchor="middle"
                          fill="#1e1b4b"
                          fontSize="14"
                          fontWeight="900"
                          letterSpacing="0.02em"
                        >
                          <tspan fontSize="16">🏢 </tspan>
                          <tspan>{bName}</tspan>
                        </text>
                      </g>
                      {buildingEvent && (
                        <g transform={`translate(${centerPos.x + badgeWidth / 2 + 6}, ${centerPos.y - 12})`}>
                          <rect width="22" height="22" rx="11" fill={buildingEvent.color || "#f59e0b"} />
                          <text x="11" y="15" textAnchor="middle" fill="#ffffff" fontSize="11" fontWeight="bold">
                            </text>
                        </g>
                      )}
                    </g>
                  );
                })}

              {/* Render Edges — Styled 1-to-1 with User Navigation Map */}
              {visibleLayers.edges &&
                floorEdges.map((e) => {
                  const fromN = storeData.nodes.find((n) => n.id === e.from);
                  const toN = storeData.nodes.find((n) => n.id === e.to);
                  if (!fromN || !toN) return null;
                  const isSelected = selectedElement?.type === "edge" && selectedElement.id === e.id;
                  const isRoad = e.type === "ROAD" || e.pathType === "EV";

                  const isBlockedByObstacle = floorObstacles.some(
                    (obs) => obs.edgeIds && (obs.edgeIds.includes(e.id) || obs.edgeIds.includes(`${e.id}_rev`))
                  );

                  return (
                    <g key={e.id}>
                      {/* Transparent 18px hit target for instant single-click selection */}
                      <line
                        x1={fromN.x}
                        y1={fromN.y}
                        x2={toN.x}
                        y2={toN.y}
                        stroke="transparent"
                        strokeWidth="18"
                        style={{ pointerEvents: "stroke" }}
                        onClick={(evt) => {
                          evt.stopPropagation();
                          if (activeTool === "NODE") {
                            const { x: rawX, y: rawY } = getCanvasCoords(evt);
                            const dx = toN.x - fromN.x;
                            const dy = toN.y - fromN.y;
                            const l2 = dx * dx + dy * dy;
                            let t = l2 === 0 ? 0 : ((rawX - fromN.x) * dx + (rawY - fromN.y) * dy) / l2;
                            t = Math.max(0, Math.min(1, t));
                            const projX = Math.round(fromN.x + t * dx);
                            const projY = Math.round(fromN.y + t * dy);

                            const newId = campusStore.splitEdgeWithNode(e.id, projX, projY, nodeType, nodeName);
                            if (newId) {
                              setSelectedElement({ type: "node", id: newId });
                              toast({ type: "success", title: "Edge Split", description: `Inserted node on edge at (${projX}, ${projY}).` });
                              setNodeName("");
                            }
                          } else if (activeTool !== "SIMULATE") {
                            setSelectedElement({ type: "edge", id: e.id });
                          }
                        }}
                        className="cursor-pointer"
                      />

                      {/* EV Path / Roadway Rendering: Asphalt base with curbs and dashed centerline */}
                      {isRoad ? (
                        <>
                          {/* Outer Road Curb Casing */}
                          <line
                            x1={fromN.x}
                            y1={fromN.y}
                            x2={toN.x}
                            y2={toN.y}
                            stroke={isBlockedByObstacle ? "#ef4444" : isSelected ? "#4f46e5" : "#475569"}
                            strokeWidth={isSelected ? 14 : 12}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            opacity={0.9}
                          />
                          {/* Asphalt Core Roadbed */}
                          <line
                            x1={fromN.x}
                            y1={fromN.y}
                            x2={toN.x}
                            y2={toN.y}
                            stroke={isBlockedByObstacle ? "#fee2e2" : "var(--map-ink)"}
                            strokeWidth={isSelected ? 10 : 8}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {/* White Centerline Divider */}
                          {!isBlockedByObstacle && (
                            <line
                              x1={fromN.x}
                              y1={fromN.y}
                              x2={toN.x}
                              y2={toN.y}
                              stroke="var(--map-bg)"
                              strokeWidth="1.2"
                              strokeDasharray="4 6"
                              strokeOpacity="0.85"
                              strokeLinecap="round"
                            />
                          )}
                        </>
                      ) : (
                        /* Standard Pedestrian Path */
                        <line
                          x1={fromN.x}
                          y1={fromN.y}
                          x2={toN.x}
                          y2={toN.y}
                          stroke={
                            isBlockedByObstacle
                              ? "#ef4444"
                              : isSelected
                                ? "#4f46e5"
                                : "#64748b"
                          }
                          strokeWidth={isSelected ? 4 : isBlockedByObstacle ? 3.5 : 2.5}
                          strokeDasharray={isBlockedByObstacle ? "6 4" : e.type === "STAIRS" ? "4 4" : undefined}
                          strokeOpacity={0.8}
                          strokeLinecap="round"
                          className="cursor-pointer hover:stroke-indigo-500 transition-colors"
                        />
                      )}
                    </g>
                  );
                })}

              {/* Render Nodes — Styled 1-to-1 with User Navigation Map */}
              {visibleLayers.nodes && (() => {
                const renderedBadgePositions = new Set<string>();
                return floorNodes.map((n) => {
                  const isSelected = selectedElement?.type === "node" && selectedElement.id === n.id;
                  const isEdgeStart = edgeStartNodeId === n.id;
                  const isStair = n.type === "STAIR" || (n.name && n.name.toLowerCase().includes("stair"));
                  const isLift = n.type === "LIFT" || (n.name && n.name.toLowerCase().includes("lift"));
                  const isRoom = n.type === "ROOM" || n.type === "LABORATORY" || n.type === "OFFICE" || n.type === "WASHROOM";
                  const isStairOrLift = isStair || isLift;

                  const nodeColor = isSelected
                    ? "#4f46e5"
                    : isEdgeStart
                      ? "#10b981"
                      : isStairOrLift
                        ? "#f59e0b"
                        : n.type === "ENTRANCE" || n.type === "OUTDOOR" || n.type === "BUILDING_ENTRANCE"
                          ? "#10b981"
                          : isRoom
                            ? "#8b5cf6"
                            : "#64748b";

                  const nodeRadius = isSelected ? 8 : isEdgeStart ? 9 : isStairOrLift ? 7 : isRoom ? 6 : 4.5;
                  const rawName = n.name || "";
                  const cleanedName = isStairOrLift ? cleanStairLiftDisplayName(rawName) : rawName;
                  const displayName = isStair ? `𓊍 ${cleanedName}` : isLift ? `🛗 ${cleanedName}` : rawName;
                  const labelWidth = Math.max(70, displayName.length * 7 + (isStair ? 20 : 16));
                  const badgeHeight = isStairOrLift ? 22 : 19;
                  const labelY = isStairOrLift ? -20 : isSelected ? 20 : 14;

                  const posKey = `${Math.round(n.x)},${Math.round(n.y)}`;
                  const shouldRenderBadge =
                    !hideNodeNames &&
                    rawName.length > 0 &&
                    (isStairOrLift || !roomLinkedNodeIds.has(n.id)) &&
                    !renderedBadgePositions.has(posKey);

                  if (shouldRenderBadge) {
                    renderedBadgePositions.add(posKey);
                  }

                  const isLinkedToRoom = visibleLayers.rooms && roomLinkedNodeIds.has(n.id);
                  if (isLinkedToRoom) {
                    return null;
                  }

                  return (
                    <g
                      key={n.id}
                      transform={`translate(${n.x}, ${n.y})`}
                      onClick={(e) => handleNodeClick(n, e)}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        campusStore.saveSnapshotToUndo(`Moved Node "${n.name || n.id}"`);
                        const cPos = getCanvasCoords(e);
                        setDraggingId({ type: "node", id: n.id });
                        setDragOffset({ x: cPos.x - n.x, y: cPos.y - n.y });
                      }}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      {/* Outer Glow Ring for Stairs */}
                      {isStairOrLift && (
                        <circle
                          cx={0}
                          cy={0}
                          r={10}
                          fill="none"
                          stroke="#f59e0b"
                          strokeWidth="2"
                          strokeOpacity="0.4"
                          className="animate-pulse"
                        />
                      )}

                      <circle
                        r={nodeRadius}
                        fill={nodeColor}
                        stroke="var(--map-halo)"
                        strokeWidth={isSelected ? 2.5 : isEdgeStart ? 2.5 : 1.5}
                      />

                      {/* Clean Light-Theme Name Badge for Named Nodes (Deduplicated per position) */}
                      {shouldRenderBadge && (
                        <g transform={`translate(0, ${labelY})`}>
                          <rect
                            x={-labelWidth / 2}
                            y={-badgeHeight / 2}
                            width={labelWidth}
                            height={badgeHeight}
                            rx="5"
                            fill="var(--map-surface)"
                            stroke={isSelected ? "#4f46e5" : isStairOrLift ? "#f59e0b" : "#94a3b8"}
                            strokeWidth="1.5"
                            className="shadow-md"
                          />
                          <text
                            x="0"
                            y="3.5"
                            textAnchor="middle"
                            fill={isSelected ? "#1e40af" : isStairOrLift ? "#b45309" : "#0f172a"}
                            fontSize={isStairOrLift ? 11 : 9}
                            fontWeight="700"
                          >
                            {isStair ? (
                              <>
                                <tspan fontSize="35">𓊍 </tspan>
                                <tspan>{cleanedName}</tspan>
                              </>
                            ) : isLift ? (
                              <>
                                <tspan fontSize="14">🛗 </tspan>
                                <tspan>{cleanedName}</tspan>
                              </>
                            ) : (
                              displayName
                            )}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                });
              })()}

              {/* Render Rooms / Destinations */}
              {visibleLayers.rooms &&
                (() => {
                  return floorDestinations.map((d) => {
                    const linkedNode = storeData.nodes.find((n) => n.id === d.nodeId);
                    if (!linkedNode) return null;

                    // Suppress drawing duplicate room/destination pill for stair & lift nodes (node renderer handles stair badge)
                    const isLinkedStairOrLift =
                      linkedNode.type === "STAIR" ||
                      linkedNode.type === "LIFT" ||
                      Boolean(linkedNode.stairGroupId) ||
                      Boolean(linkedNode.liftGroupId) ||
                      (linkedNode.name && (linkedNode.name.toLowerCase().includes("stair") || linkedNode.name.toLowerCase().includes("lift"))) ||
                      d.name.toLowerCase().includes("stair") ||
                      d.name.toLowerCase().includes("lift");

                    if (isLinkedStairOrLift) return null;

                    const isSelected = selectedElement?.type === "destination" && selectedElement.id === d.id;

                    const nameLower = d.name.toLowerCase();
                    const icon = nameLower.includes("atm")
                      ? "🏧"
                      : nameLower.includes("lab")
                        ? "🧪"
                        : nameLower.includes("classroom")
                          ? "🏫"
                          : nameLower.includes("washroom") || nameLower.includes("toilet")
                            ? "🚻"
                            : nameLower.includes("office")
                              ? "💼"
                              : nameLower.includes("canteen") || nameLower.includes("food")
                                ? "🍽"
                                : nameLower.includes("library")
                                  ? "📚"
                                  : nameLower.includes("parking")
                                    ? ""
                                    : "🚪";

                    const nameStr = `${icon} ${d.name}${d.roomNumber ? ` (#${d.roomNumber})` : ""}`;
                    const pillWidth = Math.max(48, nameStr.length * 5.8 + 14);

                    return (
                      <g
                        key={d.id}
                        transform={`translate(${linkedNode.x}, ${linkedNode.y})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeTool === "EDGE") {
                            handleNodeClick(linkedNode, e);
                            return;
                          }
                          setSelectedElement({ type: "destination", id: d.id });
                        }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          campusStore.saveSnapshotToUndo(`Moved Room "${d.name}"`);
                          const cPos = getCanvasCoords(e);
                          setDraggingId({ type: "node", id: linkedNode.id });
                          setDragOffset({ x: cPos.x - linkedNode.x, y: cPos.y - linkedNode.y });
                        }}
                        className="cursor-pointer select-none"
                      >
                        <rect
                          x={-pillWidth / 2}
                          y="-10"
                          width={pillWidth}
                          height="20"
                          rx="5"
                          fill={isSelected ? "#4f46e5" : "rgb(var(--card))"}
                          fillOpacity={isSelected ? 0.95 : 0.92}
                          stroke={isSelected ? "#818cf8" : "#8b5cf6"}
                          strokeWidth={isSelected ? 2 : 1.5}
                          className="shadow-sm transition-all hover:brightness-105"
                        />
                        <text
                          x="0"
                          y="3.5"
                          textAnchor="middle"
                          fill={isSelected ? "#ffffff" : "currentColor"}
                          fontSize="9"
                          fontWeight={isSelected ? "800" : "700"}
                          className="text-[rgb(var(--fg))]"
                        >
                          {nameStr}
                        </text>
                      </g>
                    );
                  });
                })()}



              {/* Render Door Connections */}
              {storeData.doors
                .filter((d) => d.floorId === activeFloorId || isGroundFloorView || activeFloorId.startsWith("f-all"))
                .map((d) => {
                  const connectedNode = storeData.nodes.find((n) => n.id === d.connectedNodeId);
                  if (!connectedNode) return null;
                  return (
                    <line
                      key={`door-conn-${d.id}`}
                      x1={d.x}
                      y1={d.y}
                      x2={connectedNode.x}
                      y2={connectedNode.y}
                      stroke="#06b6d4"
                      strokeWidth="1.5"
                      strokeDasharray="3 3"
                    />
                  );
                })}

              {/* Render Doors */}
              {storeData.doors
                .filter((d) => d.floorId === activeFloorId || isGroundFloorView || activeFloorId.startsWith("f-all"))
                .map((d) => {
                  const isSelected = selectedElement?.type === "door" && selectedElement.id === d.id;
                  const color = d.type === "BUILDING_ENTRANCE" ? "#10b981" : d.type === "EMERGENCY_DOOR" ? "#ef4444" : "#06b6d4";
                  return (
                    <g
                      key={d.id}
                      transform={`translate(${d.x}, ${d.y})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (activeTool === "EDGE") {
                          if (edgeStartNodeId) {
                            campusStore.updateDoor(d.id, { connectedNodeId: edgeStartNodeId });
                            toast({ type: "success", title: "Door Connected", description: `Linked door to node ${edgeStartNodeId}.` });
                            setEdgeStartNodeId(null);
                          } else {
                            toast({ type: "info", title: "Door Selected", description: "Now click a node to connect this door." });
                            setEdgeStartDoorId(d.id);
                          }
                        } else {
                          setSelectedElement({ type: "door", id: d.id });
                        }
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        campusStore.saveSnapshotToUndo(`Moved Door "${d.name || d.id}"`);
                        const cPos = getCanvasCoords(e);
                        setDraggingId({ type: "door", id: d.id });
                        setDragOffset({ x: cPos.x - d.x, y: cPos.y - d.y });
                      }}
                      className="cursor-grab active:cursor-grabbing"
                    >
                      <rect
                        x="-10"
                        y="-10"
                        width="20"
                        height="20"
                        rx="4"
                        fill={color}
                        fillOpacity="0.8"
                        stroke={isSelected ? "var(--map-halo)" : color}
                        strokeWidth={isSelected ? 3 : 1.5}
                      />
                      <text x="0" y="20" textAnchor="middle" fill={color} fontSize="9" fontWeight="bold">
                        {d.name ?? d.type}
                      </text>
                    </g>
                  );
                })}

              {/* Render Smart Graph Suggestions */}
              {storeData.suggestedEdges.map((sEdge) => {
                const fromP =
                  storeData.nodes.find((n) => n.id === sEdge.from) ||
                  storeData.suggestedNodes.find((sn) => sn.id === sEdge.from);
                const toP =
                  storeData.nodes.find((n) => n.id === sEdge.to) ||
                  storeData.suggestedNodes.find((sn) => sn.id === sEdge.to);
                if (!fromP || !toP) return null;
                return (
                  <g key={sEdge.id}>
                    <line
                      x1={fromP.x}
                      y1={fromP.y}
                      x2={toP.x}
                      y2={toP.y}
                      stroke="#06b6d4"
                      strokeWidth="2.5"
                      strokeDasharray="5 4"
                      className="animate-pulse cursor-pointer hover:stroke-cyan-300"
                      onClick={(e) => {
                        e.stopPropagation();
                        campusStore.acceptSuggestion(sEdge.id);
                        toast({ type: "success", title: "Suggestion Accepted", description: "Converted edge into permanent graph link." });
                      }}
                    />
                  </g>
                );
              })}

              {storeData.suggestedNodes.map((sNode) => (
                <g
                  key={sNode.id}
                  transform={`translate(${sNode.x}, ${sNode.y})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    campusStore.acceptSuggestion(sNode.id);
                    toast({ type: "success", title: "Suggestion Accepted", description: `Converted "${sNode.name}" into permanent node.` });
                  }}
                  className="cursor-pointer group"
                >
                  <circle r="12" fill="rgba(6, 182, 212, 0.2)" stroke="#06b6d4" strokeWidth="2" strokeDasharray="3 3" className="animate-ping" />
                  <circle r="7" fill="#06b6d4" stroke="var(--map-halo)" strokeWidth="2" />
                  <text x="12" y="4" fontSize="9" fontWeight="bold" fill="#06b6d4" className="drop-shadow-xs">
                    {sNode.name} (click to accept)
                  </text>
                </g>
              ))}

              {/* Draft Room Rectangle Drag Preview */}
              {activeTool === "ROOM" && roomDragStart && roomDragCurrent && (
                <rect
                  x={Math.min(roomDragStart.x, roomDragCurrent.x)}
                  y={Math.min(roomDragStart.y, roomDragCurrent.y)}
                  width={Math.abs(roomDragCurrent.x - roomDragStart.x)}
                  height={Math.abs(roomDragCurrent.y - roomDragStart.y)}
                  fill="rgba(79, 70, 229, 0.15)"
                  stroke="#4f46e5"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                  rx="6"
                />
              )}

              {/* Render Events */}
              {storeData.events
                .filter((ev) => {
                  if (getEventStatus(ev, nowMs) === "COMPLETED") return false;
                  return isEventActive(ev, nowMs) || (selectedElement?.type === "event" && selectedElement.id === ev.id);
                })
                .map((ev) => {
                  const isSelected = selectedElement?.type === "event" && selectedElement.id === ev.id;
                  const bld = storeData.buildings.find((b) => b.id === ev.buildingId);
                  const evX = ev.x ?? (bld ? (bld.x ?? 0) + (bld.width ?? 180) / 2 : 400);
                  const evY = ev.y ?? (bld ? (bld.y ?? 0) + (bld.height ?? 120) / 2 : 300);
                  const color = ev.color || "#f59e0b";
                  const pillWidth = Math.max(90, ev.title.length * 7 + 34);

                  return (
                    <g
                      key={ev.id}
                      transform={`translate(${evX}, ${evY})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedElement({ type: "event", id: ev.id });
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        const cPos = getCanvasCoords(e);
                        setDraggingId({ type: "event", id: ev.id });
                        setDragOffset({ x: cPos.x - evX, y: cPos.y - evY });
                      }}
                      className="cursor-pointer select-none"
                    >
                      {isSelected && (
                        <rect
                          x={-pillWidth / 2 - 4}
                          y="-16"
                          width={pillWidth + 8}
                          height="28"
                          rx="10"
                          fill="none"
                          stroke={color}
                          strokeWidth="2"
                          className="animate-pulse"
                        />
                      )}
                      <rect
                        x={-pillWidth / 2}
                        y="-14"
                        width={pillWidth}
                        height="24"
                        rx="8"
                        fill={color}
                        fillOpacity="0.95"
                        stroke={isSelected ? "var(--map-halo)" : color}
                        strokeWidth={isSelected ? 2 : 1}
                        className="shadow-md transition-all hover:brightness-105"
                      />
                      <text
                        x="0"
                        y="2"
                        textAnchor="middle"
                        fill="#ffffff"
                        fontSize="10"
                        fontWeight="bold"
                      >
                        {ev.title}
                      </text>
                    </g>
                  );
                })}

              {/* Render Simulated Route Overlay */}
              {activeTool === "SIMULATE" && (simResult || altSimResult) && (
                <g>
                  {/* Helper function to check if node belongs to currently active floor view */}
                  {(() => {
                    const isNodeVisibleOnActiveFloor = (n: Node) => {
                      if (activeFloorId === "f-all") return true;
                      if (activeFloorId === "f-out") return n.floorId === "f-out";
                      return n.floorId === activeFloorId || n.floorId === "f-out";
                    };

                    return (
                      <>
                        {/* Render Obstacle-Free Alternate Route in Emerald Green */}
                        {altSimResult && altSimResult.edges.map((e, idx) => {
                          const fromN = storeData.nodes.find((n) => n.id === e.from);
                          const toN = storeData.nodes.find((n) => n.id === e.to);
                          if (!fromN || !toN) return null;
                          if (!isNodeVisibleOnActiveFloor(fromN) && !isNodeVisibleOnActiveFloor(toN)) return null;

                          return (
                            <g key={`alt-edge-group-${idx}`}>
                              <line
                                x1={fromN.x}
                                y1={fromN.y}
                                x2={toN.x}
                                y2={toN.y}
                                stroke="#10b981"
                                strokeWidth="6"
                                strokeOpacity="0.4"
                                strokeLinecap="round"
                              />
                              <line
                                x1={fromN.x}
                                y1={fromN.y}
                                x2={toN.x}
                                y2={toN.y}
                                stroke="#10b981"
                                strokeWidth="4"
                                strokeLinecap="round"
                              />
                            </g>
                          );
                        })}

                        {/* Render Primary Shortest Route (Red if Obstructed) */}
                        {simResult && (() => {
                          const blockedEdgeIds = getObstructedEdgeIds(storeData.nodes, storeData.edges, storeData.obstacles);

                          return simResult.edges.map((e, idx) => {
                            const fromN = storeData.nodes.find((n) => n.id === e.from);
                            const toN = storeData.nodes.find((n) => n.id === e.to);
                            if (!fromN || !toN) return null;
                            if (!isNodeVisibleOnActiveFloor(fromN) && !isNodeVisibleOnActiveFloor(toN)) return null;

                            const baseId = e.edgeId.replace(/_rev$/, "");
                            const isObstructed =
                              blockedEdgeIds.has(e.edgeId) ||
                              blockedEdgeIds.has(baseId) ||
                              blockedEdgeIds.has(`${baseId}_rev`);

                            return (
                              <g key={`sim-edge-group-${idx}`}>
                                <line
                                  x1={fromN.x}
                                  y1={fromN.y}
                                  x2={toN.x}
                                  y2={toN.y}
                                  stroke={isObstructed ? "#ef4444" : "#0284c7"}
                                  strokeWidth={isObstructed ? "6" : "5"}
                                  strokeOpacity={isObstructed ? "0.35" : "0.3"}
                                  strokeDasharray={isObstructed ? "6 4" : undefined}
                                  strokeLinecap="round"
                                />
                                <line
                                  key={`sim-edge-${idx}`}
                                  x1={fromN.x}
                                  y1={fromN.y}
                                  x2={toN.x}
                                  y2={toN.y}
                                  stroke={isObstructed ? "#ef4444" : "#0284c7"}
                                  strokeWidth={isObstructed ? "4" : "3.5"}
                                  strokeDasharray={isObstructed ? "6 4" : undefined}
                                  className="animate-pulse"
                                  strokeLinecap="round"
                                />
                              </g>
                            );
                          });
                        })()}

                        {/* Start & End Node Route Markers */}
                        {((simResult?.nodes ?? altSimResult?.nodes ?? []).length > 0) && (() => {
                          const routeNodes = simResult?.nodes ?? altSimResult!.nodes;
                          const startNode = routeNodes[0];
                          const endNode = routeNodes[routeNodes.length - 1];

                          // Find if route transitions across floors via stairs/lifts on this floor
                          const transitionNode = routeNodes.find(
                            (n) => isNodeVisibleOnActiveFloor(n) && (n.type === "STAIR" || n.type === "LIFT")
                          );
                          const targetFloorObj = endNode ? storeData.floors.find((f) => f.id === endNode.floorId) : null;

                          return (
                            <g>
                              {/* Start Node Marker */}
                              {isNodeVisibleOnActiveFloor(startNode) && (
                                <g>
                                  <circle cx={startNode.x} cy={startNode.y} r="12" fill="#3b82f6" fillOpacity="0.25" stroke="#3b82f6" strokeWidth="1.5" />
                                  <circle cx={startNode.x} cy={startNode.y} r="6" fill="#2563eb" stroke="white" strokeWidth="2" />
                                  <text x={startNode.x} y={startNode.y - 14} textAnchor="middle" fill="#2563eb" className="text-[11px] font-extrabold select-none">
                                    START
                                  </text>
                                </g>
                              )}

                              {/* Floor Transition Badge if destination is on another floor */}
                              {transitionNode && endNode && endNode.floorId !== transitionNode.floorId && (
                                <g transform={`translate(${transitionNode.x}, ${transitionNode.y - 45})`}>
                                  <rect x="-55" y="-12" width="110" height="22" rx="6" fill="#7c3aed" stroke="#6d28d9" strokeWidth="1.5" />
                                  <text x="0" y="2" textAnchor="middle" fill="white" className="text-[10px] font-extrabold select-none">
                                    Take Stairs ↗
                                  </text>
                                </g>
                              )}



                              {/* End Node Marker */}
                              {endNode && endNode.id !== startNode.id && isNodeVisibleOnActiveFloor(endNode) && (
                                <g>
                                  <circle cx={endNode.x} cy={endNode.y} r="12" fill="#10b981" fillOpacity="0.25" stroke="#10b981" strokeWidth="1.5" />
                                  <circle cx={endNode.x} cy={endNode.y} r="6" fill="#059669" stroke="white" strokeWidth="2" />
                                  <text x={endNode.x} y={endNode.y - 14} textAnchor="middle" fill="#059669" className="text-[11px] font-extrabold select-none">
                                    END ({endNode.name || "Destination"})
                                  </text>
                                </g>
                              )}
                            </g>
                          );
                        })()}
                      </>
                    );
                  })()}
                </g>
              )}


              {/* Device GPS Live Marker with Accuracy Circle & Heading Cone */}
              {gps.isGpsActive && (
                <g style={{ pointerEvents: "none" }} transform={`translate(${gps.canvasPos.x}, ${gps.canvasPos.y})`}>
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
                  <text x="12" y="4" fontSize="10" fontWeight="bold" fill="#3b82f6" className="drop-shadow-xs">
                    You (Live GPS)
                  </text>
                </g>
              )}

              {/* Standalone CAD Fake Live Location & Route Pathfinding Layer */}
              <CadFakeLocationSvgLayer
                fakeGps={fakeGps}
                activeFloorId={activeFloorId}
                getCanvasCoords={getCanvasCoords}
              />

            </g>
          </svg>

          {/* Floating CAD Zoom & Viewport Controls Container (Single Line Bar) */}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 pointer-events-auto max-w-[calc(100%-1rem)] sm:max-w-[calc(100%-2rem)]">
            <div className="flex items-center gap-1.5 rounded-xl border bg-[rgb(var(--card))]/95 px-2.5 py-1.5 shadow-xl backdrop-blur-md text-xs border-[rgb(var(--border))] whitespace-nowrap overflow-x-auto scrollbar-none">
              <button
                onClick={() => {
                  const prev = zoomRef.current || 1;
                  const next = Math.max(0.1, Number((prev - 0.15).toFixed(2)));
                  if (canvasRef.current && prev > 0) {
                    const rect = canvasRef.current.getBoundingClientRect();
                    const cx = rect.width / 2;
                    const cy = rect.height / 2;
                    const curPan = panOffsetRef.current;
                    const newPanX = cx - (cx - curPan.x) * (next / prev);
                    const newPanY = cy - (cy - curPan.y) * (next / prev);
                    panOffsetRef.current = { x: newPanX, y: newPanY };
                    zoomRef.current = next;
                    setPanOffset({ x: newPanX, y: newPanY });
                  }
                  setZoom(next);
                }}
                className="rounded p-1 text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors shrink-0"
                title="Zoom Out (-15%)"
              >
                <ZoomOut className="h-4 w-4 text-[rgb(var(--muted-fg))]" />
              </button>

              <input
                type="range"
                min="0.1"
                max="3.0"
                step="0.05"
                value={zoom}
                onChange={(e) => {
                  const prev = zoomRef.current || 1;
                  const next = Number(e.target.value);
                  if (canvasRef.current && prev > 0) {
                    const rect = canvasRef.current.getBoundingClientRect();
                    const cx = rect.width / 2;
                    const cy = rect.height / 2;
                    const curPan = panOffsetRef.current;
                    const newPanX = cx - (cx - curPan.x) * (next / prev);
                    const newPanY = cy - (cy - curPan.y) * (next / prev);
                    panOffsetRef.current = { x: newPanX, y: newPanY };
                    zoomRef.current = next;
                    setPanOffset({ x: newPanX, y: newPanY });
                  }
                  setZoom(next);
                }}
                className="h-1.5 w-14 sm:w-20 cursor-pointer accent-[rgb(var(--primary))] shrink-0"
                title="Zoom Level Slider"
              />

              <button
                onClick={() => {
                  const prev = zoomRef.current || 1;
                  const next = Math.min(MAX_MAP_ZOOM, Number((prev + 0.25).toFixed(2)));
                  if (canvasRef.current && prev > 0) {
                    const rect = canvasRef.current.getBoundingClientRect();
                    const cx = rect.width / 2;
                    const cy = rect.height / 2;
                    const curPan = panOffsetRef.current;
                    const newPanX = cx - (cx - curPan.x) * (next / prev);
                    const newPanY = cy - (cy - curPan.y) * (next / prev);
                    panOffsetRef.current = { x: newPanX, y: newPanY };
                    zoomRef.current = next;
                    setPanOffset({ x: newPanX, y: newPanY });
                  }
                  setZoom(next);
                }}
                className="rounded p-1 text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors shrink-0"
                title="Zoom In (+25%)"
              >
                <ZoomIn className="h-4 w-4 text-[rgb(var(--primary))]" />
              </button>

              <div className="h-4 w-px bg-[rgb(var(--border-strong))] opacity-80 shrink-0" />

              {(() => {
                const currentPct = Math.round(zoom * 100);
                const zoomOptions = Array.from(new Set([25, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, 4000, currentPct])).filter((v) => v <= MAX_MAP_ZOOM * 100).sort((a, b) => a - b);
                return (
                  <select
                    value={currentPct}
                    onChange={(e) => {
                      const targetPct = Number(e.target.value);
                      const prev = zoomRef.current || 1;
                      const next = targetPct / 100;
                      if (canvasRef.current && prev > 0) {
                        const rect = canvasRef.current.getBoundingClientRect();
                        const cx = rect.width / 2;
                        const cy = rect.height / 2;
                        const curPan = panOffsetRef.current;
                        const newPanX = cx - (cx - curPan.x) * (next / prev);
                        const newPanY = cy - (cy - curPan.y) * (next / prev);
                        panOffsetRef.current = { x: newPanX, y: newPanY };
                        zoomRef.current = next;
                        setPanOffset({ x: newPanX, y: newPanY });
                      }
                      setZoom(next);
                    }}
                    className="rounded border bg-[rgb(var(--bg))] px-2 py-0.5 font-mono text-[11px] font-semibold text-[rgb(var(--fg))] cursor-pointer focus:outline-none shrink-0"
                  >
                    {zoomOptions.map((pct) => (
                      <option key={pct} value={pct}>
                        {pct}%
                      </option>
                    ))}
                  </select>
                );
              })()}

              <div className="h-4 w-px bg-[rgb(var(--border-strong))] opacity-80 shrink-0" />

              <button
                onClick={() => {
                  const mainCanvas = canvasRef.current;
                  const viewportW = mainCanvas ? mainCanvas.clientWidth : 800;
                  const viewportH = mainCanvas ? mainCanvas.clientHeight : 600;
                  const centerX = campusBounds.centerX;
                  const centerY = campusBounds.centerY;
                  setIsAnimatingPan(true);
                  setTimeout(() => setIsAnimatingPan(false), 400);
                  setZoom(1.0);
                  setPanOffset({
                    x: viewportW / 2 - centerX * 1.0,
                    y: viewportH / 2 - centerY * 1.0,
                  });
                  toast({ type: "info", title: "100% Scale View", description: "Centered viewport on campus buildings at 100% scale." });
                }}
                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 transition-colors shrink-0 whitespace-nowrap"
                title="Set View Zoom to 100% & Center Buildings"
              >
                <span>100%</span>
              </button>

              <button
                onClick={() => {
                  const mainCanvas = canvasRef.current;
                  const viewportW = mainCanvas ? mainCanvas.clientWidth : 800;
                  const viewportH = mainCanvas ? mainCanvas.clientHeight : 600;
                  const centerX = campusBounds.centerX;
                  const centerY = campusBounds.centerY;
                  const defaultResetZoom = 0.20;
                  setIsAnimatingPan(true);
                  setTimeout(() => setIsAnimatingPan(false), 400);
                  setZoom(defaultResetZoom);
                  setPanOffset({
                    x: viewportW / 2 - centerX * defaultResetZoom,
                    y: viewportH / 2 - centerY * defaultResetZoom,
                  });
                  toast({ type: "info", title: "View Reset", description: "Centered viewport on campus buildings at 20% scale." });
                }}
                className="flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))] transition-colors shrink-0 whitespace-nowrap"
                title="Reset Viewport (Center Campus Buildings at 20% Scale)"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset</span>
              </button>

              <div className="h-4 w-px bg-[rgb(var(--border-strong))] opacity-80 shrink-0" />

              {/* Locate Me Button */}
              <button
                onClick={() => {
                  if (!gps.isTracking) {
                    gps.startTracking();
                  }
                  if (gps.isGpsActive && gps.canvasPos) {
                    if (canvasRef.current) {
                      const rect = canvasRef.current.getBoundingClientRect();
                      const cx = rect.width / 2;
                      const cy = rect.height / 2;
                      setPanOffset({
                        x: cx - gps.canvasPos.x * zoom,
                        y: cy - gps.canvasPos.y * zoom,
                      });
                    }
                    toast({
                      type: "success",
                      title: "Live GPS Centered",
                      description: `Centered CAD editor on your location (${gps.lat.toFixed(9)}, ${gps.lng.toFixed(9)}).`,
                    });
                  } else {
                    toast({
                      type: "info",
                      title: "Acquiring GPS Location...",
                      description: "Detecting your real-time position...",
                    });
                  }
                }}
                className={`flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${gps.isGpsActive
                    ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 border border-emerald-500/30"
                    : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]"
                  }`}
                title="Focus & Center Live GPS Position"
              >
                <Locate className="h-3.5 w-3.5" />
                <span>Locate Me</span>
              </button>
              <GpsStatusIndicator status={gps.status} className="shrink-0 whitespace-nowrap" />

              <div className="h-4 w-px bg-[rgb(var(--border-strong))] opacity-80 shrink-0" />

              {/* GPS Diagnostics Engine Toggle Button */}
              <button
                onClick={() => setShowDiagnostics((prev) => !prev)}
                className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold transition-colors cursor-pointer shrink-0 whitespace-nowrap ${showDiagnostics
                    ? "bg-slate-900 text-emerald-400 border border-emerald-500/50 shadow-md"
                    : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]"
                  }`}
                title="Toggle Live GPS Diagnostics Engine"
              >
                <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
                <span>GPS Diagnostics</span>
              </button>

              <div className="h-4 w-px bg-[rgb(var(--border-strong))] opacity-80 shrink-0" />

              {/* Delete All Button */}
              <button
                onClick={handleDeleteAll}
                className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-semibold text-red-500 hover:bg-red-500/10 transition-colors shrink-0 whitespace-nowrap"
                title="Delete All Elements"
              >
                <Trash2 className="h-3.5 w-3.5 text-red-500" />
                <span>Delete All</span>
              </button>
            </div>
          </div>

          {/* GPS Diagnostics Panel Overlay */}
          {showDiagnostics && (
            <div className="absolute left-3 top-16 z-50 pointer-events-auto">
              <GpsDiagnosticsPanel gps={gps} onClose={() => setShowDiagnostics(false)} />
            </div>
          )}


        </div>

        {/* Right Inspector Panel */}
        {Boolean(selectedElement || selectedEntityIds.size > 0 || ["ROOM", "EVENT"].includes(activeTool)) && (
          <div className="w-80 border-l bg-[rgb(var(--card))]/80 p-4 overflow-y-auto space-y-4 shrink-0 backdrop-blur-md">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-semibold text-sm text-[rgb(var(--fg))]">Element Inspector</h3>
              {selectedElement && (
                <Button size="sm" variant="ghost" onClick={() => setSelectedElement(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Multi-Selection Bulk Editing Panel */}
            {selectedEntityIds.size > 0 && (
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-3 text-xs space-y-3">
                <div className="flex items-center justify-between font-bold text-indigo-600 dark:text-indigo-400">
                  <span>{selectedEntityIds.size} Objects Selected</span>
                  <Button size="sm" variant="ghost" onClick={() => setSelectedEntityIds(new Set())}>
                    Clear
                  </Button>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Bulk Rename Base Name</label>
                  <div className="flex gap-1.5">
                    <Input
                      placeholder="e.g. Lab, Node"
                      value={bulkRenameInput}
                      onChange={(e) => setBulkRenameInput(e.target.value)}
                    />
                    <Button
                      size="sm"
                      onClick={() => {
                        campusStore.bulkRename(Array.from(selectedEntityIds), bulkRenameInput);
                        toast({ type: "success", title: "Bulk Renamed", description: `Renamed ${selectedEntityIds.size} elements.` });
                      }}
                    >
                      Apply
                    </Button>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Bulk Change Category</label>
                  <div className="flex gap-1.5">
                    <select
                      value={bulkCategoryInput}
                      onChange={(e) => setBulkCategoryInput(e.target.value)}
                      className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs"
                    >
                      {["Classroom", "Laboratory", "Office", "Staff Room", "Seminar Hall", "Library", "Washroom", "Store Room", "Electrical Room", "Custom"].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      onClick={() => {
                        campusStore.bulkUpdateCategory(Array.from(selectedEntityIds), bulkCategoryInput);
                        toast({ type: "success", title: "Bulk Category Updated", description: "Updated room categories." });
                      }}
                    >
                      Set
                    </Button>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    campusStore.bulkDelete(Array.from(selectedEntityIds));
                    setSelectedEntityIds(new Set());
                    setSelectedElement(null);
                    toast({ type: "info", title: "Bulk Deleted Selected Elements" });
                  }}
                  className="w-full text-red-500 border-red-500/30 hover:bg-red-500/10"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Bulk Delete Selected ({selectedEntityIds.size})
                </Button>
              </div>
            )}

            {/* Tool Options Panels */}
            {activeTool === "ROOM" && (
              <div className="rounded-lg border p-3 bg-[rgb(var(--card))] space-y-3 text-xs">
                <Badge className="bg-indigo-600 text-white">Room Drawing Tool</Badge>
                <div>
                  <label className="mb-1 block font-semibold">Room Number *</label>
                  <Input value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} placeholder="e.g. 101, 202" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Room Name *</label>
                  <Input value={roomNameInput} onChange={(e) => setRoomNameInput(e.target.value)} placeholder="e.g. Physics Lab" />
                </div>
                <div>
                  <label className="mb-1 block font-semibold">Category</label>
                  <select
                    value={roomCategory}
                    onChange={(e) => setRoomCategory(e.target.value)}
                    className="w-full rounded border bg-[rgb(var(--bg))] p-2 text-xs"
                  >
                    {["Classroom", "Laboratory", "Office", "Staff Room", "Seminar Hall", "Library", "Washroom", "Store Room", "Electrical Room", "Custom"].map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-[rgb(var(--muted-fg))]">Click on canvas to place room rectangle. Node link will auto-suggest.</p>
              </div>
            )}





            {/* BUILDING Placement Tool Panel */}
            {!selectedElement && selectedEntityIds.size === 0 && activeTool === "BUILDING" && (
              <div className="rounded-lg border p-3.5 bg-[rgb(var(--card))] space-y-3 text-xs shadow-md">
                <Badge className="bg-indigo-600 text-white flex items-center gap-1">
                  <Building2 className="h-3 w-3" /> Building Placement Mode
                </Badge>
                <p className="text-[11px] text-[rgb(var(--muted-fg))] leading-relaxed">
                  Set default building details below, then click anywhere on the CAD Canvas to place a building footprint.
                </p>
                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Building Name</label>
                  <Input
                    placeholder="e.g. Science Block A"
                    value={buildingName}
                    onChange={(e) => setBuildingName(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Short Code</label>
                  <Input
                    placeholder="e.g. SBA"
                    value={buildingCode}
                    onChange={(e) => setBuildingCode(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Accent Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={buildingColor}
                      onChange={(e) => setBuildingColor(e.target.value)}
                      className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
                    />
                    <span className="text-[11px] font-mono font-semibold">{buildingColor}</span>
                  </div>
                </div>
                <div className="rounded-md border bg-[rgb(var(--primary)/0.05)] border-[rgb(var(--primary)/0.2)] p-2 text-[11px] text-[rgb(var(--primary))] font-medium flex items-center gap-1.5">
                  <MousePointer className="h-3.5 w-3.5 shrink-0" />
                  <span>Click CAD Canvas to place building at cursor</span>
                </div>
              </div>
            )}

            {/* OBSTACLE Hazard Tool Panel */}
            {!selectedElement && selectedEntityIds.size === 0 && activeTool === "OBSTACLE" && (
              <div className="rounded-lg border p-3.5 bg-[rgb(var(--card))] space-y-3 text-xs shadow-md">
                <Badge className="bg-amber-600 text-white flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Hazard / Obstacle Tool
                </Badge>
                <p className="text-[11px] text-[rgb(var(--muted-fg))] leading-relaxed">
                  Set hazard reason and radius, then click near a node or walkway on canvas to block routing in real-time.
                </p>
                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Hazard Reason / Title</label>
                  <Input
                    placeholder="e.g. Maintenance / Spill Zone"
                    value={obstacleReason}
                    onChange={(e) => setObstacleReason(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Blocked Radius (Meters)</label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={obstacleRadius}
                    onChange={(e) => setObstacleRadius(Math.max(1, parseFloat(e.target.value) || 10))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="rounded-md border bg-amber-500/10 border-amber-500/30 p-2 text-[11px] text-amber-700 dark:text-amber-300 font-medium flex items-center gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                  <span>Click node or walkway on canvas to place hazard</span>
                </div>
              </div>
            )}

            {/* EDGE Connection Tool Panel */}
            {!selectedElement && selectedEntityIds.size === 0 && activeTool === "EDGE" && (
              <div className="rounded-lg border p-3.5 bg-[rgb(var(--card))] space-y-3 text-xs shadow-md">
                <Badge className="bg-emerald-600 text-white flex items-center gap-1">
                  <GitFork className="h-3 w-3" /> Edge Connection Tool
                </Badge>
                <p className="text-[11px] text-[rgb(var(--muted-fg))] leading-relaxed">
                  {edgeStartNodeId
                    ? "First node selected! Click second node on canvas to create connection."
                    : "Click Node 1, then click Node 2 to connect with a walkway edge segment."}
                </p>

                {edgeStartNodeId && (() => {
                  const startN = storeData.nodes.find((n) => n.id === edgeStartNodeId);
                  return (
                    <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-[11px] text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
                      <span className="font-bold">Start Node: {startN?.name || edgeStartNodeId}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-1.5 text-[10px] text-red-500 hover:bg-red-500/10"
                        onClick={() => setEdgeStartNodeId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  );
                })()}

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Default Edge Type</label>
                  <select
                    value={edgeType}
                    onChange={(e) => setEdgeType(e.target.value as EdgeType)}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs"
                  >
                    <option value="WALK">Pedestrian Walkway</option>
                    <option value="ROAD">Outdoor Street / Road</option>
                    <option value="STAIRS">Staircase Connection</option>
                    <option value="LIFT">Elevator / Lift Connection</option>
                    <option value="RAMP">Accessible Ramp</option>
                    <option value="ESCALATOR">Escalator</option>
                  </select>
                </div>
              </div>
            )}



            {activeTool === "DOOR" && (
              <div className="rounded-lg border p-3 bg-[rgb(var(--card))] space-y-3 text-xs">
                <Badge className="bg-cyan-600 text-white">Door Tool</Badge>
                <div>
                  <label className="mb-1 block font-semibold">Door Type</label>
                  <select
                    value={doorType}
                    onChange={(e) => setDoorType(e.target.value as DoorType)}
                    className="w-full rounded border bg-[rgb(var(--bg))] p-2 text-xs"
                  >
                    <option value="ROOM_DOOR">Room Door</option>
                    <option value="BUILDING_ENTRANCE">Building Entrance</option>
                    <option value="EMERGENCY_DOOR">Emergency Door</option>
                  </select>
                </div>
                <p className="text-[11px] text-[rgb(var(--muted-fg))]">Click room wall or corridor boundary on canvas to place door.</p>
              </div>
            )}

            {activeTool === "PLACE_VERTICAL" && pendingVerticalConnection && (
              <div className="rounded-lg border p-3 bg-[rgb(var(--card))] space-y-3 text-xs">
                <Badge className={pendingVerticalConnection.type === "STAIR" ? "bg-indigo-600 text-white" : "bg-blue-600 text-white"}>
                  Place {pendingVerticalConnection.type === "STAIR" ? "Staircase" : "Elevator"}
                </Badge>
                <div className="space-y-1.5">
                  <p className="font-semibold text-[rgb(var(--fg))]">Name: {pendingVerticalConnection.name}</p>
                  <p className="text-[10px] text-[rgb(var(--muted-fg))]">
                    Connecting {pendingVerticalConnection.selectedFloorIds.length} floor(s)
                  </p>
                </div>
                <p className="text-[11px] text-[rgb(var(--muted-fg))] animate-pulse">
                  Click anywhere on the graph canvas to place this vertical connection group.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPendingVerticalConnection(null);
                    setActiveTool("SELECT");
                  }}
                  className="w-full text-red-500 border-red-500/30 hover:bg-red-500/10 text-xs"
                >
                  Cancel Placement
                </Button>
              </div>
            )}

            {/* Fix #15: NODE tool creation panel when nothing selected */}
            {!selectedElement && selectedEntityIds.size === 0 && activeTool === "NODE" && (
              <div className="rounded-lg border p-3 bg-[rgb(var(--card))] space-y-3 text-xs">
                <Badge className="bg-violet-600 text-white flex items-center gap-1">
                  <Plus className="h-3 w-3" /> Node Placement
                </Badge>
                <p className="text-[11px] text-[rgb(var(--muted-fg))]">Select target building & floor, set coordinates and name, then click canvas — or use the form below to place a node at a specific GPS location.</p>

                <div>
                  <label className="mb-1 block font-semibold">Building Location</label>
                  <select
                    value={nodeTargetBuildingId}
                    onChange={(e) => {
                      const bId = e.target.value;
                      setNodeTargetBuildingId(bId);
                      if (!bId || bId === "outdoor") {
                        setNodeTargetFloorId("f-out");
                        setActiveFloorId("f-out");
                      } else {
                        const bFloors = storeData.floors.filter((f) => f.buildingId === bId);
                        if (bFloors.length > 0) {
                          setNodeTargetFloorId(bFloors[0].id);
                          setActiveFloorId(bFloors[0].id);
                        }
                      }
                    }}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                  >
                    <option value="outdoor">🌳 Outdoor Campus (No Building)</option>
                    {storeData.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        🏢 {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Floor Location</label>
                  <select
                    value={nodeTargetFloorId}
                    onChange={(e) => {
                      const fId = e.target.value;
                      setNodeTargetFloorId(fId);
                      if (fId && !fId.startsWith("f-all")) {
                        setActiveFloorId(fId);
                      }
                    }}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                  >
                    {(!nodeTargetBuildingId || nodeTargetBuildingId === "outdoor") ? (
                      <option value="f-out">Outdoor (f-out)</option>
                    ) : (
                      storeData.floors
                        .filter((f) => f.buildingId === nodeTargetBuildingId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} ({f.code || `Floor ${f.ordinal}`})
                          </option>
                        ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Node Name (optional)</label>
                  <Input value={nodeName} onChange={(e) => setNodeName(e.target.value)} placeholder="e.g. Main Lobby, Lab 101" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium">Latitude</label>
                    <Input
                      type="number"
                      step="0.000000001"
                      placeholder="11.496327485"
                      value={manualLat}
                      onChange={(e) => setManualLat(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium">Longitude</label>
                    <Input
                      type="number"
                      step="0.000000001"
                      placeholder="77.277485104"
                      value={manualLng}
                      onChange={(e) => setManualLng(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full bg-violet-600 text-white hover:bg-violet-700"
                  onClick={() => {
                    const lat = Number(manualLat);
                    const lng = Number(manualLng);
                    if (!manualLat || !manualLng || isNaN(lat) || isNaN(lng)) {
                      toast({ type: "error", title: "Enter Lat/Lng", description: "Fill in valid Latitude and Longitude to place the node." });
                      return;
                    }
                    // Fix #14: GPS boundary check
                    if (!isPointInCampusBoundary(lat, lng)) {
                      toast({ type: "warning", title: "Outside Campus Boundary", description: "The GPS coordinates are outside the campus boundary. Node placed anyway." });
                    }
                    const targetFloor = nodeTargetFloorId && !nodeTargetFloorId.startsWith("f-all")
                      ? nodeTargetFloorId
                      : (activeFloorId.startsWith("f-all") ? "f-out" : activeFloorId);
                    const { x, y } = campusStore.getCanvasCoordsFromGps(lat, lng, targetFloor);
                    const newNodeId = generateShortId("n", storeData.nodes.map((n) => n.id));
                    campusStore.addNode({ id: newNodeId, type: nodeType, name: nodeName.trim() || undefined, floorId: targetFloor, x, y, lat, lng, searchable: true }, false);
                    setSelectedElement({ type: "node", id: newNodeId });
                    const targetFloorObj = storeData.floors.find((f) => f.id === targetFloor);
                    const targetFloorName = targetFloorObj ? targetFloorObj.name : (targetFloor === "f-out" ? "Outdoor Campus" : targetFloor);
                    toast({ type: "success", title: "Node Placed", description: `Placed ${nodeType} node on ${targetFloorName} at (${lat.toFixed(9)}, ${lng.toFixed(9)}).` });
                    setNodeName("");
                    setManualLat("");
                    setManualLng("");
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Node at GPS Location
                </Button>
              </div>
            )}

            {/* Door Inspector */}
            {selectedElement?.type === "door" && (() => {
              const door = storeData.doors.find((d) => d.id === selectedElement.id);
              if (!door) return null;
              const connectedNode = door.connectedNodeId ? storeData.nodes.find((n) => n.id === door.connectedNodeId) : null;
              return (
                <div className="space-y-3 text-xs">
                  <Badge className="bg-cyan-600 text-white">Door</Badge>
                  <div>
                    <label className="mb-1 block font-medium">Door Name</label>
                    <Input
                      value={door.name ?? ""}
                      onChange={(e) => campusStore.updateDoor(door.id, { name: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium">Door Type</label>
                    <select
                      value={door.type}
                      onChange={(e) => campusStore.updateDoor(door.id, { type: e.target.value as DoorType })}
                      className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                    >
                      <option value="ROOM_DOOR">Room Door</option>
                      <option value="BUILDING_ENTRANCE">Building Entrance</option>
                      <option value="EMERGENCY_DOOR">Emergency Door</option>
                    </select>
                  </div>
                  <div className="rounded-md border bg-[rgb(var(--bg))] p-2.5 space-y-1 text-[11px] text-[rgb(var(--muted-fg))]">
                    <div>
                      Floor: <span className="font-semibold text-[rgb(var(--fg))]">{storeData.floors.find((f) => f.id === door.floorId)?.name || door.floorId}</span>
                    </div>
                    <div>
                      Connection: <span className="font-semibold text-[rgb(var(--fg))]">{connectedNode ? (connectedNode.name ?? connectedNode.id) : "None (Independent)"}</span>
                    </div>
                  </div>

                  {door.connectedNodeId && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        campusStore.updateDoor(door.id, { connectedNodeId: undefined });
                        toast({ type: "info", title: "Door Disconnected", description: "Removed connection to node." });
                      }}
                      className="w-full text-xs"
                    >
                      Disconnect from Node
                    </Button>
                  )}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      campusStore.deleteDoor(door.id);
                      setSelectedElement(null);
                      toast({ type: "info", title: "Door Deleted" });
                    }}
                    className="w-full text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Door
                  </Button>
                </div>
              );
            })()}



            {/* Event Inspector Form */}
            {(activeTool === "EVENT" || selectedElement?.type === "event") && (
              <div className="space-y-3 text-xs">
                <Badge variant="warning" className="flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Event Configuration
                </Badge>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Event Title *</label>
                  <Input
                    placeholder="e.g. Annual Tech Fest, Hackathon"
                    value={eventTitle}
                    onChange={(e) => setEventTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Select Location / Building</label>
                  <select
                    value={eventBuildingId}
                    onChange={(e) => setEventBuildingId(e.target.value)}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                  >
                    <option value="">-- Campus Wide (No Building) --</option>
                    {storeData.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Start Date & Time</label>
                  <Input
                    type="datetime-local"
                    value={eventStartsAt}
                    min={getCurrentDateTimeISO()}
                    onChange={(e) => {
                      const newStart = e.target.value;
                      setEventStartsAt(newStart);
                      if (new Date(eventEndsAt) <= new Date(newStart)) {
                        setEventEndsAt(getDefaultEndDateTimeISO(newStart));
                      }
                    }}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">End Date & Time</label>
                  <Input
                    type="datetime-local"
                    value={eventEndsAt}
                    min={eventStartsAt || getCurrentDateTimeISO()}
                    onChange={(e) => setEventEndsAt(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Event Badge Color</label>
                  <div className="flex items-center gap-2 pt-1">
                    {["#f59e0b", "#4f46e5", "#10b981", "#ef4444", "#ec4899", "#8b5cf6"].map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => {
                          setEventColor(color);
                          if (selectedElement?.type === "event") {
                            campusStore.updateEvent(selectedElement.id, { color });
                          }
                        }}
                        style={{ backgroundColor: color }}
                        className={cn(
                          "h-6 w-6 rounded-full border-2 transition-transform cursor-pointer",
                          eventColor === color ? "scale-110 border-white ring-2 ring-[rgb(var(--primary))]" : "border-transparent opacity-80"
                        )}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Description / Info</label>
                  <Input
                    placeholder="Short info for visitors..."
                    value={eventDesc}
                    onChange={(e) => setEventDesc(e.target.value)}
                  />
                </div>

                <Button size="sm" onClick={handleCreateEventSubmit} className="w-full mt-2">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  {selectedElement?.type === "event" ? "Update Event" : "Save Event"}
                </Button>
              </div>
            )}

            {/* Building Inspector */}
            {selectedBuilding && (
              <div className="space-y-3 text-xs">
                <Badge variant="primary">Building</Badge>
                <div>
                  <label className="mb-1 block font-medium">Building Name</label>
                  <Input
                    value={selectedBuilding.name}
                    onChange={(e) => campusStore.updateBuilding(selectedBuilding.id, { name: e.target.value })}
                  />
                </div>

                {/* Building Real-World GPS Coordinates */}
                <div className="rounded-lg border bg-[rgb(var(--muted)/0.3)] p-2.5 space-y-2">
                  <div className="flex items-center justify-between font-bold text-[rgb(var(--primary))] text-[11px]">
                    <span>🌐 Real-World GPS Geolocation</span>
                    <Badge variant="success" className="text-[9px]">9 Decimals</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium">Latitude (Lat)</label>
                      <Input
                        type="number"
                        step="0.000000001"
                        placeholder="11.496327485"
                        value={selectedBuilding.lat ?? ""}
                        onChange={(e) => {
                          const lat = Number(e.target.value);
                          if (!isNaN(lat) && e.target.value !== "") {
                            campusStore.updateBuilding(selectedBuilding.id, { lat });
                          }
                        }}
                        className="font-mono text-xs h-8"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium">Longitude (Lng)</label>
                      <Input
                        type="number"
                        step="0.000000001"
                        placeholder="77.277485104"
                        value={selectedBuilding.lng ?? ""}
                        onChange={(e) => {
                          const lng = Number(e.target.value);
                          if (!isNaN(lng) && e.target.value !== "") {
                            campusStore.updateBuilding(selectedBuilding.id, { lng });
                          }
                        }}
                        className="font-mono text-xs h-8"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-3 mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">Building Coordinates</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium text-[rgb(var(--muted-fg))]">Center Lat</label>
                      <div className="font-mono text-[10px] p-1.5 bg-[rgb(var(--muted))] rounded border border-gray-200">
                        {selectedBuilding.centerLat?.toFixed(6) ?? selectedBuilding.lat?.toFixed(6)}
                      </div>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium text-[rgb(var(--muted-fg))]">Center Lng</label>
                      <div className="font-mono text-[10px] p-1.5 bg-[rgb(var(--muted))] rounded border border-gray-200">
                        {selectedBuilding.centerLng?.toFixed(6) ?? selectedBuilding.lng?.toFixed(6)}
                      </div>
                    </div>
                  </div>

                  <label className="mb-1 block text-xs font-semibold text-[rgb(var(--fg-soft))]">4-Corner Boundary (Real-World)</label>
                  <div className="space-y-1">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="font-mono text-[9px] p-1 bg-[rgb(var(--muted))] rounded border text-[rgb(var(--muted-fg))] flex justify-between">
                        <span>C1:</span>
                        <span>{selectedBuilding.corner1Lat?.toFixed(5)}, {selectedBuilding.corner1Lng?.toFixed(5)}</span>
                      </div>
                      <div className="font-mono text-[9px] p-1 bg-[rgb(var(--muted))] rounded border text-[rgb(var(--muted-fg))] flex justify-between">
                        <span>C2:</span>
                        <span>{selectedBuilding.corner2Lat?.toFixed(5)}, {selectedBuilding.corner2Lng?.toFixed(5)}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="font-mono text-[9px] p-1 bg-[rgb(var(--muted))] rounded border text-[rgb(var(--muted-fg))] flex justify-between">
                        <span>C3:</span>
                        <span>{selectedBuilding.corner3Lat?.toFixed(5)}, {selectedBuilding.corner3Lng?.toFixed(5)}</span>
                      </div>
                      <div className="font-mono text-[9px] p-1 bg-[rgb(var(--muted))] rounded border text-[rgb(var(--muted-fg))] flex justify-between">
                        <span>C4:</span>
                        <span>{selectedBuilding.corner4Lat?.toFixed(5)}, {selectedBuilding.corner4Lng?.toFixed(5)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Building Width & Height controls */}
                <div className="border-t pt-3 mt-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-sm">Visual Presentation</span>
                  </div>
                  <p className="text-[10px] text-amber-600 mb-2 font-medium bg-amber-50 p-1.5 rounded border border-amber-200">
                    Visual size only — does not change real building GPS boundary.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <DimensionInput
                      label="Width (px)"
                      value={selectedBuilding.width ?? 180}
                      min={50}
                      max={10000}
                      onChange={(w) => {
                        const clampedW = Math.max(50, w);
                        campusStore.updateBuilding(selectedBuilding.id, { width: clampedW }, false);
                      }}
                      onCommit={(w) => {
                        const clampedW = Math.max(50, w);
                        campusStore.updateBuilding(selectedBuilding.id, { width: clampedW }, true);
                      }}
                    />
                    <DimensionInput
                      label="Height (px)"
                      value={selectedBuilding.height ?? 120}
                      min={50}
                      max={10000}
                      onChange={(h) => {
                        const clampedH = Math.max(50, h);
                        campusStore.updateBuilding(selectedBuilding.id, { height: clampedH }, false);
                      }}
                      onCommit={(h) => {
                        const clampedH = Math.max(50, h);
                        campusStore.updateBuilding(selectedBuilding.id, { height: clampedH }, true);
                      }}
                    />
                  </div>
                </div>

                {/* Building Floors Manager */}
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span>Building Floors</span>
                    <Badge variant="primary" className="text-[10px]">
                      {storeData.floors.filter((f) => f.buildingId === selectedBuilding.id).length} floors
                    </Badge>
                  </div>

                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {storeData.floors
                      .filter((f) => f.buildingId === selectedBuilding.id)
                      .sort((a, b) => b.ordinal - a.ordinal)
                      .map((f) => {
                        const floorNodesCount = storeData.nodes.filter((n) => n.floorId === f.id).length;
                        const isActive = activeFloorId === f.id;
                        return (
                          <div
                            key={f.id}
                            className={cn(
                              "flex items-center justify-between rounded border p-1.5 transition-colors text-[11px]",
                              isActive ? "bg-[rgb(var(--primary)/0.1)] border-[rgb(var(--primary))]" : "bg-[rgb(var(--card))]"
                            )}
                          >
                            <div>
                              <span className="font-bold">{f.name}</span>
                              <span className="ml-1 text-[10px] text-[rgb(var(--muted-fg))]">(Level {f.ordinal})</span>
                              <div className="text-[9px] text-[rgb(var(--muted-fg))]">{floorNodesCount} nodes</div>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant={isActive ? "primary" : "outline"}
                                className="h-6 px-2 text-[10px]"
                                onClick={() => setActiveFloorId(f.id)}
                              >
                                {isActive ? "Editing" : "Edit"}
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-blue-500 hover:bg-blue-500/10"
                                onClick={() => {
                                  setSelectedElement({ type: "floor", id: f.id });
                                  setRenameInputValue(f.name);
                                  setIsRenameModalOpen(true);
                                }}
                                title="Rename floor"
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>

                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-red-500 hover:bg-red-500/10"
                                onClick={() => campusStore.deleteFloor(f.id)}
                                title="Delete floor"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                  </div>

                  {/* Add Floor Buttons: Upper Floor & Basement Floor */}
                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const buildingFloors = storeData.floors.filter((f) => f.buildingId === selectedBuilding.id);
                        const maxOrdinal = buildingFloors.length > 0 ? Math.max(...buildingFloors.map((f) => f.ordinal)) : -1;
                        const newOrdinal = Math.max(0, maxOrdinal) + 1;
                        const newFloor = campusStore.addFloor(selectedBuilding.id, `Floor ${newOrdinal}`, newOrdinal, `F${newOrdinal}`);
                        setActiveFloorId(newFloor.id);
                        toast({ type: "success", title: "Floor Added", description: `Added "Floor ${newOrdinal}" to ${selectedBuilding.name}.` });
                      }}
                      className="text-blue-500 border-blue-500/30 hover:bg-blue-500/10 text-[11px] h-8 px-2"
                    >
                      <Plus className="mr-1 h-3 w-3" /> Upper Floor
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const buildingFloors = storeData.floors.filter((f) => f.buildingId === selectedBuilding.id);
                        const minOrdinal = buildingFloors.length > 0 ? Math.min(...buildingFloors.map((f) => f.ordinal)) : 0;
                        const nextBasementOrd = Math.min(0, minOrdinal) - 1;
                        const floorName = nextBasementOrd === -1 ? "Basement" : `Basement ${Math.abs(nextBasementOrd)}`;
                        const code = getFloorCode(nextBasementOrd, floorName);
                        const newFloor = campusStore.addFloor(selectedBuilding.id, floorName, nextBasementOrd, code);
                        setActiveFloorId(newFloor.id);
                        toast({ type: "success", title: "Basement Added", description: `Added "${floorName}" (Level ${nextBasementOrd}) to ${selectedBuilding.name}.` });
                      }}
                      className="text-amber-600 border-amber-500/30 hover:bg-amber-500/10 text-[11px] h-8 px-2"
                    >
                      <Plus className="mr-1 h-3 w-3" /> Basement (-1)
                    </Button>
                  </div>
                </div>

                {/* Building Events Section */}
                <div className="border-t pt-3 space-y-2">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="flex items-center gap-1">
                      <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                      <span>Building Events</span>
                    </span>
                    <Badge variant="warning" className="text-[10px]">
                      {storeData.events.filter((e) => e.buildingId === selectedBuilding.id).length} events
                    </Badge>
                  </div>

                  <div className="space-y-1.5 max-h-44 overflow-y-auto">
                    {storeData.events
                      .filter((e) => e.buildingId === selectedBuilding.id)
                      .map((ev) => {
                        const status = getEventStatus(ev);
                        return (
                          <div
                            key={ev.id}
                            className={`flex items-center justify-between rounded border p-1.5 text-[11px] ${status === "ONGOING"
                                ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold"
                                : status === "UPCOMING"
                                  ? "border-blue-500/30 bg-blue-500/5 text-blue-600 dark:text-blue-400"
                                  : "border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.3)] text-[rgb(var(--muted-fg))] opacity-75"
                              }`}
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: ev.color || "#f59e0b" }} />
                                <span className="font-bold truncate">{ev.title}</span>
                                <Badge
                                  variant={status === "ONGOING" ? "warning" : status === "UPCOMING" ? "primary" : "default"}
                                  className="text-[9px] px-1 py-0"
                                >
                                  {status === "ONGOING" ? "Ongoing" : status === "UPCOMING" ? "Upcoming" : "Completed"}
                                </Badge>
                              </div>
                              {ev.description && <div className="text-[9px] text-[rgb(var(--muted-fg))] truncate">{ev.description}</div>}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-1.5 text-[10px]"
                                onClick={() => {
                                  setSelectedElement({ type: "event", id: ev.id });
                                  setActiveTool("EVENT");
                                }}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-6 w-6 p-0 text-red-500 hover:bg-red-500/10"
                                onClick={() => {
                                  campusStore.deleteEvent(ev.id);
                                  toast({ type: "info", title: "Event Deleted", description: `Removed event "${ev.title}".` });
                                }}
                                title="Delete Event"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    {storeData.events.filter((e) => e.buildingId === selectedBuilding.id).length === 0 && (
                      <p className="text-[10px] text-[rgb(var(--muted-fg))] italic">No events assigned to this building yet.</p>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEventBuildingId(selectedBuilding.id);
                      setEventTitle(`${selectedBuilding.name} Event`);
                      setActiveTool("EVENT");
                      setSelectedElement(null);
                      toast({
                        type: "info",
                        title: "Add Building Event",
                        description: `Configure new event for ${selectedBuilding.name} in the form.`,
                      });
                    }}
                    className="w-full text-amber-600 border-amber-500/30 hover:bg-amber-500/10"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Event for {selectedBuilding.name || "Building"}
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    campusStore.deleteBuilding(selectedBuilding.id);
                    setSelectedElement(null);
                  }}
                  className="w-full text-red-500 hover:bg-red-500/10 mt-2"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Building
                </Button>
              </div>
            )}

            {/* Node Inspector */}
            {selectedNode && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="primary">{selectedNode.type} Node</Badge>
                  <span className="font-mono text-[10px] text-[rgb(var(--muted-fg))]">{selectedNode.id}</span>
                </div>

                <div>
                  <label className="mb-1 block font-semibold">Node Name</label>
                  <Input
                    value={selectedNode.name ?? ""}
                    onChange={(e) => campusStore.updateNode(selectedNode.id, { name: e.target.value })}
                  />
                </div>

                {/* Building & Floor Assignment */}
                <div className="rounded-lg border bg-[rgb(var(--muted)/0.2)] p-2.5 space-y-2">
                  <div className="flex items-center justify-between font-bold text-[rgb(var(--primary))] text-[11px]">
                    <span>Building & Floor Assignment</span>
                    <Badge variant="primary" className="text-[9px]">
                      {selectedNode.floorId === "f-out"
                        ? "Outdoor"
                        : storeData.floors.find((f) => f.id === selectedNode.floorId)?.name || selectedNode.floorId}
                    </Badge>
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium">Building</label>
                    <select
                      value={
                        selectedNode.floorId === "f-out"
                          ? "outdoor"
                          : storeData.floors.find((f) => f.id === selectedNode.floorId)?.buildingId || "outdoor"
                      }
                      onChange={(e) => {
                        const bId = e.target.value;
                        if (!bId || bId === "outdoor") {
                          campusStore.updateNode(selectedNode.id, { floorId: "f-out" });
                          toast({ type: "info", title: "Building Updated", description: "Node moved to Outdoor Campus." });
                        } else {
                          const bFloors = storeData.floors.filter((f) => f.buildingId === bId);
                          if (bFloors.length > 0) {
                            campusStore.updateNode(selectedNode.id, { floorId: bFloors[0].id });
                            const bld = storeData.buildings.find((b) => b.id === bId);
                            toast({ type: "info", title: "Building Updated", description: `Node moved to ${bld?.name || bId} (${bFloors[0].name}).` });
                          } else {
                            toast({ type: "warning", title: "No Floors Found", description: "Selected building has no floors created yet." });
                          }
                        }
                      }}
                      className="w-full rounded border bg-[rgb(var(--bg))] p-1.5 text-xs text-[rgb(var(--fg))]"
                    >
                      <option value="outdoor">🌳 Outdoor Campus (No Building)</option>
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          🏢 {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-0.5 block text-[10px] font-medium">Floor</label>
                    <select
                      value={selectedNode.floorId}
                      onChange={(e) => {
                        const newFloorId = e.target.value;
                        campusStore.updateNode(selectedNode.id, { floorId: newFloorId });
                        const fl = storeData.floors.find((f) => f.id === newFloorId);
                        toast({
                          type: "success",
                          title: "Floor Updated",
                          description: `Node ${selectedNode.name || selectedNode.id} assigned to ${fl ? fl.name : newFloorId}.`,
                        });
                      }}
                      className="w-full rounded border bg-[rgb(var(--bg))] p-1.5 text-xs text-[rgb(var(--fg))]"
                    >
                      {selectedNode.floorId === "f-out" ? (
                        <option value="f-out">Outdoor (f-out)</option>
                      ) : (
                        (() => {
                          const curFloor = storeData.floors.find((f) => f.id === selectedNode.floorId);
                          const bId = curFloor?.buildingId;
                          const bFloors = bId ? storeData.floors.filter((f) => f.buildingId === bId) : storeData.floors;
                          return bFloors.map((f) => (
                            <option key={f.id} value={f.id}>
                              {f.name} ({f.code || `Floor ${f.ordinal}`})
                            </option>
                          ));
                        })()
                      )}
                    </select>
                  </div>
                </div>

                {/* Real-World GPS Geolocation Section */}
                <div className="rounded-lg border bg-[rgb(var(--muted)/0.3)] p-2.5 space-y-2">
                  <div className="flex items-center justify-between font-bold text-[rgb(var(--primary))] text-[11px]">
                    <span>🌐 Real-World GPS Geolocation</span>
                    <Badge variant="success" className="text-[9px]">GPS Enabled</Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium">Latitude (Lat)</label>
                      <Input
                        type="number"
                        step="0.000000001"
                        value={selectedNode.lat ?? 11.496327485}
                        onChange={(e) => {
                          const lat = Number(e.target.value);
                          const lng = selectedNode.lng ?? 77.277485104;
                          // Fix #10: Sync canvas position when GPS changes
                          const { x, y } = campusStore.getCanvasCoordsFromGps(lat, lng, selectedNode.floorId);
                          // Fix #14: Boundary check
                          if (!isPointInCampusBoundary(lat, lng)) {
                            toast({ type: "warning", title: "Outside Campus Boundary", description: "Coordinates are outside the campus boundary." });
                          }
                          campusStore.updateNode(selectedNode.id, { lat, x, y });
                        }}
                        className="font-mono text-xs h-8"
                      />
                    </div>
                    <div>
                      <label className="mb-0.5 block text-[10px] font-medium">Longitude (Lng)</label>
                      <Input
                        type="number"
                        step="0.000000001"
                        value={selectedNode.lng ?? 77.277485104}
                        onChange={(e) => {
                          const lng = Number(e.target.value);
                          const lat = selectedNode.lat ?? 11.496327485;
                          // Fix #10: Sync canvas position when GPS changes
                          const { x, y } = campusStore.getCanvasCoordsFromGps(lat, lng, selectedNode.floorId);
                          // Fix #14: Boundary check
                          if (!isPointInCampusBoundary(lat, lng)) {
                            toast({ type: "warning", title: "Outside Campus Boundary", description: "Coordinates are outside the campus boundary." });
                          }
                          campusStore.updateNode(selectedNode.id, { lng, x, y });
                        }}
                        className="font-mono text-xs h-8"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const gps = (selectedNode.lat && selectedNode.lng)
                          ? { lat: selectedNode.lat, lng: selectedNode.lng }
                          : canvasToGps(selectedNode.x, selectedNode.y);
                        const coord = `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`;
                        navigator.clipboard.writeText(coord);
                        toast({ type: "info", title: "GPS Coordinates Copied", description: coord });
                      }}
                      className="h-7 text-[10px]"
                    >
                      Copy GPS
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          const text = await navigator.clipboard.readText();
                          const parts = text.split(",").map((s) => parseFloat(s.trim()));
                          if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                            const { x, y } = campusStore.getCanvasCoordsFromGps(parts[0], parts[1], selectedNode.floorId);
                            campusStore.updateNode(selectedNode.id, { lat: parts[0], lng: parts[1], x, y });
                            toast({ type: "success", title: "GPS Coordinates Pasted", description: `${parts[0]}, ${parts[1]}` });
                          }
                        } catch {
                          toast({ type: "error", title: "Paste Failed", description: "Clipboard does not contain valid 'lat, lng'." });
                        }
                      }}
                      className="h-7 text-[10px]"
                    >
                      Paste GPS
                    </Button>
                  </div>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => zoomToPos(selectedNode.x, selectedNode.y, selectedNode.floorId)}
                    className="w-full h-7 text-[10px]"
                  >
                    <Navigation className="mr-1 h-3 w-3" /> Center Map on Node
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block font-medium">Canvas X</label>
                    <Input
                      type="number"
                      value={selectedNode.x}
                      onChange={(e) => campusStore.updateNode(selectedNode.id, { x: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium">Canvas Y</label>
                    <Input
                      type="number"
                      value={selectedNode.y}
                      onChange={(e) => campusStore.updateNode(selectedNode.id, { y: Number(e.target.value) })}
                    />
                  </div>
                </div>

                {/* Node Reference Photo Inspector Card */}
                <div className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-2.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-[rgb(var(--fg))] flex items-center gap-1.5">
                      <Camera className="h-3.5 w-3.5 text-[rgb(var(--primary))]" /> Reference Photo
                    </span>
                    {selectedNode.photoUrl ? (
                      <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0.5">Attached</Badge>
                    ) : (
                      <span className="text-[10px] text-[rgb(var(--muted-fg))]">○ None</span>
                    )}
                  </div>
                  {selectedNode.photoUrl ? (
                    <div className="space-y-1.5">
                      <div className="relative w-full overflow-hidden rounded-md border border-[rgb(var(--border))] bg-transparent flex items-center justify-center">
                        <img src={selectedNode.photoUrl} alt="Reference" className="w-full h-auto max-h-36 object-contain rounded-md" />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setViewingPhotoNode({
                            id: selectedNode.id,
                            name: selectedNode.name || `Node ${selectedNode.id}`,
                            photoUrl: selectedNode.photoUrl!,
                            lat: selectedNode.lat,
                            lng: selectedNode.lng,
                            physicalVerified: selectedNode.physicalVerified,
                          })}
                          className="w-full text-[11px] h-7 gap-1"
                        >
                          <Eye className="h-3 w-3" /> View
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            campusStore.updateNode(selectedNode.id, {
                              photoUrl: undefined,
                              photoUploadedAt: undefined,
                              physicalVerified: false,
                            });
                            fetch(`/api/nodes/${selectedNode.id}/photo`, { method: "DELETE" }).catch(() => {});
                            toast({
                              type: "info",
                              title: "Photo Removed",
                              description: `Removed photo from ${selectedNode.name || selectedNode.id}. The node remains intact.`,
                            });
                          }}
                          className="w-full text-[11px] h-7 gap-1 text-red-500 border-red-500/30 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3 w-3" /> Remove Photo
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-[rgb(var(--muted-fg))]">No physical reference photo attached for this node.</p>
                      <input
                        type="file"
                        id={`node-photo-upload-${selectedNode.id}`}
                        accept="image/*"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const reader = new FileReader();
                          reader.onload = async (ev) => {
                            const dataUrl = ev.target?.result as string;
                            if (dataUrl) {
                              campusStore.updateNode(selectedNode.id, {
                                photoUrl: dataUrl,
                                photoUploadedAt: new Date().toISOString(),
                              });
                              fetch(`/api/nodes/${selectedNode.id}/photo`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ photoData: dataUrl }),
                              }).catch(() => {});
                              toast({
                                type: "success",
                                title: "Photo Attached",
                                description: `Attached reference photo to ${selectedNode.name || selectedNode.id}.`,
                              });
                            }
                          };
                          reader.readAsDataURL(file);
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => document.getElementById(`node-photo-upload-${selectedNode.id}`)?.click()}
                        className="w-full text-[11px] h-7 gap-1 text-[rgb(var(--primary))] border-[rgb(var(--primary)/0.3)] hover:bg-[rgb(var(--primary)/0.1)]"
                      >
                        <Upload className="h-3 w-3" /> Attach Photo
                      </Button>
                    </div>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    campusStore.deleteNode(selectedNode.id);
                    setSelectedElement(null);
                  }}
                  className="w-full text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Node
                </Button>
              </div>
            )}

            {/* Obstacle Inspector */}
            {selectedObstacle && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <Badge variant="danger">Obstacle Hazard</Badge>
                  <Badge variant="default" className="text-[10px]">
                    {selectedObstacle.edgeIds && selectedObstacle.edgeIds.length > 0 ? "Route-only" : "Area radius"}
                  </Badge>
                </div>

                <div>
                  <label className="mb-1 block font-medium">Reason / Label</label>
                  <Input
                    value={selectedObstacle.reason ?? ""}
                    onChange={(e) => campusStore.updateObstacle(selectedObstacle.id, { reason: e.target.value })}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Assigned Floor Level</label>
                  <select
                    value={selectedObstacle.floorId ?? "f-out"}
                    onChange={(e) => campusStore.updateObstacle(selectedObstacle.id, { floorId: e.target.value })}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs font-semibold text-[rgb(var(--fg))] cursor-pointer focus:outline-none"
                  >
                    <option value="f-out">🌿 Outdoor / Campus Wide</option>
                    {storeData.buildings.map((bld) => {
                      const bFloors = storeData.floors
                        .filter((f) => f.buildingId === bld.id)
                        .sort((a, b) => a.ordinal - b.ordinal);
                      if (bFloors.length === 0) return null;
                      return (
                        <optgroup key={bld.id} label={`🏢 ${bld.name}`}>
                          {bFloors.map((f) => (
                            <option key={f.id} value={f.id}>
                              {bld.name ? `${bld.name} - ` : ""}{f.name} (Level {f.ordinal})
                            </option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Obstacle Mode</label>
                  <select
                    value={selectedObstacle.edgeIds && selectedObstacle.edgeIds.length > 0 ? "EDGE" : "AREA"}
                    onChange={(e) => {
                      if (e.target.value === "AREA") {
                        campusStore.updateObstacle(selectedObstacle.id, { edgeIds: undefined });
                      } else {
                        const firstEdgeId = storeData.edges[0]?.id ?? `e-blocked-${selectedObstacle.id}`;
                        campusStore.updateObstacle(selectedObstacle.id, { edgeIds: [firstEdgeId] });
                      }
                    }}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs font-semibold text-[rgb(var(--fg))] cursor-pointer focus:outline-none"
                  >
                    <option value="EDGE">Route-only (block a specific edge)</option>
                    <option value="AREA">Area Spatial Hazard (Radius px)</option>
                  </select>
                </div>

                {selectedObstacle.edgeIds && selectedObstacle.edgeIds.length > 0 && (
                  <div>
                    <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Blocked Route / Edge</label>
                    {storeData.edges.length > 0 ? (
                      <select
                        value={selectedObstacle.edgeIds[0] ?? storeData.edges[0].id}
                        onChange={(e) => campusStore.updateObstacle(selectedObstacle.id, { edgeIds: [e.target.value] })}
                        className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs font-medium text-[rgb(var(--fg))]"
                      >
                        {storeData.edges.map((edge) => {
                          const fn = storeData.nodes.find((n) => n.id === (edge.fromNodeId ?? edge.from));
                          const tn = storeData.nodes.find((n) => n.id === (edge.toNodeId ?? edge.to));
                          return (
                            <option key={edge.id} value={edge.id}>
                              {fn?.name || edge.from} ↔ {tn?.name || edge.to} ({edge.id})
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <Input
                        value={selectedObstacle.edgeIds[0] ?? "e1"}
                        onChange={(e) => campusStore.updateObstacle(selectedObstacle.id, { edgeIds: [e.target.value] })}
                        placeholder="e.g. e1, e-road-1"
                        className="h-8 text-xs bg-[rgb(var(--bg))]"
                      />
                    )}
                  </div>
                )}

                {(!selectedObstacle.edgeIds || selectedObstacle.edgeIds.length === 0) && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="font-medium">Hazard Radius ({selectedObstacle.radius} px)</label>
                      <span className="text-[10px] text-[rgb(var(--muted-fg))]">{selectedObstacle.radius}px</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={100}
                      step={5}
                      value={selectedObstacle.radius}
                      onChange={(e) => campusStore.updateObstacle(selectedObstacle.id, { radius: Number(e.target.value) })}
                      className="w-full h-1.5 bg-[rgb(var(--muted-2))] rounded-lg appearance-none cursor-pointer dark:bg-slate-700"
                    />
                  </div>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    campusStore.deleteObstacle(selectedObstacle.id);
                    setSelectedElement(null);
                  }}
                  className="w-full text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Obstacle
                </Button>
              </div>
            )}

            {/* Destination Inspector */}
            {selectedDest && (
              <div className="space-y-3 text-xs">
                <Badge variant="primary">{selectedDest.category}</Badge>
                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Room Name</label>
                  <Input
                    value={selectedDest.name}
                    onChange={(e) => campusStore.updateDestination(selectedDest.id, { name: e.target.value }, false)}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    campusStore.deleteDestination(selectedDest.id);
                    setSelectedElement(null);
                  }}
                  className="w-full text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Room
                </Button>
              </div>
            )}

            {/* Edge Inspector */}
            {selectedEdge && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="primary">{selectedEdge.type} Edge</Badge>
                  <Badge variant={getEdgePathType(selectedEdge) === "EV" ? "success" : "default"}>
                    {getEdgePathType(selectedEdge) === "EV" ? "EV Path" : "Walk only"}
                  </Badge>
                </div>

                <div>
                  <label className="mb-1 block font-medium">Edge Type</label>
                  <select
                    value={selectedEdge.type}
                    onChange={(e) => campusStore.updateEdge(selectedEdge.id, { type: e.target.value as any })}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                  >
                    <option value="WALK">WALK (Path / Corridor)</option>
                    <option value="ROAD">ROAD (Outdoor Street / Road)</option>
                    <option value="STAIRS">STAIRS (Vertical Flow)</option>
                    <option value="LIFT">LIFT (Elevator)</option>
                    <option value="RAMP">RAMP (Accessible Slope)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-medium">Path Type (Vehicle / Walking Access)</label>
                  <select
                    value={getEdgePathType(selectedEdge)}
                    onChange={(e) => campusStore.updateEdge(selectedEdge.id, { pathType: e.target.value as PathType })}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                  >
                    <option value="EV">EV Path (electric vehicle + walking)</option>
                    <option value="WALK">Only Walk Path (Walking only — EV prohibited)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-medium">Distance (Meters)</label>
                  <Input
                    type="number"
                    value={selectedEdge.distance}
                    onChange={(e) => campusStore.updateEdge(selectedEdge.id, { distance: Number(e.target.value) })}
                  />
                </div>

                <div className="rounded-md border bg-[rgb(var(--bg))] p-2.5 space-y-1 text-[11px] text-[rgb(var(--muted-fg))]">
                  <div>
                    From: <span className="font-semibold text-[rgb(var(--fg))]">{storeData.nodes.find((n) => n.id === selectedEdge.from)?.name || selectedEdge.from}</span>
                  </div>
                  <div>
                    To: <span className="font-semibold text-[rgb(var(--fg))]">{storeData.nodes.find((n) => n.id === selectedEdge.to)?.name || selectedEdge.to}</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    // Fix #6: Stop propagation and immediately clear selection
                    e.stopPropagation();
                    const edgeId = selectedEdge.id;
                    setSelectedElement(null);
                    campusStore.deleteEdge(edgeId);
                    toast({ type: "info", title: "Edge Deleted", description: "Connection removed from graph." });
                  }}
                  className="w-full text-red-500 hover:bg-red-500/10"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete Edge
                </Button>
              </div>
            )}

          </div>
        )}
      </div>



      {/* Simulator Drawer */}

      {activeTool === "SIMULATE" && (
        <div className="border-t bg-[rgb(var(--card))] p-4 space-y-3 text-xs">
          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <Navigation className="h-4 w-4 text-emerald-500" /> Interactive Dijkstra Route Simulator
            </h4>
            <div className="flex items-center gap-1 bg-[rgb(var(--muted)/0.5)] p-0.5 rounded-lg border">
              <button
                type="button"
                onClick={() => setSimTravelMode("WALK")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-bold transition-all",
                  simTravelMode === "WALK"
                    ? "bg-[rgb(var(--card))] text-[rgb(var(--fg))] shadow-xs"
                    : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
                )}
              >
                Walking
              </button>
              <button
                type="button"
                onClick={() => setSimTravelMode("EV")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[11px] font-bold transition-all",
                  simTravelMode === "EV"
                    ? "bg-emerald-600 text-white shadow-xs"
                    : "text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
                )}
              >
                EV Vehicle
              </button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block font-medium">Start Node</label>
              <select
                value={simStartNodeId}
                onChange={(e) => setSimStartNodeId(e.target.value)}
                className="w-full rounded border bg-[rgb(var(--bg))] p-2 text-xs"
              >
                <option value="">Select Start Node...</option>
                {allowedNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name ?? n.id} ({n.type})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block font-medium">Destination Node</label>
              <select
                value={simEndNodeId}
                onChange={(e) => setSimEndNodeId(e.target.value)}
                className="w-full rounded border bg-[rgb(var(--bg))] p-2 text-xs"
              >
                <option value="">Select Destination...</option>
                {allowedNodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name ?? n.id} ({n.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={handleRunSimulation} className="w-full bg-emerald-600 text-white">
                <Play className="mr-1.5 h-3.5 w-3.5" /> Test Route
              </Button>
            </div>
          </div>

          {simResult && (
            <div className="rounded bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center justify-between">
              <div>
                <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                  Shortest Route Found ({simResult.totalDistance} meters)
                </p>
                <p className="text-[11px] text-[rgb(var(--muted-fg))]">
                  Path passes through {simResult.nodes.length} nodes across campus.
                </p>
              </div>
              <Badge className="bg-emerald-600 text-white">{Math.round(simResult.totalDistance / 70)} min walk</Badge>
            </div>
          )}
        </div>
      )}

      {/* Diagnostics Panel Modal */}
      <AnimatePresence>
        {showDiagnosticsPanel && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="absolute top-16 right-4 w-96 max-h-[80vh] overflow-y-auto rounded-xl border bg-[rgb(var(--card))] p-4 shadow-2xl z-30 space-y-4"
          >
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-sm">Graph Review Diagnostics</h3>
                <p className="text-[11px] text-[rgb(var(--muted-fg))]">Real-time graph validation report</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowDiagnosticsPanel(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-lg bg-[rgb(var(--muted))]/50 p-3">
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-emerald-500" />
              </div>
              <Badge
                className={
                  validationReport.status === "EXCELLENT"
                    ? "bg-emerald-600 text-white"
                    : validationReport.status === "WARNINGS"
                      ? "bg-amber-600 text-white"
                      : "bg-red-600 text-white"
                }
              >
                {validationReport.status}
              </Badge>
            </div>

            <div className="space-y-2 text-xs">
              <h4 className="font-semibold text-[rgb(var(--fg))]">Validation Checks</h4>
              {validationReport.checks.map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded border p-2">
                  <span className="font-medium">{c.title}</span>
                  {c.passed ? (
                    <span className="flex items-center gap-1 text-emerald-500 font-semibold">
                      <Check className="h-3.5 w-3.5" /> Passed
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-red-500 font-semibold">
                      <X className="h-3.5 w-3.5" /> Failed
                    </span>
                  )}
                </div>
              ))}
            </div>

            {validationReport.issues.length > 0 && (
              <div className="space-y-2 text-xs border-t pt-3">
                <h4 className="font-semibold text-[rgb(var(--fg))]">
                  Issues Found ({validationReport.issues.length})
                </h4>
                {validationReport.issues.map((issue) => (
                  <div
                    key={issue.id}
                    onClick={() => {
                      if (issue.targetPos) zoomToPos(issue.targetPos.x, issue.targetPos.y, issue.targetPos.floorId);
                    }}
                    className="cursor-pointer rounded border border-red-500/30 bg-red-500/5 p-2.5 hover:bg-red-500/10 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-red-600 dark:text-red-400">{issue.title}</span>
                      <Badge variant="danger" className="text-[10px] border-red-500 text-red-500">
                        {issue.severity}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-[rgb(var(--muted-fg))]">{issue.description}</p>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>



      {/* Stair / Lift Group Manager Modal */}
      <AnimatePresence>
        {isVerticalModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="card w-full max-w-lg p-6 shadow-2xl border bg-[rgb(var(--card))]"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
                    <Layers className="h-4 w-4" />
                  </div>
                  <h3 className="text-base font-bold">Stair / Lift Group System</h3>
                </div>
                <button onClick={() => setIsVerticalModalOpen(false)} className="rounded p-1 hover:bg-[rgb(var(--muted))]">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                {(!verticalBuildingId || verticalSelectedFloorIds.length === 0) && (
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-2.5 text-amber-600 dark:text-amber-400 font-medium">
                    ⚠ Please select a building and at least 1 connected floor to create a group.
                  </div>
                )}

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Group Type *</label>
                  <select
                    value={verticalType}
                    onChange={(e) => {
                      const type = e.target.value as "STAIR" | "LIFT";
                      setVerticalType(type);
                      // Update name default based on selection
                      if (type === "STAIR") {
                        setVerticalName("Main Staircase A");
                      } else {
                        setVerticalName("Elevator 1");
                      }
                    }}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                  >
                    <option value="STAIR">Staircase Group</option>
                    <option value="LIFT">Elevator / Lift Group</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Name *</label>
                  <Input
                    placeholder={verticalType === "STAIR" ? "e.g. Main Staircase A, North Emergency Stairs..." : "e.g. Passenger Elevator 1, West Wing Lift..."}
                    value={verticalName}
                    onChange={(e) => setVerticalName(e.target.value)}
                  />
                </div>

                <div>
                  <label className="mb-1 block font-semibold text-[rgb(var(--fg))]">Building *</label>
                  <select
                    value={verticalBuildingId}
                    onChange={(e) => {
                      setVerticalBuildingId(e.target.value);
                      const bFloors = storeData.floors.filter((f) => f.buildingId === e.target.value);
                      setVerticalSelectedFloorIds(bFloors.map((f) => f.id));
                    }}
                    className="w-full rounded-md border bg-[rgb(var(--bg))] p-2 text-xs text-[rgb(var(--fg))]"
                  >
                    <option value="">-- Choose Building --</option>
                    {storeData.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block font-semibold text-[rgb(var(--fg))]">Select Connected/Served Floors *</label>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 rounded-lg border p-3 bg-[rgb(var(--muted))]/20">
                    {storeData.floors.filter((f) => !verticalBuildingId || f.buildingId === verticalBuildingId).length === 0 ? (
                      <p className="text-[11px] text-[rgb(var(--muted-fg))] italic">No floors found for this building. Add a floor first in the Building Inspector.</p>
                    ) : (
                      storeData.floors
                        .filter((f) => !verticalBuildingId || f.buildingId === verticalBuildingId)
                        .sort((a, b) => a.ordinal - b.ordinal)
                        .map((fl) => {
                          const checked = verticalSelectedFloorIds.includes(fl.id);
                          return (
                            <label key={fl.id} className="flex items-center gap-2 cursor-pointer hover:text-[rgb(var(--fg))]">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) setVerticalSelectedFloorIds((prev) => [...prev, fl.id]);
                                  else setVerticalSelectedFloorIds((prev) => prev.filter((id) => id !== fl.id));
                                }}
                                className={`rounded focus:ring-2 ${verticalType === "STAIR" ? "text-indigo-600 focus:ring-indigo-500" : "text-blue-600 focus:ring-blue-500"}`}
                              />
                              <span className="font-semibold">{fl.name}</span>
                              <span className="text-[10px] text-[rgb(var(--muted-fg))]">(Level {fl.ordinal})</span>
                            </label>
                          );
                        })
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 mt-6">
                <Button variant="outline" size="sm" onClick={() => setIsVerticalModalOpen(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (!verticalBuildingId || verticalSelectedFloorIds.length < 1) {
                      toast({ type: "error", title: "Select Floors", description: "Select a building and at least 1 connected floor." });
                      return;
                    }
                    setPendingVerticalConnection({
                      type: verticalType,
                      name: verticalName,
                      buildingId: verticalBuildingId,
                      selectedFloorIds: verticalSelectedFloorIds,
                    });
                    setActiveTool("PLACE_VERTICAL");
                    setIsVerticalModalOpen(false);
                    toast({
                      type: "info",
                      title: "Placement Mode Active",
                      description: `Click on the graph canvas to place the ${verticalType === "STAIR" ? "Staircase" : "Elevator"} Group.`,
                    });
                  }}
                  className={verticalType === "STAIR" ? "bg-indigo-600 text-white hover:bg-indigo-700" : "bg-blue-600 text-white hover:bg-blue-700"}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" /> Place {verticalType === "STAIR" ? "Staircase" : "Elevator"} Group
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>





      {/* Delete All Confirmation Modal (Preserves Fullscreen) */}
      <AnimatePresence>
        {isDeleteAllModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-xl border border-red-500/30 bg-[rgb(var(--card))] p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3 text-red-500">
                <div className="rounded-full bg-red-500/10 p-2">
                  <Trash2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-[rgb(var(--fg))]">Confirm Delete All</h3>
                  <p className="text-xs text-[rgb(var(--muted-fg))]">Bulk Graph Reset</p>
                </div>
              </div>

              <p className="text-xs text-[rgb(var(--fg))]/90 leading-relaxed font-medium">
                Are you sure you want to delete ALL elements (buildings, floors, nodes, edges, obstacles, events, doors, corridors, etc.) from the digital twin graph?
              </p>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[rgb(var(--border))]">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsDeleteAllModalOpen(false)}
                  className="h-8 px-3 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={confirmDeleteAll}
                  className="h-8 px-4 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-md"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Confirm Delete All
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Editor Action History Timeline Modal */}
      <AnimatePresence>
        {showHistoryModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-6 shadow-2xl space-y-4 text-xs max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between border-b border-[rgb(var(--border))] pb-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:text-purple-400">
                    <History className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[rgb(var(--fg))]">Action History Timeline</h3>
                    <p className="text-xs text-[rgb(var(--muted-fg))]">Jump to any previous edit or redo reverted steps</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowHistoryModal(false)}
                  className="rounded-lg p-1 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Undo Stack List */}
                <div className="space-y-2">
                  <h4 className="font-bold text-xs text-[rgb(var(--fg))] flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Undo2 className="h-3.5 w-3.5 text-amber-500" /> Undoable Actions ({campusStore.getUndoCount()})
                    </span>
                    <span className="text-[10px] text-[rgb(var(--muted-fg))]">Click item to jump to step</span>
                  </h4>

                  <div className="max-h-56 overflow-y-auto space-y-1.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2">
                    {campusStore.getUndoHistory().length === 0 ? (
                      <p className="text-[11px] text-[rgb(var(--muted-fg))] italic text-center py-4">
                        No undo history available yet. Make edits on the graph canvas to populate history.
                      </p>
                    ) : (
                      campusStore
                        .getUndoHistory()
                        .slice()
                        .reverse()
                        .map((entry, idx, arr) => {
                          const stepNum = arr.length - idx;
                          return (
                            <div
                              key={entry.id}
                              onClick={() => {
                                const desc = campusStore.jumpToUndoStep(stepNum);
                                setStoreData(campusStore.getWorkingData());
                                setPendingChanges([...campusStore.getPendingChanges()]);
                                toast({
                                  type: "info",
                                  title: "Jumped in History",
                                  description: `Reverted back to step #${stepNum}: "${desc ?? entry.description}".`,
                                });
                              }}
                              className="group flex items-center justify-between rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-2 cursor-pointer hover:border-amber-500/50 hover:bg-amber-500/5 transition-all"
                            >
                              <div className="flex items-center gap-2 max-w-[75%]">
                                <Badge variant="warning" className="text-[10px] font-bold px-1.5 py-0 shrink-0">
                                  #{stepNum}
                                </Badge>
                                <span className="font-medium text-[rgb(var(--fg))] truncate">{entry.description}</span>
                              </div>
                              <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 group-hover:underline shrink-0">
                                Jump to step
                              </span>
                            </div>
                          );
                        })
                    )}
                  </div>
                </div>

                {/* Redo Stack List */}
                {campusStore.getRedoCount() > 0 && (
                  <div className="space-y-2 pt-2 border-t border-[rgb(var(--border))]">
                    <h4 className="font-bold text-xs text-[rgb(var(--fg))] flex items-center gap-1.5">
                      <Redo2 className="h-3.5 w-3.5 text-blue-500" /> Redoable Actions ({campusStore.getRedoCount()})
                    </h4>
                    <div className="max-h-36 overflow-y-auto space-y-1.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2">
                      {campusStore
                        .getRedoHistory()
                        .slice()
                        .reverse()
                        .map((entry) => (
                          <div
                            key={entry.id}
                            onClick={() => {
                              handleRedo();
                            }}
                            className="flex items-center justify-between rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-2 cursor-pointer hover:border-blue-500/50 hover:bg-blue-500/5 transition-all"
                          >
                            <span className="font-medium text-[rgb(var(--fg))] truncate max-w-[75%]">{entry.description}</span>
                            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">Redo Step</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end pt-2 border-t border-[rgb(var(--border))]">
                  <Button size="sm" variant="outline" onClick={() => setShowHistoryModal(false)}>
                    Close History
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Rename Modal */}
      <AnimatePresence>
        {isRenameModalOpen && selectedElement && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-sm rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-5 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between border-b pb-2">
                <h3 className="font-bold text-sm text-[rgb(var(--fg))]">
                  Rename {selectedElement.type.charAt(0).toUpperCase() + selectedElement.type.slice(1)}
                </h3>
                <button
                  onClick={() => setIsRenameModalOpen(false)}
                  className="rounded-lg p-1 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-[rgb(var(--muted-fg))]">Name</label>
                  <Input
                    autoFocus
                    placeholder="Enter new name..."
                    value={renameInputValue}
                    onChange={(e) => setRenameInputValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(); }}
                    className="mt-1.5 h-9 w-full text-xs"
                  />
                </div>

              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setIsRenameModalOpen(false)}
                  className="h-8 px-3 text-xs"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleRenameSubmit}
                  className="h-8 px-4 text-xs font-semibold bg-[rgb(var(--primary))] text-white shadow-md"
                >
                  Save Changes
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Interactive Edge Creation Modal with REQUIRED Path Type selection */}
      {pendingEdgeModal && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))] font-bold">
                  <Share2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[rgb(var(--fg))]">Create Edge Connection</h3>
                  <p className="text-[11px] text-[rgb(var(--muted-fg))]">Configure path properties between selected nodes</p>
                </div>
              </div>
              <button
                onClick={() => setPendingEdgeModal(null)}
                className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="rounded-xl border bg-[rgb(var(--bg))] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[rgb(var(--muted-fg))]">From Node:</span>
                  <span className="font-bold text-[rgb(var(--fg))]">
                    {storeData.nodes.find((n) => n.id === pendingEdgeModal.startNodeId)?.name || pendingEdgeModal.startNodeId}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-[rgb(var(--muted-fg))]">To Node:</span>
                  <span className="font-bold text-[rgb(var(--fg))]">
                    {storeData.nodes.find((n) => n.id === pendingEdgeModal.endNodeId)?.name || pendingEdgeModal.endNodeId}
                  </span>
                </div>
                <div className="flex items-center justify-between pt-1.5 border-t">
                  <span className="font-semibold text-[rgb(var(--muted-fg))]">Calculated Distance:</span>
                  <span className="font-bold text-[rgb(var(--primary))] font-mono">{pendingEdgeModal.dist} meters</span>
                </div>
              </div>

              <div>
                <label className="font-bold text-[rgb(var(--fg))] block mb-1.5">Edge Type</label>
                <select
                  value={edgeModalType}
                  onChange={(e) => setEdgeModalType(e.target.value as EdgeType)}
                  className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-xs font-medium"
                >
                  <option value="WALK">WALK (Pedestrian Walkway)</option>
                  <option value="ROAD">ROAD (Outdoor Street / Road)</option>
                  <option value="STAIRS">STAIRS (Vertical Stairs)</option>
                  <option value="LIFT">LIFT (Elevator)</option>
                  <option value="RAMP">RAMP (Accessible Slope)</option>
                  <option value="ESCALATOR">ESCALATOR</option>
                </select>
              </div>

              {/* REQUIRED Path Type Selection */}
              <div>
                <label className="font-bold text-[rgb(var(--fg))] block mb-1.5">
                  Path Type <span className="text-red-500">* (Required)</span>
                </label>
                <div className="grid grid-cols-1 gap-2.5">
                  <label
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                      edgeModalPathType === "EV"
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500 shadow-xs"
                        : "border-[rgb(var(--border))] bg-[rgb(var(--bg))] hover:bg-[rgb(var(--muted)/0.5)]"
                    )}
                  >
                    <input
                      type="radio"
                      name="cadModalEdgePathType"
                      value="EV"
                      checked={edgeModalPathType === "EV"}
                      onChange={() => setEdgeModalPathType("EV")}
                      className="mt-0.5 h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <div className="font-bold text-xs flex items-center gap-1.5 text-[rgb(var(--fg))]">
                        EV Path
                      </div>
                      <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                        Electric vehicle + walking allowed
                      </p>
                    </div>
                  </label>

                  <label
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                      edgeModalPathType === "WALK"
                        ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500 shadow-xs"
                        : "border-[rgb(var(--border))] bg-[rgb(var(--bg))] hover:bg-[rgb(var(--muted)/0.5)]"
                    )}
                  >
                    <input
                      type="radio"
                      name="cadModalEdgePathType"
                      value="WALK"
                      checked={edgeModalPathType === "WALK"}
                      onChange={() => setEdgeModalPathType("WALK")}
                      className="mt-0.5 h-4 w-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <div className="font-bold text-xs flex items-center gap-1.5 text-[rgb(var(--fg))]">
                        Only Walk Path
                      </div>
                      <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                        Walking only — EV prohibited
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t">
              <Button variant="outline" size="sm" onClick={() => setPendingEdgeModal(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!edgeModalPathType) {
                    toast({
                      type: "error",
                      title: "Path Type Required",
                      description: "Please select EV Path or Only Walk Path.",
                    });
                    return;
                  }
                  const result = campusStore.addEdge({
                    id: generateShortId("e", storeData.edges.map((e) => e.id)),
                    from: pendingEdgeModal.startNodeId,
                    to: pendingEdgeModal.endNodeId,
                    type: edgeModalType,
                    pathType: edgeModalPathType,
                    distance: pendingEdgeModal.dist,
                    bidirectional: true,
                  });

                  if (result.success) {
                    toast({
                      type: "success",
                      title: "Edge Connected",
                      description: `Connected ${edgeModalType} (${edgeModalPathType === "EV" ? "EV Path" : "Only Walk Path"}, ${pendingEdgeModal.dist}m).`,
                    });
                    setPendingEdgeModal(null);
                  } else {
                    toast({
                      type: "error",
                      title: "Duplicate Edge",
                      description: result.error ?? "Connection already exists.",
                    });
                  }
                }}
              >
                Create Edge
              </Button>
            </div>
          </div>
        </div>
      )}



      {/* Publish Review Modal */}
      <PublishModal open={showPublishModal} onClose={() => setShowPublishModal(false)} />

      {/* Selective Node Reference Photo Viewer Modal */}
      {viewingPhotoNode && (
        <div className="fixed inset-0 w-screen h-screen min-w-full min-h-full z-[100000] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs animate-in fade-in duration-200 overflow-hidden select-none">
          <div className="relative w-full max-w-lg rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div className="flex items-center gap-2">
                <Camera className="h-5 w-5 text-[rgb(var(--primary))]" />
                <div>
                  <h3 className="font-bold text-base text-[rgb(var(--fg))]">{viewingPhotoNode.name}</h3>
                  <p className="text-[11px] text-[rgb(var(--muted-fg))] font-mono">Node ID: {viewingPhotoNode.id}</p>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setViewingPhotoNode(null)} className="h-8 w-8 p-0">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="relative w-full overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-transparent flex items-center justify-center">
              <img
                src={viewingPhotoNode.photoUrl}
                alt={`Reference for ${viewingPhotoNode.name}`}
                className="w-full h-auto max-h-[70vh] object-contain rounded-xl"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[rgb(var(--muted-fg))] border-t pt-3">
              <div className="space-y-0.5">
                {viewingPhotoNode.lat !== undefined && viewingPhotoNode.lng !== undefined && (
                  <div className="font-mono text-[11px]">GPS: {viewingPhotoNode.lat.toFixed(7)}, {viewingPhotoNode.lng.toFixed(7)}</div>
                )}
              </div>
              {viewingPhotoNode.physicalVerified && (
                <Badge className="bg-emerald-600 text-white flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Physically Verified
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between border-t pt-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (!viewingPhotoNode) return;
                  campusStore.updateNode(viewingPhotoNode.id, {
                    photoUrl: undefined,
                    photoUploadedAt: undefined,
                    physicalVerified: false,
                  });
                  fetch(`/api/nodes/${viewingPhotoNode.id}/photo`, { method: "DELETE" }).catch(() => {});
                  toast({
                    type: "info",
                    title: "Photo Deleted",
                    description: `Removed photo from ${viewingPhotoNode.name}. The node remains intact.`,
                  });
                  setViewingPhotoNode(null);
                }}
                className="text-red-500 border-red-500/30 hover:bg-red-500/10 gap-1.5"
              >
                <Trash2 className="h-4 w-4" /> Delete Photo Only
              </Button>
              <Button size="sm" onClick={() => setViewingPhotoNode(null)} className="bg-[rgb(var(--primary))] text-white px-5">
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolButton({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  // These are always lucide icons. `React.ElementType` includes intrinsic tags,
  // which collapses the className prop to `never`.
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-xs font-semibold whitespace-nowrap shrink-0 transition-all select-none ${active
          ? "bg-[rgb(var(--primary))] text-white shadow-sm ring-1 ring-[rgb(var(--primary))]"
          : "text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))]"
        }`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="whitespace-nowrap leading-none">{label}</span>
    </button>
  );
}
