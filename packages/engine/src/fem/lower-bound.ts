/**
 * Lower bound limit analysis by finite elements and conic programming
 * (Sloan 1988, IJNAMG 12, 61–77; Lyamin & Sloan 2002, IJNME 55, 573–611;
 * Makrodimopoulos & Martin 2006, IJNME 66(4), 604–634).
 *
 * The stresses vary linearly over three-node triangles whose nodes are not
 * shared, so that every interior edge can carry a statically admissible
 * stress discontinuity (continuous normal and shear traction). Each
 * element is in equilibrium with its weight and the pore pressure
 * gradient, the ground surface carries its loads, and every node meets the
 * Mohr–Coulomb criterion, in plane strain the second-order cone
 * 2c cos φ − sin φ (σ′x + σ′y) ≥ ‖(σ′x − σ′y, 2τxy)‖, so that the stress
 * field is admissible and the load factor a strict lower bound for the
 * mesh. Stresses are effective, tension positive; σ = σ′ − u m. The cones
 * are solved exactly by Clarabel (conic.ts), each program of the
 * verification meshes (2100–2800 elements) in a few seconds.
 *
 * The program maximises a load factor λ on every load (weight, pore
 * pressure and surface loads). The factor of safety on strength is the
 * reduction F at which λ(F) = 1: for φ = 0 everywhere λ(F) = λ(F0)·F0/F, so
 * F = λ(F0)·F0 from one program at the first reduction tried F0 (1 by
 * default); otherwise F is found by the secant method on
 * log λ (Kim, Salgado & Lee 2002, J. Geotech. Geoenviron. Eng. 128(7),
 * 546–557, fig. 3: iterate until the reference load is carried).
 *
 * Implementation choices (not from the literature): the
 * secant method on log λ with trials tol/2 below its root, safeguarded by
 * bisection of the bracket between the largest F that carries the loads
 * and the smallest that does not, returning the largest evaluated F with
 * λ(F) ≥ 1 once it lies within 0.002 of the root or of the bracket's other
 * end (only such an F is a lower bound); fans of elements spanning at
 * most 30° within an element size of each corner and load's end of the
 * ground surface (lowerBoundProblem); the load factor on every load, weight
 * included, as the strength reduction applies; a line load spread over the
 * two surface edges at its point; the stresses scaled by γ H (the largest
 * unit weight times the model's height) for Clarabel.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and
 * fem/_handles.ts).

 */
import { testCall,wasm } from "../facade/internal";
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
  return ENGINE_SOLVE as never;
}

type ProblemData = Omit<LbProblem, "program" | "mesh"> & { mesh: Omit<LbProblem["mesh"], "split"> & { split: [string, number][] } };

/** The lower bound problem's mesh and size; its program is built and solved inside the engine (`program` throws). */
export function lowerBoundProblem(slope: Slope, options: LowerBoundOptions = {}): LbProblem {
  const p = testCall<ProblemData>("fem/lower-bound::lowerBoundProblem", [slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField)]);
  return {
    program() {
      throw new Error("The lower bound program is built and solved inside the engine (fem/lower-bound::lowerBoundProblem.program).");
    },
    ...p,
    mesh: { ...p.mesh, split: new Map(p.mesh.split) },
  };
}

/** Lower bound on the factor of safety of a slope. */
export async function lowerBound(slope: Slope, options: LowerBoundOptions = {}): Promise<LowerBoundResult> {
  return wasm().lower_bound(slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField));
}
