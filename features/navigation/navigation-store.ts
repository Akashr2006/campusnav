import { create } from "zustand";
import type { Destination, Node as CampusNode, Edge } from "../../shared/data/campus";
import type { Route, RouteInstruction } from "./services/graph";
import { calculateGeographicDistance } from "../../lib/geo/haversine";
import { checkRouteDeviation } from "../../lib/routing/deviation";
import {
  projectUserOntoRoute,
  computeLiveTurnGuidance,
  type LiveUserPosition,
  type RouteProjectionResult,
} from "../../lib/navigation/live-guidance";
import { gpsToCanvas } from "../../lib/geo/projection";

export type NavigationStatus =
  | "IDLE"
  | "ROUTE_READY"
  | "NAVIGATING"
  | "OFF_ROUTE"
  | "REROUTING"
  | "ARRIVED"
  | "GPS_SIGNAL_LOST"
  | "ROUTE_ERROR"
  | "DESTINATION_UNREACHABLE"
  | "NAVIGATION_CANCELLED";

export type NavigationMode =
  | "OUTDOOR"
  | "APPROACHING_ENTRANCE"
  | "INDOOR"
  | "FLOOR_TRANSITION"
  | "POSITION_UNKNOWN"
  | "ARRIVED"
  | "ERROR";

export type IndoorPositionSource =
  | "OUTDOOR_GPS"
  | "BUILDING_ENTRANCE"
  | "MANUAL_FLOOR_SELECTION"
  | "INDOOR_GRAPH_CONTEXT"
  | "UNKNOWN";

export type PositionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface NavigationSessionState {
  status: NavigationStatus;
  navigationMode: NavigationMode;
  origin: Destination | null;
  destination: Destination | null;
  activeRoute: Route | null;
  currentSegmentIndex: number;
  matchedNodeId: string | null;
  distanceRemaining: number;
  etaSeconds: number;
  currentInstruction: RouteInstruction | null;
  nextInstruction: RouteInstruction | null;
  
  // Phase 3 Indoor Navigation State
  currentBuildingId: string | null;
  currentFloorId: string;
  indoorPositionSource: IndoorPositionSource;
  positionConfidence: PositionConfidence;

  // Reroute & Off-route protection
  consecutiveOffRouteCount: number;
  lastRerouteTimestamp: number;
  offRouteThresholdMeters: number;
  rerouteCooldownMs: number;
  arrivalThresholdMeters: number;
  activeRequestId: number;
  errorMessage: string | null;

  isManualStepping: boolean;

  // Actions
  startNavigationSession: (
    origin: Destination,
    destination: Destination,
    route: Route,
    liveUserPosOptions?: {
      isGpsActive?: boolean;
      x?: number;
      y?: number;
      lat?: number;
      lng?: number;
      floorId?: string;
      canvasPos?: { x: number; y: number; floorId?: string };
    }
  ) => void;
  updateGpsProgress: (
    gpsLat: number,
    gpsLng: number,
    matchedNode: CampusNode | null,
    publishedNodes: CampusNode[],
    recalculateRouteFn: (fromNodeId: string, toNodeId: string) => Route | null,
    options?: {
      canvasPos?: { x: number; y: number; floorId?: string };
      heading?: number;
      speed?: number | null;
      movementHeading?: number | null;
      deviceHeading?: number | null;
    }
  ) => void;
  setCurrentFloor: (floorId: string) => void;
  setIndoorContext: (
    buildingId: string | null,
    floorId: string,
    source: IndoorPositionSource,
    confidence: PositionConfidence
  ) => void;
  cancelNavigationSession: () => void;
  advanceToNextStep: () => void;
  advanceToPrevStep: () => void;
  jumpToStep: (stepIndex: number) => void;
  resetManualStepping: () => void;
  setGpsSignalLost: () => void;
  setNavigationStatus: (status: NavigationStatus, errorMessage?: string) => void;
}

