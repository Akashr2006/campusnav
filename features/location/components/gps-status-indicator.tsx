"use client";

/**
 * GPS Status Indicator
 *
 * Minimal status badge that communicates GPS tracking state.
 * Reuses the existing Badge component and design system colors.
 * Keyboard accessible with aria-label.
 */

import { Badge } from "@/shared/components/ui/badge";
import type { GPSStatus } from "@/features/location/types";

type Props = {
  status: GPSStatus;
  className?: string;
};

export function GpsStatusIndicator({ status, className }: Props) {
  if (status === "idle" || status === "stopped") return null;

  const config = STATUS_CONFIG[status];
  if (!config) return null;

  return (
    <Badge
      variant={config.variant}
      className={`text-[10px] select-none ${className ?? ""}`}
      aria-label={config.ariaLabel}
      role="status"
    >
      <span className={`mr-1 inline-flex h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      {config.label}
    </Badge>
  );
}

const STATUS_CONFIG: Record<
  Exclude<GPSStatus, "idle" | "stopped">,
  { label: string; variant: "success" | "warning" | "danger" | "default"; dotClass: string; ariaLabel: string }
> = {
  requesting: {
    label: "Locating…",
    variant: "default",
    dotClass: "bg-blue-500 animate-pulse",
    ariaLabel: "GPS is locating your position",
  },
  active: {
    label: "Location Active",
    variant: "success",
    dotClass: "bg-[rgb(var(--success))] animate-pulse",
    ariaLabel: "GPS location is active and tracking",
  },
  error: {
    label: "Location error",
    variant: "warning",
    dotClass: "bg-amber-500",
    ariaLabel: "GPS location encountered an error",
  },
  denied: {
    label: "Location denied",
    variant: "warning",
    dotClass: "bg-amber-500",
    ariaLabel: "GPS location permission was denied",
  },
  unavailable: {
    label: "Location unavailable",
    variant: "danger",
    dotClass: "bg-red-500",
    ariaLabel: "GPS location is unavailable on this device",
  },
};
