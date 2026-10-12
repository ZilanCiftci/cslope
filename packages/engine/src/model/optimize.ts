/**
 * Non-circular optimisation of critical slip surfaces.
 *
 * The best circles of the search are turned into polylines and their
 * vertices moved (interior vertices vertically, entry and exit along the
 * ground) as long as the FOS drops, with a step that halves when no move
 * helps. Once converged the polyline is refined (vertices doubled) and
 * optimised again. Surfaces stay admissible: below the ground, inside the
 * model, concave, and with entry and exit within the search limits.
 * This finds weak layers and composite mechanisms a circle cannot follow.
 */

import type { Slope, SearchPlane } from "./slope";
import { circleToPolyline, isAdmissiblePolyline, type Pt } from "./surface";

/** Evaluates planes in place (sets fos, null when invalid). */
type Evaluate = (planes: SearchPlane[]) => void;

const START_VERTICES = 9;
const MAX_VERTICES = 17;
const SEEDS = 3;

export interface OptimiseOptions {
  /** Maximum surface evaluations per seed. */
  budgetPerSeed?: number;
}

/**
 * Optimised non-circular surfaces grown from the best circles among
 * `evaluated`. Returns the final surface of each seed (evaluated).
 */
export function optimiseNonCircular(
  slope: Slope,
  evaluated: readonly SearchPlane[],
  evaluate: Evaluate,
  options: OptimiseOptions = {},
): SearchPlane[] {
  const budgetPerSeed = options.budgetPerSeed ?? 600;
  const seeds = pickSeeds(slope, evaluated);
  const out: SearchPlane[] = [];
  for (const seed of seeds) {
    const result = optimiseSeed(slope, seed, evaluate, budgetPerSeed);
    if (result) out.push(result);
  }
  return out;
}

/** Best circles with clearly different entry and exit points. */
function pickSeeds(slope: Slope, evaluated: readonly SearchPlane[]): SearchPlane[] {
  const circles = evaluated
    .filter((p) => !p.points && p.fos != null && Number.isFinite(p.fos) && p.radius > 0)
    .sort((a, b) => a.fos! - b.fos!);
  const [eL, eR, xL, xR] = slope.limits;
  const span = Math.max(Math.abs(xR - eL), Math.abs(eR - xL), 1);
  const seeds: SearchPlane[] = [];
  for (const c of circles) {
    if (seeds.length >= SEEDS) break;
    const distinct = seeds.every(
      (s) =>
        Math.abs(s.lc[0] - c.lc[0]) > 0.05 * span ||
        Math.abs(s.rc[0] - c.rc[0]) > 0.05 * span,
    );
    if (distinct) seeds.push(c);
  }
  return seeds;
}

function makePlane(points: Pt[], axis: Pt): SearchPlane {
  return {
    lc: points[0],
    rc: points[points.length - 1],
    cx: axis[0],
    cy: axis[1],
    radius: 0,
    points,
    fos: null,
    slices: null,
  };
}

function optimiseSeed(
  slope: Slope,
  seed: SearchPlane,
  evaluate: Evaluate,
  budget: number,
): SearchPlane | null {
  const axis: Pt = [seed.cx, seed.cy];
  // Start from the circle as a polyline; under a convex crest the chords
  // near the entry can cut through the air, so try finer ones before
  // giving up on the seed.
  let points: Pt[] = [];
  let best: SearchPlane | null = null;
  let used = 0;
  for (const vertices of [START_VERTICES, MAX_VERTICES, 2 * MAX_VERTICES - 1]) {
    points = circleToPolyline(seed.cx, seed.cy, seed.radius, seed.lc, seed.rc, vertices);
    const plane = makePlane(points, axis);
    evaluate([plane]);
    used++;
    if (plane.fos != null) {
      best = plane;
      break;
    }
  }
  if (!best) return null;

  const groundAt = (x: number) => slope.getExternalYIntersection(x);
  const [entryL, entryR, exitL, exitR] = slope.limits;
  const tol = 1e-9;

  let depth = 0;
  for (const [x, y] of points) depth = Math.max(depth, groundAt(x) - y);
  if (!(depth > 0)) return best;
  const span = points[points.length - 1][0] - points[0][0];
  const minStep = Math.max(1e-3, 2e-3 * depth);

  const minLength = Math.max(slope.minFailureDistance, 0);
  const tryCandidate = (candidate: Pt[]): boolean => {
    if (used >= budget) return false;
    if (candidate[candidate.length - 1][0] - candidate[0][0] <= minLength) return false;
    if (slope.minSlipDepth > 0) {
      let d = 0;
      for (const [x, y] of candidate) d = Math.max(d, groundAt(x) - y);
      if (d < slope.minSlipDepth) return false;
    }
    if (!isAdmissiblePolyline(slope, candidate)) return false;
    const plane = makePlane(candidate, axis);
    evaluate([plane]);
    used++;
    if (plane.fos != null && plane.fos < best!.fos! - 1e-6) {
      best = plane;
      points = candidate;
      return true;
    }
    return false;
  };

  for (let stage = 0; stage < 2; stage++) {
    let step = 0.15 * depth;
    while (step >= minStep && used < budget) {
      let improved = false;
      for (let k = 0; k < points.length && used < budget; k++) {
        for (const dir of [-1, 1]) {
          const candidate = points.map((p) => [p[0], p[1]] as Pt);
          if (k === 0 || k === points.length - 1) {
            // Entry/exit slide along the ground within the search limits.
            let x = points[k][0] + dir * step * Math.max(1, span / depth) * 0.5;
            const [lo, hi] = k === 0 ? [entryL, entryR] : [exitL, exitR];
            if (x < lo - tol || x > hi + tol) continue;
            // Within the tolerance: snap to the limit (it can be the model
            // edge, where the ground is undefined just outside).
            x = Math.min(hi, Math.max(lo, x));
            const neighbour = points[k === 0 ? 1 : k - 1][0];
            if (k === 0 ? x >= neighbour : x <= neighbour) continue;
            const g = groundAt(x);
            if (!Number.isFinite(g)) continue;
            candidate[k] = [x, g];
          } else {
            candidate[k] = [points[k][0], points[k][1] + dir * step];
          }
          if (tryCandidate(candidate)) {
            improved = true;
            break;
          }
        }
      }
      if (!improved) step /= 2;
    }
    // The refined shape costs an evaluation too (the budget is a maximum).
    if (stage === 0 && points.length < MAX_VERTICES && used < budget) {
      // Double the vertices for a finer shape and optimise again.
      const refined: Pt[] = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        refined.push([(ax + bx) / 2, (ay + by) / 2], [bx, by]);
      }
      // Continue from the refined shape, but keep the best surface found:
      // the extra slice boundaries change the FOS slightly.
      const plane = makePlane(refined, axis);
      evaluate([plane]);
      used++;
      if (plane.fos == null) break;
      points = refined;
      if (plane.fos < best.fos!) best = plane;
    } else {
      break;
    }
  }
  return best;
}
