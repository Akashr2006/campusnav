"use client";

/**
 * Renders a `BuildingFrame` — the drawing-board look from the reference boards:
 * crimson structure standing inside pale slabs.
 *
 * Three things keep this inside the performance budget from the roadmap:
 *  - Columns and beams are `InstancedMesh`, so a 350-column building is two
 *    draw calls rather than 350.
 *  - Slabs and cores stay individual meshes, because there are only ever a
 *    handful and they need their own click targets and clipping.
 *  - Every geometry built in a `useMemo` is disposed on unmount, so deselecting
 *    a building actually frees its frame instead of leaking it.
 *
 * The explode and section-cut are why the frame is generated rather than
 * imported: exploding is a per-storey Y offset, and the section cut is a pair of
 * clipping planes handed to the materials. Neither needs new geometry.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";
import { isolateStorey, type BuildingFrame, type Slab } from "../lib/building-structure";
import { buildFloorInterior, EMPTY_INTERIOR, INTERIOR } from "../lib/floor-interior";
import { FloorInteriorView } from "./floor-interior-view";

/** Two ways to read the same model. */
export type ViewMode = "DIAGRAM" | "REALISTIC";
import type { Vec2 } from "../lib/campus-3d";

/** Crimson structure, pale fabric — the palette of the reference boards. */
const COLOURS = {
  slab: "#e9e6e2",
  slabRoof: "#d6d2cd",
  slabSelected: "#ffffff",
  column: "#be1f2a",
  beam: "#9c1922",
  roomClassroom: "#cfe3f2",
  roomLab: "#d9ecdc",
  roomDrawing: "#f2e6cf",
  roomWashroom: "#e6dcef",
  roomCorridor: "#e4e2df",
  roomOther: "#dedad5",
  wallStructural: "#cfc9c2",
  wallPartition: "#b9b2aa",
  wallGlazing: "#8fb4c9",
  stair: "#7d8794",
  lift: "#c05621",
  service: "#5a6472",
};

/** Metres of separation per storey at full explode. */
export const EXPLODE_GAP = 9;

function shapeFrom(outline: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  outline.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  shape.closePath();
  return shape;
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/** Storey offset under explode. Index 0 (or the basement) stays put. */
function offsetFor(index: number, explode: number) {
  return index * EXPLODE_GAP * explode;
}

/* ------------------------------------------------------------------- slabs */

function Slabs({
  frame,
  explode,
  clippingPlanes,
  selectedFloorId,
  onSelectFloor,
  mode,
}: {
  frame: BuildingFrame;
  explode: number;
  clippingPlanes: THREE.Plane[];
  selectedFloorId: string | null;
  onSelectFloor: (id: string | null) => void;
  mode: ViewMode;
}) {
  const geometries = useMemo(
    () =>
      frame.slabs.map((s) => {
        const geo = new THREE.ExtrudeGeometry(shapeFrom(s.outline), {
          depth: s.thickness,
          bevelEnabled: false,
        });
        geo.rotateX(-Math.PI / 2);
        geo.computeVertexNormals();
        return geo;
      }),
    [frame]
  );

  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);

  return (
    <group>
      {frame.slabs.map((s, i) => {
        // On one isolated storey in realistic mode the upper slab is a ceiling,
        // and a ceiling is exactly what stops you seeing the rooms. So it lifts
        // *and* dissolves: one slider drags the lid off and takes it away.
        const isCeiling = mode === "REALISTIC" && frame.slabs.length === 2 && i === 1;
        const ceilingOpacity = isCeiling ? 1 - clamp01((explode - 0.05) / 0.35) : 1;
        if (isCeiling && ceilingOpacity <= 0.01) return null;
        return (
        <mesh
          key={s.floorId}
          geometry={geometries[i]}
          // ExtrudeGeometry grows downward after the -90 rotation, so placing it
          // at `top` hangs the slab below the walking surface, as built.
          position={[0, s.top + offsetFor(i, explode), 0]}
          castShadow
          receiveShadow
          onClick={(e) => {
            e.stopPropagation();
            onSelectFloor(selectedFloorId === s.floorId ? null : s.floorId);
          }}
        >
          <meshStandardMaterial
            // Fresh material when blending changes; see BuildingMesh for why.
            key={isCeiling && ceilingOpacity < 0.999 ? "fading" : "solid"}
            color={
              selectedFloorId === s.floorId
                ? COLOURS.slabSelected
                : mode === "REALISTIC"
                  ? s.isRoof
                    ? INTERIOR.ceiling
                    : INTERIOR.floorCement
                  : s.isRoof
                    ? COLOURS.slabRoof
                    : COLOURS.slab
            }
            roughness={0.82}
            metalness={0.02}
            transparent={isCeiling && ceilingOpacity < 0.999}
            opacity={ceilingOpacity}
            depthWrite={!isCeiling || ceilingOpacity > 0.95}
            clippingPlanes={clippingPlanes}
            clipShadows
            side={THREE.DoubleSide}
          />
        </mesh>
        );
      })}
    </group>
  );
}

