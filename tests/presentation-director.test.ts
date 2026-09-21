import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  choreographyAt,
  choreographyDuration,
  cueStarts,
  smoothstep,
  stateAt,
  totalDuration,
  type Cue,
} from "../features/navigation-3d/lib/presentation";

const pilots = [
  { id: "b-acad-w", name: "Academic Block W", storeys: 4, structureType: "RC_FRAME" },
  { id: "b-east", name: "East Block", storeys: 3, structureType: "RC_FRAME" },
  { id: "b-hall", name: "Central Hall", storeys: 1, structureType: "LONG_SPAN" },
];

function timeline(hasRoute = true): Cue[] {
  return buildTimeline({ campusName: "BIT", buildingCount: 48, pilots, hasRoute });
}

describe("presentation director", () => {
  describe("buildTimeline", () => {
    it("opens on the campus, visits every pilot, and closes on the campus", () => {
      const cues = timeline();
      expect(cues[0].kind).toBe("overview");
      expect(cues[cues.length - 1].kind).toBe("outro");
      expect(cues.filter((c) => c.kind === "building").map((c) => c.buildingId)).toEqual(
        pilots.map((p) => p.id)
      );
    });

    it("includes the route cue only when a route exists", () => {
      expect(timeline(true).some((c) => c.kind === "route")).toBe(true);
      expect(timeline(false).some((c) => c.kind === "route")).toBe(false);
    });

    it("gives every cue a positive duration and a caption", () => {
      for (const c of timeline()) {
        expect(c.duration).toBeGreaterThan(0);
        expect(c.title.length).toBeGreaterThan(0);
        expect(c.subtitle.length).toBeGreaterThan(0);
      }
    });

    it("describes the structure in the building subtitle", () => {
      const hall = timeline().find((c) => c.buildingId === "b-hall")!;
      expect(hall.subtitle).toContain("1 storey");
      expect(hall.subtitle.toLowerCase()).toContain("long span");
    });

    it("sizes a building cue to exactly its choreography", () => {
      for (const c of timeline().filter((c) => c.kind === "building")) {
        expect(c.duration).toBeCloseTo(choreographyDuration(c.choreography!), 9);
      }
    });
  });

  describe("cueStarts / totalDuration", () => {
    it("start times are cumulative and total is their sum", () => {
      const cues = timeline();
      const starts = cueStarts(cues);
      expect(starts[0]).toBe(0);
      for (let i = 1; i < cues.length; i++) {
        expect(starts[i]).toBeCloseTo(starts[i - 1] + cues[i - 1].duration, 9);
      }
      expect(totalDuration(cues)).toBeCloseTo(starts[cues.length - 1] + cues[cues.length - 1].duration, 9);
    });
  });

  describe("smoothstep", () => {
    it("is clamped, monotonic, and eases at both ends", () => {
      expect(smoothstep(-1)).toBe(0);
      expect(smoothstep(0)).toBe(0);
      expect(smoothstep(1)).toBe(1);
      expect(smoothstep(2)).toBe(1);
      expect(smoothstep(0.5)).toBeCloseTo(0.5, 9);
      let prev = 0;
      for (let t = 0; t <= 1; t += 0.05) {
        const v = smoothstep(t);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
      // Eased: slower than linear near the start, faster in the middle.
      expect(smoothstep(0.1)).toBeLessThan(0.1);
    });
  });

  describe("choreographyAt", () => {
    const c = timeline().find((x) => x.kind === "building")!.choreography!;

    it("holds still while the camera settles", () => {
      expect(choreographyAt(c, 0)).toEqual({ explode: 0, sectionCut: null });
      expect(choreographyAt(c, c.settle - 0.01)).toEqual({ explode: 0, sectionCut: null });
    });

    it("explodes fully, holds, and reassembles before the section cut", () => {
      const upEnd = c.settle + c.explodeUp;
      expect(choreographyAt(c, upEnd - 1e-6).explode).toBeCloseTo(1, 3);
      expect(choreographyAt(c, upEnd + c.explodedHold / 2)).toEqual({ explode: 1, sectionCut: null });
      const downEnd = upEnd + c.explodedHold + c.explodeDown;
      expect(choreographyAt(c, downEnd - 1e-6).explode).toBeCloseTo(0, 3);
      expect(choreographyAt(c, downEnd - 1e-6).sectionCut).toBeNull();
    });

    it("sweeps the section cut from cutFrom to cutTo and then holds it", () => {
      const sweepStart = c.settle + c.explodeUp + c.explodedHold + c.explodeDown;
      expect(choreographyAt(c, sweepStart).sectionCut).toBeCloseTo(c.cutFrom, 9);
      expect(choreographyAt(c, sweepStart + c.sectionSweep).sectionCut).toBeCloseTo(c.cutTo, 9);
      expect(choreographyAt(c, sweepStart + c.sectionSweep + 1).sectionCut).toBeCloseTo(c.cutTo, 9);
      // Never explodes and cuts at once.
      expect(choreographyAt(c, sweepStart + 1).explode).toBe(0);
    });

    it("never produces a value outside the scene's 0..1 controls", () => {
      for (let t = 0; t <= choreographyDuration(c) + 2; t += 0.1) {
        const v = choreographyAt(c, t);
        expect(v.explode).toBeGreaterThanOrEqual(0);
        expect(v.explode).toBeLessThanOrEqual(1);
        if (v.sectionCut !== null) {
          expect(v.sectionCut).toBeGreaterThanOrEqual(0);
          expect(v.sectionCut).toBeLessThanOrEqual(1);
        }
      }
    });
  });

  describe("stateAt", () => {
    const cues = timeline();
    const starts = cueStarts(cues);

    it("selects the right cue for any elapsed time", () => {
      for (let i = 0; i < cues.length; i++) {
        expect(stateAt(cues, starts[i]).cueIndex).toBe(i);
        expect(stateAt(cues, starts[i] + cues[i].duration / 2).cueIndex).toBe(i);
      }
    });

    it("selects nothing and orbits on campus-wide cues", () => {
      const s = stateAt(cues, 1);
      expect(s.cue.kind).toBe("overview");
      expect(s.selectedId).toBeNull();
      expect(s.explode).toBe(0);
      expect(s.sectionCut).toBeNull();
      expect(s.orbit).toBe(true);
      expect(s.routePlaying).toBe(false);
    });

    it("plays the route only during the route cue", () => {
      const routeIdx = cues.findIndex((c) => c.kind === "route");
      expect(stateAt(cues, starts[routeIdx] + 1).routePlaying).toBe(true);
      expect(stateAt(cues, starts[routeIdx + 1] + 1).routePlaying).toBe(false);
    });

    it("focuses the pilot and stops orbiting once its choreography moves", () => {
      const bIdx = cues.findIndex((c) => c.kind === "building");
      const c = cues[bIdx].choreography!;
      const settling = stateAt(cues, starts[bIdx] + 1);
      expect(settling.selectedId).toBe(cues[bIdx].buildingId);
      expect(settling.orbit).toBe(true);
      const exploding = stateAt(cues, starts[bIdx] + c.settle + c.explodeUp / 2);
      expect(exploding.orbit).toBe(false);
      expect(exploding.explode).toBeGreaterThan(0);
    });

    it("reports progress in 0..1 within a cue", () => {
      const s = stateAt(cues, starts[1] + cues[1].duration * 0.25);
      expect(s.progress).toBeCloseTo(0.25, 6);
    });

    it("rests on the last frame and reports finished past the end", () => {
      const total = totalDuration(cues);
      const end = stateAt(cues, total + 100);
      expect(end.finished).toBe(true);
      expect(end.cueIndex).toBe(cues.length - 1);
      expect(end.cue.kind).toBe("outro");
      expect(stateAt(cues, total - 0.5).finished).toBe(false);
    });

    it("clamps negative time to the first cue", () => {
      expect(stateAt(cues, -5).cueIndex).toBe(0);
    });

    it("refuses an empty timeline loudly", () => {
      expect(() => stateAt([], 0)).toThrow();
    });
  });
});
