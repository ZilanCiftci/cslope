/**
 * Mesh refinement on the gap between the lower and the upper bound of limit
 * analysis.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/bound_adapt.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import { testCall, wasm } from "../facade/internal";
import type { LowerBoundOptions } from "./lower-bound";
import type { UpperBoundOptions } from "./upper-bound";
import type { Slope } from "../model/slope";
import { dataOptions, sizeFieldHandle, sizeFieldOf, slopeRef } from "../facade/fem/_handles";

export interface BoundGap {
  /** Contribution of each element of the model's mesh to λ_U − λ_L. */
  eta: Float64Array;
  /** λ of the two programs at F. */
  lambdaLower: number;
  lambdaUpper: number;
  /** Whether the stress field entered (otherwise eta is the dissipation alone). */
  withStress: boolean;
}

export interface AdaptiveBoundsOptions extends LowerBoundOptions, UpperBoundOptions {
  /** Refinements at most; default 3. */
  levels?: number;
  /** Dörfler fraction of the gap marked per refinement; default 0.6. */
  theta?: number;
  /**
   * Time budget of the whole analysis, every level (s): each search and
   * linear program gets at most what is left of it, and a refinement is
   * not started when four times the last level's time is not left (the
   * gap's two programs and the searches on a larger mesh); default none.
   */
  refinementTimeLimit?: number;
  /** Stop when (upper − lower) / mean is below this; default 0.03. */
  gapTolerance?: number;
  /** Called after each level's bounds. */
  onLevel?: (level: AdaptiveBoundsLevel) => void;
}

export interface AdaptiveBoundsLevel {
  elements: number;
  lower: number;
  upper: number;
  seconds: number;
}

export interface AdaptiveBoundsResult {
  lower: number;
  upper: number;
  levels: AdaptiveBoundsLevel[];
  /** The size field of the last mesh. */
  sizeField: ((x: number, y: number) => number) & { min?: number };
  warnings: string[];
}

/** The bound gap per element at F; the programs are solved by the engine's Clarabel (TypeScript's `solve` argument, from boundSolver, is not needed). */
export function boundGapIndicator(slope: Slope, options: LowerBoundOptions & UpperBoundOptions, F: number, solve?: unknown): BoundGap | null {
  void solve;
  return testCall("fem/bound-adapt::boundGapIndicator", [slopeRef(slope), dataOptions(options), F, sizeFieldHandle(options.sizeField)]);
}

/** The bounds on meshes refined where their gap lies (`options.onLevel` is called after each level). */
export async function adaptiveBounds(slope: Slope, options: AdaptiveBoundsOptions = {}): Promise<AdaptiveBoundsResult> {
  const r = wasm().adaptive_bounds(slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField), options.onLevel) as Omit<AdaptiveBoundsResult, "sizeField"> & {
    sizeField: number;
  };
  return { ...r, sizeField: sizeFieldOf(r.sizeField) };
}
