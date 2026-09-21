"use client";

import React, { useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowUp,
  ArrowUpLeft,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowDownRight,
  RotateCcw,
  Footprints,
  Navigation,
  X,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Camera,
  Image as ImageIcon,
  AlertCircle,
  Clock,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import { cleanLandmarkName, type DirectionStep, type DirectionIcon } from "@/lib/routing/directions";
import type { RouteInstruction } from "@/features/navigation/services/graph";
import { cn } from "@/shared/lib/utils";

export interface TurnByTurnBarProps {
  currentStep: DirectionStep | null;
  nextStep: DirectionStep | null;
  allSteps?: (DirectionStep | RouteInstruction)[];
  totalDistanceMeters: number;
  remainingDistanceMeters: number;
  currentStepIndex: number;
  totalStepsCount: number;
  onEndNavigation: () => void;
  onRecalculate?: () => void;
  onNextStep?: () => void;
  onPrevStep?: () => void;
  onJumpToStep?: (index: number) => void;
  isOffRoute?: boolean;
}

export function TurnByTurnBar({
  currentStep,
  nextStep,
  allSteps = [],
  totalDistanceMeters,
  remainingDistanceMeters,
  currentStepIndex,
  totalStepsCount,
  onEndNavigation,
  onRecalculate,
  onNextStep,
  onPrevStep,
  onJumpToStep,
  isOffRoute,
}: TurnByTurnBarProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [activePhotoModal, setActivePhotoModal] = useState<{ url: string; title: string; nodeId?: string } | null>(null);
  const [imageError, setImageError] = useState(false);

  // Swipe gesture tracking refs for bottom bar (swipe up to expand)
  const bottomTouchStartY = useRef<number | null>(null);
  const bottomTouchEndY = useRef<number | null>(null);

  // Swipe gesture tracking refs for top drawer handle (swipe down to collapse)
  const headerTouchStartY = useRef<number | null>(null);
  const headerTouchEndY = useRef<number | null>(null);

  if (!currentStep) return null;

  const activePhotoUrl = currentStep.photoUrl || nextStep?.photoUrl;
  const photoNodeName = currentStep.photoUrl
    ? (cleanLandmarkName(currentStep.targetNodeName) || currentStep.text || "Reference Location")
    : (cleanLandmarkName(nextStep?.targetNodeName) || nextStep?.text || "Upcoming Landmark");

  // Real physical distance-based progress (0% when stationary at start, smoothly advancing only as user actually travels)
  const effectiveRemainingDistance = (currentStepIndex < totalStepsCount - 1 && remainingDistanceMeters <= 0)
    ? (allSteps || []).slice(currentStepIndex).reduce((sum, s) => sum + ((s as any).distance ?? (s as any).distanceMeters ?? 0), 0)
    : remainingDistanceMeters;

  const progressPct = totalDistanceMeters > 0
    ? Math.min(100, Math.max(0, Math.round(((totalDistanceMeters - effectiveRemainingDistance) / totalDistanceMeters) * 100)))
    : (currentStepIndex >= totalStepsCount - 1 && totalStepsCount > 0 ? 100 : 0);

  const etaMinutes = Math.max(1, Math.round(effectiveRemainingDistance / 70));

  // Compute estimated arrival time string (e.g. "4:25 PM")
  const arrivalTime = new Date(Date.now() + etaMinutes * 60 * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const renderIcon = (icon?: DirectionIcon, className = "h-6 w-6 text-white") => {
    switch (icon) {
      case "straight":
        return <ArrowUp className={className} />;
      case "slight-left":
        return <ArrowUpLeft className={className} />;
      case "left":
        return <ArrowLeft className={className} />;
      case "sharp-left":
        return <ArrowDownLeft className={className} />;
      case "slight-right":
        return <ArrowUpRight className={className} />;
      case "right":
        return <ArrowRight className={className} />;
      case "sharp-right":
        return <ArrowDownRight className={className} />;
      case "u-turn":
        return <RotateCcw className={className} />;
      case "stairs-up":
      case "stairs-down":
        return <Footprints className={className} />;
      case "lift":
        return <Navigation className={className} />;
      case "arrive":
        return <CheckCircle2 className={className} />;
      default:
        return <ArrowUp className={className} />;
    }
  };

  // Format clean distance string (e.g. "80 m", "1.2 km")
  const formatDistance = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  // Touch gesture handlers for Bottom Bar (Swipe UP to expand)
  const handleBottomTouchStart = (e: React.TouchEvent) => {
    bottomTouchStartY.current = e.targetTouches[0].clientY;
    bottomTouchEndY.current = null;
  };

  const handleBottomTouchMove = (e: React.TouchEvent) => {
    bottomTouchEndY.current = e.targetTouches[0].clientY;
  };

  const handleBottomTouchEnd = () => {
    if (bottomTouchStartY.current === null || bottomTouchEndY.current === null) return;
    const deltaY = bottomTouchEndY.current - bottomTouchStartY.current;
    if (deltaY < -35 && !isExpanded) {
      setIsExpanded(true);
    }
    bottomTouchStartY.current = null;
    bottomTouchEndY.current = null;
  };

  // Touch gesture handlers for Header Drag Pill (Swipe DOWN to collapse)
  const handleHeaderTouchStart = (e: React.TouchEvent) => {
    headerTouchStartY.current = e.targetTouches[0].clientY;
    headerTouchEndY.current = null;
  };

  const handleHeaderTouchMove = (e: React.TouchEvent) => {
    headerTouchEndY.current = e.targetTouches[0].clientY;
  };

  const handleHeaderTouchEnd = () => {
    if (headerTouchStartY.current === null || headerTouchEndY.current === null) return;
    const deltaY = headerTouchEndY.current - headerTouchStartY.current;
    if (deltaY > 35 && isExpanded) {
      setIsExpanded(false);
    }
    headerTouchStartY.current = null;
    headerTouchEndY.current = null;
  };

  return (
    <>
      {/* Top guidance banner: current step + next step */}
      <div className="fixed top-3 left-3 right-3 sm:left-4 sm:right-4 z-40 mx-auto max-w-lg pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="pointer-events-auto overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] shadow-xl text-[rgb(var(--fg))] divide-y divide-[rgb(var(--border))]"
        >
          {/* Off-Route Alert */}
          {isOffRoute && (
            <div className="flex items-center justify-between bg-amber-500/10 border-b border-amber-500/30 px-3.5 py-2 text-xs text-amber-700 dark:text-amber-300 font-medium">
              <span className="font-semibold flex items-center gap-1.5">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Off route detected! Recalculating path...</span>
              </span>
              {onRecalculate && (
                <Button
                  size="sm"
                  onClick={onRecalculate}
                  className="h-6 text-[10px] bg-amber-600 hover:bg-amber-700 text-white font-bold px-2 rounded-lg"
                >
                  Recalculate
                </Button>
              )}
            </div>
          )}

          {/* Current step */}
          <div className="p-3.5 sm:p-4 bg-[rgb(var(--card))]">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                {/* Large Direction Icon */}
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white shadow-sm border border-emerald-500">
                  {renderIcon(currentStep.icon, "h-7 w-7 text-white stroke-[2.5]")}
                </div>

                {/* Primary Instruction & Distance */}
                <div className="min-w-0 flex-1">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={currentStep.text}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                    >
                      <h2 className="font-extrabold text-base sm:text-lg leading-tight text-[rgb(var(--fg))] tracking-tight truncate">
                        {currentStep.text}
                      </h2>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-emerald-700 dark:text-emerald-400 font-bold">
                        {currentStep.distanceMeters > 0 ? (
                          <span>{formatDistance(currentStep.distanceMeters)}</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-400">Arrived</span>
                        )}
                        <span className="text-[rgb(var(--border-strong))]">•</span>
                        <span className="text-[rgb(var(--muted-fg))] font-medium">
                          Step {currentStepIndex + 1} of {totalStepsCount}
                        </span>
                      </div>
                    </motion.div>
                  </AnimatePresence>
                </div>
              </div>

              {/* Quick Reference Photo & Step Controls */}
              <div className="flex items-center gap-1.5 shrink-0">
                {activePhotoUrl && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setImageError(false);
                      setActivePhotoModal({
                        url: activePhotoUrl,
                        title: photoNodeName,
                        nodeId: currentStep.targetNodeId,
                      });
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[rgb(var(--muted))] hover:bg-[rgb(var(--muted-2))] text-[rgb(var(--fg-soft))] border border-[rgb(var(--border))] text-xs font-semibold transition-all active:scale-95 cursor-pointer shadow-xs"
                    title="View real-world reference photo"
                  >
                    <Camera className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span className="hidden sm:inline">Photo</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Next step preview */}
          {nextStep && (
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-[rgb(var(--muted))] text-xs text-[rgb(var(--fg-soft))] font-medium">
              <span className="font-extrabold text-[10px] uppercase tracking-wider text-emerald-700 dark:text-emerald-400 shrink-0">
                Next:
              </span>
              <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                <span className="shrink-0">{renderIcon(nextStep.icon, "h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400")}</span>
                <span className="truncate text-[rgb(var(--fg))] font-semibold">{nextStep.text}</span>
              </div>
              {nextStep.distanceMeters > 0 && (
                <span className="text-[11px] text-[rgb(var(--muted-fg))] font-bold shrink-0">
                  {formatDistance(nextStep.distanceMeters)}
                </span>
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* Bottom bar: ETA, distance, swipe-up cue, exit */}
      <div
        className="fixed bottom-3 left-3 right-3 sm:left-4 sm:right-4 z-40 mx-auto max-w-lg pointer-events-none"
        onTouchStart={handleBottomTouchStart}
        onTouchMove={handleBottomTouchMove}
        onTouchEnd={handleBottomTouchEnd}
      >
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 30 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="pointer-events-auto rounded-2xl sm:rounded-3xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] shadow-xl text-[rgb(var(--fg))] p-3.5 sm:p-4 space-y-3"
        >
          {/* Swipe-Up Drag Handle Pill */}
          <button
            type="button"
            onClick={() => setIsExpanded(true)}
            className="w-full flex flex-col items-center justify-center -mt-1 group cursor-pointer"
            aria-label="Swipe up for full route step list"
          >
            <div className="h-1 w-10 rounded-full bg-[rgb(var(--border-strong))] group-hover:bg-[rgb(var(--muted-fg))] transition-colors" />
            <div className="flex items-center gap-1 text-[11px] font-semibold text-[rgb(var(--muted-fg))] pt-1 group-hover:text-[rgb(var(--fg-soft))] transition-colors">
              <ChevronUp className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
              <span>Tap to show all steps</span>
            </div>
          </button>

          {/* Metrics & Action Controls */}
          <div className="flex items-center justify-between gap-3 pt-0.5">
            {/* ETA & Remaining Distance */}
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black text-[rgb(var(--fg))] tracking-tight">
                  {etaMinutes} <span className="text-sm font-semibold text-[rgb(var(--muted-fg))]">min</span>
                </span>
                <span className="text-sm text-[rgb(var(--muted-fg))] font-semibold">
                  ({formatDistance(effectiveRemainingDistance)})
                </span>
              </div>
              <div className="text-xs text-[rgb(var(--muted-fg))] flex items-center gap-1.5 mt-0.5 font-medium">
                <Clock className="h-3.5 w-3.5 text-[rgb(var(--muted-fg))]" />
                <span>Arrival ~{arrivalTime}</span>
              </div>
            </div>

            {/* Stepper buttons & End Navigation Button */}
            <div className="flex items-center gap-1.5 shrink-0">
              {onPrevStep && (
                <button
                  type="button"
                  onClick={onPrevStep}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl bg-[rgb(var(--muted))] border border-[rgb(var(--border))] transition-all shadow-xs",
                    currentStepIndex <= 0
                      ? "text-[rgb(var(--muted-fg))] opacity-60 hover:bg-[rgb(var(--muted-2))] cursor-pointer"
                      : "hover:bg-[rgb(var(--muted-2))] text-[rgb(var(--fg-soft))] hover:text-[rgb(var(--fg))] active:scale-95 cursor-pointer"
                  )}
                  title="Previous Step"
                  aria-label="Previous Step"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              {onNextStep && (
                <button
                  type="button"
                  onClick={onNextStep}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-xl bg-[rgb(var(--muted))] border border-[rgb(var(--border))] transition-all shadow-xs",
                    currentStepIndex >= totalStepsCount - 1
                      ? "text-[rgb(var(--muted-fg))] opacity-60 hover:bg-[rgb(var(--muted-2))] cursor-pointer"
                      : "hover:bg-[rgb(var(--muted-2))] text-[rgb(var(--fg-soft))] hover:text-[rgb(var(--fg))] active:scale-95 cursor-pointer"
                  )}
                  title="Next Step"
                  aria-label="Next Step"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              )}

              {/* End navigation */}
              <button
                type="button"
                onClick={onEndNavigation}
                className="flex items-center gap-1 px-4 py-2 rounded-full bg-red-500/10 hover:bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30 text-xs font-extrabold transition-all active:scale-95 cursor-pointer shadow-2xs"
                title="End Navigation Session"
              >
                <X className="h-3.5 w-3.5 text-red-600 dark:text-red-400 stroke-[2.5]" />
                <span>Exit</span>
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--muted))]">
            <div
              className="h-full bg-emerald-600 transition-all duration-300 rounded-full"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </motion.div>
      </div>

      {/* Expanded route step list */}
      <AnimatePresence>
        {isExpanded && (
          <div className="fixed inset-0 z-50 flex flex-col justify-end">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsExpanded(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-xs"
            />

            {/* Bottom Sheet Drawer */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              className="relative w-full max-w-lg mx-auto max-h-[82vh] flex flex-col rounded-t-3xl border-t border-[rgb(var(--border))] bg-[rgb(var(--card))] shadow-2xl text-[rgb(var(--fg))] overflow-hidden"
            >
              {/* Sheet Header & Swipe-Down Handle */}
              <div
                className="p-4 border-b border-[rgb(var(--border))] bg-[rgb(var(--card))] sticky top-0 z-10 select-none"
                onTouchStart={handleHeaderTouchStart}
                onTouchMove={handleHeaderTouchMove}
                onTouchEnd={handleHeaderTouchEnd}
              >
                {/* Drag Handle */}
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className="w-full flex flex-col items-center justify-center -mt-1 pb-2 group cursor-pointer"
                  aria-label="Swipe down to collapse route steps"
                >
                  <div className="h-1.5 w-12 rounded-full bg-[rgb(var(--border-strong))] group-hover:bg-[rgb(var(--muted-fg))] transition-colors" />
                  <div className="flex items-center gap-1 text-[11px] font-semibold text-[rgb(var(--muted-fg))] pt-1.5 group-hover:text-[rgb(var(--muted-fg))] transition-colors">
                    <ChevronDown className="h-3.5 w-3.5" />
                    <span>Tap or swipe down to close</span>
                  </div>
                </button>

                {/* Trip Summary Row */}
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <h3 className="text-lg font-black text-[rgb(var(--fg))]">Full Route Steps</h3>
                    <p className="text-xs text-[rgb(var(--muted-fg))] mt-0.5 font-medium">
                      ~{etaMinutes} min · {formatDistance(remainingDistanceMeters)} remaining · {allSteps.length || totalStepsCount} steps
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setIsExpanded(false)}
                    className="h-8 w-8 p-0 rounded-full text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg-soft))]"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Scrollable Timeline of All Route Steps */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
                {(allSteps.length > 0 ? allSteps : [currentStep, nextStep].filter(Boolean)).map((step, idx) => {
                  const stepText = (step as any).text || "";
                  const stepDistance = (step as any).distanceMeters ?? (step as any).distance ?? 0;
                  const stepIcon = (step as any).icon;
                  const stepFloor = (step as any).floor;
                  const stepBuilding = (step as any).building;
                  const stepPhoto = (step as any).photoUrl;
                  const targetName = (step as any).targetNodeName;
                  const landmark = cleanLandmarkName(targetName);
                  const isCurrent = idx === currentStepIndex;
                  const isPast = idx < currentStepIndex;

                  return (
                    <div
                      key={idx}
                      onClick={() => {
                        if (onJumpToStep) {
                          onJumpToStep(idx);
                          setIsExpanded(false);
                        }
                      }}
                      className={cn(
                        "relative flex items-start gap-3.5 p-3 rounded-2xl border transition-all cursor-pointer",
                        isCurrent
                          ? "bg-emerald-500/10 border-emerald-500/40 shadow-xs ring-1 ring-emerald-400/40 text-[rgb(var(--fg))]"
                          : isPast
                          ? "bg-[rgb(var(--muted)/0.7)] border-[rgb(var(--border))] text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted-2)/0.6)]"
                          : "bg-[rgb(var(--muted))] border-[rgb(var(--border))] hover:bg-[rgb(var(--muted-2)/0.8)] text-[rgb(var(--fg))]"
                      )}
                    >
                      {/* Step Direction Icon */}
                      <div
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold shadow-xs",
                          isCurrent
                            ? "bg-emerald-600 text-white shadow-emerald-500/20"
                            : isPast
                            ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-500/30 dark:border-emerald-800"
                            : "bg-[rgb(var(--muted-2))] text-[rgb(var(--muted-fg))]"
                        )}
                      >
                        {isPast ? (
                          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          renderIcon(stepIcon, cn("h-5 w-5", isCurrent ? "text-white" : "text-[rgb(var(--muted-fg))]"))
                        )}
                      </div>

                      {/* Step Details */}
                      <div className="min-w-0 flex-1 pt-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[rgb(var(--muted-fg))]">Step {idx + 1}</span>
                            {isCurrent && (
                              <Badge className="bg-emerald-600 text-white text-[9px] font-extrabold px-1.5 py-0">
                                CURRENT
                              </Badge>
                            )}
                            {isPast && (
                              <Badge variant="success" className="border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[9px] font-bold px-1.5 py-0">
                                COMPLETED
                              </Badge>
                            )}
                          </div>
                          {stepDistance > 0 && (
                            <span className={cn("text-xs font-extrabold font-mono", isCurrent ? "text-emerald-700 dark:text-emerald-400" : isPast ? "text-[rgb(var(--muted-fg))] line-through" : "text-[rgb(var(--muted-fg))]")}>
                              {formatDistance(stepDistance)}
                            </span>
                          )}
                        </div>

                        {/* Main Instruction Text */}
                        <div className={cn("text-sm font-bold mt-1", isCurrent ? "text-[rgb(var(--fg))]" : isPast ? "text-[rgb(var(--muted-fg))]" : "text-[rgb(var(--fg))]")}>
                          {stepText}
                        </div>

                        {/* Contextual physical landmark / floor info */}
                        {(landmark || stepFloor || stepBuilding) && (
                          <div className="text-[11px] text-[rgb(var(--muted-fg))] mt-0.5 flex items-center gap-1.5 flex-wrap font-medium">
                            {landmark && <span className="text-emerald-700 dark:text-emerald-400 font-semibold">Near {landmark}</span>}
                            {stepFloor && <span>· {stepFloor}</span>}
                            {stepBuilding && <span>· {stepBuilding}</span>}
                          </div>
                        )}

                        {/* Step Reference Photo preview button */}
                        {stepPhoto && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setImageError(false);
                              setActivePhotoModal({
                                url: stepPhoto,
                                title: landmark || stepText,
                                nodeId: (step as any).targetNodeId,
                              });
                            }}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-[rgb(var(--muted))] transition-all cursor-pointer shadow-2xs"
                          >
                            <Camera className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                            <span>View reference photo</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Sheet Footer */}
              <div className="p-3.5 border-t border-[rgb(var(--border))] bg-[rgb(var(--muted))] flex items-center justify-between gap-3">
                <Button
                  onClick={() => setIsExpanded(false)}
                  variant="outline"
                  className="flex-1 text-xs font-bold border-[rgb(var(--border))] bg-[rgb(var(--card))] text-[rgb(var(--fg-soft))] hover:bg-[rgb(var(--muted))]"
                >
                  Return to Map
                </Button>
                <button
                  type="button"
                  onClick={onEndNavigation}
                  className="flex-1 py-2 px-3 rounded-xl text-xs font-bold bg-red-500/10 hover:bg-red-500/15 text-red-700 dark:text-red-400 border border-red-500/30 transition-colors"
                >
                  End Navigation
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reference photo modal */}
      <AnimatePresence>
        {activePhotoModal && (
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
            onClick={(e) => e.stopPropagation()}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--card))] p-4 shadow-2xl text-[rgb(var(--fg))]"
            >
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[rgb(var(--border))]">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    <ImageIcon className="h-4 w-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[rgb(var(--fg))] truncate max-w-[260px]">
                      {activePhotoModal.title}
                    </h4>
                    <p className="text-[11px] text-[rgb(var(--muted-fg))] font-medium">Visual landmark reference</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActivePhotoModal(null)}
                  className="rounded-lg p-1.5 text-[rgb(var(--muted-fg))] hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg-soft))] transition-colors cursor-pointer"
                  title="Close reference photo"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Photo Display Body */}
              <div className="mt-3 relative w-full overflow-hidden rounded-xl bg-[rgb(var(--muted))] flex items-center justify-center border border-[rgb(var(--border))] min-h-[160px]">
                {imageError ? (
                  <div className="flex flex-col items-center justify-center p-6 text-center text-[rgb(var(--muted-fg))]">
                    <AlertCircle className="h-8 w-8 text-amber-500 mb-2" />
                    <p className="text-sm font-medium text-[rgb(var(--fg-soft))]">Reference image unavailable</p>
                    <p className="text-xs text-[rgb(var(--muted-fg))] mt-1">Continue following turn-by-turn navigation.</p>
                  </div>
                ) : (
                  <img
                    src={activePhotoModal.url}
                    alt={activePhotoModal.title}
                    onError={(e) => {
                      const targetId = activePhotoModal.nodeId;
                      const apiFallback = targetId ? `/api/nodes/${targetId}/photo` : null;
                      const imgEl = e.target as HTMLImageElement;
                      if (apiFallback && !imgEl.src.endsWith(apiFallback)) {
                        imgEl.src = apiFallback;
                      } else {
                        setImageError(true);
                      }
                    }}
                    className="w-full h-auto max-h-[65vh] object-contain rounded-xl"
                    loading="eager"
                  />
                )}
              </div>

              {/* Footer */}
              <div className="mt-3 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => setActivePhotoModal(null)}
                  className="bg-[rgb(var(--muted))] hover:bg-[rgb(var(--muted-2))] text-[rgb(var(--fg-soft))] text-xs px-4"
                >
                  Close Reference
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
