/**
 * Morgenstern–Price / Spencer solved as a root-finding problem.
 *
 * An experimental solver kept beside `analyseMorgensternPrice` so that the
 * two can be compared before one replaces the other. Same slice physics as
 * the iterative solver (`solveSliceNormal`, the same strength, water,
 * reinforcement and load terms), a different numerical method:
 *
 * - For a trial (F, λ) the slices are marched once from left to right. The
 *   march gives every base normal and interslice force directly, so there
 *   is no fixed-point iteration on F or N. The march returns the two
 *   residuals the method must close: force, g_f = D_f − R_f/F (horizontal
 *   equilibrium of the whole mass), and moment, g_m = D_m − R_m/F (moment
 *   equilibrium about the circle centre, or the axis point of a polyline).
 * - F_f(λ): the F that closes force equilibrium at a given λ, found as the
 *   root of g_f in F within the pole-free band (every slice's denominator
 *   positive, i.e. m_α with the interslice inclination included keeps its
 *   sign; outside it a base normal has reversed). The force residual is
 *   monotonic in F there.
 * - h(λ) = g_m(F_f(λ), λ): the moment residual evaluated at the force-
 *   equilibrium F, one smooth scalar function of λ whose zeros are the
 *   solutions. Working through F_f keeps the search off the moment-only
 *   curve F_m(λ), which has spurious branches (F → 0). h is scanned on a λ
 *   grid, every sign change between two defined neighbours is bracketed,
 *   and each root is refined with Brent's method.
 * - A two-dimensional Newton iteration on (F, λ) from (F_Bishop, 0) is the
 *   fast path; the λ scan is the reference and the fallback.
 *
 * Sources: Fredlund (1984) recommends Newton–Raphson on (F, λ); the
 * F_f/F_m crossing is Fredlund & Krahn (1977); the pole-free band is
 * Morgenstern & Price's (1965) positivity rule in slice form, the form an
 * open implementation (Jones 2026) uses. Selection among several roots is left to the
 * caller (`RootRule`); the roots are all reported.
 */

import type { Slice } from "../types/index";
import type { Slope } from "./slope";
import { getSlicePropertyArrays, solveSliceNormal, analyseOrdinary } from "./solvers";

type SliceArrays = ReturnType<typeof getSlicePropertyArrays>;

/** One march over the slices at a trial (F, λ). */
export interface March {
  /** Force residual D_f − R_f/F (kN/m); zero at force equilibrium. */
  gf: number;
  /** Moment residual D_m − R_m/F (kN·m/m); zero at moment equilibrium. */
  gm: number;
  /** Scale of the force terms, |D_f| + |R_f/F|, for relative tests. */
  fScale: number;
  /** Scale of the moment terms. */
  mScale: number;
  /** Effective base normal force per slice (kN/m). */
  N: Float64Array;
  /** Interslice normal force on the right of each slice (solver sign). */
  E: Float64Array;
  /** Interslice shear force on the right of each slice. */
  X: Float64Array;
  /** Smallest slice denominator; > 0 means every slice is inside the band. */
  minDenom: number;
  /** Slices whose denominator is ≤ 0. */
  outOfBand: number;
  /** Slices with N < 0. */
  negativeN: number;
  /** Largest interslice resultant over the total vertical load. */
  maxZOverLoad: number;
  /** Whether the combined-method slices ended on the undrained strength. */
  undrained: Uint8Array;
}

/** Marches performed since the module loaded (for cost measurements). */
export const marchCounter = { count: 0 };

