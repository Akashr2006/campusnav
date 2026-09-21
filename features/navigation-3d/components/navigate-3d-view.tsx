"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Route as RouteIcon,
  Building2,
  Layers,
  Scissors,
  Sun,
  PencilRuler,
  Presentation,
  X,
  SkipBack,
  SkipForward,
  Maximize2,
  Plane,
  Thermometer,
} from "lucide-react";
import { shortestPath } from "@/features/navigation/services/graph";
import { applyPilotStructure, PILOT_BUILDING_IDS } from "@/shared/data/pilot-structure";
import { buildCampus3D, type Campus3D, type Vec2 } from "../lib/campus-3d";
import { frameFor, isolateStorey } from "../lib/building-structure";
import { fitOutCeiling, furnishRoom } from "../lib/floor-interior";
import { buildTimeline, cueStarts, stateAt, totalDuration } from "../lib/presentation";
import { HudButton, HudLabel, HudPanel, HudStat, HudStyles, HudTier } from "./hud";

// WebGL cannot render on the server, and three pulls in a large bundle, so the
// scene is loaded only in the browser.
const CampusScene = dynamic(
  () => import("./campus-scene").then((m) => m.CampusScene),
  {
    ssr: false,
    loading: () => <SceneMessage text="Building the campus…" />,
  }
);

