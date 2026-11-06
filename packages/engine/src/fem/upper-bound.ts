/**
 * Upper bound limit analysis by finite elements and conic programming
 * (Sloan & Kleeman 1995, Comput. Methods Appl. Mech. Eng. 127, 293–314;
 * Lyamin & Sloan 2002, IJNAMG 26, 181–216; Makrodimopoulos & Martin 2007,
 * IJNAMG 31(6), 835–865).
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/upper_bound.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import { wasm } from "../facade/internal";
import type { Slope } from "../model/slope";
import { dataOptions, sizeFieldHandle, slopeRef } from "../facade/fem/_handles";
import type { FeModelOptions } from "./model";
import type { ConicProgram } from "./conic";

export interface UpperBoundOptions extends FeModelOptions {
  /** The solver, as the lower bound's (lower-bound.ts): "clarabel". */
  boundSolver?: "clarabel";
  /** The reduced strength, as the lower bound's (lower-bound.ts): "associated" (default) or "davis-b". */
  strengthRule?: "associated" | "davis-b";
  /** Rankine tension cut-off σ₁′ ≤ 0; default false. */
  tensionCutoff?: boolean;
  /** Tolerance on F; default 0.002. */
  fTolerance?: number;
  /** Time limit per linear program (s); default 300. */
  timeLimit?: number;
  /** Time limit of the whole search (s): no linear program starts after it, and the bound stays the best certified so far; default none. */
  totalTimeLimit?: number;
  /** First reduction tried, e.g. the strength reduction factor; default 1. */
  startF?: number;
}

export interface UpperBoundResult {
  /** Upper bound on the factor of safety. */
  factorOfSafety: number;
  /** The load factors λ(F) of the linear programs solved. */
  trials: { F: number; lambda: number; seconds: number }[];
  elements: number;
  variables: number;
  constraints: number;
  warnings: string[];
  /** The mesh and, at the bound, the velocity of each element corner (x, y), scaled to a largest speed of 1: the mechanism. */
  mechanism?: { x: Float64Array; y: Float64Array; el: Int32Array; velocity: Float64Array };
}

export interface UbProblem {
  /** The program at a reduction F (conic.ts): minimise the dissipation at unit load power; velocities of corner i in columns 2i, 2i + 1. */
  program(F: number): ConicProgram;
  /**
   * The dissipation of a solution at F per element (the model's), with
   * each discontinuity's shared equally by the elements on its sides (all
   * of it by the element on the base).
   */
  elementDissipation(F: number, solution: Float64Array): Float64Array;
  allUndrained: boolean;
  /** Whether any soil has cohesion. */
  cohesive: boolean;
  elements: number;
  variables: number;
  constraints: number;
  warnings: string[];
  mesh: { x: Float64Array; y: Float64Array; el: Int32Array };
}

/** Upper bound on the factor of safety of a slope. */
export async function upperBound(slope: Slope, options: UpperBoundOptions = {}): Promise<UpperBoundResult> {
  return wasm().upper_bound(slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField));
}
