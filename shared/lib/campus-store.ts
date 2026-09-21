import { canvasToGps, gpsToCanvas, getCenterFromCorners } from "../../lib/geo/projection";
import { solveAffineMatrix, gpsToCanvas as affineGpsToCanvas, canvasToGps as affineCanvasToGps, type AffineMatrix } from "../../lib/geo/affine";
import { calculateGeographicDistance } from "../../lib/geo/haversine";
import {
  getFloorCode,
  type Building,
  type Floor,
  type Node,
  type Edge,
  type Destination,
  type Campus,
  type NodeType,
  type EdgeType,
  type Event,
  type Obstacle,
  type StairGroup,
  type LiftGroup,
  type Door,
  type SuggestedNode,
  type SuggestedEdge,
} from "../data/campus";
import { generateShortId } from "./id-generator";

export type PendingChangeType =
  | "ADD_BUILDING"
  | "UPDATE_BUILDING"
  | "DELETE_BUILDING"
  | "ADD_FLOOR"
  | "UPDATE_FLOOR"
  | "DELETE_FLOOR"
  | "ADD_NODE"
  | "UPDATE_NODE"
  | "DELETE_NODE"
  | "ADD_EDGE"
  | "UPDATE_EDGE"
  | "DELETE_EDGE"
  | "ADD_DESTINATION"
  | "UPDATE_DESTINATION"
  | "DELETE_DESTINATION"
  | "ADD_EVENT"
  | "UPDATE_EVENT"
  | "DELETE_EVENT"
  | "ADD_OBSTACLE"
  | "UPDATE_OBSTACLE"
  | "DELETE_OBSTACLE"
  | "ADD_STAIR_GROUP"
  | "UPDATE_STAIR_GROUP"
  | "DELETE_STAIR_GROUP"
  | "ADD_LIFT_GROUP"
  | "UPDATE_LIFT_GROUP"
  | "DELETE_LIFT_GROUP"
  | "ADD_DOOR"
  | "UPDATE_DOOR"
  | "DELETE_DOOR"
  | "BULK_DELETE";

export type PendingChange = {
  id: string;
  type: PendingChangeType;
  entityType: "building" | "floor" | "node" | "edge" | "destination" | "event" | "obstacle" | "stairGroup" | "liftGroup" | "corridor" | "door";
  entityId: string;
  description: string;
  timestamp: number;
  prevData?: unknown;
  newData?: unknown;
};

export type AuditLogEntry = {
  id: string;
  action: "PUBLISH" | "UPDATE" | "CREATE" | "DELETE" | "LOGIN";
  resource: string;
  user: string;
  at: string;
  timestamp: number;
};

export type UndoHistoryEntry = {
  id: string;
  description: string;
  timestamp: number;
  snapshot: StoreSnapshot;
};

type StoreSnapshot = {
  buildings: Building[];
  floors: Floor[];
  nodes: Node[];
  edges: Edge[];
  destinations: Destination[];
  events: Event[];
  obstacles: Obstacle[];
  stairGroups?: StairGroup[];
  liftGroups?: LiftGroup[];
  doors?: Door[];
  /** Campus perimeter, used to draw the grounds the buildings sit on. */
  boundary?: { lat: number; lng: number }[];
  pendingChanges?: PendingChange[];
};

const defaultCampus: Campus = {
  id: "c1",
  name: "Main Campus",
  slug: "main",
  lat: 11.4965,
  lng: 77.2774,
};

export type Checkpoint = {
  id: string;
  name: string;
  timestamp: number;
  snapshot: StoreSnapshot;
};

class CampusStore {
  private campus: Campus = { ...defaultCampus };
  private publishedVersion = "v1.0";
  private storageMode: "database" | "local-file" | "unknown" = "unknown";
  /** Revision of the draft this client last read; sent with every write so the
   *  server can reject overwrites from a tab holding an older copy. */
  private draftRevision: string | null = null;
  private conflictListeners = new Set<(message: string) => void>();
  private lastDraftConflictMessage: string | null = null;
  private checkpoints: Checkpoint[] = [];

  // Working (draft) data
  private buildings: Building[] = [];
  private floors: Floor[] = [];
  private nodes: Node[] = [];
  private edges: Edge[] = [];
  private destinations: Destination[] = [];
  private events: Event[] = [];
  private obstacles: Obstacle[] = [];
  private stairGroups: StairGroup[] = [];
  private liftGroups: LiftGroup[] = [];
  private doors: Door[] = [];
  private suggestedNodes: SuggestedNode[] = [];
  private suggestedEdges: SuggestedEdge[] = [];
  private clipboardData: {
    nodes?: Node[];
    destinations?: Destination[];
    doors?: Door[];
    edges?: Edge[];
  } | null = null;

  // Published snapshot (what public visitors see until published)
  private publishedGraph: StoreSnapshot = {
    buildings: [],
    floors: [],
    nodes: [],
    edges: [],
    destinations: [],
    events: [],
    obstacles: [],
    stairGroups: [],
    liftGroups: [],
    doors: [],
  };

  private clientId = typeof window !== "undefined" ? Math.random().toString(36).substring(2, 9) : "server";
  private pendingChanges: PendingChange[] = [];
  private auditLogs: AuditLogEntry[] = [];
  private undoStack: UndoHistoryEntry[] = [];
  private redoStack: UndoHistoryEntry[] = [];
  private listeners = new Set<() => void>();
  private isInitialized = false;
  private isSyncing = false;
  private syncPromise: Promise<boolean> | null = null;
  private syncTimeout: ReturnType<typeof setTimeout> | null = null;
  private broadcastChannel: BroadcastChannel | null = null;

