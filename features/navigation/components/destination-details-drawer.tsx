"use client";

import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ImageOff, Navigation, Plus, View, X } from "lucide-react";
import { findTourScene } from "@/shared/data/campus-tour";
import type { Destination, Building } from "@/shared/data/campus";

interface DestinationDetailsDrawerProps {
  destination: Destination | null;
  building?: Building | null;
  floorName?: string;
  onClose: () => void;
  onNavigate: (dest: Destination) => void;
  onAddToTrip?: (dest: Destination) => void;
  onOpen360?: (sceneIndex: number, label: string) => void;
}

export function DestinationDetailsDrawer({
  destination,
  building,
  floorName,
  onClose,
  onNavigate,
  onAddToTrip,
  onOpen360,
}: DestinationDetailsDrawerProps) {
  const [imageFailed, setImageFailed] = useState(false);
  // The official campus tour covers many of these places; offer it when it does.
  const tourScene = findTourScene(destination?.name);

  // Reset the image state whenever a different place is opened.
  useEffect(() => {
    setImageFailed(false);
  }, [destination?.id]);

  useEffect(() => {
    if (!destination) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [destination, onClose]);

  return (
    <AnimatePresence>
      {destination && (
        <motion.div
          key={destination.id}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 320 }}
          role="dialog"
          aria-modal="false"
          aria-labelledby="destination-sheet-title"
          className="pointer-events-auto fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-md overflow-hidden rounded-t-3xl border border-b-0 border-[rgb(var(--border))] bg-[rgb(var(--card))] shadow-[0_-8px_40px_-12px_rgb(0_0_0/0.35)]"
        >
          {/* Grab handle */}
          <div className="flex justify-center pt-2.5 pb-1">
            <div className="h-1 w-10 rounded-full bg-[rgb(var(--border-strong))]" />
          </div>

          <div className="px-5 pb-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2
                  id="destination-sheet-title"
                  className="truncate text-[22px] font-semibold leading-tight tracking-tight"
                >
                  {destination.name}
                </h2>
                <p className="mt-1 text-sm text-[rgb(var(--muted-fg))]">
                  {destination.category || "Campus location"}
                  {destination.roomNumber ? ` · Room ${destination.roomNumber}` : ""}
                </p>
                <p className="text-sm text-[rgb(var(--muted-fg))]">
                  {[building?.name, floorName].filter(Boolean).join(" · ") || "Outdoor campus"}
                </p>
              </div>

              <button
                onClick={onClose}
                aria-label="Close"
                className="shrink-0 rounded-full p-1.5 text-[rgb(var(--muted-fg))] transition-colors hover:bg-[rgb(var(--muted))] hover:text-[rgb(var(--fg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Reference photo — a real one when the node has it, an honest placeholder otherwise */}
            <div className="mt-4 aspect-[16/10] w-full overflow-hidden rounded-2xl border border-[rgb(var(--border))] bg-[rgb(var(--muted))]">
              {destination.photoUrl && !imageFailed ? (
                <img
                  src={destination.photoUrl}
                  alt={`Reference photo of ${destination.name}`}
                  onError={() => setImageFailed(true)}
                  className="h-full w-full object-cover"
                  loading="eager"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-[rgb(var(--muted-fg))]">
                  <ImageOff className="h-6 w-6" />
                  <span className="text-xs">No reference photo yet</span>
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => onNavigate(destination)}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--primary))] text-[15px] font-semibold text-white shadow-[var(--shadow-sm)] transition-all hover:bg-[rgb(var(--primary-2))] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--card))]"
              >
                <Navigation className="h-4.5 w-4.5" />
                Route
              </button>

              {tourScene && onOpen360 && (
                <button
                  onClick={() => onOpen360(tourScene.index, tourScene.label)}
                  title={`Look around ${tourScene.label} in 360°`}
                  className="flex h-12 shrink-0 items-center gap-2 rounded-xl border border-[rgb(var(--border-strong))] px-3.5 text-sm font-semibold text-[rgb(var(--fg-soft))] transition-colors hover:bg-[rgb(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))]"
                >
                  <View className="h-4.5 w-4.5" />
                  360°
                </button>
              )}

              {onAddToTrip && (
                <button
                  onClick={() => onAddToTrip(destination)}
                  title="Add as a stop on the current trip"
                  aria-label="Add as a stop"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[rgb(var(--border-strong))] text-[rgb(var(--fg-soft))] transition-colors hover:bg-[rgb(var(--muted))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--ring))]"
                >
                  <Plus className="h-5 w-5" />
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
