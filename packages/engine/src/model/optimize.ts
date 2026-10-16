/**
 * Non-circular optimisation of critical slip surfaces.
 *
 * The best circles of the search, and the best block surfaces through the
 * buried material layers, are polylines whose vertices are moved by the
 * alternating-variable method of Celestino & Duncan (1981), as built in
 * the Corps of Engineers manual of Edris & Wright (1987, paras 87–89):
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

import { resolveStrength, type GeometryWithMaterial } from "../types/index";
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
  for (const seed of layerSeeds(slope, evaluate)) {
    const result = optimisePoints(slope, seed.points, seed.axis, evaluate, budgetPerSeed, seed.plane);
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

/** Grid positions along a layer for the start and the end of the run. */
const RUN_GRID = 7;
/** Block surfaces per layer carried on to the alternating-variable search. */
const LAYER_SEEDS = 3;

/** First point where the ray from (x0, y0) in direction (dx, dy) meets the ground. */
function rayToGround(ground: { x: readonly number[]; y: readonly number[] }, x0: number, y0: number, dx: number, dy: number): Pt | null {
  let best = Infinity;
  let hit: Pt | null = null;
  for (let i = 0; i + 1 < ground.x.length; i++) {
    const ax = ground.x[i], ay = ground.y[i];
    const ex = ground.x[i + 1] - ax, ey = ground.y[i + 1] - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - x0) * ey - (ay - y0) * ex) / den;
    const u = ((ax - x0) * dy - (ay - y0) * dx) / den;
    if (t > 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 && t < best) {
      best = t;
      hit = [x0 + t * dx, y0 + t * dy];
    }
  }
  return hit;
}

/**
 * Block surfaces along the middle of each buried layer, in the manner of a
 * block search: a grid of positions along the layer for the start and the
 * end of the run; from the start the active wedge rises at 45° + φ/2 to
 * the entry, from the end the passive wedge at 45° − φ/2 to the exit
 * (Coulomb; Wright 1988, fig. 6), φ of the material the wedge cuts. Every
 * grid combination within the search limits is evaluated once, and the
 * best few go on to the alternating-variable search. Edris & Wright (1987,
 * para. 86): the initial surface "should be input so that it passes
 * through the weaker material".
 */
