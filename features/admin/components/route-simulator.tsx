"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle } from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { campusStore } from "@/shared/lib/campus-store";
import { CampusMap } from "@/features/navigation/components/campus-map";
import { shortestPath, multiStopShortestPath, type Route } from "@/features/navigation/services/graph";
import { Play, Plus, Minus, Trash2 } from "lucide-react";

export function RouteSimulator() {
  const [storeData, setStoreData] = useState(() => campusStore.getWorkingData());

  useEffect(() => {
    setStoreData(campusStore.getWorkingData());
    const unsub = campusStore.subscribe(() => {
      setStoreData(campusStore.getWorkingData());
    });
    return unsub;
  }, []);

  // Combine rooms / destinations (classrooms, labs, etc.) + named nodes for options, matching the user's navigation search options logic.
  const options = (() => {
    const namedNodeItems = (storeData.nodes || [])
      .filter((n) => n.name && n.name.trim().length > 0)
      .map((n) => {
        const typeLabel =
          n.type === "GATE"
            ? "Gate / Entrance"
            : n.type === "BUILDING_ENTRANCE" || n.type === "ROOM_ENTRANCE"
            ? "Entrance"
            : n.type === "STAIR" || n.type === "LIFT"
            ? "Floor Transition"
            : n.type === "RECEPTION"
            ? "Reception"
            : n.type === "ROOM" || n.type === "LABORATORY" || n.type === "OFFICE"
            ? "Classroom / Room"
            : n.type === "OUTDOOR" || n.type === "OUTDOOR_PATH" || n.type === "ROAD_JUNCTION"
            ? "Campus Landmark"
            : "Map Location";

        return {
          id: n.id,
          name: `${n.name} (${typeLabel})`,
          category: typeLabel,
        };
      });

    const map = new Map<string, { id: string; name: string; category: string }>();

    // Exclude raw generic building items
    (storeData.destinations || [])
      .filter((d) => d.category !== "Building")
      .forEach((d) => {
        map.set(d.id, {
          id: d.id,
          name: `⭐ ${d.name} (${d.category || "Room"})`,
          category: d.category,
        });
      });

    namedNodeItems
      .filter((n) => n.category !== "Building")
      .forEach((n) => {
        if (!map.has(n.id)) {
          map.set(n.id, n);
        }
      });

    return Array.from(map.values());
  })();

  const allStarts = options;
  const allDestinations = options;

  const [start, setStart] = useState("");
  const [stops, setStops] = useState<string[]>([]);
  const [destId, setDestId] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (allStarts.length > 0 && (!start || !allStarts.some((s) => s.id === start))) {
      setStart(allStarts[0].id);
    }
    if (allDestinations.length > 0 && (!destId || !allDestinations.some((d) => d.id === destId))) {
      // Default to somewhere other than the start, so the first run simulates a real route
      const firstDifferent = allDestinations.find((d) => d.id !== (start || allStarts[0]?.id));
      setDestId((firstDifferent ?? allDestinations[0]).id);
    }
  }, [allStarts, allDestinations, start, destId]);

  function addStop() {
    const defaultStop = options.find((o) => o.id !== start && o.id !== destId)?.id || options[0]?.id || "";
    setStops((prev) => [...prev, defaultStop]);
  }

  function removeStop(index: number) {
    setStops((prev) => prev.filter((_, i) => i !== index));
  }

  function updateStop(index: number, val: string) {
    setStops((prev) => prev.map((s, i) => (i === index ? val : s)));
  }

  function run() {
    if (!start || !destId) return;
    setLoading(true);
    const waypoints = [start, ...stops.filter(Boolean), destId];
    const clientRoute = multiStopShortestPath(waypoints);
    setLoading(false);
    setRoute(clientRoute);
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[400px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardTitle>Inputs</CardTitle>
          <div className="mt-4 space-y-3">
            <Field label="Start Location">
              <select
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="h-10 w-full rounded-lg border bg-[rgb(var(--card))] px-3 text-sm"
              >
                {allStarts.length === 0 ? (
                  <option value="" disabled>No start locations available</option>
                ) : (
                  allStarts.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))
                )}
              </select>
            </Field>

            {/* Intermediate Stops */}
            {stops.map((stopVal, idx) => (
              <div key={idx} className="relative">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-[rgb(var(--muted-fg))]">Stop {idx + 1}</span>
                  <button
                    onClick={() => removeStop(idx)}
                    className="text-red-400 hover:text-red-500 p-0.5"
                    title="Remove Stop"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <select
                  value={stopVal}
                  onChange={(e) => updateStop(idx, e.target.value)}
                  className="h-10 w-full rounded-lg border border-amber-500/40 bg-[rgb(var(--card))] px-3 text-sm focus:ring-2 focus:ring-amber-400"
                >
                  {options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}

            {/* Add Stop Button - Matching User Navigation Style */}
            <button
              type="button"
              onClick={addStop}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-400/60 bg-amber-400/5 py-2 text-xs font-semibold text-amber-500 hover:bg-amber-400/10 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add Stop
            </button>

            <Field label="End Destination">
              <select
                value={destId}
                onChange={(e) => setDestId(e.target.value)}
                className="h-10 w-full rounded-lg border bg-[rgb(var(--card))] px-3 text-sm"
              >
                {allDestinations.length === 0 ? (
                  <option value="" disabled>No destinations available</option>
                ) : (
                  allDestinations.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))
                )}
              </select>
            </Field>

            <Button
              onClick={run}
              loading={loading}
              disabled={!start || !destId}
              variant="gradient"
              className="w-full mt-2"
            >
              <Play className="h-4 w-4" />
              Simulate Route
            </Button>
          </div>
        </Card>

        {route && (
          <Card>
            <CardTitle className="text-sm font-semibold">Route Summary</CardTitle>
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[rgb(var(--muted-fg))]">Distance</span>
                <span className="font-semibold">{Math.round(route.distance)} meters</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[rgb(var(--muted-fg))]">Est. Time</span>
                <span className="font-semibold">~{Math.round(route.durationSec / 60)} minutes</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[rgb(var(--muted-fg))]">Waypoints</span>
                <span className="font-semibold">{route.nodes.length} nodes ({stops.filter(Boolean).length + 2} key locations)</span>
              </div>
            </div>
          </Card>
        )}
      </div>

      <div className="card min-h-[380px] sm:min-h-[500px] h-[55dvh] lg:h-auto p-0 overflow-hidden">
        <CampusMap route={route} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[rgb(var(--muted-fg))]">
        {label}
      </label>
      {children}
    </div>
  );
}

