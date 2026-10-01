"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Line } from "@react-three/drei";
import { EnvironmentControls, TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin, TilesFadePlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { CircleStop, Compass, Hand, Maximize2, Minus, Orbit, PersonStanding, Plus, Rotate3d, RotateCcw, RotateCw, Square } from "lucide-react";
import { MAP_ORIGIN } from "@/lib/geo/projection";
import { TILESET_URL, useTerrain } from "@/features/navigation-3d/components/drone-layers";
import type { Campus3D, Vec2 } from "@/features/navigation-3d/lib/campus-3d";
import type { Terrain } from "@/features/navigation-3d/lib/terrain";
import type { MapFeature } from "./campus-2d-map";

/**
 * The /navigate 3D tab: the drone survey mesh, explored like a map.
 *
 * Built beside the 3D studio (features/navigation-3d, which stays untouched)
 * rather than through its CampusScene, because the tab needs things that scene
 * is not built for:
 *  - Navigation anywhere on campus with the mouse or fingers: drag moves the
 *    ground under the pointer, the wheel zooms to the point under the pointer,
 *    right-drag (two fingers, or left-drag in rotate mode) turns a full 360
 *    degrees around it and tilts from straight down to level with the ground,
 *    double-click flies closer. 3d-tiles-renderer's EnvironmentControls do this
 *    against the mesh itself. Arrow keys turn and tilt, +/- zoom.
 *  - Every building from every side: top, north, east, south, west and street
 *    level views framing it roof to ground, and a 360 degree turn round it.
 *  - Sharper detail without a slower first picture: the view loads at the
 *    renderer's usual error target, then, once nothing is left to load, halves
 *    it until one screen pixel (measured: overview buildings go from blurred
 *    blobs to distinct roofs, for ~3x the bytes, fetched after the view is up).
 *  - Picking: click a building for its place card; choose one in the sidebar
 *    and the camera flies to it. Nothing opens into the exploded frame.
 */

export type DroneViewProgress = { pending: number; loaded: number; sharpening: boolean };

type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

type FlightOptions = {
  /** Swing round this point (keeping the distance to it smooth) instead of moving in a straight line. */
  around?: THREE.Vector3;
  /** Called when the flight lands (not if the user takes over first). */
  then?: () => void;
};

/** Shared between the scene parts and the overlay buttons. */
type ViewerApi = {
  world: THREE.Group;
  tiles: TilesRenderer | null;
  controls: EnvironmentControls | null;
  flyTo: (pose: Pose, seconds?: number, options?: FlightOptions) => void;
  /** Turn a full circle round `pivot`, or stop turning (null). */
  spin: (pivot: THREE.Vector3 | null) => void;
  /** Back to the fast error target, e.g. before flying somewhere new. */
  resetDetail: () => void;
  /** performance.now() of the last camera movement (user input, coasting or a flight). */
  lastMove: number;
  /** Left-drag turns the view (instead of moving it). Mouse only. */
  rotateMode: boolean;
};

type DroneAlignment = { dx: number; dz: number; groundHeight: number; rotationDeg: number };

/** Screen-space error the first picture loads at, in drawing-buffer pixels (DroneMesh's value). */
const BASE_ERROR_TARGET = 4;
/** Nothing loading for this long before the detail is stepped up. */
const SHARPEN_AFTER_MS = 350;
/** A movement must last this long before the view drops to the fast target. */
const MOTION_GRACE_MS = 300;
/** Tiles parsed at once at rest (the renderer's default). */
const PARSE_JOBS = 5;
const FADE_MS = 250;

/** ECEF -> scene (X east, Y up, Z south), as DroneMesh places the mesh. */
function ecefToScene(a: DroneAlignment): THREE.Matrix4 {
  const enu = new THREE.Matrix4();
  WGS84_ELLIPSOID.getEastNorthUpFrame(THREE.MathUtils.degToRad(MAP_ORIGIN.lat), THREE.MathUtils.degToRad(MAP_ORIGIN.lng), 0, enu);
  const toEnu = enu.invert();
  const axes = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const shift = new THREE.Matrix4().makeTranslation(a.dx, -a.groundHeight, a.dz);
  const spin = new THREE.Matrix4().makeRotationY(-THREE.MathUtils.degToRad(a.rotationDeg));
  return spin.multiply(shift).multiply(axes).multiply(toEnu);
}

type TileStats = { queued: number; downloading: number; parsing: number; loaded: number };

/** The finest error target this device should sharpen to, in drawing-buffer pixels. */
function finestErrorTarget(pixelRatio: number): number {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  // Data Saver, or a phone with little memory: stay at the fast target.
  if (nav.connection?.saveData || (nav.deviceMemory !== undefined && nav.deviceMemory <= 3)) return BASE_ERROR_TARGET;
  // One CSS pixel: phones (pixel ratio 2) stop at 2, desktop monitors at 1.
  return Math.min(BASE_ERROR_TARGET, Math.max(1, pixelRatio));
}

function DroneTiles({
  api,
  onProgress,
}: {
  api: React.MutableRefObject<ViewerApi>;
  onProgress?: (p: DroneViewProgress) => void;
}) {
  const { camera, gl } = useThree();
  const [alignment, setAlignment] = useState<DroneAlignment | null>(null);
  const [tiles, setTiles] = useState<TilesRenderer | null>(null);
  const fade = useRef<TilesFadePlugin | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/drone/mesh-alignment.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((a) => live && setAlignment(a))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!alignment) return;
    const t = new TilesRenderer(TILESET_URL);
    const draco = new DRACOLoader().setDecoderPath("/draco/");
    // Start the decoder now rather than when the first tile arrives.
    draco.preload();
    t.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    // Sharper tiles fade in over the coarser ones instead of popping.
    fade.current = new TilesFadePlugin({ fadeDuration: FADE_MS });
    t.registerPlugin(fade.current);
    t.errorTarget = BASE_ERROR_TARGET;
    // Only what is on screen, nearest first (see DroneMesh and public/drone/README.md).
    t.loadAncestors = false;
    t.loadSiblings = false;
    const mobile = window.matchMedia("(pointer: coarse)").matches;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    t.lruCache.maxSize = mobile ? 1200 : 4000;
    t.lruCache.maxBytesSize = mobile ? 4e8 : memory >= 8 ? 2e9 : 1.2e9;
    t.group.matrixAutoUpdate = false;
    t.group.matrix.copy(ecefToScene(alignment));
    t.group.matrixWorldNeedsUpdate = true;
    const anisotropy = gl.capabilities.getMaxAnisotropy();
    const onLoad = ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          // With the v2 mesh's mipmaps this keeps photos crisp at grazing angles.
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map) {
            map.anisotropy = anisotropy;
            map.needsUpdate = true;
          }
        }
      });
    };
    t.addEventListener("load-model", onLoad);
    t.setCamera(camera);
    const viewer = api.current;
    viewer.world.add(t.group);
    viewer.tiles = t;
    setTiles(t);
    return () => {
      t.removeEventListener("load-model", onLoad);
      viewer.world.remove(t.group);
      if (viewer.tiles === t) viewer.tiles = null;
      // The parse queue is the renderer's shared default; leave it as found.
      t.parseQueue.maxJobs = PARSE_JOBS;
      t.dispose();
      draco.dispose();
      fade.current = null;
      setTiles(null);
    };
  }, [alignment, api, camera, gl]);

  const finest = useMemo(() => finestErrorTarget(gl.getPixelRatio()), [gl]);
  const idleSince = useRef<number | null>(null);
  const lastReport = useRef({ at: 0, key: "" });
  const buffer = useMemo(() => new THREE.Vector2(), []);
  /** The sharp target to return to once the camera stops. */
  const sharpTarget = useRef<number | null>(null);
  /** When the current camera movement began, if it is moving. */
  const motionSince = useRef<number | null>(null);

  useEffect(() => {
    api.current.resetDetail = () => {
      if (api.current.tiles) api.current.tiles.errorTarget = BASE_ERROR_TARGET;
      sharpTarget.current = null;
      idleSince.current = null;
    };
  }, [api]);

  useFrame(() => {
    if (!tiles) return;
    const now = performance.now();
    const moving = now - api.current.lastMove < 200;
    motionSince.current = moving ? motionSince.current ?? now : null;

    // While the camera moves, loading sharp tiles is what costs frames: on a
    // CPU slowed like a low-end phone, a drag ran at ~20 fps sharp against ~45 at
    // the fast target (tools/drone/profile-3d-view.mjs), drawing them costs
    // nothing. So a sustained movement drops to the fast target (the old 3D
    // view's detail), and the sharp one comes back about a second after it stops.
    // Short nudges and single wheel ticks keep the sharp view.
    if (moving && now - (motionSince.current ?? now) > MOTION_GRACE_MS && tiles.errorTarget < BASE_ERROR_TARGET) {
      sharpTarget.current = tiles.errorTarget;
      tiles.errorTarget = BASE_ERROR_TARGET;
    } else if (!moving && sharpTarget.current !== null) {
      tiles.errorTarget = sharpTarget.current;
      sharpTarget.current = null;
    }
    // One tile parsed at a time while moving (each one is main-thread work), and
    // no fading while tiles swap quickly (it shows as grain); both back at rest.
    tiles.parseQueue.maxJobs = moving ? 1 : PARSE_JOBS;
    // `fadeDuration` is a setter at runtime but missing from the plugin's typings.
    if (fade.current) (fade.current as unknown as { fadeDuration: number }).fadeDuration = moving ? 0 : FADE_MS;

    gl.getDrawingBufferSize(buffer);
    tiles.setResolution(camera, buffer.x, buffer.y);
    camera.updateMatrixWorld();
    tiles.update();

    const s = (tiles as unknown as { stats: TileStats }).stats;
    const pending = s.queued + s.downloading + s.parsing;
    const ready = Boolean(tiles.root) && tiles.visibleTiles.size > 0;
    const sharpening = tiles.errorTarget < BASE_ERROR_TARGET && pending > 0;
    if (pending === 0 && ready && !moving) {
      idleSince.current ??= now;
      const cache = tiles.lruCache as unknown as { cachedBytes: number; maxBytesSize: number };
      const room = cache.cachedBytes < 0.7 * cache.maxBytesSize;
      if (now - idleSince.current > SHARPEN_AFTER_MS && tiles.errorTarget > finest && room) {
        tiles.errorTarget = Math.max(finest, tiles.errorTarget / 2);
        idleSince.current = null;
      }
    } else {
      idleSince.current = null;
    }
    // A few times a second is plenty for a counter, and keeps React out of the frame loop.
    const key = `${pending}/${sharpening}`;
    if (onProgress && key !== lastReport.current.key && now - lastReport.current.at > 300) {
      onProgress({ pending, loaded: s.loaded, sharpening });
      lastReport.current = { at: now, key };
    }
  });

  return null;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function poseLookingAt(position: THREE.Vector3, target: THREE.Vector3): THREE.Quaternion {
  const m = new THREE.Matrix4().lookAt(position, target, new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

const UP = new THREE.Vector3(0, 1, 0);
/** One full turn in this many seconds when spinning round a building. */
const SPIN_SECONDS = 18;

/** Spherical position of p round a centre: distance, compass angle and elevation. */
function sphericalOf(p: THREE.Vector3, centre: THREE.Vector3) {
  const o = p.clone().sub(centre);
  const r = Math.max(1e-6, o.length());
  return { r, az: Math.atan2(o.x, o.z), el: Math.asin(THREE.MathUtils.clamp(o.y / r, -1, 1)) };
}
function fromSpherical(centre: THREE.Vector3, r: number, az: number, el: number) {
  return new THREE.Vector3(centre.x + Math.sin(az) * Math.cos(el) * r, centre.y + Math.sin(el) * r, centre.z + Math.cos(az) * Math.cos(el) * r);
}

/** Mouse and touch navigation over the mesh, plus scripted flights and spins. */
function Navigation({
  api,
  home,
  maxDistance,
  groundY,
  onSpinChange,
}: {
  api: React.MutableRefObject<ViewerApi>;
  home: Pose;
  maxDistance: number;
  groundY: number;
  onSpinChange: (spinning: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const flight = useRef<{
    from: THREE.Vector3;
    to: THREE.Vector3;
    fromQ: THREE.Quaternion;
    toQ: THREE.Quaternion;
    arc: number;
    t: number;
    seconds: number;
    /** Swinging round a point: start and end in spherical terms, and the look-at target's path. */
    around?: { centre: THREE.Vector3; a: ReturnType<typeof sphericalOf>; b: ReturnType<typeof sphericalOf>; fromTarget: THREE.Vector3; toTarget: THREE.Vector3 };
    then?: () => void;
  } | null>(null);
  const spin = useRef<{ pivot: THREE.Vector3; left: number } | null>(null);

  useEffect(() => {
    camera.position.copy(home.position);
    camera.quaternion.copy(poseLookingAt(home.position, home.target));
    camera.updateMatrixWorld();
    // Only the first pose: later changes to `home` must not yank the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  useEffect(() => {
    const viewer = api.current;
    const controls = new EnvironmentControls(viewer.world, camera, gl.domElement);
    controls.enableDamping = true;
    // Close enough to read a facade, never inside a roof or a tree.
    controls.minDistance = 8;
    controls.cameraRadius = 3;
    controls.maxDistance = maxDistance;
    // Every angle, all the way round: straight down on the roofs (0) to level
    // with the ground and a little up at the walls (100 deg from straight down).
    // Up close at street level the survey is at its weakest (it was flown
    // mostly straight down), but every building can be seen from every side.
    controls.minAltitude = 0;
    controls.maxAltitude = THREE.MathUtils.degToRad(100);
    // Off the mesh (beyond the survey edge) the ground plane still catches the pointer.
    controls.fallbackPlane.set(new THREE.Vector3(0, 1, 0), -groundY);
    // Rotate mode: the left button turns the view as the right one does, so a
    // one-button mouse or trackpad can go all the way round a building.
    const tracker = (controls as unknown as {
      pointerTracker: { buttons: number; pointerType: string | null; isRightClicked: () => boolean };
    }).pointerTracker;
    const isRight = tracker.isRightClicked.bind(tracker);
    tracker.isRightClicked = () => isRight() || (viewer.rotateMode && tracker.pointerType === "mouse" && (tracker.buttons & 1) === 1);
    viewer.controls = controls;
    const moved = () => {
      viewer.lastMove = performance.now();
    };
    controls.addEventListener("change", moved);
    // Any input takes over from a flight or a spin.
    const takeOver = () => {
      if (spin.current) viewer.spin(null);
      if (!flight.current) return;
      flight.current = null;
      controls.enabled = true;
    };
    gl.domElement.addEventListener("pointerdown", takeOver);
    gl.domElement.addEventListener("wheel", takeOver, { passive: true });
    return () => {
      gl.domElement.removeEventListener("pointerdown", takeOver);
      gl.domElement.removeEventListener("wheel", takeOver);
      controls.removeEventListener("change", moved);
      tracker.isRightClicked = isRight;
      controls.dispose();
      if (viewer.controls === controls) viewer.controls = null;
    };
  }, [api, camera, gl, maxDistance, groundY]);

  useEffect(() => {
    const viewer = api.current;
    viewer.flyTo = (pose, seconds = 1.4, options = {}) => {
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      const from = camera.position.clone();
      const distance = from.distanceTo(pose.position);
      let around: NonNullable<typeof flight.current>["around"];
      if (options.around) {
        // Where the camera looks now, at the same distance as the point it swings round.
        const r = from.distanceTo(options.around);
        const fromTarget = from.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).multiplyScalar(r));
        around = { centre: options.around, a: sphericalOf(from, options.around), b: sphericalOf(pose.position, options.around), fromTarget, toTarget: pose.target.clone() };
        // The short way round.
        let dAz = around.b.az - around.a.az;
        dAz = Math.atan2(Math.sin(dAz), Math.cos(dAz));
        around.b.az = around.a.az + dAz;
      }
      flight.current = {
        from,
        to: pose.position.clone(),
        fromQ: camera.quaternion.clone(),
        toQ: poseLookingAt(pose.position, pose.target),
        // Long hops rise a little on the way, so the view does not skim the roofs.
        arc: around ? 0 : Math.min(180, distance * 0.18),
        t: 0,
        seconds: reduced ? 0.001 : around ? seconds : Math.min(2.2, Math.max(0.6, seconds * (0.6 + distance / 900))),
        around,
        then: options.then,
      };
      if (viewer.controls) viewer.controls.enabled = false;
    };
    viewer.spin = (pivot) => {
      if (!pivot) {
        if (!spin.current) return;
        spin.current = null;
        if (viewer.controls) viewer.controls.enabled = true;
        onSpinChange(false);
        return;
      }
      spin.current = { pivot: pivot.clone(), left: Math.PI * 2 };
      if (viewer.controls) viewer.controls.enabled = false;
      onSpinChange(true);
    };
  }, [api, camera, onSpinChange]);

  const turn = useMemo(() => new THREE.Quaternion(), []);
  const look = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, delta) => {
    const f = flight.current;
    if (f) {
      f.t = Math.min(1, f.t + delta / f.seconds);
      const e = easeInOut(f.t);
      if (f.around) {
        const { centre, a, b } = f.around;
        camera.position.copy(fromSpherical(centre, a.r + (b.r - a.r) * e, a.az + (b.az - a.az) * e, a.el + (b.el - a.el) * e));
        look.lerpVectors(f.around.fromTarget, f.around.toTarget, e);
        camera.quaternion.copy(poseLookingAt(camera.position, look));
      } else {
        camera.position.lerpVectors(f.from, f.to, e);
        camera.position.y += Math.sin(Math.PI * e) * f.arc;
        camera.quaternion.slerpQuaternions(f.fromQ, f.toQ, e);
      }
      camera.updateMatrixWorld();
      api.current.lastMove = performance.now();
      if (f.t >= 1) {
        flight.current = null;
        if (api.current.controls) api.current.controls.enabled = true;
        f.then?.();
      }
      return;
    }
    const s = spin.current;
    if (s) {
      // A steady turn round the vertical through the pivot: position and view
      // direction turn together, so the building stays where it is on screen.
      const step = Math.min(s.left, ((Math.PI * 2) / SPIN_SECONDS) * Math.min(delta, 0.1));
      turn.setFromAxisAngle(UP, step);
      camera.position.sub(s.pivot).applyQuaternion(turn).add(s.pivot);
      camera.quaternion.premultiply(turn);
      camera.updateMatrixWorld();
      s.left -= step;
      api.current.lastMove = performance.now();
      if (s.left <= 1e-4) api.current.spin(null);
      return;
    }
    api.current.controls?.update(Math.min(delta, 0.064));
    camera.updateMatrixWorld();
  }, -1);

  return null;
}

