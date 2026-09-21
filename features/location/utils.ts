/**
 * GPS Location Utilities
 *
 * Pure functions for GPS data validation, filtering, and error mapping.
 * No side effects — safe to use in tests without mocking.
 */

import { calculateGeographicDistance } from "../../lib/geo/haversine";
import type { GPSLocation, GPSError, GPSStatus } from "./types";
import {
  JITTER_THRESHOLD_METERS,
  STALE_THRESHOLD_MS,
  MIN_ACCURACY_METERS,
} from "./constants";

// Coordinate Validation

/**
 * Validates that latitude and longitude are within valid GPS bounds.
 * Latitude: -90 ≤ lat ≤ 90
 * Longitude: -180 ≤ lng ≤ 180
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  if (typeof lat !== "number" || typeof lng !== "number") return false;
  if (isNaN(lat) || isNaN(lng)) return false;
  if (!isFinite(lat) || !isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

// Staleness Detection

/**
 * Returns true if the GPS fix timestamp is older than the threshold.
 */
export function isStalePosition(
  timestamp: number,
  thresholdMs: number = STALE_THRESHOLD_MS
): boolean {
  return Date.now() - timestamp > thresholdMs;
}

// Accuracy Check

/**
 * Returns true if the accuracy is within acceptable bounds for navigation.
 */
export function isAccuracyAcceptable(
  accuracy: number | null,
  maxAccuracy: number = MIN_ACCURACY_METERS
): boolean {
  if (accuracy === null || accuracy === undefined) return true; // No accuracy info → accept
  if (isNaN(accuracy) || accuracy <= 0) return false;
  return accuracy <= maxAccuracy;
}

// Jitter Filtering

/**
 * Determines whether a new GPS position represents meaningful movement
 * vs. GPS jitter. Returns true if the position should be accepted.
 *
 * If there is no previous position, always accepts.
 * Otherwise, compares the geographic distance between prev and next
 * against the jitter threshold.
 */
export function shouldUpdatePosition(
  prev: { latitude: number; longitude: number } | null,
  next: { latitude: number; longitude: number },
  jitterThresholdMeters: number = JITTER_THRESHOLD_METERS
): boolean {
  if (!prev) return true;
  const distance = calculateGeographicDistance(
    prev.latitude,
    prev.longitude,
    next.latitude,
    next.longitude
  );
  return distance >= jitterThresholdMeters;
}

// Browser Error Mapping

/**
 * Maps a browser GeolocationPositionError to a friendly GPSError
 * with both a developer message and a user-facing message.
 */
export function mapGeolocationError(error: GeolocationPositionError): GPSError {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return {
        code: "PERMISSION_DENIED",
        message: error.message || "User denied geolocation permission",
        userMessage:
          "Location access is required to detect your current position. Please enable location permission in your browser settings.",
      };
    case error.POSITION_UNAVAILABLE:
      return {
        code: "POSITION_UNAVAILABLE",
        message: error.message || "Position unavailable",
        userMessage:
          "Your current location could not be determined. Please ensure location services are enabled on your device.",
      };
    case error.TIMEOUT:
      return {
        code: "TIMEOUT",
        message: error.message || "Geolocation request timed out",
        userMessage:
          "Location request timed out. Please check your GPS signal and try again.",
      };
    default:
      return {
        code: "UNKNOWN",
        message: error.message || "Unknown geolocation error",
        userMessage: "An unexpected location error occurred. Please try again.",
      };
  }
}

/**
 * Maps a browser GeolocationPositionError code to a GPSStatus value.
 */
export function mapErrorToStatus(error: GeolocationPositionError): GPSStatus {
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.POSITION_UNAVAILABLE) return "unavailable";
  return "error";
}

// Position Normalization

/**
 * Normalizes a browser GeolocationPosition into the application's GPSLocation type.
 */
export function normalizePosition(pos: GeolocationPosition): GPSLocation {
  return {
    latitude: pos.coords.latitude,
    longitude: pos.coords.longitude,
    accuracy: pos.coords.accuracy ?? null,
    altitude: pos.coords.altitude ?? null,
    altitudeAccuracy: pos.coords.altitudeAccuracy ?? null,
    heading: pos.coords.heading ?? null,
    speed: pos.coords.speed ?? null,
    timestamp: pos.timestamp,
  };
}
