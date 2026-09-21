import { useState, useEffect, useRef, useCallback } from "react";
import { findNearestNodeByGps, calculateGeographicBearing, calculateGeographicDistance } from "@/lib/geo/haversine";
import { gpsToCanvas, MAP_ORIGIN } from "@/lib/geo/projection";
import { campusStore } from "@/shared/lib/campus-store";
import type { GPSLocation, GPSStatus, GPSPermissionState, GPSError } from "@/features/location/types";
import { GPS_OPTIONS } from "@/features/location/constants";
import {
  isValidCoordinate,
  isStalePosition,
  isAccuracyAcceptable,
  shouldUpdatePosition,
  normalizePosition,
  mapGeolocationError,
  mapErrorToStatus,
} from "@/features/location/utils";
import { useLocationStore } from "@/features/location/location-store";

// Public interface

export interface VisitorGpsState {
  // Legacy fields (preserved for campus-map.tsx compatibility)
  lat: number;
  lng: number;
  accuracy: number;
  heading: number;
  speed: number | null;
  canvasPos: { x: number; y: number; floorId: string };
  isGpsActive: boolean;
  error: string | null;

  // Enhanced GPS fields
  status: GPSStatus;
  permissionState: GPSPermissionState;
  isTracking: boolean;
  location: GPSLocation | null;
  gpsError: GPSError | null;
}

export type VisitorGpsReturn = VisitorGpsState & {
  recenter: (pos?: { x: number; y: number; floorId: string }) => void;
  startTracking: () => void;
  stopTracking: () => void;
};

// Default state

const DEFAULT_CANVAS_POS = { x: 400, y: 300, floorId: "f-out" };

function createInitialState(initialCanvasPos = DEFAULT_CANVAS_POS): VisitorGpsState {
  return {
    lat: 0,
    lng: 0,
    accuracy: 0,
    heading: 0,
    speed: null,
    canvasPos: initialCanvasPos,
    isGpsActive: false,
    error: null,
    status: "idle",
    permissionState: "unknown",
    isTracking: false,
    location: null,
    gpsError: null,
  };
}

// Hook

