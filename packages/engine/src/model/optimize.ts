/**
 * Non-circular optimisation of critical slip surfaces.
 *
 * The best circles of the search, and block-shaped surfaces through the
 * buried material layers, are polylines whose vertices are moved by the
 * alternating-variable method of Celestino & Duncan (1981), as built in
 * UTEXAS2 (Edris & Wright 1987, paras 87–89):
 *
 * - Each interior vertex is shifted a distance Δ in both directions
 *   normal to the surface (the bisector at a kink); the entry and exit
 *   slide along the ground. One vertex at a time, the others fixed.
 * - A parabola through the three factors of safety gives each vertex its
 *   best position, and the whole surface is then moved permanently.
 * - Δ starts at a tenth of the shortest segment and is halved twice;
 *   up to six rounds per step size.
 *
 * Once converged the polyline is refined (vertices doubled) and optimised
 * again. Surfaces stay admissible: below the ground, inside the model,
 * concave, and with entry and exit within the search limits. A candidate
 * without a complete-equilibrium solution gets no factor of safety.
 */

import type { GeometryWithMaterial } from "../types/index";
import type { Slope, SearchPlane } from "./slope";
import { circleToPolyline, isAdmissiblePolyline, type Pt } from "./surface";

/** Evaluates planes in place (sets fos, null when invalid). */
type Evaluate = (planes: SearchPlane[]) => void;

const START_VERTICES = 9;
const MAX_VERTICES = 17;
/** Best circles taken as seeds. */
const SEEDS = 3;
/** First shift as a fraction of the shortest segment (Celestino & Duncan). */
const FIRST_SHIFT = 0.1;
/**
 * The shift is halved when a round no longer helps (Celestino & Duncan:
 * Δ, ½Δ, ¼Δ on their 4–6 point surfaces), down to this fraction of the
 * first shift.
 */
const LAST_SHIFT = 0.02;
/** Rounds per step size (Celestino & Duncan: 5–6). */
const ROUNDS_PER_SHIFT = 6;

export interface OptimiseOptions {
  /** Maximum surface evaluations per seed. */
  budgetPerSeed?: number;
}

/**
 * Optimised non-circular surfaces grown from the best circles among
 * `evaluated` and from block surfaces through the buried layers. Returns
 * the final surface of each seed (evaluated).
 */
export function optimiseNonCircular(
  slope: Slope,
  evaluated: readonly SearchPlane[],
  evaluate: Evaluate,
  options: OptimiseOptions = {},
): SearchPlane[] {
  const budgetPerSeed = options.budgetPerSeed ?? 1500;
  const seeds = pickSeeds(slope, evaluated);
  const out: SearchPlane[] = [];
  for (const seed of seeds) {
    const result = optimiseCircleSeed(slope, seed, evaluate, budgetPerSeed);
    if (result) out.push(result);
  }
  for (const seed of layerSeeds(slope, seeds)) {
    const result = optimisePoints(slope, seed.points, seed.axis, evaluate, budgetPerSeed);
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
    optimised: true,
  };
}

/** The circle as a polyline, finer when the coarse chords cut the air. */
function optimiseCircleSeed(
  slope: Slope,
  seed: SearchPlane,
  evaluate: Evaluate,
  budget: number,
): SearchPlane | null {
  const axis: Pt = [seed.cx, seed.cy];
  for (const vertices of [START_VERTICES, MAX_VERTICES, 2 * MAX_VERTICES - 1]) {
    const points = circleToPolyline(seed.cx, seed.cy, seed.radius, seed.lc, seed.rc, vertices);
    const plane = makePlane(points, axis);
    evaluate([plane]);
    budget--;
    if (plane.fos != null) return optimisePoints(slope, points, axis, evaluate, budget, plane);
    if (budget <= 0) break;
  }
  return null;
}

// ── Seeds through buried layers ───────────────────────────────────