function SceneMessage({ text }: { text: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-[#0b1120] text-sm text-slate-400">
      <span className="mr-3 h-5 w-5 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
      {text}
    </div>
  );
}

type Graph = Record<string, any>;

export function Navigate3DView() {
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [playing, setPlaying] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [explode, setExplode] = useState(0);
  const [sectionCut, setSectionCut] = useState<number | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [frameStats, setFrameStats] = useState<{
    columns: number;
    beams: number;
    slabs: number;
    walls: number;
    rooms: number;
    cores: number;
  } | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [mode, setMode] = useState<"DIAGRAM" | "REALISTIC">("REALISTIC");
  // Drone survey layers (public/drone). Off by default: the mesh streams hundreds of MB.
  const [droneMesh, setDroneMesh] = useState(false);
  const [thermal, setThermal] = useState(false);
  // `undefined` = let the scene pick; `null` = show the whole stack.
  const [isolated, setIsolated] = useState<number | null | undefined>(undefined);
  const [storeys, setStoreys] = useState<{ ordinals: number[]; suggested: number | null }>({
    ordinals: [],
    suggested: null,
  });

  // Presentation mode: a scripted fly-through driven by a clock. The director
  // (lib/presentation.ts) owns the choreography; this component only advances
  // time and applies what it returns.
  const [presenting, setPresenting] = useState(false);
  const [presentPaused, setPresentPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/published-graph", { cache: "no-store" })
      .then((r) => r.json())
      .then((payload) => {
        if (cancelled) return;
        const g = payload?.graph;
        if (!g) {
          setError("No campus has been published yet.");
          return;
        }
        // Phase 1: the three pilot buildings get their structural data from an
        // overlay until floor plans are traced in the admin editor (Phase 2).
        setGraph(applyPilotStructure(g));
      })
      .catch(() => {
        if (!cancelled) setError("Could not load the campus graph.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const campus: Campus3D | null = useMemo(() => (graph ? buildCampus3D(graph) : null), [graph]);

  const selectedBuilding = useMemo(
    () => (selectedId ? campus?.buildings.find((b) => b.id === selectedId) ?? null : null),
    [campus, selectedId]
  );
  const framed = Boolean(selectedBuilding && selectedBuilding.lod !== "MASSING");

  /**
   * The buildings that actually have a structural model. Clicking a 60 m block
   * from 1.4 km away is a pixel hunt, and only a handful of the 48 are modelled,
   * so the ones worth opening get named.
   */
  const modelled = useMemo(
    () =>
      (campus?.buildings ?? [])
        .filter((b) => !b.isSiteFeature && b.lod !== "MASSING")
        .map((b) => ({
          id: b.id,
          name: b.name,
          shortCode: b.shortCode,
          rooms: b.floors.reduce((n, f) => n + (f.rooms?.length ?? 0), 0),
        }))
        .sort((a, b) => b.rooms - a.rooms || a.name.localeCompare(b.name)),
    [campus]
  );

  const roomDetail = useMemo(() => {
    if (!selectedRoomId || !selectedBuilding) return null;
    const full = frameFor(selectedBuilding);
    if (!full) return null;
    const room = full.rooms.find((r) => r.id === selectedRoomId);
    if (!room) return null;
    const storey = full.slabs.find((sl) => Math.abs(sl.top - room.base) < 1e-6);
    const one = isolateStorey(full, storey ? storey.ordinal : null);
    const furniture = furnishRoom(room, one.angleRad);
    const fittings = fitOutCeiling(room, one.angleRad);
    const count = (k: string) => furniture.filter((f) => f.kind === k).length;
    const xs = room.outline.map((p) => p.x);
    const zs = room.outline.map((p) => p.z);
    const a = Math.max(...xs) - Math.min(...xs);
    const b = Math.max(...zs) - Math.min(...zs);
    return {
      room,
      storeyName: storey?.name ?? "",
      length: Math.max(a, b),
      depth: Math.min(a, b),
      desks: count("DESK"),
      drafting: count("DRAFTING_TABLE"),
      shelves: count("SHELF"),
      fans: fittings.filter((f) => f.kind === "FAN").length,
      tubes: fittings.filter((f) => f.kind === "TUBE").length,
      // Two to a desk-and-bench pair, one to a drafting table.
      seats: count("DESK") * 2 + count("DRAFTING_TABLE"),
    };
  }, [selectedRoomId, selectedBuilding]);

  // Clearing the floor selection with the building stops a stale floor tag
  // surviving into the next building's frame.
  // Set by the Explode button when it opens a building: the whole stack must
  // stay visible, so the usual "open on the surveyed storey" default is skipped.
  const wholeStackOnOpen = useRef(false);

  useEffect(() => {
    setSelectedFloorId(null);
    setSelectedRoomId(null);
    // Hand the choice back to the scene, so the next building opens on its own
    // surveyed storey rather than inheriting the last one's.
    setIsolated(wholeStackOnOpen.current ? null : undefined);
    wholeStackOnOpen.current = false;
  }, [selectedId]);

  const effectiveIsolated = isolated === undefined ? storeys.suggested : isolated;

  useEffect(() => {
    if (mode === "REALISTIC" && effectiveIsolated !== null && explode < 0.02) setExplode(0.5);
  }, [mode, effectiveIsolated, explode]);

  const onIsolatableChange = useCallback(
    (info: { ordinals: number[]; suggested: number | null }) =>
      setStoreys((prev) =>
        prev.suggested === info.suggested &&
        prev.ordinals.length === info.ordinals.length &&
        prev.ordinals.every((o, i) => o === info.ordinals[i])
          ? prev
          : info
      ),
    []
  );

  /**
   * One-click explode view. With a modelled building already open it toggles
   * the stack fully apart; with nothing open it opens the first modelled block
   * and explodes it, so the view is always one press away.
   */
  const toggleExplodeView = useCallback(() => {
    const target = selectedId && modelled.some((m) => m.id === selectedId) ? selectedId : modelled[0]?.id;
    if (!target) return;
    if (target !== selectedId) {
      wholeStackOnOpen.current = true;
      setSelectedId(target);
      setMode("DIAGRAM");
      setExplode(1);
      return;
    }
    // Exploded already: reassemble. Otherwise pull the whole stack apart.
    if (explode > 0.5) {
      setExplode(0);
    } else {
      setIsolated(null);
      setExplode(1);
    }
  }, [selectedId, modelled, explode]);
  const exploded = framed && explode > 0.5;

  const floorLabel = (o: number) =>
    o < 0 ? `B${Math.abs(o)}` : o === 0 ? "G" : String(o);

  /** Entrances are the only nodes a person would pick as an endpoint. */
  const destinations = useMemo<{ id: string; name: string }[]>(() => {
    if (!graph) return [];
    return (graph.nodes ?? [])
      .filter((n: any) => n?.type === "BUILDING_ENTRANCE")
      .map((n: any) => ({ id: String(n.id), name: String(n.name ?? n.id) }))
      .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  }, [graph]);

  // Pick a default pair so the page opens with an animated route already running.
  useEffect(() => {
    if (destinations.length >= 2 && !fromId && !toId) {
      setFromId(destinations[0].id);
      setToId(destinations[Math.min(4, destinations.length - 1)].id);
    }
  }, [destinations, fromId, toId]);

  const { routePath } = useMemo(() => {
    if (!campus || !graph || !fromId || !toId || fromId === toId) {
      return { routePath: [] as Vec2[], routeInfo: null, routeError: null };
    }
    const route = shortestPath(fromId, toId, { graphData: graph, travelMode: "WALK" });
    if (!route || !route.nodes?.length) {
      // The published graph has two disconnected components, so some pairs
      // genuinely have no path. Say so rather than showing an empty scene.
      return {
        routePath: [] as Vec2[],
        routeInfo: null,
        routeError: "No path exists between these two points.",
      };
    }
    const pts = route.nodes
      .map((n: any) => campus.nodeById.get(String(n.id))?.position)
      .filter((p): p is Vec2 => Boolean(p));
    return {
      routePath: pts,
      routeInfo: { distance: Math.round(route.distance), stops: route.nodes.length },
      routeError: null,
    };
  }, [campus, graph, fromId, toId]);

  const timeline = useMemo(() => {
    if (!campus || !graph) return null;
    const pilots = PILOT_BUILDING_IDS.map((id) => campus.buildings.find((b) => b.id === id))
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => ({ id: b.id, name: b.name, storeys: b.floors.length || b.storeys, structureType: b.structureType }));
    return buildTimeline({
      campusName: String(graph.campus?.name ?? "Campus"),
      buildingCount: campus.buildings.length,
      pilots,
      hasRoute: routePath.length >= 2,
    });
  }, [campus, graph, routePath.length]);

  const show = useMemo(
    () => (presenting && timeline ? stateAt(timeline, elapsed) : null),
    [presenting, timeline, elapsed]
  );

  // The clock is wall time measured from an origin, not a sum of frame deltas.
  // requestAnimationFrame only triggers re-renders: browsers throttle it in
  // background tabs, embedded panes and on low-power displays, and a delta-sum
  // clock silently runs slow under that. Wall time cannot drift.
  const originRef = useRef(0);
  const seek = useCallback((t: number) => {
    originRef.current = performance.now() - t * 1000;
    setElapsed(t);
  }, []);

  useEffect(() => {
    if (!presenting || presentPaused) return;
    // Resuming: re-anchor the origin so the paused interval is not counted.
    originRef.current = performance.now() - elapsed * 1000;
    let raf = 0;
    const tick = (now: number) => {
      setElapsed((now - originRef.current) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `elapsed` is read once to anchor the origin; re-running on every tick
    // would re-anchor continuously and freeze the clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenting, presentPaused]);

  // Rest on the final frame rather than looping: a presenter ending on the
  // campus wide shot is the natural close.
  useEffect(() => {
    if (show?.finished) setPresentPaused(true);
  }, [show?.finished]);

  const startPresentation = useCallback(() => {
    seek(0);
    setPresentPaused(false);
    setPresenting(true);
    setSelectedId(null);
    setExplode(0);
    setSectionCut(null);
    // Fullscreen is a nicety; a refusal (iframe, policy) must not block the show.
    rootRef.current?.requestFullscreen?.().catch(() => {});
  }, [seek]);

  const stopPresentation = useCallback(() => {
    setPresenting(false);
    setPresentPaused(false);
    setSelectedId(null);
    setExplode(0);
    setSectionCut(null);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);

  const jumpCue = useCallback(
    (delta: number) => {
      if (!timeline || !show) return;
      const starts = cueStarts(timeline);
      const next = Math.max(0, Math.min(timeline.length - 1, show.cueIndex + delta));
      seek(starts[next]);
      setPresentPaused(false);
    },
    [timeline, show, seek]
  );

  // `?present=1` opens straight into the show, so a single link can be put on
  // a slide or sent to the college.
  useEffect(() => {
    if (!campus || presenting) return;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("present") === "1") {
      startPresentation();
    }
    // Deliberately only once the campus is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campus]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stopPresentation();
      else if (e.key === " ") {
        e.preventDefault();
        setPresentPaused((p) => !p);
      } else if (e.key === "ArrowRight") jumpCue(1);
      else if (e.key === "ArrowLeft") jumpCue(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, stopPresentation, jumpCue]);

  // Leaving browser fullscreen (the browser handles Esc first) also ends the show.
  useEffect(() => {
    if (!presenting) return;
    const onFs = () => {
      if (!document.fullscreenElement) setPresenting(false);
    };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, [presenting]);

  // While presenting, the director's values replace the hand controls.
  const liveSelectedId = show ? show.selectedId : selectedId;
  const liveExplode = show ? show.explode : explode;
  const liveSectionCut = show ? show.sectionCut : sectionCut;
  const livePlaying = show ? show.routePlaying : playing;
  // A building close-up is about the structure; a 6 m marker sitting in the
  // foreground competes with it, so the route stays campus-scale only.
  const liveRoutePath = show && show.cue.kind === "building" ? [] : routePath;

  if (error) {
    return <SceneMessage text={error} />;
  }
  if (!campus) {
    return <SceneMessage text="Loading campus data…" />;
  }

  return (
    <div ref={rootRef} className="relative h-[calc(100vh-64px)] w-full overflow-hidden bg-[#0b1120]">
      <CampusScene
        campus={campus}
        routePath={liveRoutePath}
        playing={livePlaying}
        selectedId={liveSelectedId}
        onSelect={presenting ? () => {} : setSelectedId}
        explode={liveExplode}
        sectionCut={liveSectionCut}
        selectedFloorId={selectedFloorId}
        onSelectFloor={setSelectedFloorId}
        onFrameStats={setFrameStats}
        autoOrbit={Boolean(show?.orbit)}
        isolatedOrdinal={isolated}
        onIsolatableChange={onIsolatableChange}
        selectedRoomId={selectedRoomId}
        onSelectRoom={setSelectedRoomId}
        mode={mode}
        droneMesh={droneMesh}
        thermal={thermal}
      />

      <HudStyles />

      {/* Building dossier. Only for a building whose LOD claims a frame, so the
          controls never imply detail the data does not have. */}
      {!presenting && framed && selectedBuilding && (
        <HudPanel
          accent="structure"
          className="hud-in pointer-events-auto absolute right-4 top-24 z-20 max-h-[calc(100%-8rem)] w-72 max-w-[calc(100%-2rem)] overflow-y-auto p-4 text-xs"
        >
          <HudLabel accent="structure">Structure · dossier</HudLabel>
          <div className="mt-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-base font-semibold text-white">{selectedBuilding.name}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                {selectedBuilding.structureType?.replace("_", " ")} · {selectedBuilding.floors.length} storeys
              </div>
            </div>
            <HudTier lod={selectedBuilding.lod} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1">
            {(
              [
                ["REALISTIC", "Realistic", Sun],
                ["DIAGRAM", "Diagram", PencilRuler],
              ] as const
            ).map(([m, label, Icon]) => (
              <HudButton key={m} accent="structure" active={mode === m} onClick={() => setMode(m)}>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </HudButton>
            ))}
          </div>
          {mode === "REALISTIC" && effectiveIsolated === null && (
            <p className="mt-2 rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-[10px] leading-snug text-amber-200">
              Pick a single floor to see its interior. Walls and fit-out are modelled one storey at a time.
            </p>
          )}

          {storeys.ordinals.length > 1 && (
            <div className="mt-4">
              <HudLabel accent="structure">
                <Layers className="h-3 w-3" /> Floor
              </HudLabel>
              <div className="mt-1.5 flex flex-wrap gap-1">
                <HudButton accent="structure" active={effectiveIsolated === null} onClick={() => setIsolated(null)}>
                  All
                </HudButton>
                {storeys.ordinals.map((o) => (
                  <HudButton
                    key={o}
                    accent="structure"
                    active={effectiveIsolated === o}
                    onClick={() => setIsolated(o)}
                    title={o === storeys.suggested ? "The only storey with a room survey" : undefined}
                  >
                    {floorLabel(o)}
                    {o === storeys.suggested && <span className="h-1 w-1 rounded-full bg-current opacity-80" />}
                  </HudButton>
                ))}
              </div>
              {effectiveIsolated !== null && (
                <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
                  One storey shown. Explode lifts its ceiling off.
                </p>
              )}
            </div>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <HudLabel accent="structure">
                <Layers className="h-3 w-3" /> Explode
              </HudLabel>
              <span className="font-mono text-[11px] tabular-nums text-slate-200">{Math.round(explode * 100)}%</span>
            </div>
            <input
              id="explode"
              aria-label="Explode"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={explode}
              onChange={(e) => setExplode(Number(e.target.value))}
              className="mt-1.5 w-full accent-red-500"
            />
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between">
              <HudLabel accent="structure">
                <Scissors className="h-3 w-3" /> Section cut
              </HudLabel>
              <HudButton
                accent="structure"
                active={sectionCut !== null}
                onClick={() => setSectionCut((v) => (v === null ? 0.5 : null))}
                className="!px-2 !py-0.5 !text-[10px]"
              >
                {sectionCut === null ? "Off" : "On"}
              </HudButton>
            </div>
            <input
              id="section"
              aria-label="Section cut"
              type="range"
              min={0}
              max={1}
              step={0.01}
              disabled={sectionCut === null}
              value={sectionCut ?? 0.5}
              onChange={(e) => setSectionCut(Number(e.target.value))}
              className="mt-1.5 w-full accent-red-500 disabled:opacity-40"
            />
          </div>

          {frameStats && (
            <div className="mt-4 grid grid-cols-3 gap-1.5 border-t border-white/10 pt-3">
              <HudStat value={frameStats.slabs} label="Slabs" accent="structure" />
              <HudStat value={frameStats.columns} label="Columns" accent="structure" />
              <HudStat value={frameStats.beams} label="Beams" accent="structure" />
              <HudStat value={frameStats.rooms} label="Rooms" accent="structure" />
              <HudStat value={frameStats.cores} label="Cores" accent="structure" />
              <HudStat value={frameStats.slabs + frameStats.cores + 2} label="Draw calls" />
            </div>
          )}
        </HudPanel>
      )}

      {/* Command bar. */}
      {!presenting && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center p-4">
          <HudPanel accent="nav" corners={false} className="pointer-events-auto flex w-full max-w-4xl flex-wrap items-center gap-2 p-2">
            <HudLabel accent="nav" className="ml-1 mr-1">
              <RouteIcon className="h-3 w-3" /> Route
            </HudLabel>
            <select
              aria-label="From"
              value={fromId}
              onChange={(e) => setFromId(e.target.value)}
              className="min-w-[9rem] flex-1 rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
            >
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <span className="font-mono text-cyan-300">→</span>
            <select
              aria-label="To"
              value={toId}
              onChange={(e) => setToId(e.target.value)}
              className="min-w-[9rem] flex-1 rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
            >
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <label htmlFor="model" className="sr-only">
              Structural model
            </label>
            <select
              id="model"
              value={selectedId && modelled.some((m) => m.id === selectedId) ? selectedId : ""}
              onChange={(e) => setSelectedId(e.target.value || null)}
              title="Buildings with a structural model"
              className="min-w-[9rem] flex-1 rounded-md border border-red-400/40 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 outline-none focus:border-red-400"
            >
              <option value="">Structural model…</option>
              {modelled.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.rooms > 0 ? ` — ${m.rooms} rooms` : ""}
                </option>
              ))}
            </select>
            <HudButton accent="nav" active onClick={() => setPlaying((p) => !p)} title={playing ? "Pause the walker" : "Play the walker"}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {playing ? "Pause" : "Play"}
            </HudButton>
            <HudButton
              accent="structure"
              active={exploded}
              onClick={toggleExplodeView}
              title={exploded ? "Reassemble the building" : "Explode view: pull the structure apart storey by storey"}
              disabled={modelled.length === 0}
            >
              <Layers className="h-3.5 w-3.5" />
              {exploded ? "Assemble" : "Explode"}
            </HudButton>
            <HudButton
              accent="nav"
              active={droneMesh}
              onClick={() => setDroneMesh((d) => !d)}
              title="Drone survey: the photogrammetry mesh of the campus (April 2022)"
            >
              <Plane className="h-3.5 w-3.5" />
              Drone
            </HudButton>
            <HudButton
              accent="structure"
              active={thermal}
              onClick={() => setThermal((t) => !t)}
              title="Thermal overlay, AS & IB blocks only. Relative heat (bright = warmer), not calibrated °C."
            >
              <Thermometer className="h-3.5 w-3.5" />
              Thermal
            </HudButton>
            <HudButton
              accent="structure"
              onClick={startPresentation}
              title="Presentation mode: scripted fly-through with structural choreography. Esc to exit."
            >
              <Presentation className="h-3.5 w-3.5 text-red-300" />
              Present
            </HudButton>
          </HudPanel>
        </div>
      )}

      {/* Room card. */}
      {roomDetail && (
        <HudPanel accent="structure" className="hud-in pointer-events-auto absolute bottom-4 left-4 z-30 w-80 max-w-[calc(100%-2rem)] overflow-hidden text-xs">
          <div className="border-b border-white/10 bg-gradient-to-r from-red-500/20 to-transparent px-4 py-3">
            <HudLabel accent="structure">Room</HudLabel>
            <div className="mt-1.5 flex items-start justify-between gap-2">
              <div className="min-w-0">
                {roomDetail.room.code && (
                  <div className="font-mono text-2xl font-bold leading-none text-white">{roomDetail.room.code}</div>
                )}
                <div className="mt-1 truncate text-sm font-medium text-slate-100">{roomDetail.room.name}</div>
                <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  {roomDetail.room.category.replace("_", " ").toLowerCase()} · {roomDetail.storeyName}
                </div>
              </div>
              <button
                onClick={() => setSelectedRoomId(null)}
                aria-label="Close room details"
                className="rounded p-1 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 p-3">
            <HudStat value={roomDetail.room.areaM2.toFixed(0)} unit="m²" label="Area" accent="structure" />
            <HudStat value={`${roomDetail.length.toFixed(1)}×${roomDetail.depth.toFixed(1)}`} label="Size" accent="structure" />
            <HudStat value={(roomDetail.room.top - roomDetail.room.base).toFixed(1)} unit="m" label="Ceiling" accent="structure" />
          </div>

          {(roomDetail.seats > 0 || roomDetail.fans > 0 || roomDetail.shelves > 0) && (
            <div className="flex flex-wrap gap-1.5 px-3 pb-3">
              {roomDetail.desks > 0 && (
                <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[10px] text-amber-200">
                  {roomDetail.desks} desks · {roomDetail.seats} seats
                </span>
              )}
              {roomDetail.drafting > 0 && (
                <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 font-mono text-[10px] text-amber-200">
                  {roomDetail.drafting} drafting tables
                </span>
              )}
              {roomDetail.shelves > 0 && (
                <span className="rounded border border-white/15 bg-white/5 px-2 py-1 font-mono text-[10px] text-slate-200">
                  {roomDetail.shelves} shelving bays
                </span>
              )}
              {roomDetail.fans > 0 && (
                <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 font-mono text-[10px] text-cyan-200">
                  {roomDetail.fans} fans
                </span>
              )}
              {roomDetail.tubes > 0 && (
                <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 font-mono text-[10px] text-cyan-200">
                  {roomDetail.tubes} light fittings
                </span>
              )}
            </div>
          )}

          <p className="border-t border-white/10 px-4 py-2 text-[10px] leading-snug text-slate-500">
            Identity from site photographs. Dimensions and fit-out are provisional until measured.
          </p>
        </HudPanel>
      )}

      {presenting && show && timeline && (
        <PresentationOverlay
          show={show}
          cueCount={timeline.length}
          elapsed={elapsed}
          total={totalDuration(timeline)}
          paused={presentPaused}
          onTogglePause={() => setPresentPaused((p) => !p)}
          onPrev={() => jumpCue(-1)}
          onNext={() => jumpCue(1)}
          onExit={stopPresentation}
          onFullscreen={() => rootRef.current?.requestFullscreen?.().catch(() => {})}
        />
      )}
    </div>
  );
}

function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The only chrome visible during a presentation: a caption card for the current
 * cue, a progress rail, and transport controls. Everything is keyboard-driven
 * too (space, arrows, Esc) so a presenter can stand away from the trackpad.
 */
function PresentationOverlay({
  show,
  cueCount,
  elapsed,
  total,
  paused,
  onTogglePause,
  onPrev,
  onNext,
  onExit,
  onFullscreen,
}: {
  show: ReturnType<typeof stateAt>;
  cueCount: number;
  elapsed: number;
  total: number;
  paused: boolean;
  onTogglePause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onExit: () => void;
  onFullscreen: () => void;
}) {
  const phase = (() => {
    const c = show.cue.choreography;
    if (show.cue.kind !== "building" || !c) return null;
    const t = show.cueTime;
    if (t < c.settle) return "Structural frame";
    if (t < c.settle + c.explodeUp + c.explodedHold) return "Exploded axonometric";
    if (t < c.settle + c.explodeUp + c.explodedHold + c.explodeDown) return "Reassembling";
    return "Section cut";
  })();

  return (
    <>
      {/* Caption. Keyed on the cue so the card re-animates in on every change. */}
      <div
        key={show.cue.id}
        className="pointer-events-none absolute bottom-16 left-8 max-w-xl animate-[fadeUp_600ms_ease-out]"
      >
        <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-red-400">
          <span className="h-px w-8 bg-red-400" />
          {show.cueIndex + 1} / {cueCount}
          {phase && <span className="ml-2 text-slate-300">· {phase}</span>}
        </div>
        <h2 className="text-4xl font-bold leading-tight text-white drop-shadow-lg md:text-5xl">
          {show.cue.title}
        </h2>
        <p className="mt-2 text-base text-slate-300 md:text-lg">{show.cue.subtitle}</p>
      </div>

      {/* Progress rail across the very bottom. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/10">
        <div
          className="h-full bg-red-500 transition-[width] duration-100 ease-linear"
          style={{ width: `${(Math.min(elapsed, total) / total) * 100}%` }}
        />
      </div>

      {/* Transport. Small and cornered so it never competes with the scene. */}
      <div className="absolute bottom-6 right-6 flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/80 p-1.5 shadow-2xl backdrop-blur">
        <button onClick={onPrev} title="Previous (Left arrow)" className="rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white">
          <SkipBack className="h-4 w-4" />
        </button>
        <button
          onClick={onTogglePause}
          title={paused ? "Play (space)" : "Pause (space)"}
          className="rounded-full bg-red-500 p-2.5 text-slate-950 hover:bg-red-400"
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
        <button onClick={onNext} title="Next (Right arrow)" className="rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white">
          <SkipForward className="h-4 w-4" />
        </button>
        <span className="mx-2 font-mono text-[11px] tabular-nums text-slate-400">
          {formatClock(elapsed)} / {formatClock(total)}
        </span>
        <button onClick={onFullscreen} title="Fullscreen" className="rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white">
          <Maximize2 className="h-4 w-4" />
        </button>
        <button onClick={onExit} title="Exit (Esc)" className="rounded-full p-2 text-slate-300 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }`}</style>
    </>
  );
}
