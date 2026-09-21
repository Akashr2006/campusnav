import { create } from "zustand";
import type { GPSLocation, GPSStatus, GPSPermissionState, GPSError } from "./types";

export interface LocationState {
  location: GPSLocation | null;
  lat: number;
  lng: number;
  accuracy: number;
  heading: number;
  speed: number | null;
  timestamp: number | null;
  canvasPos: { x: number; y: number; floorId: string };
  matchedNodeId: string | null;
  matchedNodeName: string | null;
  status: GPSStatus;
  permissionState: GPSPermissionState;
  isTracking: boolean;
  isGpsActive: boolean;
  error: string | null;
  gpsError: GPSError | null;

  // Actions
  setLocationState: (patch: Partial<LocationState>) => void;
  resetLocationState: () => void;
}

const DEFAULT_CANVAS_POS = { x: 400, y: 300, floorId: "f-out" };

export const useLocationStore = create<LocationState>((set) => ({
  location: null,
  lat: 0,
  lng: 0,
  accuracy: 0,
  heading: 0,
  speed: null,
  timestamp: null,
  canvasPos: DEFAULT_CANVAS_POS,
  matchedNodeId: null,
  matchedNodeName: null,
  status: "idle",
  permissionState: "unknown",
  isTracking: false,
  isGpsActive: false,
  error: null,
  gpsError: null,

  setLocationState: (patch) => set((state) => ({ ...state, ...patch })),
  resetLocationState: () =>
    set({
      location: null,
      lat: 0,
      lng: 0,
      accuracy: 0,
      heading: 0,
      speed: null,
      timestamp: null,
      canvasPos: DEFAULT_CANVAS_POS,
      matchedNodeId: null,
      matchedNodeName: null,
      status: "idle",
      isTracking: false,
      isGpsActive: false,
      error: null,
      gpsError: null,
    }),
}));