  constructor() {
    this.clearLegacyLocalDraftCache();
    this.initializeStore();

    if (typeof window !== "undefined") {
      const flush = () => this.flushWorkingDraftSync();
      window.addEventListener("beforeunload", flush);
      window.addEventListener("pagehide", flush);
    }

    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        this.broadcastChannel = new BroadcastChannel("campusnav_store_sync");
        this.broadcastChannel.onmessage = (event) => {
          if (event.data?.clientId === this.clientId) {
            // Ignore broadcast messages sent by this exact tab/client instance
            return;
          }
          if (event.data?.type === "SYNC_DRAFT") {
            if (event.data.snapshot) {
              this.loadSnapshotFromBroadcast(event.data.snapshot);
            } else {
              this.syncWithServer();
            }
          } else if (event.data?.type === "SYNC_PUBLISHED") {
            if (event.data.snapshot) {
              this.setPublishedGraphFromDatabase(event.data.snapshot, event.data.version);
            } else {
              this.fetchPublishedData(true);
            }
          }
        };
      } catch (e) {
        console.warn("BroadcastChannel initialization notice:", e);
      }
    }
  }

  public loadSnapshotFromBroadcast(snapshot: any) {
    if (!snapshot) return;
    if (Array.isArray(snapshot.buildings)) this.buildings = snapshot.buildings;
    if (Array.isArray(snapshot.floors)) this.floors = snapshot.floors;
    if (Array.isArray(snapshot.nodes)) this.nodes = snapshot.nodes;
    if (Array.isArray(snapshot.edges)) this.edges = snapshot.edges;
    if (Array.isArray(snapshot.destinations)) this.destinations = snapshot.destinations;
    if (Array.isArray(snapshot.events)) this.events = snapshot.events;
    if (Array.isArray(snapshot.obstacles)) this.obstacles = snapshot.obstacles;
    if (Array.isArray(snapshot.stairGroups)) this.stairGroups = snapshot.stairGroups;
    if (Array.isArray(snapshot.liftGroups)) this.liftGroups = snapshot.liftGroups;
    if (Array.isArray(snapshot.doors)) this.doors = snapshot.doors;
    // Notify local subscribers without re-broadcasting
    this.listeners.forEach((l) => l());
  }

  private clearLegacyLocalDraftCache() {
    if (typeof window === "undefined") return;
    try {
      localStorage.removeItem("campusnav_draft_cache");
      localStorage.removeItem("campusnav_working_data");
      localStorage.removeItem("campusnav_working_data_v2");
    } catch {}
  }

  public flushWorkingDraftSync(isExplicitReset = false) {
    if (typeof window === "undefined") return;
    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }
    const hasEntities =
      this.buildings.length > 0 ||
      this.nodes.length > 0 ||
      this.floors.length > 0 ||
      this.destinations.length > 0;

    if (!hasEntities && !isExplicitReset) {
      return;
    }
    try {
      const payload = JSON.stringify({ snapshot: this.getWorkingData(), isExplicitReset, baseRevision: this.draftRevision });
      if (typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/admin/campus-graph/draft", blob);
      } else {
        fetch("/api/admin/campus-graph/draft", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {}
  }

  private saveWorkingDraftToDatabase(isExplicitReset = false) {
    if (typeof window === "undefined") return;

    if (this.syncTimeout) {
      clearTimeout(this.syncTimeout);
      this.syncTimeout = null;
    }

    const performSync = () => {
      if (this.isSyncing || (!this.isInitialized && !isExplicitReset)) {
        return;
      }
      try {
        fetch("/api/admin/campus-graph/draft", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            snapshot: this.getWorkingData(),
            isExplicitReset,
            instantLiveSync: this.getInstantLiveSync(),
            baseRevision: this.draftRevision,
          }),
          keepalive: true,
        })
          .then(async (res) => {
            const data = await res.json().catch(() => ({}));
            if (res.status === 409) {
              this.handleDraftConflict(data);
              return;
            }
            if (typeof data?.revision === "string") this.draftRevision = data.revision;
          })
          .catch((e) => console.warn("Failed to sync working draft to database:", e));
      } catch (e) {
        console.warn("Failed to persist draft to server database:", e);
      }
    };

    if (isExplicitReset) {
      performSync();
    } else {
      this.syncTimeout = setTimeout(performSync, 300);
    }
  }

  private persistWorkingDraft() {
    this.saveWorkingDraftToDatabase();
  }

  /**
   * The server refused our write because someone else's version is newer.
   * Adopt theirs rather than retrying, so a stale tab can never win the race.
   */
  private handleDraftConflict(data: {
    revision?: unknown;
    draft?: Record<string, unknown> | null;
    message?: unknown;
  }) {
    if (typeof data?.revision === "string") this.draftRevision = data.revision;

    const draft = data?.draft;
    if (draft && typeof draft === "object") {
      const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
      this.buildings = list(draft.buildings);
      this.floors = list(draft.floors);
      this.nodes = list(draft.nodes);
      this.edges = list(draft.edges);
      this.destinations = list(draft.destinations);
      this.events = list(draft.events);
      this.obstacles = list(draft.obstacles);
      this.stairGroups = list(draft.stairGroups);
      this.liftGroups = list(draft.liftGroups);
      this.doors = list(draft.doors);
      this.ensureDefaultGroundFloors();
      (this.stairGroups || []).forEach((sg) => this.rebuildStairGroupConnections(sg));
      this.notify();
    }

    this.lastDraftConflictMessage =
      typeof data?.message === "string"
        ? data.message
        : "This draft was changed elsewhere; the newer version was loaded.";
    console.warn(`[CampusStore] ${this.lastDraftConflictMessage}`);
    this.conflictListeners.forEach((listener) => {
      try {
        listener(this.lastDraftConflictMessage as string);
      } catch {
        // a bad listener must not break the sync path
      }
    });
  }

  public onDraftConflict(listener: (message: string) => void) {
    this.conflictListeners.add(listener);
    return () => {
      this.conflictListeners.delete(listener);
    };
  }

  public getLastDraftConflictMessage() {
    return this.lastDraftConflictMessage;
  }

  private async initializeStore() {
    try {
      await this.syncWithServer();
    } catch (e) {
      console.warn("Notice during store initialization from database:", e);
    } finally {
      this.isInitialized = true;
      this.listeners.forEach((l) => l());
    }
  }

  private ensureDefaultGroundFloors() {
    this.buildings.forEach((b) => {
      const hasFloor = this.floors.some((f) => f.buildingId === b.id);
      if (!hasFloor) {
        this.floors.push({
          id: `f-${b.id}-gnd`,
          buildingId: b.id,
          name: "Ground Floor",
          ordinal: 0,
        });
      }
    });

    if (this.publishedGraph.buildings) {
      this.publishedGraph.buildings.forEach((b) => {
        const hasFloor = this.publishedGraph.floors.some((f) => f.buildingId === b.id);
        if (!hasFloor) {
          this.publishedGraph.floors.push({
            id: `f-${b.id}-gnd`,
            buildingId: b.id,
            name: "Ground Floor",
            ordinal: 0,
          });
        }
      });
    }
  }

  public logAction(
    action: "PUBLISH" | "UPDATE" | "CREATE" | "DELETE" | "LOGIN",
    resource: string,
    user: string = "logeshwaranpalanic7@gmail.com"
  ) {
    const entry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      action,
      resource,
      user,
      at: "Just now",
      timestamp: Date.now(),
    };
    this.auditLogs.unshift(entry);
    if (this.auditLogs.length > 100) this.auditLogs.pop();
    this.persistWorkingDraft();
    this.notify();
  }

  public getAuditLogs(): AuditLogEntry[] {
    return this.auditLogs;
  }

  public resetToInitialData(isExplicit = false) {
    // Reset to a clean empty canvas (no mock data)
    this.buildings = [];
    this.floors = [];
    this.nodes = [];
    this.edges = [];
    this.destinations = [];
    this.stairGroups = [];
    this.events = [];
    this.obstacles = [];
    this.publishedGraph = {
      buildings: [],
      floors: [],
      nodes: [],
      edges: [],
      destinations: [],
      events: [],
      obstacles: [],
      stairGroups: [],
    };
    this.pendingChanges = [];
    this.undoStack = [];
    this.redoStack = [];
    this.saveSnapshotToUndo();
    if (isExplicit) {
      if (typeof window !== "undefined") {
        try {
          localStorage.removeItem("campusnav_draft_cache");
        } catch {}
      }
      this.saveWorkingDraftToDatabase(true);
    }
    this.notify();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }


  private isBatching = false;

  public startBatching() {
    if (!this.isBatching) {
      this.saveSnapshotToUndo();
      this.isBatching = true;
    }
  }

  public endBatching() {
    if (this.isBatching) {
      this.isBatching = false;
      this.notify();
    }
  }

  private notify(broadcast = true, shouldPersist = true) {
    if (this.isBatching) return;
    if (shouldPersist && this.isInitialized && !this.isSyncing) {
      this.persistWorkingDraft();
    }
    this.listeners.forEach((l) => l());
    if (broadcast && this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: "SYNC_DRAFT",
          clientId: this.clientId,
          snapshot: this.getWorkingData(),
          timestamp: Date.now(),
        });
      } catch (e) {
        // Ignore broadcast failures
      }
    }
  }

  public saveSnapshotToUndo(description = "Graph Edit") {
    if (this.isBatching) return;
    const entry: UndoHistoryEntry = {
      id: `undo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      description,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    };
    this.undoStack.push(entry);
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  // Getters

  public getPublishedVersion() {
    return this.publishedVersion;
  }

  /** Where the server persisted the map: Postgres, or the local `.data` files. */
  public getStorageMode() {
    return this.storageMode;
  }

  /** Whether an entity is in the live published graph, as opposed to draft-only. */
  public isEntityPublished(
    kind: "buildings" | "floors" | "nodes" | "edges" | "destinations",
    id: string
  ): boolean {
    const list = this.publishedGraph[kind] as { id: string }[] | undefined;
    return Array.isArray(list) && list.some((entity) => entity.id === id);
  }

  /** True once a published graph has been loaded at all. */
  public hasPublishedGraph(): boolean {
    return (this.publishedGraph.buildings?.length ?? 0) > 0;
  }

  public getWorkingData() {
    return {
      campus: this.campus,
      buildings: [...this.buildings],
      floors: [...this.floors],
      nodes: [...this.nodes],
      edges: [...this.edges],
      destinations: [...this.destinations],
      events: [...(this.events || [])],
      obstacles: [...(this.obstacles || [])],
      stairGroups: [...(this.stairGroups || [])],
      liftGroups: [...(this.liftGroups || [])],
      doors: [...(this.doors || [])],
      suggestedNodes: [...(this.suggestedNodes || [])],
      suggestedEdges: [...(this.suggestedEdges || [])],
    };
  }

  public getPublishedData() {
    const mergedObstacleMap = new Map<string, typeof this.obstacles[0]>();
    (this.publishedGraph.obstacles || []).forEach((o) => mergedObstacleMap.set(o.id, o));
    (this.obstacles || []).forEach((o) => mergedObstacleMap.set(o.id, o));
    const mergedObstacles = Array.from(mergedObstacleMap.values());

    // Instant Live Sync Mode: Serve live working draft directly without requiring Publish
    if (this.getInstantLiveSync()) {
      return {
        campus: this.campus,
        buildings: [...this.buildings],
        floors: [...this.floors],
        nodes: [...this.nodes],
        edges: [...this.edges],
        destinations: [...this.destinations],
        events: [...(this.events || [])],
        obstacles: mergedObstacles,
        stairGroups: [...(this.stairGroups || [])],
        liftGroups: [...(this.liftGroups || [])],
        doors: [...(this.doors || [])],
        boundary: [...(this.publishedGraph.boundary || [])],
      };
    }

    return {
      campus: this.campus,
      buildings: [...(this.publishedGraph.buildings || [])],
      floors: [...(this.publishedGraph.floors || [])],
      nodes: [...(this.publishedGraph.nodes || [])],
      edges: [...(this.publishedGraph.edges || [])],
      destinations: [...(this.publishedGraph.destinations || [])],
      events: [...(this.publishedGraph.events || [])],
      obstacles: mergedObstacles,
      stairGroups: [...(this.publishedGraph.stairGroups || [])],
      liftGroups: [...(this.publishedGraph.liftGroups || [])],
      doors: [...(this.publishedGraph.doors || [])],
      boundary: [...(this.publishedGraph.boundary || [])],
    };
  }

  public getPendingChanges() {
    return this.pendingChanges;
  }

  public canUndo() {
    return this.undoStack.length > 0;
  }

  public canRedo() {
    return this.redoStack.length > 0;
  }

  // Helpers

  public getBuildingAffineMatrix(buildingId: string): AffineMatrix | null {
    const b = this.buildings.find((b) => b.id === buildingId);
    if (!b || b.corner1Lat === undefined || b.corner1Lng === undefined || b.corner3Lat === undefined || b.corner3Lng === undefined) {
      return null;
    }
    
    // Create calibration points from Top-Left (corner1) and Bottom-Right (corner3)
    const bx = b.x || 0;
    const by = b.y || 0;
    const bw = b.width || 180;
    const bh = b.height || 120;
    
    const points = [
      {
        canvasX: bx - bw / 2,
        canvasY: by - bh / 2,
        lat: b.corner1Lat,
        lng: b.corner1Lng,
      },
      {
        canvasX: bx + bw / 2,
        canvasY: by + bh / 2,
        lat: b.corner3Lat,
        lng: b.corner3Lng,
      },
    ];

    return solveAffineMatrix(points);
  }

  public getBuildingForNode(node: Node): Building | undefined {
    if (node.floorId === "f-out") return undefined;
    const floor = this.floors.find((f) => f.id === node.floorId);
    if (!floor) return undefined;
    return this.buildings.find((b) => b.id === floor.buildingId);
  }

  public getCanvasCoordsFromGps(lat: number, lng: number, floorId: string): { x: number; y: number } {
    if (floorId === "f-out") return gpsToCanvas(lat, lng);
    const floor = this.floors.find((f) => f.id === floorId);
    const building = floor ? this.buildings.find((b) => b.id === floor.buildingId) : null;
    const affine = building ? this.getBuildingAffineMatrix(building.id) : null;
    return affine ? affineGpsToCanvas(lat, lng, affine) : gpsToCanvas(lat, lng);
  }

  // Subscriptions

  public addBuilding(b: Building) {
    this.saveSnapshotToUndo(`Added Building "${b.name}"`);
    if (!b.lat || !b.lng || b.lat === 12.9716 || b.lat === 0) {
      const { lat, lng } = canvasToGps(b.x ?? 0, b.y ?? 0);
      b.lat = Number(lat.toFixed(9));
      b.lng = Number(lng.toFixed(9));
    }
    this.buildings.push(b);
    this.logAction("CREATE", `Building "${b.name}"`);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_BUILDING",
      entityType: "building",
      entityId: b.id,
      description: `Added Building "${b.name}" (${b.shortCode})`,
      timestamp: Date.now(),
      newData: b,
    });

    // Auto-create Ground Floor and basements / upper floors if defined
    const basements = b.basementsCount ?? 0;
    const upperFloors = b.floorsCount !== undefined ? b.floorsCount : 0; // Default ONLY Ground Floor (0 upper floors)

    for (let i = -basements; i <= upperFloors; i++) {
      const code = getFloorCode(i);
      const name = i < 0 ? `Basement ${Math.abs(i)}` : i === 0 ? "Ground Floor" : `Floor ${i}`;
      const fid = `f-${b.id}-${code.toLowerCase()}`;
      if (!this.floors.some((f) => f.id === fid)) {
        this.floors.push({
          id: fid,
          buildingId: b.id,
          name,
          ordinal: i,
          code,
        });
      }
    }

    this.redoStack = [];
    this.notify();
    return b;
  }

  public updateBuilding(id: string, patch: Partial<Building>, recordHistory = true) {
    const idx = this.buildings.findIndex((b) => b.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo(`Updated Building "${this.buildings[idx].name}"`);
    }
    const prev = { ...this.buildings[idx] };
    const oldX = prev.x ?? 0;
    const oldY = prev.y ?? 0;
    const oldW = prev.width ?? 180;
    const oldH = prev.height ?? 120;

    let isResizeOnly = false;
    if (patch.width !== undefined || patch.height !== undefined) {
      if (patch.x === undefined && patch.y === undefined && patch.lat === undefined && patch.lng === undefined) {
         isResizeOnly = true;
      }
    }

    if (isResizeOnly) {
      // Width/height resize preserves the canvas center (x, y) and geographic center (lat, lng)
      patch.x = oldX;
      patch.y = oldY;

      const newW = patch.width ?? oldW;
      const newH = patch.height ?? oldH;
      if (newW !== oldW || newH !== oldH) {
        const scaleX = newW / oldW;
        const scaleY = newH / oldH;
        
        const buildingFloors = this.floors.filter((f) => f.buildingId === id);
        const buildingFloorIds = new Set(buildingFloors.map((f) => f.id));
        const buildingStairGroupIds = new Set(
          (this.stairGroups || []).filter((sg) => sg.buildingId === id).map((sg) => sg.id)
        );
        const buildingLiftGroupIds = new Set(
          (this.liftGroups || []).filter((lg) => lg.buildingId === id).map((lg) => lg.id)
        );

        const isNodeInBuilding = (n: Node) => {
          if (n.floorId === "f-out") return false;
          if (buildingFloorIds.has(n.floorId)) return true;
          if ((n as unknown as { buildingId?: string }).buildingId === id) return true;
          if (n.stairGroupId && buildingStairGroupIds.has(n.stairGroupId)) return true;
          if (n.liftGroupId && buildingLiftGroupIds.has(n.liftGroupId)) return true;
          return false;
        };

        this.nodes = this.nodes.map((n) => {
          if (isNodeInBuilding(n)) {
            const relX = n.x - oldX;
            const relY = n.y - oldY;
            const nx = oldX + relX * scaleX;
            const ny = oldY + relY * scaleY;
            // DO NOT change lat/lng. Visual resize scales the local coordinate space 
            // without shifting the physical real-world layout.
            return { ...n, x: nx, y: ny };
          }
          return n;
        });
      }
    } else if ((patch.x !== undefined || patch.y !== undefined) && patch.lat === undefined && patch.lng === undefined) {
      const newCenterX = patch.x ?? oldX;
      const newCenterY = patch.y ?? oldY;
      const newCenterGPS = canvasToGps(newCenterX, newCenterY);
      patch.x = newCenterX;
      patch.y = newCenterY;
      patch.centerLat = newCenterGPS.lat;
      patch.centerLng = newCenterGPS.lng;
      patch.lat = newCenterGPS.lat;
      patch.lng = newCenterGPS.lng;
    } else if ((patch.lat !== undefined || patch.lng !== undefined) && patch.x === undefined && patch.y === undefined) {
      const newLat = patch.lat ?? prev.lat ?? 0;
      const newLng = patch.lng ?? prev.lng ?? 0;
      const centerCanvas = gpsToCanvas(newLat, newLng);
      patch.x = centerCanvas.x;
      patch.y = centerCanvas.y;
      patch.centerLat = newLat;
      patch.centerLng = newLng;
    }

    this.buildings[idx] = { ...this.buildings[idx], ...patch };
    const newX = this.buildings[idx].x ?? 0;
    const newY = this.buildings[idx].y ?? 0;
    const dx = newX - oldX;
    const dy = newY - oldY;

    // Move all child elements belonging to this building's floors, buildingId, stair/lift groups, or spatial bounds
    if (dx !== 0 || dy !== 0) {
      if (
        this.buildings[idx].corner1Lat !== undefined &&
        this.buildings[idx].corner1Lng !== undefined &&
        this.buildings[idx].corner2Lat !== undefined &&
        this.buildings[idx].corner2Lng !== undefined &&
        this.buildings[idx].corner3Lat !== undefined &&
        this.buildings[idx].corner3Lng !== undefined &&
        this.buildings[idx].corner4Lat !== undefined &&
        this.buildings[idx].corner4Lng !== undefined
      ) {
        const c1 = gpsToCanvas(this.buildings[idx].corner1Lat!, this.buildings[idx].corner1Lng!);
        const c2 = gpsToCanvas(this.buildings[idx].corner2Lat!, this.buildings[idx].corner2Lng!);
        const c3 = gpsToCanvas(this.buildings[idx].corner3Lat!, this.buildings[idx].corner3Lng!);
        const c4 = gpsToCanvas(this.buildings[idx].corner4Lat!, this.buildings[idx].corner4Lng!);
        const g1 = canvasToGps(c1.x + dx, c1.y + dy);
        const g2 = canvasToGps(c2.x + dx, c2.y + dy);
        const g3 = canvasToGps(c3.x + dx, c3.y + dy);
        const g4 = canvasToGps(c4.x + dx, c4.y + dy);
        this.buildings[idx].corner1Lat = g1.lat;
        this.buildings[idx].corner1Lng = g1.lng;
        this.buildings[idx].corner2Lat = g2.lat;
        this.buildings[idx].corner2Lng = g2.lng;
        this.buildings[idx].corner3Lat = g3.lat;
        this.buildings[idx].corner3Lng = g3.lng;
        this.buildings[idx].corner4Lat = g4.lat;
        this.buildings[idx].corner4Lng = g4.lng;
      }
      if (this.buildings[idx].footprint && Array.isArray(this.buildings[idx].footprint)) {
        this.buildings[idx].footprint = this.buildings[idx].footprint!.map((pt) => {
          const c = gpsToCanvas(pt.lat, pt.lng);
          return canvasToGps(c.x + dx, c.y + dy);
        });
      }
      const buildingFloors = this.floors.filter((f) => f.buildingId === id);
      const buildingFloorIds = new Set(buildingFloors.map((f) => f.id));

      const buildingStairGroupIds = new Set(
        (this.stairGroups || []).filter((sg) => sg.buildingId === id).map((sg) => sg.id)
      );
      const buildingLiftGroupIds = new Set(
        (this.liftGroups || []).filter((lg) => lg.buildingId === id).map((lg) => lg.id)
      );

      const isNodeInBuilding = (n: Node) => {
        // Outdoor nodes (f-out) are never moved automatically when dragging a building
        if (n.floorId === "f-out") return false;
        if (buildingFloorIds.has(n.floorId)) return true;
        if ((n as unknown as { buildingId?: string }).buildingId === id) return true;
        if (n.stairGroupId && buildingStairGroupIds.has(n.stairGroupId)) return true;
        if (n.liftGroupId && buildingLiftGroupIds.has(n.liftGroupId)) return true;
        return false;
      };

      // 1. Move all Nodes belonging to this building's floors
      this.nodes = this.nodes.map((n) => {
        if (isNodeInBuilding(n)) {
          const nx = n.x + dx;
          const ny = n.y + dy;
          const { lat, lng } = canvasToGps(nx, ny);
          return { ...n, x: nx, y: ny, lat, lng };
        }
        return n;
      });

      const movedNodeIds = new Set(this.nodes.filter(isNodeInBuilding).map((n) => n.id));

      // 2. Move all Doors belonging to this building's floors
      this.doors = this.doors.map((door) => {
        if (door.floorId === "f-out") return door;
        const belongs =
          buildingFloorIds.has(door.floorId) ||
          (door as unknown as { buildingId?: string }).buildingId === id;
        if (belongs) {
          return { ...door, x: door.x + dx, y: door.y + dy };
        }
        return door;
      });

      // 3. Move all Obstacles belonging to this building's floors
      this.obstacles = this.obstacles.map((obs) => {
        if (obs.floorId === "f-out") return obs;
        const belongs =
          (obs.floorId && buildingFloorIds.has(obs.floorId)) ||
          (obs.nodeId && movedNodeIds.has(obs.nodeId));
        if (belongs) {
          return { ...obs, x: obs.x + dx, y: obs.y + dy };
        }
        return obs;
      });

      // 4. Move all Destinations belonging to this building's floors
      this.destinations = this.destinations.map((dest) => {
        if (dest.floorId === "f-out") return dest;
        const belongs =
          (dest.floorId && buildingFloorIds.has(dest.floorId)) ||
          (dest.nodeId && movedNodeIds.has(dest.nodeId));
        if (belongs) {
          return {
            ...dest,
            x: dest.x !== undefined ? dest.x + dx : undefined,
            y: dest.y !== undefined ? dest.y + dy : undefined,
          };
        }
        return dest;
      });

      // 5. Move all Events explicitly associated with building
      this.events = this.events.map((ev) => {
        if (ev.buildingId === id) {
          return {
            ...ev,
            x: ev.x !== undefined ? ev.x + dx : undefined,
            y: ev.y !== undefined ? ev.y + dy : undefined,
          };
        }
        return ev;
      });
    }

    if (recordHistory) {
      // Validation: Check for center drift
      const finalBuilding = this.buildings[idx];
      if (finalBuilding.centerLat && finalBuilding.centerLng && finalBuilding.corner1Lat && finalBuilding.corner1Lng && finalBuilding.corner2Lat && finalBuilding.corner2Lng && finalBuilding.corner3Lat && finalBuilding.corner3Lng && finalBuilding.corner4Lat && finalBuilding.corner4Lng) {
        const corners = [
          { lat: finalBuilding.corner1Lat, lng: finalBuilding.corner1Lng },
          { lat: finalBuilding.corner2Lat, lng: finalBuilding.corner2Lng },
          { lat: finalBuilding.corner3Lat, lng: finalBuilding.corner3Lng },
          { lat: finalBuilding.corner4Lat, lng: finalBuilding.corner4Lng }
        ];
        const trueCenter = getCenterFromCorners(corners);
        const distance = calculateGeographicDistance(finalBuilding.centerLat, finalBuilding.centerLng, trueCenter.lat, trueCenter.lng);
        if (distance > 5) {
          console.warn(`[CampusStore] Warning: Building "${finalBuilding.name}" (ID: ${finalBuilding.id}) centerLat/centerLng has drifted by ${distance.toFixed(2)} meters from its true corners average!`);
          console.warn(`Stored Center: ${finalBuilding.centerLat}, ${finalBuilding.centerLng}`);
          console.warn(`True Center: ${trueCenter.lat}, ${trueCenter.lng}`);
        }
      }

      this.logAction("UPDATE", `Building "${this.buildings[idx].name}"`);
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_BUILDING",
        entityType: "building",
        entityId: id,
        description: `Updated Building "${this.buildings[idx].name}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.buildings[idx],
      });
    }
    this.notify();
  }

  public addFloor(floorOrBuildingId: Floor | string, name?: string, ordinal?: number, code?: string): Floor {
    let f: Floor;
    if (typeof floorOrBuildingId === "object") {
      f = floorOrBuildingId;
    } else {
      const ord = ordinal ?? 1;
      const defaultName =
        ord < 0
          ? ord === -1
            ? "Basement"
            : `Basement ${Math.abs(ord)}`
          : ord === 0
          ? "Ground Floor"
          : `Floor ${ord}`;
      const defaultCode = getFloorCode(ord, name);
      f = {
        id: generateShortId("f", this.floors.map((fl) => fl.id)),
        buildingId: floorOrBuildingId,
        name: name || defaultName,
        ordinal: ord,
        code: code || defaultCode,
      };
    }
    this.saveSnapshotToUndo(`Added Floor "${f.name}"`);
    this.floors.push(f);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_FLOOR",
      entityType: "floor",
      entityId: f.id,
      description: `Added Floor "${f.name}" (Level ${f.ordinal})`,
      timestamp: Date.now(),
      newData: f,
    });
    this.notify();
    return f;
  }

  public updateFloor(id: string, patch: Partial<Floor>) {
    const idx = this.floors.findIndex((f) => f.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo(`Updated Floor "${this.floors[idx].name}"`);
    const prev = { ...this.floors[idx] };
    this.floors[idx] = { ...this.floors[idx], ...patch };

    if (this.publishedGraph.floors) {
      const pubIdx = this.publishedGraph.floors.findIndex((f) => f.id === id);
      if (pubIdx !== -1) {
        this.publishedGraph.floors[pubIdx] = { ...this.publishedGraph.floors[pubIdx], ...patch };
      }
    }

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "UPDATE_FLOOR",
      entityType: "floor",
      entityId: id,
      description: `Updated Floor "${this.floors[idx].name}"`,
      timestamp: Date.now(),
      prevData: prev,
      newData: this.floors[idx],
    });
    this.notify();
  }

  public loadSnapshot(snapshot: any) {
    if (!snapshot) return;
    this.saveSnapshotToUndo("Loaded Graph Snapshot");
    if (snapshot.buildings) this.buildings = snapshot.buildings;
    if (snapshot.floors) this.floors = snapshot.floors;
    if (snapshot.nodes) this.nodes = snapshot.nodes;
    if (snapshot.edges) this.edges = snapshot.edges;
    if (snapshot.destinations) this.destinations = snapshot.destinations;
    if (snapshot.events) this.events = snapshot.events;
    if (snapshot.obstacles) this.obstacles = snapshot.obstacles;
    this.notify();
  }

  // Smart Floor Duplication with selective copying
  public duplicateFloor(
    sourceFloorId: string,
    options: {
      copyRooms?: boolean;
      copyNodes?: boolean;
      copyEdges?: boolean;
      copyFacilities?: boolean;
      copyDestinations?: boolean;
      copyObstacles?: boolean;
    } = { copyNodes: true, copyEdges: true }
  ): Floor | undefined {
    const srcFloor = this.floors.find((f) => f.id === sourceFloorId);
    if (!srcFloor) return;

    this.saveSnapshotToUndo();
    const buildingFloors = this.floors.filter((f) => f.buildingId === srcFloor.buildingId);
    let nextOrdinal: number;
    let newFloorName: string;

    if (srcFloor.ordinal < 0) {
      const minOrdinal = Math.min(...buildingFloors.map((f) => f.ordinal), 0);
      nextOrdinal = Math.min(0, minOrdinal) - 1;
      newFloorName = nextOrdinal === -1 ? "Basement" : `Basement ${Math.abs(nextOrdinal)}`;
    } else {
      const maxOrdinal = Math.max(...buildingFloors.map((f) => f.ordinal), 0);
      nextOrdinal = Math.max(0, maxOrdinal) + 1;
      newFloorName = `Floor ${nextOrdinal}`;
    }

    const newFloorId = generateShortId("f", this.floors.map((fl) => fl.id));

    const newFloor: Floor = {
      id: newFloorId,
      buildingId: srcFloor.buildingId,
      name: newFloorName,
      ordinal: nextOrdinal,
      code: getFloorCode(nextOrdinal, newFloorName),
    };
    this.floors.push(newFloor);

    // Map old node ID to new node ID for edge preservation
    const nodeIdMap = new Map<string, string>();

    // Copy nodes if selected
    if (options.copyNodes) {
      const srcNodes = this.nodes.filter((n) => n.floorId === sourceFloorId);
      srcNodes.forEach((n) => {
        // Skip facility / room filter if disabled
        if (n.type === "ROOM" && !options.copyRooms) return;
        if (n.type === "WASHROOM" && !options.copyFacilities) return;

        const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        nodeIdMap.set(n.id, newId);

        this.nodes.push({
          ...JSON.parse(JSON.stringify(n)),
          id: newId,
          floorId: newFloorId,
          name: n.name ? `${n.name} (Copy)` : undefined,
        });
      });
    }

    // Copy edges if selected
    if (options.copyEdges && options.copyNodes) {
      const srcEdges = this.edges.filter(
        (e) =>
          this.nodes.find((n) => n.id === e.from)?.floorId === sourceFloorId &&
          this.nodes.find((n) => n.id === e.to)?.floorId === sourceFloorId
      );
      srcEdges.forEach((e) => {
        const newFrom = nodeIdMap.get(e.from);
        const newTo = nodeIdMap.get(e.to);
        if (newFrom && newTo) {
          const uniqueEdgeId = `edge-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          this.edges.push({
            ...JSON.parse(JSON.stringify(e)),
            id: uniqueEdgeId,
            from: newFrom,
            to: newTo,
          });
        }
      });
    }

    if (options.copyDestinations && options.copyNodes) {
      const srcDests = this.destinations.filter((d) =>
        Boolean(d.nodeId) && this.nodes.some((n) => n.id === d.nodeId && n.floorId === sourceFloorId)
      );
      srcDests.forEach((d) => {
        if (d.nodeId) {
          const newTargetNode = nodeIdMap.get(d.nodeId);
          if (newTargetNode) {
            this.destinations.push({
              ...JSON.parse(JSON.stringify(d)),
              id: `dest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              nodeId: newTargetNode,
              name: `${d.name} (Copy)`,
            });
          }
        }
      });
    }

    // Copy obstacles if selected
    if (options.copyObstacles) {
      const srcObs = this.obstacles.filter((o) => o.floorId === sourceFloorId);
      srcObs.forEach((o) => {
        this.obstacles.push({
          ...JSON.parse(JSON.stringify(o)),
          id: `obs-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          floorId: newFloorId,
        });
      });
    }

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_FLOOR",
      entityType: "floor",
      entityId: newFloorId,
      description: `Smart Duplicated Floor "${srcFloor.name}" -> "${newFloorName}"`,
      timestamp: Date.now(),
      newData: newFloor,
    });

    this.notify();
    return newFloor;
  }

  public deleteBuilding(id: string) {
    const idx = this.buildings.findIndex((b) => b.id === id);
    if (idx === -1) return;
    const deleted = this.buildings[idx];
    this.saveSnapshotToUndo(`Deleted Building "${deleted.name}"`);
    this.buildings.splice(idx, 1);

    const buildingFloorIds = new Set(this.floors.filter((f) => f.buildingId === id).map((f) => f.id));
    this.floors = this.floors.filter((f) => f.buildingId !== id);

    const deletedNodeIds = new Set(this.nodes.filter((n) => buildingFloorIds.has(n.floorId)).map((n) => n.id));
    this.nodes = this.nodes.filter((n) => !buildingFloorIds.has(n.floorId));
    this.edges = this.edges.filter((e) => !deletedNodeIds.has(e.from) && !deletedNodeIds.has(e.to));
    this.destinations = this.destinations.filter((d) => (!d.nodeId || !deletedNodeIds.has(d.nodeId)) && (!d.floorId || !buildingFloorIds.has(d.floorId)));
    this.doors = this.doors.filter((d) => !buildingFloorIds.has(d.floorId));
    this.obstacles = this.obstacles.filter((o) => !o.floorId || !buildingFloorIds.has(o.floorId));
    this.stairGroups = this.stairGroups.filter((sg) => sg.buildingId !== id);
    this.liftGroups = this.liftGroups.filter((lg) => lg.buildingId !== id);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_BUILDING",
      entityType: "building",
      entityId: id,
      description: `Deleted Building "${deleted.name}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });

    this.persistWorkingDraft();
    this.notify();
  }

  public deleteFloor(id: string) {
    const idx = this.floors.findIndex((f) => f.id === id);
    if (idx === -1) return;
    const deleted = this.floors[idx];
    this.saveSnapshotToUndo(`Deleted Floor "${deleted.name}"`);
    this.floors.splice(idx, 1);

    const deletedNodeIds = new Set(this.nodes.filter((n) => n.floorId === id).map((n) => n.id));
    this.nodes = this.nodes.filter((n) => n.floorId !== id);
    this.edges = this.edges.filter((e) => !deletedNodeIds.has(e.from) && !deletedNodeIds.has(e.to));
    this.destinations = this.destinations.filter((d) => (!d.nodeId || !deletedNodeIds.has(d.nodeId)) && d.floorId !== id);
    this.doors = this.doors.filter((d) => d.floorId !== id);
    this.obstacles = this.obstacles.filter((o) => o.floorId !== id);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_FLOOR",
      entityType: "floor",
      entityId: id,
      description: `Deleted Floor "${deleted.name}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public addNode(node: Node, autoSuggestConnections = false) {
    this.saveSnapshotToUndo(`Added ${node.type} Node "${node.name ?? node.id}"`);
    if (node.visibleToUser === undefined) {
      node.visibleToUser = true;
    }
    if (!node.lat || !node.lng || node.lat === 12.9716 || node.lat === 0) {
      const building = this.getBuildingForNode(node);
      const affine = building ? this.getBuildingAffineMatrix(building.id) : null;
      const { lat, lng } = affine 
        ? affineCanvasToGps(node.x, node.y, affine)
        : canvasToGps(node.x, node.y);
      node.lat = Number(lat.toFixed(9));
      node.lng = Number(lng.toFixed(9));
    }
    this.nodes.push(node);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_NODE",
      entityType: "node",
      entityId: node.id,
      description: `Added ${node.type} Node "${node.name ?? node.id}"`,
      timestamp: Date.now(),
      newData: node,
    });

    // Auto-suggest / connect to nearest adjacent nodes on same floor within threshold distance
    if (autoSuggestConnections) {
      const threshold = 180; // pixel/coord threshold
      const adjacent = this.nodes.filter((n) => {
        if (n.id === node.id || n.floorId !== node.floorId) return false;
        const dx = n.x - node.x;
        const dy = n.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        return dist <= threshold;
      });

      // Auto-connect to closest 2 adjacent nodes if any
      adjacent
        .sort((a, b) => {
          const da = Math.hypot(a.x - node.x, a.y - node.y);
          const db = Math.hypot(b.x - node.x, b.y - node.y);
          return da - db;
        })
        .slice(0, 2)
        .forEach((target) => {
          const bNode = this.getBuildingForNode(node);
          const affNode = bNode ? this.getBuildingAffineMatrix(bNode.id) : null;
          const nGps = node.lat && node.lng 
            ? { lat: node.lat, lng: node.lng } 
            : (affNode ? affineCanvasToGps(node.x, node.y, affNode) : canvasToGps(node.x, node.y));
          
          const bTarget = this.getBuildingForNode(target);
          const affTarget = bTarget ? this.getBuildingAffineMatrix(bTarget.id) : null;
          const tGps = target.lat && target.lng 
            ? { lat: target.lat, lng: target.lng } 
            : (affTarget ? affineCanvasToGps(target.x, target.y, affTarget) : canvasToGps(target.x, target.y));
          
          const d = calculateGeographicDistance(nGps.lat, nGps.lng, tGps.lat, tGps.lng);
          this.addEdgeInternal({
            id: `e-${node.id}-${target.id}`,
            from: node.id,
            to: target.id,
            type: "WALK",
            distance: d > 0 ? d : 10,
            bidirectional: true,
          });
        });
    }

    this.redoStack = [];
    this.notify();
  }

  public updateNode(id: string, patch: Partial<Node>, recordHistory = true) {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo(`Moved/Updated Node "${this.nodes[idx].name ?? id}"`);
    }
    const prev = { ...this.nodes[idx] };

    if ((patch.x !== undefined || patch.y !== undefined) && patch.lat === undefined && patch.lng === undefined) {
      const newX = patch.x ?? this.nodes[idx].x;
      const newY = patch.y ?? this.nodes[idx].y;
      
      const building = this.getBuildingForNode(this.nodes[idx]);
      const affine = building ? this.getBuildingAffineMatrix(building.id) : null;
      const { lat, lng } = affine 
        ? affineCanvasToGps(newX, newY, affine)
        : canvasToGps(newX, newY);
        
      patch.lat = Number(lat.toFixed(9));
      patch.lng = Number(lng.toFixed(9));
    } else if ((patch.lat !== undefined || patch.lng !== undefined) && patch.x === undefined && patch.y === undefined) {
      const newLat = patch.lat ?? this.nodes[idx].lat;
      const newLng = patch.lng ?? this.nodes[idx].lng;
      if (newLat && newLng) {
        const building = this.getBuildingForNode(this.nodes[idx]);
        const affine = building ? this.getBuildingAffineMatrix(building.id) : null;
        const { x, y } = affine 
          ? affineGpsToCanvas(newLat, newLng, affine)
          : gpsToCanvas(newLat, newLng);
          
        patch.x = x;
        patch.y = y;
      }
    }

    const updatedNode = { ...this.nodes[idx], ...patch };
    this.nodes[idx] = updatedNode;

    // Synchronize all vertical group sibling nodes (stairGroupId / liftGroupId) across floors to keep vertical shaft aligned
    if (updatedNode.liftGroupId && (patch.x !== undefined || patch.y !== undefined || patch.lat !== undefined || patch.lng !== undefined)) {
      const newX = updatedNode.x;
      const newY = updatedNode.y;
      const newLat = updatedNode.lat;
      const newLng = updatedNode.lng;
      this.nodes.forEach((n, i) => {
        if (n.liftGroupId === updatedNode.liftGroupId && n.id !== id) {
          this.nodes[i] = { ...n, x: newX, y: newY, lat: newLat, lng: newLng };
        }
      });
    }

    if (updatedNode.stairGroupId && (patch.x !== undefined || patch.y !== undefined || patch.lat !== undefined || patch.lng !== undefined)) {
      const newX = updatedNode.x;
      const newY = updatedNode.y;
      const newLat = updatedNode.lat;
      const newLng = updatedNode.lng;
      this.nodes.forEach((n, i) => {
        if (n.stairGroupId === updatedNode.stairGroupId && n.id !== id) {
          this.nodes[i] = { ...n, x: newX, y: newY, lat: newLat, lng: newLng };
        }
      });
    }

    // Synchronize linked destinations if room node moved
    if (patch.x !== undefined || patch.y !== undefined) {
      const newX = updatedNode.x;
      const newY = updatedNode.y;
      this.destinations = this.destinations.map((dest) => {
        if (dest.nodeId === id) {
          return {
            ...dest,
            x: newX,
            y: newY,
          };
        }
        return dest;
      });
    }

    if (recordHistory) {
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_NODE",
        entityType: "node",
        entityId: id,
        description: `Moved/Updated Node "${this.nodes[idx].name ?? id}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.nodes[idx],
      });
    }
    this.notify();
  }



  public deleteNode(id: string) {
    const idx = this.nodes.findIndex((n) => n.id === id);
    if (idx === -1) return;
    const deleted = this.nodes[idx];
    this.saveSnapshotToUndo(`Deleted Node "${deleted.name ?? id}"`);
    this.nodes.splice(idx, 1);
    this.edges = this.edges.filter((e) => e.from !== id && e.to !== id);
    this.destinations.forEach((d) => {
      if (d.nodeId === id) {
        d.nodeId = undefined;
      }
    });
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_NODE",
      entityType: "node",
      entityId: id,
      description: `Deleted Node "${deleted.name ?? id}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public deleteEdge(id: string) {
    const baseId = id.replace(/_rev$/, "");
    const targetEdge = this.edges.find((e) => e.id === id || e.id === baseId || e.id === `${baseId}_rev`);
    if (!targetEdge) return;

    const fromId = targetEdge.from;
    const toId = targetEdge.to;

    this.saveSnapshotToUndo(`Deleted Edge "${id}"`);
    this.edges = this.edges.filter(
      (e) =>
        e.id !== id &&
        e.id !== baseId &&
        e.id !== `${baseId}_rev` &&
        !(e.from === fromId && e.to === toId) &&
        !(e.from === toId && e.to === fromId)
    );

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_EDGE",
      entityType: "edge",
      entityId: id,
      description: `Deleted Edge "${id}"`,
      timestamp: Date.now(),
      prevData: targetEdge,
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public deleteDestination(id: string) {
    const idx = this.destinations.findIndex((d) => d.id === id);
    if (idx === -1) return;
    const deleted = this.destinations[idx];
    this.saveSnapshotToUndo(`Deleted Destination "${deleted.name}"`);
    this.destinations.splice(idx, 1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_DESTINATION",
      entityType: "destination",
      entityId: id,
      description: `Deleted Destination "${deleted.name}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public deleteObstacle(id: string) {
    const idx = this.obstacles.findIndex((o) => o.id === id);
    if (idx === -1) return;
    const deleted = this.obstacles[idx];
    this.saveSnapshotToUndo(`Deleted Obstacle "${deleted.reason ?? id}"`);
    this.obstacles.splice(idx, 1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_OBSTACLE",
      entityType: "obstacle",
      entityId: id,
      description: `Deleted Obstacle "${deleted.reason ?? id}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public deleteEvent(id: string) {
    const idx = this.events.findIndex((e) => e.id === id);
    if (idx === -1) return;
    const deleted = this.events[idx];
    this.saveSnapshotToUndo(`Deleted Event "${deleted.title}"`);
    this.events.splice(idx, 1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_EVENT",
      entityType: "event",
      entityId: id,
      description: `Deleted Event "${deleted.title}"`,
      timestamp: Date.now(),
      prevData: deleted,
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public clearAll() {
    this.saveSnapshotToUndo("Cleared All Campus Graph Elements");
    this.buildings = [];
    this.floors = [];
    this.nodes = [];
    this.edges = [];
    this.destinations = [];
    this.events = [];
    this.obstacles = [];
    this.stairGroups = [];
    this.liftGroups = [];
    this.doors = [];
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "BULK_DELETE",
      entityType: "node",
      entityId: "all",
      description: "Cleared all campus graph elements",
      timestamp: Date.now(),
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public duplicateNode(nodeId: string): Node | undefined {
    const node = this.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    this.saveSnapshotToUndo(`Duplicated Node "${node.name ?? nodeId}"`);
    const newId = generateShortId("n", this.nodes.map((n) => n.id));
    const copy: Node = {
      ...JSON.parse(JSON.stringify(node)),
      id: newId,
      x: node.x + 20,
      y: node.y + 20,
      name: node.name ? `${node.name} (Copy)` : undefined,
    };
    this.nodes.push(copy);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_NODE",
      entityType: "node",
      entityId: newId,
      description: `Duplicated Node "${node.name ?? nodeId}"`,
      timestamp: Date.now(),
      newData: copy,
    });
    this.notify();
    return copy;
  }

  public disconnectNode(nodeId: string) {
    this.saveSnapshotToUndo(`Disconnected Node "${nodeId}"`);
    this.edges = this.edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    this.notify();
  }

  // Stair Group System

  public createStairGroup(
    buildingId: string,
    name: string,
    connectedFloorIds: string[],
    pos?: { x: number; y: number }
  ): StairGroup {
    const groupName = name.trim() || "Staircase A";
    const groupId = generateShortId("stair", (this.stairGroups || []).map((sg) => sg.id));
    this.saveSnapshotToUndo(`Created Staircase Group "${groupName}"`);

    let targetPos = pos;
    if (!targetPos) {
      const b = this.buildings.find((item) => item.id === buildingId);
      if (b) {
        targetPos = { x: (b.x ?? 0) + (b.width ?? 180) / 2, y: (b.y ?? 0) + (b.height ?? 120) / 2 };
      } else {
        targetPos = { x: 300, y: 300 };
      }
    }

    const stairGroup: StairGroup = {
      id: groupId,
      buildingId,
      name: groupName,
      connectedFloorIds,
    };
    this.stairGroups.push(stairGroup);

    this.rebuildStairGroupConnections(stairGroup, targetPos);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_STAIR_GROUP",
      entityType: "stairGroup",
      entityId: groupId,
      description: `Created Stair Group "${groupName}" connecting ${connectedFloorIds.length} floors`,
      timestamp: Date.now(),
      newData: stairGroup,
    });

    this.notify();
    return stairGroup;
  }

  public updateStairGroup(groupId: string, patch: Partial<StairGroup>, pos?: { x: number; y: number }) {
    const idx = this.stairGroups.findIndex((sg) => sg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.stairGroups[idx] = { ...this.stairGroups[idx], ...patch };
    this.rebuildStairGroupConnections(this.stairGroups[idx], pos);
    this.notify();
  }

  public deleteStairGroup(groupId: string) {
    const idx = this.stairGroups.findIndex((sg) => sg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const deleted = this.stairGroups[idx];
    this.stairGroups.splice(idx, 1);

    // Collect node IDs BEFORE deleting nodes, to catch orphaned reverse edges
    const groupNodeIds = new Set(
      this.nodes.filter((n) => n.stairGroupId === groupId).map((n) => n.id)
    );

    // Delete all nodes belonging to this stair group
    this.nodes = this.nodes.filter((n) => n.stairGroupId !== groupId);

    // Delete all edges belonging to this stair group AND orphaned reverse edges
    this.edges = this.edges.filter((e) => {
      if (e.stairGroupId === groupId) return false;
      if (e.type === "STAIRS" && groupNodeIds.has(e.from) && groupNodeIds.has(e.to)) return false;
      return true;
    });
    this.notify();
  }





  public autoConnectMatchingVerticalNodesAcrossFloors() {
    let createdAny = false;

    // 1. STAIR NODES AUTO-CONNECTION
    const stairNodes = this.nodes.filter(
      (n) => n.type === "STAIR" || n.stairGroupId || (n.name && n.name.toLowerCase().includes("stair"))
    );
    const stairGroupMap = new Map<string, Node[]>();

    const getStairCanonicalKey = (n: Node) => {
      if (n.stairGroupId) return `sg_${n.stairGroupId}`;
      const ext = n as any;
      if (ext.connectorId) return `conn_${ext.connectorId}`;
      const rawName = (n.name || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
      const cleaned = rawName
        .replace(/\b(staircases|staircase|stairs|stair|st)\b/gi, "")
        .replace(/[^a-z0-9]/gi, "")
        .trim();
      if (cleaned.length > 0) return `stair_${cleaned}`;
      if (!rawName) return "";
      return `stair_${rawName.replace(/[\s\-_]+/g, "_")}`;
    };

    stairNodes.forEach((n) => {
      const key = getStairCanonicalKey(n);
      if (key) {
        const list = stairGroupMap.get(key) || [];
        list.push(n);
        stairGroupMap.set(key, list);
      }
    });

    // Merge spatially aligned stair nodes (within 150px 2D column distance across different floors)
    for (let i = 0; i < stairNodes.length; i++) {
      for (let j = i + 1; j < stairNodes.length; j++) {
        const n1 = stairNodes[i];
        const n2 = stairNodes[j];
        if (n1.floorId === n2.floorId) {
          // On same floor: if very close (<= 120px) and not connected, connect them
          if (Math.hypot(n1.x - n2.x, n1.y - n2.y) <= 120) {
            const hasEdge = this.edges.some(
              (e) => (e.from === n1.id && e.to === n2.id) || (e.from === n2.id && e.to === n1.id)
            );
            if (!hasEdge) {
              const edgeId = generateShortId("e", this.edges.map((e) => e.id));
              const n1Gps = n1.lat && n1.lng ? { lat: n1.lat, lng: n1.lng } : canvasToGps(n1.x, n1.y);
              const n2Gps = n2.lat && n2.lng ? { lat: n2.lat, lng: n2.lng } : canvasToGps(n2.x, n2.y);
              const dist = calculateGeographicDistance(n1Gps.lat, n1Gps.lng, n2Gps.lat, n2Gps.lng);
              this.addEdgeInternal({
                id: edgeId,
                from: n1.id,
                to: n2.id,
                type: "STAIRS",
                distance: dist > 0 ? dist : 5,
                bidirectional: true,
              });
              createdAny = true;
            }
          }
          continue;
        }

        if (Math.hypot(n1.x - n2.x, n1.y - n2.y) <= 150) {
          const k1 = getStairCanonicalKey(n1) || `pos_${Math.round(n1.x / 40)}_${Math.round(n1.y / 40)}`;
          const k2 = getStairCanonicalKey(n2) || `pos_${Math.round(n2.x / 40)}_${Math.round(n2.y / 40)}`;
          if (k1 && k2 && k1 !== k2) {
            const list1 = stairGroupMap.get(k1) || [n1];
            const list2 = stairGroupMap.get(k2) || [n2];
            const merged = Array.from(new Set([...list1, ...list2]));
            stairGroupMap.set(k1, merged);
            stairGroupMap.delete(k2);
          }
        }
      }
    }

    // Purge any previously auto-generated unwanted horizontal same-floor stair links
    const prevEdgeCount = this.edges.length;
    this.edges = this.edges.filter((e) => !e.id.startsWith("e-stair-hlink-") && !e.id.startsWith("e-stair-floorlink-"));
    if (this.edges.length !== prevEdgeCount) {
      createdAny = true;
    }

    stairGroupMap.forEach((nodesInGroup) => {
      if (nodesInGroup.length >= 2) {
        nodesInGroup.sort((a, b) => {
          const fA = this.floors.find((f) => f.id === a.floorId)?.ordinal ?? 0;
          const fB = this.floors.find((f) => f.id === b.floorId)?.ordinal ?? 0;
          return fA - fB;
        });

        for (let i = 0; i < nodesInGroup.length - 1; i++) {
          const from = nodesInGroup[i];
          const to = nodesInGroup[i + 1];
          if (from.floorId !== to.floorId) {
            const hasEdge = this.edges.some(
              (e) => (e.from === from.id && e.to === to.id) || (e.from === to.id && e.to === from.id)
            );
            if (!hasEdge) {
              const edgeId = generateShortId("e", this.edges.map((e) => e.id));
              this.addEdgeInternal({
                id: edgeId,
                from: from.id,
                to: to.id,
                type: "STAIRS",
                distance: 15,
                bidirectional: true,
              });
              createdAny = true;
            }
          }
        }
      }
    });

    // 2. LIFT / ELEVATOR NODES AUTO-CONNECTION
    const liftNodes = this.nodes.filter(
      (n) => n.type === "LIFT" || n.liftGroupId || (n.name && (n.name.toLowerCase().includes("lift") || n.name.toLowerCase().includes("elevator")))
    );
    const liftGroupMap = new Map<string, Node[]>();

    const getLiftCanonicalKey = (n: Node) => {
      if (n.liftGroupId) return `lg_${n.liftGroupId}`;
      const ext = n as any;
      if (ext.connectorId) return `conn_${ext.connectorId}`;
      const rawName = (n.name || "").replace(/\s*\([^)]*\)/g, "").trim().toLowerCase();
      const cleaned = rawName
        .replace(/\b(elevators|elevator|lifts|lift|el)\b/gi, "")
        .replace(/[^a-z0-9]/gi, "")
        .trim();
      if (cleaned.length > 0) return `lift_${cleaned}`;
      if (!rawName) return "";
      return `lift_${rawName.replace(/[\s\-_]+/g, "_")}`;
    };

    liftNodes.forEach((n) => {
      const key = getLiftCanonicalKey(n);
      if (key) {
        const list = liftGroupMap.get(key) || [];
        list.push(n);
        liftGroupMap.set(key, list);
      }
    });

    // Spatial grouping for lifts across different floors (within 150px column radius)
    for (let i = 0; i < liftNodes.length; i++) {
      for (let j = i + 1; j < liftNodes.length; j++) {
        const n1 = liftNodes[i];
        const n2 = liftNodes[j];
        if (n1.floorId === n2.floorId) {
          // On same floor: if close (<= 120px) and not connected, connect them
          if (Math.hypot(n1.x - n2.x, n1.y - n2.y) <= 120) {
            const hasEdge = this.edges.some(
              (e) => (e.from === n1.id && e.to === n2.id) || (e.from === n2.id && e.to === n1.id)
            );
            if (!hasEdge) {
              const edgeId = generateShortId("e", this.edges.map((e) => e.id));
              const n1Gps = n1.lat && n1.lng ? { lat: n1.lat, lng: n1.lng } : canvasToGps(n1.x, n1.y);
              const n2Gps = n2.lat && n2.lng ? { lat: n2.lat, lng: n2.lng } : canvasToGps(n2.x, n2.y);
              const dist = calculateGeographicDistance(n1Gps.lat, n1Gps.lng, n2Gps.lat, n2Gps.lng);
              this.addEdgeInternal({
                id: edgeId,
                from: n1.id,
                to: n2.id,
                type: "LIFT",
                distance: dist > 0 ? dist : 5,
                bidirectional: true,
              });
              createdAny = true;
            }
          }
          continue;
        }

        if (Math.hypot(n1.x - n2.x, n1.y - n2.y) <= 150) {
          const k1 = getLiftCanonicalKey(n1) || `pos_${Math.round(n1.x / 40)}_${Math.round(n1.y / 40)}`;
          const k2 = getLiftCanonicalKey(n2) || `pos_${Math.round(n2.x / 40)}_${Math.round(n2.y / 40)}`;
          if (k1 && k2 && k1 !== k2) {
            const list1 = liftGroupMap.get(k1) || [n1];
            const list2 = liftGroupMap.get(k2) || [n2];
            const merged = Array.from(new Set([...list1, ...list2]));
            liftGroupMap.set(k1, merged);
            liftGroupMap.delete(k2);
          }
        }
      }
    }

    liftGroupMap.forEach((nodesInGroup) => {
      if (nodesInGroup.length >= 2) {
        nodesInGroup.sort((a, b) => {
          const fA = this.floors.find((f) => f.id === a.floorId)?.ordinal ?? 0;
          const fB = this.floors.find((f) => f.id === b.floorId)?.ordinal ?? 0;
          return fA - fB;
        });

        for (let i = 0; i < nodesInGroup.length - 1; i++) {
          const from = nodesInGroup[i];
          const to = nodesInGroup[i + 1];
          if (from.floorId !== to.floorId) {
            const hasEdge = this.edges.some(
              (e) => (e.from === from.id && e.to === to.id) || (e.from === to.id && e.to === from.id)
            );
            if (!hasEdge) {
              const edgeId = generateShortId("e", this.edges.map((e) => e.id));
              this.addEdgeInternal({
                id: edgeId,
                from: from.id,
                to: to.id,
                type: "LIFT",
                distance: 10,
                bidirectional: true,
              });
              createdAny = true;
            }
          }
        }
      }
    });

    if (createdAny) {
      this.persistWorkingDraft();
    }
  }


  private rebuildStairGroupConnections(group: StairGroup, basePos?: { x: number; y: number }) {
    // Get all connected floors and fill any intermediate floor gaps (min ordinal to max ordinal)
    const rawConnectedFloors = this.floors.filter((f) => group.connectedFloorIds.includes(f.id));
    let buildingFloors = rawConnectedFloors.sort((a, b) => a.ordinal - b.ordinal);

    if (buildingFloors.length >= 2) {
      const minOrdinal = buildingFloors[0].ordinal;
      const maxOrdinal = buildingFloors[buildingFloors.length - 1].ordinal;
      const targetBldId = buildingFloors[0].buildingId;

      buildingFloors = this.floors
        .filter((f) => f.buildingId === targetBldId && f.ordinal >= minOrdinal && f.ordinal <= maxOrdinal)
        .sort((a, b) => a.ordinal - b.ordinal);
    }

    const existingNode = this.nodes.find((n) => n.stairGroupId === group.id);
    const refX = basePos?.x ?? existingNode?.x ?? 300;
    const refY = basePos?.y ?? existingNode?.y ?? 300;

    // Ensure stair node exists on each connected floor with matching (x, y) coordinates
    const createdNodes: Node[] = [];
    buildingFloors.forEach((fl) => {
      let node = this.nodes.find((n) => n.stairGroupId === group.id && n.floorId === fl.id);
      if (!node) {
        node = {
          id: generateShortId("n", this.nodes.map((n) => n.id)),
          type: "STAIR",
          name: `${group.name} (${fl.name})`,
          floorId: fl.id,
          x: refX,
          y: refY,
          stairGroupId: group.id,
        };
        this.nodes.push(node);
      } else {
        node.x = refX;
        node.y = refY;
      }
      createdNodes.push(node);
    });

    // Remove stair nodes on floors no longer connected to this group
    this.nodes = this.nodes.filter(
      (n) => n.stairGroupId !== group.id || group.connectedFloorIds.includes(n.floorId)
    );

    // Collect all node IDs belonging to this stair group for orphaned edge cleanup
    const groupNodeIds = new Set(
      this.nodes.filter((n) => n.stairGroupId === group.id).map((n) => n.id)
    );

    // Remove existing vertical stair edges for this group AND any orphaned reverse edges
    // (reverse edges may lack stairGroupId due to addEdgeInternal not copying it previously)
    this.edges = this.edges.filter((e) => {
      // Remove edges explicitly tagged with this stair group
      if (e.stairGroupId === group.id) return false;
      // Remove orphaned STAIRS edges where both endpoints belong to this group's nodes
      if (e.type === "STAIRS" && groupNodeIds.has(e.from) && groupNodeIds.has(e.to)) return false;
      return true;
    });
    for (let i = 0; i < createdNodes.length - 1; i++) {
      const fromNode = createdNodes[i];
      const toNode = createdNodes[i + 1];
      const edgeId = generateShortId("e", this.edges.map((e) => e.id));
      this.addEdgeInternal({
        id: edgeId,
        from: fromNode.id,
        to: toNode.id,
        type: "STAIRS",
        distance: 15,
        bidirectional: true,
        stairGroupId: group.id,
      });
    }

    
    // Consecutive vertical stair edges created without auto-connecting to floor nodes
  }

  // Lift Group System

  public createLiftGroup(
    buildingId: string,
    name: string,
    servedFloorIds: string[],
    pos?: { x: number; y: number }
  ): LiftGroup {
    this.saveSnapshotToUndo();
    const groupId = generateShortId("lift", (this.liftGroups || []).map((lg) => lg.id));
    const groupName = name.trim() || "Elevator 1";

    let targetPos = pos;
    if (!targetPos) {
      const b = this.buildings.find((item) => item.id === buildingId);
      if (b) {
        targetPos = { x: (b.x ?? 0) + (b.width ?? 180) / 2, y: (b.y ?? 0) + (b.height ?? 120) / 2 };
      } else {
        targetPos = { x: 350, y: 350 };
      }
    }

    const liftGroup: LiftGroup = {
      id: groupId,
      buildingId,
      name: groupName,
      servedFloorIds,
      isAccessible: true,
    };
    this.liftGroups.push(liftGroup);

    this.rebuildLiftGroupConnections(liftGroup, targetPos);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_LIFT_GROUP",
      entityType: "liftGroup",
      entityId: groupId,
      description: `Created Lift Group "${groupName}" serving ${servedFloorIds.length} floors`,
      timestamp: Date.now(),
      newData: liftGroup,
    });

    this.notify();
    return liftGroup;
  }

  public updateLiftGroup(groupId: string, patch: Partial<LiftGroup>, pos?: { x: number; y: number }) {
    const idx = this.liftGroups.findIndex((lg) => lg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.liftGroups[idx] = { ...this.liftGroups[idx], ...patch };
    this.rebuildLiftGroupConnections(this.liftGroups[idx], pos);
    this.notify();
  }

  public deleteLiftGroup(groupId: string) {
    const idx = this.liftGroups.findIndex((lg) => lg.id === groupId);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    this.liftGroups.splice(idx, 1);
    this.nodes = this.nodes.filter((n) => n.liftGroupId !== groupId);
    this.edges = this.edges.filter((e) => e.liftGroupId !== groupId);
    this.notify();
  }

  private rebuildLiftGroupConnections(group: LiftGroup, basePos?: { x: number; y: number }) {
    const buildingFloors = this.floors
      .filter((f) => group.servedFloorIds.includes(f.id))
      .sort((a, b) => a.ordinal - b.ordinal);

    const existingNode = this.nodes.find((n) => n.liftGroupId === group.id);
    const refX = basePos?.x ?? existingNode?.x ?? 350;
    const refY = basePos?.y ?? existingNode?.y ?? 350;

    const createdNodes: Node[] = [];
    buildingFloors.forEach((fl) => {
      let node = this.nodes.find((n) => n.liftGroupId === group.id && n.floorId === fl.id);
      if (!node) {
        node = {
          id: generateShortId("n", this.nodes.map((n) => n.id)),
          type: "LIFT",
          name: `${group.name} (${fl.name})`,
          floorId: fl.id,
          x: refX,
          y: refY,
          liftGroupId: group.id,
        };
        this.nodes.push(node);
      } else {
        node.x = refX;
        node.y = refY;
      }
      createdNodes.push(node);
    });

    this.nodes = this.nodes.filter(
      (n) => n.liftGroupId !== group.id || group.servedFloorIds.includes(n.floorId)
    );

    this.edges = this.edges.filter((e) => e.liftGroupId !== group.id);
    for (let i = 0; i < createdNodes.length - 1; i++) {
      const fromNode = createdNodes[i];
      const toNode = createdNodes[i + 1];
      const edgeId = generateShortId("e", this.edges.map((e) => e.id));
      this.addEdgeInternal({
        id: edgeId,
        from: fromNode.id,
        to: toNode.id,
        type: "LIFT",
        distance: 10,
        bidirectional: true,
        liftGroupId: group.id,
      });
    }

    // Consecutive vertical lift edges created without auto-connecting to floor nodes
  }



  public addEdge(edge: Edge): { success: boolean; error?: string } {
    // Validate duplicate edge
    const exists = this.edges.some(
      (e) =>
        (e.from === edge.from && e.to === edge.to) ||
        (e.bidirectional && e.from === edge.to && e.to === edge.from),
    );
    if (exists) {
      return { success: false, error: "Edge connection already exists between these nodes." };
    }

    this.saveSnapshotToUndo();
    this.addEdgeInternal(edge);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EDGE",
      entityType: "edge",
      entityId: edge.id,
      description: `Connected Edge (${edge.from} ↔ ${edge.to})`,
      timestamp: Date.now(),
      newData: edge,
    });
    this.logAction("CREATE", `Edge (${edge.from} ↔ ${edge.to})`);
    this.redoStack = [];
    this.notify();
    return { success: true };
  }

  private addEdgeInternal(edge: Edge) {
    this.edges.push(edge);
    if (edge.bidirectional) {
      const revId = edge.id.includes(edge.from) && edge.id.includes(edge.to)
        ? `e-${edge.to}-${edge.from}`
        : `${edge.id}_rev`;
      if (!this.edges.some((e) => e.id === revId || (e.from === edge.to && e.to === edge.from))) {
        this.edges.push({
          id: revId,
          from: edge.to,
          to: edge.from,
          type: edge.type,
          pathType: edge.pathType,
          distance: edge.distance,
          bidirectional: true,
          // Propagate group IDs so cleanup/delete operations work correctly
          ...(edge.stairGroupId ? { stairGroupId: edge.stairGroupId } : {}),
          ...(edge.liftGroupId ? { liftGroupId: edge.liftGroupId } : {}),
        });
      }
    }
  }

  public updateEdge(id: string, patch: Partial<Edge>) {
    const idx = this.edges.findIndex((e) => e.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const prev = { ...this.edges[idx] };

    // Auto-sync type and pathType when either is set to EV or ROAD
    const finalPatch = { ...patch };
    if (finalPatch.pathType === "EV" && finalPatch.type === undefined) {
      finalPatch.type = "ROAD";
    } else if (finalPatch.type === "ROAD" && finalPatch.pathType === undefined) {
      finalPatch.pathType = "EV";
    } else if (finalPatch.pathType === "WALK" && finalPatch.type === "ROAD") {
      finalPatch.type = "WALK";
    }

    this.edges[idx] = { ...this.edges[idx], ...finalPatch };
    const updated = this.edges[idx];

    // Sync reverse edge properties if twin exists
    const revIdx = this.edges.findIndex(
      (e) => (e.id === `e-${updated.to}-${updated.from}` || e.id === `${id}_rev` || (e.from === updated.to && e.to === updated.from)) && e.id !== id
    );
    if (revIdx !== -1) {
      this.edges[revIdx] = {
        ...this.edges[revIdx],
        ...(finalPatch.pathType !== undefined ? { pathType: finalPatch.pathType } : {}),
        ...(finalPatch.type !== undefined ? { type: finalPatch.type } : {}),
        ...(finalPatch.distance !== undefined ? { distance: finalPatch.distance } : {}),
      };
    }

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "UPDATE_EDGE",
      entityType: "edge",
      entityId: id,
      description: `Updated Edge "${id}"`,
      timestamp: Date.now(),
      prevData: prev,
      newData: this.edges[idx],
    });
    this.persistWorkingDraft();
    this.notify();
  }

  public splitEdgeWithNode(edgeId: string, x: number, y: number, type: NodeType, name?: string) {
    const baseId = edgeId.replace(/_rev$/, "");
    const edge = this.edges.find((e) => e.id === edgeId || e.id === baseId);
    if (!edge) return null;

    const fromNode = this.nodes.find((n) => n.id === edge.from);
    const toNode = this.nodes.find((n) => n.id === edge.to);
    if (!fromNode || !toNode) return null;

    this.startBatching();

    const newNodeId = generateShortId("n", this.nodes.map((n) => n.id));
    const { lat, lng } = canvasToGps(x, y);
    const newNode: Node = {
      id: newNodeId,
      type,
      name: name || undefined,
      floorId: fromNode.floorId,
      x,
      y,
      lat,
      lng,
      searchable: true,
    };
    this.nodes.push(newNode);

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_NODE",
      entityType: "node",
      entityId: newNodeId,
      description: `Added split node on edge at (${x}, ${y})`,
      timestamp: Date.now(),
      newData: newNode,
    });

    this.edges = this.edges.filter(
      (e) =>
        e.id !== edge.id &&
        e.id !== baseId &&
        e.id !== `${baseId}_rev` &&
        !(e.from === edge.from && e.to === edge.to) &&
        !(e.from === edge.to && e.to === edge.from)
    );

    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "DELETE_EDGE",
      entityType: "edge",
      entityId: edge.id,
      description: `Deleted split edge "${edge.id}"`,
      timestamp: Date.now(),
      prevData: edge,
    });

    const fnGps = fromNode.lat && fromNode.lng ? { lat: fromNode.lat, lng: fromNode.lng } : canvasToGps(fromNode.x, fromNode.y);
    const tnGps = toNode.lat && toNode.lng ? { lat: toNode.lat, lng: toNode.lng } : canvasToGps(toNode.x, toNode.y);
    const splitGps = canvasToGps(x, y);

    const dist1 = calculateGeographicDistance(fnGps.lat, fnGps.lng, splitGps.lat, splitGps.lng);
    const dist2 = calculateGeographicDistance(splitGps.lat, splitGps.lng, tnGps.lat, tnGps.lng);

    const edge1: Edge = {
      id: `e-${fromNode.id}-${newNodeId}`,
      from: fromNode.id,
      to: newNodeId,
      type: edge.type,
      pathType: edge.pathType,
      distance: dist1,
      bidirectional: edge.bidirectional,
    };
    const edge2: Edge = {
      id: `e-${newNodeId}-${toNode.id}`,
      from: newNodeId,
      to: toNode.id,
      type: edge.type,
      pathType: edge.pathType,
      distance: dist2,
      bidirectional: edge.bidirectional,
    };

    this.addEdgeInternal(edge1);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EDGE",
      entityType: "edge",
      entityId: edge1.id,
      description: `Connected Edge (${edge1.from} ↔ ${edge1.to})`,
      timestamp: Date.now(),
      newData: edge1,
    });

    this.addEdgeInternal(edge2);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EDGE",
      entityType: "edge",
      entityId: edge2.id,
      description: `Connected Edge (${edge2.from} ↔ ${edge2.to})`,
      timestamp: Date.now(),
      newData: edge2,
    });

    this.endBatching();
    return newNodeId;
  }

  public addDestination(d: Destination) {
    this.saveSnapshotToUndo();
    this.destinations.push(d);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_DESTINATION",
      entityType: "destination",
      entityId: d.id,
      description: `Added Destination "${d.name}"`,
      timestamp: Date.now(),
      newData: d,
    });
    this.logAction("CREATE", `Destination "${d.name}"`);
    this.redoStack = [];
    this.notify();
  }

  public updateDestination(id: string, patch: Partial<Destination>, recordHistory = true) {
    const idx = this.destinations.findIndex((d) => d.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo();
    }
    const prev = { ...this.destinations[idx] };
    this.destinations[idx] = { ...this.destinations[idx], ...patch };

    // Synchronize linked node name if room name changed
    if (patch.name !== undefined) {
      const linkedNodeId = this.destinations[idx].nodeId;
      if (linkedNodeId) {
        const nodeIdx = this.nodes.findIndex((n) => n.id === linkedNodeId);
        if (nodeIdx !== -1) {
          this.nodes[nodeIdx].name = patch.name;
        }
      }
    }

    if (recordHistory) {
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_DESTINATION",
        entityType: "destination",
        entityId: id,
        description: `Updated Destination "${this.destinations[idx].name}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.destinations[idx],
      });
    }
    this.notify();
  }

  // Event Actions

  public addEvent(ev: Event) {
    this.saveSnapshotToUndo();
    this.events.push(ev);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_EVENT",
      entityType: "event",
      entityId: ev.id,
      description: `Added Campus Event "${ev.title}"`,
      timestamp: Date.now(),
      newData: ev,
    });
    this.logAction("CREATE", `Event "${ev.title}"`);
    this.redoStack = [];
    this.notify();
  }

  public updateEvent(id: string, patch: Partial<Event>) {
    const idx = this.events.findIndex((ev) => ev.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const prev = { ...this.events[idx] };
    this.events[idx] = { ...this.events[idx], ...patch };
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "UPDATE_EVENT",
      entityType: "event",
      entityId: id,
      description: `Updated Campus Event "${this.events[idx].title}"`,
      timestamp: Date.now(),
      prevData: prev,
      newData: this.events[idx],
    });
    this.notify();
  }

  // Obstacle Actions

  public addObstacle(obs: Obstacle) {
    this.saveSnapshotToUndo();
    this.obstacles.push(obs);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_OBSTACLE",
      entityType: "obstacle",
      entityId: obs.id,
      description: `Added Obstacle "${obs.reason ?? obs.id}" (${obs.radius}m)`,
      timestamp: Date.now(),
      newData: obs,
    });
    this.logAction("CREATE", `Obstacle "${obs.reason ?? obs.id}"`);
    this.redoStack = [];
    this.notify();
  }

  public updateObstacle(id: string, patch: Partial<Obstacle>, recordHistory = true) {
    const idx = this.obstacles.findIndex((obs) => obs.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo();
    }
    const prev = { ...this.obstacles[idx] };
    this.obstacles[idx] = { ...this.obstacles[idx], ...patch };
    if (recordHistory) {
      this.pendingChanges.unshift({
        id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        type: "UPDATE_OBSTACLE",
        entityType: "obstacle",
        entityId: id,
        description: `Updated Obstacle "${this.obstacles[idx].reason ?? id}"`,
        timestamp: Date.now(),
        prevData: prev,
        newData: this.obstacles[idx],
      });
    }
    this.notify();
  }

  public undo(): { success: boolean; description?: string } {
    if (this.undoStack.length === 0) return { success: false };
    const targetEntry = this.undoStack.pop()!;
    this.redoStack.push({
      id: `redo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      description: targetEntry.description,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    });

    const s = targetEntry.snapshot;
    this.buildings = JSON.parse(JSON.stringify(s.buildings));
    this.floors = JSON.parse(JSON.stringify(s.floors));
    this.nodes = JSON.parse(JSON.stringify(s.nodes));
    this.edges = JSON.parse(JSON.stringify(s.edges));
    this.destinations = JSON.parse(JSON.stringify(s.destinations));
    this.events = JSON.parse(JSON.stringify(s.events ?? []));
    this.obstacles = JSON.parse(JSON.stringify(s.obstacles ?? []));
    this.stairGroups = JSON.parse(JSON.stringify(s.stairGroups ?? []));
    this.liftGroups = JSON.parse(JSON.stringify(s.liftGroups ?? []));
    this.doors = JSON.parse(JSON.stringify(s.doors ?? []));
    if (s.pendingChanges) {
      this.pendingChanges = JSON.parse(JSON.stringify(s.pendingChanges));
    }
    this.notify();
    return { success: true, description: targetEntry.description };
  }

  public redo(): { success: boolean; description?: string } {
    if (this.redoStack.length === 0) return { success: false };
    const targetEntry = this.redoStack.pop()!;
    this.undoStack.push({
      id: `undo-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      description: targetEntry.description,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    });

    const s = targetEntry.snapshot;
    this.buildings = JSON.parse(JSON.stringify(s.buildings));
    this.floors = JSON.parse(JSON.stringify(s.floors));
    this.nodes = JSON.parse(JSON.stringify(s.nodes));
    this.edges = JSON.parse(JSON.stringify(s.edges));
    this.destinations = JSON.parse(JSON.stringify(s.destinations));
    this.events = JSON.parse(JSON.stringify(s.events ?? []));
    this.obstacles = JSON.parse(JSON.stringify(s.obstacles ?? []));
    this.stairGroups = JSON.parse(JSON.stringify(s.stairGroups ?? []));
    this.liftGroups = JSON.parse(JSON.stringify(s.liftGroups ?? []));
    this.doors = JSON.parse(JSON.stringify(s.doors ?? []));
    if (s.pendingChanges) {
      this.pendingChanges = JSON.parse(JSON.stringify(s.pendingChanges));
    }
    this.notify();
    return { success: true, description: targetEntry.description };
  }

  public getUndoCount() {
    return this.undoStack.length;
  }

  public getRedoCount() {
    return this.redoStack.length;
  }

  public getUndoHistory() {
    return this.undoStack.map((e) => ({
      id: e.id,
      description: e.description,
      timestamp: e.timestamp,
    }));
  }

  public getRedoHistory() {
    return this.redoStack.map((e) => ({
      id: e.id,
      description: e.description,
      timestamp: e.timestamp,
    }));
  }

  public getLatestUndoDescription(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }

  public getLatestRedoDescription(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }

  public jumpToUndoStep(targetIndexFromEnd: number) {
    if (targetIndexFromEnd <= 0 || targetIndexFromEnd > this.undoStack.length) return;
    let lastDesc = "";
    const steps = this.undoStack.length - targetIndexFromEnd + 1;
    for (let i = 0; i < steps; i++) {
      const res = this.undo();
      if (res.description) lastDesc = res.description;
    }
    return lastDesc;
  }

  public discardPendingChange(changeId: string) {
    this.pendingChanges = this.pendingChanges.filter((c) => c.id !== changeId);
    this.notify();
  }

  public async publishToServer(): Promise<{ success: boolean; version?: string; count?: number; error?: string; storage?: string }> {
    if (!this.isInitialized) {
      console.warn("[CampusStore] Blocked publish attempt before server store initialization completes.");
      return { success: false, error: "Cannot publish campus data before initialization completes." };
    }

    // Commit working draft graph to published graph
    this.publishedGraph = {
      buildings: JSON.parse(JSON.stringify(this.buildings)),
      floors: JSON.parse(JSON.stringify(this.floors)),
      nodes: JSON.parse(JSON.stringify(this.nodes)),
      edges: JSON.parse(JSON.stringify(this.edges)),
      destinations: JSON.parse(JSON.stringify(this.destinations)),
      events: JSON.parse(JSON.stringify(this.events)),
      obstacles: JSON.parse(JSON.stringify(this.obstacles)),
      stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
      liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
      doors: JSON.parse(JSON.stringify(this.doors)),
    };
    const major = parseInt(this.publishedVersion.replace("v", "")) || 1;
    const minor = this.pendingChanges.length;
    this.publishedVersion = `v${major}.${minor > 0 ? minor : 1}`;

    if (typeof window !== "undefined") {
      try {
        const res = await fetch("/api/published-graph", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ snapshot: this.publishedGraph }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
          return { success: false, error: data.error || `Server return error (${res.status})` };
        }
        if (data.version) {
          this.publishedVersion = String(data.version).startsWith("v") ? String(data.version) : `v${data.version}`;
        }
        if (data.storage === "local-file") this.storageMode = "local-file";
        else if (data.success) this.storageMode = "database";
      } catch (err: unknown) {
        console.warn("Failed to sync published graph with server:", err);
        return { success: false, error: err instanceof Error ? err.message : String(err) };
      }
    }

    this.logAction("PUBLISH", `Map ${this.publishedVersion} (${this.buildings.length} Buildings)`);
    this.pendingChanges = [];
    this.persistWorkingDraft();
    this.notify();

    // Broadcast published update to all tabs/windows
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: "SYNC_PUBLISHED",
          clientId: this.clientId,
          snapshot: this.publishedGraph,
          version: this.publishedVersion,
          timestamp: Date.now(),
        });
      } catch (e) {
        // Ignore broadcast failures
      }
    }

    return { success: true, version: this.publishedVersion, count: this.buildings.length, storage: this.storageMode };
  }

  public publish() {
    this.publishToServer().catch((e) => console.error(e));
    return { version: this.publishedVersion, count: this.buildings.length };
  }

  private lastFetchTime = 0;
  private static readonly FETCH_COOLDOWN_MS = 5000; // 5-second deduplication cooldown across React components

  public async syncWithServer(force = false): Promise<boolean> {
    if (typeof window === "undefined") return false;

    // 1. If an in-flight sync request is currently active, all callers share the same Promise
    if (this.syncPromise) {
      return this.syncPromise;
    }

    // 2. Cooldown check: If data was loaded within the cooldown window and not forced, return immediately
    const now = Date.now();
    if (!force && this.isInitialized && now - this.lastFetchTime < CampusStore.FETCH_COOLDOWN_MS) {
      return true;
    }

    this.syncPromise = this.performSyncWithServer()
      .then((res) => {
        this.lastFetchTime = Date.now();
        return res;
      })
      .finally(() => {
        this.syncPromise = null;
      });

    return this.syncPromise;
  }

  private async performSyncWithServer(): Promise<boolean> {
    if (this.isSyncing) return false;
    this.isSyncing = true;
    const isAdmin = typeof window !== "undefined" && window.location.pathname.startsWith("/admin");
    try {
      // Always fetch draft and published graph in parallel so draft data is never wiped on public page reloads
      const [resDraft, resPub] = await Promise.all([
        fetch("/api/admin/campus-graph/draft", { cache: "no-store" }).catch(() => null),
        fetch("/api/published-graph", { cache: "no-store" }).catch(() => null),
      ]);

      let draftLoaded = false;
      if (resDraft && resDraft.ok) {
        const jsonDraft = await resDraft.json();
        if (jsonDraft?.storage === "local-file") this.storageMode = "local-file";
        else if (jsonDraft?.databaseConfigured !== false) this.storageMode = "database";
        const draft = jsonDraft?.draft;
        if (draft && typeof draft === "object") {
          this.buildings = Array.isArray(draft.buildings) ? draft.buildings : [];
          this.floors = Array.isArray(draft.floors) ? draft.floors : [];
          this.nodes = Array.isArray(draft.nodes) ? draft.nodes : [];
          this.edges = Array.isArray(draft.edges) ? draft.edges : [];
          this.destinations = Array.isArray(draft.destinations) ? draft.destinations : [];
          this.events = Array.isArray(draft.events) ? draft.events : [];
          this.obstacles = Array.isArray(draft.obstacles) ? draft.obstacles : [];
          this.stairGroups = Array.isArray(draft.stairGroups) ? draft.stairGroups : [];
          this.liftGroups = Array.isArray(draft.liftGroups) ? draft.liftGroups : [];
          this.doors = Array.isArray(draft.doors) ? draft.doors : [];
          this.ensureDefaultGroundFloors();
          (this.stairGroups || []).forEach((sg) => this.rebuildStairGroupConnections(sg));
          this.draftRevision = typeof jsonDraft?.revision === "string" ? jsonDraft.revision : null;
          draftLoaded = true;
        }
      }

      if (resPub && resPub.ok) {
        const jsonPub = await resPub.json();
        const graph = jsonPub?.graph;
        if (graph && typeof graph === "object") {
          if (jsonPub.version) this.publishedVersion = `v${jsonPub.version}`;
          this.publishedGraph = {
            buildings: Array.isArray(graph.buildings) ? graph.buildings : [],
            floors: Array.isArray(graph.floors) ? graph.floors : [],
            nodes: Array.isArray(graph.nodes) ? graph.nodes : [],
            edges: Array.isArray(graph.edges) ? graph.edges : [],
            destinations: Array.isArray(graph.destinations) ? graph.destinations : [],
            events: Array.isArray(graph.events) ? graph.events : [],
            obstacles: Array.isArray(graph.obstacles) ? graph.obstacles : [],
            stairGroups: Array.isArray(graph.stairGroups) ? graph.stairGroups : [],
            liftGroups: Array.isArray(graph.liftGroups) ? graph.liftGroups : [],
            doors: Array.isArray(graph.doors) ? graph.doors : [],
            boundary: Array.isArray(graph.boundary) ? graph.boundary : [],
          };

          // If draft was not loaded and local working data is empty, initialize working data from published graph
          if (!draftLoaded && this.buildings.length === 0 && this.nodes.length === 0) {
            this.buildings = JSON.parse(JSON.stringify(this.publishedGraph.buildings));
            this.floors = JSON.parse(JSON.stringify(this.publishedGraph.floors));
            this.nodes = JSON.parse(JSON.stringify(this.publishedGraph.nodes));
            this.edges = JSON.parse(JSON.stringify(this.publishedGraph.edges));
            this.destinations = JSON.parse(JSON.stringify(this.publishedGraph.destinations));
            this.events = JSON.parse(JSON.stringify(this.publishedGraph.events || []));
            this.obstacles = JSON.parse(JSON.stringify(this.publishedGraph.obstacles || []));
            this.stairGroups = JSON.parse(JSON.stringify(this.publishedGraph.stairGroups || []));
            this.liftGroups = JSON.parse(JSON.stringify(this.publishedGraph.liftGroups || []));
            this.doors = JSON.parse(JSON.stringify(this.publishedGraph.doors || []));
          }
        } else if (jsonPub && jsonPub.published === false) {
          this.publishedGraph = {
            buildings: [],
            floors: [],
            nodes: [],
            edges: [],
            destinations: [],
            events: [],
            obstacles: [],
            stairGroups: [],
            liftGroups: [],
            doors: [],
          };
        }
      }

      const hasWorkingEntities =
        this.buildings.length > 0 ||
        this.nodes.length > 0 ||
        this.floors.length > 0 ||
        this.destinations.length > 0;

      return hasWorkingEntities;
    } catch (e) {
      console.warn("Failed to sync campus graph with server database:", e);
      return false;
    } finally {
      this.isSyncing = false;
      this.isInitialized = true;
      this.notify(false, false);
    }
  }

  public async fetchPublishedData(force = false): Promise<ReturnType<CampusStore["getPublishedData"]>> {
    if (typeof window === "undefined") return this.getPublishedData();
    await this.syncWithServer(force);
    return this.getPublishedData();
  }

  public setPublishedGraphFromDatabase(snapshot: any, version?: string) {
    if (!snapshot) return;
    this.publishedGraph = {
      buildings: Array.isArray(snapshot.buildings) ? snapshot.buildings : [],
      floors: Array.isArray(snapshot.floors) ? snapshot.floors : [],
      nodes: Array.isArray(snapshot.nodes) ? snapshot.nodes : [],
      edges: Array.isArray(snapshot.edges) ? snapshot.edges : [],
      destinations: Array.isArray(snapshot.destinations) ? snapshot.destinations : [],
      events: Array.isArray(snapshot.events) ? snapshot.events : [],
      obstacles: Array.isArray(snapshot.obstacles) ? snapshot.obstacles : [],
      stairGroups: Array.isArray(snapshot.stairGroups) ? snapshot.stairGroups : [],
      liftGroups: Array.isArray(snapshot.liftGroups) ? snapshot.liftGroups : [],
      doors: Array.isArray(snapshot.doors) ? snapshot.doors : [],
    };

    if (version) {
      this.publishedVersion = String(version).startsWith("v") ? String(version) : `v${version}`;
    }

    this.listeners.forEach((l) => l());
  }

  public async resetEntireDatabase(): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      const res = await fetch("/api/admin/reset-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "RESET_CAMPUSNAV_DATABASE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        this.buildings = [];
        this.floors = [];
        this.nodes = [];
        this.edges = [];
        this.destinations = [];
        this.stairGroups = [];
        this.liftGroups = [];
        this.doors = [];
        this.events = [];
        this.obstacles = [];
        this.pendingChanges = [];
        this.publishedGraph = {
          buildings: [],
          floors: [],
          nodes: [],
          edges: [],
          destinations: [],
          events: [],
          obstacles: [],
          stairGroups: [],
          liftGroups: [],
          doors: [],
        };
        this.notify();
        return { success: true, message: "Database wiped." };
      }
      return { success: false, error: data.error || "Failed to reset database." };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public clearWorkingStore(): void {
    this.resetToInitialData(true);
  }

  // Named Checkpoints

  public createCheckpoint(name: string): Checkpoint {
    const cp: Checkpoint = {
      id: `cp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || `Checkpoint ${this.checkpoints.length + 1}`,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    };
    this.checkpoints.unshift(cp);
    this.persistWorkingDraft();
    this.notify();
    return cp;
  }

  public updateCheckpoint(checkpointId: string, customName?: string): boolean {
    const idx = this.checkpoints.findIndex((c) => c.id === checkpointId);
    if (idx === -1) return false;
    this.saveSnapshotToUndo();
    this.checkpoints[idx] = {
      ...this.checkpoints[idx],
      name: customName ? customName.trim() : this.checkpoints[idx].name,
      timestamp: Date.now(),
      snapshot: {
        buildings: JSON.parse(JSON.stringify(this.buildings)),
        floors: JSON.parse(JSON.stringify(this.floors)),
        nodes: JSON.parse(JSON.stringify(this.nodes)),
        edges: JSON.parse(JSON.stringify(this.edges)),
        destinations: JSON.parse(JSON.stringify(this.destinations)),
        events: JSON.parse(JSON.stringify(this.events)),
        obstacles: JSON.parse(JSON.stringify(this.obstacles)),
        stairGroups: JSON.parse(JSON.stringify(this.stairGroups)),
        liftGroups: JSON.parse(JSON.stringify(this.liftGroups)),
        doors: JSON.parse(JSON.stringify(this.doors)),
        pendingChanges: JSON.parse(JSON.stringify(this.pendingChanges)),
      },
    };
    this.persistWorkingDraft();
    this.notify();
    return true;
  }

  public getCheckpoints(): Checkpoint[] {
    return this.checkpoints;
  }

  public restoreCheckpoint(checkpointId: string): boolean {
    const cp = this.checkpoints.find((c) => c.id === checkpointId);
    if (!cp) return false;
    this.saveSnapshotToUndo();
    this.buildings = JSON.parse(JSON.stringify(cp.snapshot.buildings));
    this.floors = JSON.parse(JSON.stringify(cp.snapshot.floors));
    this.nodes = JSON.parse(JSON.stringify(cp.snapshot.nodes));
    this.edges = JSON.parse(JSON.stringify(cp.snapshot.edges));
    this.destinations = JSON.parse(JSON.stringify(cp.snapshot.destinations));
    this.events = JSON.parse(JSON.stringify(cp.snapshot.events ?? []));
    this.obstacles = JSON.parse(JSON.stringify(cp.snapshot.obstacles ?? []));
    this.stairGroups = JSON.parse(JSON.stringify(cp.snapshot.stairGroups ?? []));
    this.liftGroups = JSON.parse(JSON.stringify(cp.snapshot.liftGroups ?? []));
    this.doors = JSON.parse(JSON.stringify(cp.snapshot.doors ?? []));
    if (cp.snapshot.pendingChanges) {
      this.pendingChanges = JSON.parse(JSON.stringify(cp.snapshot.pendingChanges));
    }
    this.logAction("UPDATE", `Restored Checkpoint "${cp.name}"`);
    this.persistWorkingDraft();
    this.notify();
    return true;
  }



  // Door Management & Smart Graph Suggestions
  public addDoor(door: Door): Door {
    this.saveSnapshotToUndo();
    this.doors.push(door);
    this.pendingChanges.unshift({
      id: `change-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      type: "ADD_DOOR",
      entityType: "door",
      entityId: door.id,
      description: `Added ${door.type} "${door.name ?? door.id}"`,
      timestamp: Date.now(),
      newData: door,
    });
    this.generateGraphSuggestions(door.floorId);
    this.notify();
    return door;
  }

  public updateDoor(id: string, patch: Partial<Door>, recordHistory = true) {
    const idx = this.doors.findIndex((d) => d.id === id);
    if (idx === -1) return;
    if (recordHistory) {
      this.saveSnapshotToUndo();
    }
    this.doors[idx] = { ...this.doors[idx], ...patch };
    if (recordHistory) {
      this.generateGraphSuggestions(this.doors[idx].floorId);
    }
    this.notify();
  }

  public deleteDoor(id: string) {
    const idx = this.doors.findIndex((d) => d.id === id);
    if (idx === -1) return;
    this.saveSnapshotToUndo();
    const deleted = this.doors[idx];
    this.doors.splice(idx, 1);
    this.generateGraphSuggestions(deleted.floorId);
    this.persistWorkingDraft();
    this.notify();
  }

  public generateGraphSuggestions(floorId: string) {
    this.suggestedNodes = [];
    this.suggestedEdges = [];
  }

  public acceptAllSuggestions() {
    if (this.suggestedNodes.length === 0 && this.suggestedEdges.length === 0) return;
    this.saveSnapshotToUndo();

    const nodeMap = new Map<string, string>();

    this.suggestedNodes.forEach((sug) => {
      const realNodeId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      nodeMap.set(sug.id, realNodeId);
      const permNode: Node = {
        id: realNodeId,
        floorId: sug.floorId,
        type: sug.type,
        name: sug.name,
        x: sug.x,
        y: sug.y,
      };
      this.nodes.push(permNode);

      const door = this.doors.find((d) => d.id === sug.sourceEntityId);
      if (door) door.connectedNodeId = realNodeId;
    });

    this.suggestedEdges.forEach((sugEdge) => {
      const fromId = nodeMap.get(sugEdge.from) ?? sugEdge.from;
      const toId = nodeMap.get(sugEdge.to) ?? sugEdge.to;
      const realEdgeId = `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      this.edges.push({
        id: realEdgeId,
        from: fromId,
        to: toId,
        type: sugEdge.type,
        distance: sugEdge.distance,
        bidirectional: true,
      });
    });

    this.suggestedNodes = [];
    this.suggestedEdges = [];
    this.notify();
  }

  public acceptSuggestion(id: string) {
    this.saveSnapshotToUndo();
    const sugNodeIdx = this.suggestedNodes.findIndex((sn) => sn.id === id);
    if (sugNodeIdx !== -1) {
      const sug = this.suggestedNodes[sugNodeIdx];
      const realNodeId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      this.nodes.push({
        id: realNodeId,
        floorId: sug.floorId,
        type: sug.type,
        name: sug.name,
        x: sug.x,
        y: sug.y,
      });
      const door = this.doors.find((d) => d.id === sug.sourceEntityId);
      if (door) door.connectedNodeId = realNodeId;
      this.suggestedNodes.splice(sugNodeIdx, 1);
      this.notify();
      return;
    }

    const sugEdgeIdx = this.suggestedEdges.findIndex((se) => se.id === id);
    if (sugEdgeIdx !== -1) {
      const sug = this.suggestedEdges[sugEdgeIdx];
      this.edges.push({
        id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        from: sug.from,
        to: sug.to,
        type: sug.type,
        distance: sug.distance,
        bidirectional: true,
      });
      this.suggestedEdges.splice(sugEdgeIdx, 1);
      this.notify();
    }
  }

  public rejectSuggestion(id: string) {
    this.suggestedNodes = this.suggestedNodes.filter((sn) => sn.id !== id);
    this.suggestedEdges = this.suggestedEdges.filter((se) => se.id !== id);
    this.notify();
  }

  public deleteSelectedEntities(ids: string[]) {
    if (!ids || ids.length === 0) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(ids);

    this.nodes = this.nodes.filter((n) => !idSet.has(n.id));
    this.edges = this.edges.filter((e) => !idSet.has(e.id) && !idSet.has(e.from) && !idSet.has(e.to));
    this.destinations = this.destinations.filter((d) => !idSet.has(d.id));
    this.doors = this.doors.filter((d) => !idSet.has(d.id));
    this.obstacles = this.obstacles.filter((o) => !idSet.has(o.id));
    this.events = this.events.filter((ev) => !idSet.has(ev.id));
    this.buildings = this.buildings.filter((b) => !idSet.has(b.id));
    this.floors = this.floors.filter((f) => !idSet.has(f.id));
    this.stairGroups = this.stairGroups.filter((s) => !idSet.has(s.id));
    this.liftGroups = this.liftGroups.filter((l) => !idSet.has(l.id));

    this.persistWorkingDraft();
    this.notify();
  }

  // Copy & Paste Engine
  public copySelectedEntities(ids: string[]) {
    const idSet = new Set(ids);
    this.clipboardData = {
      nodes: this.nodes.filter((n) => idSet.has(n.id)),
      destinations: this.destinations.filter((d) => idSet.has(d.id)),
      doors: this.doors.filter((d) => idSet.has(d.id)),
      edges: this.edges.filter((e) => idSet.has(e.from) && idSet.has(e.to)),
    };
  }

  public pasteEntities(targetFloorId: string, offset = { x: 30, y: 30 }) {
    if (!this.clipboardData) return [];
    this.saveSnapshotToUndo();

    const nodeMap = new Map<string, string>();
    const pastedNodeIds: string[] = [];

    (this.clipboardData.nodes || []).forEach((n) => {
      const newId = `node-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      nodeMap.set(n.id, newId);
      const copy: Node = { ...n, id: newId, floorId: targetFloorId, x: n.x + offset.x, y: n.y + offset.y };
      this.nodes.push(copy);
      pastedNodeIds.push(newId);
    });

    (this.clipboardData.destinations || []).forEach((d) => {
      const newDestId = `dest-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const targetNodeId = d.nodeId ? (nodeMap.get(d.nodeId) ?? d.nodeId) : undefined;
      this.destinations.push({
        ...d,
        id: newDestId,
        nodeId: targetNodeId,
        floorId: targetFloorId,
        x: d.x ? d.x + offset.x : undefined,
        y: d.y ? d.y + offset.y : undefined,
      });
      pastedNodeIds.push(newDestId);
    });

    (this.clipboardData.doors || []).forEach((dr) => {
      const newDoorId = `door-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const connectedNodeId = dr.connectedNodeId ? nodeMap.get(dr.connectedNodeId) ?? dr.connectedNodeId : undefined;
      this.doors.push({
        ...dr,
        id: newDoorId,
        floorId: targetFloorId,
        x: dr.x + offset.x,
        y: dr.y + offset.y,
        connectedNodeId,
      });
      pastedNodeIds.push(newDoorId);
    });

    (this.clipboardData.edges || []).forEach((e) => {
      const newFrom = nodeMap.get(e.from);
      const newTo = nodeMap.get(e.to);
      if (newFrom && newTo) {
        this.edges.push({
          ...e,
          id: `edge-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          from: newFrom,
          to: newTo,
        });
      }
    });

    this.notify();
    return pastedNodeIds;
  }

  // Bulk Editing Operations
  public bulkDelete(ids: string[]) {
    if (ids.length === 0) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(ids);
    this.buildings = this.buildings.filter((b) => !idSet.has(b.id));
    this.floors = this.floors.filter((f) => !idSet.has(f.id));
    this.nodes = this.nodes.filter((n) => !idSet.has(n.id));
    this.edges = this.edges.filter((e) => !idSet.has(e.id) && !idSet.has(e.from) && !idSet.has(e.to));
    this.destinations = this.destinations.filter((d) => !idSet.has(d.id));
    this.doors = this.doors.filter((dr) => !idSet.has(dr.id));
    this.obstacles = this.obstacles.filter((o) => !idSet.has(o.id));
    this.events = this.events.filter((ev) => !idSet.has(ev.id));
    this.persistWorkingDraft();
    this.notify();
  }

  public bulkUpdateCategory(destinationIds: string[], category: string) {
    if (destinationIds.length === 0) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(destinationIds);
    this.destinations.forEach((d) => {
      if (idSet.has(d.id)) d.category = category;
    });
    this.notify();
  }

  public bulkRename(entityIds: string[], baseName: string) {
    if (entityIds.length === 0 || !baseName.trim()) return;
    this.saveSnapshotToUndo();
    const idSet = new Set(entityIds);
    let idx = 1;
    this.destinations.forEach((d) => {
      if (idSet.has(d.id)) {
        d.name = `${baseName} ${idx}`;
        idx++;
      }
    });
    this.nodes.forEach((n) => {
      if (idSet.has(n.id)) {
        n.name = `${baseName} Node ${idx}`;
        idx++;
      }
    });
    this.notify();
  }

  public clearAllData() {
    this.buildings = [];
    this.floors = [];
    this.nodes = [];
    this.edges = [];
    this.destinations = [];
    this.events = [];
    this.obstacles = [];
    this.stairGroups = [];
    this.liftGroups = [];
    this.doors = [];
    this.suggestedNodes = [];
    this.suggestedEdges = [];
    this.pendingChanges = [];
    this.undoStack = [];
    this.redoStack = [];
    this.notify();
  }

  public deleteCheckpoint(checkpointId: string) {
    this.checkpoints = this.checkpoints.filter((c) => c.id !== checkpointId);
    this.persistWorkingDraft();
    this.notify();
  }

  private memoryDraft: string | null = null;

  // Draft Management Engine
  public saveDraft(customName?: string) {
    const timestamp = Date.now();
    const existing = this.getSavedDraftMetadata();
    const draftName = customName || existing?.name || `Draft Saved (${new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`;
    const draftPayload = {
      name: draftName,
      timestamp,
      snapshot: {
        buildings: this.buildings,
        floors: this.floors,
        nodes: this.nodes,
        edges: this.edges,
        destinations: this.destinations,
        events: this.events,
        obstacles: this.obstacles,
        stairGroups: this.stairGroups,
        liftGroups: this.liftGroups,
        doors: this.doors,
        pendingChanges: this.pendingChanges,
      },
      pendingChangesCount: this.pendingChanges.length,
    };
    try {
      this.memoryDraft = JSON.stringify(draftPayload);
      this.persistWorkingDraft();
      this.logAction("UPDATE", `Saved Draft "${draftName}"`);
      this.notify();
      return { success: true, timestamp, name: draftName };
    } catch (e) {
      console.warn("Failed to save explicit draft", e);
      return { success: false, timestamp, name: draftName };
    }
  }

  public getSavedDraftMetadata(): {
    name: string;
    timestamp: number;
    entityCount: number;
    pendingCount: number;
    breakdown: {
      buildings: number;
      floors: number;
      nodes: number;
      edges: number;
      destinations: number;
      events: number;
      obstacles: number;
      doors: number;
      lifts: number;
      stairs: number;
    };
  } | null {
    try {
      const raw = this.memoryDraft;
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.snapshot) return null;
      const snapshot = parsed.snapshot;

      const breakdown = {
        buildings: snapshot.buildings?.length || 0,
        floors: snapshot.floors?.length || 0,
        nodes: snapshot.nodes?.length || 0,
        edges: snapshot.edges?.length || 0,
        destinations: snapshot.destinations?.length || 0,
        events: snapshot.events?.length || 0,
        obstacles: snapshot.obstacles?.length || 0,
        doors: snapshot.doors?.length || 0,
        lifts: snapshot.liftGroups?.length || 0,
        stairs: snapshot.stairGroups?.length || 0,
      };

      const entityCount = Object.values(breakdown).reduce((a, b) => a + b, 0);

      return {
        name: parsed.name || "Saved Draft",
        timestamp: parsed.timestamp || Date.now(),
        entityCount,
        pendingCount: parsed.pendingChangesCount || snapshot.pendingChanges?.length || 0,
        breakdown,
      };
    } catch (e) {
      return null;
    }
  }

  public hasSavedDraft(): boolean {
    const meta = this.getSavedDraftMetadata();
    if (meta) return true;
    return this.hasUnsavedEdits();
  }

  public hasUnsavedEdits(): boolean {
    if (this.pendingChanges.length > 0) return true;
    if (
      this.buildings.length !== this.publishedGraph.buildings.length ||
      this.nodes.length !== this.publishedGraph.nodes.length ||
      this.edges.length !== this.publishedGraph.edges.length ||
      this.destinations.length !== this.publishedGraph.destinations.length ||
      this.doors.length !== (this.publishedGraph.doors?.length || 0) ||
      this.liftGroups.length !== (this.publishedGraph.liftGroups?.length || 0)
    ) {
      return true;
    }
    return false;
  }

  public loadSavedDraft(): boolean {
    try {
      const raw = this.memoryDraft;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.snapshot) {
          const s = parsed.snapshot;
          this.saveSnapshotToUndo();
          if (Array.isArray(s.buildings)) this.buildings = s.buildings;
          if (Array.isArray(s.floors)) this.floors = s.floors;
          if (Array.isArray(s.nodes)) this.nodes = s.nodes;
          if (Array.isArray(s.edges)) this.edges = s.edges;
          if (Array.isArray(s.destinations)) this.destinations = s.destinations;
          if (Array.isArray(s.events)) this.events = s.events;
          if (Array.isArray(s.obstacles)) this.obstacles = s.obstacles;
          if (Array.isArray(s.stairGroups)) this.stairGroups = s.stairGroups;
          if (Array.isArray(s.liftGroups)) this.liftGroups = s.liftGroups;
          if (Array.isArray(s.doors)) this.doors = s.doors;
          if (Array.isArray(s.pendingChanges)) this.pendingChanges = s.pendingChanges;
          this.persistWorkingDraft();
          this.notify();
          return true;
        }
      }
      this.notify();
      return true;
    } catch (e) {
      console.warn("Failed to load saved draft", e);
      return false;
    }
  }

  public discardDraft() {
    this.saveSnapshotToUndo();
    this.memoryDraft = null;
    if (this.publishedGraph.buildings && this.publishedGraph.buildings.length > 0) {
      this.buildings = JSON.parse(JSON.stringify(this.publishedGraph.buildings));
      this.floors = JSON.parse(JSON.stringify(this.publishedGraph.floors));
      this.nodes = JSON.parse(JSON.stringify(this.publishedGraph.nodes));
      this.edges = JSON.parse(JSON.stringify(this.publishedGraph.edges));
      this.destinations = JSON.parse(JSON.stringify(this.publishedGraph.destinations));
      this.events = JSON.parse(JSON.stringify(this.publishedGraph.events || []));
      this.obstacles = JSON.parse(JSON.stringify(this.publishedGraph.obstacles || []));
      this.stairGroups = JSON.parse(JSON.stringify(this.publishedGraph.stairGroups || []));
      this.liftGroups = JSON.parse(JSON.stringify(this.publishedGraph.liftGroups || []));
      this.doors = JSON.parse(JSON.stringify(this.publishedGraph.doors || []));
    } else {
      this.resetToInitialData();
      return;
    }
    this.pendingChanges = [];
    this.persistWorkingDraft();
    this.logAction("UPDATE", "Discarded Draft Edits");
    this.notify();
  }

  public importFullData(snapshot: any): boolean {
    try {
      if (!snapshot) return false;
      const s = snapshot.snapshot || snapshot;
      this.saveSnapshotToUndo();
      if (Array.isArray(s.buildings)) this.buildings = s.buildings;
      if (Array.isArray(s.floors)) this.floors = s.floors;
      if (Array.isArray(s.nodes)) {
        this.nodes = s.nodes.map((n: Node) => {
          let nx = n.x;
          let ny = n.y;
          let nlat = n.lat;
          let nlng = n.lng;

          // If GPS is provided but canvas x,y is missing or both 0
          if ((nx === undefined || ny === undefined || (nx === 0 && ny === 0)) && typeof nlat === "number" && typeof nlng === "number") {
            const c = gpsToCanvas(nlat, nlng);
            nx = c.x;
            ny = c.y;
          } else if ((nlat === undefined || nlng === undefined) && typeof nx === "number" && typeof ny === "number") {
            const g = canvasToGps(nx, ny);
            nlat = Number(g.lat.toFixed(9));
            nlng = Number(g.lng.toFixed(9));
          }
          return { ...n, x: nx ?? 0, y: ny ?? 0, lat: nlat, lng: nlng };
        });
      }
      if (Array.isArray(s.edges)) this.edges = s.edges;
      if (Array.isArray(s.destinations)) {
        this.destinations = s.destinations.map((d: Destination) => {
          let dx = d.x;
          let dy = d.y;
          if ((dx === undefined || dy === undefined) && d.nodeId) {
            const linkedNode = this.nodes.find((n) => n.id === d.nodeId);
            if (linkedNode) {
              dx = linkedNode.x;
              dy = linkedNode.y;
            }
          }
          return { ...d, x: dx, y: dy };
        });
      }
      if (Array.isArray(s.events)) this.events = s.events;
      if (Array.isArray(s.obstacles)) this.obstacles = s.obstacles;
      if (Array.isArray(s.stairGroups)) this.stairGroups = s.stairGroups;
      if (Array.isArray(s.liftGroups)) this.liftGroups = s.liftGroups;
      if (Array.isArray(s.doors)) this.doors = s.doors;
      this.pendingChanges = [];
      this.logAction("UPDATE", "Imported Whole Campus Data");
      this.persistWorkingDraft();
      this.notify();
      return true;
    } catch (e) {
      console.warn("Failed to import full data snapshot:", e);
      return false;
    }
  }

  /**
   * Shortens and cleans all existing object IDs in the campus graph into short,
   * human-readable IDs (e.g. n-k4a2, e-7b9x, b-r3m1, d-w8p2) while fully preserving
   * all topological edge links, node references, and building/floor relationships.
   */
  public compactAllIds(): { success: boolean; stats: Record<string, number> } {
    this.saveSnapshotToUndo("Shortened & Cleaned All Object IDs");
    const idMap = new Map<string, string>();
    const usedIds = new Set<string>();

    const getShort = (prefix: string, oldId: string): string => {
      if (!oldId) return oldId;
      if (idMap.has(oldId)) return idMap.get(oldId)!;
      // If already a clean short ID matching prefix-[a-z0-9]{4}, preserve it
      const regex = new RegExp(`^${prefix}-[a-z0-9]{4}$`);
      if (regex.test(oldId) && !usedIds.has(oldId)) {
        usedIds.add(oldId);
        idMap.set(oldId, oldId);
        return oldId;
      }
      const newId = generateShortId(prefix, usedIds);
      usedIds.add(newId);
      idMap.set(oldId, newId);
      return newId;
    };

    // 1. Buildings (b-xxxx)
    this.buildings.forEach((b) => {
      const newId = getShort("b", b.id);
      b.id = newId;
    });

    // 2. Floors (f-xxxx, keep f-out and outdoor as is)
    this.floors.forEach((f) => {
      if (f.id === "f-out" || f.id === "outdoor") {
        idMap.set(f.id, f.id);
        usedIds.add(f.id);
      } else {
        const newId = getShort("f", f.id);
        f.id = newId;
      }
      if (f.buildingId && idMap.has(f.buildingId)) {
        f.buildingId = idMap.get(f.buildingId)!;
      }
    });

    // 3. Nodes (n-xxxx)
    this.nodes.forEach((n) => {
      const newId = getShort("n", n.id);
      n.id = newId;
      if (n.floorId && idMap.has(n.floorId)) {
        n.floorId = idMap.get(n.floorId)!;
      }
      if (n.stairGroupId) {
        if (!idMap.has(n.stairGroupId)) idMap.set(n.stairGroupId, generateShortId("stair", usedIds));
        n.stairGroupId = idMap.get(n.stairGroupId)!;
      }
      if (n.liftGroupId) {
        if (!idMap.has(n.liftGroupId)) idMap.set(n.liftGroupId, generateShortId("lift", usedIds));
        n.liftGroupId = idMap.get(n.liftGroupId)!;
      }
    });

    // 4. Edges (e-xxxx)
    this.edges.forEach((e) => {
      const newId = getShort("e", e.id);
      e.id = newId;
      if (idMap.has(e.from)) e.from = idMap.get(e.from)!;
      if (idMap.has(e.to)) e.to = idMap.get(e.to)!;
    });

    // 5. Destinations / Rooms (d-xxxx)
    this.destinations.forEach((d) => {
      const newId = getShort("d", d.id);
      d.id = newId;
      if (d.nodeId && idMap.has(d.nodeId)) d.nodeId = idMap.get(d.nodeId)!;
      if (d.floorId && idMap.has(d.floorId)) d.floorId = idMap.get(d.floorId)!;
      if (d.buildingId && idMap.has(d.buildingId)) d.buildingId = idMap.get(d.buildingId)!;
    });

    // 6. Obstacles (obs-xxxx)
    this.obstacles.forEach((obs) => {
      const newId = getShort("obs", obs.id);
      obs.id = newId;
      if (obs.nodeId && idMap.has(obs.nodeId)) obs.nodeId = idMap.get(obs.nodeId)!;
      if (obs.floorId && idMap.has(obs.floorId)) obs.floorId = idMap.get(obs.floorId)!;
      if (obs.edgeIds && Array.isArray(obs.edgeIds)) {
        obs.edgeIds = obs.edgeIds.map((eid) => idMap.get(eid) || eid);
      }
    });

    // 7. Events (ev-xxxx)
    this.events.forEach((ev) => {
      const newId = getShort("ev", ev.id);
      ev.id = newId;
      if (ev.buildingId && idMap.has(ev.buildingId)) ev.buildingId = idMap.get(ev.buildingId)!;
    });

    // 8. Doors (door-xxxx)
    this.doors.forEach((door) => {
      const newId = getShort("door", door.id);
      door.id = newId;
      if (door.floorId && idMap.has(door.floorId)) door.floorId = idMap.get(door.floorId)!;
      if (door.connectedNodeId && idMap.has(door.connectedNodeId)) door.connectedNodeId = idMap.get(door.connectedNodeId)!;
    });

    // 9. Stair & Lift Groups
    (this.stairGroups || []).forEach((sg) => {
      const newId = idMap.get(sg.id) || getShort("stair", sg.id);
      sg.id = newId;
      if (sg.buildingId && idMap.has(sg.buildingId)) sg.buildingId = idMap.get(sg.buildingId)!;
      if (sg.connectedFloorIds && Array.isArray(sg.connectedFloorIds)) {
        sg.connectedFloorIds = sg.connectedFloorIds.map((fid) => idMap.get(fid) || fid);
      }
    });

    (this.liftGroups || []).forEach((lg) => {
      const newId = idMap.get(lg.id) || getShort("lift", lg.id);
      lg.id = newId;
      if (lg.buildingId && idMap.has(lg.buildingId)) lg.buildingId = idMap.get(lg.buildingId)!;
      if (lg.servedFloorIds && Array.isArray(lg.servedFloorIds)) {
        lg.servedFloorIds = lg.servedFloorIds.map((fid) => idMap.get(fid) || fid);
      }
    });

    this.publishedGraph = {
      buildings: JSON.parse(JSON.stringify(this.buildings)),
      floors: JSON.parse(JSON.stringify(this.floors)),
      nodes: JSON.parse(JSON.stringify(this.nodes)),
      edges: JSON.parse(JSON.stringify(this.edges)),
      destinations: JSON.parse(JSON.stringify(this.destinations)),
      events: JSON.parse(JSON.stringify(this.events)),
      obstacles: JSON.parse(JSON.stringify(this.obstacles)),
      stairGroups: JSON.parse(JSON.stringify(this.stairGroups || [])),
      liftGroups: JSON.parse(JSON.stringify(this.liftGroups || [])),
      doors: JSON.parse(JSON.stringify(this.doors || [])),
    };

    this.persistWorkingDraft();
    this.notify();

    return {
      success: true,
      stats: {
        buildings: this.buildings.length,
        floors: this.floors.length,
        nodes: this.nodes.length,
        edges: this.edges.length,
        destinations: this.destinations.length,
        obstacles: this.obstacles.length,
        events: this.events.length,
        doors: this.doors.length,
      },
    };
  }

  private showAlternativeRoute: boolean = false;

  public getShowAlternativeRoute(): boolean {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("campusnav_setting_show_alt_route");
      if (stored !== null) return stored === "true";
    }
    return this.showAlternativeRoute;
  }

  public setShowAlternativeRoute(show: boolean): void {
    this.showAlternativeRoute = show;
    if (typeof window !== "undefined") {
      localStorage.setItem("campusnav_setting_show_alt_route", String(show));
    }
    this.notify();
  }

  private instantLiveSync: boolean = false;

  public getInstantLiveSync(): boolean {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("campusnav_setting_instant_live_sync");
      if (stored !== null) return stored === "true";
    }
    return this.instantLiveSync;
  }

  public setInstantLiveSync(enabled: boolean): void {
    this.instantLiveSync = enabled;
    if (typeof window !== "undefined") {
      localStorage.setItem("campusnav_setting_instant_live_sync", String(enabled));
    }
    this.notify();
    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: "SETTING_CHANGE",
          clientId: this.clientId,
          instantLiveSync: enabled,
        });
      } catch {}
    }
  }
}

// Global Singleton Store Instance to survive Next.js / Vite Fast Refresh
const globalKey = Symbol.for("campusnav_global_store");
const globalStore = (globalThis as any)[globalKey] || new CampusStore();
if (!(globalThis as any)[globalKey]) {
  (globalThis as any)[globalKey] = globalStore;
}
export const campusStore = globalStore as CampusStore;
