"use client";

/**
 * Phase 2: turns a scanned floor plan into structural geometry.
 *
 * Deliberately a workspace of its own rather than another mode on the campus CAD
 * canvas. Tracing a 60 m building needs the drawing filling the screen, and at
 * campus zoom a floor plan is a smudge a few pixels wide — the two jobs want
 * opposite amounts of zoom, so they get separate rooms.
 *
 * Georeferencing avoids asking anyone to type coordinates. The surveyors have
 * already traced every building's footprint, so the operator pins two points on
 * the drawing and says which *footprint corners* they are. Corners are the one
 * feature that is unambiguous on both a plan and a map, which takes the most
 * error-prone step in the pipeline and reduces it to two dropdowns.
 *
 * What gets saved, and what does not: the traced geometry (`columns`, `walls`,
 * `slabOutline`) and the `planTransform`, all of which are small. The raster is
 * NOT saved — the campus graph is a JSON snapshot passed around whole, and
 * inlining multi-megabyte scans into it would bloat every draft save and every
 * map load. The drawing is a tracing aid held in the browser for the session;
 * the geometry is the durable output. `planImageUrl` stays empty until there is
 * somewhere real to put files.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Columns3,
  Crosshair,
  Eraser,
  Hand,
  Image as ImageIcon,
  MousePointer2,
  Save,
  Scan,
  Square,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useToast } from "@/shared/components/ui/toast";
import { campusStore } from "@/shared/lib/campus-store";
import type { ColumnSpec, WallSpec } from "@/shared/data/campus";
import {
  checkPlanAgainstFootprint,
  metresToPlanPixel,
  planPixelToGps,
  planPixelToMetres,
  solvePlanTransform,
  type ControlPoint,
  type PlanTransform,
  type Px,
} from "@/lib/geo/plan-georeference";
import { gpsToMetres, type Vec2 } from "@/features/navigation-3d/lib/campus-3d";
import { gridAngleOf, toLocalFrame } from "@/features/navigation-3d/lib/building-structure";

type Tool = "PAN" | "PIN" | "COLUMN" | "WALL" | "OUTLINE" | "ERASE";
type WallType = NonNullable<WallSpec["type"]>;

/** A control pin: a plan pixel tied to a footprint corner index. */
type Pin = { px: Px; cornerIndex: number | null };

const TOOLS: { id: Tool; label: string; icon: typeof Hand; hint: string }[] = [
  { id: "PAN", label: "Pan", icon: Hand, hint: "Drag to move the drawing, scroll to zoom." },
  {
    id: "PIN",
    label: "Pin",
    icon: Crosshair,
    // Two corners along one wall beat two diagonal corners: a diagonal pair has
    // to agree with the footprint's aspect ratio as well as its size, and any
    // mismatch shows up as a small false rotation of the whole drawing.
    hint: "Click two points on the plan, then match each to a footprint corner. Two corners along the same wall give the truest result.",
  },
  { id: "COLUMN", label: "Column", icon: Columns3, hint: "Click each column centre." },
  { id: "WALL", label: "Wall", icon: MousePointer2, hint: "Click the start of a wall, then its end." },
  { id: "OUTLINE", label: "Slab edge", icon: Square, hint: "Click around the slab; click the first point again to close." },
  { id: "ERASE", label: "Erase", icon: Eraser, hint: "Click anything traced to remove it." },
];

