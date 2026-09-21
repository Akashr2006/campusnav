"use client";

import { useState, useEffect, useMemo } from "react";
import type { VisitorGpsState } from "@/shared/hooks/use-visitor-gps";
import { gpsToCanvas, canvasToGps, MAP_ORIGIN, PIXELS_PER_METER } from "@/lib/geo/projection";
import { evaluateBuildingContainment, classifyGpsConfidence } from "@/lib/geo/containment";
import { campusStore } from "@/shared/lib/campus-store";
import { calculateGeographicDistance } from "@/lib/geo/haversine";
import { Activity, Compass, AlertCircle, CheckCircle2, Crosshair, RefreshCw, X, ShieldAlert } from "lucide-react";

export interface SamplePoint {
  index: number;
  timestamp: number;
  lat: number;
  lng: number;
  accuracy: number;
  canvasX: number;
  canvasY: number;
}

interface Props {
  gps: VisitorGpsState;
  onClose?: () => void;
}

export function GpsDiagnosticsPanel({ gps, onClose }: Props) {
  const [samples, setSamples] = useState<SamplePoint[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [targetBuildingId, setTargetBuildingId] = useState<string>("bld-msr37pmp"); // Default to RP Building

  const rawLat = gps.location?.latitude ?? gps.lat;
  const rawLng = gps.location?.longitude ?? gps.lng;
  const rawAccuracy = gps.location?.accuracy ?? gps.accuracy;
  const rawTimestamp = gps.location?.timestamp ?? Date.now();
  const altitude = gps.location?.altitude ?? null;
  const altitudeAccuracy = gps.location?.altitudeAccuracy ?? null;
  const heading = gps.location?.heading ?? gps.heading;
  const speed = gps.location?.speed ?? gps.speed;

  const ageMs = Math.max(0, Date.now() - rawTimestamp);
  const ageSeconds = (ageMs / 1000).toFixed(1);
  const isStale = ageMs > 10000;

  const confidence = classifyGpsConfidence(rawAccuracy);

  // Input to Projection
  const projectedCanvas = gpsToCanvas(rawLat, rawLng);
  // Round trip test
  const roundTrip = canvasToGps(projectedCanvas.x, projectedCanvas.y);
  const roundTripErrorMeters = calculateGeographicDistance(rawLat, rawLng, roundTrip.lat, roundTrip.lng);

  // Published buildings from store
  const published = campusStore.getPublishedData();
  const buildings = published.buildings || [];
  const selectedBuilding = buildings.find((b) => b.id === targetBuildingId) || buildings[0];

  // Containment evaluation
  const containment = useMemo(() => {
    if (!selectedBuilding || !rawLat || !rawLng) return null;
    return evaluateBuildingContainment(rawLat, rawLng, rawAccuracy || 10, selectedBuilding);
  }, [rawLat, rawLng, rawAccuracy, selectedBuilding]);

  // Sample recorder: Record continuous fixes
  useEffect(() => {
    if (!isRecording || !gps.isGpsActive || !rawLat || !rawLng) return;
    if (samples.length >= 20) {
      setIsRecording(false);
      return;
    }

    const newSample: SamplePoint = {
      index: samples.length + 1,
      timestamp: rawTimestamp,
      lat: rawLat,
      lng: rawLng,
      accuracy: rawAccuracy || 0,
      canvasX: projectedCanvas.x,
      canvasY: projectedCanvas.y,
    };

    // Avoid duplicate samples by timestamp
    if (samples.length === 0 || samples[samples.length - 1].timestamp !== rawTimestamp) {
      setSamples((prev) => [...prev, newSample]);
    }
  }, [isRecording, gps.isGpsActive, rawLat, rawLng, rawTimestamp, rawAccuracy, projectedCanvas.x, projectedCanvas.y, samples]);

  // Statistical calculations for 20 samples
  const sampleStats = useMemo(() => {
    if (samples.length === 0) return null;
    const lats = samples.map((s) => s.lat);
    const lngs = samples.map((s) => s.lng);
    const accuracies = samples.map((s) => s.accuracy);

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    const meanLat = lats.reduce((a, b) => a + b, 0) / lats.length;
    const meanLng = lngs.reduce((a, b) => a + b, 0) / lngs.length;

    const sortedLats = [...lats].sort((a, b) => a - b);
    const sortedLngs = [...lngs].sort((a, b) => a - b);
    const medianLat = sortedLats[Math.floor(sortedLats.length / 2)];
    const medianLng = sortedLngs[Math.floor(sortedLngs.length / 2)];

    const bestAcc = Math.min(...accuracies);
    const worstAcc = Math.max(...accuracies);

    const spreadMeters = calculateGeographicDistance(minLat, minLng, maxLat, maxLng);

    return {
      count: samples.length,
      minLat, maxLat, minLng, maxLng,
      meanLat, meanLng, medianLat, medianLng,
      bestAcc, worstAcc, spreadMeters,
    };
  }, [samples]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-slate-900/95 text-slate-100 p-4 shadow-2xl backdrop-blur-xl max-w-md w-full max-h-[85vh] overflow-y-auto text-xs font-mono border-slate-700/60 z-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-400 animate-pulse" />
          <span className="font-bold text-sm text-slate-50 uppercase tracking-wider">GPS Diagnostics Engine</span>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* 1. Status & Freshness */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[10px] uppercase text-slate-400">GPS Signal Status</div>
          <div className="font-bold text-slate-100 flex items-center gap-1.5 mt-0.5">
            <span className={`h-2 w-2 rounded-full ${gps.isGpsActive ? "bg-emerald-400 animate-ping" : "bg-red-400"}`} />
            {gps.status.toUpperCase()} ({isStale ? "STALE FIX" : "LIVE FIX"})
          </div>
          <div className="text-[10px] text-slate-400 mt-1">Age: <span className="text-slate-200 font-semibold">{ageSeconds}s</span></div>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
          <div className="text-[10px] uppercase text-slate-400">Accuracy & Confidence</div>
          <div className="font-bold text-slate-100 mt-0.5">{rawAccuracy ? `±${rawAccuracy.toFixed(1)} m` : "Unknown"}</div>
          <div className={`text-[10px] font-semibold mt-0.5 ${confidence === "HIGH CONFIDENCE" ? "text-emerald-400" : confidence === "MEDIUM CONFIDENCE" ? "text-amber-400" : "text-rose-400"}`}>
            {confidence}
          </div>
        </div>
      </div>

      {/* 2. Raw GPS Coordinates */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
        <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Raw Device Coordinates</div>
        <div className="grid grid-cols-2 gap-2 text-slate-200">
          <div>Lat: <span className="font-bold font-mono text-emerald-300">{rawLat ? rawLat.toFixed(9) : "N/A"}</span></div>
          <div>Lng: <span className="font-bold font-mono text-emerald-300">{rawLng ? rawLng.toFixed(9) : "N/A"}</span></div>
          <div>Alt: <span className="text-slate-300">{altitude !== null ? `${altitude.toFixed(1)}m` : "N/A"}</span></div>
          <div>Heading: <span className="text-slate-300">{heading !== null ? `${heading.toFixed(0)}°` : "N/A"}</span></div>
          <div>Speed: <span className="text-slate-300">{speed !== null ? `${speed.toFixed(1)}m/s` : "N/A"}</span></div>
          <div>High Accuracy: <span className="text-emerald-400 font-semibold">Enabled</span></div>
        </div>
      </div>

      {/* 3. Projection Input / Output Audit */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-1.5">
        <div className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Projection Audit (gpsToCanvas)</div>
        <div className="text-slate-300 space-y-1">
          <div>Projection Origin: <span className="text-slate-100 font-mono">({MAP_ORIGIN.lat.toFixed(6)}, {MAP_ORIGIN.lng.toFixed(6)})</span></div>
          <div>Scale: <span className="text-slate-100 font-mono">{PIXELS_PER_METER} px/m</span></div>
          <div className="pt-1 border-t border-slate-800/80">
            <span className="text-amber-300 font-semibold">GPS INPUT:</span> ({rawLat.toFixed(7)}, {rawLng.toFixed(7)})
          </div>
          <div>
            <span className="text-emerald-300 font-semibold">CANVAS OUTPUT:</span> X: <span className="font-bold">{projectedCanvas.x}</span>, Y: <span className="font-bold">{projectedCanvas.y}</span>
          </div>
          <div>Round-trip Error: <span className="text-emerald-400 font-semibold">{roundTripErrorMeters < 0.01 ? "< 0.01 m (EXACT)" : `${roundTripErrorMeters.toFixed(3)} m`}</span></div>
        </div>
      </div>

      {/* 4. Accuracy-Aware Building Containment Audit */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold text-purple-400 uppercase tracking-wider">Building Containment Audit</div>
          <select
            value={targetBuildingId}
            onChange={(e) => setTargetBuildingId(e.target.value)}
            className="bg-slate-900 border border-slate-700 text-slate-200 rounded px-1.5 py-0.5 text-[10px]"
          >
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        {selectedBuilding && containment && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between bg-slate-900/90 p-2 rounded-lg border border-slate-800">
              <span className="text-slate-400 font-semibold">Status:</span>
              <span
                className={`font-bold px-2 py-0.5 rounded text-xs tracking-wider ${
                  containment.status === "INSIDE"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : containment.status === "UNCERTAIN"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                }`}
              >
                {containment.status}
              </span>
            </div>

            <div className="text-slate-300 space-y-0.5">
              <div>Polygon Interior Test: <span className="font-bold text-slate-100">{containment.isInsidePolygon ? "INSIDE POLYGON" : "OUTSIDE POLYGON"}</span></div>
              <div>Dist to Boundary: <span className="font-bold text-slate-100">{containment.distanceToBoundaryMeters} m</span></div>
              <div>GPS Accuracy Radius: <span className="font-bold text-slate-100">{rawAccuracy ? rawAccuracy.toFixed(1) : "N/A"} m</span></div>
            </div>

            <div className="text-[10px] text-slate-400 italic bg-slate-900/50 p-1.5 rounded border border-slate-800/60">
              "{containment.reason}"
            </div>
          </div>
        )}
      </div>

      {/* 5. 20-Sample Collector & Spread Analyzer */}
      <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">
            20-Sample GPS Collector ({samples.length}/20)
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => {
                setSamples([]);
                setIsRecording(true);
              }}
              disabled={isRecording}
              className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded font-bold text-[10px] transition-colors"
            >
              {isRecording ? "Collecting..." : "Start 20 Samples"}
            </button>
            <button
              onClick={() => {
                setSamples([]);
                setIsRecording(false);
              }}
              className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-bold text-[10px]"
            >
              Clear
            </button>
          </div>
        </div>

        {sampleStats && (
          <div className="space-y-1 text-slate-300 bg-slate-900/80 p-2 rounded border border-slate-800 text-[10.5px]">
            <div>Spread (Jitter Radius): <span className="font-bold text-amber-300">{sampleStats.spreadMeters.toFixed(2)} m</span></div>
            <div>Best Accuracy: <span className="font-bold text-emerald-300">±{sampleStats.bestAcc.toFixed(1)} m</span></div>
            <div>Worst Accuracy: <span className="font-bold text-rose-300">±{sampleStats.worstAcc.toFixed(1)} m</span></div>
            <div>Mean Coord: <span className="font-mono text-slate-200">{sampleStats.meanLat.toFixed(7)}, {sampleStats.meanLng.toFixed(7)}</span></div>
            <div>Median Coord: <span className="font-mono text-slate-200">{sampleStats.medianLat.toFixed(7)}, {sampleStats.medianLng.toFixed(7)}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}
