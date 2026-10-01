/**
 * Routing over the roads and walking paths detected from the drone survey
 * (public/drone/paths.json, made by tools/drone/build-paths.mjs), with
 * turn-by-turn directions that name the buildings you pass.
 *
 * The file holds only the network. Places are linked to it here, at run time,
 * so a building renamed or re-traced in the admin editor needs no rebuild:
 * every place gets up to three doors, on the paths nearest its outline (on
 * different sides when it has them), and a route ends at whichever door is
 * best. Frame: scene metres, X east, Z south (the 3D view's).
 */
import type { Vec2 } from "@/features/navigation-3d/lib/campus-3d";

export type PathKind = "road" | "path" | "link";

export type PathNetworkFile = {
  nodes: [number, number][];
  edges: { a: number; b: number; kind: PathKind; w: number; len: number; pts: number[] }[];
};

/** Anything a route can start or end at. `walkThrough`: people may cut through its ground floor (academic blocks, not hostels or halls). */
export type RoutePlace = { key: string; name: string | null; polygons: Vec2[][]; centre: Vec2; land?: boolean; walkThrough?: boolean };

export type RouteEnd = { place: string } | { point: Vec2; name?: string };

export type StepIcon = "start" | "straight" | "slight-left" | "slight-right" | "left" | "right" | "u-turn" | "arrive" | "shuttle" | "walk";

export type RouteStep = { text: string; distance: number; icon: StepIcon; at: Vec2 };

export type NetworkRoute = {
  path: Vec2[];
  distance: number;
  durationSec: number;
  steps: RouteStep[];
  /** Metres driven, when the EV shuttle takes the road part. */
  rideDistance: number;
};

export type TravelMode = "WALK" | "EV";

/** Speeds the rest of the app uses (lib/routing/edge-accessibility.ts). */
const WALK_SPEED = 1.3;
const EV_SPEED = 5.5;
/** Hidden or guessed stretches cost a little more, so a seen road wins a tie. */
const LINK_PENALTY = 1.15;
/** A door this far from every path still links the place, as a straight walk. */
const DOOR_REACH = 60;
const FAR_DOOR_REACH = 160;

type EdgeKind = PathKind | "door" | "through";
/** `via`: the building a "through" edge crosses. */
type Edge = { a: number; b: number; kind: EdgeKind; pts: Vec2[]; len: number; via?: string };
/** Walking through a building is slower than outside (doors, corridors, stairs to the lobby). */
const THROUGH_PENALTY = 1.6;

const dist = (p: Vec2, q: Vec2) => Math.hypot(p.x - q.x, p.z - q.z);

function lengthOf(pts: Vec2[]) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

