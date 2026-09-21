"use client";

import { motion } from "framer-motion";
import {
  Navigation2,
  CornerUpLeft,
  CornerUpRight,
  ArrowUp,
  RotateCcw,
  Layers,
  CheckCircle2,
  X,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import type { DirectionStep } from "@/lib/routing/directions";

interface Props {
  destinationName: string;
  steps: DirectionStep[];
  totalDistance: number;
  onCancel: () => void;
  onStepSelect?: (step: DirectionStep, index: number) => void;
  activeStepIndex?: number;
  onSimulateWalk?: () => void;
  isSimulating?: boolean;
}

function renderStepIcon(icon: DirectionStep["icon"]) {
  switch (icon) {
    case "left":
    case "slight-left":
    case "sharp-left":
      return <CornerUpLeft className="h-4 w-4 text-indigo-500" />;
    case "right":
    case "slight-right":
    case "sharp-right":
      return <CornerUpRight className="h-4 w-4 text-indigo-500" />;
    case "u-turn":
      return <RotateCcw className="h-4 w-4 text-orange-500" />;
    case "stairs-up":
    case "stairs-down":
      return <Layers className="h-4 w-4 text-amber-500" />;
    case "lift":
      return <Layers className="h-4 w-4 text-purple-500" />;
    case "arrive":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    default:
      return <ArrowUp className="h-4 w-4 text-blue-500" />;
  }
}

export function NavigationView({
  destinationName,
  steps,
  totalDistance,
  onCancel,
  onStepSelect,
  activeStepIndex = 0,
  onSimulateWalk,
  isSimulating = false,
}: Props) {
  const estDurationMin = Math.round(totalDistance / 75); // ~75m/min walking speed

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-[rgb(var(--card))]/95 p-4 shadow-xl backdrop-blur-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-2.5">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-[rgb(var(--primary))]/10 p-2 text-[rgb(var(--primary))]">
            <Navigation2 className="h-4 w-4 animate-pulse" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[rgb(var(--fg))]">Routing to {destinationName}</h3>
            <div className="flex items-center gap-2 text-[10px] text-[rgb(var(--muted-fg))]">
              <span>{Math.round(totalDistance)} m total</span>
              <span>·</span>
              <span>~{estDurationMin > 0 ? estDurationMin : 1} min walk</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {onSimulateWalk && (
            <Button
              size="sm"
              variant={isSimulating ? "primary" : "outline"}
              onClick={onSimulateWalk}
              className="h-8 text-[11px] px-2.5"
            >
              {isSimulating ? "Pause Walk" : "Simulate Walk"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onCancel} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Turn-by-Turn Guidance Step List */}
      <div className="max-h-56 overflow-y-auto space-y-2 scrollbar-thin">
        {steps.map((step, idx) => {
          const isActive = idx === activeStepIndex;
          return (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              onClick={() => onStepSelect?.(step, idx)}
              className={`flex items-center justify-between rounded-lg border p-2.5 text-xs transition-all cursor-pointer ${
                isActive
                  ? "border-indigo-500 bg-indigo-500/10 shadow-sm ring-1 ring-indigo-500/50"
                  : "bg-[rgb(var(--muted))]/40 hover:border-[rgb(var(--primary))]"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-md border p-1.5 shadow-sm ${isActive ? "bg-indigo-600 text-white" : "bg-[rgb(var(--card))]"}`}>
                  {renderStepIcon(step.icon)}
                </div>
                <div>
                  <div className={`font-medium ${isActive ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-[rgb(var(--fg))]"}`}>
                    {step.text}
                  </div>
                  {step.floorChange && (
                    <Badge variant="warning" className="mt-1 text-[9px]">
                      Floor Switch: {step.floorChange.from} → {step.floorChange.to}
                    </Badge>
                  )}
                </div>
              </div>
              {step.distanceMeters > 0 && (
                <span className="font-mono text-[10px] text-[rgb(var(--muted-fg))]">
                  {Math.round(step.distanceMeters)} m
                </span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
