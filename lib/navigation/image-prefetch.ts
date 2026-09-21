import type { Node } from "@/shared/data/campus";
import { calculateGeographicDistance } from "@/lib/geo/haversine";
import { canvasToGps } from "@/lib/geo/projection";

const preloadedUrls = new Set<string>();
const failedUrls = new Set<string>();
const inFlightUrls = new Set<string>();

/**
 * Prefetches reference images for upcoming nodes on the user's active route
 * only when the user's geographic distance is within preloadDistanceMeters.
 *
 * Guaranteed to be:
 * - Decoupled from GPS rendering and routing loops
 * - Completely cached (zero duplicate requests on repeated GPS ticks)
 * - Error-resilient (image load failure never interrupts navigation)
 */
export function prefetchUpcomingRouteImages(
  userLat: number,
  userLng: number,
  routeNodes: Node[],
  currentStepIndex: number = 0,
  preloadDistanceMeters: number = 50
) {
  if (typeof window === "undefined" || !userLat || !userLng || isNaN(userLat) || isNaN(userLng) || !routeNodes || routeNodes.length === 0) {
    return;
  }

  // Only consider nodes that are on the active route and upcoming
  const startIndex = Math.max(0, currentStepIndex);
  const upcomingNodes = routeNodes.slice(startIndex, startIndex + 5);

  for (const node of upcomingNodes) {
    if (!node || !node.photoUrl) continue;
    const url = node.photoUrl;

    if (preloadedUrls.has(url) || inFlightUrls.has(url) || failedUrls.has(url)) {
      continue;
    }

    let nLat = node.lat;
    let nLng = node.lng;

    if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
      if (typeof node.x === "number" && typeof node.y === "number") {
        const projected = canvasToGps(node.x, node.y);
        nLat = projected.lat;
        nLng = projected.lng;
      }
    }

    if (typeof nLat === "number" && typeof nLng === "number" && !isNaN(nLat) && !isNaN(nLng)) {
      const distance = calculateGeographicDistance(userLat, userLng, nLat, nLng);

      if (distance <= preloadDistanceMeters) {
        inFlightUrls.add(url);
        const img = new Image();
        img.onload = () => {
          inFlightUrls.delete(url);
          preloadedUrls.add(url);
        };
        img.onerror = () => {
          inFlightUrls.delete(url);
          failedUrls.add(url);
        };
        img.src = url;
      }
    }
  }
}

export function isImagePreloaded(url?: string): boolean {
  if (!url) return false;
  return preloadedUrls.has(url);
}

export function isImageFailed(url?: string): boolean {
  if (!url) return false;
  return failedUrls.has(url);
}

export function clearImagePrefetchCache() {
  preloadedUrls.clear();
  failedUrls.clear();
  inFlightUrls.clear();
}
