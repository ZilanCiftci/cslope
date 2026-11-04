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
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts). The slice
 * arrays (getSlicePropertyArrays) stay in the engine: they cross as an
 * opaque reference.
 */
import type { Slice } from "../types/geometry";
import type { Slope } from "./slope";
import { testCall } from "../facade/internal";
import { h, onSlices } from "../facade/wire";

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

type SliceArrays = unknown;

/** Marches performed since the engine started (read from the engine). */
export const marchCounter = {
  get count(): number {
    return testCall<number>("model/mp-march::marchCount", []);
  },
};

/** Same per-slice equations as the iterative solvers, evaluated once. */
export function march(p: SliceArrays, lambda: number, F: number): March {
  const m = testCall<Omit<March, "N" | "E" | "X" | "undrained"> & { N: number[]; E: number[]; X: number[]; undrained: number[] }>("model/mp-march::march", [p, lambda, F]);
  return { ...m, N: Float64Array.from(m.N), E: Float64Array.from(m.E), X: Float64Array.from(m.X), undrained: Uint8Array.from(m.undrained) };
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
  return testCall("model/mp-march::forceBand", [p, lambda]);
}

/**
 * F_f(λ): the F closing force equilibrium at λ, inside the pole-free band.
 * Secant from the seed first; a bracketed scan of F when that fails.
 * Returns null when no such F exists (a hole in h(λ)). `count` is how
 * many roots the scan found in the band (normally one).
 */
export function solveForceF(p: SliceArrays, lambda: number, seed: number): { F: number; count: number } | null {
  return testCall<{ F: number; count: number } | null>("model/mp-march::solveForceF", [p, lambda, seed]) ?? null;
}

/** Solve M-P on prepared slice arrays. `F0` seeds F_f (e.g. the Ordinary F). */
export function solveMorgensternPriceMarch(p: SliceArrays, F0: number, options: MpMarchOptions = {}): MpMarchResult {
  return testCall("model/mp-march::solveMorgensternPriceMarch", [p, F0, options]);
}

/**
 * Newton first, then a short scan of the λ between the lower limit and
 * Newton's root: Newton from (F₀, 0) can land on the farther of two roots
 * (V033, V094 in the verification set), and the reported root is the one
 * nearest λ = 0. The full scan runs only when Newton fails. The full scan
 * is the reference; `solveMorgensternPriceMarch` runs it always.
 */
export function solveMorgensternPriceFast(p: SliceArrays, F0: number, options: MpMarchOptions = {}): MpMarchResult {
  return testCall("model/mp-march::solveMorgensternPriceFast", [p, F0, options]);
}

export function setMarchSearchOptions(options: MpMarchOptions): void {
  testCall("model/mp-march::setMarchSearchOptions", [options]);
}

/**
 * Drop-in counterpart of `analyseMorgensternPrice`: the same slices and
 * slope options, the march solver. The reported root follows `rule`.
 */
export function analyseMorgensternPriceMarch(
  slope: Slope,
  slices: Slice[],
  options?: MpMarchOptions,
): [fos: number | null, lffArray: [number, number, number, number][] | null, pushing: number | null, resisting: number | null, converged: boolean] {
  return onSlices(slope, slices, (w) => testCall("model/mp-march::analyseMorgensternPriceMarch", [{ $slope: h(slope) }, w, options]));
}