function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** The place under a ground point: a building before open land (grounds, ponds), else the nearest within 15 m. */
function featureAt(features: MapFeature[], p: Vec2): MapFeature | null {
  const hits = features.filter((f) => f.polygons.some((poly) => pointInPolygon(p, poly)));
  if (hits.length) return hits.sort((a, b) => Number(a.land) - Number(b.land) || a.areaM2 - b.areaM2)[0];
  let best: { f: MapFeature; d: number } | null = null;
  for (const f of features) {
    if (f.land) continue;
    for (const poly of f.polygons)
      for (const q of poly) {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < 15 && (!best || d < best.d)) best = { f, d };
      }
  }
  return best?.f ?? null;
}

/** Click (not drag) to pick a place; hover shows which one the pointer is on. */
function Picking({
  api,
  features,
  onPick,
  onHover,
}: {
  api: React.MutableRefObject<ViewerApi>;
  features: MapFeature[];
  onPick: (key: string | null) => void;
  onHover: (key: string | null) => void;
}) {
  const { camera, gl } = useThree();
  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new THREE.Raycaster();
    (raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const ndc = new THREE.Vector2();
    const groundAt = (e: PointerEvent): Vec2 | null => {
      const tiles = api.current.tiles;
      if (!tiles) return null;
      const r = el.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.intersectObject(tiles.group, true)[0];
      return hit ? { x: hit.point.x, z: hit.point.z } : null;
    };
    let down: { x: number; y: number; at: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY, at: performance.now() } : null;
    };
    const onUp = (e: PointerEvent) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.at < 500;
      down = null;
      if (moved > 5 || !quick) return;
      const p = groundAt(e);
      if (p) onPick(featureAt(features, p)?.key ?? null);
    };
    let lastHover = 0;
    let hoverKey: string | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || e.buttons !== 0) return;
      const now = performance.now();
      if (now - lastHover < 120) return;
      lastHover = now;
      const p = groundAt(e);
      const key = p ? featureAt(features, p)?.key ?? null : null;
      if (key !== hoverKey) {
        hoverKey = key;
        el.style.cursor = key ? "pointer" : "";
        onHover(key);
      }
    };
    const onLeave = () => {
      hoverKey = null;
      el.style.cursor = "";
      onHover(null);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [api, camera, gl, features, onPick, onHover]);
  return null;
}

