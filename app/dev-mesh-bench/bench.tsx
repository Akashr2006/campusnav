"use client";
/* eslint-disable @typescript-eslint/no-explicit-any -- this dev tool reads 3d-tiles-renderer stats that its typings do not expose. */

// Dev-only load benchmark: mounts the app's own DroneMesh (unchanged, same
// settings as the /navigate 3D tab) in a Canvas set up like CampusScene, and
// times how long a camera pose takes to become fully sharp. Mesh requests are
// redirected to ?host=<base>&mesh=<folder>, so v1 and v2 builds (or the CDN)
// are compared through identical code. Driven by tools/drone/bench-mesh.mjs
// through window.__bench.

import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { DroneMesh } from "@/features/navigation-3d/components/drone-layers";
import { buildCampus3D, type Campus3D } from "@/features/navigation-3d/lib/campus-3d";
import { decodeTerrain, FLAT_TERRAIN, type Terrain } from "@/features/navigation-3d/lib/terrain";
import { warmDroneCache } from "@/features/navigation/lib/drone-warmup";

type Pose = { position: [number, number, number]; target: [number, number, number] };

function installFetchRedirect(host: string, mesh: string) {
  const w = window as any;
  if (w.__benchFetch) return;
  // The default buffer keeps 250 entries; a campus load makes thousands.
  performance.setResourceTimingBufferSize(100000);
  const original = window.fetch.bind(window);
  w.__benchFetch = original;
  const prefix = mesh ? `${host}/${mesh}/` : `${host}/`;
  const rewrite = (u: string) => u.replace(/^(https?:\/\/[^/]+)?\/drone\/mesh\//, prefix);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") return original(rewrite(input), init);
    if (input instanceof URL) return original(rewrite(input.href), init);
    return original(new Request(rewrite(input.url), input), init);
  };
}

function CameraRig({ pose }: { pose: Pose | null }) {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!pose) return;
    camera.position.set(...pose.position);
    camera.lookAt(new THREE.Vector3(...pose.target));
    camera.updateMatrixWorld();
  }, [camera, pose]);
  return null;
}

/**
 * Finds the tiles renderer DroneMesh added to the scene (its group points back
 * to it). `?tweak=` (comma-separated) applies candidate settings without
 * editing DroneMesh:
 *   ancestors  show coarse parent tiles while the sharp ones stream in
 *   warm       run /navigate's cache warm-up alongside the 3D view (deep link)
 *   prewarm    the driver runs the warm-up first (user was on the 2D map)
 *   jobsN      at most N tile downloads in flight (library default 25)
 *   etN        screen-space error target N, in drawing-buffer pixels
 */
function TilesProbe({ tweak }: { tweak: string[] }) {
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    (window as any).__benchTiles = () => {
      let found: any = null;
      scene.traverse((o: any) => {
        if (!found && o.tilesRenderer) found = o.tilesRenderer;
      });
      return found;
    };
  }, [scene]);
  useFrame(() => {
    const t = (window as any).__benchTiles?.();
    if (!t || t.__benchTweaked) return;
    t.__benchTweaked = true;
    if (tweak.includes("ancestors")) {
      t.loadAncestors = true;
      t.loadSiblings = true;
    }
    // jobsN: at most N tile downloads at once (the library's default is 25).
    const jobs = tweak.map((x) => /^jobs(\d+)$/.exec(x)?.[1]).find(Boolean);
    if (jobs) t.downloadQueue.maxJobsPerOrigin = Number(jobs);
    // etN: screen-space error target in drawing-buffer pixels (DroneMesh uses 4).
    const et = tweak.map((x) => /^et([\d.]+)$/.exec(x)?.[1]).find(Boolean);
    if (et) t.errorTarget = Number(et);
    console.info(`[bench] tweaks ${JSON.stringify(tweak)} applied, errorTarget ${t.errorTarget}`);
  }, -1);
  return null;
}