function layerSeeds(slope: Slope, evaluate: Evaluate): { points: Pt[]; axis: Pt; plane: SearchPlane }[] {
  const out: { points: Pt[]; axis: Pt; plane: SearchPlane }[] = [];
  const ground = slope.surfaceLineXY;
  if (!ground) return out;
  const groundAt = (x: number) => slope.getExternalYIntersection(x);
  const [entryL, entryR, exitL, exitR] = slope.limits;
  const span = Math.max(exitR - entryL, 1);
  const geometries = slope.materialGeometries;
  /** c and φ (rad) of a material at the point (x, y), as the slices see them. */
  const params = (m: GeometryWithMaterial, x: number, y: number, g: number) => {
    const r = resolveStrength(m.material.model, { yBottom: y, x, yGround: g, alpha: 0 });
    return { c: r.cohesion, phi: (r.frictionAngle * Math.PI) / 180 };
  };
  /**
   * True when every material above the layer at x is stronger than it at
   * the layer's own effective stress (Mohr-Coulomb: c + σ′ tan φ, each
   * material with its own parameters, σ′ from the overburden). Comparing
   * at one stress keeps a shallow layer from looking weaker just because
   * the stress is lower there.
   */
  const weakest = (m: GeometryWithMaterial, x: number): boolean => {
    const ext = polygonYExtentAt(m.px, m.py, x);
    const g = groundAt(x);
    if (!ext || !Number.isFinite(g)) return false;
    const mid = (ext[0] + ext[1]) / 2;
    const gamma = m.material.unitWeight > 0 ? m.material.unitWeight : 18;
    const sigma = gamma * (g - mid);
    const own = params(m, x, mid, g);
    const ownStrength = own.c + sigma * Math.tan(own.phi);
    for (const o of geometries) {
      if (o === m) continue;
      const e = polygonYExtentAt(o.px, o.py, x);
      if (!e || e[0] < mid) continue; // not above the layer's middle
      const p = params(o, x, (e[0] + e[1]) / 2, g);
      if (p.c + sigma * Math.tan(p.phi) <= ownStrength) return false;
    }
    return true;
  };
  /** Friction angle (rad) of the material directly above the layer at x. */
  const phiAbove = (m: GeometryWithMaterial, x: number, top: number): number => {
    const g = groundAt(x);
    let above: GeometryWithMaterial | null = null;
    let aboveExt: [number, number] | null = null;
    for (const o of geometries) {
      if (o === m) continue;
      const e = polygonYExtentAt(o.px, o.py, x);
      if (e && e[0] >= top - 1e-6 && (!aboveExt || e[0] < aboveExt[0])) {
        above = o;
        aboveExt = e;
      }
    }
    return above && aboveExt ? params(above, x, (aboveExt[0] + aboveExt[1]) / 2, g).phi : params(m, x, top, g).phi;
  };
  const distinct = (a: Pt[], b: Pt[]) =>
    Math.abs(a[0][0] - b[0][0]) > 0.05 * span || Math.abs(a[a.length - 1][0] - b[b.length - 1][0]) > 0.05 * span;

  for (const m of geometries) {
    const xMin = Math.max(Math.min(...m.px), entryL);
    const xMax = Math.min(Math.max(...m.px), exitR);
    if (!(xMax - xMin > 0.1 * span)) continue;
    const mid = (x: number) => {
      const ext = polygonYExtentAt(m.px, m.py, x);
      return ext ? (ext[0] + ext[1]) / 2 : NaN;
    };
    // A buried layer: its top below the ground (a layer at the surface is
    // covered by the circle seeds).
    const buried = (x: number) => {
      const ext = polygonYExtentAt(m.px, m.py, x);
      return ext != null && ext[1] < groundAt(x) - 1e-6;
    };
    // Grid positions along the layer, inside it and buried.
    const grid: { x: number; y: number; top: number }[] = [];
    for (let i = 0; i < RUN_GRID; i++) {
      const x = xMin + ((xMax - xMin) * (i + 0.5)) / RUN_GRID;
      const ext = polygonYExtentAt(m.px, m.py, x);
      if (!ext || !buried(x)) continue;
      grid.push({ x, y: (ext[0] + ext[1]) / 2, top: ext[1] });
    }
    if (grid.length < 2 || !weakest(m, grid[Math.floor(grid.length / 2)].x)) continue;

    const candidates: { points: Pt[]; axis: Pt; plane: SearchPlane }[] = [];
    for (const a of grid) {
      const phiA = phiAbove(m, a.x, a.top);
      const entry = rayToGround(ground, a.x, a.y, -1, Math.tan(Math.PI / 4 + phiA / 2));
      if (!entry || entry[0] < entryL - 1e-9 || entry[0] > entryR + 1e-9) continue;
      for (const b of grid) {
        if (!(b.x - a.x > 0.1 * span)) continue;
        const phiB = phiAbove(m, b.x, b.top);
        const exit = rayToGround(ground, b.x, b.y, 1, Math.tan(Math.PI / 4 - phiB / 2));
        if (!exit || exit[0] < exitL - 1e-9 || exit[0] > exitR + 1e-9) continue;
        const points: Pt[] = [entry, [a.x, a.y]];
        const runs = START_VERTICES - 4;
        for (let i = 1; i < runs; i++) {
          const x = a.x + ((b.x - a.x) * i) / runs;
          const y = mid(x);
          if (!Number.isFinite(y)) break;
          points.push([x, y]);
        }
        points.push([b.x, b.y], exit);
        if (!isAdmissiblePolyline(slope, points)) continue;
        // Moment axis above the middle of the surface, as a circle centre would be.
        const axis: Pt = [(entry[0] + exit[0]) / 2, Math.max(entry[1], exit[1]) + (exit[0] - entry[0]) / 2];
        candidates.push({ points, axis, plane: makePlane(points, axis) });
      }
    }
    evaluate(candidates.map((c) => c.plane));
    const solved = candidates
      .filter((c) => c.plane.fos != null && Number.isFinite(c.plane.fos))
      .sort((a, b) => a.plane.fos! - b.plane.fos!);
    const chosen: typeof solved = [];
    for (const c of solved) {
      if (chosen.length >= LAYER_SEEDS) break;
      if (chosen.every((s) => distinct(s.points, c.points))) chosen.push(c);
    }
    out.push(...chosen);
  }
  return out;
}

// ── The alternating-variable search ───────────────────────────────

/**
 * Moves the vertices of `points` by the alternating-variable method until
 * no shift helps. `startPlane` is the evaluated plane of `points`.
 */
function optimisePoints(
  slope: Slope,
  start: Pt[],
  axis: Pt,
  evaluate: Evaluate,
  budget: number,
  startPlane: SearchPlane,
): SearchPlane | null {
  let points = start;
  let used = 0;
  let best = startPlane;

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
