"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- this dev tool drives 3d-tiles-renderer internals (queue scheduling, stats) that its typings do not expose. */

// Dev-only capture tool: renders the drone mesh straight down, window by
// window, as colour + encoded height PNGs (posted to /api/dev-ortho), which
// tools/drone/build-ortho.py turns into the 2D map's orthophoto and building
// footprints. See public/drone/README.md. Query: x0, z0, cols, rows, win, mpp,
// start (resume index), only=i,j (one window).

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { GLTFExtensionsPlugin } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { MAP_ORIGIN } from "@/lib/geo/projection";

// Hidden pages throttle timers to ~1 s; MessageChannel callbacks are not throttled.
const mc = typeof window !== "undefined" ? new MessageChannel() : null;
const pendingCbs: (() => void)[] = [];
if (mc) mc.port1.onmessage = () => pendingCbs.shift()?.();
const defer = (f: () => void) => {
  pendingCbs.push(f);
  mc!.port2.postMessage(0);
};
const sleep = (ms: number) =>
  new Promise<void>((r) => {
    const end = performance.now() + ms;
    const loop = () => (performance.now() >= end ? r() : defer(loop));
    defer(loop);
  });

function ecefToScene(a: { dx: number; dz: number; groundHeight: number; rotationDeg: number }) {
  const enu = new THREE.Matrix4();
  WGS84_ELLIPSOID.getEastNorthUpFrame(
    THREE.MathUtils.degToRad(MAP_ORIGIN.lat),
    THREE.MathUtils.degToRad(MAP_ORIGIN.lng),
    0,
    enu
  );
  const toEnu = enu.invert();
  const axes = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  const shift = new THREE.Matrix4().makeTranslation(a.dx, -a.groundHeight, a.dz);
  const spin = new THREE.Matrix4().makeRotationY(-THREE.MathUtils.degToRad(a.rotationDeg));
  return spin.multiply(shift).multiply(axes).multiply(toEnu);
}

const heightMaterial = new THREE.ShaderMaterial({
  vertexShader: `varying float vY;
    void main() { vec4 w = modelMatrix * vec4(position, 1.0); vY = w.y; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `precision highp float; varying float vY;
    void main() { float v = clamp((vY + 100.0) * 100.0, 1.0, 65535.0); float hi = floor(v / 256.0); float lo = v - hi * 256.0;
      gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0); }`,
  side: THREE.DoubleSide,
});

export function DevOrthoCapture() {
  const [status, setStatus] = useState("idle");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const p = new URLSearchParams(window.location.search);
    const x0 = Number(p.get("x0") ?? -620);
    const z0 = Number(p.get("z0") ?? -1215);
    const cols = Number(p.get("cols") ?? 13);
    const rows = Number(p.get("rows") ?? 14);
    const win = Number(p.get("win") ?? 128);
    const mpp = Number(p.get("mpp") ?? 0.25);
    const startAt = Number(p.get("start") ?? 0);
    const only = p.get("only"); // "i,j" to capture a single window
    const px = Math.round(win / mpp);

    (async () => {
      const alignment = await fetch("/drone/mesh-alignment.json").then((r) => r.json());
      const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(px, px);
      document.getElementById("ortho-host")?.appendChild(renderer.domElement);
      renderer.domElement.style.width = "256px";
      renderer.domElement.style.height = "256px";

      const scene = new THREE.Scene();
      const camera = new THREE.OrthographicCamera(-win / 2, win / 2, win / 2, -win / 2, 1, 4000);
      camera.up.set(0, 0, -1);

      const tiles = new TilesRenderer("/drone/mesh/tileset.json");
      const draco = new DRACOLoader().setDecoderPath("/draco/");
      tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
      tiles.errorTarget = 2;
      tiles.loadAncestors = false;
      tiles.loadSiblings = false;
      tiles.lruCache.maxSize = 4000;
      tiles.lruCache.maxBytesSize = 1.6e9;
      // The queues normally schedule on requestAnimationFrame, which a hidden
      // pane never fires. Timers keep them moving.
      for (const q of [tiles.downloadQueue, tiles.parseQueue, tiles.processNodeQueue] as any[]) {
        q._schedulingCallback = (f: () => void) => defer(f);
      }
      tiles.group.matrixAutoUpdate = false;
      tiles.group.matrix.copy(ecefToScene(alignment));
      tiles.group.matrixWorldNeedsUpdate = true;
      scene.add(tiles.group);
      (window as any).__dbg = { tiles, scene, camera, renderer };

      const post = (name: string, data: string) =>
        fetch("/api/dev-ortho", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, data }),
        });

      const jobs: [number, number][] = [];
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) jobs.push([i, j]);
      const list = only ? [only.split(",").map(Number) as [number, number]] : jobs.slice(startAt);
      (window as any).__ortho = { total: jobs.length, done: startAt, current: null, finished: false };

      for (const [i, j] of list) {
        const cx = x0 + (i + 0.5) * win;
        const cz = z0 + (j + 0.5) * win;
        camera.position.set(cx, 1500, cz);
        camera.lookAt(cx, 0, cz);
        camera.updateMatrixWorld();
        camera.updateProjectionMatrix();
        tiles.setCamera(camera);
        tiles.setResolution(camera, px, px);

        let stable = 0;
        for (let k = 0; k < 1200 && stable < 6; k++) {
          // Nothing renders between updates here, so world matrices must be refreshed by hand.
          scene.updateMatrixWorld(true);
          tiles.update();
          await sleep(40);
          const s = (tiles as any).stats;
          const pending = s.queued + s.downloading + s.parsing;
          const t = tiles as any;
          // Until the root tileset and its first nodes are in, "nothing pending"
          // means "nothing asked for yet", not "done".
          const ready = Boolean(t.root) && k > 15 && (t.visibleTiles?.size > 0 || k > 150);
          stable = pending === 0 && ready ? stable + 1 : 0;
          if (k % 10 === 0) setStatus(`window ${i},${j}: pending ${pending}, loaded ${s.loaded}`);
        }

        renderer.setClearColor(0x000000, 0);
        scene.overrideMaterial = null;
        renderer.render(scene, camera);
        const rgb = renderer.domElement.toDataURL("image/png");
        renderer.setClearColor(0x000000, 1);
        scene.overrideMaterial = heightMaterial;
        renderer.render(scene, camera);
        const hgt = renderer.domElement.toDataURL("image/png");
        scene.overrideMaterial = null;
        await post(`rgb_${i}_${j}.png`, rgb);
        await post(`h_${i}_${j}.png`, hgt);
        (window as any).__ortho.done += 1;
        (window as any).__ortho.current = [i, j];
      }
      (window as any).__ortho.finished = true;
      setStatus("finished");
    })().catch((e) => {
      (window as any).__ortho = { error: String(e) };
      setStatus(`error: ${e}`);
    });
  }, []);

  return (
    <div className="p-4 font-mono text-xs">
      <div id="ortho-status">{status}</div>
      <div id="ortho-host" />
    </div>
  );
}
