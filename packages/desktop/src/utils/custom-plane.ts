import { findCrackX, isPlaneWithinExternalBoundary, selectEntryExit, Slope } from "@cslope/engine";
import { surfaceYAtX } from "../features/view/surface";
import { circleArcPoints } from "./arc";
import type { ModelOrientation } from "../store/types";

type Pt = [number, number];

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A starting circle for a custom search plane that cuts through the slope:
 * the centre above the middle of the slope face, the radius reaching a
 * little below the toe (but not below the model's base). The slope face is
 * the one that falls in the sliding direction given by the orientation
 * (left to right: the ground drops as x increases; right to left: as x
 * decreases), so the circle is one the engine analyses.
 */
export function defaultCustomCircle(
  coordinates: Pt[],
  orientation: ModelOrientation = "ltr",
): {
  cx: number;
  cy: number;
  radius: number;
} {
  if (coordinates.length < 3) return { cx: 0, cy: 0, radius: 10 };
  const xs = coordinates.map((c) => c[0]);
  const ys = coordinates.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const width = xMax - xMin;
  if (!(width > 0)) return { cx: 0, cy: 0, radius: 10 };

  // Ground surface sampled across the model.
  const n = 100;
  const ground: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = xMin + (width * i) / n;
    const y = surfaceYAtX(coordinates, x);
    if (y !== null) ground.push([x, y]);
  }
  if (ground.length === 0) return { cx: 0, cy: 0, radius: 10 };
  const gMax = Math.max(...ground.map((g) => g[1]));
  const gMin = Math.min(...ground.map((g) => g[1]));

  // A ground that only falls the other way has no face the engine would
  // analyse; then the face falling the other way is used, as before.
  const face =
    fallingFace(ground, orientation) ??
    fallingFace(ground, orientation === "ltr" ? "rtl" : "ltr");
  const toe = face ? face.toe : gMin;
  const relief = face ? face.top - face.toe : 0;
  const height = relief > 1e-6 ? relief : Math.max(width * 0.2, 1);
  // Middle of the slope face (the model's centre on flat ground).
  const cx = face && relief > 1e-6 ? face.mid : (xMin + xMax) / 2;

  const cy = gMax + 0.5 * height;
  const bottom = Math.max(toe - 0.25 * height, yMin + 0.05 * (gMax - yMin));
  const radius = Math.max(cy - bottom, 0.5);
  return { cx: round1(cx), cy: round1(cy), radius: round1(radius) };
}

/**
 * The model as the analysis sees it, for its own entry/exit, crack and
 * boundary checks: its external boundary, mirrored (x → −x) for a
 * right-to-left model, which the analysis takes mirrored. Kept per
 * coordinates array (the canvas asks every frame). Null without a usable
 * boundary.
 */
const slopeCache = new WeakMap<readonly Pt[], { ltr?: Slope | null; rtl?: Slope | null }>();

function boundarySlope(coordinates: readonly Pt[], mirrored: boolean): Slope | null {
  if (coordinates.length < 3) return null;
  const entry = slopeCache.get(coordinates) ?? {};
  const key = mirrored ? "rtl" : "ltr";
  if (entry[key] === undefined) {
    try {
      const slope = new Slope();
      slope.setExternalBoundary(coordinates.map(([x, y]): Pt => [mirrored ? -x : x, y]));
      entry[key] = slope;
    } catch {
      entry[key] = null;
    }
    slopeCache.set(coordinates, entry);
  }
  return entry[key] ?? null;
}

const mirrorPt = ([x, y]: Pt): Pt => [-x, y];

/**
 * Where a prescribed circle enters and leaves the ground, as the analysis
 * takes them (the engine's selectEntryExit): of the circle's crossings
 * with the ground surface on its lower half (by x), the first where the
 * lower arc goes from air into the soil and the next where it comes out
 * again. Null when there is no such pair (the analysis then has no surface
 * for the circle). A right-to-left model (`mirrored`) is analysed
 * mirrored, so its crossings are taken from the right.
 */
export function circleEntryExit(
  coordinates: readonly Pt[],
  cx: number,
  cy: number,
  radius: number,
  mirrored = false,
): [Pt, Pt] | null {
  if (!(radius > 0)) return null;
  const slope = boundarySlope(coordinates, mirrored);
  if (!slope) return null;
  const ends = selectEntryExit(slope, mirrored ? -cx : cx, cy, radius);
  if (!ends) return null;
  return mirrored ? [mirrorPt(ends[0]), mirrorPt(ends[1])] : [ends[0], ends[1]];
}

/**
 * Where a tension crack of fixed `depth` cuts a slip surface, as the
 * analysis finds it (the engine's findCrackX): walking from the entry
 * towards the exit, the first x where the surface (`baseY`) lies `depth`
 * below the ground. Null when it never gets that deep before the exit (the
 * analysis then has no surface). Works in either direction (a right-to-left
 * model enters from the right).
 */
export function crackCutX(
  coordinates: readonly Pt[],
  baseY: (x: number) => number,
  xEntry: number,
  xExit: number,
  depth: number,
): number | null {
  const m = xExit < xEntry ? -1 : 1;
  const surf = boundarySlope(coordinates, m < 0)?.surfaceLineXY;
  if (!surf) return null;
  const xc = findCrackX(surf, m * xEntry, m * xExit, (x) => baseY(m * x), () => depth);
  return xc === null ? null : m * xc;
}

/** y of a polyline at x (linear between its points, null outside them). */
function polylineY(points: readonly Pt[], x: number): number | null {
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
      return x0 === x1 ? Math.min(y0, y1) : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return null;
}

