import { getActivePublishedGraph } from "../../../lib/services/publish-service";

export interface GpsPositionInput {
  userId?: string;
  lat: number;
  lng: number;
  accuracy?: number;
  altitude?: number;
  heading?: number;
  speed?: number;
  timestamp?: number;
  floorId?: string;
}

export interface ProcessedGpsState {
  userId: string;
  lat: number;
  lng: number;
  snappedLat: number;
  snappedLng: number;
  accuracy: number;
  floorId: string;
  insideBuildingId: string | null;
  nearestNodeId: string | null;
  heading: number;
  speed: number;
  isIndoor: boolean;
  timestamp: number;
}

/**
 * Service managing real-time visitor GPS processing, snap-to-path, and building containment.
 */
export class GpsService {
  private static userStates = new Map<string, ProcessedGpsState>();

  /**
   * Processes incoming GPS coordinates, snaps to nearest walkway edge, and detects building containment.
   */
  static async processGpsPosition(input: GpsPositionInput): Promise<ProcessedGpsState> {
    const userId = input.userId || "anonymous-visitor";
    const rawLat = input.lat;
    const rawLng = input.lng;
    const accuracy = input.accuracy ?? 5;
    const heading = input.heading ?? 0;
    const speed = input.speed ?? 0;
    const timestamp = input.timestamp || Date.now();

    const activeGraph = await getActivePublishedGraph(true);
    const snapshot = activeGraph?.snapshot || { nodes: [], edges: [], buildings: [] };

    // 1. Detect building containment
    const insideBuilding = this.detectBuildingContainment(rawLat, rawLng, snapshot.buildings || []);

    // 2. Determine floorId
    let floorId = input.floorId || "f-out";
    if (insideBuilding && (!input.floorId || input.floorId === "f-out")) {
      // Find ground floor of building
      const groundFloor = (snapshot.floors || []).find(
        (f) => f.buildingId === insideBuilding.id && (f.ordinal === 0 || f.name.toLowerCase().includes("ground"))
      );
      if (groundFloor) floorId = groundFloor.id;
    }

    // 3. Snap coordinates to path / nodes
    const snapResult = this.snapToGraphPath(rawLat, rawLng, snapshot.nodes || [], snapshot.edges || [], floorId);

    const state: ProcessedGpsState = {
      userId,
      lat: rawLat,
      lng: rawLng,
      snappedLat: snapResult.lat,
      snappedLng: snapResult.lng,
      accuracy,
      floorId,
      insideBuildingId: insideBuilding?.id || null,
      nearestNodeId: snapResult.nearestNodeId,
      heading,
      speed,
      isIndoor: Boolean(insideBuilding),
      timestamp,
    };

    this.userStates.set(userId, state);
    return state;
  }

  /**
   * Retrieves current processed GPS state for a user.
   */
  static getUserState(userId: string): ProcessedGpsState | null {
    return this.userStates.get(userId) || null;
  }

  /**
   * Snaps GPS coordinate to nearest node or edge segment.
   */
  private static snapToGraphPath(
    lat: number,
    lng: number,
    nodes: any[],
    edges: any[],
    floorId: string
  ): { lat: number; lng: number; nearestNodeId: string | null } {
    if (nodes.length === 0) {
      return { lat, lng, nearestNodeId: null };
    }

    let nearestNode: any = null;
    let minDistance = Infinity;

    const floorNodes = floorId !== "f-out" ? nodes.filter((n) => n.floorId === floorId) : nodes;
    const targetNodes = floorNodes.length > 0 ? floorNodes : nodes;

    for (const n of targetNodes) {
      if (!n.lat || !n.lng) continue;
      const d = this.haversineDistance(lat, lng, n.lat, n.lng);
      if (d < minDistance) {
        minDistance = d;
        nearestNode = n;
      }
    }

    // If within 15 meters of a node, snap directly to that node
    if (nearestNode && minDistance <= 15) {
      return {
        lat: nearestNode.lat,
        lng: nearestNode.lng,
        nearestNodeId: nearestNode.id,
      };
    }

    return {
      lat: nearestNode?.lat ?? lat,
      lng: nearestNode?.lng ?? lng,
      nearestNodeId: nearestNode?.id ?? null,
    };
  }

  /**
   * Checks if GPS coordinates fall inside building footprint boundary.
   */
  private static detectBuildingContainment(lat: number, lng: number, buildings: any[]) {
    for (const b of buildings) {
      if (b.lat && b.lng) {
        const d = this.haversineDistance(lat, lng, b.lat, b.lng);
        // Approx ~50m bounding radius per building
        if (d <= 50) return b;
      }
    }
    return null;
  }

  /**
   * Haversine distance helper in meters.
   */
  private static haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