/** Same per-slice equations as the iterative solvers, evaluated once. */
export function march(p: SliceArrays, lambda: number, F: number): March {
  marchCounter.count++;
  const n = p.weights.length;
  const N = new Float64Array(n);
  const E = new Float64Array(n);
  const X = new Float64Array(n);
  const undrained = new Uint8Array(n);
  const kP = F > 0 ? 1 / F : 1;
  let eLeft = 0;
  let xLeft = 0;
  let mPush = 0;
  let mRes = 0;
  let passiveMoment = 0;
  let fPush = 0;
  let fRes = 0;
  let passiveForce = 0;
  let minDenom = Infinity;
  let outOfBand = 0;
  let negativeN = 0;
  let maxZ = 0;
  let load = 0;

  for (let i = 0; i < n; i++) {
    const W = p.weights[i] + p.udls[i] + p.lls[i] + p.activeV[i] + p.passiveV[i] * kP;
    const H = p.hForces[i] + p.activeH[i] + p.passiveH[i] * kP;
    const c = p.cohesions[i];
    const bl = p.baseLengths[i];
    const a = p.alphas[i];
    const U = p.Us[i];
    const cu = p.cohesionUndraineds[i];
    const tanPhi = Math.tan(p.phis[i]);
    const cosA = Math.cos(a);
    const sinA = Math.sin(a);
    const sf = lambda * p.funcs[i];

    let tanUsed = tanPhi;
    let [Ni, eRight, xRight] = solveSliceNormal(
      W, xLeft, eLeft - H, c * bl - U * bl * tanPhi, tanPhi, cosA, sinA, sf, F,
    );
    let shear = c * bl + (Ni - U * bl) * tanPhi;
    // Combined method: where the undrained strength governs, the slice is
    // in equilibrium with that shear (as in the iterative solvers).
    if (p.materialCodes[i] === 1 && !(shear >= 0 && shear <= cu * bl)) {
      [Ni, eRight, xRight] = solveSliceNormal(W, xLeft, eLeft - H, cu * bl, 0, cosA, sinA, sf, F);
      shear = cu * bl;
      tanUsed = 0;
      undrained[i] = 1;
    }
    // The denominator of the slice's normal force: m_α with the interslice
    // inclination included. Zero is a pole of the march.
    const denom = cosA + (sinA * tanUsed) / F - ((tanUsed * cosA) / F - sinA) * sf;
    if (denom < minDenom) minDenom = denom;
    if (denom <= 0) outOfBand++;
    if (Ni < 0) negativeN++;

    mRes += shear * p.shearArms[i];
    mPush += (W - p.passiveV[i] * kP) * p.dxs[i] + p.extraMoments[i] + p.activeM[i] + Ni * p.normalArms[i];
    passiveMoment += p.passiveV[i] * p.dxs[i] + p.passiveM[i];
    fRes += shear * cosA;
    fPush += Ni * sinA + H - p.passiveH[i] * kP;
    passiveForce += p.passiveH[i];

    N[i] = Ni;
    E[i] = eRight;
    X[i] = xRight;
    const z = Math.hypot(eRight, xRight);
    if (z > maxZ) maxZ = z;
    load += Math.abs(p.weights[i] + p.udls[i] + p.lls[i]);
    eLeft = eRight;
    xLeft = xRight;
  }
  mRes -= passiveMoment;
  fRes -= passiveForce;
  return {
    gf: fPush - fRes / F,
    gm: mPush - mRes / F,
    fScale: Math.abs(fPush) + Math.abs(fRes / F),
    mScale: Math.abs(mPush) + Math.abs(mRes / F),
    N, E, X, minDenom, outOfBand, negativeN,
    maxZOverLoad: load > 0 ? maxZ / load : 0,
    undrained,
  };
}

/** Brent's method on [a, b] with fa·fb < 0. */
function brent(f: (x: number) => number, a: number, b: number, fa: number, fb: number, xtol: number, maxIter = 100): number {
  let c = a, fc = fa, d = b - a, e = d;
  for (let iter = 0; iter < maxIter; iter++) {
    if (fb * fc > 0) { c = a; fc = fa; d = b - a; e = d; }
    if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
    const tol = 2 * Number.EPSILON * Math.abs(b) + xtol / 2;
    const m = (c - b) / 2;
    if (Math.abs(m) <= tol || fb === 0) return b;
    if (Math.abs(e) >= tol && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let pp: number, q: number;
      if (a === c) { pp = 2 * m * s; q = 1 - s; }
      else {
        const qq = fa / fc, r = fb / fc;
        pp = s * (2 * m * qq * (qq - r) - (b - a) * (r - 1));
        q = (qq - 1) * (r - 1) * (s - 1);
      }
      if (pp > 0) q = -q; else pp = -pp;
      if (2 * pp < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = pp / q; }
      else { d = m; e = m; }
    } else { d = m; e = m; }
    a = b; fa = fb;
    b += Math.abs(d) > tol ? d : m > 0 ? tol : -tol;
    fb = f(b);
  }
  return b;
}

