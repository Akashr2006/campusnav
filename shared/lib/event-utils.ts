import type { Event } from "@/shared/data/campus";

/**
 * Determines whether a campus event is currently active / ongoing.
 * Returns false if the event's end time (endsAt) has passed, allowing buildings
 * to return to their default styling in both Admin and Visitor views.
 */
export function isEventActive(event: Event | null | undefined, nowMs = Date.now()): boolean {
  if (!event) return false;
  
  // If timestamps are not provided, fallback to active
  if (!event.startsAt && !event.endsAt) return true;

  const startMs = event.startsAt ? new Date(event.startsAt).getTime() : 0;
  const endMs = event.endsAt ? new Date(event.endsAt).getTime() : Infinity;

  // If date strings cannot be parsed, fallback to true
  if (isNaN(startMs) || isNaN(endMs)) return true;

  // Active ONLY if current time is within [startMs, endMs]
  return nowMs >= startMs && nowMs <= endMs;
}

/**
 * Returns detailed status of a campus event: "UPCOMING" | "ONGOING" | "COMPLETED"
 */
export function getEventStatus(
  event: Event | null | undefined,
  nowMs = Date.now()
): "UPCOMING" | "ONGOING" | "COMPLETED" {
  if (!event) return "COMPLETED";

  const startMs = event.startsAt ? new Date(event.startsAt).getTime() : 0;
  const endMs = event.endsAt ? new Date(event.endsAt).getTime() : Infinity;

  if (isNaN(startMs) || isNaN(endMs)) return "ONGOING";

  if (nowMs < startMs) return "UPCOMING";
  if (nowMs > endMs) return "COMPLETED";
  return "ONGOING";
}