/* ----------------------------------------------------------------- columns */

function Columns({
  frame,
  explode,
  clippingPlanes,
  mode,
}: {
  frame: BuildingFrame;
  explode: number;
  clippingPlanes: THREE.Plane[];
  mode: ViewMode;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  /** Which slab each column sits on, so it explodes with its own storey. */
  const storeyIndex = useMemo(() => {
    const tops = frame.slabs.map((s) => s.top);
    return frame.columns.map((c) => {
      let best = 0;
      let bestDelta = Infinity;
      tops.forEach((t, i) => {
        const d = Math.abs(t - c.base);
        if (d < bestDelta) {
          bestDelta = d;
          best = i;
        }
      });
      return best;
    });
  }, [frame]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -frame.angleRad
    );
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    frame.columns.forEach((c, i) => {
      const h = Math.max(0.05, c.top - c.base);
      const dy = offsetFor(storeyIndex[i], explode);
      pos.set(c.x, c.base + h / 2 + dy, c.z);
      scale.set(c.width, h, c.depth);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = frame.columns.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [frame, explode, storeyIndex]);

  if (!frame.columns.length) return null;

  return (
    <instancedMesh
      ref={ref}
      // Unit box scaled per instance, so one geometry serves every column.
      args={[undefined, undefined, frame.columns.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={mode === "REALISTIC" ? INTERIOR.concrete : COLOURS.column}
        roughness={0.55}
        metalness={0.08}
        clippingPlanes={clippingPlanes}
        clipShadows
      />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------- beams */

function Beams({
  frame,
  explode,
  clippingPlanes,
  mode,
}: {
  frame: BuildingFrame;
  explode: number;
  clippingPlanes: THREE.Plane[];
  mode: ViewMode;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  /** A beam belongs to the slab it supports, i.e. the one just above it. */
  const storeyIndex = useMemo(() => {
    const tops = frame.slabs.map((s) => s.top);
    return frame.beams.map((b) => {
      let best = 0;
      let bestDelta = Infinity;
      tops.forEach((t, i) => {
        const d = Math.abs(t - b.y);
        if (d < bestDelta) {
          bestDelta = d;
          best = i;
        }
      });
      return best;
    });
  }, [frame]);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    frame.beams.forEach((b, i) => {
      const dx = b.to.x - b.from.x;
      const dz = b.to.z - b.from.z;
      const len = Math.hypot(dx, dz);
      const dy = offsetFor(storeyIndex[i], explode);
      pos.set((b.from.x + b.to.x) / 2, b.y + dy, (b.from.z + b.to.z) / 2);
      // The unit box runs along X, so yaw it onto the beam's own direction.
      q.setFromAxisAngle(up, -Math.atan2(dz, dx));
      scale.set(Math.max(0.05, len), b.depth, b.width);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = frame.beams.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [frame, explode, storeyIndex]);

  if (!frame.beams.length) return null;
  // The beams carry the ceiling. When the ceiling lifts off a single storey in
  // realistic mode they leave with it, rather than hanging over the open floor
  // as a grid of concrete floating in mid-air.
  if (mode === "REALISTIC" && frame.slabs.length === 2 && explode > 0.3) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, frame.beams.length]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={mode === "REALISTIC" ? INTERIOR.concrete : COLOURS.beam}
        roughness={0.6}
        metalness={0.08}
        clippingPlanes={clippingPlanes}
        clipShadows
      />
    </instancedMesh>
  );
}


/* ------------------------------------------------------------------- walls */

/**
 * Traced walls, instanced. Glazing renders translucent so a section cut still
 * reads through it — a solid pane would hide the very structure the cut exposes.
 */
function Walls({
  frame,
  explode,
  clippingPlanes,
}: {
  frame: BuildingFrame;
  explode: number;
  clippingPlanes: THREE.Plane[];
}) {
  // One instanced mesh per wall type, since each needs its own material.
  const groups = useMemo(() => {
    const byType = new Map<string, typeof frame.walls>();
    for (const w of frame.walls) {
      const list = byType.get(w.type) ?? [];
      list.push(w);
      byType.set(w.type, list);
    }
    const storeyOf = (y: number) => {
      let best = 0;
      let bestDelta = Infinity;
      frame.slabs.forEach((s, i) => {
        const d = Math.abs(s.top - y);
        if (d < bestDelta) {
          bestDelta = d;
          best = i;
        }
      });
      return best;
    };
    return [...byType.entries()].map(([type, list]) => ({
      type,
      walls: list,
      storeyIndex: list.map((w) => storeyOf(w.base)),
    }));
  }, [frame]);

  if (!frame.walls.length) return null;

  return (
    <group>
      {groups.map((g) => (
        <WallGroup
          key={g.type}
          type={g.type}
          walls={g.walls}
          storeyIndex={g.storeyIndex}
          explode={explode}
          clippingPlanes={clippingPlanes}
        />
      ))}
    </group>
  );
}

function WallGroup({
  type,
  walls,
  storeyIndex,
  explode,
  clippingPlanes,
}: {
  type: string;
  walls: BuildingFrame["walls"];
  storeyIndex: number[];
  explode: number;
  clippingPlanes: THREE.Plane[];
}) {
  const ref = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    walls.forEach((w, i) => {
      const len = Math.hypot(w.to.x - w.from.x, w.to.z - w.from.z);
      const h = Math.max(0.05, w.top - w.base);
      const dy = offsetFor(storeyIndex[i], explode);
      pos.set((w.from.x + w.to.x) / 2, w.base + h / 2 + dy, (w.from.z + w.to.z) / 2);
      q.setFromAxisAngle(up, -w.angleRad);
      scale.set(len, h, w.thickness);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = walls.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [walls, storeyIndex, explode]);

  const glazing = type === "GLAZING";
  const colour =
    type === "STRUCTURAL"
      ? COLOURS.wallStructural
      : glazing
        ? COLOURS.wallGlazing
        : COLOURS.wallPartition;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, walls.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={colour}
        roughness={glazing ? 0.18 : 0.88}
        metalness={glazing ? 0.1 : 0.02}
        transparent={glazing}
        opacity={glazing ? 0.35 : 1}
        clippingPlanes={clippingPlanes}
        clipShadows
      />
    </instancedMesh>
  );
}


/* ------------------------------------------------------------------- rooms */

const ROOM_COLOUR: Record<string, string> = {
  CLASSROOM: COLOURS.roomClassroom,
  LAB: COLOURS.roomLab,
  DRAWING_HALL: COLOURS.roomDrawing,
  WASHROOM: COLOURS.roomWashroom,
  CORRIDOR: COLOURS.roomCorridor,
};

/**
 * Enclosed spaces, extruded to their ceiling and labelled with their code.
 *
 * Rooms are individual meshes rather than instanced: there are only ever a few
 * dozen per storey, each needs its own polygon, and each is a click target that
 * has to resolve back to a room record — that is the point of drawing them.
 */
function Rooms({
  frame,
  explode,
  clippingPlanes,
  selectedRoomId,
  onSelectRoom,
  showLabels,
  mode,
}: {
  frame: BuildingFrame;
  explode: number;
  clippingPlanes: THREE.Plane[];
  selectedRoomId: string | null;
  onSelectRoom: (id: string | null) => void;
  showLabels: boolean;
  mode: ViewMode;
}) {
  const built = useMemo(
    () =>
      frame.rooms.map((r) => {
        const geo = new THREE.ExtrudeGeometry(shapeFrom(r.outline), {
          depth: Math.max(0.1, r.top - r.base),
          bevelEnabled: false,
        });
        geo.rotateX(-Math.PI / 2);
        geo.computeVertexNormals();
        const storeyIndex = Math.max(
          0,
          frame.slabs.findIndex((s) => Math.abs(s.top - r.base) < 1e-6)
        );
        return { room: r, geo, storeyIndex };
      }),
    [frame]
  );

  useEffect(() => () => built.forEach((b) => b.geo.dispose()), [built]);

  if (!frame.rooms.length) return null;

  return (
    <group>
      {built.map(({ room, geo, storeyIndex }) => {
        const dy = offsetFor(storeyIndex, explode);
        const selected = selectedRoomId === room.id;
        return (
          <group key={room.id}>
            <mesh
              geometry={geo}
              // The extrusion grows downward once stood up, so it is placed at
              // the ceiling to sit between floor and soffit.
              position={[0, room.top + dy, 0]}
              castShadow
              receiveShadow
              onClick={(e) => {
                e.stopPropagation();
                onSelectRoom(selected ? null : room.id);
              }}
            >
              <meshStandardMaterial
                color={selected ? "#ffffff" : (ROOM_COLOUR[room.category] ?? COLOURS.roomOther)}
                roughness={0.9}
                // Translucent by default: a solid room would hide the frame and
                // every room behind it, which is the opposite of an explode view.
                transparent
                opacity={
                  mode === "REALISTIC" ? (selected ? 0.22 : 0) : selected ? 0.78 : 0.4
                }
                visible={mode !== "REALISTIC" || selected}
                depthWrite={mode === "DIAGRAM" && selected}
                clippingPlanes={clippingPlanes}
                clipShadows
                side={THREE.DoubleSide}
              />
            </mesh>
            {showLabels && (
              <Html
                position={[room.centre.x, room.base + dy + (room.top - room.base) * 0.55, room.centre.z]}
                center
                zIndexRange={[10, 0]}
              >
                <button
                  onClick={() => onSelectRoom(selected ? null : room.id)}
                  className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-medium transition ${
                    selected
                      ? "border-white bg-white text-slate-900"
                      : "border-slate-400/50 bg-slate-950/80 text-slate-100 hover:border-white"
                  }`}
                >
                  {room.code ? <span className="font-mono">{room.code}</span> : room.name}
                  {selected && (
                    <span className="ml-1 opacity-70">
                      {room.name !== room.code && room.code ? `${room.name} · ` : ""}
                      {room.areaM2.toFixed(0)} m²
                    </span>
                  )}
                </button>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ------------------------------------------------------------------- cores */

function Cores({
  frame,
  explode,
  clippingPlanes,
}: {
  frame: BuildingFrame;
  explode: number;
  clippingPlanes: THREE.Plane[];
}) {
  // A shaft runs the full height of the building, but under explode every
  // storey lifts by a different amount. Drawing it as one box left the stairs
  // standing still while the floors pulled apart around them, so the shaft is
  // cut at each slab and every piece rides with its own storey.
  const segments = useMemo(() => {
    const tops = frame.slabs.map((s) => s.top);
    const out: { key: string; core: (typeof frame.cores)[number]; base: number; top: number; storeyIndex: number }[] = [];
    for (const c of frame.cores) {
      const cuts = [c.base, ...tops.filter((t) => t > c.base + 1e-6 && t < c.top - 1e-6), c.top];
      for (let i = 0; i < cuts.length - 1; i++) {
        const base = cuts[i];
        const top = cuts[i + 1];
        if (top - base < 0.05) continue;
        let storeyIndex = 0;
        let bestDelta = Infinity;
        tops.forEach((t, k) => {
          const d = Math.abs(t - base);
          if (d < bestDelta) {
            bestDelta = d;
            storeyIndex = k;
          }
        });
        out.push({ key: `${c.id}:${i}`, core: c, base, top, storeyIndex });
      }
    }
    return out;
  }, [frame]);

  return (
    <group>
      {segments.map(({ key, core: c, base, top, storeyIndex }) => {
        const h = Math.max(0.1, top - base);
        const colour =
          c.kind === "STAIR" ? COLOURS.stair : c.kind === "LIFT" ? COLOURS.lift : COLOURS.service;
        return (
          <mesh
            key={key}
            position={[c.centre.x, base + h / 2 + offsetFor(storeyIndex, explode), c.centre.z]}
            rotation={[0, -c.angleRad, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[c.width, h, c.depth]} />
            <meshStandardMaterial
              color={colour}
              roughness={0.7}
              transparent
              opacity={0.55}
              clippingPlanes={clippingPlanes}
              clipShadows
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* --------------------------------------------------------- storey datum tags */

/** Floor labels beside the stack, the way a section drawing annotates levels. */
function StoreyTags({
  frame,
  explode,
  onSelectFloor,
  selectedFloorId,
}: {
  frame: BuildingFrame;
  explode: number;
  onSelectFloor: (id: string | null) => void;
  selectedFloorId: string | null;
}) {
  // Tags only earn their place once the stack is pulled apart.
  if (explode < 0.15) return null;
  const edge = Math.max(...frame.slabs[0].outline.map((p) => p.x));

  return (
    <group>
      {frame.slabs.map((s, i) => (
        <Html
          key={s.floorId}
          position={[edge + 6, s.top + offsetFor(i, explode) + 1.2, frame.slabs[0].outline[0].z]}
          center
          zIndexRange={[10, 0]}
          style={{ opacity: Math.min(1, (explode - 0.15) / 0.25) }}
        >
          <button
            onClick={() => onSelectFloor(selectedFloorId === s.floorId ? null : s.floorId)}
            className={`whitespace-nowrap rounded border px-2 py-0.5 font-mono text-[11px] transition ${
              selectedFloorId === s.floorId
                ? "border-white bg-white text-slate-900"
                : "border-red-400/60 bg-slate-950/85 text-red-200 hover:border-red-300"
            }`}
          >
            {s.name}
            <span className="ml-1.5 opacity-60">
              {s.top >= 0 ? "+" : ""}
              {s.top.toFixed(2)} m
            </span>
          </button>
        </Html>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------- root */

export function BuildingFrameView({
  frame: fullFrame,
  explode,
  sectionCut,
  selectedFloorId,
  onSelectFloor,
  selectedRoomId = null,
  onSelectRoom = () => {},
  showRoomLabels = true,
  isolatedOrdinal = null,
  mode = "DIAGRAM",
}: {
  frame: BuildingFrame;
  /** 0 = assembled, 1 = fully exploded. */
  explode: number;
  /** Fraction across the building to cut at, or null for no cut. */
  sectionCut: number | null;
  selectedFloorId: string | null;
  onSelectFloor: (id: string | null) => void;
  selectedRoomId?: string | null;
  onSelectRoom?: (id: string | null) => void;
  showRoomLabels?: boolean;
  /** Show only this storey. Null shows the whole stack. */
  isolatedOrdinal?: number | null;
  mode?: ViewMode;
}) {
  // Narrowing here rather than in every sub-component means the explode offsets
  // re-index off the isolated storey, so explode lifts its ceiling instead of
  // spreading four floors the user did not ask to see.
  const frame = useMemo(() => isolateStorey(fullFrame, isolatedOrdinal), [fullFrame, isolatedOrdinal]);

  // An interior only makes sense for one isolated storey, and only in the mode
  // that draws it — building 300 desks nobody will see is wasted geometry.
  const interior = useMemo(
    () =>
      mode === "REALISTIC" && isolatedOrdinal !== null ? buildFloorInterior(frame) : EMPTY_INTERIOR,
    [frame, mode, isolatedOrdinal]
  );
  /** One plane, positioned along the building's own long axis. */
  const clippingPlanes = useMemo(() => {
    if (sectionCut === null) return [];
    const pts = frame.slabs[0]?.outline ?? [];
    if (!pts.length) return [];
    const minZ = Math.min(...pts.map((p) => p.z));
    const maxZ = Math.max(...pts.map((p) => p.z));
    const at = minZ + (maxZ - minZ) * sectionCut;
    // Keep the half nearer the camera's default south-east position.
    return [new THREE.Plane(new THREE.Vector3(0, 0, -1), at)];
  }, [frame, sectionCut]);

  return (
    <group>
      <Slabs
        frame={frame}
        explode={explode}
        clippingPlanes={clippingPlanes}
        selectedFloorId={selectedFloorId}
        onSelectFloor={onSelectFloor}
        mode={mode}
      />
      <Columns frame={frame} explode={explode} clippingPlanes={clippingPlanes} mode={mode} />
      <Beams frame={frame} explode={explode} clippingPlanes={clippingPlanes} mode={mode} />
      <Walls frame={frame} explode={explode} clippingPlanes={clippingPlanes} />
      <Rooms
        frame={frame}
        explode={explode}
        clippingPlanes={clippingPlanes}
        selectedRoomId={selectedRoomId}
        onSelectRoom={onSelectRoom}
        showLabels={showRoomLabels}
        mode={mode}
      />
      {interior.walls.length > 0 && (
        <FloorInteriorView
          interior={interior}
          clippingPlanes={clippingPlanes}
          ceilingLifted={explode > 0.05}
          explode={explode}
        />
      )}
      <Cores frame={frame} explode={explode} clippingPlanes={clippingPlanes} />
      <StoreyTags
        frame={frame}
        explode={explode}
        onSelectFloor={onSelectFloor}
        selectedFloorId={selectedFloorId}
      />
    </group>
  );
}

export type { Slab };