/**
 * Smallest slice denominator (m_α with the interslice inclination included)
 * a root may have. Near zero the base normal force of that slice tends to
 * infinity and the factor of safety is meaningless (Whitman & Bailey 1967,
 * Ching & Fredlund 1983); 0.2 is the limit commonly quoted from Whitman &
 * Bailey. On the verification set every root that agrees with the
 * published value has a minimum denominator ≥ 0.22, and every spurious
 * root the search otherwise reaches has ≤ 0.06.
 */
export const MIN_DENOMINATOR = 0.2;

/**
 * Limits on the interslice force inclination θ = atan(λ f), from the Corps of
 * Engineers manual of Edris & Wright (1987, vol. I para. 107): the solution is terminated
 * when θ is less than −10° or steeper than +80° for a left-facing slope.
 * λ is the scale of f(x), so with f = 1 (Spencer) λ = tan θ.
 */
export const LAMBDA_MIN = Math.tan((-10 * Math.PI) / 180);
export const LAMBDA_MAX = Math.tan((80 * Math.PI) / 180);

/** F is not allowed below 0.10 (Edris & Wright 1987, vol. I para. 104). */
const F_MIN = 0.1;
const F_MAX = 50;
const F_GRID = 24;
const F_TOL = 1e-7;

/** Residual of force equilibrium at F, or NaN outside the band. */
function gfInBand(p: SliceArrays, lambda: number, F: number): number {
  const m = march(p, lambda, F);
  return m.outOfBand > 0 || !Number.isFinite(m.gf) ? NaN : m.gf;
}

/**
 * The pole-free band in F at a given λ, in closed form: each slice's
 * denominator is a + b/F with a = cos α + λf sin α and b = tan φ (sin α −
 * λf cos α), positive for F on one side of its pole −b/a. Combined-method
 * slices, whose tan φ depends on the solution, are left out; the march
 * still checks every slice. Returns [lo, hi] within [F_MIN, F_MAX], empty
 * (lo ≥ hi) when no F keeps every denominator positive.
 */
export function forceBand(p: SliceArrays, lambda: number): [number, number] {
  let lo = F_MIN, hi = F_MAX;
  for (let i = 0; i < p.weights.length && lo < hi; i++) {
    if (p.materialCodes[i] === 1) continue;
    const sf = lambda * p.funcs[i];
    const cosA = Math.cos(p.alphas[i]), sinA = Math.sin(p.alphas[i]);
    const a = cosA + sf * sinA;
    const b = Math.tan(p.phis[i]) * (sinA - sf * cosA);
    if (a > 0) { if (b < 0) lo = Math.max(lo, -b / a); }
    else if (a < 0) { if (b > 0) hi = Math.min(hi, -b / a); else return [1, 0]; }
    else if (b <= 0) return [1, 0];
  }
  return [lo, hi];
}

/**
 * F_f(λ): the F closing force equilibrium at λ, inside the pole-free band.
 * Secant from the seed first; a bracketed scan of F when that fails.
 * Returns null when no such F exists (a hole in h(λ)). `count` is how
 * many roots the scan found in the band (normally one).
 */
