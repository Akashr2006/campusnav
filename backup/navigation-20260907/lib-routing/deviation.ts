import type { Node } from "../../shared/data/campus";
import { PIXELS_PER_METER } from "../geo/projection";

export interface DeviationOptions {
  outdoorThresholdMeters?: number; // Default: 15.0m
  indoorThresholdMeters?: number;  // Default: 5.0m
}

function perpendicularDistanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const l2 = (bx - ax) * (bx - ax) + (by - ay) * (by - ay);
  if (l2 === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = Math.max(0, Math.min(1, t));

  const projX = ax + t * (bx - ax);
  const projY = ay + t * (by - ay);

  return Math.hypot(px - projX, py - projY);
}

export function checkRouteDeviation(
  userPos: { x: number; y: number; floorId?: string },
  routeNodes: Node[],
  options: DeviationOptions = {}
): { isDeviated: boolean; distanceToRoute: number; nearestSegmentIndex: number } {
  if (routeNodes.length < 2) {
    return { isDeviated: false, distanceToRoute: 0, nearestSegmentIndex: 0 };
  }

  let minDistancePixels = Infinity;
  let nearestSegmentIndex = 0;

  for (let i = 0; i < routeNodes.length - 1; i++) {
    const n1 = routeNodes[i];
    const n2 = routeNodes[i + 1];

    if (userPos.floorId && n1.floorId !== userPos.floorId && n2.floorId !== userPos.floorId) {
      continue;
    }

    const dist = perpendicularDistanceToSegment(
      userPos.x,
      userPos.y,
      n1.x,
      n1.y,
      n2.x,
      n2.y
    );

    if (dist < minDistancePixels) {
      minDistancePixels = dist;
      nearestSegmentIndex = i;
    }
  }

  const isIndoor = userPos.floorId && userPos.floorId !== "f-out";
  const threshold = isIndoor
    ? (options.indoorThresholdMeters ?? 5.0)
    : (options.outdoorThresholdMeters ?? 15.0);

  const distanceToRouteMeters = minDistancePixels === Infinity ? 0 : minDistancePixels / PIXELS_PER_METER;
  const isDeviated = distanceToRouteMeters > threshold;

  return {
    isDeviated,
    distanceToRoute: distanceToRouteMeters,
    nearestSegmentIndex,
  };
}