export function MeshBench() {
  const params = useMemo(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search), []);
  const [campus, setCampus] = useState<Campus3D | null>(null);
  const [terrain, setTerrain] = useState<Terrain>(FLAT_TERRAIN);
  const [pose, setPose] = useState<Pose | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    installFetchRedirect(params.get("host") ?? "", params.get("mesh") ?? "v1");
    const f = (window as any).__benchFetch as typeof fetch;
    Promise.all([
      f("/api/published-graph").then((r) => r.json()),
      f("/drone/terrain.json").then((r) => r.json()),
      f("/drone/terrain.bin").then((r) => r.arrayBuffer()),
    ]).then(([payload, meta, bin]) => {
      setCampus(buildCampus3D(payload.graph));
      setTerrain(decodeTerrain(meta, bin));
    });
  }, [params]);

  useEffect(() => {
    if (!campus) return;
    const c = campus.centre;
    const r = campus.radius;
    const homeY = terrain.heightAt(c.x, c.z);
    const poses: Record<string, Pose> = {
      // CampusScene's opening camera.
      home: { position: [c.x + r * 0.7, r * 0.72, c.z + r * 0.95], target: [c.x, homeY, c.z] },
    };
    for (const b of campus.buildings) {
      const y = terrain.heightAt(b.centre.x, b.centre.z) + b.heightMetres / 2;
      const at = (d: number, elDeg: number, azDeg: number): Pose => {
        const el = (elDeg * Math.PI) / 180;
        const az = (azDeg * Math.PI) / 180;
        return {
          position: [b.centre.x + d * Math.cos(el) * Math.sin(az), y + d * Math.sin(el), b.centre.z - d * Math.cos(el) * Math.cos(az)],
          target: [b.centre.x, y, b.centre.z],
        };
      };
      // ~120 m out, from the south-east, 35 degrees up: a whole block filling a phone screen.
      poses[`b:${b.name}`] = at(120, 35, 135);
      // Close and low: where unfiltered photo textures alias the most.
      poses[`close:${b.name}`] = at(55, 12, 135);
    }
    const tweak = (params.get("tweak") ?? "").split(",");
    (window as any).__bench = {
      poses: Object.keys(poses),
      // What /navigate does while the 2D map is up (the driver awaits it for `prewarm`).
      warm: () => warmDroneCache(),
      start(name: string) {
        // `warm`: a ?view=3d deep link, where the warm-up runs alongside the 3D view.
        if (tweak.includes("warm")) void warmDroneCache();
        setPose(poses[name]);
        setStarted(true);
      },
      pose(name: string) {
        setPose(poses[name]);
      },
      snapshot() {
        const t = (window as any).__benchTiles?.();
        const s = t?.stats ?? {};
        const host = params.get("host") ?? "";
        const entries = performance
          .getEntriesByType("resource")
          .filter((e) => host && e.name.startsWith(host)) as PerformanceResourceTiming[];
        return {
          now: performance.now(),
          pending: (s.queued ?? 0) + (s.downloading ?? 0) + (s.parsing ?? 0),
          loaded: s.loaded ?? 0,
          visible: t?.visibleTiles?.size ?? 0,
          requests: entries.length,
          jsonRequests: entries.filter((e) => e.name.endsWith(".json")).length,
          bytes: entries.reduce((a, e) => a + (e.encodedBodySize || e.transferSize || 0), 0),
          rootReady: Boolean(t?.root),
        };
      },
      ready: true,
    };
  }, [campus, terrain, params]);

  if (!campus) return <div className="p-4 font-mono text-xs">loading campus…</div>;
  return (
    <div style={{ position: "fixed", inset: 0, background: "#e9eef4" }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.NoToneMapping }}
        camera={{ position: [0, 500, 500], fov: 45, near: 1, far: campus.radius * 16 }}
      >
        <color attach="background" args={["#e9eef4"]} />
        <CameraRig pose={pose} />
        <TilesProbe tweak={(params.get("tweak") ?? "").split(",")} />
        {started && <DroneMesh visible />}
      </Canvas>
    </div>
  );
}
