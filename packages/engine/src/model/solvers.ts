/**
 * Factor of Safety (FOS) solvers for slope stability analysis.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { Slice } from "../types/geometry";
import type { SearchPlane, Slope } from "./slope";
import { type AsyncEvaluate, type PlaneSteps, runStepsAsync } from "./steps";
import { wasm } from "../facade/internal";
import { type PlanesWire, encodeSlices } from "../facade/slice-codec";
import { engineSteps, facadeSlope, h, onSlices, writeBackPlanes } from "../facade/wire";

type MethodResult = [fos: number | null, pushing: number | null, resisting: number | null, converged: boolean];
type MpResult = [
  fos: number | null,
  lffArray: [number, number, number, number][] | null,
  pushing: number | null,
  resisting: number | null,
  converged: boolean,
  equilibriumGap?: number,
  closestPair?: boolean,
];

export function setMorgensternPriceSolver(solver: "iterative" | "march"): void {
  wasm().set_morgenstern_price_solver(solver);
}

/** The Morgenstern-Price solver set (a parallel evaluator must use the same). */
export function getMorgensternPriceSolver(): "iterative" | "march" {
  return wasm().get_morgenstern_price_solver() as "iterative" | "march";
}

/**
 * Base normal force and right-hand interslice forces of one slice from
 * vertical equilibrium with the shear mobilised at the trial FOS.
 *
 * @param effC  effective cohesion force C' = c·l − U·l·tanφ (kN/m)
 * @param tanPhi tan of the friction angle governing the slice
 * @returns [N, E_right, X_right]
 */
export function solveSliceNormal(
  W: number,
  xLeft: number,
  eLeft: number,
  effC: number,
  tanPhi: number,
  cosA: number,
  sinA: number,
  shearFactor: number,
  fos: number,
): [number, number, number] {
  const r = wasm().solve_slice_normal(W, xLeft, eLeft, effC, tanPhi, cosA, sinA, shearFactor, fos);
  return [r[0], r[1], r[2]];
}

/**
 * Ordinary (Swedish) method of slices.
 */
export function analyseOrdinary(slope: Slope, slices: Slice[]): number | null {
  return (wasm().analyse_ordinary(h(slope), facadeSlope(slope)._slicesOut(slices)) as number | undefined) ?? null;
}

/**
 * Bishop's Simplified Method.
 */
export function analyseBishop(slope: Slope, slices: Slice[], FS?: number | null): MethodResult {
  return onSlices(slope, slices, (w) => wasm().analyse_bishop(h(slope), w, FS ?? undefined));
}

/**
 * Janbu correction factor f₀ (Janbu, 1973).
 *
 * The Simplified Method underestimates FOS because it neglects interslice
 * shear forces. The empirical correction compensates for this:
 *
 *   F_corrected = f₀ × F_simplified
 *   f₀ = 1 + b₁ × [d/L − 1.4 × (d/L)²]
 *
 * where L = length of the chord connecting the entry and exit points of
 * the failure surface and d = the greatest depth of the surface measured
 * perpendicular to that chord, and b₁ depends on soil type:
 *   c-only soil (φ=0): b₁ = 0.69
 *   φ-only soil (c=0): b₁ = 0.31
 *   c-φ soil:          b₁ = 0.50
 */
export function janbuCorrectionFactor(slices: Slice[]): number {
  return wasm().janbu_correction_factor(encodeSlices(slices as never, () => null));
}

/**
 * Janbu's Simplified Method with correction factor f₀ (Janbu, 1973).
 *
 * Satisfies horizontal force equilibrium with λ = 0 (no interslice shear).
 * The empirical correction factor f₀ compensates for the systematic
 * underestimation inherent in the simplified assumption.
 */
export function analyseJanbu(slope: Slope, slices: Slice[], FS?: number | null): MethodResult {
  return onSlices(slope, slices, (w) => wasm().analyse_janbu(h(slope), w, FS ?? undefined));
}