export function FloorPlanTracer() {
  const { toast } = useToast();
  const [storeData, setStoreData] = useState(campusStore.getWorkingData());
  useEffect(() => campusStore.subscribe(() => setStoreData(campusStore.getWorkingData())), []);

  const [buildingId, setBuildingId] = useState<string>("");
  const [floorId, setFloorId] = useState<string>("");
  const [tool, setTool] = useState<Tool>("PAN");
  const [wallType, setWallType] = useState<WallType>("PARTITION");

  // The raster, held only for this session.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);

  const [pins, setPins] = useState<Pin[]>([]);
  // Traced geometry, in plan pixels until saved.
  const [columnPx, setColumnPx] = useState<Px[]>([]);
  const [wallPx, setWallPx] = useState<{ from: Px; to: Px; type: WallType }[]>([]);
  const [wallStart, setWallStart] = useState<Px | null>(null);
  const [outlinePx, setOutlinePx] = useState<Px[]>([]);

  // Viewport: plan pixels -> screen.
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);

  const buildings = useMemo(
    () => [...storeData.buildings].sort((a, b) => a.name.localeCompare(b.name)),
    [storeData.buildings]
  );
  const building = buildings.find((b) => b.id === buildingId) ?? null;
  const floors = useMemo(
    () =>
      storeData.floors
        .filter((f) => f.buildingId === buildingId)
        .sort((a, b) => a.ordinal - b.ordinal),
    [storeData.floors, buildingId]
  );
  const floor = floors.find((f) => f.id === floorId) ?? null;

  /** Footprint corners, the anchors the operator matches pins against. */
  const footprint = useMemo(() => building?.footprint ?? [], [building]);

  /** Centroid and grid angle, needed to store geometry in the building's frame. */
  const frame = useMemo(() => {
    if (footprint.length < 3) return null;
    const pts: Vec2[] = footprint.map((p) => gpsToMetres(p.lat, p.lng));
    const centre = {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      z: pts.reduce((s, p) => s + p.z, 0) / pts.length,
    };
    return { pts, centre, angleRad: gridAngleOf(pts) };
  }, [footprint]);

  /**
   * Fresh pins win; otherwise a floor that has been georeferenced before keeps
   * its stored transform. Without the fallback, coming back to correct one wall
   * would mean re-pinning the whole drawing — and re-pinning by hand moves the
   * transform slightly, which would shift every column already traced.
   */
  const transform: PlanTransform | null = useMemo(() => {
    const ready = pins.filter((p) => p.cornerIndex !== null);
    if (ready.length >= 2 && footprint.length >= 3) {
      const [a, b] = ready;
      const toControl = (p: Pin): ControlPoint => ({
        px: p.px,
        gps: footprint[p.cornerIndex as number],
      });
      const solvedResult = solvePlanTransform(toControl(a), toControl(b));
      if (solvedResult.ok) return solvedResult.transform;
    }
    return floor?.planTransform ?? null;
  }, [pins, footprint, floor]);

  /** True when the transform came off the floor rather than the pins on screen. */
  const transformIsStored =
    Boolean(floor?.planTransform) && pins.filter((p) => p.cornerIndex !== null).length < 2;

  const solveError = useMemo(() => {
    const ready = pins.filter((p) => p.cornerIndex !== null);
    if (ready.length < 2 || footprint.length < 3) return null;
    const [a, b] = ready;
    const r = solvePlanTransform(
      { px: a.px, gps: footprint[a.cornerIndex as number] },
      { px: b.px, gps: footprint[b.cornerIndex as number] }
    );
    return r.ok ? null : r.error;
  }, [pins, footprint]);

  const warnings = useMemo(() => {
    if (!transform || !imageSize) return [];
    return checkPlanAgainstFootprint(transform, imageSize, footprint);
  }, [transform, imageSize, footprint]);

  /* ------------------------------------------------------------ load a plan */

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ type: "error", title: "Not an image", description: "Pick a PNG or JPEG scan of the floor plan." });
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setImageUrl(url);
      // Fit the drawing to the canvas on load, so it is never off-screen.
      const c = canvasRef.current;
      if (c) {
        const fit = Math.min(c.width / img.naturalWidth, c.height / img.naturalHeight) * 0.9;
        setView({
          zoom: fit,
          panX: (c.width - img.naturalWidth * fit) / 2,
          panY: (c.height - img.naturalHeight * fit) / 2,
        });
      }
    };
    img.onerror = () => toast({ type: "error", title: "Could not read that image" });
    img.src = url;
  };

  // Loading a drawing means georeferencing is the next job, so land on the Pin
  // tool. Done as an effect rather than inside the image's onload callback: the
  // load races the floor-selection effect, and whichever commits second wins.
  useEffect(() => {
    if (imageUrl) setTool("PIN");
  }, [imageUrl]);

  useEffect(() => {
    // Object URLs are a leak if the component unmounts holding one.
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  /* --------------------------------------------------- existing floor geometry */

  // Load whatever is already traced, so a floor can be revisited and corrected.
  useEffect(() => {
    setPins([]);
    setWallStart(null);
    if (!floor || !frame) {
      setColumnPx([]);
      setWallPx([]);
      setOutlinePx([]);
      return;
    }
    const t = floor.planTransform;
    if (!t) {
      setColumnPx([]);
      setWallPx([]);
      setOutlinePx([]);
      return;
    }
    const toPx = (local: Vec2) => {
      const world = {
        x: frame.centre.x + local.x * Math.cos(frame.angleRad) - local.z * Math.sin(frame.angleRad),
        z: frame.centre.z + local.x * Math.sin(frame.angleRad) + local.z * Math.cos(frame.angleRad),
      };
      return metresToPlanPixel(world, t);
    };
    setColumnPx((floor.columns ?? []).map((c) => toPx({ x: c.x, z: c.z })));
    setWallPx(
      (floor.walls ?? []).map((w) => ({
        from: toPx(w.from),
        to: toPx(w.to),
        type: (w.type ?? "PARTITION") as WallType,
      }))
    );
    setOutlinePx(
      (floor.slabOutline ?? []).map((p) => metresToPlanPixel(gpsToMetres(p.lat, p.lng), t))
    );
  }, [floorId, floor, frame]);

  /* -------------------------------------------------------------- rendering */

  const draw = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#0e1424";
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.setTransform(view.zoom, 0, 0, view.zoom, view.panX, view.panY);

    if (imgRef.current && imageSize) {
      ctx.drawImage(imgRef.current, 0, 0);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth = 1 / view.zoom;
      ctx.strokeRect(0, 0, imageSize.width, imageSize.height);
    }

    const px = (n: number) => n / view.zoom;

    // Slab outline.
    if (outlinePx.length) {
      ctx.beginPath();
      outlinePx.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      if (outlinePx.length > 2) ctx.closePath();
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = px(2.5);
      ctx.stroke();
      ctx.fillStyle = "rgba(56,189,248,0.10)";
      if (outlinePx.length > 2) ctx.fill();
      for (const p of outlinePx) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, px(4), 0, Math.PI * 2);
        ctx.fillStyle = "#38bdf8";
        ctx.fill();
      }
    }

    // Walls.
    for (const w of wallPx) {
      ctx.beginPath();
      ctx.moveTo(w.from.x, w.from.y);
      ctx.lineTo(w.to.x, w.to.y);
      ctx.strokeStyle =
        w.type === "STRUCTURAL" ? "#f8fafc" : w.type === "GLAZING" ? "#7dd3fc" : "#cbd5e1";
      ctx.lineWidth = px(w.type === "STRUCTURAL" ? 5 : 3);
      ctx.stroke();
    }
    if (wallStart) {
      ctx.beginPath();
      ctx.arc(wallStart.x, wallStart.y, px(5), 0, Math.PI * 2);
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = px(2);
      ctx.stroke();
    }

    // Columns.
    for (const p of columnPx) {
      const half = px(5);
      ctx.fillStyle = "#be1f2a";
      ctx.fillRect(p.x - half, p.y - half, half * 2, half * 2);
      ctx.strokeStyle = "#fecaca";
      ctx.lineWidth = px(1);
      ctx.strokeRect(p.x - half, p.y - half, half * 2, half * 2);
    }

    // Control pins, drawn last so they are never hidden.
    pins.forEach((pin, i) => {
      ctx.beginPath();
      ctx.arc(pin.px.x, pin.px.y, px(9), 0, Math.PI * 2);
      ctx.strokeStyle = pin.cornerIndex === null ? "#fbbf24" : "#22c55e";
      ctx.lineWidth = px(2.5);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pin.px.x - px(13), pin.px.y);
      ctx.lineTo(pin.px.x + px(13), pin.px.y);
      ctx.moveTo(pin.px.x, pin.px.y - px(13));
      ctx.lineTo(pin.px.x, pin.px.y + px(13));
      ctx.stroke();
      ctx.fillStyle = pin.cornerIndex === null ? "#fbbf24" : "#22c55e";
      ctx.font = `${px(13)}px ui-monospace, monospace`;
      ctx.fillText(String.fromCharCode(65 + i), pin.px.x + px(14), pin.px.y - px(10));
    });
  }, [view, imageSize, pins, columnPx, wallPx, wallStart, outlinePx]);

  useEffect(() => {
    draw();
  }, [draw]);

  // Keep the backing store matched to the element's real size.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const r = c.getBoundingClientRect();
      c.width = Math.max(320, Math.floor(r.width));
      c.height = Math.max(320, Math.floor(r.height));
      draw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw]);

  /* ---------------------------------------------------------------- input */

  const toPlanPx = (e: React.MouseEvent): Px => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * c.width) / r.width;
    const sy = ((e.clientY - r.top) * c.height) / r.height;
    return { x: (sx - view.panX) / view.zoom, y: (sy - view.panY) / view.zoom };
  };

  const near = (a: Px, b: Px, tolerance = 12) =>
    Math.hypot(a.x - b.x, a.y - b.y) * view.zoom < tolerance;

  const onCanvasClick = (e: React.MouseEvent) => {
    if (!imageUrl) return;
    const p = toPlanPx(e);

    if (tool === "PIN") {
      setPins((prev) => (prev.length >= 2 ? [{ px: p, cornerIndex: null }] : [...prev, { px: p, cornerIndex: null }]));
      return;
    }
    if (tool === "COLUMN") {
      setColumnPx((prev) => [...prev, p]);
      return;
    }
    if (tool === "WALL") {
      if (!wallStart) setWallStart(p);
      else {
        setWallPx((prev) => [...prev, { from: wallStart, to: p, type: wallType }]);
        setWallStart(null);
      }
      return;
    }
    if (tool === "OUTLINE") {
      // Clicking the first point again closes the ring.
      if (outlinePx.length >= 3 && near(p, outlinePx[0])) {
        setTool("PAN");
        toast({ type: "success", title: "Slab outline closed" });
        return;
      }
      setOutlinePx((prev) => [...prev, p]);
      return;
    }
    if (tool === "ERASE") {
      const ci = columnPx.findIndex((c) => near(p, c));
      if (ci >= 0) return setColumnPx((prev) => prev.filter((_, i) => i !== ci));
      const oi = outlinePx.findIndex((o) => near(p, o));
      if (oi >= 0) return setOutlinePx((prev) => prev.filter((_, i) => i !== oi));
      const wi = wallPx.findIndex((w) => {
        // Distance from the click to the wall segment.
        const dx = w.to.x - w.from.x;
        const dy = w.to.y - w.from.y;
        const len2 = dx * dx + dy * dy;
        if (len2 < 1e-6) return near(p, w.from);
        const t = Math.max(0, Math.min(1, ((p.x - w.from.x) * dx + (p.y - w.from.y) * dy) / len2));
        return near(p, { x: w.from.x + t * dx, y: w.from.y + t * dy });
      });
      if (wi >= 0) return setWallPx((prev) => prev.filter((_, i) => i !== wi));
      const pi = pins.findIndex((pin) => near(p, pin.px, 16));
      if (pi >= 0) setPins((prev) => prev.filter((_, i) => i !== pi));
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * c.width) / r.width;
    const sy = ((e.clientY - r.top) * c.height) / r.height;
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const zoom = Math.min(40, Math.max(0.02, v.zoom * factor));
      // Zoom about the cursor, so the point under it stays put.
      return {
        zoom,
        panX: sx - ((sx - v.panX) * zoom) / v.zoom,
        panY: sy - ((sy - v.panY) * zoom) / v.zoom,
      };
    });
  };

  /* ----------------------------------------------------------------- save */

  const canSave = Boolean(floor && transform && frame);

  const onSave = () => {
    if (!floor || !transform || !frame) return;

    const toLocal = (p: Px) => {
      const world = planPixelToMetres(p, transform);
      return toLocalFrame(world, frame.centre, frame.angleRad);
    };

    const columns: ColumnSpec[] = columnPx.map((p) => {
      const l = toLocal(p);
      return { x: round(l.x), z: round(l.z) };
    });
    const walls: WallSpec[] = wallPx.map((w) => {
      const a = toLocal(w.from);
      const b = toLocal(w.to);
      return {
        from: { x: round(a.x), z: round(a.z) },
        to: { x: round(b.x), z: round(b.z) },
        type: w.type,
      };
    });
    const slabOutline =
      outlinePx.length >= 3 ? outlinePx.map((p) => planPixelToGps(p, transform)) : undefined;

    campusStore.updateFloor(floor.id, {
      planTransform: {
        originLat: transform.originLat,
        originLng: transform.originLng,
        scale: transform.scale,
        rotation: transform.rotation,
      },
      columns: columns.length ? columns : undefined,
      walls: walls.length ? walls : undefined,
      slabOutline,
    });

    toast({
      type: "success",
      title: `Saved ${floor.name}`,
      description: `${plural(columns.length, "column")}, ${plural(walls.length, "wall")}${slabOutline ? ", slab outline" : ""}. Publish to push it live.`,
    });
  };

  const clearTracing = () => {
    setColumnPx([]);
    setWallPx([]);
    setOutlinePx([]);
    setWallStart(null);
  };

  /* ------------------------------------------------------------------ view */

  const activeHint = TOOLS.find((t) => t.id === tool)?.hint ?? "";
  const pinsReady = pins.filter((p) => p.cornerIndex !== null).length;

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* ---- controls ---- */}
      <div className="flex flex-col gap-4">
        <section className="rounded-xl border bg-[rgb(var(--card))] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
            1 · Choose the floor
          </h3>
          <label htmlFor="fpt-building" className="mb-1 block text-xs font-medium">
            Building
          </label>
          <select
            id="fpt-building"
            value={buildingId}
            onChange={(e) => {
              setBuildingId(e.target.value);
              setFloorId("");
            }}
            className="mb-3 w-full rounded-lg border bg-[rgb(var(--bg))] px-2 py-1.5 text-sm"
          >
            <option value="">Select a building…</option>
            {buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.shortCode ? `(${b.shortCode})` : ""}
              </option>
            ))}
          </select>

          <label htmlFor="fpt-floor" className="mb-1 block text-xs font-medium">
            Floor
          </label>
          <select
            id="fpt-floor"
            value={floorId}
            onChange={(e) => setFloorId(e.target.value)}
            disabled={!buildingId}
            className="w-full rounded-lg border bg-[rgb(var(--bg))] px-2 py-1.5 text-sm disabled:opacity-50"
          >
            <option value="">Select a floor…</option>
            {floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.columns?.length || f.walls?.length ? " ✓ traced" : ""}
              </option>
            ))}
          </select>

          {building && footprint.length < 3 && (
            <p className="mt-3 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              This building has no traced footprint, so there are no corners to pin against. Draw its
              footprint in the CAD editor first.
            </p>
          )}
        </section>

        <section className="rounded-xl border bg-[rgb(var(--card))] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
            2 · Load the drawing
          </h3>
          <label
            htmlFor="fpt-file"
            className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs font-medium hover:border-[rgb(var(--primary))]"
          >
            <ImageIcon className="h-4 w-4" />
            {imageUrl ? "Replace drawing" : "Choose a plan scan"}
          </label>
          <input
            id="fpt-file"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          {imageSize && (
            <p className="mt-2 font-mono text-[11px] text-[rgb(var(--muted-fg))]">
              {imageSize.width} × {imageSize.height} px
            </p>
          )}
          <p className="mt-2 text-[11px] leading-relaxed text-[rgb(var(--muted-fg))]">
            The drawing stays in your browser — only the traced geometry is saved.
          </p>
        </section>

        <section className="rounded-xl border bg-[rgb(var(--card))] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
            3 · Pin it to the map
          </h3>
          {pins.length === 0 && transformIsStored && (
            <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-300">
              This floor is already aligned — {(floor!.planTransform!.scale * 100).toFixed(2)} cm/px
              at {floor!.planTransform!.rotation.toFixed(2)}°. Trace straight away, or re-pin if you
              have loaded a different drawing.
            </p>
          )}
          {pins.length === 0 && !transformIsStored && (
            <p className="text-xs text-[rgb(var(--muted-fg))]">
              Pick the <strong>Pin</strong> tool and click two points on the drawing, then say
              which footprint corner each one is. <strong>Two corners along the same wall</strong>{" "}
              give the truest result — the further apart, the better.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {pins.map((pin, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-4 font-mono text-xs font-semibold text-[rgb(var(--primary))]">
                  {String.fromCharCode(65 + i)}
                </span>
                <select
                  aria-label={`Footprint corner for pin ${String.fromCharCode(65 + i)}`}
                  value={pin.cornerIndex ?? ""}
                  onChange={(e) =>
                    setPins((prev) =>
                      prev.map((p, j) =>
                        j === i
                          ? { ...p, cornerIndex: e.target.value === "" ? null : Number(e.target.value) }
                          : p
                      )
                    )
                  }
                  className="flex-1 rounded-lg border bg-[rgb(var(--bg))] px-2 py-1 text-xs"
                >
                  <option value="">Which corner?</option>
                  {footprint.map((_, ci) => (
                    <option key={ci} value={ci} disabled={pins.some((q, qj) => qj !== i && q.cornerIndex === ci)}>
                      Corner {ci + 1}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {solveError && (
            <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300">
              {solveError}
            </p>
          )}

          {transform && (
            <dl className="mt-3 grid grid-cols-2 gap-1 border-t pt-3 font-mono text-[11px]">
              <dt className="text-[rgb(var(--muted-fg))]">Scale</dt>
              <dd className="text-right">{(transform.scale * 100).toFixed(2)} cm/px</dd>
              <dt className="text-[rgb(var(--muted-fg))]">Rotation</dt>
              <dd className="text-right">{transform.rotation.toFixed(2)}°</dd>
              {imageSize && (
                <>
                  <dt className="text-[rgb(var(--muted-fg))]">Plan width</dt>
                  <dd className="text-right">{(imageSize.width * transform.scale).toFixed(1)} m</dd>
                </>
              )}
            </dl>
          )}

          {warnings.map((w) => (
            <p
              key={w}
              className="mt-2 flex gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-300"
            >
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {w}
            </p>
          ))}
        </section>

        <section className="rounded-xl border bg-[rgb(var(--card))] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[rgb(var(--muted-fg))]">
            4 · Trace
          </h3>
          <div className="grid grid-cols-3 gap-1.5">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setTool(t.id);
                  setWallStart(null);
                }}
                disabled={!imageUrl || (t.id !== "PAN" && t.id !== "PIN" && !transform)}
                title={t.hint}
                className={`flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-[10px] font-medium transition disabled:opacity-40 ${
                  tool === t.id
                    ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary))]/15 text-[rgb(var(--primary))]"
                    : "hover:border-[rgb(var(--primary))]/50"
                }`}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>

          {tool === "WALL" && (
            <div className="mt-3">
              <span className="mb-1 block text-xs font-medium">Wall type</span>
              <div className="flex gap-1">
                {(["STRUCTURAL", "PARTITION", "GLAZING"] as WallType[]).map((wt) => (
                  <button
                    key={wt}
                    onClick={() => setWallType(wt)}
                    className={`flex-1 rounded border px-1.5 py-1 text-[10px] font-medium capitalize ${
                      wallType === wt
                        ? "border-[rgb(var(--primary))] bg-[rgb(var(--primary))]/15"
                        : ""
                    }`}
                  >
                    {wt.toLowerCase()}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-[rgb(var(--muted-fg))]">{activeHint}</p>

          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-3 font-mono text-[11px]">
            <dt className="text-[rgb(var(--muted-fg))]">Columns</dt>
            <dd className="text-right">{columnPx.length}</dd>
            <dt className="text-[rgb(var(--muted-fg))]">Walls</dt>
            <dd className="text-right">{wallPx.length}</dd>
            <dt className="text-[rgb(var(--muted-fg))]">Slab points</dt>
            <dd className="text-right">{outlinePx.length}</dd>
          </dl>
        </section>

        <div className="flex gap-2">
          <Button size="sm" onClick={onSave} disabled={!canSave} className="flex-1">
            <Save className="mr-1.5 h-4 w-4" />
            Save to floor
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={clearTracing}
            disabled={!columnPx.length && !wallPx.length && !outlinePx.length}
            title="Clear traced geometry (does not touch the saved floor until you save)"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {!canSave && floorId && (
          <p className="text-[11px] text-[rgb(var(--muted-fg))]">
            Pin both points to a footprint corner before saving.
          </p>
        )}
        {transformIsStored && (
          <p className="text-[11px] text-[rgb(var(--muted-fg))]">
            Using this floor&apos;s saved alignment. Re-pin only if the drawing has changed.
          </p>
        )}
      </div>

      {/* ---- canvas ---- */}
      <div className="relative min-h-[60vh] overflow-hidden rounded-xl border bg-[#0e1424]">
        <canvas
          ref={canvasRef}
          className={`h-full w-full ${tool === "PAN" ? "cursor-grab" : "cursor-crosshair"}`}
          onClick={onCanvasClick}
          onWheel={onWheel}
          onMouseDown={(e) => {
            if (tool !== "PAN") return;
            dragRef.current = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
          }}
          onMouseMove={(e) => {
            const d = dragRef.current;
            if (!d) return;
            setView((v) => ({ ...v, panX: d.panX + (e.clientX - d.x), panY: d.panY + (e.clientY - d.y) }));
          }}
          onMouseUp={() => (dragRef.current = null)}
          onMouseLeave={() => (dragRef.current = null)}
        />
        {!imageUrl && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-sm text-slate-400">
            <Scan className="h-10 w-10 opacity-40" />
            <div>
              <p className="font-medium text-slate-300">No drawing loaded</p>
              <p className="mt-1 text-xs">
                Pick a building and floor, then choose a plan scan to trace over.
              </p>
            </div>
          </div>
        )}
        {imageUrl && (
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-white/10 bg-slate-950/85 px-3 py-2 font-mono text-[11px] text-slate-300">
            {transformIsStored ? "using saved alignment" : `${pinsReady}/2 pins matched`} · zoom{" "}
            {(view.zoom * 100).toFixed(0)}%
            {transform && <span className="ml-2 text-emerald-400">georeferenced</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Millimetre precision is plenty, and keeps the saved snapshot small. */
function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
