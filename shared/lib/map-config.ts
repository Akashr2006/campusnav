/**
 * Global Map Configuration Constants
 * 
 * To change the maximum zoom multiplier across both CAD Map and User Map in a single change:
 * Change MAX_MAP_ZOOM below (e.g. 40 means 40x zoom, 20 means 20x zoom).
 */
export const MAX_MAP_ZOOM = 400.0;
export const MIN_MAP_ZOOM = 0.5;
export const DEFAULT_MAP_ZOOM = 100.0;

/**
 * Desktop & Device-Specific Default Zoom Configurations
 */
export const DESKTOP_DEFAULT_ZOOM = 0.80;
export const MOBILE_DEFAULT_ZOOM = 1.10;

/**
 * Desktop Zoom Sensitivity Multipliers (Mouse Wheel, Trackpad Swipe & Pinch)
 * Easily adjust sensitivity constants here. Higher values yield faster, snappier zooming.
 */
export const DESKTOP_MOUSE_WHEEL_SENSITIVITY = 0.0045;   // Snappy responsive mouse wheel zoom (increased from 0.0018)
export const DESKTOP_TOUCHPAD_SWIPE_SENSITIVITY = 0.0028; // Fluid two-finger trackpad swipe zoom (increased from 0.0012)
export const DESKTOP_TOUCHPAD_PINCH_SENSITIVITY = 0.015;  // Responsive trackpad pinch-to-zoom (increased from 0.008)
export const MOBILE_PINCH_SENSITIVITY = 1.0;

/**
 * Computes normalized zoom multiplier for mouse wheel and trackpad interactions on desktop.
 */
export function computeDesktopWheelMultiplier(
  deltaY: number,
  ctrlKey: boolean,
  deltaMode: number,
  customSensitivities?: {
    pinch?: number;
    touchpad?: number;
    wheel?: number;
  }
): number {
  const pinchSens = customSensitivities?.pinch ?? DESKTOP_TOUCHPAD_PINCH_SENSITIVITY;
  const touchpadSens = customSensitivities?.touchpad ?? DESKTOP_TOUCHPAD_SWIPE_SENSITIVITY;
  const wheelSens = customSensitivities?.wheel ?? DESKTOP_MOUSE_WHEEL_SENSITIVITY;

  if (ctrlKey) {
    // Trackpad pinch gesture
    const clampedDelta = Math.min(60, Math.max(-60, deltaY));
    return Math.exp(-clampedDelta * pinchSens);
  } else if (deltaMode === 0 /* DOM_DELTA_PIXEL */) {
    // Trackpad two-finger vertical swipe
    const clampedDelta = Math.min(80, Math.max(-80, deltaY));
    return Math.exp(-clampedDelta * touchpadSens);
  } else {
    // Physical discrete mouse wheel (DOM_DELTA_LINE or DOM_DELTA_PAGE)
    let delta = deltaY;
    if (deltaMode === 1 /* DOM_DELTA_LINE */) {
      delta *= 20;
    } else if (deltaMode === 2 /* DOM_DELTA_PAGE */) {
      delta *= 200;
    }
    const normalizedDelta = Math.min(120, Math.max(-120, delta));
    return Math.exp(-normalizedDelta * wheelSens);
  }
}

/**
 * Removes level number and level name from staircase and elevator names.
 * e.g. "Main Staircase A (Floor 3)" -> "Main Staircase A"
 *      "Main Staircase A (Ground Floor)" -> "Main Staircase A"
 *      "Elevator 1 (Level 2)" -> "Elevator 1"
 *      "Stairs - Floor 1" -> "Stairs"
 */
export function cleanStairLiftDisplayName(name: string): string {
  if (!name) return "";
  return name
    .replace(/\s*\((floor|level|ground|gnd|basement|l\d+|\d+)[^)]*\)/gi, "")
    .replace(/\s*[-–—:]\s*(floor|level|ground|gnd|basement|l\d+|\d+).*$/gi, "")
    .replace(/\s+(floor|level)\s*\d+$/gi, "")
    .trim();
}