export function solveForceF(p: SliceArrays, lambda: number, seed: number): { F: number; count: number } | null {
  const [lo, hi] = forceBand(p, lambda);
  if (!(hi > lo)) return null;
  // Keep clear of the poles at the ends of the band.
  const margin = 1e-6 * (hi - lo);
  const lo2 = lo + margin, hi2 = hi - margin;
  const inside = (F: number) => F > lo2 && F < hi2;
  // Secant from the seed, moved into the band.
  let a = Math.min(Math.max(seed, lo2), hi2), b = inside(a * 1.05) ? a * 1.05 : a * 0.95;
  let fa = gfInBand(p, lambda, a), fb = gfInBand(p, lambda, b);
  for (let iter = 0; iter < 40 && Number.isFinite(fa) && Number.isFinite(fb); iter++) {
    if (fb === fa) break;
    const c = b - (fb * (b - a)) / (fb - fa);
    if (!inside(c)) break;
    a = b; fa = fb; b = c; fb = gfInBand(p, lambda, b);
    if (Math.abs(b - a) < F_TOL && Number.isFinite(fb)) {
      const m = march(p, lambda, b);
      if (Math.abs(m.gf) <= 1e-6 * m.fScale) return { F: b, count: 1 };
      break;
    }
  }
  // Bracketed scan: geometric F grid over the band.
  const roots: number[] = [];
  let prevF = lo2, prevG = gfInBand(p, lambda, prevF);
  const ratio = Math.pow(hi2 / lo2, 1 / (F_GRID - 1));
  for (let k = 1; k < F_GRID; k++) {
    const F = k === F_GRID - 1 ? hi2 : lo2 * Math.pow(ratio, k);
    const g = gfInBand(p, lambda, F);
    if (Number.isFinite(prevG) && Number.isFinite(g) && prevG * g <= 0) {
      const r = prevG === 0 ? prevF : brent((x) => gfInBand(p, lambda, x), prevF, F, prevG, g, F_TOL);
      if (Number.isFinite(r) && Number.isFinite(gfInBand(p, lambda, r))) roots.push(r);
    }
    prevF = F; prevG = g;
  }
  if (roots.length === 0) return null;
  // Normally one root; with several, the one nearest the seed.
  roots.sort((x, y) => Math.abs(Math.log(x / seed)) - Math.abs(Math.log(y / seed)));
  return { F: roots[0], count: roots.length };
}

export interface MpRoot {
  lambda: number;
  F: number;
  /** Slices with a negative base normal force. */
  negativeN: number;
  /** Largest interslice resultant over the total vertical load. */
  maxZOverLoad: number;
  minDenom: number;
}

export type RootRule = "nearest-zero" | "largest" | "smallest";

export interface MpMarchOptions {
  /** λ is scanned on [lambdaMin, lambdaMax] (defaults LAMBDA_MIN, LAMBDA_MAX). */
  lambdaMax?: number;
  lambdaMin?: number;
  /** Scan step in λ. */
  lambdaStep?: number;
  /** Which root to report when several exist. */
  rule?: RootRule;
  /** Skip the 2-D Newton fast path (scan only). */
  scanOnly?: boolean;
  /** Roots with a smaller slice denominator are rejected (MIN_DENOMINATOR). */
  minDenominator?: number;
}

export interface MpMarchResult {
  /** Roots of h(λ) found by the scan that clear the denominator limit, by λ. */
  roots: MpRoot[];
  /** Roots on a pole (denominator below the limit): not solutions. */
  rejected: MpRoot[];
  /** The 2-D Newton solution, or null when it failed. */
  newton: MpRoot | null;
  /** The reported root per `rule`, or null when there is none. */
  chosen: MpRoot | null;
  /** λ points where F_f(λ) had no solution in the band. */
  holes: number;
  /** λ points where the force residual had more than one root in the band. */
  multiFf: number;
  /** Marches performed. */
  evaluations: number;
}

