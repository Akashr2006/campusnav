"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Sky } from "@react-three/drei";
import { SceneEffects } from "./scene-effects";
import { Trees, makeFacadeTexture, makeGrassTexture, makeRoofTexture } from "./scene-content";
import type { Building3D, Campus3D, Vec2 } from "../lib/campus-3d";
import { defaultIsolatedStorey, frameFor, isolateStorey } from "../lib/building-structure";
import { BuildingFrameView, EXPLODE_GAP, type ViewMode } from "./building-frame";
import { DroneMesh, ThermalOverlay, useTerrain, type DroneLoadProgress } from "./drone-layers";
import { baseHeight, type Terrain } from "../lib/terrain";

/** Shape lives in the XY plane; extrusion runs along +Z and is stood up by a
 *  -90 degree rotation about X, so the shape is built with Z negated to keep
 *  north pointing the same way it does on the 2D map. */
function shapeFrom(outline: Vec2[]): THREE.Shape {
  const shape = new THREE.Shape();
  outline.forEach((p, i) => (i === 0 ? shape.moveTo(p.x, -p.z) : shape.lineTo(p.x, -p.z)));
  shape.closePath();
  return shape;
}

type Textures = { facade: THREE.Texture; roof: THREE.Texture; grass: THREE.Texture };

/** Procedural textures, built once per scene and disposed with it. */
function useTextures(): Textures {
  const tex = useMemo(
    () => ({ facade: makeFacadeTexture(), roof: makeRoofTexture(), grass: makeGrassTexture() }),
    []
  );
  useEffect(
    () => () => {
      tex.facade.dispose();
      tex.roof.dispose();
      tex.grass.dispose();
    },
    [tex]
  );
  return tex;
}

function BuildingMesh({
  building,
  selected,
  framed,
  onSelect,
  realistic,
  backgrounded,
  textures,
}: {
  building: Building3D;
  selected: boolean;
  /** True when the structural frame is drawn inside this block. */
  framed: boolean;
  onSelect: (id: string) => void;
  realistic: boolean;
  /** Another building is in focus: recede so this one does not block the view. */
  backgrounded: boolean;
  textures: Textures;
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.ExtrudeGeometry(shapeFrom(building.outline), {
      depth: building.heightMetres,
      bevelEnabled: true,
      // A small bevel catches the light along every roof edge, which is most of
      // what stops an extruded box reading as a flat sticker.
      bevelThickness: 0.25,
      bevelSize: 0.25,
      bevelSegments: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    return geo;
  }, [building]);

  // In realistic mode a framed building's massing box is replaced outright by
  // its modelled floor — a glass box around real walls reads as a display case.
  // Returned after the hook, so toggling modes never changes the hook order.
  if (realistic && framed) return null;

  // Realistic, opaque: ExtrudeGeometry puts its caps (roof, underside) in
  // material group 0 and the side walls in group 1, so a two-material array
  // gives the facade its window bands and the roof its membrane with no extra
  // geometry. The side UVs are in world metres, which is why one shared
  // texture fits every block at the right window pitch.
  if (realistic && !backgrounded) {
    return (
      <mesh
        geometry={geometry}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          onSelect(building.id);
        }}
      >
        <meshStandardMaterial attach="material-0" map={textures.roof} color="#ffffff" roughness={0.9} metalness={0.02} />
        <meshStandardMaterial
          attach="material-1"
          map={textures.facade}
          color={selected ? "#fff1e0" : "#ffffff"}
          emissive={selected ? "#c2410c" : "#000000"}
          emissiveIntensity={selected ? 0.12 : 0}
          roughness={0.85}
          metalness={0.03}
        />
      </mesh>
    );
  }

  return (
    <mesh
      geometry={geometry}
      castShadow
      receiveShadow
      onClick={(e) => {
        e.stopPropagation();
        onSelect(building.id);
      }}
    >
      <meshStandardMaterial
        // three.js only rebuilds a material's program when told to, so flipping
        // `transparent` on a live material can leave it drawing opaque. A new key
        // gives a fresh material whenever the blending state actually changes.
        key={framed || backgrounded ? "see-through" : "solid"}
        color={realistic ? "#d9d4ca" : selected ? "#63b3ed" : "#8fa3bf"}
        emissive={selected && !realistic ? "#1d4ed8" : "#000000"}
        emissiveIntensity={selected && !realistic ? 0.35 : 0}
        roughness={realistic ? 0.92 : 0.72}
        metalness={0.05}
        // The shell drops to a glassy envelope once the frame is visible, which
        // is the move the reference boards make: structure reads through it.
        // Neighbours recede the same way when another building is in focus, so a
        // block between the camera and the floor never hides the floor.
        transparent={framed || backgrounded}
        opacity={framed ? 0.12 : backgrounded ? 0.18 : 1}
        depthWrite={!framed && !backgrounded}
        side={framed ? THREE.BackSide : THREE.FrontSide}
      />
    </mesh>
  );
}