/**
 * Effective base normal force N′ = N − u·l (kN) of each slice of a solved
 * surface, as the method's own equilibrium gives it at its factor of
 * safety: Bishop at λ = 0 (moment equation), Janbu at λ = 0 (force
 * equation, with the uncorrected factor), Morgenstern–Price at the accepted
 * λ (the point of `lffArray` with the smallest gap). Null when the slices
 * cannot be solved at that factor. N′ can be negative (tension at the base
 * in cohesive soil without a tension crack).
 */
export function solvedEffectiveNormals(
  slope: Slope,
  slices: Slice[],
  fos: number,
  lffArray?: readonly (readonly [number, number, number, number])[] | null,
): number[] | null {
  return onSlices(slope, slices, (w) => wasm().solved_effective_normals(h(slope), w, fos, lffArray ?? null));
}

/**
 * Morgenstern-Price Method.
 */
export function analyseMorgensternPrice(slope: Slope, slices: Slice[]): MpResult {
  return onSlices(slope, slices, (w) => wasm().analyse_morgenstern_price(h(slope), w));
}

/**
 * Run the full slope stability analysis.
 *
 * 1. Generate search planes if none exist.
 * 2. For each plane: generate slices → compute FOS.
 * 3. Sort results by FOS and store on the Slope model.
 *
 * @returns Minimum FOS found, or null if no valid surfaces.
 */
export function analyseSlope(slope: Slope): number | null {
  return (wasm().analyse_slope(h(slope)) as number | undefined) ?? null;
}

/**
 * analyseSlope with the surfaces evaluated by `evaluate`, e.g. a pool of
 * workers (src/parallel). The search is the same (analyseSlopeSteps), so
 * the result is that of analyseSlope as long as `evaluate` sets each
 * plane as evaluatePlanes does. An evaluator may leave out the slices of
 * the planes: those of the critical surface are restored here.
 */
export async function analyseSlopeAsync(slope: Slope, evaluate: AsyncEvaluate): Promise<number | null> {
  const fos = await runStepsAsync(analyseSlopeSteps(slope), evaluate);
  restoreCriticalSlices(slope);
  return fos;
}

/**
 * The slices of the critical surface, when an evaluator left them out:
 * evaluated again on a copy (the same surface gives the same slices).
 */
export function restoreCriticalSlices(slope: Slope): void {
  wasm().restore_critical_slices(h(slope));
}

/**
 * The search of analyseSlope as steps (model/steps.ts): each batch of
 * surfaces it yields is independent and evaluated in place before it
 * resumes. Sets the sorted results on the slope; returns the minimum FOS.
 */
export function analyseSlopeSteps(slope: Slope): PlaneSteps<number | null> {
  // (the planes are generated when the generator starts, as in TypeScript)
  function* run(): PlaneSteps<number | null> {
    return yield* engineSteps(slope, wasm().analyse_steps_new(h(slope)) as number, (r) => r.fos ?? null);
  }
  return run();
}

/**
 * Evaluates the planes in place: slices, FOS by the slope's method,
 * convergence, crack and composite floor (null FOS when invalid). Each
 * plane is evaluated on its own, so a batch may be split in any way.
 */
export function evaluatePlanes(slope: Slope, allPlanes: SearchPlane[]): void {
  const s = facadeSlope(slope);
  writeBackPlanes(s, allPlanes, wasm().evaluate_planes(s._h, s._planesOut(allPlanes)) as PlanesWire);
}

/** Vertical load on a slice: soil weight, surface loads and free water. */
export function sliceVerticalLoad(s: Pick<Slice, "weight" | "udl" | "ll" | "waterLoad">): number {
  return wasm().slice_vertical_load({ ...s, baseMaterial: null });
}

/**
 * Driving moment of a slice about the circle centre (kN·m). On a
 * non-circular surface the base normal force has a moment too; it is
 * estimated here with N ≈ W·cos α (the solvers use the solved N).
 */
export function sliceDrivingMoment(
  s: Pick<Slice, "weight" | "udl" | "ll" | "waterLoad" | "dx" | "extraMoment" | "alpha" | "normalArm">,
): number {
  return wasm().slice_driving_moment({ ...s, baseMaterial: null });
}