/** Vertical extent [yMin, yMax] of a polygon at x, or null outside it. */
function polygonYExtentAt(px: readonly number[], py: readonly number[], x: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const n = px.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = px[i], xj = px[j];
    if ((xi <= x && x < xj) || (xj <= x && x < xi)) {
      const y = py[i] + ((x - xi) * (py[j] - py[i])) / (xj - xi);
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  return hi > lo ? [lo, hi] : null;
}

/**
 * Block surfaces along the middle of each buried layer: down from the
 * entry at the active angle 45° + φ/2, along the layer, up to the exit at
 * the passive angle 45° − φ/2 (Coulomb; UTEXAS2 vol. II fig. 6), with the
 * entry and exit of each circle seed. UTEXAS2 (para. 86): the initial
 * surface "should be input so that it passes through the weaker material".
 */
function layerSeeds(slope: Slope, circleSeeds: readonly SearchPlane[]): { points: Pt[]; axis: Pt }[] {
  const out: { points: Pt[]; axis: Pt }[] = [];
  const groundAt = (x: number) => slope.getExternalYIntersection(x);
  const seen: number[] = [];
  const geometries = slope.materialGeometries;
  /** Strength proxy c + σ′ tan φ at depth d (σ′ from the mean unit weight). */
  const strength = (mat: GeometryWithMaterial["material"], depth: number) => {
    const gamma = mat.unitWeight > 0 ? mat.unitWeight : 18;
    return mat.cohesion + gamma * depth * Math.tan((mat.frictionAngle * Math.PI) / 180);
  };
  /** True when no material above the layer at x is weaker than it. */
  const weakest = (m: GeometryWithMaterial, x: number): boolean => {
    const ext = polygonYExtentAt(m.px, m.py, x);
    const g = groundAt(x);
    if (!ext || !Number.isFinite(g)) return false;
    const mid = (ext[0] + ext[1]) / 2;
    const own = strength(m.material, g - mid);
    for (const o of geometries) {
      if (o === m) continue;
      const e = polygonYExtentAt(o.px, o.py, x);
      if (!e || e[0] < mid) continue; // not above the layer's middle
      if (strength(o.material, g - (e[0] + e[1]) / 2) <= own) return false;
    }
    return true;
  };
  for (const m of geometries) {
    const phi = (m.material.frictionAngle * Math.PI) / 180;
    const tanA = Math.tan(Math.PI / 4 + phi / 2);
    const tanP = Math.tan(Math.PI / 4 - phi / 2);
    for (const seed of circleSeeds) {
      const [xe, ye] = seed.lc;
      const [xx, yx] = seed.rc;
      const mid = (x: number) => {
        const ext = polygonYExtentAt(m.px, m.py, x);
        return ext ? (ext[0] + ext[1]) / 2 : NaN;
      };
      // A buried layer: its top lies below the ground between entry and
      // exit (the layer at the surface is covered by the circle seeds).
      const buried = (x: number) => {
        const ext = polygonYExtentAt(m.px, m.py, x);
        return ext != null && ext[1] < groundAt(x) - 1e-6;
      };
      if (!buried(xe + 0.25 * (xx - xe)) || !buried(xx - 0.25 * (xx - xe))) continue;
      if (!weakest(m, (xe + xx) / 2)) continue;
      // Where a wedge at the given inclination from the entry (exit) meets
      // the layer: the depth there sets the wedge length, so iterate.
      const wedge = (xEnd: number, yEnd: number, tan: number, sign: 1 | -1): Pt | null => {
        let x = xEnd + sign * 0.25 * (xx - xe);
        for (let i = 0; i < 8; i++) {
          const y = mid(x);
          if (!Number.isFinite(y) || !(y < yEnd)) return null;
          const next = xEnd + (sign * (yEnd - y)) / tan;
          if (Math.abs(next - x) < 1e-6) {
            x = next;
            break;
          }
          x = next;
        }
        const y = mid(x);
        return Number.isFinite(y) && y < yEnd ? [x, y] : null;
      };
      const a = wedge(xe, ye, tanA, 1);
      const b = wedge(xx, yx, tanP, -1);
      if (!a || !b) continue;
      const [xa, ya] = a;
      const [xb, yb] = b;
      if (!(xb - xa > 0.1 * (xx - xe))) continue;
      // One seed per distinct layer depth under this entry/exit pair.
      const key = Math.round(((ya + yb) / 2) * 100) / 100 + 1e6 * Math.round(xe * 10) + 1e9 * Math.round(xx * 10);
      if (seen.includes(key)) continue;
      seen.push(key);
      const points: Pt[] = [[xe, ye], [xa, ya]];
      const runs = START_VERTICES - 4;
      for (let i = 1; i < runs; i++) {
        const x = xa + ((xb - xa) * i) / runs;
        const y = mid(x);
        if (!Number.isFinite(y)) break;
        points.push([x, y]);
      }
      points.push([xb, yb], [xx, yx]);
      if (!isAdmissiblePolyline(slope, points)) continue;
      out.push({ points, axis: [seed.cx, seed.cy] });
    }
  }
  return out;
}

// ── The alternating-variable search ───────────────────────────────

/**
 * Moves the vertices of `points` by the alternating-variable method until
 * no shift helps. `start` is the evaluated plane of `points` when known.
 */
function optimisePoints(
  slope: Slope,
  start: Pt[],
  axis: Pt,
  evaluate: Evaluate,
  budget: number,
  startPlane?: SearchPlane,
): SearchPlane | null {
  let points = start;
  let used = 0;
  let best: SearchPlane;
  if (startPlane) best = startPlane;
  else {
    best = makePlane(points, axis);
    evaluate([best]);
    used++;
    if (best.fos == null) return null;
  }

  const groundAt = (x: number) => slope.getExternalYIntersection(x);
  const [entryL, entryR, exitL, exitR] = slope.limits;
  const tol = 1e-9;
  const minLength = Math.max(slope.minFailureDistance, 0);

  /** FOS of a candidate (null: inadmissible, invalid or out of budget). */
  const fosOf = (candidate: Pt[]): { plane: SearchPlane; fos: number } | null => {
    if (used >= budget) return null;
    if (candidate[candidate.length - 1][0] - candidate[0][0] <= minLength) return null;
    if (slope.minSlipDepth > 0) {
      let d = 0;
      for (const [x, y] of candidate) d = Math.max(d, groundAt(x) - y);
      if (d < slope.minSlipDepth) return null;
    }
    if (!isAdmissiblePolyline(slope, candidate)) return null;
    const plane = makePlane(candidate, axis);
    evaluate([plane]);
    used++;
    return plane.fos != null && Number.isFinite(plane.fos) ? { plane, fos: plane.fos } : null;
  };

  /** The vertex k shifted by t along its direction; null when it cannot move. */
  const shifted = (pts: Pt[], k: number, t: number): Pt | null => {
    const n = pts.length;
    if (k === 0 || k === n - 1) {
      // Entry and exit slide along the ground within the search limits.
      let x = pts[k][0] + t;
      const [lo, hi] = k === 0 ? [entryL, entryR] : [exitL, exitR];
      if (x < lo - tol || x > hi + tol) return null;
      x = Math.min(hi, Math.max(lo, x));
      const neighbour = pts[k === 0 ? 1 : k - 1][0];
      if (k === 0 ? x >= neighbour : x <= neighbour) return null;
      const g = groundAt(x);
      return Number.isFinite(g) ? [x, g] : null;
    }
    // Normal to the surface at the vertex: the bisector of the normals of
    // the two segments, pointing up.
    const [ax, ay] = pts[k - 1];
    const [bx, by] = pts[k];
    const [cx, cy] = pts[k + 1];
    const l1 = Math.hypot(bx - ax, by - ay);
    const l2 = Math.hypot(cx - bx, cy - by);
    let nx = -(by - ay) / l1 - (cy - by) / l2;
    let ny = (bx - ax) / l1 + (cx - bx) / l2;
    const ln = Math.hypot(nx, ny);
    if (!(ln > 0)) return null;
    nx /= ln;
    ny /= ln;
    return [bx + t * nx, by + t * ny];
  };

  const withVertex = (pts: Pt[], k: number, p: Pt): Pt[] => {
    const c = pts.map((q) => [q[0], q[1]] as Pt);
    c[k] = p;
    return c;
  };

  for (let stage = 0; stage < 2; stage++) {
    let minSegment = Infinity;
    for (let i = 1; i < points.length; i++) {
      minSegment = Math.min(minSegment, Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
    }
    const firstShift = FIRST_SHIFT * minSegment;
    if (!(firstShift > 0)) break;

    for (let delta = firstShift; delta >= LAST_SHIFT * firstShift && used < budget; delta /= 2) {
      for (let round = 0; round < ROUNDS_PER_SHIFT && used < budget; round++) {
        const f0 = best.fos!;
        const shifts = new Array<number>(points.length).fill(0);
        // (Assigned inside `side`; the cast keeps the type from narrowing.)
        let bestSingle = null as { plane: SearchPlane; fos: number; points: Pt[] } | null;
        for (let k = 0; k < points.length && used < budget; k++) {
          const side = (t: number) => {
            const p = shifted(points, k, t);
            if (!p) return null;
            const candidate = withVertex(points, k, p);
            const r = fosOf(candidate);
            if (r && (!bestSingle || r.fos < bestSingle.fos)) bestSingle = { ...r, points: candidate };
            return r?.fos ?? null;
          };
          const fPlus = side(delta);
          const fMinus = side(-delta);
          // The parabola through (−Δ, F−), (0, F0), (+Δ, F+), or the better
          // side when it has no minimum.
          let t = 0;
          if (fPlus != null && fMinus != null) {
            const curvature = fPlus + fMinus - 2 * f0;
            if (curvature > 0) {
              t = (delta * (fMinus - fPlus)) / (2 * curvature);
              t = Math.max(-delta, Math.min(delta, t));
            } else if (fPlus < f0 || fMinus < f0) {
              t = fPlus < fMinus ? delta : -delta;
            }
          } else if (fPlus != null && fPlus < f0) t = delta;
          else if (fMinus != null && fMinus < f0) t = -delta;
          shifts[k] = t;
        }

        // The permanent move: every vertex to its parabola minimum at once.
        let moved: { plane: SearchPlane; fos: number; points: Pt[] } | null = null;
        if (shifts.some((t) => t !== 0)) {
          const candidate: Pt[] = [];
          for (let k = 0; k < points.length; k++) {
            const p = shifts[k] !== 0 ? shifted(points, k, shifts[k]) : points[k];
            if (!p) {
              candidate.length = 0;
              break;
            }
            candidate.push([p[0], p[1]]);
          }
          if (candidate.length === points.length) {
            const r = fosOf(candidate);
            if (r) moved = { ...r, points: candidate };
          }
        }
        if (bestSingle && (!moved || bestSingle.fos < moved.fos)) moved = bestSingle;
        if (!moved || moved.fos >= f0 - 1e-6) break;
        best = moved.plane;
        points = moved.points;
      }
    }

    if (stage === 0 && points.length < MAX_VERTICES && used < budget) {
      // Double the vertices for a finer shape and optimise again, keeping
      // the best surface found: the extra slice boundaries change the FOS
      // slightly.
      const refined: Pt[] = [points[0]];
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        refined.push([(ax + bx) / 2, (ay + by) / 2], [bx, by]);
      }
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
