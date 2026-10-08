import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dominantAngle, neatOutline, simplifyRing } from "../features/navigation/lib/neat-outline";
import type { Vec2 } from "../features/navigation-3d/lib/campus-3d";

const area = (o: Vec2[]) => Math.abs(o.reduce((s, p, i) => s + p.x * o[(i + 1) % o.length].z - o[(i + 1) % o.length].x * p.z, 0)) / 2;
const rotate = (o: Vec2[], deg: number) => {
  const r = (deg * Math.PI) / 180;
  return o.map((p) => ({ x: p.x * Math.cos(r) - p.z * Math.sin(r), z: p.x * Math.sin(r) + p.z * Math.cos(r) }));
};
/** A traced-from-pixels version of a polygon: points every metre, jittered up to 0.4 m across the wall. */
function traced(o: Vec2[], seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out: Vec2[] = [];
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const nx = -(b.z - a.z) / len;
    const nz = (b.x - a.x) / len;
    for (let k = 0; k < Math.ceil(len); k++) {
      const t = k / Math.ceil(len);
      const j = k === 0 ? 0 : rnd() * 0.4;
      out.push({ x: a.x + (b.x - a.x) * t + nx * j, z: a.z + (b.z - a.z) * t + nz * j });
    }
  }
  return out;
}
/** Every edge within a degree of the axis or square to it. */
function rectilinear(o: Vec2[], deg: number) {
  return o.every((p, i) => {
    const q = o[(i + 1) % o.length];
    let a = (Math.atan2(q.z - p.z, q.x - p.x) * 180) / Math.PI - deg;
    a = ((a % 90) + 90) % 90;
    return a < 1 || a > 89;
  });
}

describe("neat building outlines", () => {
  const rect: Vec2[] = [
    { x: 0, z: 0 },
    { x: 60, z: 0 },
    { x: 60, z: 18 },
    { x: 0, z: 18 },
  ];
  const ell: Vec2[] = [
    { x: 0, z: 0 },
    { x: 50, z: 0 },
    { x: 50, z: 14 },
    { x: 16, z: 14 },
    { x: 16, z: 40 },
    { x: 0, z: 40 },
  ];

  it("finds a building's own axis", () => {
    // On the outline as neatOutline sees it: simplified to 0.6 m first.
    expect((dominantAngle(simplifyRing(traced(rotate(rect, 30)), 0.6)) * 180) / Math.PI).toBeCloseTo(30, 0);
    expect((dominantAngle(simplifyRing(traced(rotate(rect, 72)), 0.6)) * 180) / Math.PI).toBeCloseTo(72, 0);
  });

  it("turns a jagged traced rectangle back into four square corners", () => {
    const neat = neatOutline(traced(rotate(rect, 30)));
    expect(neat.length).toBe(4);
    expect(rectilinear(neat, 30)).toBe(true);
    expect(Math.abs(area(neat) - 60 * 18) / (60 * 18)).toBeLessThan(0.03);
  });

  it("keeps an L-shaped block's six corners", () => {
    const neat = neatOutline(traced(rotate(ell, -12), 7));
    expect(neat.length).toBe(6);
    expect(rectilinear(neat, -12 + 90)).toBe(true);
    expect(Math.abs(area(neat) - area(ell)) / area(ell)).toBeLessThan(0.04);
  });

  it("drops a step in a wall shorter than a metre", () => {
    const stepped: Vec2[] = [
      { x: 0, z: 0 },
      { x: 30, z: 0 },
      { x: 30, z: 0.6 },
      { x: 60, z: 0.6 },
      { x: 60, z: 20 },
      { x: 0, z: 20 },
    ];
    expect(neatOutline(stepped).length).toBe(4);
  });

  const FOOTPRINTS = resolve(__dirname, "../public/drone/footprints.json");
  it("straightens every surveyed roof without moving or resizing it", () => {
    const fps = JSON.parse(readFileSync(FOOTPRINTS, "utf-8")).footprints as { outline: [number, number][] }[];
    /** Share of the perimeter square to the building's own axis (within a degree). */
    const square = (o: Vec2[]) => {
      const deg = (dominantAngle(o) * 180) / Math.PI;
      let ok = 0;
      let all = 0;
      o.forEach((p, i) => {
        const q = o[(i + 1) % o.length];
        const len = Math.hypot(q.x - p.x, q.z - p.z);
        let a = (Math.atan2(q.z - p.z, q.x - p.x) * 180) / Math.PI - deg;
        a = ((a % 90) + 90) % 90;
        all += len;
        if (a < 1 || a > 89) ok += len;
      });
      return ok / all;
    };
    let before = 0;
    let after = 0;
    for (const f of fps) {
      const o = f.outline.map(([x, z]) => ({ x, z }));
      const neat = neatOutline(o);
      expect(neat.length).toBeGreaterThanOrEqual(3);
      expect(Math.abs(area(neat) - area(o)) / area(o)).toBeLessThan(0.13);
      const bbox = (p: Vec2[]) => [Math.min(...p.map((q) => q.x)), Math.max(...p.map((q) => q.x)), Math.min(...p.map((q) => q.z)), Math.max(...p.map((q) => q.z))];
      const [a0, a1, b0, b1] = bbox(o);
      const [n0, n1, m0, m1] = bbox(neat);
      expect(Math.abs((a0 + a1) / 2 - (n0 + n1) / 2)).toBeLessThan(3);
      expect(Math.abs((b0 + b1) / 2 - (m0 + m1) / 2)).toBeLessThan(3);
      before += square(o) * area(o);
      after += square(neat) * area(neat);
    }
    const total = fps.reduce((s, f) => s + area(f.outline.map(([x, z]) => ({ x, z }))), 0);
    // Walls come out square: most of the campus's wall length, weighted by building size.
    expect(after / total).toBeGreaterThan(0.85);
    expect(after).toBeGreaterThan(before * 1.5);
  });
});
