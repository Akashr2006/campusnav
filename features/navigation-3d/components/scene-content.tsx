"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Campus3D, Vec2 } from "../lib/campus-3d";
import { pointInPolygon, distanceToPolygonEdge } from "../lib/building-structure";
import { METRES_PER_STOREY } from "../lib/campus-3d";
import type { Terrain } from "../lib/terrain";

/**
 * Procedural content for realistic mode. Everything here is generated from the
 * campus geometry at load time — no image assets, no network — so it works
 * offline and stays consistent with the traced data.
 */

/* --------------------------------------------------------------- textures */

/**
 * One storey of facade: wall, a window with a dark reveal and a lighter sill.
 * Tiled by ExtrudeGeometry's world-space side UVs, so `repeat` is in 1/metres
 * and the same texture fits every building at the right window pitch.
 */
export function makeFacadeTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  // Render (light plaster) with a hint of weathering.
  g.fillStyle = "#d8d3c8";
  g.fillRect(0, 0, size, size);
  const grain = g.createLinearGradient(0, 0, 0, size);
  grain.addColorStop(0, "rgba(0,0,0,0)");
  grain.addColorStop(1, "rgba(0,0,0,0.08)");
  g.fillStyle = grain;
  g.fillRect(0, 0, size, size);
  // Window: reveal, glass, frame, sill.
  const wx = size * 0.28;
  const wy = size * 0.22;
  const ww = size * 0.44;
  const wh = size * 0.5;
  g.fillStyle = "#4a5361";
  g.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);
  const glass = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
  glass.addColorStop(0, "#9fb6c9");
  glass.addColorStop(0.5, "#6e8598");
  glass.addColorStop(1, "#3f4f5f");
  g.fillStyle = glass;
  g.fillRect(wx, wy, ww, wh);
  g.strokeStyle = "rgba(230,235,240,0.7)";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(wx + ww / 2, wy);
  g.lineTo(wx + ww / 2, wy + wh);
  g.moveTo(wx, wy + wh / 2);
  g.lineTo(wx + ww, wy + wh / 2);
  g.stroke();
  g.fillStyle = "#eae6dc";
  g.fillRect(wx - 10, wy + wh + 6, ww + 20, 8);
  g.fillStyle = "rgba(0,0,0,0.18)";
  g.fillRect(wx - 10, wy + wh + 14, ww + 20, 6);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  // One window every 4 m along the wall, one row per storey up it.
  tex.repeat.set(1 / 4, 1 / METRES_PER_STOREY);
  return tex;
}

/** Flat roof: a slightly darker membrane with a faint grid of paving. */
export function makeRoofTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#b9b3a6";
  g.fillRect(0, 0, size, size);
  g.strokeStyle = "rgba(0,0,0,0.12)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(1 / 6, 1 / 6);
  return tex;
}

/** Grass: low-frequency mottling so the ground is not one flat green. */
export function makeGrassTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#6f8a5a";
  g.fillRect(0, 0, size, size);
  const rnd = mulberry32(7);
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 6 + rnd() * 22;
    const light = rnd() > 0.5;
    g.fillStyle = light ? "rgba(140,170,110,0.18)" : "rgba(70,95,55,0.2)";
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.repeat.set(1 / 40, 1 / 40);
  return tex;
}

/** Small deterministic PRNG so the scene lays out identically on every load. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ trees */

export type TreeSpot = { x: number; z: number; scale: number; rot: number };

/**
 * Scatter trees across the campus: inside the boundary, clear of every
 * building (with a margin for its shadow and access), and clear of the paths.
 * Rejection sampling with a seeded PRNG; count is capped so a big campus does
 * not turn into a forest.
 */
export function planTrees(campus: Campus3D, target = 260, seed = 42): TreeSpot[] {
  if (campus.boundary.length < 3) return [];
  const rnd = mulberry32(seed);
  const xs = campus.boundary.map((p) => p.x);
  const zs = campus.boundary.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const buildingMargin = 4;
  const pathMargin = 4;
  const spacing = 7;
  const out: TreeSpot[] = [];

  const nearPath = (p: Vec2) =>
    campus.edges.some((e) => segmentDistance(p, e.from, e.to) < pathMargin);

  let tries = 0;
  while (out.length < target && tries < target * 40) {
    tries++;
    const p = { x: minX + rnd() * (maxX - minX), z: minZ + rnd() * (maxZ - minZ) };
    if (!pointInPolygon(p, campus.boundary)) continue;
    if (distanceToPolygonEdge(p, campus.boundary) < 3) continue;
    if (
      campus.buildings.some(
        (b) => pointInPolygon(p, b.outline) || distanceToPolygonEdge(p, b.outline) < buildingMargin
      )
    )
      continue;
    if (nearPath(p)) continue;
    if (out.some((t) => Math.hypot(t.x - p.x, t.z - p.z) < spacing)) continue;
    out.push({ x: p.x, z: p.z, scale: 0.8 + rnd() * 0.6, rot: rnd() * Math.PI * 2 });
  }
  return out;
}

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Instanced trees: one draw call for trunks, one for canopies. */
export function Trees({ campus, terrain }: { campus: Campus3D; terrain: Terrain }) {
  const spots = useMemo(() => planTrees(campus), [campus]);

  const trunkGeo = useMemo(() => new THREE.CylinderGeometry(0.28, 0.4, 3.2, 6), []);
  const canopyGeo = useMemo(() => new THREE.IcosahedronGeometry(2.6, 1), []);
  useEffect(
    () => () => {
      trunkGeo.dispose();
      canopyGeo.dispose();
    },
    [trunkGeo, canopyGeo]
  );

  const { trunks, canopies } = useMemo(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const v = new THREE.Vector3();
    const trunks = new Float32Array(spots.length * 16);
    const canopies = new Float32Array(spots.length * 16);
    spots.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.rot);
      s.set(t.scale, t.scale, t.scale);
      const y = terrain.heightAt(t.x, t.z);
      v.set(t.x, y + 1.6 * t.scale, t.z);
      m.compose(v, q, s);
      m.toArray(trunks, i * 16);
      v.set(t.x, y + 3.2 * t.scale + 2.2 * t.scale, t.z);
      s.set(t.scale * (0.9 + (i % 3) * 0.1), t.scale * 1.15, t.scale);
      m.compose(v, q, s);
      m.toArray(canopies, i * 16);
    });
    return { trunks, canopies };
  }, [spots, terrain]);

  if (!spots.length) return null;

  return (
    <group>
      <instancedMesh
        args={[trunkGeo, undefined, spots.length]}
        castShadow
        receiveShadow
        instanceMatrix={new THREE.InstancedBufferAttribute(trunks, 16)}
      >
        <meshStandardMaterial color="#5a4632" roughness={0.95} />
      </instancedMesh>
      <instancedMesh
        args={[canopyGeo, undefined, spots.length]}
        castShadow
        receiveShadow
        instanceMatrix={new THREE.InstancedBufferAttribute(canopies, 16)}
      >
        <meshStandardMaterial color="#3f6b3a" roughness={0.9} flatShading />
      </instancedMesh>
    </group>
  );
}
