/**
 * GPS Location Constants
 *
 * Configurable thresholds and options for GPS tracking.
 * Tuned for campus navigation: good accuracy, responsive updates,
 * reasonable battery usage.
 */

/** Browser Geolocation API watchPosition options */
export const GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10_000,     // 10 seconds before timeout error
  maximumAge: 2_000,   // Accept cached positions up to 2 seconds old
};

/**
 * Minimum movement distance (meters) to accept a GPS update.
 * Updates below this threshold are treated as jitter and ignored.
 * Prevents visible marker shaking when the user is stationary.
 */
export const JITTER_THRESHOLD_METERS = 3;

/**
 * Maximum age (milliseconds) of a GPS fix before it is considered stale.
 * Stale positions are rejected to avoid showing outdated location.
 */
export const STALE_THRESHOLD_MS = 30_000;

/**
 * Maximum acceptable accuracy radius (meters).
 * GPS fixes with accuracy worse than this are rejected as too imprecise
 * for meaningful campus navigation.
 */
export const MIN_ACCURACY_METERS = 200;