export function useVisitorGps(
  initialCanvasPos = DEFAULT_CANVAS_POS,
  options?: { autoStart?: boolean }
): VisitorGpsReturn {
  const [state, setState] = useState<VisitorGpsState>(() =>
    createInitialState(initialCanvasPos)
  );

  const autoStart = options?.autoStart ?? true;

  // Refs to prevent duplicate watchers and hold stable references
  const watchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastTimestampRef = useRef<number>(0);
  const lastMovementHeadingRef = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  // Permission check on mount

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("permissions" in navigator)) return;

    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((result) => {
        if (!isMountedRef.current) return;
        setState((prev) => ({
          ...prev,
          permissionState: result.state as GPSPermissionState,
        }));

        result.addEventListener("change", () => {
          if (!isMountedRef.current) return;
          setState((prev) => ({
            ...prev,
            permissionState: result.state as GPSPermissionState,
          }));
        });
      })
      .catch(() => {
        // Permissions API not supported — continue without it
      });
  }, []);

  // Start tracking

  const startTracking = useCallback(() => {
    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setState((prev) => ({
        ...prev,
        status: "unavailable",
        isTracking: false,
        isGpsActive: false,
        error: "Geolocation not supported",
        gpsError: {
          code: "POSITION_UNAVAILABLE",
          message: "Geolocation API not available",
          userMessage: "Your browser or device does not support location services.",
        },
      }));
      return;
    }

    // Prevent duplicate watchers
    if (watchIdRef.current !== null) return;

    setState((prev) => ({
      ...prev,
      status: "requesting",
      isTracking: true,
      error: null,
      gpsError: null,
    }));

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!isMountedRef.current) return;

        const normalized = normalizePosition(pos);

        // Validate coordinates
        if (!isValidCoordinate(normalized.latitude, normalized.longitude)) {
          return; // Silently skip invalid fixes
        }

        // Reject stale positions
        if (isStalePosition(normalized.timestamp)) {
          return;
        }

        // Reject very poor accuracy (> 65m)
        if (!isAccuracyAcceptable(normalized.accuracy)) {
          return;
        }

        // GPS Jump Protection: Reject impossible teleport jumps (> 30 m/s ~ 108 km/h for pedestrian navigation)
        if (lastPositionRef.current && lastTimestampRef.current > 0) {
          const dtSec = (normalized.timestamp - lastTimestampRef.current) / 1000;
          if (dtSec > 0.2 && dtSec < 30) {
            const jumpDist = calculateGeographicDistance(
              lastPositionRef.current.latitude,
              lastPositionRef.current.longitude,
              normalized.latitude,
              normalized.longitude
            );
            const impliedSpeed = jumpDist / dtSec;
            if (impliedSpeed > 30 && (normalized.accuracy ?? 10) > 25) {
              // Spurious GPS teleport jump -> ignore
              return;
            }
          }
        }

        // Jitter filter: skip tiny movements
        if (!shouldUpdatePosition(lastPositionRef.current, normalized)) {
          // Still mark as active even if jitter-filtered
          setState((prev) => {
            if (prev.status !== "active") {
              return { ...prev, status: "active", isGpsActive: true, error: null, gpsError: null };
            }
            return prev;
          });
          return;
        }

        // Calculate forward movement bearing with low-speed deadband and angular EMA smoothing
        let calculatedHeading: number | null = null;

        if (normalized.heading !== null && !isNaN(normalized.heading) && normalized.heading >= 0) {
          calculatedHeading = normalized.heading;
          lastMovementHeadingRef.current = normalized.heading;
        } else if (lastPositionRef.current) {
          const moveDist = calculateGeographicDistance(
            lastPositionRef.current.latitude,
            lastPositionRef.current.longitude,
            normalized.latitude,
            normalized.longitude
          );

          const isMoving = (normalized.speed !== null && normalized.speed >= 0.4) || moveDist >= 1.2;

          if (isMoving) {
            const rawBearing = calculateGeographicBearing(
              lastPositionRef.current.latitude,
              lastPositionRef.current.longitude,
              normalized.latitude,
              normalized.longitude
            );

            if (lastMovementHeadingRef.current !== null) {
              const delta = (((rawBearing - lastMovementHeadingRef.current + 540) % 360) - 180);
              const smoothed = ((lastMovementHeadingRef.current + delta * 0.4) % 360 + 360) % 360;
              calculatedHeading = Math.round(smoothed);
            } else {
              calculatedHeading = Math.round(rawBearing);
            }
            lastMovementHeadingRef.current = calculatedHeading;
          } else {
            // Stationary / low speed deadband: preserve previous stable heading
            calculatedHeading = lastMovementHeadingRef.current;
          }
        }

        lastPositionRef.current = {
          latitude: normalized.latitude,
          longitude: normalized.longitude,
        };
        lastTimestampRef.current = normalized.timestamp;

        // Direct GPS-to-Canvas conversion: calculate canvas position directly from real GPS latitude and longitude
        const computedCanvas = gpsToCanvas(normalized.latitude, normalized.longitude);
        const nodes = campusStore.getPublishedData().nodes || [];
        const nearestMatch = nodes.length > 0 ? findNearestNodeByGps(normalized.latitude, normalized.longitude, nodes) : { node: null, distanceMeters: Infinity };
        const nearestNode = nearestMatch.node;

        let floorId = "f-out";
        if (nearestNode && nearestMatch.distanceMeters <= 25 && nearestNode.floorId && nearestNode.floorId !== "outdoor") {
          floorId = nearestNode.floorId;
        }

        const nextCanvasPos = { x: computedCanvas.x, y: computedCanvas.y, floorId };

        // Sync to Zustand location store
        useLocationStore.getState().setLocationState({
          location: normalized,
          lat: normalized.latitude,
          lng: normalized.longitude,
          accuracy: normalized.accuracy ?? 10,
          heading: calculatedHeading ?? 0,
          speed: normalized.speed,
          timestamp: normalized.timestamp,
          canvasPos: nextCanvasPos,
          matchedNodeId: nearestNode?.id ?? null,
          matchedNodeName: nearestNode?.name ?? null,
          status: "active",
          isTracking: true,
          isGpsActive: true,
          error: null,
          gpsError: null,
        });

        setState((prev) => ({
          ...prev,
          lat: normalized.latitude,
          lng: normalized.longitude,
          accuracy: normalized.accuracy ?? 10,
          heading: calculatedHeading ?? prev.heading,
          speed: normalized.speed,
          canvasPos: nextCanvasPos,
          isGpsActive: true,
          error: null,
          status: "active",
          isTracking: true,
          location: normalized,
          gpsError: null,
        }));
      },
      (err) => {
        if (!isMountedRef.current) return;

        const gpsError = mapGeolocationError(err);
        const status = mapErrorToStatus(err);

        useLocationStore.getState().setLocationState({
          status,
          isTracking: false,
          isGpsActive: false,
          error: gpsError.userMessage,
          gpsError,
        });

        setState((prev) => ({
          ...prev,
          isGpsActive: false,
          isTracking: false,
          error: gpsError.userMessage,
          status,
          gpsError,
        }));
      },
      GPS_OPTIONS
    );

    watchIdRef.current = watchId;
  }, []);

  // Stop tracking

  const stopTracking = useCallback(() => {
    if (
      watchIdRef.current !== null &&
      typeof window !== "undefined" &&
      "geolocation" in navigator
    ) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    lastPositionRef.current = null;

    useLocationStore.getState().setLocationState({
      status: "stopped",
      isTracking: false,
      isGpsActive: false,
    });

    setState((prev) => ({
      ...prev,
      isTracking: false,
      isGpsActive: false,
      status: "stopped",
    }));
  }, []);

  // Auto-start GPS on mount

  useEffect(() => {
    if (autoStart) {
      startTracking();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  // Tab visibility: pause/resume GPS when tab is hidden/shown

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        // Pause GPS when tab is hidden to save battery
        if (
          watchIdRef.current !== null &&
          typeof window !== "undefined" &&
          "geolocation" in navigator
        ) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      } else if (document.visibilityState === "visible") {
        // Resume GPS when tab becomes visible again (only if was tracking)
        if (state.isTracking && watchIdRef.current === null) {
          startTracking();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [state.isTracking, startTracking]);

  // Cleanup on unmount

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (
        watchIdRef.current !== null &&
        typeof window !== "undefined" &&
        "geolocation" in navigator
      ) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, []);

  // Device Orientation / Compass Heading
  const lastHeadingRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      let compassHeading: number | null = null;

      // iOS WebKit Compass Heading
      if (
        "webkitCompassHeading" in e &&
        typeof (e as any).webkitCompassHeading === "number"
      ) {
        compassHeading = (e as any).webkitCompassHeading;
      } else if (e.alpha !== null) {
        // Android / Standard Compass Heading
        compassHeading = (360 - e.alpha) % 360;
      }

      if (compassHeading !== null && !isNaN(compassHeading)) {
        const rounded = Math.round(((compassHeading % 360) + 360) % 360);
        // Shortest angular difference filter to suppress micro-noise (< 1.5°)
        const diff = Math.abs(((rounded - lastHeadingRef.current + 540) % 360) - 180);
        if (diff >= 1.5) {
          lastHeadingRef.current = rounded;
          setState((prev) => ({ ...prev, heading: rounded }));
        }
      }
    };

    window.addEventListener(
      "deviceorientationabsolute" as any,
      handleOrientation,
      true
    );
    window.addEventListener("deviceorientation", handleOrientation, true);

    return () => {
      window.removeEventListener(
        "deviceorientationabsolute" as any,
        handleOrientation,
        true
      );
      window.removeEventListener("deviceorientation", handleOrientation, true);
    };
  }, []);

  // Recenter helper

  const recenter = useCallback(
    (pos?: { x: number; y: number; floorId: string }) => {
      if (pos) {
        setState((prev) => ({ ...prev, canvasPos: pos }));
      }
    },
    []
  );

  return {
    ...state,
    recenter,
    startTracking,
    stopTracking,
  };
}
