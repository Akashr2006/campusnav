"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MapPin, Navigation, Clock, Building2, Layers, X, Sparkles, Share2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import type { Destination, Building } from "@/shared/data/campus";

interface DestinationDetailsDrawerProps {
  destination: Destination | null;
  building?: Building | null;
  floorName?: string;
  onClose: () => void;
  onNavigate: (dest: Destination) => void;
  onAddToTrip?: (dest: Destination) => void;
}

export function DestinationDetailsDrawer({
  destination,
  building,
  floorName,
  onClose,
  onNavigate,
  onAddToTrip,
}: DestinationDetailsDrawerProps) {
  if (!destination) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 100 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 100 }}
        className="fixed bottom-0 left-0 right-0 z-40 mx-auto max-w-lg rounded-t-3xl border border-b-0 bg-[rgb(var(--card))]/95 p-5 shadow-2xl backdrop-blur-md text-[rgb(var(--fg))]"
      >
        {/* Handle indicator */}
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[rgb(var(--muted))]" />

        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-[rgb(var(--primary))] text-white font-semibold">
                {destination.category || "Room"}
              </Badge>
              {destination.roomNumber && (
                <span className="text-xs font-mono font-bold text-[rgb(var(--primary))]">
                  Room #{destination.roomNumber}
                </span>
              )}
            </div>
            <h2 className="mt-1 text-xl font-black text-[rgb(var(--fg))]">{destination.name}</h2>
          </div>

          <button onClick={onClose} className="rounded-full p-1 hover:bg-[rgb(var(--muted))] text-[rgb(var(--muted-fg))]">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Reference Photo Preview if available */}
        {destination.photoUrl && (
          <div className="relative w-full overflow-hidden rounded-xl border border-[rgb(var(--border))] mb-4 shadow-sm flex items-center justify-center bg-transparent">
            <img
              src={destination.photoUrl}
              alt={`Reference photo for ${destination.name}`}
              className="w-full h-auto max-h-56 object-contain rounded-xl"
            />
          </div>
        )}

        <div className="space-y-2 text-xs text-[rgb(var(--muted-fg))] mb-5">
          {building && (
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span>{building.name}</span>
            </div>
          )}

          {floorName && (
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[rgb(var(--primary))]" />
              <span>{floorName}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-emerald-500" />
            <span>Open today • 08:00 AM - 06:00 PM</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => onNavigate(destination)}
            className="flex-1 bg-[rgb(var(--primary))] text-white font-bold h-11"
          >
            <Navigation className="mr-2 h-4 w-4" /> Start Navigation
          </Button>

          {onAddToTrip && (
            <Button
              variant="outline"
              onClick={() => onAddToTrip(destination)}
              className="h-11 border-[rgb(var(--primary)/0.3)] text-[rgb(var(--primary))]"
              title="Add to multi-stop trip"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
