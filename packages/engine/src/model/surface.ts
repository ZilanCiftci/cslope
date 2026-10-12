/**
 * Non-circular (polyline) slip surfaces.
 *
 * A polyline surface runs from the entry to the exit point with x strictly
 * increasing (canonical coordinates: the mass slides towards +x). Moment
 * equilibrium is taken about an axis point, which for a surface derived
 * from a circle is the circle centre.
 */

import { getYAtX } from "../math/index";
import type { Slope } from "./slope";
import { polylineYFrom } from "./geometry-ops";

export type Pt = [number, number];

/** y of the polyline at x (linear between vertices; NaN outside). */
export function polylineYAt(points: readonly Pt[], x: number): number {
  const n = points.length;
  if (n < 2 || x < points[0][0] || x > points[n - 1][0]) return Number.NaN;
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    if (x <= bx) return bx === ax ? by : ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return points[n - 1][1];
}

/**
 * x of every crossing between the polyline and the segments of a path
 * (closed: polygon, else polyline).
 */
export function polylineCrossingsX(
  points: readonly Pt[],
  px: readonly number[],
  py: readonly number[],
  closed: boolean,
): number[] {
  const out: number[] = [];
  const m = px.length;
  const edges = closed ? m : m - 1;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    for (let j = 0; j < edges; j++) {
      const cx = px[j];
      const cy = py[j];
      const dx = px[(j + 1) % m];
      const dy = py[(j + 1) % m];
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-14) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t >= -1e-12 && t <= 1 + 1e-12 && u >= -1e-12 && u <= 1 + 1e-12) {
        out.push(ax + t * (bx - ax));
      }
    }
  }
  return out;
}

/**
 * Default axis point for moment equilibrium: the centre of the circle
 * through the entry, the exit and the deepest point of the surface below
 * their chord. For a planar surface (no depth below the chord) a point
 * above the chord midpoint at a distance of one chord length.
 */
export function defaultAxisPoint(points: readonly Pt[]): Pt {
  const a = points[0];
  const b = points[points.length - 1];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Unit normal of the chord pointing up (towards the sliding mass).
  let nx = -(b[1] - a[1]) / len;
  let ny = (b[0] - a[0]) / len;
  if (ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  let deepest = a;
  let depth = 0;
  for (const p of points) {
    const d = -((p[0] - a[0]) * nx + (p[1] - a[1]) * ny);
    if (d > depth) {
      depth = d;
      deepest = p;
    }
  }
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const fallback: Pt = [mid[0] + nx * len, mid[1] + ny * len];
  if (depth < 1e-6 * len) return fallback;
  // Circumcentre of a, b, deepest.
  const [x1, y1] = a;
  const [x2, y2] = b;
  const [x3, y3] = deepest;
  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2));
  const s1 = x1 * x1 + y1 * y1;
  const s2 = x2 * x2 + y2 * y2;
  const s3 = x3 * x3 + y3 * y3;
  const centre: Pt = [
    (s1 * (y2 - y3) + s2 * (y3 - y1) + s3 * (y1 - y2)) / d,
    (s1 * (x3 - x2) + s2 * (x1 - x3) + s3 * (x2 - x1)) / d,
  ];
  // The axis must lie above the sliding mass: for deep or skewed surfaces
  // the circumcentre drops below the chord (tiny or negative shear arms).
  const above = (centre[0] - mid[0]) * nx + (centre[1] - mid[1]) * ny;
  if (!(above > 0.25 * len) || Math.hypot(centre[0] - mid[0], centre[1] - mid[1]) > 10 * len) {
    return fallback;
  }
  return centre;
}

/**
 * Fit a user polyline to the ground: the surface starts where it first
 * passes from above to below the ground and ends where it comes out again.
 * End segments that stop below the ground are extended along their
 * direction until they reach it. Returns null if no sliding mass results.
 */
