/**
 * GPS Location Types
 *
 * Normalized GPS data types for the CampusNav location feature.
 * Uses the browser's GeolocationPosition data and normalizes it
 * into the application's existing TypeScript conventions.
 */

/** Normalized GPS location data from the browser Geolocation API */
export interface GPSLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  heading: number | null;
  speed: number | null;
  timestamp: number;
}

/** GPS tracking lifecycle status */
export type GPSStatus =
  | "idle"          // Not yet started
  | "requesting"    // Waiting for permission / first fix
  | "active"        // Receiving live GPS updates
  | "error"         // Recoverable error (timeout, position unavailable)
  | "denied"        // User denied location permission
  | "unavailable"   // Browser/device does not support geolocation
  | "stopped";      // Tracking was explicitly stopped

/** Browser location permission state */
export type GPSPermissionState = "prompt" | "granted" | "denied" | "unknown";

/** GPS error info for UI display */
export interface GPSError {
  code: "PERMISSION_DENIED" | "POSITION_UNAVAILABLE" | "TIMEOUT" | "INVALID_LOCATION" | "STALE_LOCATION" | "UNKNOWN";
  message: string;
  userMessage: string;
}
