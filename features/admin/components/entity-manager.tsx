"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import Link from "next/link";
import { cn } from "@/shared/lib/utils";
import {
  Building2,
  Layers,
  DoorOpen,
  Waypoints,
  GitFork,
  Footprints,
  AlertTriangle,
  Compass,
  Search,
  Plus,
  Trash2,
  Edit3,
  CheckCircle2,
  ArrowRight,
  Split,
  MapPin,
  Eye,
  Sparkles,
  RefreshCw,
  Sliders,
  Maximize2,
  Minimize2,
  Undo2,
  Redo2,
  X,
  CheckSquare,
  Square,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Copy,
  ClipboardPaste,
  Check,
  Download,
  Upload,
  Rocket,
  Camera,
  RotateCcw,
  Hash,
} from "lucide-react";
import { PublishModal } from "@/shared/components/publish-modal";
import { campusStore } from "@/shared/lib/campus-store";
import { gpsToCanvas, canvasToGps, getCenterFromCorners } from "@/lib/geo/projection";
import { getBuildingCorners, validatePolygonCorners, type BuildingCorner } from "@/lib/geo/building-geometry";
import { calculateHaversineDistance } from "@/lib/geo/haversine";
import { calculateEdgePathSplit } from "@/lib/geo/edge-splitting";
import { Card } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Badge } from "@/shared/components/ui/badge";
import { useToast } from "@/shared/components/ui/toast";
import { generateShortId } from "@/shared/lib/id-generator";
import type {
  Building as BuildingType,
  Node,
  Destination,
  NodeType,
  EdgeType,
  PathType,
} from "@/shared/data/campus";
import { getEdgePathType, getPathTypeLabel } from "@/lib/routing/edge-accessibility";

export type EntityCategory =
  | "BUILDING"
  | "FLOOR"
  | "ROOM"
  | "NODE"
  | "EDGE"
  | "STAIR"
  | "LIFT"
  | "OBSTACLE"
  | "PHOTO";

const ENTITY_TYPES: { type: EntityCategory; label: string; icon: any; description: string; badgeColor: string }[] = [
  { type: "BUILDING", label: "Building", icon: Building2, description: "Campus building structure & 4-corner GPS boundary", badgeColor: "from-blue-500 to-indigo-600" },
  { type: "NODE", label: "Navigation Node", icon: Waypoints, description: "Path waypoint, junction, or entrance point", badgeColor: "from-violet-500 to-purple-600" },
  { type: "EDGE", label: "Connection Edge", icon: GitFork, description: "Path segment with auto distance & smart splitting", badgeColor: "from-amber-500 to-orange-600" },
  { type: "ROOM", label: "Room (Destination)", icon: DoorOpen, description: "Searchable classroom, lab, or office destination", badgeColor: "from-emerald-500 to-teal-600" },
  { type: "OBSTACLE", label: "Obstacle / Hazard", icon: AlertTriangle, description: "Temporary hazard blocking routing paths", badgeColor: "from-red-500 to-orange-600" },
  { type: "PHOTO", label: "Add Photo", icon: Camera, description: "Select a node and attach/manage reference photo", badgeColor: "from-emerald-500 to-teal-600" },
  { type: "STAIR", label: "Staircase", icon: Footprints, description: "Multi-floor stair group connecting building floors", badgeColor: "from-pink-500 to-rose-600" },
  { type: "LIFT", label: "Lift / Elevator", icon: RefreshCw, description: "Vertical elevator serving selected building floors", badgeColor: "from-sky-500 to-blue-600" },
  { type: "FLOOR", label: "Floor", icon: Layers, description: "Vertical building floor level & ordinal", badgeColor: "from-cyan-500 to-blue-600" },
];

export function deriveBuildingShortCode(name: string, category?: string): string {
  if (category && category.trim()) {
    return category.trim().toUpperCase().slice(0, 6);
  }
  const clean = name.trim();
  if (!clean) return "BLD";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const acronym = words.map((w) => w[0]).join("").toUpperCase();
    if (acronym.length >= 2 && acronym.length <= 6) return acronym;
  }
  return clean.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "BLD";
}

export function compressImageForUpload(file: File, maxDimension = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = (evt) => resolve((evt.target?.result as string) || "");
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => resolve("");
    reader.onload = (evt) => {
      const img = new Image();
      img.onerror = () => resolve((evt.target?.result as string) || "");
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve((evt.target?.result as string) || "");
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const format = file.type === "image/png" ? "image/jpeg" : (file.type || "image/jpeg");
        const compressedDataUrl = canvas.toDataURL(format, quality);
        resolve(compressedDataUrl);
      };
      img.src = (evt.target?.result as string) || "";
    };
    reader.readAsDataURL(file);
  });
}

