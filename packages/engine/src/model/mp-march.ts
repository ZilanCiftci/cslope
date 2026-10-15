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
 * Morgenstern & Price's (1965) positivity rule in slice form, the form
 * xslope (Jones, 2026) uses. Selection among several roots is left to the
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

/** Same per-slice equations as the iterative solvers, evaluated once. */
export function march(p: SliceArrays, lambda: number, F: number): March {
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

const F_MIN = 0.05;
const F_MAX = 50;
const F_GRID = 60;
const F_TOL = 1e-7;

/** Residual of force equilibrium at F, or NaN outside the band. */
function gfInBand(p: SliceArrays, lambda: number, F: number): number {
  const m = march(p, lambda, F);
  return m.outOfBand > 0 || !Number.isFinite(m.gf) ? NaN : m.gf;
}

/**
 * F_f(λ): the F closing force equilibrium at λ, inside the pole-free band.
 * Secant from the seed first; a bracketed scan of F when that fails.
 * Returns null when no such F exists (a hole in h(λ)). `count` is how
 * many roots the scan found in the band (normally one).
 */
export function solveForceF(p: SliceArrays, lambda: number, seed: number): { F: number; count: number } | null {
  // Secant from the seed.
  let a = Math.max(seed, F_MIN), b = a * 1.05;
  let fa = gfInBand(p, lambda, a), fb = gfInBand(p, lambda, b);
  for (let iter = 0; iter < 40 && Number.isFinite(fa) && Number.isFinite(fb); iter++) {
    if (fb === fa) break;
    const c = b - (fb * (b - a)) / (fb - fa);
    if (!(c > F_MIN && c < F_MAX)) break;
    a = b; fa = fb; b = c; fb = gfInBand(p, lambda, b);
    if (Math.abs(b - a) < F_TOL && Number.isFinite(fb)) {
      const m = march(p, lambda, b);
      if (Math.abs(m.gf) <= 1e-6 * m.fScale) return { F: b, count: 1 };
      break;
    }
  }
  // Bracketed scan: geometric F grid, brackets with both ends in the band.
  const roots: number[] = [];
  let prevF = F_MIN, prevG = gfInBand(p, lambda, prevF);
  const ratio = Math.pow(F_MAX / F_MIN, 1 / (F_GRID - 1));
  for (let k = 1; k < F_GRID; k++) {
    const F = F_MIN * Math.pow(ratio, k);
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
  /** λ is scanned on [lambdaMin, lambdaMax]; lambdaMin defaults to −lambdaMax. */
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
  const lambdaMax = options.lambdaMax ?? 2.5;
  const lambdaMin = options.lambdaMin ?? -lambdaMax;
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
    for (let k = sign > 0 ? 0 : 1; k * step <= lambdaMax + 1e-12; k++) {
      const l = sign * k * step;
      if (l < lambdaMin - 1e-12) break;
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
  if (newton && (newton.minDenom < minDenom || newton.lambda < lambdaMin)) newton = null;

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
 * Newton first, the λ scan only when Newton fails: the fast path for a
 * search. The scan is the reference; `solveMorgensternPriceMarch` runs it
 * always, for comparisons.
 */
export function solveMorgensternPriceFast(p: SliceArrays, F0: number, options: MpMarchOptions = {}): MpMarchResult {
  const minDenom = options.minDenominator ?? MIN_DENOMINATOR;
  const lambdaMin = options.lambdaMin ?? -(options.lambdaMax ?? 2.5);
  const newton = options.scanOnly ? null : newton2d(p, F0, 0);
  if (newton && newton.minDenom >= minDenom && newton.lambda >= lambdaMin) {
    return { roots: [newton], rejected: [], newton, chosen: newton, holes: 0, multiFf: 0, evaluations: 0 };
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