export function fitPolylineToGround(
  slope: Slope,
  input: readonly Pt[],
): Pt[] | null {
  const surf = slope.surfaceLineXY;
  if (!surf || input.length < 2) return null;
  const pts = [...input]
    .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .sort((p, q) => p[0] - q[0]);
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][0] - pts[i - 1][0] < 1e-9) return null;
  }
  if (pts.length < 2) return null;
  const xMin = Math.min(...surf.x);
  const xMax = Math.max(...surf.x);
  // Clamped: rounding can put an extended end a hair outside the model.
  const ground = (x: number) => getYAtX(surf.x, surf.y, Math.min(xMax, Math.max(xMin, x)));
  // At a vertical face the ground has two heights; a point is below the
  // ground only below the lower one, and on it anywhere on the face.
  const sides = (x: number): [number, number] => {
    const xc = Math.min(xMax, Math.max(xMin, x));
    return [polylineYFrom(surf.x, surf.y, xc, "left"), polylineYFrom(surf.x, surf.y, xc, "right")];
  };
  const below = (p: Pt) => p[1] < Math.min(...sides(p[0])) - 1e-9;
  const onGround = (p: Pt) => {
    const [l, r] = sides(p[0]);
    return p[1] >= Math.min(l, r) - 1e-6 && p[1] <= Math.max(l, r) + 1e-6;
  };

  // Extend the end segments until they meet the ground.
  const extend = (p: Pt, q: Pt, towardsLow: boolean): Pt | null => {
    // Walk from p away from q in steps until above ground or out of model.
    const dx = p[0] - q[0];
    const dy = p[1] - q[1];
    if ((towardsLow && dx >= 0) || (!towardsLow && dx <= 0)) return null;
    const limit = towardsLow ? xMin : xMax;
    const tMax = (limit - p[0]) / dx;
    // An end point beyond the model edge (below the ground continued
    // there): the line comes in through the side of the model, not through
    // the ground. Walking back from it put an end point on the wrong side
    // of its neighbour and the polyline out of order.
    if (!(tMax > 0)) return null;
    const f = (t: number) => p[1] + t * dy - ground(p[0] + t * dx);
    if (f(tMax) < 0) return null;
    let lo = 0;
    let hi = tMax;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (f(mid) < 0) lo = mid;
      else hi = mid;
    }
    return [Math.min(xMax, Math.max(xMin, p[0] + hi * dx)), p[1] + hi * dy];
  };
  if (below(pts[0])) {
    const e = extend(pts[0], pts[1], true);
    if (!e) return null;
    pts.unshift(e);
  }
  if (below(pts[pts.length - 1])) {
    const e = extend(pts[pts.length - 1], pts[pts.length - 2], false);
    if (!e) return null;
    pts.push(e);
  }

  // Crossings with the ground: entry = first down-crossing, exit = the
  // next up-crossing. Kept within the polyline: for a polyline that ends
  // on the ground (e.g. one fitted before, as the reliability analysis
  // passes back) rounding can put the crossing a hair beyond the end
  // vertex, where the polyline has no height (NaN exit, surface dropped).
  const xFirst = pts[0][0];
  const xLast = pts[pts.length - 1][0];
  const crossings = [
    ...new Set(
      polylineCrossingsX(pts, surf.x, surf.y, false).map((x) =>
        Math.min(xLast, Math.max(xFirst, x)),
      ),
    ),
  ].sort((p, q) => p - q);
  const eps = 1e-6;
  let entry: number | null = null;
  let exit: number | null = null;
  for (const x of crossings) {
    const yb = (t: number) => polylineYAt(pts, t) - ground(t);
    if (entry === null) {
      if (yb(x + eps) < 0 && !(yb(x - eps) < 0)) entry = x;
    } else if (yb(x - eps) < 0 && !(yb(x + eps) < 0)) {
      exit = x;
      break;
    }
  }
  // A surface that starts or ends on the ground (e.g. at the foot of a
  // vertical wall, where the ground is double-valued) enters or leaves
  // there.
  const first = pts[0];
  const last = pts[pts.length - 1];
  // On the polyline (at a vertical face the ground there is ambiguous).
  let entryPt: Pt | null = entry === null ? null : [entry, polylineYAt(pts, entry)];
  if (entryPt === null && onGround(first) && polylineYAt(pts, first[0] + eps) < ground(first[0] + eps)) {
    entry = first[0];
    entryPt = [first[0], first[1]];
  }
  let exitPt: Pt | null = exit === null ? null : [exit, polylineYAt(pts, exit)];
  if (entry !== null && exitPt === null && onGround(last) && polylineYAt(pts, last[0] - eps) < ground(last[0] - eps)) {
    exit = last[0];
    exitPt = [last[0], last[1]];
  }
  if (entry === null || exit === null || !entryPt || !exitPt || exit - entry < 1e-6) return null;
  const out: Pt[] = [entryPt];
  for (const p of pts) if (p[0] > entry + 1e-9 && p[0] < exit - 1e-9) out.push([p[0], p[1]]);
  out.push(exitPt);
  return out;
}

/**
 * Kinematic and geometric admissibility of a polyline surface: x strictly
 * increasing, interior vertices below the ground and inside the model,
 * and concave (the base inclination never increases towards the exit),
 * within `concavityTolDeg`.
 */
export function isAdmissiblePolyline(
  slope: Slope,
  points: readonly Pt[],
  concavityTolDeg = 1,
): boolean {
  const surf = slope.surfaceLineXY;
  if (!surf || points.length < 2) return false;
  if (!points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))) return false;
  let prevAlpha = Infinity;
  const tol = (concavityTolDeg * Math.PI) / 180;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    if (bx - ax < 1e-6) return false;
    const alpha = Math.atan2(ay - by, bx - ax);
    if (alpha > prevAlpha + tol) return false;
    prevAlpha = alpha;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    if (!(y < getYAtX(surf.x, surf.y, x) - 1e-6)) return false;
    if (!slope.isInsideExternalBoundary(x, y + 1e-6)) return false;
  }
  return true;
}

/** Points of a circular arc between entry and exit as a polyline. */
export function circleToPolyline(
  cx: number,
  cy: number,
  radius: number,
  lc: Pt,
  rc: Pt,
  vertices: number,
): Pt[] {
  const out: Pt[] = [[lc[0], lc[1]]];
  for (let i = 1; i < vertices - 1; i++) {
    const x = lc[0] + ((rc[0] - lc[0]) * i) / (vertices - 1);
    out.push([x, cy - Math.sqrt(Math.max(0, radius ** 2 - (x - cx) ** 2))]);
  }
  out.push([rc[0], rc[1]]);
  return out;
}
