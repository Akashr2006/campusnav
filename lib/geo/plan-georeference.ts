/**
 * Places a scanned floor plan on the campus.
 *
 * A plan scan arrives as pixels with no idea where it is in the world. Pinning
 * two points the operator can identify on both the plan and the map — opposite
 * corners of the building, two column centres, the ends of a known wall — is
 * enough to fix the third: scale, rotation and position all fall out of a single
 * pair, because a plan is a *similarity* transform of reality. It may be any
 * size and turned any way up, but it is never sheared, so two points is exactly
 * the right amount of work to ask of a person.
 *
 * (`lib/geo/affine.ts` solves the harder six-parameter case for the basemap,
 * where lens and stitching distortion means shear is real. A CAD plan has none,
 * and fitting shear to a clean drawing only bakes the operator's clicking error
 * into the geometry.)
 *
 * Coordinate conventions, which are the whole difficulty here:
 *  - **Plan pixels**: x right, y DOWN, origin at the raster's top-left.
 *  - **World metres**: x east, z south — the frame `campus-3d.ts` projects to.
 *
 * Both are "right and down" systems, so at zero rotation the plan needs no flip:
 * pixel +x is east and pixel +y is south, i.e. a north-up drawing. Positive
 * rotation then reads as clockwise on a north-up map, which is how an operator
 * describes a turned drawing.
 */
import { MAP_ORIGIN } from "./projection";

export type LatLng = { lat: number; lng: number };
export type Px = { x: number; y: number };
/** Metres east/south of MAP_ORIGIN. */
export type Metres = { x: number; z: number };

/** A point the operator has identified on both the plan and the map. */
export type ControlPoint = {
  px: Px;
  gps: LatLng;
};

export type PlanTransform = {
  /** GPS of the raster's top-left pixel. */
  originLat: number;
  originLng: number;
  /** Metres per plan pixel. */
  scale: number;
  /** Degrees clockwise from north. 0 = the drawing is north-up. */
  rotation: number;
};

/** Smallest separation, in pixels, that gives a usable scale and angle. */
export const MIN_CONTROL_SEPARATION_PX = 20;

function metresPerDegree(lat: number) {
  const latRad = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad),
    lng: 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad),
  };
}

/**
 * Metres east/south of MAP_ORIGIN. Deliberately identical to `gpsToMetres` in
 * campus-3d.ts: traced geometry has to land in the same frame as the footprints
 * it is traced inside, or a plan will sit metres away from its own building.
 */
export function gpsToMetres(lat: number, lng: number): Metres {
  const per = metresPerDegree(MAP_ORIGIN.lat);
  return {
    x: (lng - MAP_ORIGIN.lng) * per.lng,
    z: -(lat - MAP_ORIGIN.lat) * per.lat,
  };
}

export function metresToGps(m: Metres): LatLng {
  const per = metresPerDegree(MAP_ORIGIN.lat);
  return {
    lat: MAP_ORIGIN.lat - m.z / per.lat,
    lng: MAP_ORIGIN.lng + m.x / per.lng,
  };
}

/** Clockwise rotation in the (east, south) plane — see the module note. */
function rotate(v: Metres, radians: number): Metres {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.z * s, z: v.x * s + v.z * c };
}

export type SolveResult =
  | { ok: true; transform: PlanTransform }
  | { ok: false; error: string };

/**
 * Solves the transform from two control points.
 *
 * Returns a message rather than throwing, because every failure here is an
 * operator mistake with a specific fix — pins too close together, or pinned to
 * the same place on the map.
 */
export function solvePlanTransform(a: ControlPoint, b: ControlPoint): SolveResult {
  const dpx = { x: b.px.x - a.px.x, y: b.px.y - a.px.y };
  const pxLen = Math.hypot(dpx.x, dpx.y);
  if (pxLen < MIN_CONTROL_SEPARATION_PX) {
    return {
      ok: false,
      error: `Pin the two points further apart on the plan — at least ${MIN_CONTROL_SEPARATION_PX} px. Opposite corners of the building work well.`,
    };
  }

  const wa = gpsToMetres(a.gps.lat, a.gps.lng);
  const wb = gpsToMetres(b.gps.lat, b.gps.lng);
  const dw = { x: wb.x - wa.x, z: wb.z - wa.z };
  const wLen = Math.hypot(dw.x, dw.z);
  if (wLen < 0.5) {
    return {
      ok: false,
      error: "The two map points are less than 0.5 m apart. Pin them to distinct places on the map.",
    };
  }

  const scale = wLen / pxLen;
  // Angle from the plan's own axis to the real-world one.
  const rotation = Math.atan2(dw.z, dw.x) - Math.atan2(dpx.y, dpx.x);

  // Walk back from a known pin to the raster's top-left corner.
  const offset = rotate({ x: a.px.x * scale, z: a.px.y * scale }, rotation);
  const origin = metresToGps({ x: wa.x - offset.x, z: wa.z - offset.z });

  return {
    ok: true,
    transform: {
      originLat: origin.lat,
      originLng: origin.lng,
      scale,
      // Normalised into (-180, 180] so a turned plan reads sensibly in the UI.
      rotation: normaliseDegrees((rotation * 180) / Math.PI),
    },
  };
}