/** Ground: the traced campus perimeter, over a larger backing plane. */
function Ground({
  campus,
  realistic,
  grass,
  terrain,
}: {
  campus: Campus3D;
  realistic: boolean;
  grass: THREE.Texture;
  terrain: Terrain;
}) {
  const geometry = useMemo(() => {
    if (campus.boundary.length < 3) return null;
    const geo = new THREE.ShapeGeometry(shapeFrom(campus.boundary));
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, [campus.boundary]);

  const boundaryLine = useMemo(() => {
    if (campus.boundary.length < 3) return null;
    const pts = densify([...campus.boundary, campus.boundary[0]]).map(
      (p) => new THREE.Vector3(p.x, terrain.heightAt(p.x, p.z) + 0.15, p.z)
    );
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    return new THREE.Line(g, new THREE.LineBasicMaterial({ color: "#5b7fa6", transparent: true, opacity: 0.85 }));
  }, [campus.boundary, terrain]);
  useEffect(() => () => { boundaryLine?.geometry.dispose(); (boundaryLine?.material as THREE.Material | undefined)?.dispose(); }, [boundaryLine]);

  if (terrain.grid) {
    return (
      <group>
        <TerrainSurface terrain={terrain} realistic={realistic} grass={grass} />
        {realistic && boundaryLine && <primitive object={boundaryLine} />}
      </group>
    );
  }

  return (
    <group>
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[campus.centre.x, -0.4, campus.centre.z]}
        receiveShadow
      >
        <planeGeometry args={[campus.radius * 8, campus.radius * 8]} />
        <meshStandardMaterial color={realistic ? "#cfd6df" : "#1a2433"} map={realistic ? grass : null} roughness={1} />
      </mesh>
      {geometry && (
        <mesh geometry={geometry} position={[0, -0.05, 0]} receiveShadow>
          <meshStandardMaterial color={realistic ? "#f1f4f8" : "#7fa36f"} map={realistic ? grass : null} roughness={0.95} />
        </mesh>
      )}
      {/* A crisp boundary line: the campus reads as a defined site, not a
          fade between two greys. */}
      {realistic && boundaryLine && <primitive object={boundaryLine} />}
    </group>
  );
}

/** Points every `step` metres along a polyline, so draped lines follow the ground. */
function densify(pts: Vec2[], step = 5): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

