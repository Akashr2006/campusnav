/**
 * Straightens a building outline traced from the drone photo, for the 2D plan.
 *
 * The survey's roof outlines follow the photo's pixels: walls that are
 * straight on the ground come out as zig-zags, and right-angled corners as
 * bevels. Campus buildings are almost all rectilinear, so: find the building's
 * own axis (the length-weighted direction of its edges, modulo 90 degrees),
 * snap every edge within 25 degrees of that axis onto it, merge the runs that
 * end up collinear, drop steps shorter than a metre and a bit, and put the
 * corners where the snapped walls meet. Edges well off the axis (a splayed
 * wing, a round end) stay as they were.
 *
 * The result keeps the building's size and place: if straightening changes
 * the area by more than 12%, or folds the outline over itself, the outline is
 * only simplified instead. Frame: scene metres, X east, Z south.
 */
import type { Vec2 } from "@/features/navigation-3d/lib/campus-3d";

const SNAP_DEG = 25;
/** Steps in a wall shorter than this (metres) are survey noise, not architecture. */
const MIN_STEP = 1.2;
const MAX_AREA_CHANGE = 0.12;

function area(o: Vec2[]) {
  let a = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** The building's axis (radians, 0..pi/2): the peak of a length-weighted histogram of edge directions mod 90 deg. */
export function dominantAngle(o: Vec2[]): number {
  const bins = new Float64Array(90);
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    if (len < 1e-6) continue;
    let deg = (Math.atan2(q.z - p.z, q.x - p.x) * 180) / Math.PI;
    deg = ((deg % 90) + 90) % 90;
    // Spread over neighbouring bins, so a wall at 44.6 and one at 45.3 agree.
    for (let d = -3; d <= 3; d++) bins[(Math.round(deg) + d + 90) % 90] += len * (1 - Math.abs(d) / 4);
  }
  let best = 0;
  for (let b = 1; b < 90; b++) if (bins[b] > bins[best]) best = b;
  // Refine: the length-weighted mean of the edges near the peak.
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < o.length; i++) {
    const p = o[i];
    const q = o[(i + 1) % o.length];
    const len = Math.hypot(q.x - p.x, q.z - p.z);
    let deg = (Math.atan2(q.z - p.z, q.x - p.x) * 180) / Math.PI;
    deg = ((deg % 90) + 90) % 90;
    let diff = deg - best;
    if (diff > 45) diff -= 90;
    if (diff < -45) diff += 90;
    if (Math.abs(diff) > 6) continue;
    // Average on the circle of period 90 degrees (angles x4).
    const r = ((best + diff) * 4 * Math.PI) / 180;
    sx += Math.cos(r) * len;
    sy += Math.sin(r) * len;
  }
  const mean = Math.atan2(sy, sx) / 4;
  return ((mean % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
}

/** Douglas-Peucker on a closed ring. */
export function simplifyRing(o: Vec2[], tol: number): Vec2[] {
  if (o.length <= 4) return o;
  const dp = (pts: Vec2[]): Vec2[] => {
    if (pts.length < 3) return pts;
    const a = pts[0];
    const b = pts[pts.length - 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1e-9;
    let worst = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((pts[i].x - a.x) * dz - (pts[i].z - a.z) * dx) / l;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst <= tol) return [a, b];
    return [...dp(pts.slice(0, at + 1)).slice(0, -1), ...dp(pts.slice(at))];
  };
  // Split the ring at its two farthest-apart points.
  let far = 0;
  for (let i = 1; i < o.length; i++) if (Math.hypot(o[i].x - o[0].x, o[i].z - o[0].z) > Math.hypot(o[far].x - o[0].x, o[far].z - o[0].z)) far = i;
  const first = dp(o.slice(0, far + 1));
  const second = dp([...o.slice(far), o[0]]);
  const out = [...first.slice(0, -1), ...second.slice(0, -1)];
  return out.length >= 3 ? out : o;
}

type Run = { kind: "h" | "v" | "d"; a: Vec2; b: Vec2; len: number; c: number };

/** Whether any two non-adjacent edges of the ring cross. */
function selfIntersects(o: Vec2[]) {
  const n = o.length;
  const cross = (p: Vec2, q: Vec2, r: Vec2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  for (let i = 0; i < n; i++) {
    const a = o[i];
    const b = o[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = o[j];
      const d = o[(j + 1) % n];
      const d1 = cross(a, b, c);
      const d2 = cross(a, b, d);
      const d3 = cross(c, d, a);
      const d4 = cross(c, d, b);
      if (d1 * d2 < 0 && d3 * d4 < 0) return true;
    }
  }
  return false;
}

export function neatOutline(outline: Vec2[]): Vec2[] {
  if (outline.length < 4) return outline;
  const base = simplifyRing(outline, 0.6);
  const theta = dominantAngle(base);
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Into the building's frame: its axis along x.
  const toLocal = (p: Vec2) => ({ x: p.x * cos + p.z * sin, z: -p.x * sin + p.z * cos });
  const toWorld = (p: Vec2) => ({ x: p.x * cos - p.z * sin, z: p.x * sin + p.z * cos });
  const local = base.map(toLocal);

  // 1. Classify each edge and merge consecutive ones of the same kind into runs.
  const snap = Math.tan((SNAP_DEG * Math.PI) / 180);
  let runs: Run[] = [];
  for (let i = 0; i < local.length; i++) {
    const a = local[i];
    const b = local[(i + 1) % local.length];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const kind: Run["kind"] = Math.abs(dz) <= snap * Math.abs(dx) ? "h" : Math.abs(dx) <= snap * Math.abs(dz) ? "v" : "d";
    const prev = runs[runs.length - 1];
    if (prev && prev.kind === kind && kind !== "d") {
      prev.b = b;
      prev.c = (prev.c * prev.len + (kind === "h" ? (a.z + b.z) / 2 : (a.x + b.x) / 2) * len) / (prev.len + len);
      prev.len += len;
    } else runs.push({ kind, a, b, len, c: kind === "h" ? (a.z + b.z) / 2 : kind === "v" ? (a.x + b.x) / 2 : 0 });
  }
  // The ring may start in the middle of a run.
  if (runs.length > 1 && runs[0].kind === runs[runs.length - 1].kind && runs[0].kind !== "d") {
    const last = runs.pop()!;
    const first = runs[0];
    first.c = (first.c * first.len + last.c * last.len) / (first.len + last.len);
    first.len += last.len;
    first.a = last.a;
  }

  // 2. Short steps between two parallel walls (h, short v, h): one wall.
  for (let changed = true; changed && runs.length > 4; ) {
    changed = false;
    for (let i = 0; i < runs.length && runs.length > 4; i++) {
      const r = runs[i];
      const prev = runs[(i - 1 + runs.length) % runs.length];
      const next = runs[(i + 1) % runs.length];
      if (r.kind === "d" || prev.kind !== next.kind || prev.kind === r.kind || prev.kind === "d") continue;
      if (Math.abs(prev.c - next.c) >= MIN_STEP && r.len >= MIN_STEP) continue;
      // Merge prev, r and next into one wall at their weighted line.
      prev.c = (prev.c * prev.len + next.c * next.len) / (prev.len + next.len);
      prev.len += next.len;
      prev.b = next.b;
      const ni = (i + 1) % runs.length;
      runs = runs.filter((_, k) => k !== i && k !== ni);
      changed = true;
      break;
    }
  }
  if (runs.length < 3) return base;

  // 3. Corners where consecutive runs meet.
  const lineOf = (r: Run) =>
    r.kind === "h"
      ? { p: { x: 0, z: r.c }, d: { x: 1, z: 0 } }
      : r.kind === "v"
        ? { p: { x: r.c, z: 0 }, d: { x: 0, z: 1 } }
        : { p: r.a, d: { x: r.b.x - r.a.x, z: r.b.z - r.a.z } };
  const corners: Vec2[] = [];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const s = runs[(i + 1) % runs.length];
    const L1 = lineOf(r);
    const L2 = lineOf(s);
    const den = L1.d.x * L2.d.z - L1.d.z * L2.d.x;
    if (Math.abs(den) < 1e-9) {
      // Parallel (two walls a step apart after all): keep the step, at the shared end.
      const m = r.b;
      corners.push(r.kind === "h" ? { x: m.x, z: r.c } : r.kind === "v" ? { x: r.c, z: m.z } : m);
      corners.push(s.kind === "h" ? { x: m.x, z: s.c } : s.kind === "v" ? { x: s.c, z: m.z } : m);
      continue;
    }
    const t = ((L2.p.x - L1.p.x) * L2.d.z - (L2.p.z - L1.p.z) * L2.d.x) / den;
    corners.push({ x: L1.p.x + L1.d.x * t, z: L1.p.z + L1.d.z * t });
  }
  const neat = corners.map(toWorld);
  const a0 = Math.abs(area(base));
  const a1 = Math.abs(area(neat));
  if (neat.length < 3 || !Number.isFinite(a1) || Math.abs(a1 - a0) > MAX_AREA_CHANGE * a0 || selfIntersects(neat)) return base;
  return neat;
}