/** Nearest point on segment ab to p, with its parameter. */
function project(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
  return { t, point: { x: a.x + t * dx, z: a.z + t * dz } };
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

/** Distance from p to a polygon's edge (0 inside). */
function distanceToPolygon(p: Vec2, poly: Vec2[]): number {
  if (pointInPolygon(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, dist(p, project(p, poly[i], poly[(i + 1) % poly.length]).point));
  return best;
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];
  get size() {
    return this.keys.length;
  }
  push(key: number, val: number) {
    const { keys, vals } = this;
    keys.push(key);
    vals.push(val);
    let i = keys.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [keys[p], keys[i]] = [keys[i], keys[p]];
      [vals[p], vals[i]] = [vals[i], vals[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { keys, vals } = this;
    const top: [number, number] = [keys[0], vals[0]];
    const k = keys.pop()!;
    const v = vals.pop()!;
    if (keys.length) {
      keys[0] = k;
      vals[0] = v;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < keys.length && keys[l] < keys[m]) m = l;
        if (r < keys.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [vals[m], vals[i]] = [vals[i], vals[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Buckets of segments, for "nearest path to here" queries. */
class SegmentGrid {
  private cells = new Map<string, [number, number][]>();
  constructor(
    private edges: Edge[],
    private size = 25
  ) {
    edges.forEach((e, i) => this.add(i));
  }
  private key(cx: number, cz: number) {
    return `${cx},${cz}`;
  }
  add(i: number) {
    const e = this.edges[i];
    if (e.kind === "door" || e.kind === "through") return;
    for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1];
      const b = e.pts[k];
      const x0 = Math.floor(Math.min(a.x, b.x) / this.size);
      const x1 = Math.floor(Math.max(a.x, b.x) / this.size);
      const z0 = Math.floor(Math.min(a.z, b.z) / this.size);
      const z1 = Math.floor(Math.max(a.z, b.z) / this.size);
      for (let cx = x0; cx <= x1; cx++)
        for (let cz = z0; cz <= z1; cz++) {
          const key = this.key(cx, cz);
          const list = this.cells.get(key);
          if (list) list.push([i, k]);
          else this.cells.set(key, [[i, k]]);
        }
    }
  }
  /** Nearest point on any (accepted) edge within `reach` metres. */
  nearest(p: Vec2, reach: number, accept: (edge: number) => boolean = () => true) {
    let best: { edge: number; seg: number; point: Vec2; d: number } | null = null;
    const r = Math.ceil(reach / this.size);
    const cx = Math.floor(p.x / this.size);
    const cz = Math.floor(p.z / this.size);
    const seen = new Set<string>();
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        for (const [i, k] of this.cells.get(this.key(cx + dx, cz + dz)) ?? []) {
          const id = `${i}:${k}`;
          if (seen.has(id) || !accept(i)) continue;
          seen.add(id);
          const e = this.edges[i];
          const { point } = project(p, e.pts[k - 1], e.pts[k]);
          const d = dist(p, point);
          if (d <= reach && (!best || d < best.d)) best = { edge: i, seg: k, point, d };
        }
      }
    return best;
  }
}

/** Where along an edge (in metres from its start) a point on segment k lies. */
function offsetAlong(e: Edge, seg: number, point: Vec2) {
  let s = 0;
  for (let k = 1; k < seg; k++) s += dist(e.pts[k - 1], e.pts[k]);
  return s + dist(e.pts[seg - 1], point);
}

/** The part of an edge's polyline between two offsets (metres from its start). */
function slice(pts: Vec2[], from: number, to: number): Vec2[] {
  const out: Vec2[] = [];
  let s = 0;
  const at = (a: Vec2, b: Vec2, d: number) => {
    const l = dist(a, b) || 1e-9;
    return { x: a.x + ((b.x - a.x) * d) / l, z: a.z + ((b.z - a.z) * d) / l };
  };
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const l = dist(a, b);
    if (s + l >= from && s <= to) {
      if (!out.length) out.push(from > s ? at(a, b, from - s) : a);
      if (to < s + l) {
        out.push(at(a, b, to - s));
        break;
      }
      out.push(b);
    }
    s += l;
  }
  return out;
}

const CARDINALS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/** Compass name of a heading in scene axes (north is -Z). */
export function cardinal(h: Vec2): string {
  const deg = ((Math.atan2(h.x, -h.z) * 180) / Math.PI + 360) % 360;
  return CARDINALS[Math.round(deg / 45) % 8];
}

/** Signed turn from heading h1 to h2 in degrees; positive is a right turn (X east, Z south). */
export function turnAngle(h1: Vec2, h2: Vec2): number {
  const cross = h1.x * h2.z - h1.z * h2.x;
  const dot = h1.x * h2.x + h1.z * h2.z;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

/** Distances people say: 5 m steps under 100 m, then 10 m. */
export function roundDistance(m: number) {
  return m < 100 ? Math.max(5, Math.round(m / 5) * 5) : Math.round(m / 10) * 10;
}

export type PathRouter = {
  route: (from: RouteEnd, to: RouteEnd, mode?: TravelMode) => NetworkRoute | null;
  /** The network as drawable lines (roads, paths and gap links). */
  lines: { kind: PathKind; pts: Vec2[] }[];
  /** Where a place meets the network: each door and the path point it joins. */
  doorsOf: (key: string) => { at: Vec2; joins: Vec2 }[];
};

export function createPathRouter(file: PathNetworkFile, places: RoutePlace[]): PathRouter {
  const nodes: Vec2[] = file.nodes.map(([x, z]) => ({ x, z }));
  let edges: Edge[] = file.edges.map((e) => {
    const pts = [nodes[e.a]];
    for (let k = 0; k < e.pts.length; k += 2) pts.push({ x: e.pts[k], z: e.pts[k + 1] });
    pts.push(nodes[e.b]);
    return { a: e.a, b: e.b, kind: e.kind, pts, len: lengthOf(pts) };
  });
  const lines = edges.map((e) => ({ kind: e.kind as PathKind, pts: e.pts }));

  // Connected parts of the network, and the largest.
  const component = (() => {
    const comp = new Int32Array(nodes.length).fill(-1);
    const adj: number[][] = nodes.map(() => []);
    edges.forEach((e) => {
      adj[e.a].push(e.b);
      adj[e.b].push(e.a);
    });
    let n = 0;
    for (let v = 0; v < nodes.length; v++) {
      if (comp[v] >= 0) continue;
      const stack = [v];
      comp[v] = n;
      while (stack.length) {
        const u = stack.pop()!;
        for (const w of adj[u])
          if (comp[w] < 0) {
            comp[w] = n;
            stack.push(w);
          }
      }
      n++;
    }
    return comp;
  })();
  const sizes = new Map<number, number>();
  edges.forEach((e) => sizes.set(component[e.a], (sizes.get(component[e.a]) ?? 0) + e.len));
  const main = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const grid = new SegmentGrid(edges);

  // ---- doors: where each place meets the network
  type Door = { place: string; at: Vec2; edge: number; seg: number; point: Vec2; d: number };
  const doorsByPlace = new Map<string, Door[]>();
  for (const place of places) {
    const samples: Vec2[] = [];
    for (const poly of place.polygons) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const n = Math.max(1, Math.ceil(dist(a, b) / 2));
        for (let k = 0; k < n; k++) samples.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
      }
    }
    if (!samples.length) samples.push(place.centre);
    const found: Door[] = [];
    for (const s of samples) {
      const hit = grid.nearest(s, DOOR_REACH);
      if (hit) found.push({ place: place.key, at: s, ...hit });
    }
    // Nearest first; among near-equals, the one mid-way along the facing side
    // (nearest the centre) rather than a corner.
    found.sort((p, q) => p.d - q.d);
    if (found.length) {
      const tied = found.filter((f) => f.d <= found[0].d + 2);
      const mid = tied.reduce((b, f) => (dist(f.at, place.centre) < dist(b.at, place.centre) ? f : b), tied[0]);
      found.splice(found.indexOf(mid), 1);
      found.unshift(mid);
    }
    const doors: Door[] = [];
    for (const f of found) {
      if (doors.length >= 3) break;
      // Another door only on a different stretch of path, and not much further away.
      if (doors.some((d) => dist(d.point, f.point) < 25)) continue;
      if (doors.length && f.d > doors[0].d + 20) break;
      doors.push(f);
    }
    // Always reachable from the main network, if need be by a longer walk.
    if (!doors.some((d) => component[edges[d.edge].a] === main)) {
      let best: Door | null = null;
      for (const s of samples) {
        const hit = grid.nearest(s, FAR_DOOR_REACH, (i) => component[edges[i].a] === main);
        if (hit && (!best || hit.d < best.d)) best = { place: place.key, at: s, ...hit };
      }
      if (best) doors.push(best);
    }
    doorsByPlace.set(place.key, doors);
  }

  // Split edges where doors join them, once, then add the door edges.
  const cuts = new Map<number, { off: number; node: number }[]>();
  const placeDoorNodes = new Map<string, number[]>();
  const addNode = (p: Vec2) => nodes.push(p) - 1;
  for (const [key, doors] of doorsByPlace) {
    const ids: number[] = [];
    for (const d of doors) {
      const e = edges[d.edge];
      const off = offsetAlong(e, d.seg, d.point);
      let join: number;
      if (off < 1) join = e.a;
      else if (e.len - off < 1) join = e.b;
      else {
        const list = cuts.get(d.edge) ?? [];
        const near = list.find((c) => Math.abs(c.off - off) < 1);
        join = near?.node ?? addNode(d.point);
        if (!near) list.push({ off, node: join });
        cuts.set(d.edge, list);
      }
      const door = addNode(d.at);
      ids.push(door);
      edges.push({ a: door, b: join, kind: "door", pts: [d.at, nodes[join]], len: Math.max(0.1, d.d) });
    }
    placeDoorNodes.set(key, ids);
    // An academic block can be walked through, door to door (its ground floor),
    // as people do on campus rather than walking right round it.
    const place = places.find((p) => p.key === key);
    if (place?.name && place.walkThrough && !place.land) {
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++)
          edges.push({ a: ids[i], b: ids[j], kind: "through", pts: [nodes[ids[i]], nodes[ids[j]]], len: dist(nodes[ids[i]], nodes[ids[j]]), via: place.name });
    }
  }
  const split: Edge[] = [];
  edges.forEach((e, i) => {
    const list = cuts.get(i);
    if (!list) {
      split.push(e);
      return;
    }
    list.sort((p, q) => p.off - q.off);
    let prevNode = e.a;
    let prevOff = 0;
    for (const c of list) {
      const pts = slice(e.pts, prevOff, c.off);
      pts[pts.length - 1] = nodes[c.node];
      split.push({ a: prevNode, b: c.node, kind: e.kind, pts, len: lengthOf(pts) });
      prevNode = c.node;
      prevOff = c.off;
    }
    const pts = slice(e.pts, prevOff, e.len);
    pts[0] = nodes[prevNode];
    split.push({ a: prevNode, b: e.b, kind: e.kind, pts, len: lengthOf(pts) });
  });
  edges = split;
  const routable = new SegmentGrid(edges);

  // Junctions are where three or more paths meet (doors do not count).
  const degree = new Int32Array(nodes.length + 64);
  for (const e of edges) {
    if (e.kind === "door" || e.kind === "through") continue;
    degree[e.a]++;
    degree[e.b]++;
  }

  const placeByKey = new Map(places.map((p) => [p.key, p]));
  const named = places.filter((p) => p.name && !p.land);

  /** The best-known name for a point: a named place within `reach` metres. */
  function landmarkNear(p: Vec2, reach: number, skip: Set<string>): RoutePlace | null {
    let best: { place: RoutePlace; d: number } | null = null;
    for (const place of named) {
      if (skip.has(place.key)) continue;
      if (Math.abs(place.centre.x - p.x) > 400 || Math.abs(place.centre.z - p.z) > 400) continue;
      const d = Math.min(...place.polygons.map((poly) => distanceToPolygon(p, poly)));
      if (d <= reach && (!best || d < best.d)) best = { place, d };
    }
    return best?.place ?? null;
  }

  function route(from: RouteEnd, to: RouteEnd, mode: TravelMode = "WALK"): NetworkRoute | null {
    // Temporary nodes and edges for ends that are points rather than places.
    const extraEdges: Edge[] = [];
    const extraNodes: Vec2[] = [];
    const tempNode = (p: Vec2) => nodes.length + extraNodes.push(p) - 1;
    const endNodes = (end: RouteEnd): number[] | null => {
      if ("place" in end) return placeDoorNodes.get(end.place)?.length ? placeDoorNodes.get(end.place)! : null;
      const hit = routable.nearest(end.point, FAR_DOOR_REACH);
      if (!hit) return null;
      const e = edges[hit.edge];
      const off = offsetAlong(e, hit.seg, hit.point);
      let mid: number;
      if (off < 0.5) mid = e.a;
      else if (e.len - off < 0.5) mid = e.b;
      else {
        mid = tempNode(hit.point);
        extraEdges.push(
          { a: e.a, b: mid, kind: e.kind, pts: [...slice(e.pts, 0, off).slice(0, -1), hit.point], len: off },
          { a: mid, b: e.b, kind: e.kind, pts: [hit.point, ...slice(e.pts, off, e.len).slice(1)], len: e.len - off }
        );
      }
      if (hit.d < 1) return [mid];
      const start = tempNode(end.point);
      extraEdges.push({ a: start, b: mid, kind: "door", pts: [end.point, hit.point], len: hit.d });
      return [start];
    };
    const sources = endNodes(from);
    const targets = endNodes(to);
    if (!sources || !targets) return null;

    const all = edges.concat(extraEdges);
    const total = nodes.length + extraNodes.length;
    const adj: number[][] = Array.from({ length: total }, () => []);
    all.forEach((e, i) => {
      adj[e.a].push(i);
      adj[e.b].push(i);
    });
    const speed = (e: Edge) => (mode === "EV" && e.kind === "road" ? EV_SPEED : WALK_SPEED);
    const cost = (e: Edge) => (e.len * (e.kind === "link" ? LINK_PENALTY : e.kind === "through" ? THROUGH_PENALTY : 1)) / speed(e);

    const best = new Float64Array(total).fill(Infinity);
    const via = new Int32Array(total).fill(-1);
    const heap = new MinHeap();
    for (const s of sources) {
      best[s] = 0;
      heap.push(0, s);
    }
    const targetSet = new Set(targets);
    let reached = -1;
    while (heap.size) {
      const [c, v] = heap.pop();
      if (c > best[v]) continue;
      if (targetSet.has(v)) {
        reached = v;
        break;
      }
      // (A door node has only its own door edge, so no route passes through a place.)
      for (const i of adj[v]) {
        const e = all[i];
        const w = e.a === v ? e.b : e.a;
        const nc = c + cost(e);
        if (nc < best[w]) {
          best[w] = nc;
          via[w] = i;
          heap.push(nc, w);
        }
      }
    }
    if (reached < 0) return null;

    // Walk back to the start, then forwards to build the line.
    const legs: { edge: Edge; forward: boolean }[] = [];
    for (let v = reached; via[v] >= 0; ) {
      const e = all[via[v]];
      const forward = e.b === v;
      legs.push({ edge: e, forward });
      v = forward ? e.a : e.b;
    }
    legs.reverse();
    if (!legs.length) return null;
    let path: Vec2[] = [];
    let kinds: EdgeKind[] = [];
    let vias: (string | undefined)[] = [];
    let junction: boolean[] = [];
    for (const { edge, forward } of legs) {
      const pts = forward ? edge.pts : [...edge.pts].reverse();
      if (path.length) {
        const endNode = forward ? edge.a : edge.b;
        if (endNode < degree.length && degree[endNode] >= 3) junction[path.length - 1] = true;
      }
      for (const p of path.length ? pts.slice(1) : pts) {
        path.push(p);
        kinds.push(edge.kind);
        vias.push(edge.via);
        junction.push(false);
      }
    }
    // Where two traced lines run side by side the shortest way can step across
    // and back; cut any out-and-back so the line (and the directions) go straight on.
    for (let i = 0; i < path.length; i++) {
      for (let j = path.length - 1; j > i + 1; j--) {
        if (dist(path[i], path[j]) > 3) continue;
        let around = 0;
        for (let k = i + 1; k <= j; k++) around += dist(path[k - 1], path[k]);
        if (around < 4 * Math.max(1, dist(path[i], path[j])) + 6) continue;
        path = [...path.slice(0, i + 1), ...path.slice(j + 1)];
        kinds = [...kinds.slice(0, i + 1), ...kinds.slice(j + 1)];
        vias = [...vias.slice(0, i + 1), ...vias.slice(j + 1)];
        junction = [...junction.slice(0, i + 1), ...junction.slice(j + 1)];
        break;
      }
    }
    const junctionAt = junction.flatMap((j, i) => (j ? [i] : []));
    let distance = 0;
    let rideDistance = 0;
    let durationSec = 0;
    for (let i = 1; i < path.length; i++) {
      const l = dist(path[i - 1], path[i]);
      const ride = mode === "EV" && kinds[i] === "road";
      distance += l;
      if (ride) rideDistance += l;
      durationSec += l / (ride ? EV_SPEED : WALK_SPEED);
    }

    const fromPlace = "place" in from ? placeByKey.get(from.place) : undefined;
    const toPlace = "place" in to ? placeByKey.get(to.place) : undefined;
    const steps = directions(path, kinds, vias, junctionAt, {
      fromName: fromPlace?.name ?? ("point" in from ? from.name : undefined) ?? null,
      toName: toPlace?.name ?? ("point" in to ? to.name : undefined) ?? null,
      toCentre: toPlace?.centre ?? ("point" in to ? to.point : path[path.length - 1]),
      skip: new Set([fromPlace?.key, toPlace?.key].filter((k): k is string => Boolean(k))),
      ride: mode === "EV",
    });
    return { path, distance, durationSec, steps, rideDistance };
  }

  /**
   * Turn-by-turn from the line: a step wherever the way turns at a junction
   * (or bends sharply anywhere), named after the building at the turn.
   */
  function directions(
    path: Vec2[],
    kinds: EdgeKind[],
    vias: (string | undefined)[],
    junctions: number[],
    o: { fromName: string | null; toName: string | null; toCentre: Vec2; skip: Set<string>; ride: boolean }
  ): RouteStep[] {
    // Resample every 2 m; each sample keeps the kind of line it lies on.
    type Sample = { p: Vec2; kind: EdgeKind; via?: string; s: number; junction: boolean };
    const S: Sample[] = [];
    const isJunction = new Set(junctions);
    let s = 0;
    for (let i = 0; i < path.length; i++) {
      if (i > 0) {
        const a = path[i - 1];
        const b = path[i];
        const l = dist(a, b);
        const n = Math.floor(l / 2);
        for (let k = 1; k <= n; k++) {
          const t = (k * 2) / l;
          if (t >= 1) break;
          S.push({ p: { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, kind: kinds[i], via: vias[i], s: s + k * 2, junction: false });
        }
        s += l;
      }
      S.push({ p: path[i], kind: kinds[i], via: vias[i], s, junction: isJunction.has(i) });
    }
    const total = s;
    const headingAt = (i: number, back: number, ahead: number) => {
      let j = i;
      while (j > 0 && S[i].s - S[j].s < back) j--;
      let k = i;
      while (k < S.length - 1 && S[k].s - S[i].s < ahead) k++;
      const h1 = { x: S[i].p.x - S[j].p.x, z: S[i].p.z - S[j].p.z };
      const h2 = { x: S[k].p.x - S[i].p.x, z: S[k].p.z - S[i].p.z };
      return { h1, h2, angle: Math.hypot(h1.x, h1.z) > 0.5 && Math.hypot(h2.x, h2.z) > 0.5 ? turnAngle(h1, h2) : 0 };
    };
    const indoors = (k: EdgeKind) => k === "door" || k === "through";

    // Where the way leaves the paths for the destination's door, and joins
    // them from the start's: the first and last steps cover those turns.
    let join = S.length - 1;
    while (join > 0 && S[join].kind === "door") join--;
    let leave = 0;
    while (leave < S.length - 1 && S[leave + 1].kind === "door") leave++;

    // Walking through a building: one step at the door it goes in by.
    const throughs: number[] = [];
    for (let i = 1; i < S.length; i++) if (S[i].kind === "through" && S[i - 1].kind !== "through") throughs.push(i);
    // Close before a building the way goes through, its door turn is part of "Go through".
    const nearThrough = (i: number) => throughs.some((t) => S[t].s - S[i].s >= -2 && S[t].s - S[i].s < 14);

    // Candidate turns: junctions turning 35 deg or more, sharp bends anywhere.
    // Headings over 15 m either side, so a wobble in a traced line is not a turn.
    type Turn = { i: number; angle: number };
    const turns: Turn[] = [];
    for (let i = 1; i < S.length - 1; i++) {
      if (S[i].s < 6 || total - S[i].s < 6 || i >= join - 1 || indoors(S[i].kind) || nearThrough(i)) continue;
      const { angle } = headingAt(i, 15, 15);
      if ((S[i].junction && Math.abs(angle) >= 35) || Math.abs(angle) >= 70) turns.push({ i, angle });
    }
    // One turn per corner: the sharpest within 25 m.
    const merged: Turn[] = [];
    for (const t of turns) {
      const last = merged[merged.length - 1];
      if (last && S[t.i].s - S[last.i].s < 25) {
        if (Math.abs(t.angle) > Math.abs(last.angle)) merged[merged.length - 1] = t;
      } else merged.push(t);
    }

    type Step = RouteStep & { si: number };
    const steps: Step[] = [];
    // Setting off: the way along the path after leaving the door, unless the
    // door itself is a walk of its own.
    const doorLength = S[leave].s;
    const first = doorLength >= 10 ? headingAt(0, 0, Math.min(12, doorLength)).h2 : headingAt(leave, 0, 15).h2;
    const onto = (k: EdgeKind) => (k === "road" ? " along the road" : k === "path" ? " along the path" : "");
    const firstKind = S.find((x) => !indoors(x.kind))?.kind ?? "path";
    steps.push({
      // A long way out of the door to the path: the turn onto it is the next step, which names it.
      text: `Head ${cardinal(first)}${o.fromName ? ` from ${o.fromName}` : ""}${doorLength >= 10 ? "" : onto(firstKind)}`,
      distance: 0,
      icon: "start",
      at: S[0].p,
      si: 0,
    });

    type Event = { i: number; kind: "turn" | "board" | "alight" | "through"; angle?: number };
    const events: Event[] = [
      ...merged.filter((t) => doorLength >= 10 || S[t.i].s > doorLength + 10).map((t) => ({ i: t.i, kind: "turn" as const, angle: t.angle })),
      ...throughs.map((i) => ({ i, kind: "through" as const })),
    ];
    if (o.ride) {
      for (let i = 1; i < S.length; i++) {
        if ((S[i].kind === "road") !== (S[i - 1].kind === "road")) events.push({ i, kind: S[i].kind === "road" ? "board" : "alight" });
      }
    }
    events.sort((a, b) => a.i - b.i);
    const skip = new Set(o.skip);
    for (const ev of events) {
      const at = S[ev.i].p;
      if (ev.kind === "board") steps.push({ text: "Take the EV shuttle along the road", distance: 0, icon: "shuttle", at, si: ev.i });
      else if (ev.kind === "alight") steps.push({ text: "Leave the shuttle and walk on", distance: 0, icon: "walk", at, si: ev.i });
      else if (ev.kind === "through") steps.push({ text: `Go through ${S[ev.i].via ?? "the building"}`, distance: 0, icon: "straight", at, si: ev.i });
      else {
        const a = ev.angle!;
        const side = a > 0 ? "right" : "left";
        const abs = Math.abs(a);
        const icon: StepIcon = abs >= 150 ? "u-turn" : abs >= 60 ? (side as StepIcon) : (`slight-${side}` as StepIcon);
        const verb = abs >= 150 ? "Turn around" : abs >= 60 ? `Turn ${side}` : `Bear ${side}`;
        const mark = landmarkNear(at, 30, skip);
        const nextKind = S[Math.min(S.length - 1, ev.i + 3)].kind;
        const prevKind = S[Math.max(0, ev.i - 3)].kind;
        const kindChange = nextKind !== prevKind && (nextKind === "road" || nextKind === "path") ? (nextKind === "road" ? " onto the road" : " onto the path") : "";
        steps.push({ text: `${verb}${mark ? ` at ${mark.name}` : kindChange}`, distance: 0, icon, at, si: ev.i });
      }
    }

    // Distances: from each step to the next. A long stretch names the biggest
    // building it passes, and on which side.
    for (let i = 0; i < steps.length; i++) {
      const from = S[steps[i].si].s;
      const end = i + 1 < steps.length ? S[steps[i + 1].si].s : total;
      steps[i].distance = Math.max(0, end - from);
      if (steps[i].distance >= 80 && steps[i].icon !== "shuttle") {
        const midS = (from + end) / 2;
        let mi = steps[i].si;
        while (mi < S.length - 1 && S[mi].s < midS) mi++;
        const m = S[mi];
        const mark = indoors(m.kind) ? null : landmarkNear(m.p, 22, skip);
        if (mark) {
          const { h2 } = headingAt(mi, 0, 6);
          const to = { x: mark.centre.x - m.p.x, z: mark.centre.z - m.p.z };
          const cross = h2.x * to.z - h2.z * to.x;
          steps[i].text += `, past ${mark.name} on your ${cross > 0 ? "right" : "left"}`;
        }
      }
    }

    // Arrival, and which side the destination is on, as seen walking along the
    // path just before stepping off it to the door.
    const endH = headingAt(join, 12, 0).h1;
    const last = S[S.length - 1].p;
    const toward = { x: o.toCentre.x - S[join].p.x, z: o.toCentre.z - S[join].p.z };
    const cross = endH.x * toward.z - endH.z * toward.x;
    const dot = endH.x * toward.x + endH.z * toward.z;
    const where = Math.hypot(toward.x, toward.z) < 3 || dot > Math.abs(cross) * 1.7 ? "ahead" : cross > 0 ? "on your right" : "on your left";
    steps.push({
      text: o.toName ? `Arrive at ${o.toName}, ${where}` : `Arrive at your destination, ${where}`,
      distance: 0,
      icon: "arrive",
      at: last,
      si: S.length - 1,
    });

    // Two turns a few metres apart are one instruction: "Turn left, then right".
    const out: RouteStep[] = [];
    const turnish = (st: RouteStep) => st.icon !== "start" && st.icon !== "arrive" && st.icon !== "shuttle" && st.icon !== "walk";
    for (const { si: _si, ...st } of steps) {
      void _si;
      const prev = out[out.length - 1];
      if (prev && turnish(prev) && turnish(st) && prev.distance < 8 && !prev.text.includes(", then ")) {
        prev.text = `${prev.text}, then ${st.text.charAt(0).toLowerCase()}${st.text.slice(1)}`;
        prev.distance = st.distance;
        continue;
      }
      out.push(st);
    }
    return out.map((st) => ({ ...st, distance: st.distance > 0 ? roundDistance(st.distance) : 0 }));
  }

  const doorsOf = (key: string) => (doorsByPlace.get(key) ?? []).map((d) => ({ at: d.at, joins: d.point }));
  return { route, lines, doorsOf };
}