/** The surveyed ground as a displaced grid, one vertex per terrain cell. */
function TerrainSurface({ terrain, realistic, grass }: { terrain: Terrain; realistic: boolean; grass: THREE.Texture }) {
  const geometry = useMemo(() => {
    const g = terrain.grid!;
    const w = g.cols * g.cell;
    const d = g.rows * g.cell;
    const geo = new THREE.PlaneGeometry(w, d, g.cols - 1, g.rows - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(g.originX + w / 2, 0, g.originZ + d / 2);
    const pos = geo.getAttribute("position");
    for (let i = 0; i < pos.count; i++) pos.setY(i, terrain.heightAt(pos.getX(i), pos.getZ(i)) - 0.05);
    // World-space UVs so the grass tiles at the same scale as on the flat ground.
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getX(i), -pos.getZ(i));
    geo.computeVertexNormals();
    return geo;
  }, [terrain]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial color={realistic ? "#f1f4f8" : "#1a2433"} map={realistic ? grass : null} roughness={0.95} />
    </mesh>
  );
}

/** Every edge in the graph, as a ribbon just above the ground. */
function Paths({ campus, terrain }: { campus: Campus3D; terrain: Terrain }) {
  const geometry = useMemo(() => {
    const width = 3;
    const positions: number[] = [];
    const normals: number[] = [];

    for (const e of campus.edges) {
      const dx = e.to.x - e.from.x;
      const dz = e.to.z - e.from.z;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) continue;

      // Segmented along its length so a long edge follows the slope, not a chord.
      const plane = new THREE.PlaneGeometry(len, width, Math.max(1, Math.ceil(len / 5)), 1);
      plane.rotateX(-Math.PI / 2);
      plane.rotateY(-Math.atan2(dz, dx));
      plane.translate((e.from.x + e.to.x) / 2, 0, (e.from.z + e.to.z) / 2);
      const p = plane.getAttribute("position");
      for (let i = 0; i < p.count; i++) p.setY(i, terrain.heightAt(p.getX(i), p.getZ(i)));

      // Flatten into one buffer so all edges cost a single draw call.
      const idx = plane.getIndex();
      const pos = plane.getAttribute("position");
      const nor = plane.getAttribute("normal");
      const order: number[] = idx
        ? Array.from(idx.array as ArrayLike<number>)
        : Array.from({ length: pos.count }, (_, i) => i);
      for (const i of order) {
        positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
        normals.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      }
      plane.dispose();
    }

    if (!positions.length) return null;
    const out = new THREE.BufferGeometry();
    out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    out.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    return out;
  }, [campus.edges, terrain]);

  if (!geometry) return null;
  return (
    <mesh geometry={geometry} position={[0, 0.12, 0]} receiveShadow>
      <meshStandardMaterial color="#6b7583" roughness={0.85} />
    </mesh>
  );
}