/** Two-dimensional Newton on (F, λ) with scaled residuals and backtracking. */
function newton2d(p: SliceArrays, F0: number, lambda0: number): MpRoot | null {
  const m0 = march(p, lambda0, F0);
  if (!Number.isFinite(m0.gf) || !Number.isFinite(m0.gm)) return null;
  const sf = m0.fScale || 1, sm = m0.mScale || 1;
  const res = (F: number, l: number): [number, number] | null => {
    if (!(F > F_MIN && F < F_MAX)) return null;
    const m = march(p, l, F);
    if (!Number.isFinite(m.gf) || !Number.isFinite(m.gm)) return null;
    return [m.gf / sf, m.gm / sm];
  };
  let F = F0, l = lambda0;
  let r = res(F, l);
  if (!r) return null;
  for (let iter = 0; iter < 60; iter++) {
    const norm = Math.hypot(r[0], r[1]);
    if (norm < 1e-9) break;
    const dF = 1e-6 * Math.max(1, F), dl = 1e-6;
    const rF = res(F + dF, l), rl = res(F, l + dl);
    if (!rF || !rl) return null;
    const j00 = (rF[0] - r[0]) / dF, j01 = (rl[0] - r[0]) / dl;
    const j10 = (rF[1] - r[1]) / dF, j11 = (rl[1] - r[1]) / dl;
    const det = j00 * j11 - j01 * j10;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
    const stepF = (-r[0] * j11 + r[1] * j01) / det;
    const stepL = (-r[1] * j00 + r[0] * j10) / det;
    let t = 1;
    let next: [number, number] | null = null;
    for (let k = 0; k < 20; k++) {
      next = res(F + t * stepF, l + t * stepL);
      if (next && Math.hypot(next[0], next[1]) < norm) break;
      next = null;
      t /= 2;
    }
    if (!next) return null;
    F += t * stepF; l += t * stepL; r = next;
    if (Math.abs(t * stepF) < F_TOL && Math.abs(t * stepL) < 1e-9) break;
  }
  const m = march(p, l, F);
  if (Math.hypot(r[0], r[1]) > 1e-7 || m.outOfBand > 0) return null;
  return { lambda: l, F, negativeN: m.negativeN, maxZOverLoad: m.maxZOverLoad, minDenom: m.minDenom };
}

/** Solve M-P on prepared slice arrays. `F0` seeds F_f (e.g. the Ordinary F). */
export function solveMorgensternPriceMarch(p: SliceArrays, F0: number, options: MpMarchOptions = {}): MpMarchResult {
  const lambdaMax = options.lambdaMax ?? LAMBDA_MAX;
  const lambdaMin = options.lambdaMin ?? LAMBDA_MIN;
  const step = options.lambdaStep ?? 0.1;
  const rule = options.rule ?? "nearest-zero";
  const minDenom = options.minDenominator ?? MIN_DENOMINATOR;
  let evaluations = 0;
  const counted = <T>(v: T): T => { evaluations++; return v; };
  const ff = (l: number, seed: number) => counted(solveForceF(p, l, seed));

  let holes = 0, multiFf = 0;
  // h(λ) on the grid, from 0 outwards so each F_f is seeded by its neighbour.
  const grid: { l: number; F: number | null; h: number }[] = [];
  const side = (sign: 1 | -1) => {
    let seed = F0;
    const pts: { l: number; F: number | null; h: number }[] = [];
    for (let k = sign > 0 ? 0 : 1; ; k++) {
      let l = sign * k * step;
      if (sign > 0 && l > lambdaMax + 1e-12) break;
      if (sign < 0) {
        if (l < lambdaMin - 1e-12) {
          // One point at the limit itself, so a root just inside it is bracketed.
          if (pts.length && pts[pts.length - 1].l > lambdaMin + 1e-12) l = lambdaMin;
          else break;
        }
      }
      const r = ff(l, seed);
      if (!r) { holes++; pts.push({ l, F: null, h: NaN }); continue; }
      if (r.count > 1) multiFf++;
      seed = r.F;
      pts.push({ l, F: r.F, h: march(p, l, r.F).gm });
    }
    return pts;
  };
  grid.push(...side(-1).reverse(), ...side(1));

  const roots: MpRoot[] = [];
  const rejected: MpRoot[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = grid[i - 1], b = grid[i];
    if (a.F == null || b.F == null || !Number.isFinite(a.h) || !Number.isFinite(b.h)) continue;
    if (a.h * b.h > 0) continue;
    let seed = a.F;
    const h = (l: number) => {
      const r = ff(l, seed);
      if (!r) return NaN;
      seed = r.F;
      return march(p, l, r.F).gm;
    };
    const l = a.h === 0 ? a.l : brent(h, a.l, b.l, a.h, b.h, 1e-6);
    const r = ff(l, seed);
    if (!r) continue;
    const m = march(p, l, r.F);
    if (!Number.isFinite(m.gm)) continue;
    const root = { lambda: l, F: r.F, negativeN: m.negativeN, maxZOverLoad: m.maxZOverLoad, minDenom: m.minDenom };
    (m.minDenom >= minDenom ? roots : rejected).push(root);
  }

  let newton = options.scanOnly ? null : newton2d(p, F0, 0);
  if (newton && (newton.minDenom < minDenom || newton.lambda < lambdaMin || newton.lambda > lambdaMax)) newton = null;

  let chosen: MpRoot | null = null;
  if (roots.length > 0) {
    const key = rule === "nearest-zero"
      ? (r: MpRoot) => Math.abs(r.lambda)
      : rule === "largest" ? (r: MpRoot) => -r.F : (r: MpRoot) => r.F;
    chosen = roots.reduce((best, r) => (key(r) < key(best) ? r : best), roots[0]);
  }
  return { roots, rejected, newton, chosen, holes, multiFf, evaluations };
}

