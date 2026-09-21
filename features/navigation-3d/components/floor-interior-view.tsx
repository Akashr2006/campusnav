"use client";

/**
 * Renders a floor's interior: walls with real openings, furniture, fans and
 * lights.
 *
 * A wall with a door in it is built the way a mason builds it — a pier either
 * side, a lintel over the top, and for a window a sill panel underneath too. So
 * every wall becomes a handful of boxes, and because they are all the same unit
 * box scaled per instance, the entire enclosure costs one draw call.
 *
 * That is the pattern throughout: one `InstancedMesh` per material. A floor with
 * 25 walls, 300 desks, 30 fans and 40 light fittings comes to roughly a dozen
 * draw calls, which is what keeps this usable on a phone.
 */
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import {
  INTERIOR,
  type FloorInterior,
  type FurnitureItem,
  type InteriorWall,
} from "../lib/floor-interior";

/** One box to be instanced: centre, size and yaw. */
type Box = {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  yaw: number;
};

function Boxes({
  boxes,
  color,
  roughness = 0.9,
  metalness = 0.02,
  transparent = false,
  opacity = 1,
  emissive,
  emissiveIntensity = 0,
  clippingPlanes,
  castShadow = true,
}: {
  boxes: Box[];
  color: string;
  roughness?: number;
  metalness?: number;
  transparent?: boolean;
  opacity?: number;
  emissive?: string;
  emissiveIntensity?: number;
  clippingPlanes: THREE.Plane[];
  castShadow?: boolean;
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
    boxes.forEach((b, i) => {
      pos.set(b.x, b.y, b.z);
      q.setFromAxisAngle(up, -b.yaw);
      scale.set(Math.max(0.01, b.w), Math.max(0.01, b.h), Math.max(0.01, b.d));
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = boxes.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes]);

  if (!boxes.length) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} castShadow={castShadow} receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        roughness={roughness}
        metalness={metalness}
        transparent={transparent}
        opacity={opacity}
        emissive={emissive ?? "#000000"}
        emissiveIntensity={emissiveIntensity}
        toneMapped={!emissive}
        clippingPlanes={clippingPlanes}
        clipShadows
      />
    </instancedMesh>
  );
}

