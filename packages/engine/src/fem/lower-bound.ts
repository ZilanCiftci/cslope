/**
 * Lower bound limit analysis by finite elements and conic programming (Sloan
 * 1988, IJNAMG 12, 61–77; Lyamin & Sloan 2002, IJNME 55, 573–611;
 * Makrodimopoulos & Martin 2006, IJNME 66(4), 604–634).
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/lower_bound.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import { wasm } from "../facade/internal";
import type { Slope } from "../model/slope";
import { dataOptions,sizeFieldHandle,slopeRef } from "../facade/fem/_handles";
import type { FeModelOptions } from "./model";
import type { ConicProgram } from "./conic";

export interface LowerBoundOptions extends FeModelOptions {
  /** The solver: "clarabel" (the only one), the yield criterion exactly as a second-order cone. */
  boundSolver?: "clarabel";
  /**
   * The reduced strength: c/F and tan φ/F ("associated", default), or
   * Davis B's for the elements' dilation angles ("davis-b",
   * limit-common.ts), the associated material that stands for
   * non-associated flow.
   */
  strengthRule?: "associated" | "davis-b";
  /** Rankine tension cut-off σ₁′ ≤ 0; default false. */
  tensionCutoff?: boolean;
  /** Tolerance on F; default 0.002. */
  fTolerance?: number;
  /** Time limit per linear program (s); default 300. */
  timeLimit?: number;
  /** Time limit of the whole search (s): no linear program starts after it, and the bound stays the best certified so far; default none. */
  totalTimeLimit?: number;
  /** First reduction tried, e.g. a coarser mesh's bound; default 1. */
  startF?: number;
}

export interface LowerBoundResult {
  /** Lower bound on the factor of safety. */
  factorOfSafety: number;
  /** The load factors λ(F) of the linear programs solved. */
  trials: { F: number; lambda: number; seconds: number }[];
  elements: number;
  /** Size of the linear program: variables and constraints. */
  variables: number;
  constraints: number;
  warnings: string[];
}

export interface LbProblem {
  /** The program at a reduction F (conic.ts): maximise λ. */
  program(F: number): ConicProgram;
  allUndrained: boolean;
  elements: number;
  variables: number;
  constraints: number;
  warnings: string[];
  /**
   * The lower bound mesh: corner coordinates and three nodes per element,
   * and the strength reduction model's element each lies in (`parent`; the
   * model's corner nodes keep their numbers). The stresses of element e at
   * its corner k are the program's columns 9e + 3k + 0, 1, 2: σ′x, σ′y, τxy.
   * `split`: the edges bisected for the fans ("a,b" with a < b) and the
   * node at their middle.
   */
  mesh: { x: Float64Array; y: Float64Array; el: Int32Array; parent: Int32Array; split: Map<string, number> };
}

/** The engine's solve of a bound's program (Clarabel, whatever `boundSolver` says): a token for boundGapIndicator. */
const ENGINE_SOLVE = Object.freeze(() => {
  throw new Error("The bounds' programs are solved inside the engine: this solver is only a token for boundGapIndicator.");
});

/** A solve function for the bounds' programs (a token: the engine solves them, by Clarabel). */
export async function boundSolver(options: { boundSolver?: "clarabel" } = {}): Promise<(prog: never, sides: number, timeLimit: number) => never> {
  void options;
  return ENGINE_SOLVE;
}


/** Lower bound on the factor of safety of a slope. */
export async function lowerBound(slope: Slope, options: LowerBoundOptions = {}): Promise<LowerBoundResult> {
  return wasm().lower_bound(slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField));
}