/** Where a place's label sits and how tall it is (drone-measured where the survey found its roof). */
function anchorOf(f: MapFeature, terrain: Terrain) {
  const ground = terrain.heightAt(f.centre.x, f.centre.z);
  const height = Math.max(4, ...f.footprints.map((fp) => fp.heightM), f.footprints.length ? 0 : f.building?.heightMetres ?? 8);
  return { ground, height, top: new THREE.Vector3(f.centre.x, ground + height + 4, f.centre.z) };
}

/** A building's box: footprint bounds, ground under it and drone-measured height. */
type Frame = { centre: THREE.Vector3; ground: number; height: number; spanX: number; spanZ: number; radius: number };

function frameOf(f: MapFeature, terrain: Terrain): Frame {
  const { ground, height } = anchorOf(f, terrain);
  const pts = f.polygons.flat();
  const xs = pts.length ? pts.map((p) => p.x) : [f.centre.x];
  const zs = pts.length ? pts.map((p) => p.z) : [f.centre.z];
  const spanX = Math.max(8, Math.max(...xs) - Math.min(...xs));
  const spanZ = Math.max(8, Math.max(...zs) - Math.min(...zs));
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cz = (Math.max(...zs) + Math.min(...zs)) / 2;
  return { centre: new THREE.Vector3(cx, ground, cz), ground, height, spanX, spanZ, radius: 0.5 * Math.hypot(spanX, spanZ, height) };
}