/** The active route: a raised glowing ribbon plus a marker that travels it. */
function Route({
  path,
  playing,
  onProgress,
  terrain,
}: {
  path: Vec2[];
  terrain: Terrain;
  playing: boolean;
  /** 0..1 along the route, reported at ~10 Hz so the HUD can track the walker. */
  onProgress?: (t: number) => void;
}) {
  const walker = useRef<THREE.Mesh>(null);
  const travelled = useRef(0);
  const lastReport = useRef(0);

  const curve = useMemo(() => {
    if (path.length < 2) return null;
    return new THREE.CatmullRomCurve3(
      densify(path, 8).map((p) => new THREE.Vector3(p.x, terrain.heightAt(p.x, p.z) + 2.2, p.z)),
      false,
      "catmullrom",
      0.08
    );
  }, [path, terrain]);

  const length = useMemo(() => (curve ? curve.getLength() : 0), [curve]);

  const tube = useMemo(
    () => (curve ? new THREE.TubeGeometry(curve, Math.max(32, path.length * 12), 3.2, 10, false) : null),
    [curve, path.length]
  );

  useFrame((_, delta) => {
    if (!curve || !walker.current || length === 0) return;
    if (playing) {
      // A brisk fly-through rather than literal walking pace, so a 600 m route
      // reads in a few seconds.
      travelled.current = (travelled.current + delta * 14) % length;
    }
    const t = Math.min(0.999, Math.max(0, travelled.current / length));
    const p = curve.getPointAt(t);
    walker.current.position.set(p.x, p.y + 1.4, p.z);
    // Throttled: a React state update per frame would re-render the HUD at 60 Hz.
    const now = performance.now();
    if (onProgress && now - lastReport.current > 100) {
      lastReport.current = now;
      onProgress(t);
    }
  });

  if (!curve || !tube) return null;
  return (
    <group>
      <mesh geometry={tube}>
        <meshStandardMaterial
          color="#2f7dff"
          emissive="#1d5cff"
          emissiveIntensity={1.6}
          roughness={0.3}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={walker} castShadow>
        <sphereGeometry args={[6, 24, 24]} />
        <meshStandardMaterial
          color="#fde68a"
          emissive="#f59e0b"
          emissiveIntensity={1.4}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}


/**
 * Eases the camera onto the building whose frame is showing, and back out to the
 * campus when nothing is selected.
 *
 * Without this the frame controls are unusable: a building 340 m off the campus
 * centre is about twenty pixels wide at the default camera distance, so exploding
 * it or cutting a section shows the user nothing. OrbitControls only ever dollies
 * toward its target, so reaching a building means moving the target itself.
 *
 * The move stops as soon as it is close enough, which hands control straight back
 * to the user — a permanently running lerp would fight every drag.
 */
function FocusCamera({
  focus,
  home,
  homeDistance,
}: {
  focus: { centre: Vec2; height: number; distance: number } | null;
  home: Vec2 & { y?: number };
  homeDistance: number;
}) {
  // `controls` is typed as a bare EventDispatcher; OrbitControls is what
  // `makeDefault` actually installs, so narrow to the part we drive.
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | undefined;
  const camera = useThree((s) => s.camera);
  const settled = useRef(false);

  // Re-arm whenever the destination changes, so each new selection flies once.
  const key = focus ? `${focus.centre.x},${focus.centre.z},${focus.distance}` : "home";
  useEffect(() => {
    settled.current = false;
  }, [key]);

  useFrame((_, delta) => {
    if (!controls || settled.current) return;

    const wantTarget = focus
      ? new THREE.Vector3(focus.centre.x, focus.height, focus.centre.z)
      : new THREE.Vector3(home.x, home.y ?? 0, home.z);
    const wantDistance = focus ? focus.distance : homeDistance;

    // Keep the user's current viewing angle; only the target and range change.
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(1, 1, 1);
    const wantPos = wantTarget.clone().add(dir.normalize().multiplyScalar(wantDistance));

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // Frame-rate independent easing, so the flight takes the same time on any device.
    const k = reduced ? 1 : 1 - Math.exp(-delta * 3.2);

    controls.target.lerp(wantTarget, k);
    camera.position.lerp(wantPos, k);
    controls.update();

    if (
      controls.target.distanceTo(wantTarget) < 0.5 &&
      camera.position.distanceTo(wantPos) < 0.5
    ) {
      settled.current = true;
    }
  });

  return null;
}

/**
 * Slow automatic orbit for presentation mode. Rotates the camera about the
 * controls target at a fixed angular rate; the first pointer-down hands control
 * to the user and the orbit stays off until the next cue re-enables it, so a
 * presenter can grab the view mid-shot without fighting the script.
 */
function AutoOrbit({ enabled, degreesPerSecond = 4 }: { enabled: boolean; degreesPerSecond?: number }) {
  const controls = useThree((s) => s.controls) as unknown as
    | { target: THREE.Vector3; update: () => void }
    | undefined;
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const grabbed = useRef(false);

  // Re-arm whenever a cue turns the orbit back on.
  useEffect(() => {
    grabbed.current = false;
  }, [enabled]);

  useEffect(() => {
    const el = gl.domElement;
    const grab = () => {
      grabbed.current = true;
    };
    el.addEventListener("pointerdown", grab);
    el.addEventListener("wheel", grab, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", grab);
      el.removeEventListener("wheel", grab);
    };
  }, [gl]);

  useFrame((_, delta) => {
    if (!enabled || grabbed.current || !controls) return;
    const angle = (degreesPerSecond * Math.PI) / 180 * delta;
    const offset = camera.position.clone().sub(controls.target);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    controls.update();
  });

  return null;
}

function SelectedLabel({
  campus,
  selectedId,
  framed,
  base,
}: {
  campus: Campus3D;
  base: (id: string) => number;
  selectedId: string | null;
  /** Suppressed when the frame is up: the structure panel carries the name, and
   *  `distanceFactor` is calibrated for the campus view, not a 140 m close-up. */
  framed: boolean;
}) {
  const selected = campus.buildings.find((b) => b.id === selectedId);
  if (!selected || framed) return null;
  return (
    <Html
      position={[selected.centre.x, base(selected.id) + selected.heightMetres + 8, selected.centre.z]}
      center
      distanceFactor={340}
      zIndexRange={[10, 0]}
    >
      <div className="pointer-events-none whitespace-nowrap rounded-full border border-sky-400/50 bg-slate-950/90 px-3 py-1 text-[13px] font-semibold text-sky-100 shadow-lg">
        {selected.name}
        <span className="ml-2 font-normal text-sky-300/80">
          {selected.storeys} {selected.storeys === 1 ? "floor" : "floors"}
        </span>
      </div>
    </Html>
  );
}

export function CampusScene({
  campus,
  routePath,
  playing,
  selectedId,
  onSelect,
  explode = 0,
  sectionCut = null,
  selectedFloorId = null,
  onSelectFloor = () => {},
  onFrameStats,
  autoOrbit = false,
  onRouteProgress,
  isolatedOrdinal,
  onIsolatableChange,
  selectedRoomId = null,
  onSelectRoom = () => {},
  mode = "DIAGRAM",
  droneMesh = false,
  thermal = false,
  onDroneProgress,
}: {
  campus: Campus3D;
  routePath: Vec2[];
  playing: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  explode?: number;
  sectionCut?: number | null;
  selectedFloorId?: string | null;
  onSelectFloor?: (id: string | null) => void;
  onFrameStats?: (
    s: {
      columns: number;
      beams: number;
      slabs: number;
      walls: number;
      rooms: number;
      cores: number;
    } | null
  ) => void;
  /** Presentation mode: slowly orbit the current target until the user grabs the view. */
  autoOrbit?: boolean;
  onRouteProgress?: (t: number) => void;
  /** Undefined lets the scene choose; null forces the whole stack. */
  isolatedOrdinal?: number | null;
  /** Reports which storeys exist and which one the scene would open on. */
  onIsolatableChange?: (info: { ordinals: number[]; suggested: number | null }) => void;
  selectedRoomId?: string | null;
  onSelectRoom?: (id: string | null) => void;
  mode?: ViewMode;
  /** Show the drone photogrammetry mesh in place of the procedural massing. */
  droneMesh?: boolean;
  /** Drape the AS & IB thermal orthomosaic over the ground. */
  thermal?: boolean;
  /** Tiles still streaming in, for the "loading sharp detail" indicator. */
  onDroneProgress?: (p: DroneLoadProgress) => void;
}) {
  const r = campus.radius;
  const c = campus.centre;
  const realistic = mode === "REALISTIC";
  const textures = useTextures();
  const terrain = useTerrain();

  // Each building is seated at the lowest surveyed ground under it; the whole
  // procedural model (massing, frame, label) rides on that one offset.
  const bases = useMemo(
    () => new Map(campus.buildings.map((b) => [b.id, baseHeight(terrain, b.outline)])),
    [campus.buildings, terrain]
  );
  const base = useCallback((id: string) => bases.get(id) ?? 0, [bases]);
  const homeY = terrain.heightAt(c.x, c.z);

  // Only the selected building is framed. Building every frame up front would
  // blow the triangle budget, and this memo drops the previous one the moment
  // the selection changes, so nothing is retained for a deselected block.
  const selected = selectedId ? campus.buildings.find((b) => b.id === selectedId) : null;
  const frame = useMemo(() => (selected ? frameFor(selected) : null), [selected]);

  // A building with exactly one surveyed storey opens on it: showing four floors
  // as equals would imply the other three are modelled too.
  const suggested = useMemo(() => (frame ? defaultIsolatedStorey(frame) : null), [frame]);
  const effectiveIsolated = isolatedOrdinal === undefined ? suggested : isolatedOrdinal;

  useEffect(() => {
    if (!frame) {
      onIsolatableChange?.({ ordinals: [], suggested: null });
      return;
    }
    onIsolatableChange?.({
      ordinals: frame.slabs.filter((s) => !s.isRoof).map((s) => s.ordinal),
      suggested,
    });
  }, [frame, suggested, onIsolatableChange]);

  useEffect(() => {
    if (!frame) return onFrameStats?.(null);
    onFrameStats?.(isolateStorey(frame, effectiveIsolated).stats);
  }, [frame, effectiveIsolated, onFrameStats]);

  // Only a framed building is worth flying to; a plain massing block reads fine
  // from the campus view, and moving for it would just be motion for its own sake.
  const focus = useMemo(() => {
    if (!frame || !selected) return null;
    const xs = selected.outline.map((p) => p.x);
    const zs = selected.outline.map((p) => p.z);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
    // Frame the isolated storey when there is one, not the whole stack.
    const shown = isolateStorey(frame, effectiveIsolated);
    const roof = shown.slabs[shown.slabs.length - 1].top;
    const floorBase = shown.slabs[0].top;
    // Enough back to hold the block plus the room an explode needs above it.
    return {
      centre: selected.centre,
      // Aim above the mid-height of what is shown: the stack grows upward under
      // explode, and re-aiming per slider tick would re-fly the camera on every
      // drag. One allowance keeps both states in frame.
      height:
        base(selected.id) + (floorBase + roof) / 2 + EXPLODE_GAP * shown.slabs.length * 0.25,
      distance: Math.max(90, span * 2.6 + EXPLODE_GAP * shown.slabs.length),
    };
  }, [frame, selected, effectiveIsolated, base]);

  // Shadow map coverage for the focused building, with room for its own shadow.
  const shadowSpan = focus ? Math.max(40, focus.distance * 0.55) : r;

  return (
    <Canvas
      // Percentage-closer soft shadows: penumbrae instead of hard stair-stepped edges.
      shadows="soft"
      dpr={[1, 2]}
      gl={{
        // Required before any material's clippingPlanes are honoured.
        localClippingEnabled: true,
        antialias: true,
        powerPreference: "high-performance",
        // The composer's ToneMapping pass owns the curve; the renderer must not
        // apply its own on top or highlights get compressed twice.
        toneMapping: THREE.NoToneMapping,
      }}
      camera={{
        position: [c.x + r * 0.7, r * 0.72, c.z + r * 0.95],
        fov: 45,
        near: 1,
        far: r * 16,
      }}
      onPointerMissed={() => onSelect(null)}
    >
      <color attach="background" args={[realistic ? "#e9eef4" : "#0b1120"]} />
      {/* Daylight dome for realistic mode; the sun sits where the key light is
          so the sky's bright quadrant and the shadows agree. */}
      {realistic && (
        <Sky
          distance={r * 30}
          sunPosition={[r * 0.75, r * 1.3, -r * 0.55]}
          turbidity={6}
          rayleigh={1.6}
          mieCoefficient={0.006}
          mieDirectionalG={0.85}
        />
      )}
      <SceneEffects realistic={realistic} photo={droneMesh} />
      <fog
        attach="fog"
        args={realistic ? ["#e9eef4", r * 1.3, r * 4.8] : ["#0b1120", r * 2.4, r * 6.5]}
      />

      {/* Key light casts the shadows that give the blocks their volume. In
          realistic mode it stands in for the sun, so it is warmer and softer and
          its shadow camera tightens onto the focused building — a campus-wide
          shadow map spread over 1.7 km has no resolution left for a desk. */}
      <directionalLight
        position={
          realistic && focus
            ? [focus.centre.x + 60, focus.height + 90, focus.centre.z - 45]
            : [c.x + r * 0.75, r * 1.3, c.z - r * 0.55]
        }
        color={realistic ? "#ffffff" : "#ffffff"}
        intensity={realistic ? 2.2 : 2.1}
        castShadow
        shadow-mapSize={[4096, 4096]}
        shadow-camera-left={realistic && focus ? -shadowSpan : -r * 1.3}
        shadow-camera-right={realistic && focus ? shadowSpan : r * 1.3}
        shadow-camera-top={realistic && focus ? shadowSpan : r * 1.3}
        shadow-camera-bottom={realistic && focus ? -shadowSpan : -r * 1.3}
        shadow-camera-far={realistic && focus ? shadowSpan * 8 : r * 5}
        shadow-bias={realistic ? -0.0002 : -0.0006}
      />
      <hemisphereLight
        args={realistic ? ["#e6f0fb", "#9aa4b0", 1.4] : ["#9dc4ff", "#1a2436", 1.0]}
      />
      <ambientLight intensity={realistic ? 0.7 : 0.3} />
      {/* Fill from the opposite side so unlit faces are readable, not black. */}
      <directionalLight
        position={[c.x - r, r * 0.6, c.z + r * 0.8]}
        intensity={realistic ? 0.7 : 0.55}
        color={realistic ? "#e8eef5" : "#7aa2d8"}
      />

      {!droneMesh && <Ground campus={campus} realistic={realistic} grass={textures.grass} terrain={terrain} />}
      {realistic && !droneMesh && <Trees campus={campus} terrain={terrain} />}
      <DroneMesh visible={droneMesh} thermal={thermal} onProgress={onDroneProgress} />
      <ThermalOverlay visible={thermal && !droneMesh} terrain={terrain} />
      <Paths campus={campus} terrain={terrain} />
      {campus.buildings.filter((b) => !droneMesh || (Boolean(frame) && b.id === selectedId)).map((b) => (
        <group key={b.id} position-y={base(b.id)}>
        <BuildingMesh
          building={b}
          selected={b.id === selectedId}
          framed={Boolean(frame) && b.id === selectedId}
          onSelect={onSelect}
          realistic={realistic}
          backgrounded={realistic && Boolean(frame) && b.id !== selectedId}
          textures={textures}
        />
        </group>
      ))}
      {frame && selected && (
        <group position-y={base(selected.id)}>
        <BuildingFrameView
          frame={frame}
          explode={explode}
          sectionCut={sectionCut}
          selectedFloorId={selectedFloorId}
          onSelectFloor={onSelectFloor}
          selectedRoomId={selectedRoomId}
          onSelectRoom={onSelectRoom}
          isolatedOrdinal={effectiveIsolated}
          mode={mode}
        />
        </group>
      )}
      <FocusCamera focus={focus} home={{ ...c, y: homeY }} homeDistance={r * 1.38} />
      <AutoOrbit enabled={autoOrbit} />
      <Route path={routePath} playing={playing} onProgress={onRouteProgress} terrain={terrain} />
      <SelectedLabel campus={campus} selectedId={selectedId} framed={Boolean(frame)} base={base} />

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={40}
        maxDistance={r * 3.5}
        // Stop the camera dropping under the ground plane.
        maxPolarAngle={Math.PI / 2.12}
        target={[c.x, homeY, c.z]}
      />
    </Canvas>
  );
}