/**
 * Newton first, then a short scan of the λ between the lower limit and
 * Newton's root: Newton from (F₀, 0) can land on the farther of two roots
 * (V033, V094 in the verification set), and the reported root is the one
 * nearest λ = 0. The full scan runs only when Newton fails. The full scan
 * is the reference; `solveMorgensternPriceMarch` runs it always.
 */
export function solveMorgensternPriceFast(p: SliceArrays, F0: number, options: MpMarchOptions = {}): MpMarchResult {
  const minDenom = options.minDenominator ?? MIN_DENOMINATOR;
  const lambdaMin = options.lambdaMin ?? LAMBDA_MIN;
  const lambdaMax = options.lambdaMax ?? LAMBDA_MAX;
  const newton = options.scanOnly ? null : newton2d(p, F0, 0);
  if (newton && newton.minDenom >= minDenom && newton.lambda >= lambdaMin && newton.lambda <= lambdaMax) {
    // Any root nearer λ = 0 lies in [lambdaMin, |λ_N|] on either side.
    const near = Math.abs(newton.lambda);
    const r = solveMorgensternPriceMarch(p, F0, { ...options, scanOnly: true, lambdaMin: Math.max(lambdaMin, -near), lambdaMax: Math.min(lambdaMax, near) });
    const roots = [...r.roots.filter((x) => Math.abs(x.lambda - newton.lambda) > 1e-4), newton].sort((a, b) => a.lambda - b.lambda);
    const chosen = roots.reduce((best, x) => (Math.abs(x.lambda) < Math.abs(best.lambda) ? x : best), newton);
    return { roots, rejected: r.rejected, newton, chosen, holes: r.holes, multiFf: r.multiFf, evaluations: r.evaluations };
  }
  return solveMorgensternPriceMarch(p, F0, { ...options, scanOnly: true });
}

/** Options `analyseMorgensternPriceMarch` runs with; set by comparison scripts. */
let searchOptions: MpMarchOptions = {};
export function setMarchSearchOptions(options: MpMarchOptions): void {
  searchOptions = options;
}

/**
 * Drop-in counterpart of `analyseMorgensternPrice`: the same slices and
 * slope options, the march solver. The reported root follows `rule`.
 */
export function analyseMorgensternPriceMarch(
  slope: Slope,
  slices: Slice[],
  options: MpMarchOptions = searchOptions,
): [fos: number | null, lffArray: [number, number, number, number][] | null, pushing: number | null, resisting: number | null, converged: boolean] {
  const F0 = analyseOrdinary(slope, slices);
  if (F0 == null) return [null, null, null, null, true];
  const props = getSlicePropertyArrays(
    slices,
    slices[0].xLeft,
    slices[slices.length - 1].xRight,
    slope.intersliceFunction,
    slope.intersliceDataPoints,
  );
  const r = solveMorgensternPriceFast(props, F0, options);
  const lff: [number, number, number, number][] = r.roots.map((x) => [x.lambda, x.F, x.F, 0]);
  if (!r.chosen) return [null, lff, null, null, false];
  // Leave the undrained flags as the chosen root set them.
  const m = march(props, r.chosen.lambda, r.chosen.F);
  for (let i = 0; i < slices.length; i++) if (props.materialCodes[i] === 1) slices[i].undrainedGoverns = m.undrained[i] === 1;
  return [r.chosen.F, lff, null, null, true];
}