export function normaliseDegrees(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** A plan pixel, as metres east/south of MAP_ORIGIN. */
export function planPixelToMetres(px: Px, t: PlanTransform): Metres {
  const origin = gpsToMetres(t.originLat, t.originLng);
  const offset = rotate({ x: px.x * t.scale, z: px.y * t.scale }, (t.rotation * Math.PI) / 180);
  return { x: origin.x + offset.x, z: origin.z + offset.z };
}

export function planPixelToGps(px: Px, t: PlanTransform): LatLng {
  return metresToGps(planPixelToMetres(px, t));
}

/** The inverse, for drawing existing geometry back onto the plan underlay. */
export function metresToPlanPixel(m: Metres, t: PlanTransform): Px {
  const origin = gpsToMetres(t.originLat, t.originLng);
  const local = rotate(
    { x: m.x - origin.x, z: m.z - origin.z },
    (-t.rotation * Math.PI) / 180
  );
  return { x: local.x / t.scale, y: local.z / t.scale };
}

/**
 * How far off the pins are, in metres, once the transform is applied.
 *
 * With two points a similarity transform fits them exactly, so this is near zero
 * by construction — it exists to catch a transform that has been hand-edited
 * since, or a pin later dragged in the editor. Worth surfacing: a plan that has
 * silently drifted produces geometry that looks plausible and is wrong.
 */
export function controlPointResidual(
  points: ControlPoint[],
  t: PlanTransform
): number {
  let worst = 0;
  for (const p of points) {
    const got = planPixelToMetres(p.px, t);
    const want = gpsToMetres(p.gps.lat, p.gps.lng);
    worst = Math.max(worst, Math.hypot(got.x - want.x, got.z - want.z));
  }
  return worst;
}

/**
 * Checks a solved transform against the building it is meant to describe.
 *
 * A mis-pinned plan is the most likely failure in the whole pipeline and the
 * hardest to see by eye, so the scale is compared against the footprint the
 * surveyors already traced. Warnings, not errors: an operator tracing a wing of
 * a larger block legitimately trips these.
 */
export function checkPlanAgainstFootprint(
  t: PlanTransform,
  planSize: { width: number; height: number },
  footprint: LatLng[]
): string[] {
  const warnings: string[] = [];
  if (footprint.length < 3) return warnings;

  const pts = footprint.map((p) => gpsToMetres(p.lat, p.lng));
  const fw = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
  const fh = Math.max(...pts.map((p) => p.z)) - Math.min(...pts.map((p) => p.z));
  const footprintSpan = Math.max(fw, fh);

  // The plan's own extent in metres, ignoring rotation.
  const planSpan = Math.max(planSize.width, planSize.height) * t.scale;
  if (footprintSpan > 1 && planSpan > 1) {
    const ratio = planSpan / footprintSpan;
    if (ratio > 3 || ratio < 1 / 3) {
      warnings.push(
        `The plan works out ${planSpan.toFixed(0)} m across but the footprint is ${footprintSpan.toFixed(0)} m. Check the two pins are on the points you meant.`
      );
    }
  }

  // A plan whose scale is wildly off a plausible drawing scale is a pin error.
  if (t.scale > 2) {
    warnings.push(
      `${t.scale.toFixed(2)} m per pixel is very coarse for a floor plan. Check the pins are far apart on the drawing.`
    );
  }
  if (t.scale > 0 && t.scale < 0.002) {
    warnings.push(
      `${t.scale.toFixed(4)} m per pixel is very fine for a floor plan. Check the pins are not almost on top of each other.`
    );
  }

  return warnings;
}
