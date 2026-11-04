/**
 * Upper bound limit analysis by finite elements and conic programming
 * (Sloan & Kleeman 1995, Comput. Methods Appl. Mech. Eng. 127, 293–314;
 * Lyamin & Sloan 2002, IJNAMG 26, 181–216; Makrodimopoulos & Martin 2007,
 * IJNAMG 31(6), 835–865).
 *
 * The velocities vary linearly over three-node triangles whose nodes are not
 * shared, so that every edge can carry a velocity discontinuity. In each
 * element the constant plastic strain rate follows the associated flow rule
 * of the Mohr–Coulomb criterion, in plane strain ε̇x + ε̇y = sin φ z with
 * z ≥ ‖(ε̇x − ε̇y, γ̇xy)‖ (a second-order cone), and dissipates c cos φ z per
 * unit area. Solved exactly by Clarabel, see conic.ts. Along a discontinuity the tangential jump is
 * Δu_t = u⁺ − u⁻ and the normal jump Δu_n = (u⁺ + u⁻) tan φ (u⁺, u⁻ ≥ 0, at
 * both ends of the edge), dissipating c (u⁺ + u⁻) per unit length. The
 * circumscribed polygon is stronger than the soil, so the power the loads
 * do on any such velocity field over the dissipation bounds the load factor
 * from above for the mesh.
 *
 * Pore pressures: the power of the total stresses is that of the effective
 * stresses less ∫ p ε̇_v dV and ∫ p Δu_n dS on the discontinuities, so the
 * pore pressure does that power as a load (Kim, Salgado & Yu 1999, J.
 * Geotech. Geoenviron. Eng. 125(9), 811–820), besides the weight at the
 * saturated unit weight and the water ponded on the ground.
 *
 * The linear program minimises the dissipation with the power of all loads
 * (weight, pore pressure, surface loads) equal to one: the minimum is an
 * upper bound λ on the load factor. The factor of safety on strength is
 * the reduction F at which λ(F) = 1 (as for the lower bound, lower-bound.ts):
 * F = λ(1) when φ = 0 everywhere, otherwise a secant search on log λ
 * against log F from `startF`, and
 * the smallest evaluated F with λ(F) ≤ 1 is the bound (a mechanism fails
 * the slope there).
 *
 * Supports as in the strength reduction model (model.ts): the vertical
 * sides are smooth rollers (no normal velocity), the base is rigid, and
 * the soil may slip along it through a discontinuity of the soil's
 * strength.
 *
 * Implementation choices (not from the literature): the velocities scaled so that the load power's
 * largest coefficient is one; the
 * strength of an element at its centroid; a discontinuity between two
 * materials takes the lesser cohesion and friction angle of the two (a
 * slip band in the weaker soil); rigid materials do not deform, and no
 * discontinuity runs between two rigid elements; a combined material (the
 * lesser of the drained and undrained strength) flows on both polygons and
 * its discontinuities on both criteria; with the tension cut-off σ₁′ ≤ 0
 * the elements flow on its circumscribed polygon too and the
 * discontinuities may open without dissipation; the secant search as the
 * lower bound's, mirrored.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and fem/_handles.ts).
 */
import { testCall, wasm } from "../facade/internal";
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

/** The upper bound problem's mesh and size; its program is built and solved inside the engine (`program` and `elementDissipation` throw). */
export function upperBoundProblem(slope: Slope, options: UpperBoundOptions = {}): UbProblem {
  const p = testCall<Omit<UbProblem, "program" | "elementDissipation">>("fem/upper-bound::upperBoundProblem", [
    slopeRef(slope),
    dataOptions(options),
    sizeFieldHandle(options.sizeField),
  ]);
  const inside = (what: string) => () => {
    throw new Error(`The upper bound program is built and solved inside the engine (fem/upper-bound::upperBoundProblem.${what}).`);
  };
  return { program: inside("program"), elementDissipation: inside("elementDissipation"), ...p };
}

/** Upper bound on the factor of safety of a slope. */
export async function upperBound(slope: Slope, options: UpperBoundOptions = {}): Promise<UpperBoundResult> {
  return wasm().upper_bound(slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField));
}