export function EntityManager() {
  const { toast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const [storeData, setStoreData] = useState(() => campusStore.getWorkingData());
  const [selectedType, setSelectedType] = useState<EntityCategory>("BUILDING");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<EntityCategory | "ALL">("ALL");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showMobilePanel, setShowMobilePanel] = useState(false);
  const [showPublishModal, setShowPublishModal] = useState(false);

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());

  // Selective Node Reference Photo State & Filters
  const [nodePhotoFilter, setNodePhotoFilter] = useState<"ALL" | "WITH_PHOTO" | "WITHOUT_PHOTO">("ALL");
  const [viewingPhotoNode, setViewingPhotoNode] = useState<{ id: string; name: string; photoUrl: string; floorName?: string; lat?: number; lng?: number; physicalVerified?: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const nodePhotoInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadWholeData = () => {
    const data = campusStore.getWorkingData();
    const exportPayload = {
      appName: "CampusNav Digital Twin System",
      version: "2.0.0",
      exportedAt: new Date().toISOString(),
      exportedTimestamp: Date.now(),
      snapshot: {
        buildings: data.buildings || [],
        floors: data.floors || [],
        nodes: data.nodes || [],
        edges: data.edges || [],
        destinations: data.destinations || [],
        events: data.events || [],
        obstacles: data.obstacles || [],
        stairGroups: data.stairGroups || [],
        liftGroups: data.liftGroups || [],
        doors: data.doors || [],
      },
      meta: {
        totalBuildings: data.buildings?.length || 0,
        totalFloors: data.floors?.length || 0,
        totalNodes: data.nodes?.length || 0,
        totalEdges: data.edges?.length || 0,
        totalDestinations: data.destinations?.length || 0,
        totalObstacles: data.obstacles?.length || 0,
        totalDoors: data.doors?.length || 0,
      },
    };

    const jsonString = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `campusnav_whole_data_${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      type: "success",
      title: "Whole Data Downloaded!",
      description: `Exported complete dataset (${exportPayload.meta.totalBuildings} blds, ${exportPayload.meta.totalNodes} nodes, ${exportPayload.meta.totalEdges} edges).`,
    });
  };

  const handleTriggerWholeDataInput = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleWholeDataInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (!content) return;

        const parsed = JSON.parse(content);
        const ok = campusStore.importFullData(parsed);

        if (ok) {
          setStoreData(campusStore.getWorkingData());
          setSelectedRowIds(new Set());
          const snapshot = parsed.snapshot || parsed;
          const bldCount = snapshot.buildings?.length || 0;
          const nodeCount = snapshot.nodes?.length || 0;
          const edgeCount = snapshot.edges?.length || 0;

          toast({
            type: "success",
            title: "Whole Data Feed Successful!",
            description: `Imported full campus graph dataset (${bldCount} buildings, ${nodeCount} nodes, ${edgeCount} edges).`,
          });
        } else {
          toast({
            type: "error",
            title: "Data Feed Failed",
            description: "JSON file format is missing required campus snapshot data structure.",
          });
        }
      } catch (err: unknown) {
        toast({ type: "error", title: "Import Failed", description: err instanceof Error ? err.message : String(err) });
      }
    };
    reader.readAsText(file);
  };

  const handlePhotoFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      toast({
        type: "error",
        title: "Invalid File Type",
        description: "Please select a valid image file (JPG, PNG, WebP, GIF, or SVG).",
      });
      return;
    }

    try {
      const compressedUrl = await compressImageForUpload(file);
      if (compressedUrl) {
        setEditForm((prev) => ({
          ...prev,
          photoUrl: compressedUrl,
          photoUploadedAt: new Date().toISOString(),
        }));
        toast({
          type: "success",
          title: "Reference Photo Attached",
          description: "Reference photo optimized and attached. Save changes to persist.",
        });
      }
    } catch {
      toast({
        type: "error",
        title: "Image Processing Error",
        description: "Could not process selected image.",
      });
    }
  };

  const handleConfirmRemovePhoto = () => {
    if (window.confirm("Are you sure you want to remove the reference photo from this node? The node and its GPS coordinates will be preserved.")) {
      setEditForm((prev) => ({
        ...prev,
        photoUrl: "",
        photoUploadedAt: "",
      }));
      toast({
        type: "info",
        title: "Photo Removed",
        description: "Reference photo cleared. Save changes to persist.",
      });
    }
  };

  // Copied Entity State for Copy / Paste Workflow
  const [copiedEntityPayload, setCopiedEntityPayload] = useState<{ category: EntityCategory; name: string; [key: string]: any } | null>(null);
  const [copiedRowId, setCopiedRowId] = useState<string | null>(null);

  // Existing Node Visibility Management State
  const [existingNodeSearchText, setExistingNodeSearchText] = useState("");
  const [existingSelectedNodeId, setExistingSelectedNodeId] = useState("");
  const [existingNodeVisibleToUser, setExistingNodeVisibleToUser] = useState(false);
  const [isNodeSearchOpen, setIsNodeSearchOpen] = useState(false);
  const nodeSearchContainerRef = useRef<HTMLDivElement>(null);

  // Close combobox popover on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        nodeSearchContainerRef.current &&
        !nodeSearchContainerRef.current.contains(event.target as globalThis.Node)
      ) {
        setIsNodeSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredExistingNodesForVisibility = useMemo(() => {
    const q = existingNodeSearchText.trim().toLowerCase();
    return storeData.nodes.filter((n) => {
      if (!q) return true;
      return (
        (n.name && n.name.toLowerCase().includes(q)) ||
        n.id.toLowerCase().includes(q) ||
        (n.floorId && n.floorId.toLowerCase().includes(q)) ||
        (n.type && n.type.toLowerCase().includes(q))
      );
    });
  }, [storeData.nodes, existingNodeSearchText]);

  const handleSelectNodeItem = (node: Node) => {
    setExistingSelectedNodeId(node.id);
    setExistingNodeSearchText(node.name || node.id);
    setExistingNodeVisibleToUser(node.visibleToUser !== undefined ? node.visibleToUser : false);
    setIsNodeSearchOpen(false);
  };

  const handleApplyExistingNodeVisibility = () => {
    if (!existingSelectedNodeId) {
      toast({ type: "error", title: "No Node Selected", description: "Please type and select an existing node first." });
      return;
    }
    const found = storeData.nodes.find((n) => n.id === existingSelectedNodeId);
    if (!found) {
      toast({ type: "error", title: "Node Not Found", description: "The selected node was not found in the campus graph." });
      return;
    }

    campusStore.updateNode(existingSelectedNodeId, {
      visibleToUser: existingNodeVisibleToUser,
    });

    toast({
      type: "success",
      title: "Node Visibility Updated",
      description: `Node "${found.name || found.id}" is now set to Visible: ${existingNodeVisibleToUser ? "YES" : "NO"}!`,
    });

    setStoreData({ ...campusStore.getWorkingData() });
  };

  // Edit Object Modal State
  const [editingItem, setEditingItem] = useState<{ id: string; category: EntityCategory; name: string; raw: any } | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    category: "",
    shortCode: "",
    roomNumber: "",
    nodeType: "CORRIDOR" as NodeType,
    description: "",
    floorsCount: 0,
    ordinal: 0,
    buildingId: "",
    floorId: "",
    selectedFloorIds: [] as string[],
    severity: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    radius: 10,
    lat: "11.",
    lng: "77.",
    corners: [] as Array<{ lat: string; lng: string }>,
    corner1Lat: "11.",
    corner1Lng: "77.",
    corner2Lat: "11.",
    corner2Lng: "77.",
    corner3Lat: "11.",
    corner3Lng: "77.",
    corner4Lat: "11.",
    corner4Lng: "77.",
    firstNodeId: "",
    secondNodeId: "",
    edgeType: "WALK" as EdgeType,
    pathType: "WALK" as PathType,
    distance: 0,
    accessible: true,
    visibleToUser: true,
    expiresAt: "",
    photoUrl: "",
    photoUploadedAt: "",
    physicalVerified: false,
  });

  // Subscribe to live campus store updates
  useEffect(() => {
    const updateStoreState = () => setStoreData({ ...campusStore.getWorkingData() });
    updateStoreState();
    const unsubscribe = campusStore.subscribe(updateStoreState);
    return unsubscribe;
  }, []);

  // Keyboard Shortcuts for Undo (Ctrl+Z) & Redo (Ctrl+Y)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleUndo = () => {
    if (!campusStore.canUndo()) return;
    const res = campusStore.undo();
    if (res.success) {
      toast({ type: "info", title: "Undo Applied", description: res.description || "Reverted last change." });
    }
  };

  const handleRedo = () => {
    if (!campusStore.canRedo()) return;
    const res = campusStore.redo();
    if (res.success) {
      toast({ type: "info", title: "Redo Applied", description: res.description || "Re-applied change." });
    }
  };

  // Handle Fullscreen Toggle using Browser Native Fullscreen API to hide Chrome browser tabs & top address bar
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
      setStoreData(campusStore.getWorkingData());
      setSelectedRowIds(new Set());
      toast({
        type: "success",
        title: "Entities Refreshed",
        description: "Campus data re-synchronized from PostgreSQL server database.",
      });
    } catch (e) {
      console.warn("Notice during database refresh:", e);
    } finally {
      setIsRefreshing(false);
    }
  };

  // Sync fullscreen state with native browser fullscreenchange events
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
        sessionStorage.setItem("entity_manager_fullscreen_active", String(isNativeFS));
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

  // ---------------------------------------------------------------------------
  // DYNAMIC FORM STATES
  // ---------------------------------------------------------------------------

  const [buildingForm, setBuildingForm] = useState({
    name: "",
    category: "",
    description: "",
    floorsCount: 3,
    corners: [
      { lat: "11.", lng: "77." },
      { lat: "11.", lng: "77." },
      { lat: "11.", lng: "77." },
      { lat: "11.", lng: "77." },
    ],
  });

  const handleAddBuildingCorner = () => {
    setBuildingForm((prev) => ({
      ...prev,
      corners: [...(prev.corners || []), { lat: "11.", lng: "77." }],
    }));
  };

  const handleRemoveBuildingCorner = (index: number) => {
    if (buildingForm.corners.length <= 3) return;
    setBuildingForm((prev) => ({
      ...prev,
      corners: prev.corners.filter((_, i) => i !== index),
    }));
  };

  const handleUpdateBuildingCorner = (index: number, field: "lat" | "lng", val: string) => {
    setBuildingForm((prev) => {
      const nextCorners = [...prev.corners];
      nextCorners[index] = { ...nextCorners[index], [field]: val };
      return { ...prev, corners: nextCorners };
    });
  };

  const handleAddEditBuildingCorner = () => {
    setEditForm((prev: any) => ({
      ...prev,
      corners: [...(prev.corners || []), { lat: "11.", lng: "77." }],
    }));
  };

  const handleRemoveEditBuildingCorner = (index: number) => {
    setEditForm((prev: any) => {
      const corners = prev.corners || [];
      if (corners.length <= 3) return prev;
      return {
        ...prev,
        corners: corners.filter((_: any, i: number) => i !== index),
      };
    });
  };

  const handleUpdateEditBuildingCorner = (index: number, field: "lat" | "lng", val: string) => {
    setEditForm((prev: any) => {
      const nextCorners = [...(prev.corners || [])];
      nextCorners[index] = { ...nextCorners[index], [field]: val };
      return { ...prev, corners: nextCorners };
    });
  };

  const [nodeForm, setNodeForm] = useState({
    name: "",
    lat: "11.",
    lng: "77.",
    buildingId: "",
    floorId: "",
    type: "CORRIDOR" as NodeType,
    accessible: true,
    visibleToUser: true,
    description: "",
  });

  const [roomForm, setRoomForm] = useState({
    name: "",
    roomNumber: "",
    buildingId: "",
    floorId: "",
    category: "Classroom",
    lat: "11.",
    lng: "77.",
    description: "",
  });

  const [stairForm, setStairForm] = useState({
    name: "",
    buildingId: "",
    selectedFloorIds: [] as string[],
    lat: "11.",
    lng: "77.",
  });

  const [liftForm, setLiftForm] = useState({
    name: "",
    buildingId: "",
    selectedFloorIds: [] as string[],
    lat: "11.",
    lng: "77.",
  });

  const [obstacleForm, setObstacleForm] = useState({
    name: "",
    obstacleType: "MEDIUM" as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    lat: "11.",
    lng: "77.",
    radius: 10,
    startTime: "",
    endTime: "",
  });

  const [edgeForm, setEdgeForm] = useState({
    firstNodeId: "",
    secondNodeId: "",
    edgeType: "WALK" as EdgeType,
    pathType: "" as PathType | "",
    toleranceMeters: 5,
  });

  const [floorForm, setFloorForm] = useState({
    buildingId: "",
    name: "",
    ordinal: 1,
  });

  // Sync building floors selection for Stair and Lift forms
  useEffect(() => {
    if (storeData.buildings.length > 0) {
      const defaultBld = storeData.buildings[0].id;
      if (!stairForm.buildingId) {
        const bldFloors = storeData.floors.filter((f) => f.buildingId === defaultBld).map((f) => f.id);
        setStairForm((prev) => ({ ...prev, buildingId: defaultBld, selectedFloorIds: bldFloors }));
      }
      if (!liftForm.buildingId) {
        const bldFloors = storeData.floors.filter((f) => f.buildingId === defaultBld).map((f) => f.id);
        setLiftForm((prev) => ({ ...prev, buildingId: defaultBld, selectedFloorIds: bldFloors }));
      }
      if (!nodeForm.buildingId) {
        const bldFloors = storeData.floors.filter((f) => f.buildingId === defaultBld);
        setNodeForm((prev) => ({ ...prev, buildingId: defaultBld, floorId: bldFloors[0]?.id || "" }));
        setRoomForm((prev) => ({ ...prev, buildingId: defaultBld, floorId: bldFloors[0]?.id || "" }));
        setFloorForm((prev) => ({ ...prev, buildingId: defaultBld }));
      }
    }
  }, [storeData]);

  const handleStairBuildingChange = (bldId: string) => {
    const bldFloors = storeData.floors.filter((f) => f.buildingId === bldId).map((f) => f.id);
    setStairForm((prev) => ({ ...prev, buildingId: bldId, selectedFloorIds: bldFloors }));
  };

  const handleLiftBuildingChange = (bldId: string) => {
    const bldFloors = storeData.floors.filter((f) => f.buildingId === bldId).map((f) => f.id);
    setLiftForm((prev) => ({ ...prev, buildingId: bldId, selectedFloorIds: bldFloors }));
  };

  // Dedicated Add Photo Management Form State
  const [photoManagerNodeId, setPhotoManagerNodeId] = useState("");
  const [photoManagerFile, setPhotoManagerFile] = useState("");
  const [photoManagerPhysicalVerified, setPhotoManagerPhysicalVerified] = useState(false);
  const [photoNodeSearchQuery, setPhotoNodeSearchQuery] = useState("");
  const [isNodeDropdownOpen, setIsNodeDropdownOpen] = useState(false);
  const nodeDropdownRef = useRef<HTMLDivElement>(null);
  const dedicatedPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (nodeDropdownRef.current && !nodeDropdownRef.current.contains(e.target as HTMLElement)) {
        setIsNodeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedPhotoNode = useMemo(() => {
    return storeData.nodes.find((n) => n.id === photoManagerNodeId) || null;
  }, [storeData.nodes, photoManagerNodeId]);

  const filteredPhotoNodes = useMemo(() => {
    const q = photoNodeSearchQuery.toLowerCase().trim();
    if (!q) return storeData.nodes;
    return storeData.nodes.filter((n) => {
      const fl = storeData.floors.find((f) => f.id === n.floorId);
      const floorName = fl?.name || (n.floorId === "f-out" ? "Outdoor" : n.floorId);
      return (
        (n.name && n.name.toLowerCase().includes(q)) ||
        n.id.toLowerCase().includes(q) ||
        n.type.toLowerCase().includes(q) ||
        floorName.toLowerCase().includes(q)
      );
    });
  }, [storeData.nodes, storeData.floors, photoNodeSearchQuery]);

  const handleDedicatedPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
    if (!validTypes.includes(file.type)) {
      toast({
        type: "error",
        title: "Invalid File Type",
        description: "Please select a valid image file (JPG, PNG, WebP, GIF, or SVG).",
      });
      return;
    }

    try {
      const compressedUrl = await compressImageForUpload(file);
      if (compressedUrl) {
        setPhotoManagerFile(compressedUrl);
        toast({
          type: "success",
          title: "Image Selected & Optimized",
          description: "Click 'Save Photo to Node' below to link and persist.",
        });
      }
    } catch {
      toast({
        type: "error",
        title: "Image Processing Error",
        description: "Could not process selected image.",
      });
    }
  };

  const handleDedicatedRemovePhoto = async () => {
    if (!selectedPhotoNode) return;
    if (window.confirm(`Are you sure you want to remove the reference photo from node "${selectedPhotoNode.name || selectedPhotoNode.id}"? The node and GPS coordinates will be preserved.`)) {
      try {
        await fetch(`/api/nodes/${selectedPhotoNode.id}/photo`, { method: "DELETE" }).catch(() => {});
      } catch {}
      campusStore.updateNode(selectedPhotoNode.id, {
        photoUrl: undefined,
        photoUploadedAt: undefined,
        physicalVerified: false,
      });
      setPhotoManagerFile("");
      setPhotoManagerPhysicalVerified(false);
      setStoreData(campusStore.getWorkingData());
      toast({
        type: "info",
        title: "Photo Removed",
        description: "Reference photo removed from node.",
      });
    }
  };

  const entityCounts = useMemo(() => {
    return {
      BUILDING: storeData.buildings.length,
      FLOOR: storeData.floors.length,
      ROOM: storeData.destinations.length,
      NODE: storeData.nodes.length,
      EDGE: storeData.edges.length,
      STAIR: (storeData.stairGroups || []).length,
      LIFT: (storeData.liftGroups || []).length,
      OBSTACLE: (storeData.obstacles || []).length,
      PHOTO: storeData.nodes.filter((n) => Boolean(n.photoUrl)).length,
    };
  }, [storeData]);

  const edgeSplitInfo = useMemo(() => {
    if (!edgeForm.firstNodeId || !edgeForm.secondNodeId) return null;
    const nodeA = storeData.nodes.find((n) => n.id === edgeForm.firstNodeId);
    const nodeB = storeData.nodes.find((n) => n.id === edgeForm.secondNodeId);
    if (!nodeA || !nodeB || nodeA.id === nodeB.id) return null;

    return calculateEdgePathSplit(nodeA, nodeB, storeData.nodes, edgeForm.edgeType, edgeForm.toleranceMeters);
  }, [edgeForm.firstNodeId, edgeForm.secondNodeId, edgeForm.edgeType, edgeForm.toleranceMeters, storeData.nodes]);

  const buildingFootprintPoints = useMemo(() => {
    const corners = (buildingForm.corners || []).map((c) => ({
      lat: parseFloat(c.lat) || 11.4975,
      lng: parseFloat(c.lng) || 77.2765,
    }));

    const lats = corners.map((c) => c.lat);
    const lngs = corners.map((c) => c.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const width = Math.max(0.0001, maxLng - minLng);
    const height = Math.max(0.0001, maxLat - minLat);

    const svgPoints = corners
      .map((c) => {
        const x = 30 + ((c.lng - minLng) / width) * 240;
        const y = 30 + ((maxLat - c.lat) / height) * 120;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    return { svgPoints, minLat, maxLat, minLng, maxLng };
  }, [buildingForm.corners]);

  // ---------------------------------------------------------------------------
  // CREATE & EDIT ACTIONS
  // ---------------------------------------------------------------------------

  // GPS Coordinate Range Clamping & Validation
  const validateGpsCoordinates = (latStr: string, lngStr: string) => {
    const lat = parseFloat(latStr);
    const lng = parseFloat(lngStr);
    if (isNaN(lat) || lat < -90.0 || lat > 90.0) {
      toast({
        type: "error",
        title: "Invalid GPS Latitude",
        description: "Latitude must be between -90.0 and 90.0 degrees.",
      });
      return null;
    }
    if (isNaN(lng) || lng < -180.0 || lng > 180.0) {
      toast({
        type: "error",
        title: "Invalid GPS Longitude",
        description: "Longitude must be between -180.0 and 180.0 degrees.",
      });
      return null;
    }
    return { lat, lng };
  };

  const handleResetAllForms = () => {
    const defaultBld = storeData.buildings[0]?.id || "";
    const defaultFloors = storeData.floors.filter((f) => f.buildingId === defaultBld);

    setBuildingForm({
      name: "",
      category: "",
      description: "",
      floorsCount: 3,
      corners: [
        { lat: "11.4975", lng: "77.2765" },
        { lat: "11.4975", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2765" },
      ],
    });
  };

  const handleCreateEntity = async () => {
    switch (selectedType) {
      case "BUILDING": {
        if (!buildingForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Building name is required." });
          return;
        }

        const parsedCorners: BuildingCorner[] = (buildingForm.corners || []).map((c) => ({
          lat: parseFloat(c.lat),
          lng: parseFloat(c.lng),
        }));

        const validation = validatePolygonCorners(parsedCorners);
        if (!validation.valid) {
          toast({
            type: "error",
            title: "Invalid Building Footprint",
            description: validation.error || "Building footprint requires at least 3 valid corners.",
          });
          return;
        }

        const bldId = generateShortId("b", campusStore.getWorkingData().buildings.map((b) => b.id));
        const center = getCenterFromCorners(parsedCorners);
        const centerLat = center.lat;
        const centerLng = center.lng;
        const { x, y } = gpsToCanvas(centerLat, centerLng);

        const canvasCorners = parsedCorners.map((c) => gpsToCanvas(c.lat, c.lng));
        const xs = canvasCorners.map((c) => c.x);
        const ys = canvasCorners.map((c) => c.y);
        const calcWidth = Math.max(10, Math.max(...xs) - Math.min(...xs));
        const calcHeight = Math.max(10, Math.max(...ys) - Math.min(...ys));

        const newBuilding: BuildingType = {
          id: bldId,
          campusId: storeData.campus.id,
          name: buildingForm.name.trim(),
          shortCode: deriveBuildingShortCode(buildingForm.name, buildingForm.category),
          description: buildingForm.description,
          floorsCount: typeof buildingForm.floorsCount === "number" && !isNaN(buildingForm.floorsCount) ? Math.max(0, buildingForm.floorsCount) : 0,
          lat: centerLat,
          lng: centerLng,
          centerLat,
          centerLng,
          x,
          y,
          width: calcWidth,
          height: calcHeight,
          footprint: parsedCorners,
          ...(parsedCorners.length >= 4 ? {
            corner1Lat: parsedCorners[0].lat, corner1Lng: parsedCorners[0].lng,
            corner2Lat: parsedCorners[1].lat, corner2Lng: parsedCorners[1].lng,
            corner3Lat: parsedCorners[2].lat, corner3Lng: parsedCorners[2].lng,
            corner4Lat: parsedCorners[3].lat, corner4Lng: parsedCorners[3].lng,
          } : {}),
        };

        campusStore.addBuilding(newBuilding);
        toast({
          type: "success",
          title: "Building Created & Synced",
          description: `Building "${newBuilding.name}" (${parsedCorners.length}-corner polygon) added to Store & CAD Editor!`,
        });

        setBuildingForm({
          name: "",
          category: "",
          description: "",
          floorsCount: 3,
          corners: [
            { lat: "11.4975", lng: "77.2765" },
            { lat: "11.4975", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2765" },
          ],
        });
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "FLOOR": {
        if (!floorForm.buildingId) {
          toast({ type: "error", title: "Validation Error", description: "Please select a building." });
          return;
        }

        const newFloor = campusStore.addFloor(floorForm.buildingId, floorForm.name, Number(floorForm.ordinal));
        toast({ type: "success", title: "Floor Added & Synced", description: `Floor level "${newFloor.name}" added to Store & CAD Editor! (ID: ${newFloor.id})` });
        setFloorForm((prev) => ({ ...prev, name: "" }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "NODE": {
        if (!nodeForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Node name is required." });
          return;
        }

        const gps = validateGpsCoordinates(nodeForm.lat, nodeForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const { x, y } = gpsToCanvas(lat, lng);

        const newNode: Node = {
          id: `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          type: nodeForm.type,
          name: nodeForm.name.trim(),
          floorId: nodeForm.floorId || "f-out",
          x,
          y,
          lat,
          lng,
          searchable: true,
          visibleToUser: nodeForm.visibleToUser ?? true,
        };

        campusStore.addNode(newNode);
        toast({ type: "success", title: "Node Created & Synced", description: `Node "${newNode.name}" added to Store & CAD Editor!` });
        setNodeForm((prev) => ({ ...prev, name: "", lat: "11.", lng: "77.", visibleToUser: true }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "ROOM": {
        if (!roomForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Room name is required." });
          return;
        }

        const gps = validateGpsCoordinates(roomForm.lat, roomForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const { x, y } = gpsToCanvas(lat, lng);

        const linkedNodeId = `node-room-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const roomNode: Node = {
          id: linkedNodeId,
          type: "ROOM",
          name: roomForm.name.trim(),
          floorId: roomForm.floorId || "f-out",
          x,
          y,
          lat,
          lng,
          searchable: true,
          visibleToUser: true,
        };
        campusStore.addNode(roomNode);

        const newDest: Destination = {
          id: `dest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          nodeId: linkedNodeId,
          name: roomForm.name.trim(),
          category: roomForm.category,
          aliases: [roomForm.roomNumber, roomForm.name].filter(Boolean),
          roomNumber: roomForm.roomNumber,
          floorId: roomForm.floorId,
          x,
          y,
        };
        campusStore.addDestination(newDest);

        toast({ type: "success", title: "Room Destination Created", description: `Room "${newDest.name}" added to Store & CAD Editor!` });
        setRoomForm((prev) => ({ ...prev, name: "", roomNumber: "", lat: "11.", lng: "77." }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "STAIR": {
        if (!stairForm.buildingId) {
          toast({ type: "error", title: "Validation Error", description: "Building selection is required." });
          return;
        }
        if (stairForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 connecting floor for the staircase." });
          return;
        }

        const gps = validateGpsCoordinates(stairForm.lat, stairForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const bld = storeData.buildings.find((b) => b.id === stairForm.buildingId);
        const nameStr = stairForm.name.trim() || `Staircase ${bld?.name || ""}`;
        const { x, y } = gpsToCanvas(lat, lng);

        const sg = campusStore.createStairGroup(stairForm.buildingId, nameStr, stairForm.selectedFloorIds, { x, y });
        toast({
          type: "success",
          title: "Staircase Created & Synced",
          description: `Stair group "${sg.name}" connected across ${stairForm.selectedFloorIds.length} floors! Visible in CAD Editor.`,
        });
        setStairForm((prev) => ({ ...prev, name: "", selectedFloorIds: [], lat: "11.", lng: "77." }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "LIFT": {
        if (!liftForm.buildingId) {
          toast({ type: "error", title: "Validation Error", description: "Building selection is required." });
          return;
        }
        if (liftForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 served floor for the elevator." });
          return;
        }

        const gps = validateGpsCoordinates(liftForm.lat, liftForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const bld = storeData.buildings.find((b) => b.id === liftForm.buildingId);
        const nameStr = liftForm.name.trim() || `Elevator ${bld?.name || ""}`;
        const { x, y } = gpsToCanvas(lat, lng);

        const lg = campusStore.createLiftGroup(liftForm.buildingId, nameStr, liftForm.selectedFloorIds, { x, y });
        toast({
          type: "success",
          title: "Lift Created & Synced",
          description: `Elevator/Lift "${lg.name}" serving ${liftForm.selectedFloorIds.length} floors created! Visible in CAD Editor.`,
        });
        setLiftForm((prev) => ({ ...prev, name: "", selectedFloorIds: [], lat: "11.", lng: "77." }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "OBSTACLE": {
        if (!obstacleForm.name.trim()) {
          toast({ type: "error", title: "Validation Error", description: "Obstacle description/reason is required." });
          return;
        }
        const gps = validateGpsCoordinates(obstacleForm.lat, obstacleForm.lng);
        if (!gps) return;
        const { lat, lng } = gps;
        const { x, y } = gpsToCanvas(lat, lng);

        const newObs = {
          id: `obs-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          campusId: storeData.campus.id,
          x,
          y,
          radius: Number(obstacleForm.radius) || 10,
          reason: obstacleForm.name.trim(),
          severity: obstacleForm.obstacleType,
          expiresAt: obstacleForm.endTime || null,
        };
        campusStore.addObstacle(newObs);

        toast({ type: "success", title: "Obstacle Added & Synced", description: `Obstacle hazard recorded and visible in CAD Editor.` });
        setObstacleForm((prev) => ({ ...prev, name: "", lat: "11.", lng: "77." }));
        setStoreData({ ...campusStore.getWorkingData() });
        break;
      }

      case "PHOTO": {
        if (!photoManagerNodeId) {
          toast({ type: "error", title: "Validation Error", description: "Please select a node first." });
          return;
        }
        if (!photoManagerFile) {
          toast({ type: "error", title: "Validation Error", description: "Please select an image file to attach." });
          return;
        }
        const targetNode = storeData.nodes.find((n) => n.id === photoManagerNodeId);
        if (!targetNode) {
          toast({ type: "error", title: "Node Not Found", description: "Selected node was not found in campus graph." });
          return;
        }

        const stableUrl = `/api/nodes/${targetNode.id}/photo`;

        try {
          // Direct Database Storage (Ensures photo is written directly to Postgres)
          const res = await fetch(`/api/nodes/${targetNode.id}/photo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ photoData: photoManagerFile }),
          });

          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            throw new Error(data.error || `Server returned status ${res.status}`);
          }

          const savedUrl = data.photoUrl || stableUrl;

          campusStore.updateNode(targetNode.id, {
            photoUrl: savedUrl,
            photoUploadedAt: data.uploadedAt || new Date().toISOString(),
            physicalVerified: photoManagerPhysicalVerified,
          });

          setStoreData({ ...campusStore.getWorkingData() });

          toast({
            type: "success",
            title: "Photo Saved to Database",
            description: `Reference photo for "${targetNode.name || targetNode.id}" is saved in cloud database!`,
          });

          setPhotoManagerNodeId("");
          setPhotoNodeSearchQuery("");
          setPhotoManagerFile("");
          setPhotoManagerPhysicalVerified(false);
          if (dedicatedPhotoInputRef.current) {
            dedicatedPhotoInputRef.current.value = "";
          }
        } catch (err: unknown) {
          toast({
            type: "error",
            title: "Upload Failed",
            description: `Could not save photo to database: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        break;
      }

      case "EDGE": {
        if (!edgeForm.firstNodeId || !edgeForm.secondNodeId) {
          toast({ type: "error", title: "Validation Error", description: "Please select both first and second nodes." });
          return;
        }
        if (!edgeForm.pathType) {
          toast({ type: "error", title: "Path Type Required", description: "Please select a Path Type (EV Path or Only Walk Path)." });
          return;
        }
        if (!edgeSplitInfo) {
          toast({ type: "error", title: "Validation Error", description: "Select two distinct valid nodes to connect." });
          return;
        }

        const chosenPathType = edgeForm.pathType as PathType;

        if (edgeSplitInfo.hasIntermediates) {
          campusStore.startBatching();
          edgeSplitInfo.edgesToCreate.forEach((edgeItem) => {
            campusStore.addEdge({
              id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              from: edgeItem.fromNode.id,
              to: edgeItem.toNode.id,
              type: edgeItem.type,
              pathType: chosenPathType,
              distance: edgeItem.distance,
              bidirectional: true,
            });
          });
          campusStore.endBatching();

          toast({
            type: "success",
            title: "Smart Path Edge Created",
            description: `Auto-split connection into ${edgeSplitInfo.edgesToCreate.length} segments via ${edgeSplitInfo.intermediates.length} intermediate node(s)!`,
          });
        } else {
          const single = edgeSplitInfo.edgesToCreate[0];
          const res = campusStore.addEdge({
            id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            from: single.fromNode.id,
            to: single.toNode.id,
            type: single.type,
            pathType: chosenPathType,
            distance: single.distance,
            bidirectional: true,
          });

          if (res.success) {
            toast({ type: "success", title: "Edge Connected", description: `Direct ${chosenPathType} edge connected (${single.distance}m)! Visible in CAD Editor.` });
          } else {
            toast({ type: "error", title: "Edge Exists", description: res.error || "Edge connection already exists." });
          }
          setStoreData({ ...campusStore.getWorkingData() });
        }

        setEdgeForm((prev) => ({ ...prev, secondNodeId: "", pathType: "" }));
        break;
      }
    }
    setStoreData({ ...campusStore.getWorkingData() });
  };

  // ---------------------------------------------------------------------------
  // COPY & PASTE & RESET WORKFLOW HANDLERS
  // ---------------------------------------------------------------------------

  const handleResetForm = () => {
    const defaultBld = storeData.buildings[0]?.id || "";
    const defaultFloors = storeData.floors.filter((f) => f.buildingId === defaultBld);

    setBuildingForm({
      name: "",
      category: "",
      description: "",
      floorsCount: 3,
      corners: [
        { lat: "11.4975", lng: "77.2765" },
        { lat: "11.4975", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2780" },
        { lat: "11.4962", lng: "77.2765" },
      ],
    });

    setNodeForm({
      name: "",
      lat: "11.",
      lng: "77.",
      buildingId: defaultBld,
      floorId: defaultFloors[0]?.id || "f-out",
      type: "CORRIDOR",
      accessible: true,
      visibleToUser: true,
      description: "",
    });

    setRoomForm({
      name: "",
      roomNumber: "",
      buildingId: defaultBld,
      floorId: defaultFloors[0]?.id || "",
      category: "Classroom",
      lat: "11.",
      lng: "77.",
      description: "",
    });

    setStairForm({
      name: "",
      buildingId: defaultBld,
      selectedFloorIds: defaultFloors.map((f) => f.id),
      lat: "11.",
      lng: "77.",
    });

    setLiftForm({
      name: "",
      buildingId: defaultBld,
      selectedFloorIds: defaultFloors.map((f) => f.id),
      lat: "11.",
      lng: "77.",
    });

    setObstacleForm({
      name: "",
      obstacleType: "MEDIUM",
      lat: "11.",
      lng: "77.",
      radius: 10,
      startTime: "",
      endTime: "",
    });

    setEdgeForm({
      firstNodeId: "",
      secondNodeId: "",
      edgeType: "WALK",
      pathType: "",
      toleranceMeters: 5,
    });

    setFloorForm({
      buildingId: defaultBld,
      name: "",
      ordinal: 1,
    });

    toast({
      type: "info",
      title: "Form Reset",
      description: "Data entry form fields reset to default values.",
    });
  };

  // Helper to reliably extract or calculate all 4 corner GPS coordinates for a building object
  const extractBuildingCorners = (raw: any) => {
    let c1Lat = raw.corner1Lat;
    let c1Lng = raw.corner1Lng;
    let c2Lat = raw.corner2Lat;
    let c2Lng = raw.corner2Lng;
    let c3Lat = raw.corner3Lat;
    let c3Lng = raw.corner3Lng;
    let c4Lat = raw.corner4Lat;
    let c4Lng = raw.corner4Lng;

    const valid1 = c1Lat !== undefined && c1Lat !== null && c1Lat !== "" && !isNaN(Number(c1Lat));
    const valid2 = c2Lat !== undefined && c2Lat !== null && c2Lat !== "" && !isNaN(Number(c2Lat));
    const valid3 = c3Lat !== undefined && c3Lat !== null && c3Lat !== "" && !isNaN(Number(c3Lat));
    const valid4 = c4Lat !== undefined && c4Lat !== null && c4Lat !== "" && !isNaN(Number(c4Lat));

    if (!valid1 || !valid2 || !valid3 || !valid4) {
      let centerLat = Number(raw.lat ?? raw.centerLat);
      let centerLng = Number(raw.lng ?? raw.centerLng);

      if ((isNaN(centerLat) || isNaN(centerLng) || centerLat === 0) && raw.x !== undefined && raw.y !== undefined) {
        const gps = canvasToGps(raw.x, raw.y);
        centerLat = gps.lat;
        centerLng = gps.lng;
      }

      if (isNaN(centerLat) || centerLat === 0) centerLat = 11.4975;
      if (isNaN(centerLng) || centerLng === 0) centerLng = 77.2765;

      const latOffset = 0.0003;
      const lngOffset = 0.00035;

      c1Lat = Number((centerLat + latOffset).toFixed(9));
      c1Lng = Number((centerLng - lngOffset).toFixed(9));
      c2Lat = Number((centerLat + latOffset).toFixed(9));
      c2Lng = Number((centerLng + lngOffset).toFixed(9));
      c3Lat = Number((centerLat - latOffset).toFixed(9));
      c3Lng = Number((centerLng + lngOffset).toFixed(9));
      c4Lat = Number((centerLat - latOffset).toFixed(9));
      c4Lng = Number((centerLng - lngOffset).toFixed(9));
    }

    return {
      corner1Lat: String(c1Lat),
      corner1Lng: String(c1Lng),
      corner2Lat: String(c2Lat),
      corner2Lng: String(c2Lng),
      corner3Lat: String(c3Lat),
      corner3Lng: String(c3Lng),
      corner4Lat: String(c4Lat),
      corner4Lng: String(c4Lng),
    };
  };

  const handleCopyEntity = (item: { id: string; category: EntityCategory; name: string; raw: any }) => {
    let copyPayload: any = { category: item.category, name: item.name };

    switch (item.category) {
      case "BUILDING": {
        const corners = extractBuildingCorners(item.raw);
        copyPayload = {
          category: "BUILDING",
          name: item.raw.name || "",
          shortCode: item.raw.shortCode || "",
          buildingCategory: item.raw.category || item.raw.categoryType || "",
          description: item.raw.description || "",
          floorsCount: item.raw.floorsCount !== undefined ? item.raw.floorsCount : 0,
          lat: item.raw.lat !== undefined ? item.raw.lat : item.raw.centerLat,
          lng: item.raw.lng !== undefined ? item.raw.lng : item.raw.centerLng,
          corner1Lat: corners.corner1Lat,
          corner1Lng: corners.corner1Lng,
          corner2Lat: corners.corner2Lat,
          corner2Lng: corners.corner2Lng,
          corner3Lat: corners.corner3Lat,
          corner3Lng: corners.corner3Lng,
          corner4Lat: corners.corner4Lat,
          corner4Lng: corners.corner4Lng,
        };
        break;
      }
      case "FLOOR":
        copyPayload = {
          category: "FLOOR",
          name: item.raw.name || "",
          ordinal: item.raw.ordinal !== undefined ? item.raw.ordinal : 1,
          buildingId: item.raw.buildingId || "",
        };
        break;
      case "ROOM":
        copyPayload = {
          category: "ROOM",
          name: item.raw.name || "",
          roomNumber: item.raw.roomNumber || "",
          roomCategory: item.raw.category || "Classroom",
          buildingId: item.raw.buildingId || "",
          floorId: item.raw.floorId || "",
          lat: item.raw.lat !== undefined ? item.raw.lat : (storeData.nodes.find(n => n.id === item.raw.nodeId)?.lat || "11."),
          lng: item.raw.lng !== undefined ? item.raw.lng : (storeData.nodes.find(n => n.id === item.raw.nodeId)?.lng || "77."),
          description: item.raw.description || "",
        };
        break;
      case "NODE":
        copyPayload = {
          category: "NODE",
          name: item.raw.name || "",
          nodeType: item.raw.type || "CORRIDOR",
          buildingId: item.raw.buildingId || "",
          floorId: item.raw.floorId || "",
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
          accessible: item.raw.accessible !== undefined ? item.raw.accessible : true,
          description: item.raw.description || "",
        };
        break;
      case "EDGE":
        copyPayload = {
          category: "EDGE",
          firstNodeId: item.raw.from || "",
          secondNodeId: item.raw.to || "",
          edgeType: item.raw.type || "WALK",
          distance: item.raw.distance || 0,
        };
        break;
      case "STAIR":
        copyPayload = {
          category: "STAIR",
          name: item.raw.name || "",
          buildingId: item.raw.buildingId || "",
          selectedFloorIds: item.raw.connectedFloorIds || [],
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
        };
        break;
      case "LIFT":
        copyPayload = {
          category: "LIFT",
          name: item.raw.name || "",
          buildingId: item.raw.buildingId || "",
          selectedFloorIds: item.raw.servedFloorIds || [],
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
        };
        break;
      case "OBSTACLE":
        copyPayload = {
          category: "OBSTACLE",
          name: item.raw.reason || item.raw.name || "",
          obstacleType: item.raw.severity || "MEDIUM",
          radius: item.raw.radius || 10,
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
        };
        break;
      case "PHOTO":
        copyPayload = {
          category: "PHOTO",
          name: item.raw.name || "",
          nodeType: item.raw.type || "CORRIDOR",
          buildingId: item.raw.buildingId || "",
          floorId: item.raw.floorId || "",
          lat: item.raw.lat || "11.",
          lng: item.raw.lng || "77.",
          photoUrl: item.raw.photoUrl || "",
        };
        break;
    }

    setCopiedEntityPayload(copyPayload);
    setCopiedRowId(item.id);

    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(JSON.stringify(copyPayload, null, 2)).catch(() => {});
    }

    toast({
      type: "success",
      title: `${item.category} Details Copied`,
      description: `Copied "${item.name}" attributes (including 4 corner GPS coordinates). Use 'Paste Copied Object' in the Data Entry Form.`,
    });

    setTimeout(() => setCopiedRowId(null), 2500);
  };

  const handlePasteEntity = async () => {
    let payload = copiedEntityPayload;

    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.readText) {
      try {
        const text = await navigator.clipboard.readText();
        if (text && text.trim().startsWith("{")) {
          const parsed = JSON.parse(text.trim());
          if (parsed && (parsed.category || parsed.corner1Lat || parsed.name)) {
            payload = parsed;
          }
        }
      } catch (e) {
        // Fallback to internal payload
      }
    }

    if (!payload) {
      toast({
        type: "error",
        title: "Nothing to Paste",
        description: "Please click 'Copy' on an object in the Live Object Directory table first.",
      });
      return;
    }

    if (selectedType !== payload.category) {
      setSelectedType(payload.category);
    }

    switch (payload.category) {
      case "BUILDING": {
        const corners = getBuildingCorners(payload).map((c) => ({ lat: String(c.lat), lng: String(c.lng) }));
        setBuildingForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          category: payload.buildingCategory !== undefined ? payload.buildingCategory : (payload.categoryType ?? ""),
          description: payload.description || "",
          floorsCount: payload.floorsCount !== undefined ? payload.floorsCount : 3,
          corners: corners.length >= 3 ? corners : [
            { lat: "11.4975", lng: "77.2765" },
            { lat: "11.4975", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2780" },
            { lat: "11.4962", lng: "77.2765" },
          ],
        });
        break;
      }
      case "FLOOR":
        setFloorForm({
          buildingId: payload.buildingId || floorForm.buildingId,
          name: payload.name ? `${payload.name} (Copy)` : "",
          ordinal: payload.ordinal !== undefined ? payload.ordinal : 1,
        });
        break;
      case "ROOM":
        setRoomForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          roomNumber: payload.roomNumber || "",
          buildingId: payload.buildingId || roomForm.buildingId,
          floorId: payload.floorId || roomForm.floorId,
          category: payload.roomCategory || "Classroom",
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
          description: payload.description || "",
        });
        break;
      case "NODE":
        setNodeForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
          buildingId: payload.buildingId || "",
          floorId: payload.floorId || "",
          type: payload.nodeType || "CORRIDOR",
          accessible: payload.accessible !== undefined ? payload.accessible : true,
          visibleToUser: payload.visibleToUser !== undefined ? payload.visibleToUser : true,
          description: payload.description || "",
        });
        break;
      case "EDGE":
        setEdgeForm({
          firstNodeId: payload.firstNodeId || "",
          secondNodeId: payload.secondNodeId || "",
          edgeType: payload.edgeType || "WALK",
          pathType: payload.pathType || "WALK",
          toleranceMeters: 2.0,
        });
        break;
      case "STAIR":
        setStairForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          buildingId: payload.buildingId || "",
          selectedFloorIds: payload.selectedFloorIds || [],
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
        });
        break;
      case "LIFT":
        setLiftForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          buildingId: payload.buildingId || "",
          selectedFloorIds: payload.selectedFloorIds || [],
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
        });
        break;
      case "OBSTACLE":
        setObstacleForm({
          name: payload.name ? `${payload.name} (Copy)` : "",
          obstacleType: payload.obstacleType || "MEDIUM",
          lat: payload.lat !== undefined ? String(payload.lat) : "11.",
          lng: payload.lng !== undefined ? String(payload.lng) : "77.",
          radius: payload.radius || 10,
          startTime: "",
          endTime: "",
        });
        break;
    }

    toast({
      type: "success",
      title: "Data Pasted Successfully",
      description: `Pasted copied ${payload.category} attributes into the ${payload.category} form.`,
    });
  };

  const handleOpenEditModal = (item: { id: string; category: EntityCategory; name: string; raw: any }) => {
    setEditingItem(item);
    const existingCorners = getBuildingCorners(item.raw).map((c) => ({ lat: String(c.lat), lng: String(c.lng) }));
    setEditForm({
      name: item.name,
      category: item.raw.category || item.raw.shortCode || "Classroom",
      shortCode: item.raw.shortCode || "",
      roomNumber: item.raw.roomNumber || "",
      nodeType: item.raw.type || "CORRIDOR",
      description: item.raw.description || item.raw.reason || "",
      floorsCount: item.raw.floorsCount !== undefined ? item.raw.floorsCount : 0,
      ordinal: item.raw.ordinal !== undefined ? item.raw.ordinal : 0,
      buildingId: item.raw.buildingId || "",
      floorId: item.raw.floorId || "",
      selectedFloorIds: item.raw.connectedFloorIds || item.raw.servedFloorIds || [],
      severity: item.raw.severity || "MEDIUM",
      radius: item.raw.radius || 10,
      lat: item.raw.lat !== undefined ? String(item.raw.lat) : item.raw.centerLat !== undefined ? String(item.raw.centerLat) : (item.raw.x !== undefined && item.raw.y !== undefined ? String(canvasToGps(item.raw.x, item.raw.y).lat.toFixed(6)) : "11."),
      lng: item.raw.lng !== undefined ? String(item.raw.lng) : item.raw.centerLng !== undefined ? String(item.raw.centerLng) : (item.raw.x !== undefined && item.raw.y !== undefined ? String(canvasToGps(item.raw.x, item.raw.y).lng.toFixed(6)) : "77."),
      corners: existingCorners,
      corner1Lat: item.raw.corner1Lat !== undefined ? String(item.raw.corner1Lat) : "",
      corner1Lng: item.raw.corner1Lng !== undefined ? String(item.raw.corner1Lng) : "",
      corner2Lat: item.raw.corner2Lat !== undefined ? String(item.raw.corner2Lat) : "",
      corner2Lng: item.raw.corner2Lng !== undefined ? String(item.raw.corner2Lng) : "",
      corner3Lat: item.raw.corner3Lat !== undefined ? String(item.raw.corner3Lat) : "",
      corner3Lng: item.raw.corner3Lng !== undefined ? String(item.raw.corner3Lng) : "",
      corner4Lat: item.raw.corner4Lat !== undefined ? String(item.raw.corner4Lat) : "",
      corner4Lng: item.raw.corner4Lng !== undefined ? String(item.raw.corner4Lng) : "",
      firstNodeId: item.raw.from || "",
      secondNodeId: item.raw.to || "",
      edgeType: item.raw.type || "WALK",
      pathType: getEdgePathType(item.raw),
      distance: item.raw.distance !== undefined ? item.raw.distance : 0,
      accessible: item.raw.accessible !== undefined ? item.raw.accessible : true,
      visibleToUser: item.raw.visibleToUser !== undefined ? item.raw.visibleToUser : true,
      expiresAt: item.raw.expiresAt || "",
      photoUrl: item.raw.photoUrl || "",
      photoUploadedAt: item.raw.photoUploadedAt || "",
      physicalVerified: Boolean(item.raw.physicalVerified),
    });
  };

  const handleSaveEditModal = async () => {
    if (!editingItem) return;
    const newName = editForm.name.trim();
    if (!newName) {
      toast({ type: "error", title: "Validation Error", description: "Name cannot be empty." });
      return;
    }

    switch (editingItem.category) {
      case "BUILDING": {
        const parsedCorners: BuildingCorner[] = (editForm.corners || []).map((c: any) => ({
          lat: parseFloat(c.lat),
          lng: parseFloat(c.lng),
        }));

        const validation = validatePolygonCorners(parsedCorners);
        if (!validation.valid) {
          toast({
            type: "error",
            title: "Invalid Building Footprint",
            description: validation.error || "Building footprint requires at least 3 valid corners.",
          });
          return;
        }

        const center = getCenterFromCorners(parsedCorners);
        const centerLat = center.lat;
        const centerLng = center.lng;
        const { x, y } = gpsToCanvas(centerLat, centerLng);

        const canvasCorners = parsedCorners.map((c) => gpsToCanvas(c.lat, c.lng));
        const xs = canvasCorners.map((c) => c.x);
        const ys = canvasCorners.map((c) => c.y);
        const calcWidth = Math.max(10, Math.max(...xs) - Math.min(...xs));
        const calcHeight = Math.max(10, Math.max(...ys) - Math.min(...ys));

        campusStore.updateBuilding(editingItem.id, {
          name: newName,
          shortCode: editForm.shortCode ? editForm.shortCode.trim().toUpperCase() : deriveBuildingShortCode(newName, editForm.category || editingItem.raw.shortCode),
          description: editForm.description,
          floorsCount: editForm.floorsCount,
          lat: centerLat,
          lng: centerLng,
          centerLat,
          centerLng,
          x,
          y,
          width: calcWidth,
          height: calcHeight,
          footprint: parsedCorners,
          ...(parsedCorners.length >= 4 ? {
            corner1Lat: parsedCorners[0].lat, corner1Lng: parsedCorners[0].lng,
            corner2Lat: parsedCorners[1].lat, corner2Lng: parsedCorners[1].lng,
            corner3Lat: parsedCorners[2].lat, corner3Lng: parsedCorners[2].lng,
            corner4Lat: parsedCorners[3].lat, corner4Lng: parsedCorners[3].lng,
          } : {}),
        });
        break;
      }

      case "FLOOR":
        campusStore.updateFloor(editingItem.id, {
          name: newName,
          ordinal: editForm.ordinal,
          ...(editForm.buildingId ? { buildingId: editForm.buildingId } : {}),
        });
        break;

      case "ROOM": {
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const { x, y } = (!isNaN(latNum) && !isNaN(lngNum))
          ? gpsToCanvas(latNum, lngNum)
          : { x: editingItem.raw.x, y: editingItem.raw.y };

        campusStore.updateDestination(editingItem.id, {
          name: newName,
          roomNumber: editForm.roomNumber,
          category: editForm.category,
          floorId: editForm.floorId || editingItem.raw.floorId,
          x,
          y,
        });

        if (editingItem.raw.nodeId) {
          campusStore.updateNode(editingItem.raw.nodeId, {
            name: newName,
            floorId: editForm.floorId || editingItem.raw.floorId,
            ...(!isNaN(latNum) && !isNaN(lngNum) ? { lat: latNum, lng: lngNum, x, y } : {}),
          });
        }
        break;
      }

      case "NODE":
      case "PHOTO": {
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const { x, y } = (!isNaN(latNum) && !isNaN(lngNum))
          ? gpsToCanvas(latNum, lngNum)
          : { x: editingItem.raw.x, y: editingItem.raw.y };

        let finalPhotoUrl = editForm.photoUrl || undefined;
        let uploadedAt = editForm.photoUploadedAt || (finalPhotoUrl ? new Date().toISOString() : undefined);

        if (editForm.photoUrl && editForm.photoUrl.startsWith("data:")) {
          try {
            const res = await fetch(`/api/nodes/${editingItem.id}/photo`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ photoData: editForm.photoUrl }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              throw new Error(data.error || "Failed to persist reference photo to database.");
            }
            finalPhotoUrl = data.photoUrl || `/api/nodes/${editingItem.id}/photo`;
            uploadedAt = data.uploadedAt || new Date().toISOString();
          } catch (err: unknown) {
            toast({
              type: "error",
              title: "Photo Save Failed",
              description: `Could not save photo to database: ${err instanceof Error ? err.message : String(err)}`,
            });
            return;
          }
        }

        campusStore.updateNode(editingItem.id, {
          name: newName,
          type: editForm.nodeType,
          floorId: editForm.floorId || editingItem.raw.floorId,
          accessible: editForm.accessible,
          visibleToUser: editForm.visibleToUser !== undefined ? editForm.visibleToUser : true,
          photoUrl: finalPhotoUrl,
          photoUploadedAt: uploadedAt,
          physicalVerified: editForm.physicalVerified,
          ...(!isNaN(latNum) && !isNaN(lngNum) ? { lat: latNum, lng: lngNum, x, y } : {}),
        });
        break;
      }

      case "EDGE": {
        campusStore.updateEdge(editingItem.id, {
          from: editForm.firstNodeId || editingItem.raw.from,
          to: editForm.secondNodeId || editingItem.raw.to,
          type: editForm.edgeType,
          pathType: editForm.pathType as PathType,
          distance: editForm.distance || editingItem.raw.distance,
        });
        break;
      }

      case "STAIR": {
        if (editForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 connecting floor for the staircase." });
          return;
        }
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const pos = (!isNaN(latNum) && !isNaN(lngNum)) ? gpsToCanvas(latNum, lngNum) : undefined;

        campusStore.updateStairGroup(editingItem.id, {
          name: newName,
          buildingId: editForm.buildingId || editingItem.raw.buildingId,
          connectedFloorIds: editForm.selectedFloorIds,
        }, pos);
        break;
      }

      case "LIFT": {
        if (editForm.selectedFloorIds.length === 0) {
          toast({ type: "error", title: "Validation Error", description: "Please select at least 1 served floor for the elevator/lift." });
          return;
        }
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const pos = (!isNaN(latNum) && !isNaN(lngNum)) ? gpsToCanvas(latNum, lngNum) : undefined;

        campusStore.updateLiftGroup(editingItem.id, {
          name: newName,
          buildingId: editForm.buildingId || editingItem.raw.buildingId,
          servedFloorIds: editForm.selectedFloorIds,
        }, pos);
        break;
      }

      case "OBSTACLE": {
        const latNum = parseFloat(editForm.lat);
        const lngNum = parseFloat(editForm.lng);
        const { x, y } = (!isNaN(latNum) && !isNaN(lngNum))
          ? gpsToCanvas(latNum, lngNum)
          : { x: editingItem.raw.x, y: editingItem.raw.y };

        campusStore.updateObstacle(editingItem.id, {
          reason: newName,
          severity: editForm.severity,
          radius: editForm.radius,
          expiresAt: editForm.expiresAt || null,
          ...(!isNaN(latNum) && !isNaN(lngNum) ? { x, y } : {}),
        });
        break;
      }
    }

    toast({
      type: "success",
      title: "Object Updated",
      description: `Updated ${editingItem.category} "${newName}" with live CAD sync!`,
    });
    setEditingItem(null);
    setStoreData({ ...campusStore.getWorkingData() });
  };

  // ---------------------------------------------------------------------------
  // FILTERED OBJECTS DIRECTORY & BULK DELETION
  // ---------------------------------------------------------------------------

  const filteredEntities = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const items: Array<{
      id: string;
      name: string;
      category: EntityCategory;
      buildingName?: string;
      floorName?: string;
      details: string;
      raw: any;
      photoUrl?: string;
      physicalVerified?: boolean;
    }> = [];

    if (activeTab === "ALL" || activeTab === "BUILDING") {
      storeData.buildings.forEach((b) => {
        const matches = !q || b.name.toLowerCase().includes(q) || b.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: b.id,
            name: b.name,
            category: "BUILDING",
            details: `${(b.floorsCount ?? 0) === 0 ? "Ground Floor Only" : `${(b.floorsCount ?? 0) + 1} Floors (${b.floorsCount} Upper)`} · GPS: ${b.lat?.toFixed(9)}, ${b.lng?.toFixed(9)}`,
            raw: b,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "FLOOR") {
      storeData.floors.forEach((f) => {
        const bld = storeData.buildings.find((b) => b.id === f.buildingId);
        const matches = !q || f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q) || (bld && bld.name.toLowerCase().includes(q));
        if (matches) {
          items.push({
            id: f.id,
            name: f.name,
            category: "FLOOR",
            buildingName: bld?.name || "Campus",
            details: `Ordinal: ${f.ordinal} · Building: ${bld?.name || f.buildingId}`,
            raw: f,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "ROOM") {
      storeData.destinations.forEach((d) => {
        const fl = storeData.floors.find((f) => f.id === d.floorId);
        const bld = fl ? storeData.buildings.find((b) => b.id === fl.buildingId) : undefined;
        const matches = !q || d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q) || (d.roomNumber && d.roomNumber.toLowerCase().includes(q)) || (d.category && d.category.toLowerCase().includes(q));
        if (matches) {
          items.push({
            id: d.id,
            name: d.name,
            category: "ROOM",
            buildingName: bld?.name,
            floorName: fl?.name,
            details: `Room ${d.roomNumber || "N/A"} · Category: ${d.category}`,
            raw: d,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "NODE") {
      storeData.nodes.forEach((n) => {
        const fl = storeData.floors.find((f) => f.id === n.floorId);
        const matches = !q || (n.name && n.name.toLowerCase().includes(q)) || n.id.toLowerCase().includes(q) || n.type.toLowerCase().includes(q);
        const matchesPhotoFilter =
          nodePhotoFilter === "ALL" ||
          (nodePhotoFilter === "WITH_PHOTO" && Boolean(n.photoUrl)) ||
          (nodePhotoFilter === "WITHOUT_PHOTO" && !n.photoUrl);

        if (matches && matchesPhotoFilter) {
          items.push({
            id: n.id,
            name: n.name || `Node ${n.id.slice(0, 8)}`,
            category: "NODE",
            floorName: fl?.name || (n.floorId === "f-out" ? "Outdoor" : n.floorId),
            details: `Type: ${n.type} · GPS: ${n.lat?.toFixed(9) || "Canvas"}, ${n.lng?.toFixed(9) || ""}`,
            raw: n,
            photoUrl: n.photoUrl,
            physicalVerified: n.physicalVerified,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "PHOTO") {
      storeData.nodes.forEach((n) => {
        if (!n.photoUrl && activeTab === "PHOTO" && nodePhotoFilter !== "WITHOUT_PHOTO") return;
        if (activeTab === "ALL" && !n.photoUrl) return;

        const matchesPhotoFilter =
          activeTab === "PHOTO"
            ? (nodePhotoFilter === "WITHOUT_PHOTO" ? !n.photoUrl : Boolean(n.photoUrl))
            : Boolean(n.photoUrl);

        if (!matchesPhotoFilter) return;

        const fl = storeData.floors.find((f) => f.id === n.floorId);
        const matches =
          !q ||
          (n.name && n.name.toLowerCase().includes(q)) ||
          n.id.toLowerCase().includes(q) ||
          (n.type && n.type.toLowerCase().includes(q)) ||
          q.includes("photo");

        if (matches) {
          items.push({
            id: n.id,
            name: n.name ? `${n.name} (Photo)` : `Node ${n.id.slice(0, 8)} (Photo)`,
            category: "PHOTO",
            floorName: fl?.name || (n.floorId === "f-out" ? "Outdoor" : n.floorId),
            details: `Reference Photo Attached · Verified: ${n.physicalVerified ? "Yes" : "No"} · GPS: ${n.lat?.toFixed(9) || "Canvas"}, ${n.lng?.toFixed(9) || ""}`,
            raw: n,
            photoUrl: n.photoUrl,
            physicalVerified: n.physicalVerified,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "EDGE") {
      storeData.edges.forEach((e) => {
        const nFrom = storeData.nodes.find((n) => n.id === e.from);
        const nTo = storeData.nodes.find((n) => n.id === e.to);
        const nameStr = `${nFrom?.name || e.from} ↔ ${nTo?.name || e.to}`;
        const pType = getEdgePathType(e);
        const pInfo = getPathTypeLabel(pType, e.type);
        const matches = !q || nameStr.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.type.toLowerCase().includes(q) || pType.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: e.id,
            name: nameStr,
            category: "EDGE",
            details: `${pInfo.label} (${pInfo.shortLabel}) · Type: ${e.type} · Distance: ${e.distance}m`,
            raw: e,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "STAIR") {
      (storeData.stairGroups || []).forEach((sg) => {
        const bld = storeData.buildings.find((b) => b.id === sg.buildingId);
        const matches = !q || sg.name.toLowerCase().includes(q) || sg.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: sg.id,
            name: sg.name,
            category: "STAIR",
            buildingName: bld?.name,
            details: `Connects ${sg.connectedFloorIds.length} floors in ${bld?.name || "Building"}`,
            raw: sg,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "LIFT") {
      (storeData.liftGroups || []).forEach((lg) => {
        const bld = storeData.buildings.find((b) => b.id === lg.buildingId);
        const matches = !q || lg.name.toLowerCase().includes(q) || lg.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: lg.id,
            name: lg.name,
            category: "LIFT",
            buildingName: bld?.name,
            details: `Serves ${lg.servedFloorIds.length} floors in ${bld?.name || "Building"}`,
            raw: lg,
          });
        }
      });
    }

    if (activeTab === "ALL" || activeTab === "OBSTACLE") {
      (storeData.obstacles || []).forEach((obs) => {
        const matches = !q || (obs.reason && obs.reason.toLowerCase().includes(q)) || obs.id.toLowerCase().includes(q);
        if (matches) {
          items.push({
            id: obs.id,
            name: obs.reason || `Obstacle ${obs.id.slice(0, 8)}`,
            category: "OBSTACLE",
            details: `Radius: ${obs.radius}m · Severity: ${obs.severity || "MEDIUM"}`,
            raw: obs,
          });
        }
      });
    }

    return items.reverse();
  }, [storeData, activeTab, searchQuery, nodePhotoFilter]);

  // High-Performance Table Pagination & Control
  const [pageSize, setPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, pageSize]);

  const totalPages = useMemo(() => {
    if (pageSize === 0 || filteredEntities.length === 0) return 1;
    return Math.ceil(filteredEntities.length / pageSize);
  }, [filteredEntities.length, pageSize]);

  const paginatedEntities = useMemo(() => {
    if (pageSize === 0) return filteredEntities;
    const startIdx = (currentPage - 1) * pageSize;
    return filteredEntities.slice(startIdx, startIdx + pageSize);
  }, [filteredEntities, currentPage, pageSize]);

  const toggleSelectRow = (id: string) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllRows = () => {
    if (selectedRowIds.size === filteredEntities.length) {
      setSelectedRowIds(new Set());
    } else {
      setSelectedRowIds(new Set(filteredEntities.map((e) => e.id)));
    }
  };

  const handleDeleteSelected = () => {
    if (selectedRowIds.size === 0) return;
    const idsToDelete = Array.from(selectedRowIds);
    campusStore.deleteSelectedEntities(idsToDelete);
    toast({
      type: "success",
      title: "Bulk Deletion Completed",
      description: `Deleted ${idsToDelete.length} campus objects with live CAD sync!`,
    });
    setSelectedRowIds(new Set());
    setStoreData({ ...campusStore.getWorkingData() });
  };

  const handleDeleteEntity = (item: { id: string; category: EntityCategory; name: string }) => {
    switch (item.category) {
      case "BUILDING":
        campusStore.deleteBuilding(item.id);
        break;
      case "FLOOR":
        campusStore.deleteFloor(item.id);
        break;
      case "NODE":
        campusStore.deleteNode(item.id);
        break;
      case "PHOTO":
        campusStore.updateNode(item.id, { photoUrl: undefined, photoUploadedAt: undefined, physicalVerified: false });
        break;
      case "ROOM":
        campusStore.deleteDestination(item.id);
        break;
      case "EDGE":
        campusStore.deleteEdge(item.id);
        break;
      case "STAIR":
        campusStore.deleteStairGroup(item.id);
        break;
      case "LIFT":
        campusStore.deleteLiftGroup(item.id);
        break;
      case "OBSTACLE":
        campusStore.deleteObstacle(item.id);
        break;
      default:
        campusStore.deleteSelectedEntities([item.id]);
    }

    toast({ type: "success", title: "Entity Deleted", description: `Deleted ${item.category} "${item.name}" with live CAD sync!` });
    setStoreData({ ...campusStore.getWorkingData() });
  };

  return (
    <div
      ref={containerRef}
      className={`${isFullscreen
          ? "fixed inset-0 z-[99999] h-screen w-screen min-h-screen min-w-full overflow-y-auto bg-[rgb(var(--bg))] p-6 space-y-6"
          : "space-y-8 pb-12"
        }`}
    >
      {/* HEADER BANNER WITH GRADIENT ACCENTS, UNDO/REDO & FULLSCREEN TOGGLE */}
      <div className="relative overflow-hidden rounded-2xl border border-[rgb(var(--primary)/0.25)] bg-gradient-to-r from-[rgb(var(--primary)/0.12)] via-[rgb(var(--card))] to-[rgb(var(--primary)/0.06)] p-5 shadow-md backdrop-blur-md">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-[rgb(var(--primary)/0.1)] to-transparent pointer-events-none" />

        <div className="space-y-4 relative z-10">
          {/* Top Row: Title, Badge & Description */}
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl gradient-primary text-white shadow-lg shadow-[rgb(var(--primary)/0.3)]">
              <Sliders className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-extrabold tracking-tight text-[rgb(var(--fg))]">
                  Campus Objects Manager
                </h2>
                <Badge variant="primary" className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5">
                  Central Hub
                </Badge>
              </div>
              <p className="text-xs text-[rgb(var(--muted-fg))] mt-0.5 leading-relaxed">
                Dedicated panel for creating, configuring, and managing all digital twin campus entities. Positions and attributes automatically synchronize with CAD Canvas in real-time.
              </p>
            </div>
          </div>

          {/* Action Toolbar Row: Aligned in a single clean row */}
          <div className="flex flex-wrap items-center justify-start gap-2 pt-3 border-t border-[rgb(var(--border)/0.4)]">
            {/* UNDO / REDO CONTROLS */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleUndo}
              disabled={!campusStore.canUndo()}
              title="Undo (Ctrl+Z)"
              className="gap-1 shadow-xs"
            >
              <Undo2 className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span className="font-semibold text-xs">Undo</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleRedo}
              disabled={!campusStore.canRedo()}
              title="Redo (Ctrl+Y)"
              className="gap-1 shadow-xs"
            >
              <Redo2 className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span className="font-semibold text-xs">Redo</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowMobilePanel((prev) => !prev)}
              className="gap-1.5 shadow-xs lg:hidden border-[rgb(var(--border))]"
              title={showMobilePanel ? "Hide Object Creator Panel" : "Show Object Creator Panel"}
            >
              <Layers className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span className="font-semibold text-xs">{showMobilePanel ? "Hide Panel" : "Show Panel"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={toggleFullscreen}
              className="gap-1.5 shadow-xs"
              title={isFullscreen ? "Exit Full Screen" : "Full Screen View"}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4 text-[rgb(var(--primary))]" /> : <Maximize2 className="h-4 w-4 text-[rgb(var(--primary))]" />}
              <span className="font-semibold text-xs">{isFullscreen ? "Exit Fullscreen" : "Full Screen"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="gap-1.5 shadow-xs"
              title="Soft Refresh Campus Data (Preserves Fullscreen)"
            >
              <RefreshCw className={cn("h-4 w-4 text-[rgb(var(--primary))]", isRefreshing && "animate-spin")} />
              <span className="font-semibold text-xs">{isRefreshing ? "Refreshing..." : "Refresh"}</span>
            </Button>

            <Button
              size="sm"
              onClick={() => setShowPublishModal(true)}
              className="gap-1.5 shadow-xs bg-[rgb(var(--primary))] text-white font-semibold hover:brightness-110"
              title="Publish Digital Twin Graph to PostgreSQL Database"
            >
              <Rocket className="h-4 w-4" />
              <span className="font-semibold text-xs">Publish</span>
            </Button>



            {/* Whole Data Import/Export Engine */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".json"
              onChange={handleWholeDataInputChange}
              className="hidden"
            />

            <Button
              size="sm"
              variant="outline"
              onClick={handleDownloadWholeData}
              className="gap-1.5 shadow-xs border-blue-500/30 text-blue-600 dark:text-blue-400 hover:bg-blue-500/10"
              title="Download Complete Whole Graph Dataset JSON File"
            >
              <Download className="h-4 w-4" />
              <span className="font-semibold text-xs">Download Whole Data</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={handleTriggerWholeDataInput}
              className="gap-1.5 shadow-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10"
              title="Upload & Feed Whole Data JSON File"
            >
              <Upload className="h-4 w-4" />
              <span className="font-semibold text-xs">Feed Whole Data</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const res = campusStore.compactAllIds();
                setStoreData({ ...campusStore.getWorkingData() });
                toast({
                  type: "success",
                  title: "All Object IDs Shortened & Cleaned",
                  description: `Shortened ${res.stats.nodes} nodes, ${res.stats.edges} edges, ${res.stats.buildings} buildings, ${res.stats.destinations} rooms into clean short unique IDs!`,
                });
              }}
              className="gap-1.5 shadow-xs border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
              title="Shorten and clean all long object IDs across the campus graph"
            >
              <Hash className="h-4 w-4" />
              <span className="font-semibold text-xs">Shorten All IDs</span>
            </Button>

            <Link href="/admin/editor">
              <Button size="sm" variant="gradient" className="gap-2 shadow-xs">
                <Compass className="h-4 w-4" /> <span className="text-xs font-semibold">Open CAD Canvas</span> <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* 2-STEP WORKFLOW CONTAINER */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

        {/* STEP 1: ENTITY TYPE SELECTOR (4 COLS - Hidden by default on mobile unless toggled) */}
        <div className={cn("lg:col-span-4 space-y-3 transition-all duration-300 flex flex-col self-start", !showMobilePanel ? "hidden lg:block" : "block")}>
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--primary))] text-white text-xs font-extrabold shadow-sm">1</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[rgb(var(--fg))]">Select Object Type</h3>
            </div>
            <span className="text-xs font-semibold text-[rgb(var(--muted-fg))] font-mono bg-[rgb(var(--muted))] px-2 py-0.5 rounded-md">
              {Object.values(entityCounts).reduce((a, b) => a + b, 0)} Items
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {ENTITY_TYPES.map((item) => {
              const Icon = item.icon;
              const isSelected = selectedType === item.type;
              const count = entityCounts[item.type] || 0;

              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => {
                    setSelectedType(item.type);
                    setActiveTab(item.type);
                  }}
                  className={`group relative flex items-start gap-3.5 p-3.5 rounded-xl border text-left transition-all duration-200 ${isSelected
                      ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary)/0.08)] shadow-md ring-2 ring-[rgb(var(--primary)/0.3)]"
                      : "border-[rgb(var(--border))] bg-[rgb(var(--card))] hover:bg-[rgb(var(--muted)/0.6)] hover:border-[rgb(var(--border-strong))]"
                    }`}
                >
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105 ${isSelected
                        ? "bg-[rgb(var(--primary))] text-white shadow-md"
                        : "bg-[rgb(var(--muted))] text-[rgb(var(--muted-fg))]"
                      }`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-bold ${isSelected ? "text-[rgb(var(--primary))]" : "text-[rgb(var(--fg))]"}`}>
                        {item.label}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-extrabold px-2 py-0.5 rounded-full ${isSelected ? "bg-[rgb(var(--primary))] text-white" : "bg-[rgb(var(--muted))] text-[rgb(var(--muted-fg))]"}`}>
                          {count}
                        </span>
                        {isSelected && <CheckCircle2 className="h-4 w-4 text-[rgb(var(--primary))]" />}
                      </div>
                    </div>
                    <p className="text-[11px] text-[rgb(var(--muted-fg))] line-clamp-1 mt-0.5">
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* CONTEXTUAL ENTITY GUIDANCE CARD TO FILL REMAINING SPACE */}
          <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card)/0.6)] p-3.5 space-y-2 text-xs text-[rgb(var(--muted-fg))] shadow-xs mt-auto">
            <div className="flex items-center justify-between font-bold text-[rgb(var(--fg))]">
              <span className="flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-[rgb(var(--primary))]" /> Active Selection</span>
              <Badge variant="primary" className="text-[10px] uppercase font-bold">{ENTITY_TYPES.find((t) => t.type === selectedType)?.label}</Badge>
            </div>
            <p className="text-[11px] leading-relaxed text-[rgb(var(--muted-fg))]">
              {selectedType === "BUILDING" && "Configure 4-corner polygon footprints, GPS center coordinates, and floor counts for campus buildings."}
              {selectedType === "NODE" && "Manage walkable junction nodes, GPS coordinates, and user visibility toggle."}
              {selectedType === "ROOM" && "Create room destinations, link them to specific floors and entry nodes for search and navigation."}
              {selectedType === "EDGE" && "Connect walkable corridors and EV transit routes between existing navigation nodes."}
              {selectedType === "STAIR" && "Link multiple floors together with multi-level stairway connector nodes."}
              {selectedType === "LIFT" && "Link accessible elevators across multiple building floor levels."}
              {selectedType === "OBSTACLE" && "Add temporary or permanent hazard zones to automatically detour routing."}
              {selectedType === "FLOOR" && "Create and order architectural floor levels within campus buildings."}
              {selectedType === "PHOTO" && "Upload reference photos to verify physical landmarks and nodes."}
            </p>
          </div>
        </div>

        {/* STEP 2: DYNAMIC FORM CONTAINER (8 COLS) */}
        <div className="@container lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[rgb(var(--primary))] text-white text-xs font-extrabold shadow-sm">2</span>
              <h3 className="text-sm font-bold uppercase tracking-wider text-[rgb(var(--fg))]">
                {ENTITY_TYPES.find((t) => t.type === selectedType)?.label} Data Entry Form
              </h3>
            </div>

            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handlePasteEntity}
              className="h-8 text-xs gap-1.5 border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10 shadow-sm"
              title="Paste copied object data into form"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              <span>Paste {copiedEntityPayload ? `Copied ${copiedEntityPayload.category}` : "Copied Data"}</span>
            </Button>
          </div>

          <Card className="p-6 space-y-6 border-[rgb(var(--border))] shadow-md bg-[rgb(var(--card))]">

            {/* BUILDING FORM */}
            {selectedType === "BUILDING" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building Name *</label>
                    <Input
                      placeholder="e.g. Science & Tech Block A"
                      value={buildingForm.name}
                      onChange={(e) => setBuildingForm({ ...buildingForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Category</label>
                    <Input
                      placeholder="e.g. Academic / Administration"
                      value={buildingForm.category}
                      onChange={(e) => setBuildingForm({ ...buildingForm, category: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Number of Upper Floors (0 = Ground Floor only)</label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={buildingForm.floorsCount}
                      onChange={(e) => {
                        const val = parseInt(e.target.value);
                        setBuildingForm({ ...buildingForm, floorsCount: isNaN(val) ? 0 : Math.max(0, val) });
                      }}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building Description</label>
                    <Input
                      placeholder="e.g. Main academic building with laboratories"
                      value={buildingForm.description}
                      onChange={(e) => setBuildingForm({ ...buildingForm, description: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>

                {/* Dynamic Building GPS Footprint Corners */}
                <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-4 w-4 text-[rgb(var(--primary))]" />
                      <div>
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-[rgb(var(--fg))]">
                          Building Geographic Footprint Corners (Latitude + Longitude)
                        </h4>
                        <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                          Polygon vertices in sequence: 1 → 2 → ... → N → 1 (automatically closed). Minimum 3 corners required.
                        </p>
                      </div>
                    </div>
                    <Badge variant="primary" className="text-[10px] font-bold shrink-0">
                      {buildingForm.corners.length} Corners Footprint
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 @md:grid-cols-2 @3xl:grid-cols-4 gap-3 text-xs">
                    {buildingForm.corners.map((c, idx) => (
                      <div key={`corner-${idx}`} className="space-y-1.5 bg-[rgb(var(--card))] p-3 rounded-lg border shadow-xs relative">
                        <div className="flex items-center justify-between mb-1 border-b pb-1">
                          <span className="font-bold text-[rgb(var(--primary))] text-[11px]">
                            Corner {idx + 1}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[11px] text-red-500 hover:text-red-600 hover:bg-red-500/10 disabled:opacity-30"
                            disabled={buildingForm.corners.length <= 3}
                            onClick={() => handleRemoveBuildingCorner(idx)}
                            title={buildingForm.corners.length <= 3 ? "Minimum 3 corners required for a polygon" : "Remove corner"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div>
                          <label className="text-[10px] text-[rgb(var(--muted-fg))] font-semibold">Latitude</label>
                          <Input
                            placeholder="11.XXXXXX"
                            value={c.lat}
                            onChange={(e) => handleUpdateBuildingCorner(idx, "lat", e.target.value)}
                            className="text-xs h-8 font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] text-[rgb(var(--muted-fg))] font-semibold">Longitude</label>
                          <Input
                            placeholder="77.XXXXXX"
                            value={c.lng}
                            onChange={(e) => handleUpdateBuildingCorner(idx, "lng", e.target.value)}
                            className="text-xs h-8 font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[rgb(var(--border)/0.4)]">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleAddBuildingCorner}
                      className="gap-1.5 border-dashed border-[rgb(var(--primary)/0.5)] text-[rgb(var(--primary))] hover:bg-[rgb(var(--primary)/0.08)] font-semibold text-xs"
                    >
                      <Plus className="h-4 w-4" /> + Add Corner
                    </Button>
                    <span className="text-[11px] text-[rgb(var(--muted-fg))] font-medium">
                      Vertex Order: {buildingForm.corners.map((_, i) => i + 1).join(" → ")} → 1
                    </span>
                  </div>
                </div>

                {/* Footprint Live Preview */}
                <div className="rounded-xl border bg-black/90 p-4 space-y-2 text-white shadow-inner">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold flex items-center gap-1.5 text-emerald-400">
                      <Eye className="h-3.5 w-3.5" /> Building Footprint Live Preview
                    </span>
                    <span className="text-[10px] text-[rgb(var(--muted-fg))] font-mono">SVG Footprint Render</span>
                  </div>

                  <div className="relative h-44 w-full rounded-lg bg-zinc-950/90 border border-zinc-800 flex items-center justify-center overflow-hidden">
                    <svg className="h-full w-full" viewBox="0 0 300 180">
                      <defs>
                        <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
                          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#27272a" strokeWidth="0.5" />
                        </pattern>
                      </defs>
                      <rect width="100%" height="100%" fill="url(#gridPattern)" />

                      <polygon
                        points={buildingFootprintPoints.svgPoints}
                        fill="rgba(59, 130, 246, 0.3)"
                        stroke="#3b82f6"
                        strokeWidth="2.5"
                        strokeDasharray="4 2"
                      />



                      <text x="10" y="170" fill="#a1a1aa" fontSize="9">
                        Bounds: Lat [{buildingFootprintPoints.minLat.toFixed(9)} .. {buildingFootprintPoints.maxLat.toFixed(9)}], Lng [{buildingFootprintPoints.minLng.toFixed(9)} .. {buildingFootprintPoints.maxLng.toFixed(9)}]
                      </text>
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {/* STAIR FORM (WITH CONNECTING FLOORS CHECKBOXES) */}
            {selectedType === "STAIR" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Staircase Name *</label>
                    <Input
                      placeholder="e.g. West Wing Staircase A"
                      value={stairForm.name}
                      onChange={(e) => setStairForm({ ...stairForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Selected Building *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={stairForm.buildingId}
                      onChange={(e) => handleStairBuildingChange(e.target.value)}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({storeData.floors.filter((f) => f.buildingId === b.id).length} Floors)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Connecting Floors Checkbox Selector */}
                <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[rgb(var(--fg))] flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-[rgb(var(--primary))]" /> Connecting Floors of Selected Building *
                    </span>
                    <span className="text-xs font-semibold text-[rgb(var(--primary))] font-mono">
                      {stairForm.selectedFloorIds.length} Floors Selected
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                    {storeData.floors
                      .filter((f) => f.buildingId === stairForm.buildingId)
                      .map((fl) => {
                        const isChecked = stairForm.selectedFloorIds.includes(fl.id);
                        return (
                          <label
                            key={fl.id}
                            className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${isChecked
                                ? "border-[rgb(var(--primary))] bg-[rgb(var(--card))] text-[rgb(var(--primary))] shadow-sm"
                                : "border-[rgb(var(--border))] bg-[rgb(var(--card))]/60 text-[rgb(var(--muted-fg))]"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setStairForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: [...prev.selectedFloorIds, fl.id],
                                  }));
                                } else {
                                  setStairForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: prev.selectedFloorIds.filter((id) => id !== fl.id),
                                  }));
                                }
                              }}
                              className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))] focus:ring-[rgb(var(--primary))]"
                            />
                            <span>{fl.name} (Level {fl.ordinal})</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude</label>
                    <Input
                      value={stairForm.lat}
                      onChange={(e) => setStairForm({ ...stairForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude</label>
                    <Input
                      value={stairForm.lng}
                      onChange={(e) => setStairForm({ ...stairForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* LIFT FORM (WITH CONNECTING FLOORS CHECKBOXES) */}
            {selectedType === "LIFT" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Lift / Elevator Name *</label>
                    <Input
                      placeholder="e.g. Central Elevator 1"
                      value={liftForm.name}
                      onChange={(e) => setLiftForm({ ...liftForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))] font-medium">Selected Building *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={liftForm.buildingId}
                      onChange={(e) => handleLiftBuildingChange(e.target.value)}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({storeData.floors.filter((f) => f.buildingId === b.id).length} Floors)
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Served Floors Checkbox Selector */}
                <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[rgb(var(--fg))] flex items-center gap-1.5">
                      <RefreshCw className="h-4 w-4 text-[rgb(var(--primary))]" /> Served Floors of Selected Building *
                    </span>
                    <span className="text-xs font-semibold text-[rgb(var(--primary))] font-mono">
                      {liftForm.selectedFloorIds.length} Floors Served
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                    {storeData.floors
                      .filter((f) => f.buildingId === liftForm.buildingId)
                      .map((fl) => {
                        const isChecked = liftForm.selectedFloorIds.includes(fl.id);
                        return (
                          <label
                            key={fl.id}
                            className={`flex items-center gap-2.5 p-2.5 rounded-lg border text-xs font-semibold cursor-pointer transition-all ${isChecked
                                ? "border-[rgb(var(--primary))] bg-[rgb(var(--card))] text-[rgb(var(--primary))] shadow-sm"
                                : "border-[rgb(var(--border))] bg-[rgb(var(--card))]/60 text-[rgb(var(--muted-fg))]"
                              }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setLiftForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: [...prev.selectedFloorIds, fl.id],
                                  }));
                                } else {
                                  setLiftForm((prev) => ({
                                    ...prev,
                                    selectedFloorIds: prev.selectedFloorIds.filter((id) => id !== fl.id),
                                  }));
                                }
                              }}
                              className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))] focus:ring-[rgb(var(--primary))]"
                            />
                            <span>{fl.name} (Level {fl.ordinal})</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude</label>
                    <Input
                      value={liftForm.lat}
                      onChange={(e) => setLiftForm({ ...liftForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude</label>
                    <Input
                      value={liftForm.lng}
                      onChange={(e) => setLiftForm({ ...liftForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* EDGE CREATION FORM (WITH SMART PATH SPLITTING) */}
            {selectedType === "EDGE" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">First Node *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={edgeForm.firstNodeId}
                      onChange={(e) => setEdgeForm({ ...edgeForm, firstNodeId: e.target.value })}
                    >
                      <option value="">-- Select First Node --</option>
                      {storeData.nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name || n.id} ({n.type} · Floor: {n.floorId})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Second Node *</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={edgeForm.secondNodeId}
                      onChange={(e) => setEdgeForm({ ...edgeForm, secondNodeId: e.target.value })}
                    >
                      <option value="">-- Select Second Node --</option>
                      {storeData.nodes
                        .filter((n) => n.id !== edgeForm.firstNodeId)
                        .map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.name || n.id} ({n.type} · Floor: {n.floorId})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Edge Type</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={edgeForm.edgeType}
                      onChange={(e) => setEdgeForm({ ...edgeForm, edgeType: e.target.value as EdgeType })}
                    >
                      <option value="WALK">Pedestrian Walkway</option>
                      <option value="ROAD">Outdoor Street / Road</option>
                      <option value="STAIRS">Staircase Connection</option>
                      <option value="LIFT">Elevator / Lift Connection</option>
                      <option value="RAMP">Accessible Ramp</option>
                      <option value="ESCALATOR">Escalator</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))] font-mono">
                      Distance: <span className="text-[rgb(var(--primary))]">AUTO CALCULATED FROM GPS</span>
                    </label>
                    <Input
                      disabled
                      value={edgeSplitInfo ? `${edgeSplitInfo.edgesToCreate[0]?.distance || 10} meters (Calculated)` : "Select nodes"}
                      className="mt-1.5 bg-[rgb(var(--muted))] text-xs font-semibold"
                    />
                  </div>
                </div>

                {/* REQUIRED Path Type Selection */}
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))] block mb-1.5">
                    Path Type <span className="text-red-500">* (Required)</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <label
                      className={cn(
                        "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all",
                        edgeForm.pathType === "EV"
                          ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500 shadow-xs"
                          : "border-[rgb(var(--border))] bg-[rgb(var(--bg))] hover:bg-[rgb(var(--muted)/0.5)]"
                      )}
                    >
                      <input
                        type="radio"
                        name="edgePathTypeRadio"
                        value="EV"
                        checked={edgeForm.pathType === "EV"}
                        onChange={() => setEdgeForm({ ...edgeForm, pathType: "EV" })}
                        className="mt-0.5 h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                      />
                      <div>
                        <div className="font-bold text-xs flex items-center gap-1.5 text-[rgb(var(--fg))]">
                          EV Path
                        </div>
                        <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                          Electric vehicle + walking
                        </p>
                      </div>
                    </label>

                    <label
                      className={cn(
                        "flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all",
                        edgeForm.pathType === "WALK"
                          ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500 shadow-xs"
                          : "border-[rgb(var(--border))] bg-[rgb(var(--bg))] hover:bg-[rgb(var(--muted)/0.5)]"
                      )}
                    >
                      <input
                        type="radio"
                        name="edgePathTypeRadio"
                        value="WALK"
                        checked={edgeForm.pathType === "WALK"}
                        onChange={() => setEdgeForm({ ...edgeForm, pathType: "WALK" })}
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

                {edgeSplitInfo && (
                  <div className="rounded-xl border border-[rgb(var(--primary)/0.3)] bg-[rgb(var(--primary)/0.05)] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[rgb(var(--primary))] flex items-center gap-1.5">
                        <Sparkles className="h-4 w-4" /> Live Automatic Distance & Path Inspection
                      </span>
                      <Badge variant="primary">Distance Auto-Calculated</Badge>
                    </div>

                    {edgeSplitInfo.hasIntermediates ? (
                      <div className="space-y-2">
                        <div className="flex items-start gap-2 text-xs text-[rgb(var(--fg))]">
                          <Split className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                          <div>
                            <span className="font-bold text-amber-600 dark:text-amber-400">
                              Intermediate Node(s) Detected! Connection will be automatically split:
                            </span>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 font-medium">
                              {edgeSplitInfo.edgesToCreate.map((item, idx) => (
                                <span key={idx} className="inline-flex items-center gap-1 bg-[rgb(var(--card))] px-2 py-1 rounded border text-[11px]">
                                  <span>{item.fromNode.name || item.fromNode.id.slice(0, 6)}</span>
                                  <ArrowRight className="h-3 w-3 text-emerald-500" />
                                  <span>{item.toNode.name || item.toNode.id.slice(0, 6)}</span>
                                  <span className="text-[10px] text-[rgb(var(--muted-fg))]">({item.distance}m)</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-[rgb(var(--fg))] flex items-center justify-between">
                        <span>Direct Edge Connection (No intermediate nodes detected on straight line segment).</span>
                        <span className="font-bold text-[rgb(var(--primary))]">
                          Calculated Distance: {edgeSplitInfo.edgesToCreate[0]?.distance || 10}m
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* NODE FORM */}
            {selectedType === "NODE" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Node Name *</label>
                    <Input
                      placeholder="e.g. Corridor Junction 1"
                      value={nodeForm.name}
                      onChange={(e) => setNodeForm({ ...nodeForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Node Type</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={nodeForm.type}
                      onChange={(e) => setNodeForm({ ...nodeForm, type: e.target.value as NodeType })}
                    >
                      <option value="CORRIDOR">Corridor Waypoint</option>
                      <option value="JUNCTION">Junction</option>
                      <option value="ROOM">Room Entry</option>
                      <option value="ENTRANCE">Building Entrance</option>
                      <option value="OUTDOOR">Outdoor Path</option>
                      <option value="STAIR">Stairway Landing</option>
                      <option value="LIFT">Elevator Landing</option>
                      <option value="WASHROOM">Washroom Node</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={nodeForm.buildingId}
                      onChange={(e) => setNodeForm({ ...nodeForm, buildingId: e.target.value })}
                    >
                      <option value="">Outdoor / Unassigned</option>
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={nodeForm.floorId}
                      onChange={(e) => setNodeForm({ ...nodeForm, floorId: e.target.value })}
                    >
                      <option value="f-out">Outdoor Area</option>
                      {storeData.floors
                        .filter((f) => !nodeForm.buildingId || f.buildingId === nodeForm.buildingId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude Coordinate</label>
                    <Input
                      value={nodeForm.lat}
                      onChange={(e) => setNodeForm({ ...nodeForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude Coordinate</label>
                    <Input
                      value={nodeForm.lng}
                      onChange={(e) => setNodeForm({ ...nodeForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Visible to user</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={nodeForm.visibleToUser ? "YES" : "NO"}
                      onChange={(e) => setNodeForm({ ...nodeForm, visibleToUser: e.target.value === "YES" })}
                    >
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                    </select>
                  </div>
                </div>

                {/* EXISTING NODE VISIBILITY MANAGEMENT CARD (COMBINED SEARCH & DROPDOWN) */}
                <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-4 space-y-3.5 mt-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[rgb(var(--primary)/0.15)] pb-2.5">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-[rgb(var(--primary))]" />
                      <div>
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-[rgb(var(--fg))]">
                          Set Visibility on Existing Navigation Node
                        </h4>
                        <p className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5">
                          Type any letter to search existing nodes, choose from the auto-suggest list, and set Visible to user.
                        </p>
                      </div>
                    </div>
                    {existingSelectedNodeId && (
                      <Badge variant={existingNodeVisibleToUser ? "success" : "default"} className="text-[11px]">
                        Currently: {existingNodeVisibleToUser ? "YES (Visible)" : "NO (Hidden)"}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
                    {/* 1. Combined Search Input & Autocomplete Dropdown List */}
                    <div className="md:col-span-6 relative" ref={nodeSearchContainerRef}>
                      <label className="text-xs font-bold text-[rgb(var(--fg))] block mb-1.5">
                        Search & Select Node (Type to show list)
                      </label>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                        <Input
                          placeholder="Type node name, floor, or ID..."
                          value={existingNodeSearchText}
                          onChange={(e) => {
                            setExistingNodeSearchText(e.target.value);
                            setIsNodeSearchOpen(true);
                          }}
                          onFocus={() => setIsNodeSearchOpen(true)}
                          className="pl-8 pr-8 text-xs h-9"
                        />
                        {existingNodeSearchText && (
                          <button
                            type="button"
                            onClick={() => {
                              setExistingNodeSearchText("");
                              setExistingSelectedNodeId("");
                              setIsNodeSearchOpen(true);
                            }}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {/* Dropdown Suggestions List (shown when typing or focused) */}
                      {isNodeSearchOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1 z-50 max-h-56 overflow-y-auto rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] shadow-xl p-1 space-y-0.5 scrollbar-thin">
                          {filteredExistingNodesForVisibility.length === 0 ? (
                            <div className="p-3 text-center text-xs text-[rgb(var(--muted-fg))]">
                              No matching nodes found for "{existingNodeSearchText}"
                            </div>
                          ) : (
                            filteredExistingNodesForVisibility.map((n) => {
                              const isVis = n.visibleToUser !== undefined ? n.visibleToUser : false;
                              const isSelected = n.id === existingSelectedNodeId;
                              return (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => handleSelectNodeItem(n)}
                                  className={cn(
                                    "w-full flex items-center justify-between p-2 rounded-lg text-left text-xs transition-colors",
                                    isSelected
                                      ? "bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))] font-bold"
                                      : "hover:bg-[rgb(var(--muted)/0.5)] text-[rgb(var(--fg))]"
                                  )}
                                >
                                  <div className="min-w-0 pr-2">
                                    <div className="font-bold truncate">{n.name || n.id}</div>
                                    <div className="text-[10px] text-[rgb(var(--muted-fg))] font-mono">
                                      {n.type} · Floor: {n.floorId || "Outdoor"}
                                    </div>
                                  </div>
                                  <Badge
                                    variant={isVis ? "success" : "default"}
                                    className="text-[9px] shrink-0 font-bold"
                                  >
                                    {isVis ? "YES" : "NO"}
                                  </Badge>
                                </button>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>

                    {/* 2. Visibility Option YES / NO */}
                    <div className="md:col-span-3">
                      <label className="text-xs font-bold text-[rgb(var(--fg))] block mb-1.5">
                        Visible to user
                      </label>
                      <select
                        className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-bold h-9"
                        value={existingNodeVisibleToUser ? "YES" : "NO"}
                        onChange={(e) => setExistingNodeVisibleToUser(e.target.value === "YES")}
                      >
                        <option value="NO">NO (Hidden)</option>
                        <option value="YES">YES (Visible)</option>
                      </select>
                    </div>

                    {/* 3. Apply Button */}
                    <div className="md:col-span-3">
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleApplyExistingNodeVisibility}
                        disabled={!existingSelectedNodeId}
                        className="w-full h-9 gap-1.5 text-xs font-bold shadow-sm"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Save Visibility
                      </Button>
                    </div>
                  </div>

                  {existingSelectedNodeId && (
                    <div className="text-[11px] text-[rgb(var(--muted-fg))] pt-1 border-t border-[rgb(var(--border)/0.4)]">
                      Selected Node: <strong className="text-[rgb(var(--fg))]">{storeData.nodes.find((n) => n.id === existingSelectedNodeId)?.name || existingSelectedNodeId}</strong> (Floor: {storeData.nodes.find((n) => n.id === existingSelectedNodeId)?.floorId || "Outdoor"})
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ROOM (DESTINATION) FORM */}
            {selectedType === "ROOM" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Room Name *</label>
                    <Input
                      placeholder="e.g. Advanced Physics Lab"
                      value={roomForm.name}
                      onChange={(e) => setRoomForm({ ...roomForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Room Number</label>
                    <Input
                      placeholder="e.g. LH-302"
                      value={roomForm.roomNumber}
                      onChange={(e) => setRoomForm({ ...roomForm, roomNumber: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Category</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={roomForm.category}
                      onChange={(e) => setRoomForm({ ...roomForm, category: e.target.value })}
                    >
                      <option value="Classroom">Classroom / Lecture Hall</option>
                      <option value="Laboratory">Laboratory</option>
                      <option value="Office">Faculty Office</option>
                      <option value="Staff Room">Staff Room</option>
                      <option value="Seminar Hall">Seminar Hall</option>
                      <option value="Library">Library</option>
                      <option value="Washroom">Washroom</option>
                      <option value="Store Room">Store Room</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={roomForm.buildingId}
                      onChange={(e) => setRoomForm({ ...roomForm, buildingId: e.target.value })}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={roomForm.floorId}
                      onChange={(e) => setRoomForm({ ...roomForm, floorId: e.target.value })}
                    >
                      {storeData.floors
                        .filter((f) => !roomForm.buildingId || f.buildingId === roomForm.buildingId)
                        .map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude</label>
                    <Input
                      value={roomForm.lat}
                      onChange={(e) => setRoomForm({ ...roomForm, lat: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude</label>
                    <Input
                      value={roomForm.lng}
                      onChange={(e) => setRoomForm({ ...roomForm, lng: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* OBSTACLE FORM */}
            {selectedType === "OBSTACLE" && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Obstacle Reason / Title *</label>
                    <Input
                      placeholder="e.g. Floor maintenance / Spill zone"
                      value={obstacleForm.name}
                      onChange={(e) => setObstacleForm({ ...obstacleForm, name: e.target.value })}
                      className="mt-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Obstacle Severity</label>
                    <select
                      className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                      value={obstacleForm.obstacleType}
                      onChange={(e) => setObstacleForm({ ...obstacleForm, obstacleType: e.target.value as any })}
                    >
                      <option value="LOW">Low (Caution)</option>
                      <option value="MEDIUM">Medium (Avoid if possible)</option>
                      <option value="HIGH">High (Blocked)</option>
                      <option value="CRITICAL">Critical (Danger Hazard)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[rgb(var(--fg))]">Blocked Radius (Meters)</label>
                    <Input
                      type="number"
                      value={obstacleForm.radius}
                      onChange={(e) => setObstacleForm({ ...obstacleForm, radius: parseFloat(e.target.value) || 10 })}
                      className="mt-1.5"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs font-bold text-[rgb(var(--fg))]">Latitude *</label>
                      <Input
                        placeholder="e.g. 11.012345"
                        value={obstacleForm.lat}
                        onChange={(e) => setObstacleForm({ ...obstacleForm, lat: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[rgb(var(--fg))]">Longitude *</label>
                      <Input
                        placeholder="e.g. 77.012345"
                        value={obstacleForm.lng}
                        onChange={(e) => setObstacleForm({ ...obstacleForm, lng: e.target.value })}
                        className="mt-1.5"
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* FLOOR FORM */}
            {selectedType === "FLOOR" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))]">Building *</label>
                  <select
                    className="mt-1.5 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2.5 text-sm font-medium"
                    value={floorForm.buildingId}
                    onChange={(e) => setFloorForm({ ...floorForm, buildingId: e.target.value })}
                  >
                    {storeData.buildings.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor Name</label>
                  <Input
                    placeholder="e.g. 2nd Floor Exhibition"
                    value={floorForm.name}
                    onChange={(e) => setFloorForm({ ...floorForm, name: e.target.value })}
                    className="mt-1.5"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[rgb(var(--fg))]">Floor Ordinal</label>
                  <Input
                    type="number"
                    value={floorForm.ordinal}
                    onChange={(e) => setFloorForm({ ...floorForm, ordinal: parseInt(e.target.value) || 0 })}
                    className="mt-1.5"
                  />
                </div>
              </div>
            )}

            {/* DEDICATED ADD PHOTO FORM */}
            {selectedType === "PHOTO" && (
              <div className="space-y-6 animate-in fade-in duration-200">
                {/* STEP 1: SELECT NODE */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[rgb(var(--fg))] flex items-center gap-1.5">
                      <Waypoints className="h-4 w-4 text-[rgb(var(--primary))]" /> 1. Select Node *
                    </label>
                    <span className="text-[11px] text-[rgb(var(--muted-fg))] font-mono">
                      {storeData.nodes.length} Nodes in Campus
                    </span>
                  </div>

                  {/* UNIFIED SEARCHABLE NODE COMBOBOX */}
                  <div className="relative" ref={nodeDropdownRef}>
                    <div className="relative flex items-center">
                      <Search className="absolute left-3.5 h-4 w-4 text-[rgb(var(--muted-fg))] pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search and select node by name, ID, or floor..."
                        value={
                          isNodeDropdownOpen
                            ? photoNodeSearchQuery
                            : selectedPhotoNode
                            ? `${selectedPhotoNode.photoUrl ? "" : ""}${selectedPhotoNode.name || `Node ${selectedPhotoNode.id.slice(0, 8)}`} (${selectedPhotoNode.type}) · ${storeData.floors.find((f) => f.id === selectedPhotoNode.floorId)?.name || (selectedPhotoNode.floorId === "f-out" ? "Outdoor" : selectedPhotoNode.floorId)}`
                            : ""
                        }
                        onFocus={() => {
                          setIsNodeDropdownOpen(true);
                          if (selectedPhotoNode && !photoNodeSearchQuery) {
                            setPhotoNodeSearchQuery(selectedPhotoNode.name || "");
                          }
                        }}
                        onChange={(e) => {
                          setPhotoNodeSearchQuery(e.target.value);
                          if (!isNodeDropdownOpen) setIsNodeDropdownOpen(true);
                        }}
                        className="w-full rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--bg))] pl-10 pr-20 py-2.5 text-xs font-medium text-[rgb(var(--fg))] placeholder-[rgb(var(--muted-fg))] focus:outline-none focus:ring-2 focus:ring-[rgb(var(--primary)/0.3)] focus:border-[rgb(var(--primary))] transition-all shadow-xs"
                      />
                      <div className="absolute right-2.5 flex items-center gap-1">
                        {selectedPhotoNode && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPhotoManagerNodeId("");
                              setPhotoManagerFile("");
                              setPhotoManagerPhysicalVerified(false);
                              setPhotoNodeSearchQuery("");
                            }}
                            className="p-1 rounded-md text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))] hover:bg-[rgb(var(--muted))] transition-colors cursor-pointer"
                            title="Clear Selection"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setIsNodeDropdownOpen((prev) => !prev)}
                          className="p-1 rounded-md text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))] transition-colors cursor-pointer"
                          title="Toggle Options List"
                        >
                          <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", isNodeDropdownOpen && "rotate-180")} />
                        </button>
                      </div>
                    </div>

                    {/* FLOATING DROPDOWN LIST */}
                    {isNodeDropdownOpen && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-1.5 shadow-2xl scrollbar-thin animate-in fade-in zoom-in-95 duration-150">
                        {filteredPhotoNodes.length === 0 ? (
                          <div className="p-3 text-center text-xs text-[rgb(var(--muted-fg))]">
                            No campus nodes found matching &quot;{photoNodeSearchQuery}&quot;
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            {filteredPhotoNodes.map((n) => {
                              const fl = storeData.floors.find((f) => f.id === n.floorId);
                              const floorLabel = fl ? fl.name : n.floorId === "f-out" ? "Outdoor Area" : n.floorId;
                              const isSelected = n.id === photoManagerNodeId;
                              const hasPhoto = Boolean(n.photoUrl);

                              return (
                                <button
                                  key={n.id}
                                  type="button"
                                  onClick={() => {
                                    setPhotoManagerNodeId(n.id);
                                    setPhotoManagerFile(n.photoUrl || "");
                                    setPhotoManagerPhysicalVerified(Boolean(n.physicalVerified));
                                    setPhotoNodeSearchQuery("");
                                    setIsNodeDropdownOpen(false);
                                  }}
                                  className={cn(
                                    "w-full flex items-center justify-between gap-2 p-2 rounded-lg text-left text-xs transition-colors cursor-pointer",
                                    isSelected
                                      ? "bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))] font-bold"
                                      : "hover:bg-[rgb(var(--muted)/0.6)] text-[rgb(var(--fg))]"
                                  )}
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold truncate">
                                        {n.name || `Node ${n.id.slice(0, 8)}`}
                                      </span>
                                      <Badge variant="default" className="text-[9px] px-1.5 py-0 uppercase border border-[rgb(var(--border))]">
                                        {n.type}
                                      </Badge>
                                    </div>
                                    <div className="text-[10px] text-[rgb(var(--muted-fg))] truncate font-mono">
                                      ID: {n.id} · {floorLabel}
                                    </div>
                                  </div>

                                  <div className="shrink-0 flex items-center gap-1.5">
                                    {hasPhoto ? (
                                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-500/15 px-1.5 py-0.5 rounded-full">
                                        <Camera className="h-3 w-3" /> Photo
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-[rgb(var(--muted-fg))]">
                                        ○ No Photo
                                      </span>
                                    )}
                                    {isSelected && <Check className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Selected Node Details Card */}
                  {selectedPhotoNode ? (
                    <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--muted)/0.25)] p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgb(var(--primary)/0.15)] text-[rgb(var(--primary))] font-bold text-xs">
                            </span>
                          <div>
                            <h4 className="font-bold text-sm text-[rgb(var(--fg))]">
                              {selectedPhotoNode.name || `Node ${selectedPhotoNode.id}`}
                            </h4>
                            <p className="text-[11px] font-mono text-[rgb(var(--muted-fg))]">Node ID: {selectedPhotoNode.id}</p>
                          </div>
                        </div>
                        {selectedPhotoNode.photoUrl ? (
                          <Badge className="bg-emerald-600 text-white text-[10px] gap-1">
                            <Camera className="h-3 w-3" /> Photo Attached
                          </Badge>
                        ) : (
                          <span className="text-[11px] text-[rgb(var(--muted-fg))] bg-[rgb(var(--muted))] px-2.5 py-1 rounded-full">
                            No Photo Attached
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs border-t pt-2.5 text-[rgb(var(--muted-fg))]">
                        <div>
                          <span className="block text-[10px] uppercase font-bold text-[rgb(var(--muted-fg))]">Type</span>
                          <span className="font-semibold text-[rgb(var(--fg))]">{selectedPhotoNode.type}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase font-bold text-[rgb(var(--muted-fg))]">Floor</span>
                          <span className="font-semibold text-[rgb(var(--fg))]">
                            {storeData.floors.find((f) => f.id === selectedPhotoNode.floorId)?.name || (selectedPhotoNode.floorId === "f-out" ? "Outdoor Area" : selectedPhotoNode.floorId)}
                          </span>
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase font-bold text-[rgb(var(--muted-fg))]">Latitude</span>
                          <span className="font-mono text-[11px] text-[rgb(var(--fg))]">{selectedPhotoNode.lat?.toFixed(8) ?? "Canvas"}</span>
                        </div>
                        <div>
                          <span className="block text-[10px] uppercase font-bold text-[rgb(var(--muted-fg))]">Longitude</span>
                          <span className="font-mono text-[11px] text-[rgb(var(--fg))]">{selectedPhotoNode.lng?.toFixed(8) ?? "Canvas"}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 text-center border border-dashed rounded-xl text-xs text-[rgb(var(--muted-fg))]">
                      Please select a node above to view its attributes and attach a reference photo.
                    </div>
                  )}
                </div>

                {/* STEP 2: SELECT PICTURE & PREVIEW */}
                {selectedPhotoNode && (
                  <div className="space-y-3 border-t pt-4">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-[rgb(var(--fg))] flex items-center gap-1.5">
                        <Camera className="h-4 w-4 text-[rgb(var(--primary))]" /> 2. Select Picture & Preview *
                      </label>
                      {photoManagerFile && (
                        <span className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                          <Check className="h-3 w-3" /> Image Ready
                        </span>
                      )}
                    </div>

                    <input
                      ref={dedicatedPhotoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                      onChange={handleDedicatedPhotoUpload}
                      className="hidden"
                    />

                    {photoManagerFile ? (
                      <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4 space-y-3">
                        <div className="relative w-full overflow-hidden rounded-xl border border-[rgb(var(--border))] bg-transparent flex items-center justify-center">
                          <img
                            src={photoManagerFile}
                            alt="Selected Reference Preview"
                            className="w-full h-auto max-h-64 object-contain rounded-xl"
                          />
                          <button
                            type="button"
                            onClick={() => setViewingPhotoNode({
                              id: selectedPhotoNode.id,
                              name: selectedPhotoNode.name || `Node ${selectedPhotoNode.id}`,
                              photoUrl: photoManagerFile,
                              lat: selectedPhotoNode.lat,
                              lng: selectedPhotoNode.lng,
                              physicalVerified: photoManagerPhysicalVerified,
                            })}
                            className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors cursor-pointer"
                            title="View Fullscreen Preview"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => dedicatedPhotoInputRef.current?.click()}
                            className="text-xs gap-1.5 h-8"
                          >
                            <RotateCcw className="h-3.5 w-3.5" /> Change Picture / Replace
                          </Button>

                          {selectedPhotoNode.photoUrl && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={handleDedicatedRemovePhoto}
                              className="text-xs text-red-500 border-red-500/30 hover:bg-red-500/10 gap-1.5 h-8"
                            >
                              <Trash2 className="h-3.5 w-3.5" /> Remove Photo from Node
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => dedicatedPhotoInputRef.current?.click()}
                        className="flex flex-col items-center justify-center p-8 border-2 border-dashed rounded-xl bg-[rgb(var(--muted)/0.15)] hover:bg-[rgb(var(--muted)/0.3)] transition-colors cursor-pointer text-center space-y-2"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgb(var(--primary)/0.1)] text-[rgb(var(--primary))]">
                          <Upload className="h-6 w-6" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-[rgb(var(--fg))]">Choose Image from Device</p>
                          <p className="text-xs text-[rgb(var(--muted-fg))]">Supports JPG, PNG, WebP, GIF, or SVG (Max 5MB)</p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            dedicatedPhotoInputRef.current?.click();
                          }}
                          className="text-xs gap-1.5 mt-2"
                        >
                          <Upload className="h-3.5 w-3.5" /> Browse Image File
                        </Button>
                      </div>
                    )}

                    {/* Physical Location Verification Toggle */}
                    <div className="rounded-lg border p-3 bg-[rgb(var(--muted)/0.15)]">
                      <label className="flex items-center gap-2.5 text-xs font-semibold text-[rgb(var(--fg))] cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={photoManagerPhysicalVerified}
                          onChange={(e) => setPhotoManagerPhysicalVerified(e.target.checked)}
                          className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))]"
                        />
                        <span>Physical Location Verified on Campus</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Submit Action */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t">
              {selectedType !== "PHOTO" && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePasteEntity}
                  className="gap-1.5 border-indigo-500/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/10"
                >
                  <ClipboardPaste className="h-4 w-4" /> Paste Copied Data
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (selectedType === "PHOTO") {
                    setPhotoManagerNodeId("");
                    setPhotoManagerFile("");
                    setPhotoManagerPhysicalVerified(false);
                    setPhotoNodeSearchQuery("");
                  } else {
                    handleResetForm();
                  }
                }}
              >
                Reset Form
              </Button>
              <Button
                type="button"
                variant="gradient"
                onClick={handleCreateEntity}
                disabled={selectedType === "PHOTO" && (!photoManagerNodeId || !photoManagerFile)}
                className="gap-2 shadow-md"
              >
                {selectedType === "PHOTO" ? (
                  <>
                    <Camera className="h-4 w-4" /> Save Photo to Node
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Add Entity to Store
                  </>
                )}
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* SEARCH BAR & LIVE OBJECTS DIRECTORY TABLE */}
      <div className="space-y-4 pt-6 border-t">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-extrabold text-[rgb(var(--fg))]">Live Campus Objects Directory</h3>
            <p className="text-xs text-[rgb(var(--muted-fg))]">
              {filteredEntities.length} active objects found in working graph.
            </p>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {selectedRowIds.size > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleDeleteSelected}
                className="text-xs h-9 px-3 gap-1.5 shadow-sm text-red-600 border-red-200 dark:border-red-900/50 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete Selected ({selectedRowIds.size})
              </Button>
            )}

            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[rgb(var(--muted-fg))]" />
              <Input
                placeholder="Search Name, ID, Building, Floor..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>
          </div>
        </div>

        {/* Category Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-thin">
          <Button
            size="sm"
            variant={activeTab === "ALL" ? "primary" : "outline"}
            onClick={() => setActiveTab("ALL")}
            className="text-xs h-7 px-3 rounded-full shrink-0 gap-1"
          >
            <span>All Objects</span>
            <span className="text-[10px] font-bold opacity-80">
              ({activeTab === "ALL" && searchQuery ? filteredEntities.length : Object.values(entityCounts).reduce((a, b) => a + b, 0)})
            </span>
          </Button>
          {ENTITY_TYPES.map((t) => (
            <Button
              key={t.type}
              size="sm"
              variant={activeTab === t.type ? "primary" : "outline"}
              onClick={() => {
                setActiveTab(t.type);
                setSelectedType(t.type);
              }}
              className="text-xs h-7 px-3 rounded-full shrink-0 gap-1"
            >
              <span>{t.label}</span>
              <span className="text-[10px] font-bold opacity-80">
                ({activeTab === t.type && searchQuery ? filteredEntities.length : (entityCounts[t.type] || 0)})
              </span>
            </Button>
          ))}
        </div>

        {/* Directory Table */}
        <div className="rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] overflow-hidden shadow-md">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[rgb(var(--muted)/0.6)] border-b text-[rgb(var(--muted-fg))] font-bold uppercase tracking-wider text-[11px]">
                <tr>
                  <th className="p-3.5 w-10 text-center">
                    <button
                      type="button"
                      onClick={toggleSelectAllRows}
                      className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
                      title="Select All"
                    >
                      {selectedRowIds.size === filteredEntities.length && filteredEntities.length > 0 ? (
                        <CheckSquare className="h-4 w-4 text-[rgb(var(--primary))]" />
                      ) : (
                        <Square className="h-4 w-4" />
                      )}
                    </button>
                  </th>
                  <th className="p-3.5">Category</th>
                  <th className="p-3.5">Entity Name / Identifier</th>
                  <th className="p-3.5">Building / Floor</th>
                  <th className="p-3.5">Metadata / Details</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgb(var(--border))]">
                {paginatedEntities.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-[rgb(var(--muted-fg))]">
                      No campus objects matching your search query or active filter tab.
                    </td>
                  </tr>
                ) : (
                  paginatedEntities.map((item) => {
                    const isSelected = selectedRowIds.has(item.id);
                    return (
                      <tr
                        key={`${item.category}-${item.id}`}
                        className={`transition-colors ${isSelected ? "bg-[rgb(var(--primary)/0.06)]" : "hover:bg-[rgb(var(--muted)/0.3)]"
                          }`}
                      >
                        <td className="p-3.5 text-center">
                          <button
                            type="button"
                            onClick={() => toggleSelectRow(item.id)}
                            className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
                          >
                            {isSelected ? (
                              <CheckSquare className="h-4 w-4 text-[rgb(var(--primary))]" />
                            ) : (
                              <Square className="h-4 w-4" />
                            )}
                          </button>
                        </td>
                        <td className="p-3.5">
                          <Badge variant="default" className="text-[10px] uppercase font-bold px-2 py-0.5">
                            {item.category}
                          </Badge>
                        </td>
                        <td className="p-3.5 font-bold text-[rgb(var(--fg))]">
                          {item.name}
                          <div className="text-[10px] text-[rgb(var(--muted-fg))] font-mono font-normal">ID: {item.id}</div>
                        </td>
                        <td className="p-3.5 text-[rgb(var(--muted-fg))] font-medium">
                          {item.buildingName || item.floorName ? (
                            <span>
                              {item.buildingName} {item.floorName ? `· ${item.floorName}` : ""}
                            </span>
                          ) : (
                            <span className="italic">Campus Ground / Outdoor</span>
                          )}
                        </td>
                        <td className="p-3.5 text-[rgb(var(--muted-fg))] font-medium">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>{item.details}</span>
                            {(item.category === "NODE" || item.category === "PHOTO") && item.photoUrl && (
                              <button
                                type="button"
                                onClick={() => setViewingPhotoNode({
                                  id: item.id,
                                  name: item.name,
                                  photoUrl: item.photoUrl!,
                                  floorName: item.floorName,
                                  lat: item.raw?.lat,
                                  lng: item.raw?.lng,
                                  physicalVerified: item.physicalVerified,
                                })}
                                className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 hover:bg-emerald-500/25 transition-colors cursor-pointer"
                                title="View Reference Photo"
                              >
                                <Camera className="h-3 w-3" /> Photo
                              </button>
                            )}
                            {(item.category === "NODE" || item.category === "PHOTO") && item.physicalVerified && (
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-600">
                                <CheckCircle2 className="h-3 w-3" /> Verified
                              </span>
                            )}
                            {item.category === "NODE" && (
                              <button
                                type="button"
                                onClick={() => {
                                  const currentVis = item.raw?.visibleToUser !== false;
                                  campusStore.updateNode(item.id, { visibleToUser: !currentVis });
                                  toast({
                                    type: "success",
                                    title: "Visibility Toggled",
                                    description: `Node "${item.name}" visibility set to ${!currentVis ? "YES" : "NO"}!`,
                                  });
                                  setStoreData({ ...campusStore.getWorkingData() });
                                }}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold transition-all cursor-pointer",
                                  (item.raw?.visibleToUser !== false)
                                    ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/25"
                                    : "bg-rose-500/15 text-rose-700 dark:text-rose-300 hover:bg-rose-500/25"
                                )}
                                title="Click to toggle Visible to user (YES / NO)"
                              >
                                {(item.raw?.visibleToUser !== false) ? "👁 Visible: YES" : "✕ Visible: NO"}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="p-3.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/admin/editor?focus=${item.id}`}>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-emerald-500 hover:bg-emerald-500/10"
                                title="Locate on CAD Editor"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            </Link>

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleCopyEntity(item)}
                              className="h-7 w-7 text-indigo-500 hover:bg-indigo-500/10"
                              title={`Copy ${item.category} details (${item.name})`}
                            >
                              {copiedRowId === item.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500 animate-in zoom-in-50" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleOpenEditModal(item)}
                              className="h-7 w-7 text-[rgb(var(--primary))] hover:bg-[rgb(var(--primary)/0.1)]"
                              title="Edit Object Attributes"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>

                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteEntity(item)}
                              className="h-7 w-7 text-red-500 hover:bg-red-500/10"
                              title="Delete Object"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* HIGH-PERFORMANCE PAGINATION & CONTROL TOOLBAR */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t border-[rgb(var(--border))] bg-[rgb(var(--card)/0.5)]">
            <div className="flex items-center gap-3 text-xs text-[rgb(var(--muted-fg))] font-medium">
              <span>
                Showing{" "}
                <strong className="text-[rgb(var(--fg))]">
                  {filteredEntities.length === 0 ? 0 : pageSize === 0 ? 1 : (currentPage - 1) * pageSize + 1}
                </strong>{" "}
                to{" "}
                <strong className="text-[rgb(var(--fg))]">
                  {pageSize === 0 ? filteredEntities.length : Math.min(currentPage * pageSize, filteredEntities.length)}
                </strong>{" "}
                of <strong className="text-[rgb(var(--fg))]">{filteredEntities.length}</strong> campus objects
              </span>

              <div className="flex items-center gap-1.5 ml-2">
                <span>Per Page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] px-2 py-1 text-xs font-semibold text-[rgb(var(--fg))]"
                >
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={0}>All (No Limit)</option>
                </select>
              </div>
            </div>

            {pageSize > 0 && totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                  className="h-8 px-2.5 text-xs gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Previous
                </Button>

                <div className="flex items-center gap-1 px-2 text-xs font-bold text-[rgb(var(--fg))]">
                  Page {currentPage} of {totalPages}
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                  className="h-8 px-2.5 text-xs gap-1"
                >
                  Next <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* COMPREHENSIVE EDIT OBJECT MODAL DIALOG */}
      {editingItem && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150 scrollbar-thin">
            <div className="flex items-center justify-between border-b pb-3 sticky top-0 bg-[rgb(var(--card))] z-10">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[rgb(var(--primary)/0.12)] text-[rgb(var(--primary))] font-bold">
                  <Edit3 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[rgb(var(--fg))]">Edit {editingItem.category} Attributes</h3>
                  <p className="text-[11px] text-[rgb(var(--muted-fg))] font-mono">ID: {editingItem.id}</p>
                </div>
              </div>
              <button
                onClick={() => setEditingItem(null)}
                className="text-[rgb(var(--muted-fg))] hover:text-[rgb(var(--fg))]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="font-bold text-[rgb(var(--fg))]">Name / Identifier *</label>
                <Input
                  autoFocus
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="mt-1 text-sm font-semibold"
                />
              </div>

              {/* BUILDING EDIT FIELDS */}
              {editingItem.category === "BUILDING" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Category / Short Code</label>
                      <Input
                        placeholder="e.g. Academic"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Number of Upper Floors</label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={editForm.floorsCount}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          setEditForm({ ...editForm, floorsCount: isNaN(val) ? 0 : Math.max(0, val) });
                        }}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Center Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Center Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  {/* Dynamic Building GPS Footprint Corners */}
                  <div className="rounded-xl border border-[rgb(var(--primary)/0.25)] bg-[rgb(var(--primary)/0.04)] p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-extrabold text-[rgb(var(--fg))] text-[11px] flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-[rgb(var(--primary))]" /> Geographic Footprint Corners ({editForm.corners?.length || 0} Points)
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={handleAddEditBuildingCorner}
                        className="h-6 text-[10px] gap-1 px-2 border-dashed border-[rgb(var(--primary)/0.5)] text-[rgb(var(--primary))]"
                      >
                        <Plus className="h-3 w-3" /> + Add Corner
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      {(editForm.corners || []).map((c: any, idx: number) => (
                        <div key={`edit-corner-${idx}`} className="bg-[rgb(var(--card))] p-2 rounded border space-y-1 relative">
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[rgb(var(--primary))] text-[10px]">Corner {idx + 1}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-5 px-1 text-[10px] text-red-500 hover:bg-red-500/10 disabled:opacity-30"
                              disabled={(editForm.corners || []).length <= 3}
                              onClick={() => handleRemoveEditBuildingCorner(idx)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                          <Input
                            placeholder="11.XXXXXX"
                            value={c.lat}
                            onChange={(e) => handleUpdateEditBuildingCorner(idx, "lat", e.target.value)}
                            className="text-[11px] h-7 font-mono"
                          />
                          <Input
                            placeholder="77.XXXXXX"
                            value={c.lng}
                            onChange={(e) => handleUpdateEditBuildingCorner(idx, "lng", e.target.value)}
                            className="text-[11px] h-7 font-mono"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* FLOOR EDIT FIELDS */}
              {editingItem.category === "FLOOR" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                      value={editForm.buildingId}
                      onChange={(e) => setEditForm({ ...editForm, buildingId: e.target.value })}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Floor Ordinal Level</label>
                    <Input
                      type="number"
                      value={editForm.ordinal}
                      onChange={(e) => setEditForm({ ...editForm, ordinal: parseInt(e.target.value) || 0 })}
                      className="mt-1 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* ROOM EDIT FIELDS */}
              {editingItem.category === "ROOM" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Room Number</label>
                      <Input
                        value={editForm.roomNumber}
                        onChange={(e) => setEditForm({ ...editForm, roomNumber: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Category</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.category}
                        onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                      >
                        <option value="Classroom">Classroom</option>
                        <option value="Laboratory">Laboratory</option>
                        <option value="Office">Faculty Office</option>
                        <option value="Seminar Hall">Seminar Hall</option>
                        <option value="Library">Library</option>
                        <option value="Washroom">Washroom</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Building</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.buildingId}
                        onChange={(e) => setEditForm({ ...editForm, buildingId: e.target.value })}
                      >
                        {storeData.buildings.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Floor</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.floorId}
                        onChange={(e) => setEditForm({ ...editForm, floorId: e.target.value })}
                      >
                        {storeData.floors
                          .filter((f) => !editForm.buildingId || f.buildingId === editForm.buildingId)
                          .map((f) => (
                            <option key={f.id} value={f.id}>{f.name}</option>
                          ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* NODE EDIT FIELDS */}
              {editingItem.category === "NODE" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Node Type</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.nodeType}
                        onChange={(e) => setEditForm({ ...editForm, nodeType: e.target.value as NodeType })}
                      >
                        <option value="CORRIDOR">Corridor Waypoint</option>
                        <option value="JUNCTION">Junction</option>
                        <option value="ROOM">Room Entry</option>
                        <option value="ENTRANCE">Building Entrance</option>
                        <option value="STAIR">Stair Landing</option>
                        <option value="LIFT">Elevator Landing</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Floor</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.floorId}
                        onChange={(e) => setEditForm({ ...editForm, floorId: e.target.value })}
                      >
                        <option value="f-out">Outdoor Area</option>
                        {storeData.floors.map((f) => (
                          <option key={f.id} value={f.id}>{f.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="font-bold text-[rgb(var(--fg))] block mb-1">Visible to user</label>
                    <select
                      className="w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                      value={editForm.visibleToUser ? "YES" : "NO"}
                      onChange={(e) => setEditForm({ ...editForm, visibleToUser: e.target.value === "YES" })}
                    >
                      <option value="NO">NO</option>
                      <option value="YES">YES</option>
                    </select>
                  </div>

                  {/* Selective Node Reference Photo Section */}
                  <div className="rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-3.5 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <label className="font-bold text-[rgb(var(--fg))] flex items-center gap-1.5 text-xs">
                        <Camera className="h-4 w-4 text-[rgb(var(--primary))]" /> Node Reference Photo (Optional)
                      </label>
                      {editForm.photoUrl ? (
                        <Badge className="bg-emerald-600 text-white text-[10px]">Attached</Badge>
                      ) : (
                        <span className="text-[11px] text-[rgb(var(--muted-fg))]">○ None</span>
                      )}
                    </div>

                    <input
                      ref={nodePhotoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                      onChange={handlePhotoFileUpload}
                      className="hidden"
                    />

                    {editForm.photoUrl ? (
                      <div className="space-y-2">
                        <div className="relative w-full overflow-hidden rounded-lg border border-[rgb(var(--border))] bg-transparent flex items-center justify-center">
                          <img
                            src={editForm.photoUrl}
                            alt="Node Reference"
                            className="w-full h-auto max-h-52 object-contain rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => setViewingPhotoNode({
                              id: editingItem.id,
                              name: editForm.name,
                              photoUrl: editForm.photoUrl,
                              lat: parseFloat(editForm.lat),
                              lng: parseFloat(editForm.lng),
                              physicalVerified: editForm.physicalVerified,
                            })}
                            className="absolute top-2 right-2 rounded-md bg-black/60 p-1.5 text-white hover:bg-black/80 transition-colors"
                            title="View Fullscreen Photo"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => nodePhotoInputRef.current?.click()}
                            className="text-xs gap-1 h-7"
                          >
                            <RotateCcw className="h-3 w-3" /> Replace Photo
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={handleConfirmRemovePhoto}
                            className="text-xs text-red-500 border-red-500/30 hover:bg-red-500/10 gap-1 h-7"
                          >
                            <Trash2 className="h-3 w-3" /> Remove Photo
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-4 border border-dashed rounded-lg bg-[rgb(var(--muted)/0.2)] text-center">
                        <Camera className="h-6 w-6 text-[rgb(var(--muted-fg))] mb-1.5" />
                        <p className="text-xs font-semibold text-[rgb(var(--fg))]">No reference photo attached</p>
                        <p className="text-[11px] text-[rgb(var(--muted-fg))] mb-2">Optional physical documentation for campus node</p>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => nodePhotoInputRef.current?.click()}
                          className="text-xs gap-1.5 h-7"
                        >
                          <Upload className="h-3.5 w-3.5" /> Upload Reference Photo
                        </Button>
                      </div>
                    )}

                    <div className="border-t pt-2.5">
                      <label className="flex items-center gap-2 text-xs font-semibold text-[rgb(var(--fg))] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editForm.physicalVerified}
                          onChange={(e) => setEditForm((f) => ({ ...f, physicalVerified: e.target.checked }))}
                          className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))]"
                        />
                        <span>Physical Location Verified on Campus</span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* EDGE EDIT FIELDS */}
              {editingItem.category === "EDGE" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">From Node</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.firstNodeId}
                        onChange={(e) => setEditForm({ ...editForm, firstNodeId: e.target.value })}
                      >
                        {storeData.nodes.map((n) => (
                          <option key={n.id} value={n.id}>{n.name || n.id}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">To Node</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.secondNodeId}
                        onChange={(e) => setEditForm({ ...editForm, secondNodeId: e.target.value })}
                      >
                        {storeData.nodes.map((n) => (
                          <option key={n.id} value={n.id}>{n.name || n.id}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Edge Type</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.edgeType}
                        onChange={(e) => setEditForm({ ...editForm, edgeType: e.target.value as EdgeType })}
                      >
                        <option value="WALK">Pedestrian Walkway</option>
                        <option value="ROAD">Outdoor Street / Road</option>
                        <option value="STAIRS">Staircase Connection</option>
                        <option value="LIFT">Elevator Connection</option>
                        <option value="RAMP">Accessible Ramp</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Path Type (Vehicle / Walk Access)</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.pathType || "WALK"}
                        onChange={(e) => setEditForm({ ...editForm, pathType: e.target.value as PathType })}
                      >
                        <option value="EV">EV Path (Electric vehicle + walking)</option>
                        <option value="WALK">Only Walk Path (Walking only — EV prohibited)</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Distance (Meters)</label>
                    <Input
                      type="number"
                      value={editForm.distance}
                      onChange={(e) => setEditForm({ ...editForm, distance: parseFloat(e.target.value) || 0 })}
                      className="mt-1 text-xs"
                    />
                  </div>
                </div>
              )}

              {/* STAIR / LIFT EDIT FIELDS */}
              {(editingItem.category === "STAIR" || editingItem.category === "LIFT") && (
                <div className="space-y-3">
                  <div>
                    <label className="font-bold text-[rgb(var(--fg))]">Building</label>
                    <select
                      className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                      value={editForm.buildingId}
                      onChange={(e) => setEditForm({ ...editForm, buildingId: e.target.value })}
                    >
                      {storeData.buildings.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-xl border p-3 bg-[rgb(var(--primary)/0.04)] space-y-2">
                    <span className="font-bold text-[rgb(var(--fg))] text-[11px]">Connecting / Served Floors</span>
                    <div className="grid grid-cols-2 gap-2">
                      {storeData.floors
                        .filter((f) => !editForm.buildingId || f.buildingId === editForm.buildingId)
                        .map((fl) => {
                          const checked = editForm.selectedFloorIds.includes(fl.id);
                          return (
                            <label key={fl.id} className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setEditForm((prev) => ({ ...prev, selectedFloorIds: [...prev.selectedFloorIds, fl.id] }));
                                  } else {
                                    setEditForm((prev) => ({ ...prev, selectedFloorIds: prev.selectedFloorIds.filter((id) => id !== fl.id) }));
                                  }
                                }}
                                className="h-4 w-4 rounded border-[rgb(var(--border))] text-[rgb(var(--primary))]"
                              />
                              <span>{fl.name} (Level {fl.ordinal})</span>
                            </label>
                          );
                        })}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* OBSTACLE EDIT FIELDS */}
              {editingItem.category === "OBSTACLE" && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Severity</label>
                      <select
                        className="mt-1 w-full rounded-lg border border-[rgb(var(--border))] bg-[rgb(var(--bg))] p-2 text-xs font-medium"
                        value={editForm.severity}
                        onChange={(e) => setEditForm({ ...editForm, severity: e.target.value as any })}
                      >
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </select>
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Blocked Radius (m)</label>
                      <Input
                        type="number"
                        value={editForm.radius}
                        onChange={(e) => setEditForm({ ...editForm, radius: parseFloat(e.target.value) || 10 })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Latitude</label>
                      <Input
                        value={editForm.lat}
                        onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                    <div>
                      <label className="font-bold text-[rgb(var(--fg))]">Longitude</label>
                      <Input
                        value={editForm.lng}
                        onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                        className="mt-1 text-xs"
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t">
              <Button size="sm" variant="outline" onClick={() => setEditingItem(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="gradient" onClick={handleSaveEditModal} className="gap-1.5 shadow-md">
                <CheckCircle2 className="h-4 w-4" /> Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Publish Modal */}
      <PublishModal open={showPublishModal} onClose={() => setShowPublishModal(false)} />
      {/* Node Reference Photo Viewer Modal */}
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
                {viewingPhotoNode.floorName && (
                  <div>Location: <span className="font-semibold text-[rgb(var(--fg))]">{viewingPhotoNode.floorName}</span></div>
                )}
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

            <div className="flex justify-end pt-1">
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