const OFF_ROUTE_THRESHOLD_METERS = 25.0; // Outdoor off-route threshold in meters
const OFF_ROUTE_CONSECUTIVE_LIMIT = 3;   // Requires 3 consecutive updates to confirm off-route (hysteresis)
const REROUTE_COOLDOWN_MS = 5000;        // 5-second cooldown to prevent infinite rerouting loops
const ARRIVAL_THRESHOLD_METERS = 12.0;   // 12 meters arrival proximity threshold
const AVERAGE_WALKING_SPEED_MPS = 1.25;  // ~1.25 meters/second walking speed

export const useNavigationStore = create<NavigationSessionState>((set, get) => ({
  status: "IDLE",
  navigationMode: "OUTDOOR",
  origin: null,
  destination: null,
  activeRoute: null,
  currentSegmentIndex: 0,
  matchedNodeId: null,
  distanceRemaining: 0,
  etaSeconds: 0,
  currentInstruction: null,
  nextInstruction: null,

  currentBuildingId: null,
  currentFloorId: "f-out",
  indoorPositionSource: "UNKNOWN",
  positionConfidence: "UNKNOWN",

  consecutiveOffRouteCount: 0,
  lastRerouteTimestamp: 0,
  offRouteThresholdMeters: OFF_ROUTE_THRESHOLD_METERS,
  rerouteCooldownMs: REROUTE_COOLDOWN_MS,
  arrivalThresholdMeters: ARRIVAL_THRESHOLD_METERS,
  activeRequestId: 0,
  errorMessage: null,
  isManualStepping: false,

  resetManualStepping: () => set({ isManualStepping: false }),

  setNavigationStatus: (status, errorMessage) =>
    set({ status, ...(errorMessage !== undefined ? { errorMessage } : {}) }),

  setCurrentFloor: (floorId) => set({ currentFloorId: floorId }),

  setIndoorContext: (buildingId, floorId, source, confidence) =>
    set({
      currentBuildingId: buildingId,
      currentFloorId: floorId,
      indoorPositionSource: source,
      positionConfidence: confidence,
      navigationMode: floorId === "f-out" ? "OUTDOOR" : "INDOOR",
    }),

  startNavigationSession: (origin, destination, route, liveUserPosOptions) => {
    const firstNode = route.nodes[0];
    const hasLiveGps = Boolean(
      liveUserPosOptions?.isGpsActive !== false &&
      (
        (typeof liveUserPosOptions?.lat === "number" && typeof liveUserPosOptions?.lng === "number" && (liveUserPosOptions.lat !== 0 || liveUserPosOptions.lng !== 0)) ||
        (liveUserPosOptions?.isGpsActive === true && (liveUserPosOptions?.x !== undefined || liveUserPosOptions?.canvasPos?.x !== undefined))
      )
    );

    let initialIndex = 0;
    let distanceRemaining = route.distance;
    let initialFloorId = firstNode?.floorId ?? origin.floorId ?? "f-out";
    let currentInstruction: RouteInstruction | null = null;
    let nextInstruction: RouteInstruction | null = null;

    if (!hasLiveGps) {
      // 1. Without live GPS: Start navigation strictly at Step 1 (Origin)
      initialIndex = 0;
      distanceRemaining = route.distance;
      initialFloorId = firstNode?.floorId ?? origin.floorId ?? "f-out";
      currentInstruction = (route.instructions && route.instructions.length > 0)
        ? route.instructions[0]
        : { text: "Head towards " + (route.nodes[1]?.name || "destination"), distance: route.distance, icon: "straight" };
      nextInstruction = (route.instructions && route.instructions.length > 1)
        ? route.instructions[1]
        : null;
    } else {
      // 2. With live GPS: Project user onto route to support starting mid-route (e.g., at Point C along A->F)
      initialFloorId = liveUserPosOptions?.canvasPos?.floorId ?? liveUserPosOptions?.floorId ?? firstNode?.floorId ?? "f-out";

      let ux = liveUserPosOptions?.canvasPos?.x ?? liveUserPosOptions?.x;
      let uy = liveUserPosOptions?.canvasPos?.y ?? liveUserPosOptions?.y;
      const uLat = liveUserPosOptions?.lat ?? (origin as any).lat ?? firstNode?.lat;
      const uLng = liveUserPosOptions?.lng ?? (origin as any).lng ?? firstNode?.lng;

      if ((ux === undefined || uy === undefined || isNaN(ux) || isNaN(uy)) && uLat && uLng) {
        const canvas = gpsToCanvas(uLat, uLng);
        ux = canvas.x;
        uy = canvas.y;
      } else if (ux === undefined || uy === undefined || isNaN(ux) || isNaN(uy)) {
        ux = origin.x ?? firstNode?.x ?? 0;
        uy = origin.y ?? firstNode?.y ?? 0;
      }

      const initialPos: LiveUserPosition = {
        x: ux,
        y: uy,
        lat: uLat,
        lng: uLng,
        floorId: initialFloorId,
      };

      const initialProjection = projectUserOntoRoute(
        initialPos,
        route.nodes,
        route.edges,
        0,
        {
          outdoorThresholdMeters: OFF_ROUTE_THRESHOLD_METERS,
          indoorThresholdMeters: 10.0,
          arrivalThresholdMeters: ARRIVAL_THRESHOLD_METERS,
          isInitialSessionStart: true,
        }
      );

      const initialGuidance = computeLiveTurnGuidance(
        initialPos,
        route,
        initialProjection,
        { arrivalThresholdMeters: ARRIVAL_THRESHOLD_METERS }
      );

      initialIndex = initialGuidance.currentSegmentIndex;
      distanceRemaining = initialGuidance.distanceRemaining;
      currentInstruction = (route.instructions && route.instructions.length > initialIndex)
        ? route.instructions[initialIndex]
        : initialGuidance.currentInstruction;
      nextInstruction = (route.instructions && route.instructions.length > initialIndex + 1)
        ? route.instructions[initialIndex + 1]
        : initialGuidance.nextInstruction;
    }

    const initialMode: NavigationMode = initialFloorId === "f-out" ? "OUTDOOR" : "INDOOR";

    set((state) => ({
      status: "NAVIGATING",
      navigationMode: initialMode,
      origin,
      destination,
      activeRoute: route,
      currentSegmentIndex: initialIndex,
      matchedNodeId: route.nodes[initialIndex]?.id || origin.nodeId || firstNode?.id || null,
      currentFloorId: initialFloorId,
      currentBuildingId: (route.nodes[initialIndex] as any)?.buildingId ?? (firstNode as any)?.buildingId ?? null,
      indoorPositionSource: initialFloorId === "f-out" ? "OUTDOOR_GPS" : "BUILDING_ENTRANCE",
      positionConfidence: "HIGH",
      distanceRemaining,
      etaSeconds: Math.max(1, Math.round(distanceRemaining / AVERAGE_WALKING_SPEED_MPS)),
      currentInstruction,
      nextInstruction,
      consecutiveOffRouteCount: 0,
      lastRerouteTimestamp: Date.now(),
      activeRequestId: state.activeRequestId + 1,
      errorMessage: null,
      isManualStepping: false,
    }));
  },

  updateGpsProgress: (gpsLat, gpsLng, matchedNode, publishedNodes, recalculateRouteFn, options) => {
    const state = get();
    const { status, activeRoute, destination, lastRerouteTimestamp, consecutiveOffRouteCount, activeRequestId } = state;

    // Do not process progress if idle, completed, cancelled, or rerouting
    if (status !== "NAVIGATING" && status !== "OFF_ROUTE" && status !== "GPS_SIGNAL_LOST") {
      return;
    }

    if (!activeRoute || activeRoute.nodes.length === 0 || !destination) {
      return;
    }

    // Resume navigation if recovering from GPS signal loss
    if (status === "GPS_SIGNAL_LOST") {
      set({ status: "NAVIGATING" });
    }

    // Determine live physical user coordinates
    let ux = options?.canvasPos?.x;
    let uy = options?.canvasPos?.y;
    const floorId = options?.canvasPos?.floorId ?? matchedNode?.floorId ?? state.currentFloorId;

    if ((ux === undefined || uy === undefined || isNaN(ux) || isNaN(uy)) && gpsLat && gpsLng) {
      const canvas = gpsToCanvas(gpsLat, gpsLng);
      ux = canvas.x;
      uy = canvas.y;
    } else if (ux === undefined || uy === undefined || isNaN(ux) || isNaN(uy)) {
      ux = matchedNode?.x ?? activeRoute.nodes[0].x;
      uy = matchedNode?.y ?? activeRoute.nodes[0].y;
    }

    const liveUserPos: LiveUserPosition = {
      x: ux,
      y: uy,
      lat: gpsLat,
      lng: gpsLng,
      floorId,
      heading: options?.heading,
      movementHeading: options?.movementHeading ?? options?.heading,
      deviceHeading: options?.deviceHeading,
      speed: options?.speed,
    };

    // 1. LIVE ROUTE PROJECTION & SEGMENT MATCHING
    const projection = projectUserOntoRoute(
      liveUserPos,
      activeRoute.nodes,
      activeRoute.edges,
      state.currentSegmentIndex,
      {
        outdoorThresholdMeters: state.offRouteThresholdMeters,
        indoorThresholdMeters: 10.0,
        arrivalThresholdMeters: state.arrivalThresholdMeters,
      }
    );

    // 2. LIVE TURN GUIDANCE & ARRIVAL DETECTION
    const guidance = computeLiveTurnGuidance(liveUserPos, activeRoute, projection, {
      arrivalThresholdMeters: state.arrivalThresholdMeters,
      matchedNodeId: matchedNode?.id ?? null,
    });

    if (guidance.isArrived) {
      set({
        status: "ARRIVED",
        navigationMode: "ARRIVED",
        distanceRemaining: 0,
        etaSeconds: 0,
        consecutiveOffRouteCount: 0,
        currentInstruction: guidance.currentInstruction ?? { text: `Arrived at ${destination.name}`, distance: 0, transition: "arrive", icon: "arrive" },
        nextInstruction: null,
      });
      return;
    }

    // 3. OFF-ROUTE DETECTION & REROUTING WITH HYSTERESIS & LOOP PROTECTION
    if (guidance.isOffRoute && floorId === "f-out") {
      const newOffRouteCount = consecutiveOffRouteCount + 1;
      const now = Date.now();
      const canReroute = now - lastRerouteTimestamp > REROUTE_COOLDOWN_MS;

      if (newOffRouteCount >= OFF_ROUTE_CONSECUTIVE_LIMIT && canReroute && matchedNode) {
        // Transition to REROUTING
        set({
          status: "REROUTING",
          consecutiveOffRouteCount: newOffRouteCount,
          lastRerouteTimestamp: now,
        });

        const currentReqId = activeRequestId;
        const targetNodeId = destination.nodeId || destination.id;

        // Perform rerouting starting from current matched outdoor node
        const newRoute = targetNodeId ? recalculateRouteFn(matchedNode.id, targetNodeId) : null;

        // Guard against race conditions / stale route requests
        if (get().activeRequestId !== currentReqId) return;

        if (newRoute && newRoute.nodes.length > 0) {
          const newProjection = projectUserOntoRoute(
            liveUserPos,
            newRoute.nodes,
            newRoute.edges,
            0,
            {
              outdoorThresholdMeters: state.offRouteThresholdMeters,
              indoorThresholdMeters: 10.0,
              arrivalThresholdMeters: state.arrivalThresholdMeters,
            }
          );
          const newGuidance = computeLiveTurnGuidance(liveUserPos, newRoute, newProjection, {
            arrivalThresholdMeters: state.arrivalThresholdMeters,
          });

          set({
            status: "NAVIGATING",
            activeRoute: newRoute,
            currentSegmentIndex: newGuidance.currentSegmentIndex,
            matchedNodeId: matchedNode.id,
            distanceRemaining: newGuidance.distanceRemaining,
            etaSeconds: Math.max(1, Math.round(newGuidance.distanceRemaining / AVERAGE_WALKING_SPEED_MPS)),
            currentInstruction: newGuidance.currentInstruction,
            nextInstruction: newGuidance.nextInstruction,
            consecutiveOffRouteCount: 0,
            lastRerouteTimestamp: Date.now(),
            errorMessage: null,
          });
        } else {
          set({
            status: "DESTINATION_UNREACHABLE",
            errorMessage: `No path available from current position to ${destination.name}.`,
          });
        }
      } else {
        set({
          status: newOffRouteCount >= 2 ? "OFF_ROUTE" : "NAVIGATING",
          consecutiveOffRouteCount: newOffRouteCount,
        });
      }
      return;
    }

    // 4. ON-ROUTE UPDATE: Progress along segment & Phase 3 Indoor Mode / Floor Detection
    const activeSegmentIndex = state.isManualStepping
      ? state.currentSegmentIndex
      : guidance.currentSegmentIndex;
    const currentNode = matchedNode ?? activeRoute.nodes[activeSegmentIndex] ?? activeRoute.nodes[0];

    // Determine Phase 3 Navigation Mode & Floor Context
    let nextMode: NavigationMode = "OUTDOOR";
    let nextSource: IndoorPositionSource = "OUTDOOR_GPS";
    let nextConfidence: PositionConfidence = "HIGH";

    if (currentNode.floorId === "f-out") {
      nextMode = (currentNode.type === "BUILDING_ENTRANCE" || currentNode.isEntranceNode)
        ? "APPROACHING_ENTRANCE"
        : "OUTDOOR";
      nextSource = "OUTDOOR_GPS";
      nextConfidence = "HIGH";
    } else {
      nextMode = (currentNode.type === "STAIR" || currentNode.type === "LIFT")
        ? "FLOOR_TRANSITION"
        : "INDOOR";
      nextSource = "INDOOR_GRAPH_CONTEXT";
      nextConfidence = "MEDIUM";
    }

    const instructions = activeRoute.instructions || [];
    const currentInstruction = state.isManualStepping
      ? (instructions[state.currentSegmentIndex] ?? guidance.currentInstruction)
      : guidance.currentInstruction;
    const nextInstruction = state.isManualStepping
      ? (instructions[state.currentSegmentIndex + 1] ?? guidance.nextInstruction)
      : guidance.nextInstruction;

    let distanceRemaining = guidance.distanceRemaining;
    if (state.isManualStepping) {
      let rem = 0;
      for (let i = state.currentSegmentIndex; i < instructions.length; i++) {
        rem += (instructions[i]?.distance ?? 0);
      }
      if (rem > 0) distanceRemaining = rem;
    }

    const etaSeconds = Math.max(1, Math.round(distanceRemaining / AVERAGE_WALKING_SPEED_MPS));

    set({
      status: "NAVIGATING",
      navigationMode: nextMode,
      currentFloorId: currentNode.floorId ?? state.currentFloorId,
      currentBuildingId: (currentNode as any)?.buildingId ?? state.currentBuildingId,
      indoorPositionSource: nextSource,
      positionConfidence: nextConfidence,
      currentSegmentIndex: activeSegmentIndex,
      matchedNodeId: matchedNode?.id ?? currentNode.id ?? state.matchedNodeId,
      distanceRemaining: Math.round(distanceRemaining),
      etaSeconds,
      currentInstruction,
      nextInstruction,
      consecutiveOffRouteCount: 0,
    });
  },

  setGpsSignalLost: () => {
    const state = get();
    if (state.status === "NAVIGATING" || state.status === "OFF_ROUTE") {
      set({
        status: "GPS_SIGNAL_LOST",
        navigationMode: state.currentFloorId === "f-out" ? "OUTDOOR" : "POSITION_UNKNOWN",
        positionConfidence: "LOW",
      });
    }
  },

  advanceToNextStep: () => {
    const state = get();
    const { activeRoute, currentSegmentIndex, destination } = state;
    if (!activeRoute) return;

    const instructions = activeRoute.instructions || [];
    const nextIndex = currentSegmentIndex + 1;

    if (nextIndex >= instructions.length) {
      set({
        status: "ARRIVED",
        navigationMode: "ARRIVED",
        currentSegmentIndex: Math.max(0, instructions.length - 1),
        distanceRemaining: 0,
        etaSeconds: 0,
        currentInstruction: { text: `Arrived at ${destination?.name ?? "destination"}`, distance: 0, transition: "arrive" },
        nextInstruction: null,
      });
      return;
    }

    const currentInstruction = instructions[nextIndex] ?? null;
    const nextInstruction = instructions[nextIndex + 1] ?? null;
    const matchedNode = activeRoute.nodes[nextIndex] ?? activeRoute.nodes[activeRoute.nodes.length - 1];

    let remainingDistance = 0;
    for (let i = nextIndex; i < instructions.length; i++) {
      remainingDistance += (instructions[i]?.distance ?? 0);
    }
    if (remainingDistance <= 0 && activeRoute.distance > 0) {
      remainingDistance = Math.max(0, activeRoute.distance * ((instructions.length - nextIndex) / (instructions.length || 1)));
    }

    set({
      status: "NAVIGATING",
      currentSegmentIndex: nextIndex,
      matchedNodeId: matchedNode?.id ?? state.matchedNodeId,
      currentFloorId: matchedNode?.floorId ?? state.currentFloorId,
      distanceRemaining: Math.round(remainingDistance),
      etaSeconds: Math.max(1, Math.round(remainingDistance / AVERAGE_WALKING_SPEED_MPS)),
      currentInstruction,
      nextInstruction,
      isManualStepping: true,
    });
  },
  advanceToPrevStep: () => {
    const state = get();
    const { activeRoute, currentSegmentIndex } = state;
    if (!activeRoute) return;

    const instructions = activeRoute.instructions || [];
    const prevIndex = Math.max(0, currentSegmentIndex - 1);

    const currentInstruction = instructions[prevIndex] ?? null;
    const nextInstruction = instructions[prevIndex + 1] ?? null;
    const matchedNode = activeRoute.nodes[prevIndex] ?? activeRoute.nodes[0];

    let remainingDistance = 0;
    for (let i = prevIndex; i < instructions.length; i++) {
      remainingDistance += (instructions[i]?.distance ?? 0);
    }
    if (remainingDistance <= 0 && activeRoute.distance > 0) {
      remainingDistance = Math.max(0, activeRoute.distance * ((instructions.length - prevIndex) / (instructions.length || 1)));
    }

    set({
      status: "NAVIGATING",
      currentSegmentIndex: prevIndex,
      matchedNodeId: matchedNode?.id ?? state.matchedNodeId,
      currentFloorId: matchedNode?.floorId ?? state.currentFloorId,
      distanceRemaining: Math.round(remainingDistance),
      etaSeconds: Math.max(1, Math.round(remainingDistance / AVERAGE_WALKING_SPEED_MPS)),
      currentInstruction,
      nextInstruction,
      isManualStepping: true,
    });
  },

  jumpToStep: (stepIndex: number) => {
    const state = get();
    const instructions = state.activeRoute?.instructions || [];
    if (instructions.length === 0) return;

    const clamped = Math.max(0, Math.min(instructions.length - 1, stepIndex));
    const currentInstruction = instructions[clamped] || null;
    const nextInstruction = instructions[clamped + 1] || null;

    let remainingDistance = 0;
    for (let i = clamped; i < instructions.length; i++) {
      remainingDistance += instructions[i]?.distance || 0;
    }

    set({
      currentSegmentIndex: clamped,
      distanceRemaining: Math.round(remainingDistance),
      etaSeconds: Math.max(1, Math.round(remainingDistance / AVERAGE_WALKING_SPEED_MPS)),
      currentInstruction,
      nextInstruction,
      isManualStepping: true,
    });
  },

  cancelNavigationSession: () =>
    set({
      status: "NAVIGATION_CANCELLED",
      navigationMode: "OUTDOOR",
      origin: null,
      destination: null,
      activeRoute: null,
      currentSegmentIndex: 0,
      matchedNodeId: null,
      currentFloorId: "f-out",
      currentBuildingId: null,
      indoorPositionSource: "UNKNOWN",
      positionConfidence: "UNKNOWN",
      distanceRemaining: 0,
      etaSeconds: 0,
      currentInstruction: null,
      nextInstruction: null,
      consecutiveOffRouteCount: 0,
      errorMessage: null,
    }),
}));
