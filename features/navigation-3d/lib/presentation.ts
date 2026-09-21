/**
 * Presentation mode director.
 *
 * A presentation is a fixed sequence of cues, each holding the scene in one
 * state for a set number of seconds. This module is pure: given the cue list
 * and an elapsed time it returns exactly what the scene should show, so the
 * whole choreography is unit-testable without a renderer, and the React layer
 * is reduced to "advance a clock, apply the result".
 *
 * Numbers are in seconds. Explode and section cut are 0..1, matching the
 * scene's own controls, so a presentation can only ever show what a person
 * could reach by hand.
 */

export type CueKind = "overview" | "route" | "building" | "outro";

export type Cue = {
  id: string;
  kind: CueKind;
  /** Building focused during the cue; null for campus-wide cues. */
  buildingId: string | null;
  title: string;
  subtitle: string;
  duration: number;
  /** Building cues run a scripted explode + section-cut choreography. */
  choreography?: Choreography;
};

/** Timing, in seconds from the start of the cue, of a building's choreography. */
export type Choreography = {
  /** Camera settles on the block before anything moves. */
  settle: number;
  /** Explode ramps 0 -> 1 over this window. */
  explodeUp: number;
  /** Fully exploded hold. */
  explodedHold: number;
  /** Explode ramps back 1 -> 0. */
  explodeDown: number;
  /** Section cut sweeps from `cutFrom` to `cutTo`. */
  sectionSweep: number;
  cutFrom: number;
  cutTo: number;
  /** Final hold with the cut open before the next cue. */
  cutHold: number;
};

export type SceneState = {
  cueIndex: number;
  cue: Cue;
  /** 0..1 through the current cue. */
  progress: number;
  /** Seconds into the current cue. */
  cueTime: number;
  selectedId: string | null;
  explode: number;
  sectionCut: number | null;
  routePlaying: boolean;
  /** Slow automatic orbit is on for wide shots and while a block is settling. */
  orbit: boolean;
  finished: boolean;
};

export type PilotRef = { id: string; name: string; storeys: number; structureType?: string };

const DEFAULT_CHOREOGRAPHY: Choreography = {
  settle: 3.5,
  explodeUp: 4.5,
  explodedHold: 2.5,
  explodeDown: 3,
  sectionSweep: 5,
  cutFrom: 0.12,
  cutTo: 0.82,
  cutHold: 2.5,
};

export function choreographyDuration(c: Choreography): number {
  return c.settle + c.explodeUp + c.explodedHold + c.explodeDown + c.sectionSweep + c.cutHold;
}

/** Hermite smoothstep: motion that eases in and out reads as deliberate, not mechanical. */
export function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function describeStructure(p: PilotRef): string {
  const type = (p.structureType ?? "").replace(/_/g, " ").toLowerCase();
  const storeys = `${p.storeys} ${p.storeys === 1 ? "storey" : "storeys"}`;
  return type ? `${storeys} · ${type} structure` : storeys;
}

export function buildTimeline(opts: {
  campusName: string;
  buildingCount: number;
  pilots: PilotRef[];
  /** Route cue is skipped when no route is available to animate. */
  hasRoute: boolean;
}): Cue[] {
  const cues: Cue[] = [
    {
      id: "overview",
      kind: "overview",
      buildingId: null,
      title: opts.campusName,
      subtitle: `Digital twin · ${opts.buildingCount} buildings traced from satellite imagery`,
      duration: 10,
    },
  ];

  if (opts.hasRoute) {
    cues.push({
      id: "route",
      kind: "route",
      buildingId: null,
      title: "Campus navigation",
      subtitle: "Shortest walking route between any two entrances",
      duration: 9,
    });
  }

  for (const p of opts.pilots) {
    cues.push({
      id: `building-${p.id}`,
      kind: "building",
      buildingId: p.id,
      title: p.name,
      subtitle: describeStructure(p),
      duration: choreographyDuration(DEFAULT_CHOREOGRAPHY),
      choreography: DEFAULT_CHOREOGRAPHY,
    });
  }

  cues.push({
    id: "outro",
    kind: "outro",
    buildingId: null,
    title: opts.campusName,
    subtitle: "CampusNav · indoor + outdoor navigation",
    duration: 8,
  });

  return cues;
}

export function totalDuration(cues: Cue[]): number {
  return cues.reduce((s, c) => s + c.duration, 0);
}

/** Start time of each cue, so jumping to a cue is a single lookup. */
export function cueStarts(cues: Cue[]): number[] {
  const out: number[] = [];
  let t = 0;
  for (const c of cues) {
    out.push(t);
    t += c.duration;
  }
  return out;
}

/** Explode + section-cut values at `t` seconds into a building cue. */
export function choreographyAt(c: Choreography, t: number): { explode: number; sectionCut: number | null } {
  let x = t;
  if (x < c.settle) return { explode: 0, sectionCut: null };
  x -= c.settle;
  if (x < c.explodeUp) return { explode: smoothstep(x / c.explodeUp), sectionCut: null };
  x -= c.explodeUp;
  if (x < c.explodedHold) return { explode: 1, sectionCut: null };
  x -= c.explodedHold;
  if (x < c.explodeDown) return { explode: 1 - smoothstep(x / c.explodeDown), sectionCut: null };
  x -= c.explodeDown;
  if (x < c.sectionSweep) {
    const k = smoothstep(x / c.sectionSweep);
    return { explode: 0, sectionCut: c.cutFrom + (c.cutTo - c.cutFrom) * k };
  }
  return { explode: 0, sectionCut: c.cutTo };
}

export function stateAt(cues: Cue[], elapsed: number): SceneState {
  if (!cues.length) {
    throw new Error("stateAt: timeline has no cues");
  }
  const total = totalDuration(cues);
  const finished = elapsed >= total;
  // Clamp so a finished presentation rests on its last frame instead of
  // running off the end of the array.
  const t = Math.max(0, Math.min(elapsed, total - 1e-6));

  let acc = 0;
  let index = 0;
  for (; index < cues.length; index++) {
    if (t < acc + cues[index].duration) break;
    acc += cues[index].duration;
  }
  index = Math.min(index, cues.length - 1);
  const cue = cues[index];
  const cueTime = t - acc;
  const progress = cue.duration > 0 ? Math.min(1, cueTime / cue.duration) : 1;

  if (cue.kind === "building" && cue.choreography) {
    const { explode, sectionCut } = choreographyAt(cue.choreography, cueTime);
    return {
      cueIndex: index,
      cue,
      progress,
      cueTime,
      selectedId: cue.buildingId,
      explode,
      sectionCut,
      routePlaying: false,
      // Orbit only while settling; once the block is exploding the camera
      // should hold still so the motion belongs to the structure, not the view.
      orbit: cueTime < cue.choreography.settle,
      finished,
    };
  }

  return {
    cueIndex: index,
    cue,
    progress,
    cueTime,
    selectedId: null,
    explode: 0,
    sectionCut: null,
    routePlaying: cue.kind === "route",
    orbit: true,
    finished,
  };
}