/** Blades spin only while the floor is assembled; a fan mid-explode is silly. */
function FanBlades({
  boxes,
  clippingPlanes,
  spin,
}: {
  boxes: Box[];
  clippingPlanes: THREE.Plane[];
  spin: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const phase = useRef(0);

  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    if (spin) phase.current += delta * 5.5;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    boxes.forEach((b, i) => {
      pos.set(b.x, b.y, b.z);
      // Each fan offset a little so they are not all in lockstep.
      q.setFromAxisAngle(up, -(b.yaw + phase.current + i * 0.7));
      scale.set(b.w, b.h, b.d);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = boxes.length;
    mesh.instanceMatrix.needsUpdate = true;
  });

  if (!boxes.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={INTERIOR.fan}
        roughness={0.55}
        clippingPlanes={clippingPlanes}
        clipShadows
      />
    </instancedMesh>
  );
}

/* ---------------------------------------------------- wall -> boxes with holes */

/**
 * Cuts a wall into the solid pieces left around its openings.
 *
 * Walks the wall from one end, emitting a full-height pier up to each opening,
 * then the lintel above it and the sill panel below, then carries on. This is
 * what makes a door read as a door rather than a painted rectangle.
 */
function wallToBoxes(w: InteriorWall, yOffset: number): { solid: Box[]; frames: Box[] } {
  const solid: Box[] = [];
  const frames: Box[] = [];
  const h = w.top - w.base;
  const cos = Math.cos(w.angleRad);
  const sin = Math.sin(w.angleRad);
  // A point `d` metres along the wall, `t` metres to its side.
  const at = (d: number) => ({ x: w.from.x + cos * d, z: w.from.z + sin * d });

  const piece = (d0: number, d1: number, y0: number, y1: number, into: Box[], thick = w.thickness) => {
    const len = d1 - d0;
    if (len <= 0.01 || y1 - y0 <= 0.01) return;
    const c = at(d0 + len / 2);
    into.push({
      x: c.x,
      y: w.base + yOffset + (y0 + y1) / 2,
      z: c.z,
      w: len,
      h: y1 - y0,
      d: thick,
      yaw: w.angleRad,
    });
  };

  let cursor = 0;
  for (const o of w.openings) {
    const start = Math.max(0, Math.min(o.at, w.length));
    const end = Math.max(start, Math.min(o.at + o.width, w.length));
    // Pier between the last opening and this one.
    piece(cursor, start, 0, h, solid);
    // Sill panel under a window, lintel over everything.
    if (o.sill > 0.01) piece(start, end, 0, o.sill, solid);
    if (o.head < h - 0.01) piece(start, end, o.head, h, solid);
    // A slim reveal around the opening, in the building's teal-grey.
    frames.push({
      x: at(start + (end - start) / 2).x,
      y: w.base + yOffset + (o.sill + o.head) / 2,
      z: at(start + (end - start) / 2).z,
      w: end - start,
      h: o.head - o.sill,
      d: w.thickness + 0.06,
      yaw: w.angleRad,
    });
    cursor = end;
  }
  piece(cursor, w.length, 0, h, solid);

  return { solid, frames };
}

/* -------------------------------------------------------------------- root */

export function FloorInteriorView({
  interior,
  clippingPlanes,
  ceilingLifted,
  explode,
}: {
  interior: FloorInterior;
  clippingPlanes: THREE.Plane[];
  /** True once the ceiling has been lifted clear, so fans may stop spinning. */
  ceilingLifted: boolean;
  explode: number;
}) {
  // The interior belongs to the floor slab, which under explode stays at index 0
  // and therefore does not move. Kept explicit so it cannot silently drift.
  const yOffset = 0;

  const parts = useMemo(() => {
    const wallSolid: Box[] = [];
    const wallFrames: Box[] = [];
    const glass: Box[] = [];
    const doorLeaves: Box[] = [];
    const skirting: Box[] = [];

    for (const w of interior.walls) {
      const { solid, frames } = wallToBoxes(w, yOffset);
      wallSolid.push(...solid);
      wallFrames.push(...frames);

      // Glazing and door leaves sit inside their reveals.
      for (let i = 0; i < w.openings.length; i++) {
        const o = w.openings[i];
        const f = frames[i];
        if (!f) continue;
        if (o.kind === "WINDOW" || o.kind === "GLAZED") {
          glass.push({ ...f, d: 0.04, h: f.h - 0.12, w: f.w - 0.12 });
        } else if (o.kind === "DOOR") {
          // Ajar, so a doorway reads as a way through rather than a panel.
          doorLeaves.push({
            ...f,
            d: 0.045,
            w: f.w - 0.08,
            h: f.h - 0.06,
            yaw: w.angleRad + 0.5,
          });
        }
      }

      // Skirting, on both faces, in the teal-grey from the photographs.
      const cos = Math.cos(w.angleRad);
      const sin = Math.sin(w.angleRad);
      const c = { x: w.from.x + (cos * w.length) / 2, z: w.from.z + (sin * w.length) / 2 };
      skirting.push({
        x: c.x,
        y: w.base + yOffset + 0.06,
        z: c.z,
        w: w.length,
        h: 0.12,
        d: w.thickness + 0.03,
        yaw: w.angleRad,
      });
    }

    // --- furniture, split by material
    const steelFrames: Box[] = [];
    const tops: Box[] = [];
    const baskets: Box[] = [];

    const legsOf = (f: FurnitureItem) => {
      // Four legs, as a single box each, inset from the top's edges.
      const inset = 0.06;
      const cos = Math.cos(f.angleRad);
      const sin = Math.sin(f.angleRad);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const lx = (sx * (f.width / 2 - inset));
          const lz = (sz * (f.depth / 2 - inset));
          steelFrames.push({
            x: f.at.x + cos * lx - sin * lz,
            y: f.y + yOffset + f.height / 2,
            z: f.at.z + sin * lx + cos * lz,
            w: 0.04,
            h: f.height,
            d: 0.04,
            yaw: f.angleRad,
          });
        }
      }
    };

    for (const f of interior.furniture) {
      if (f.kind === "DESK") {
        tops.push({
          x: f.at.x,
          y: f.y + yOffset + f.height,
          z: f.at.z,
          w: f.width,
          h: 0.04,
          d: f.depth,
          yaw: f.angleRad,
        });
        legsOf(f);
      } else if (f.kind === "BENCH") {
        tops.push({
          x: f.at.x,
          y: f.y + yOffset + f.height,
          z: f.at.z,
          w: f.width,
          h: 0.04,
          d: f.depth * 0.6,
          yaw: f.angleRad,
        });
        legsOf({ ...f, depth: f.depth * 0.6 });
      } else if (f.kind === "DRAFTING_TABLE") {
        // The laminate top, tilted a little the way a drawing board sits.
        tops.push({
          x: f.at.x,
          y: f.y + yOffset + f.height,
          z: f.at.z,
          w: f.width,
          h: 0.035,
          d: f.depth,
          yaw: f.angleRad,
        });
        legsOf(f);
      } else if (f.kind === "DRAFTING_BASKET") {
        baskets.push({
          x: f.at.x,
          y: f.y + yOffset + f.height,
          z: f.at.z,
          w: f.width * 0.55,
          h: 0.16,
          d: f.depth * 0.6,
          yaw: f.angleRad,
        });
      } else if (f.kind === "SHELF") {
        for (let s = 0; s < 4; s++) {
          tops.push({
            x: f.at.x,
            y: f.y + yOffset + 0.4 + s * 0.48,
            z: f.at.z,
            w: f.width,
            h: 0.03,
            d: f.depth,
            yaw: f.angleRad,
          });
        }
        legsOf(f);
      }
    }

    // --- ceiling fittings
    const fanRods: Box[] = [];
    const fanBodies: Box[] = [];
    const fanBlades: Box[] = [];
    const tubes: Box[] = [];
    const tubeBodies: Box[] = [];

    for (const fit of interior.fittings) {
      if (fit.kind === "FAN") {
        fanRods.push({
          x: fit.at.x,
          y: fit.y + yOffset + 0.28,
          z: fit.at.z,
          w: 0.05,
          h: 0.55,
          d: 0.05,
          yaw: fit.angleRad,
        });
        fanBodies.push({
          x: fit.at.x,
          y: fit.y + yOffset,
          z: fit.at.z,
          w: 0.22,
          h: 0.14,
          d: 0.22,
          yaw: fit.angleRad,
        });
        // Three blades, as one cross of thin boxes per fan.
        for (let b = 0; b < 3; b++) {
          fanBlades.push({
            x: fit.at.x,
            y: fit.y + yOffset - 0.02,
            z: fit.at.z,
            w: 1.25,
            h: 0.015,
            d: 0.17,
            yaw: fit.angleRad + (b * Math.PI * 2) / 3,
          });
        }
      } else {
        tubeBodies.push({
          x: fit.at.x,
          y: fit.y + yOffset,
          z: fit.at.z,
          w: 1.25,
          h: 0.07,
          d: 0.16,
          yaw: fit.angleRad,
        });
        tubes.push({
          x: fit.at.x,
          y: fit.y + yOffset - 0.05,
          z: fit.at.z,
          w: 1.2,
          h: 0.035,
          d: 0.06,
          yaw: fit.angleRad,
        });
      }
    }

    return {
      wallSolid,
      wallFrames,
      glass,
      doorLeaves,
      skirting,
      steelFrames,
      tops,
      baskets,
      fanRods,
      fanBodies,
      fanBlades,
      tubes,
      tubeBodies,
    };
  }, [interior]);

  return (
    <group>
      <Boxes boxes={parts.wallSolid} color={INTERIOR.wall} roughness={0.95} clippingPlanes={clippingPlanes} />
      <Boxes boxes={parts.skirting} color={INTERIOR.skirting} roughness={0.7} clippingPlanes={clippingPlanes} />
      <Boxes boxes={parts.wallFrames} color={INTERIOR.frame} roughness={0.6} metalness={0.15} clippingPlanes={clippingPlanes} />
      <Boxes
        boxes={parts.glass}
        color={INTERIOR.glass}
        roughness={0.12}
        metalness={0.1}
        transparent
        opacity={0.32}
        clippingPlanes={clippingPlanes}
        castShadow={false}
      />
      <Boxes boxes={parts.doorLeaves} color={INTERIOR.doorLeaf} roughness={0.8} clippingPlanes={clippingPlanes} />

      <Boxes boxes={parts.steelFrames} color={INTERIOR.steel} roughness={0.5} metalness={0.35} clippingPlanes={clippingPlanes} />
      <Boxes boxes={parts.tops} color={INTERIOR.deskTop} roughness={0.65} clippingPlanes={clippingPlanes} />
      <Boxes boxes={parts.baskets} color={INTERIOR.steel} roughness={0.6} metalness={0.4} clippingPlanes={clippingPlanes} />

      <Boxes boxes={parts.fanRods} color={INTERIOR.steel} roughness={0.5} metalness={0.3} clippingPlanes={clippingPlanes} castShadow={false} />
      <Boxes boxes={parts.fanBodies} color={INTERIOR.fan} roughness={0.5} clippingPlanes={clippingPlanes} castShadow={false} />
      <FanBlades boxes={parts.fanBlades} clippingPlanes={clippingPlanes} spin={!ceilingLifted && explode < 0.05} />

      <Boxes boxes={parts.tubeBodies} color={INTERIOR.fan} roughness={0.6} clippingPlanes={clippingPlanes} castShadow={false} />
      <Boxes
        boxes={parts.tubes}
        color={INTERIOR.tube}
        emissive={INTERIOR.tube}
        emissiveIntensity={2.4}
        roughness={0.4}
        clippingPlanes={clippingPlanes}
        castShadow={false}
      />
    </group>
  );
}
