"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Radio, Timer, Ruler, CheckCircle2, AlertTriangle } from "lucide-react";
import type { Node } from "@/shared/data/campus";
import type { Route, RouteInstruction } from "@/features/navigation/services/graph";
import { Badge } from "@/shared/components/ui/badge";

type Props = {
  destinationId: string;
  fromId?: string;
  onArrive?: () => void;
  onPosition?: (pos: Position) => void;
};

type Position = {
  index: number;
  node: Node;
  remainingDistance: number;
  remainingSec: number;
  progress: number;
};

export function LiveRoutePanel({ destinationId, fromId, onArrive, onPosition }: Props) {
  const [route, setRoute] = useState<Route | null>(null);
  const [pos, setPos] = useState<Position | null>(null);
  const [arrived, setArrived] = useState(false);
  const arrivedRef = useRef(false);
  const esRef = useRef<EventSource | null>(null);

  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;

  useEffect(() => {
    if (!destinationId) return;
    setArrived(false);
    arrivedRef.current = false;

    // Clean up any previous EventSource instance
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const queryParams = new URLSearchParams();
    queryParams.set("to", destinationId);
    if (fromId) {
      queryParams.set("from", fromId);
    }

    const url = `/api/live?${queryParams.toString()}`;
    const es = new EventSource(url);
    esRef.current = es;

    es.addEventListener("route", (e) => {
      try {
        if ((e as MessageEvent).data) {
          setRoute(JSON.parse((e as MessageEvent).data));
        }
      } catch (err) {
        console.warn("[LiveRoutePanel] route parse error:", err);
      }
    });

    es.addEventListener("position", (e) => {
      try {
        if ((e as MessageEvent).data) {
          const p = JSON.parse((e as MessageEvent).data);
          setPos(p);
          onPositionRef.current?.(p);
        }
      } catch (err) {
        console.warn("[LiveRoutePanel] position parse error:", err);
      }
    });

    es.addEventListener("arrived", () => {
      if (arrivedRef.current) return;
      arrivedRef.current = true;
      setArrived(true);
      onArriveRef.current?.();
      es.close();
    });

    es.onerror = () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };

    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [destinationId, fromId]);

  const nextInstruction: RouteInstruction | undefined =
    route && pos ? route.instructions[Math.min(pos.index, route.instructions.length - 1)] : undefined;

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center gap-2 border-b bg-[rgb(var(--primary)/0.06)] px-4 py-2.5">
        <div className="relative flex h-2 w-2 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-[rgb(var(--success))] pulse-dot" />
          <span className="h-2 w-2 rounded-full bg-[rgb(var(--success))]" />
        </div>
        <Radio className="h-3.5 w-3.5 text-[rgb(var(--primary))]" />
        <span className="text-xs font-semibold uppercase tracking-wider text-[rgb(var(--primary))]">
          Live navigation
        </span>
        {pos && (
          <span className="ml-auto text-xs font-semibold tabular-nums text-[rgb(var(--muted-fg))]">
            {Math.round(pos.progress * 100)}%
          </span>
        )}
      </div>

      {/* Live progress bar */}
      <div className="h-1 w-full bg-[rgb(var(--muted))]">
        <motion.div
          className="h-full gradient-primary"
          initial={{ width: 0 }}
          animate={{ width: `${Math.round((pos?.progress ?? 0) * 100)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      <div className="p-4">
        {route?.hasObstacles && (
          <div className="mb-3 flex items-start gap-3 rounded-xl border border-[#fde047]/70 bg-[#fefce8] dark:border-[#78350f]/60 dark:bg-[#451a03]/40 p-3 shadow-xs">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#fef08a] text-[#b45309] dark:bg-[#78350f]/50 dark:text-[#fde047]">
              <AlertTriangle className="h-4 w-4" />
            </div>
            <div className="space-y-0.5 text-xs">
              <div className="font-bold text-[#451a03] dark:text-[#fef08a]">Caution: Route Contains Hazards</div>
              <div className="text-[11px] text-[#78350f] dark:text-[#fde047] leading-tight font-medium">
                All available paths pass through active obstacle zones.
              </div>
            </div>
          </div>
        )}
        {arrived ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="rounded-full bg-[rgb(var(--success)/0.15)] p-3">
              <CheckCircle2 className="h-6 w-6 text-[rgb(var(--success))]" />
            </div>
            <div>
              <div className="text-base font-semibold">You've arrived</div>
              <div className="text-xs text-[rgb(var(--muted-fg))]">
                Enjoy your visit.
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2">
              <MiniStat
                icon={Ruler}
                label="Remaining"
                value={pos ? `${Math.round(pos.remainingDistance)} m` : "—"}
              />
              <MiniStat
                icon={Timer}
                label="ETA"
                value={pos ? `${Math.max(1, Math.round(pos.remainingSec / 60))} min` : "—"}
              />
            </div>

            <AnimatePresence mode="wait">
              {nextInstruction && (
                <motion.div
                  key={nextInstruction.text}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                  className="rounded-lg border border-[rgb(var(--primary)/0.3)] bg-[rgb(var(--primary)/0.05)] p-3"
                >
                  <div className="mb-1 flex items-center gap-2">
                    <Badge variant="primary">Next step</Badge>
                    {nextInstruction.floor && (
                      <span className="text-xs text-[rgb(var(--muted-fg))]">
                        {nextInstruction.floor}
                      </span>
                    )}
                  </div>
                  <div className="text-sm font-medium">
                    {nextInstruction.text}
                  </div>
                  {nextInstruction.distance > 0 && (
                    <div className="mt-0.5 text-xs text-[rgb(var(--muted-fg))]">
                      in {Math.round(nextInstruction.distance)} m
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {route && (
              <div className="mt-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
                  Upcoming
                </div>
                <ol className="space-y-2">
                  {route.instructions.slice((pos?.index ?? 0) + 1, (pos?.index ?? 0) + 4).map((ins, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[rgb(var(--muted-fg))]" />
                      <span className="flex-1">
                        {ins.text}
                        {ins.distance > 0 && (
                          <span className="text-[rgb(var(--muted-fg))]"> · {Math.round(ins.distance)} m</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-[rgb(var(--bg))] p-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-[rgb(var(--muted-fg))]">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