/** A prescribed surface as the analysis takes it, for drawing (world). */
export interface PrescribedPath {
  /** The surface from where it enters (the crack's base at a crack) to where it leaves. */
  points: Pt[];
  /** The tension crack it starts at: x, the ground there and the crack's base. */
  crack: { x: number; top: number; bottom: number } | null;
  /** The analysis has no surface for it (no entry and exit, it leaves the model, or it never reaches the crack depth). */
  unusable: boolean;
}

/**
 * The path of a prescribed surface as the analysis takes it: a circle
 * from its entry to its exit (circleEntryExit), a polyline as given; with
 * a tension crack of fixed `crackDepth`, cut where it lies that deep
 * below the ground on the entry side (crackCutX): the surface enters at
 * the crack's base. Unusable, as the analysis has no surface for it: a
 * circle without an entry and exit or that leaves the model (through its
 * base; the engine's isPlaneWithinExternalBoundary), and a surface that
 * never reaches the crack depth. `mirrored`: a right-to-left model,
 * entered from the right.
 */
export function prescribedPath(
  coordinates: readonly Pt[],
  plane: { cx: number; cy: number; radius: number; points?: readonly Pt[] | null },
  crackDepth: number,
  mirrored = false,
): PrescribedPath {
  if (plane.points) {
    const pts = plane.points.map(([x, y]): Pt => [x, y]);
    if (!(crackDepth > 0) || pts.length < 2) return { points: pts, crack: null, unusable: false };
    const xs = pts.map((p) => p[0]);
    const [xEntry, xExit] = mirrored ? [Math.max(...xs), Math.min(...xs)] : [Math.min(...xs), Math.max(...xs)];
    const baseY = (x: number) => polylineY(pts, x) ?? Infinity;
    const xc = crackCutX(coordinates, baseY, xEntry, xExit, crackDepth);
    const gc = xc === null ? null : surfaceYAtX(coordinates as Pt[], xc);
    if (xc === null || gc === null) return { points: pts, crack: null, unusable: true };
    // In order from the entry: the crack's base, then the points beyond it.
    const ordered = (xs[0] <= xs[xs.length - 1]) === !mirrored ? pts : [...pts].reverse();
    const beyond = ordered.filter(([x]) => (x - xc) * Math.sign(xExit - xEntry) > 0);
    return { points: [[xc, baseY(xc)], ...beyond], crack: { x: xc, top: gc, bottom: baseY(xc) }, unusable: false };
  }
  const ends = plane.radius > 0 ? circleEntryExit(coordinates, plane.cx, plane.cy, plane.radius, mirrored) : null;
  if (!ends) return { points: [], crack: null, unusable: true };
  // A circle that leaves the model between its ends (through its base) is not analysed.
  const slope = boundarySlope(coordinates, mirrored);
  const [lc, rc] = mirrored ? [mirrorPt(ends[0]), mirrorPt(ends[1])] : ends;
  const inside =
    slope !== null &&
    isPlaneWithinExternalBoundary(slope, { lc, rc, cx: mirrored ? -plane.cx : plane.cx, cy: plane.cy, radius: plane.radius });
  if (!inside) return { points: [], crack: null, unusable: true };
  if (!(crackDepth > 0)) {
    return { points: circleArcPoints(plane.cx, plane.cy, plane.radius, ends[0], ends[1], 90), crack: null, unusable: false };
  }
  const baseY = (x: number) => plane.cy - Math.sqrt(Math.max(0, plane.radius ** 2 - (x - plane.cx) ** 2));
  const xc = crackCutX(coordinates, baseY, ends[0][0], ends[1][0], crackDepth);
  const gc = xc === null ? null : surfaceYAtX(coordinates as Pt[], xc);
  if (xc === null || gc === null) return { points: [], crack: null, unusable: true };
  const start: Pt = [xc, baseY(xc)];
  return {
    points: circleArcPoints(plane.cx, plane.cy, plane.radius, start, ends[1], 90),
    crack: { x: xc, top: gc, bottom: start[1] },
    unusable: false,
  };
}

/**
 * The stretch of sampled ground that falls furthest in the sliding
 * direction: its crest and toe levels and the x where it passes halfway
 * between them. Level stretches (benches) do not end a stretch; a rise does.
 */
function fallingFace(
  ground: Pt[],
  orientation: ModelOrientation,
): { top: number; toe: number; mid: number } | null {
  // The ground in the order a sliding mass moves over it.
  const pts = orientation === "ltr" ? ground : [...ground].reverse();
  // Split the ground where it rises; each stretch runs from a local crest
  // down to the next low point.
  const runs: [number, number][] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] > pts[i - 1][1] + 1e-9) {
      runs.push([start, i - 1]);
      start = i;
    }
  }
  runs.push([start, pts.length - 1]);
  let s0 = -1;
  let s1 = -1;
  let bestDrop = 1e-6;
  for (const [a, b] of runs) {
    const drop = pts[a][1] - pts[b][1];
    if (drop > bestDrop) {
      [s0, s1] = [a, b];
      bestDrop = drop;
    }
  }
  if (s0 < 0) return null;
  const top = pts[s0][1];
  const toe = pts[s1][1];
  const level = (top + toe) / 2;
  let mid = (pts[s0][0] + pts[s1][0]) / 2;
  for (let i = s0 + 1; i <= s1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (y0 !== y1 && (y0 - level) * (y1 - level) <= 0) {
      mid = x0 + ((level - y0) / (y1 - y0)) * (x1 - x0);
      break;
    }
  }
  return { top, toe, mid };
}