/** How far back a sphere of `radius` must be to fill the view, with a margin. */
function fitDistance(radius: number, cam: THREE.PerspectiveCamera, margin = 1.08) {
  const vfov = THREE.MathUtils.degToRad(cam.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
  return (radius * margin) / Math.sin(Math.min(vfov, hfov) / 2);
}

/** Level unit vector from `from` towards `to` (the side the camera is on). */
function headingFrom(from: THREE.Vector3, to: THREE.Vector3) {
  const d = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  return d.lengthSq() < 1 ? new THREE.Vector3(0.6, 0, 0.8).normalize() : d.normalize();
}

/** The mesh point in the middle of the view (or 400 m ahead, looking at the sky). */
function centreHit(world: THREE.Object3D, cam: THREE.Camera) {
  const ray = new THREE.Raycaster();
  (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
  ray.setFromCamera(new THREE.Vector2(0, 0), cam);
  return ray.intersectObject(world, true)[0]?.point ?? ray.ray.at(400, new THREE.Vector3());
}

type ViewKind = "top" | "north" | "east" | "south" | "west" | "street";
const VIEW_SIDES: Record<"north" | "east" | "south" | "west", THREE.Vector3> = {
  // From the north means standing north of it (-Z), looking south at its north face.
  north: new THREE.Vector3(0, 0, -1),
  east: new THREE.Vector3(1, 0, 0),
  south: new THREE.Vector3(0, 0, 1),
  west: new THREE.Vector3(-1, 0, 0),
};

/**
 * Where to put the camera for a standard view of a frame, whole building in shot.
 * `world` is the mesh, for finding a street-level spot with a clear view of it.
 */
function viewPose(kind: ViewKind, fr: Frame, cam: THREE.PerspectiveCamera, terrain: Terrain, world: THREE.Object3D): Pose {
  const side = headingFrom(fr.centre, cam.position);
  const vfov = THREE.MathUtils.degToRad(cam.fov);
  if (kind === "top") {
    // Straight down on the roof, the whole footprint in view whichever way the
    // view is turned (its diagonal fits the shorter side of the screen).
    const half = (0.5 * Math.hypot(fr.spanX, fr.spanZ)) / Math.min(1, cam.aspect) * 1.1 + 4;
    const target = new THREE.Vector3(fr.centre.x, fr.ground + fr.height, fr.centre.z);
    const h = Math.max(40, half / Math.tan(vfov / 2));
    return { position: target.clone().add(new THREE.Vector3(side.x * h * 0.01, h, side.z * h * 0.01)), target };
  }
  if (kind === "street") {
    // Standing in front of it, looking up at the whole facade. Other blocks and
    // trees crowd most sides, so of 16 directions (nearest the camera's side
    // first) take the first with nothing between the spot and the building.
    const target = new THREE.Vector3(fr.centre.x, fr.ground + Math.max(3, fr.height * 0.55), fr.centre.z);
    const back = Math.max(28, fr.height * 1.7 + 10);
    const ray = new THREE.Raycaster();
    (ray as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true;
    const base = Math.atan2(side.x, side.z);
    let best: { position: THREE.Vector3; clear: number } | null = null;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8]) {
      const a = base + (k * Math.PI) / 8;
      const dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      const reach = (Math.abs(dir.x) * fr.spanX + Math.abs(dir.z) * fr.spanZ) / 2;
      const x = fr.centre.x + dir.x * (reach + back);
      const z = fr.centre.z + dir.z * (reach + back);
      const position = new THREE.Vector3(x, terrain.heightAt(x, z) + 5, z);
      const toward = target.clone().sub(position);
      const length = toward.length();
      ray.set(position, toward.normalize());
      ray.far = length;
      const hit = ray.intersectObject(world, true)[0];
      // How much of the way is open: 1 means the first thing in the way is the building itself.
      const open = hit ? Math.min(1, hit.distance / Math.max(1, length - reach - 4)) : 1;
      if (!best || open > best.clear + 0.05) best = { position, clear: open };
      if (open >= 1) break;
    }
    return { position: best!.position, target };
  }
  const dir = VIEW_SIDES[kind];
  const el = THREE.MathUtils.degToRad(14);
  const target = new THREE.Vector3(fr.centre.x, fr.ground + fr.height * 0.45, fr.centre.z);
  const d = Math.max(35, fitDistance(fr.radius, cam));
  return { position: target.clone().addScaledVector(dir, Math.cos(el) * d).add(new THREE.Vector3(0, Math.sin(el) * d, 0)), target };
}

/** The selected place's outline, drawn over its roof so it reads through the photo. */
function Highlight({ feature, terrain }: { feature: MapFeature; terrain: Terrain }) {
  const { ground, height } = anchorOf(feature, terrain);
  const y = ground + height + 0.6;
  return (
    <group renderOrder={10}>
      {feature.polygons.map((poly, i) => (
        <Line
          key={i}
          points={[...poly, poly[0]].map((p) => [p.x, y, p.z] as [number, number, number])}
          color="#7b5cff"
          lineWidth={3}
          depthTest={false}
          transparent
          opacity={0.95}
        />
      ))}
    </group>
  );
}

function densify(pts: Vec2[], step = 8): Vec2[] {
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

/** The active route: a line along the ground, drawn over everything, and a marker travelling it. */
function Route({
  path,
  playing,
  onProgress,
  terrain,
}: {
  path: Vec2[];
  playing: boolean;
  onProgress?: (t: number) => void;
  terrain: Terrain;
}) {
  const walker = useRef<THREE.Mesh>(null);
  const travelled = useRef(0);
  const lastReport = useRef(0);
  const curve = useMemo(() => {
    if (path.length < 2) return null;
    return new THREE.CatmullRomCurve3(
      densify(path).map((p) => new THREE.Vector3(p.x, terrain.heightAt(p.x, p.z) + 2.2, p.z)),
      false,
      "catmullrom",
      0.08
    );
  }, [path, terrain]);
  const length = useMemo(() => (curve ? curve.getLength() : 0), [curve]);
  // Drawn as a line of constant on-screen width: a tube of fixed metres was a
  // hair from the campus overview and a wall of blue next to a building.
  const points = useMemo(() => (curve ? curve.getSpacedPoints(Math.max(64, Math.ceil(length / 2))) : null), [curve, length]);

  useFrame((_, delta) => {
    if (!curve || !walker.current || length === 0) return;
    if (playing) travelled.current = (travelled.current + delta * 14) % length;
    const t = Math.min(0.999, Math.max(0, travelled.current / length));
    const p = curve.getPointAt(t);
    walker.current.position.set(p.x, p.y + 1.4, p.z);
    const now = performance.now();
    if (onProgress && now - lastReport.current > 100) {
      lastReport.current = now;
      onProgress(t);
    }
  });

  if (!curve || !points) return null;
  return (
    <group>
      <Line points={points} color="#ffffff" lineWidth={9} depthTest={false} transparent opacity={0.9} renderOrder={5} />
      <Line points={points} color="#2f7cf6" lineWidth={5} depthTest={false} transparent renderOrder={6} />
      <mesh ref={walker} renderOrder={7}>
        <sphereGeometry args={[2.6, 20, 20]} />
        <meshBasicMaterial color="#facc15" depthTest={false} />
      </mesh>
    </group>
  );
}

type Label = { key: string; name: string; anchor: THREE.Vector3; area: number };

/**
 * Building names over the 3D view, biggest first and never overlapping, the
 * way the 2D map places them. Written straight to the DOM a few times a second
 * so React stays out of the frame loop.
 */
function LabelLayout({
  labels,
  layer,
  selectedId,
  hoverId,
  show,
}: {
  labels: Label[];
  layer: React.RefObject<HTMLDivElement | null>;
  selectedId: string | null;
  hoverId: string | null;
  show: boolean;
}) {
  const { camera, size } = useThree();
  const last = useRef(0);
  const v = useMemo(() => new THREE.Vector3(), []);
  const order = useMemo(() => [...labels].sort((a, b) => b.area - a.area), [labels]);
  // Label nodes and their widths, read once: reading offsetWidth in the loop
  // below, between style writes, forced a layout per label per update.
  const nodes = useRef(new Map<string, { node: HTMLElement; width: number }>());
  useEffect(() => {
    const all = [...(layer.current?.querySelectorAll<HTMLElement>("[data-key]") ?? [])];
    for (const n of all) n.style.display = "";
    const measured = all.map((n) => [n.dataset.key!, { node: n, width: n.offsetWidth || 90 }] as const);
    for (const n of all) n.style.display = "none";
    nodes.current = new Map(measured);
  }, [labels, layer]);
  useFrame(() => {
    if (!layer.current) return;
    const now = performance.now();
    if (now - last.current < 60) return;
    last.current = now;
    const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // Selected and hovered first, so they always win their spot.
    const first = order.filter((l) => l.key === selectedId || l.key === hoverId);
    const rest = order.filter((l) => l.key !== selectedId && l.key !== hoverId);
    for (const l of [...first, ...rest]) {
      const entry = nodes.current.get(l.key);
      if (!entry) continue;
      const { node, width } = entry;
      v.copy(l.anchor).project(camera);
      const forced = l.key === selectedId || l.key === hoverId;
      const distance = camera.position.distanceTo(l.anchor);
      let visible = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (forced || (show && distance < 1400));
      // Kept whole on screen: a name near the edge slides in rather than being cut off.
      const x = THREE.MathUtils.clamp(((v.x + 1) / 2) * size.width, width / 2 + 6, Math.max(width / 2 + 6, size.width - width / 2 - 6));
      const y = ((1 - v.y) / 2) * size.height;
      if (visible) {
        const box = { x0: x - width / 2 - 4, y0: y - 26, x1: x + width / 2 + 4, y1: y + 2 };
        if (!forced && taken.some((b) => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) visible = false;
        else taken.push(box);
      }
      const display = visible ? "" : "none";
      if (node.style.display !== display) node.style.display = display;
      if (visible) node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

function ControlButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-[#3c4752] shadow-[0_2px_8px_rgba(30,60,80,0.18)] transition hover:bg-[#f3f6f8]"
    >
      {children}
    </button>
  );
}

export function DroneView3D({
  campus,
  features,
  routePath,
  playing,
  onRouteProgress,
  selectedId,
  onSelect,
  focus,
  showLabels,
}: {
  campus: Campus3D;
  features: MapFeature[];
  routePath: Vec2[];
  playing: boolean;
  onRouteProgress?: (t: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Fly to this place whenever `n` changes (a pick in the sidebar). */
  focus: { id: string; n: number } | null;
  showLabels: boolean;
}) {
  const terrain = useTerrain();
  // Kept here, not in the page: a counter that changes while tiles stream must
  // not re-render the whole /navigate page (measured: ~9% of a drag's CPU).
  const [progress, setProgress] = useState<DroneViewProgress>({ pending: 0, loaded: 0, sharpening: false });
  const c = campus.centre;
  const r = campus.radius;
  const homeY = terrain.heightAt(c.x, c.z);
  const home = useMemo<Pose>(
    () => ({
      // The 3D studio's opening view, so the tab looks the same at first.
      position: new THREE.Vector3(c.x + r * 0.7, r * 0.72, c.z + r * 0.95),
      target: new THREE.Vector3(c.x, homeY, c.z),
    }),
    [c.x, c.z, r, homeY]
  );

  const api = useRef<ViewerApi>({
    world: new THREE.Group(),
    tiles: null,
    controls: null,
    flyTo: () => {},
    spin: () => {},
    resetDetail: () => {},
    lastMove: 0,
    rotateMode: false,
  });

  const [spinning, setSpinning] = useState(false);
  const [dragMode, setDragMode] = useState<"move" | "rotate">("move");
  useEffect(() => {
    api.current.rotateMode = dragMode === "rotate";
  }, [dragMode]);

  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hint, setHint] = useState(true);
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    const t = setTimeout(() => setHint(false), 9000);
    return () => clearTimeout(t);
  }, []);

  const byKey = useMemo(() => new Map(features.map((f) => [f.key, f])), [features]);
  const labels = useMemo<Label[]>(
    () =>
      features
        .filter((f) => f.name)
        .map((f) => ({ key: f.key, name: f.name!, anchor: anchorOf(f, terrain).top, area: f.areaM2 })),
    [features, terrain]
  );
  const labelLayer = useRef<HTMLDivElement>(null);

  /** A view of the whole place, roof to ground, from the side the camera is already on. */
  const poseFor = useCallback(
    (f: MapFeature): Pose => {
      const cam = (api.current.controls?.camera as THREE.PerspectiveCamera | undefined) ?? null;
      const fr = frameOf(f, terrain);
      const target = new THREE.Vector3(fr.centre.x, fr.ground + fr.height * 0.45, fr.centre.z);
      const dir = cam ? headingFrom(target, cam.position) : new THREE.Vector3(0.6, 0, 0.8).normalize();
      const distance = THREE.MathUtils.clamp(cam ? fitDistance(fr.radius, cam, 1.25) : 160, 70, 520);
      const el = THREE.MathUtils.degToRad(30);
      const position = target
        .clone()
        .addScaledVector(dir, Math.cos(el) * distance)
        .add(new THREE.Vector3(0, Math.sin(el) * distance, 0));
      return { position, target };
    },
    [terrain]
  );

  /** The selected building's frame, or one round the point in the middle of the view. */
  const currentFrame = useCallback((): Frame | null => {
    const controls = api.current.controls;
    if (!controls) return null;
    const cam = controls.camera as THREE.PerspectiveCamera;
    const f = selectedId ? byKey.get(selectedId) : undefined;
    if (f) return frameOf(f, terrain);
    const hit = centreHit(api.current.world, cam);
    const span = THREE.MathUtils.clamp(cam.position.distanceTo(hit) * 0.5, 30, 600);
    return { centre: hit.clone(), ground: hit.y, height: 0, spanX: span, spanZ: span, radius: span / 2 };
  }, [selectedId, byKey, terrain]);

  /** Fly to one of the standard views of the selected building (or of the middle of the view). */
  const showView = useCallback(
    (kind: ViewKind) => {
      const controls = api.current.controls;
      const fr = currentFrame();
      if (!controls || !fr) return;
      api.current.spin(null);
      const cam = controls.camera as THREE.PerspectiveCamera;
      const pose = viewPose(kind, fr, cam, terrain, api.current.world);
      const near = cam.position.distanceTo(fr.centre) < Math.max(450, fitDistance(fr.radius, cam) * 3);
      // Close by, swing round the building; from far away, fly in.
      api.current.flyTo(pose, near ? 1.1 : 1.4, near ? { around: new THREE.Vector3(fr.centre.x, fr.ground + fr.height * 0.45, fr.centre.z) } : {});
    },
    [currentFrame, terrain]
  );

  /** A full turn round the selected building (or the middle of the view); again to stop. */
  const toggleSpin = useCallback(() => {
    if (spinning) {
      api.current.spin(null);
      return;
    }
    const controls = api.current.controls;
    const fr = currentFrame();
    if (!controls || !fr) return;
    const cam = controls.camera as THREE.PerspectiveCamera;
    const pivot = new THREE.Vector3(fr.centre.x, fr.ground + fr.height * 0.4, fr.centre.z);
    const fit = fitDistance(fr.radius, cam, 1.3);
    const { r, el } = sphericalOf(cam.position, pivot);
    // Too far, too close or too flat to read the building as it turns: first a three-quarter view.
    if (r > fit * 2.2 || r < fit * 0.5 || el < THREE.MathUtils.degToRad(8)) {
      const dir = headingFrom(pivot, cam.position);
      const e = THREE.MathUtils.degToRad(25);
      const position = pivot.clone().addScaledVector(dir, Math.cos(e) * fit).add(new THREE.Vector3(0, Math.sin(e) * fit, 0));
      api.current.flyTo({ position, target: pivot }, 1.2, { then: () => api.current.spin(pivot) });
    } else api.current.spin(pivot);
  }, [spinning, currentFrame]);

  /** Turn and tilt round the middle of the view (the arrow keys and the turn buttons). */
  const orbitBy = useCallback((dAz: number, dTilt: number) => {
    const controls = api.current.controls;
    if (!controls) return;
    api.current.spin(null);
    const cam = controls.camera as THREE.PerspectiveCamera;
    const pivot = centreHit(api.current.world, cam);
    const s = sphericalOf(cam.position, pivot);
    const el = THREE.MathUtils.clamp(s.el + dTilt, THREE.MathUtils.degToRad(2), THREE.MathUtils.degToRad(89.5));
    const position = fromSpherical(pivot, s.r, s.az + dAz, el);
    api.current.flyTo({ position, target: pivot }, 0.45, { around: pivot });
  }, []);

  // A pick in the sidebar flies the camera there.
  const lastFocus = useRef(0);
  useEffect(() => {
    if (!focus || focus.n === lastFocus.current) return;
    const f = byKey.get(focus.id);
    if (!f) return;
    lastFocus.current = focus.n;
    api.current.resetDetail();
    api.current.flyTo(poseFor(f));
  }, [focus, byKey, poseFor]);

  /** Zoom along the centre of the view (the toolbar buttons and the +/- keys). */
  const zoomBy = useCallback((factor: number) => {
    const controls = api.current.controls;
    if (!controls) return;
    api.current.spin(null);
    const cam = controls.camera as THREE.PerspectiveCamera;
    const hit = centreHit(api.current.world, cam);
    const offset = cam.position.clone().sub(hit);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance + 4, controls.maxDistance);
    api.current.flyTo({ position: hit.clone().addScaledVector(offset.normalize(), distance), target: hit }, 0.45);
  }, []);

  /** Turn to face north, round the point in the middle of the view. */
  const faceNorth = useCallback(() => {
    const controls = api.current.controls;
    if (!controls) return;
    api.current.spin(null);
    const cam = controls.camera as THREE.PerspectiveCamera;
    const hit = centreHit(api.current.world, cam);
    const { r, el } = sphericalOf(cam.position, hit);
    // North is -Z, so the camera swings to the south of the point (compass angle 0 here).
    api.current.flyTo({ position: fromSpherical(hit, r, 0, el), target: hit }, 0.8, { around: hit });
  }, []);

  const goHome = useCallback(() => {
    api.current.spin(null);
    api.current.resetDetail();
    api.current.flyTo(home);
  }, [home]);

  // Keyboard, once the view has been clicked: arrows turn and tilt, +/- zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The controls focus the canvas when it is pressed.
      const canvas = (api.current.controls as unknown as { domElement?: HTMLElement } | null)?.domElement;
      if (!canvas || document.activeElement !== canvas || e.altKey || e.ctrlKey || e.metaKey) return;
      const step = THREE.MathUtils.degToRad(e.shiftKey ? 45 : 15);
      if (e.key === "ArrowLeft") orbitBy(-step, 0);
      else if (e.key === "ArrowRight") orbitBy(step, 0);
      else if (e.key === "ArrowUp") orbitBy(0, THREE.MathUtils.degToRad(10));
      else if (e.key === "ArrowDown") orbitBy(0, -THREE.MathUtils.degToRad(10));
      else if (e.key === "+" || e.key === "=") zoomBy(0.6);
      else if (e.key === "-" || e.key === "_") zoomBy(1.6);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [orbitBy, zoomBy]);

  const selected = selectedId ? byKey.get(selectedId) ?? null : null;
  const views: { kind: ViewKind; label: string; title: string }[] = [
    { kind: "top", label: "Top", title: "Straight down from above" },
    { kind: "north", label: "N", title: "From the north" },
    { kind: "east", label: "E", title: "From the east" },
    { kind: "south", label: "S", title: "From the south" },
    { kind: "west", label: "W", title: "From the west" },
    { kind: "street", label: "Street", title: "From the ground, looking up at it" },
  ];

  return (
    <div
      className="absolute inset-0"
      // Sky behind the mesh; the fog fades the survey edge into its horizon colour.
      style={{ background: "linear-gradient(180deg, #b9d7ee 0%, #dcebf6 55%, #eef3f7 100%)" }}
    >
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance", toneMapping: THREE.NoToneMapping }}
        camera={{ position: home.position.toArray(), fov: 45, near: 1, far: r * 16 }}
        onCreated={({ scene, gl }) => {
          scene.fog = new THREE.Fog("#eef3f7", r * 1.8, r * 6);
          // The controls focus the canvas on press; no focus ring around the whole view.
          gl.domElement.style.outline = "none";
        }}
      >
        <primitive object={api.current.world} />
        <DroneTiles api={api} onProgress={setProgress} />
        <Navigation api={api} home={home} maxDistance={r * 3.5} groundY={homeY} onSpinChange={setSpinning} />
        <Picking api={api} features={features} onPick={onSelect} onHover={setHoverId} />
        <Route path={routePath} playing={playing} onProgress={onRouteProgress} terrain={terrain} />
        {selected && <Highlight feature={selected} terrain={terrain} />}
        <LabelLayout labels={labels} layer={labelLayer} selectedId={selectedId} hoverId={hoverId} show={showLabels} />
      </Canvas>

      <div ref={labelLayer} className="pointer-events-none absolute inset-0 overflow-hidden">
        {labels.map((l) => {
          const active = l.key === selectedId;
          const hovered = l.key === hoverId;
          return (
            <div
              key={l.key}
              data-key={l.key}
              style={{ display: "none" }}
              className={`absolute left-0 top-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-medium shadow-[0_2px_8px_rgba(30,60,80,0.25)] ${
                active ? "bg-[#7b5cff] text-white" : hovered ? "bg-white text-[#1f2a37] ring-2 ring-[#7b5cff]" : "bg-white/90 text-[#2b3640]"
              }`}
            >
              {l.name}
            </div>
          );
        })}
      </div>

      <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
        {!touch && (
          // What the left mouse button does: move the map, or turn the view all the way round.
          <div className="mb-1 flex flex-col overflow-hidden rounded-md bg-white shadow-[0_2px_8px_rgba(30,60,80,0.18)]">
            {(
              [
                ["move", "Left-drag moves the view", Hand],
                ["rotate", "Left-drag turns the view (360°)", Rotate3d],
              ] as const
            ).map(([mode, label, Icon]) => (
              <button
                key={mode}
                type="button"
                aria-label={label}
                aria-pressed={dragMode === mode}
                title={label}
                onClick={() => setDragMode(mode)}
                className={`flex h-9 w-9 items-center justify-center transition ${
                  dragMode === mode ? "bg-[#e3f4fb] text-[#1e9bd7]" : "text-[#3c4752] hover:bg-[#f3f6f8]"
                }`}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        )}
        <ControlButton label="Zoom in" onClick={() => zoomBy(0.5)}>
          <Plus className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Zoom out" onClick={() => zoomBy(2)}>
          <Minus className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Turn left" onClick={() => orbitBy(-Math.PI / 4, 0)}>
          <RotateCcw className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Turn right" onClick={() => orbitBy(Math.PI / 4, 0)}>
          <RotateCw className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Face north" onClick={faceNorth}>
          <Compass className="h-4 w-4" />
        </ControlButton>
        <ControlButton label="Whole campus" onClick={goHome}>
          <Maximize2 className="h-4 w-4" />
        </ControlButton>
      </div>

      {/* Standard views of the selected building (or of the middle of the view). */}
      <div className="absolute left-16 right-3 top-4 z-10 flex justify-start md:bottom-6 md:left-1/2 md:right-auto md:top-auto md:-translate-x-1/2 md:justify-center">
        <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-xl bg-white/95 p-1 shadow-[0_4px_16px_rgba(30,60,80,0.18)]">
          <span className="hidden max-w-[160px] truncate px-2 text-[12px] text-[#7b8794] lg:block">
            {selected ? selected.name ?? "This building" : "View"}
          </span>
          {views.map((v) => (
            <button
              key={v.kind}
              type="button"
              title={v.title}
              aria-label={`${v.title}${selected?.name ? `: ${selected.name}` : ""}`}
              onClick={() => showView(v.kind)}
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-[#2b3640] hover:bg-[#f0f4f7]"
            >
              {v.kind === "top" && <Square className="h-3.5 w-3.5" />}
              {v.kind === "street" && <PersonStanding className="h-3.5 w-3.5" />}
              {v.label}
            </button>
          ))}
          <button
            type="button"
            title={spinning ? "Stop turning" : "Turn a full circle round it"}
            aria-pressed={spinning}
            onClick={toggleSpin}
            className={`flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium transition ${
              spinning ? "bg-[#7b5cff] text-white" : "text-[#2b3640] hover:bg-[#f0f4f7]"
            }`}
          >
            {spinning ? <CircleStop className="h-3.5 w-3.5" /> : <Orbit className="h-3.5 w-3.5" />}
            {spinning ? "Stop" : "360°"}
          </button>
        </div>
      </div>

      {progress.pending > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center md:top-5">
          <div className="flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-[13px] text-[#2b3640] shadow-[0_4px_16px_rgba(30,60,80,0.18)]">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#2ea3dc] border-t-transparent" />
            {progress.sharpening
              ? "Sharpening detail…"
              : `Loading drone survey… ${progress.pending} tile${progress.pending === 1 ? "" : "s"} to go`}
          </div>
        </div>
      )}

      {hint && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center px-4 md:bottom-20">
          <div className="rounded-full bg-[#1f2a37]/80 px-4 py-2 text-center text-[12px] text-white">
            {touch
              ? "Drag to move · Pinch to zoom · Two fingers to turn · Tap a building"
              : "Drag to move · Scroll to zoom · Right-drag to turn 360° (or pick ⟳ mode) · Arrow keys turn and tilt · Click a building"}
          </div>
        </div>
      )}
    </div>
  );
}
