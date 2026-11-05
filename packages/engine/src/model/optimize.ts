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
 * again. The best surface of all seeds is then optimised further while a
 * cycle still lowers its FOS by more than the analysis tolerance: refined
 * once more, then restarted from its result with the first shift (Greco
 * 1996 repeats the search from the last surface until it no longer
 * improves). Surfaces stay admissible: below the ground, inside the model,
 * concave, and with entry and exit within the search limits. A candidate
 * without a complete-equilibrium solution gets no factor of safety.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { SearchPlane, Slope } from "./slope";
import type { Evaluate, PlaneSteps } from "./steps";
import { wasm } from "../facade/internal";
import { bridge, engineSteps, facadeSlope } from "../facade/wire";
import type { PlanesWire } from "../facade/slice-codec";
import type { Pt } from "./surface";

export interface OptimiseOptions {
  /**
   * Maximum surface evaluations per seed; the further optimisation of the
   * best surface gets twice this.
   */
  budgetPerSeed?: number;
}


/**
 * Optimised non-circular surfaces grown from the best circles among
 * `evaluated` and from block surfaces through the buried layers. Returns
 * the final surface of each seed (evaluated).
 */
export function optimiseNonCircular(slope: Slope, evaluated: readonly SearchPlane[], evaluate: Evaluate, options: OptimiseOptions = {}): SearchPlane[] {
  const s = facadeSlope(slope);
  const seeds = s._planesOut(evaluated);
  return s._planes(wasm().optimise_non_circular_with(s._h, seeds, bridge(s, evaluate), options) as PlanesWire);
}

/**
 * optimiseNonCircular as steps (model/steps.ts). The seeds are optimised
 * independently of each other, so their searches run in lockstep and each
 * step evaluates their candidates as one batch.
 */
export function optimiseNonCircularSteps(slope: Slope, evaluated: readonly SearchPlane[], options: OptimiseOptions = {}): PlaneSteps<SearchPlane[]> {
  const s = facadeSlope(slope);
  function* run(): PlaneSteps<SearchPlane[]> {
    const steps = wasm().optimise_non_circular_steps_new(s._h, s._planesOut(evaluated), options) as number;
    return yield* engineSteps(s, steps, (r) => s._planes(r.planes!));
  }
  return run();
}

/**
 * Optimised non-circular surfaces grown from evaluated polylines (the best
 * block surfaces), each by the alternating-variable search as above. The
 * optimised surfaces are free to leave the block search objects. Returns
 * the final surface of each seed (evaluated).
 */
export function optimisePolylines(slope: Slope, seeds: readonly SearchPlane[], evaluate: Evaluate, options: OptimiseOptions = {}): SearchPlane[] {
  const s = facadeSlope(slope);
  const wire = s._planesOut(seeds);
  return s._planes(wasm().optimise_polylines_with(s._h, wire, bridge(s, evaluate), options) as PlanesWire);
}

/** optimisePolylines as steps, the seeds in lockstep (see optimiseNonCircularSteps). */
export function optimisePolylinesSteps(slope: Slope, seeds: readonly SearchPlane[], options: OptimiseOptions = {}): PlaneSteps<SearchPlane[]> {
  const s = facadeSlope(slope);
  function* run(): PlaneSteps<SearchPlane[]> {
    const steps = wasm().optimise_polylines_steps_new(s._h, s._planesOut(seeds), options) as number;
    return yield* engineSteps(s, steps, (r) => s._planes(r.planes!));
  }
  return run();
}

/** First point where the ray from (x0, y0) in direction (dx, dy) meets the ground. */
export function rayToGround(ground: { x: readonly number[]; y: readonly number[] }, x0: number, y0: number, dx: number, dy: number): Pt | null {
  return (wasm().ray_to_ground(ground, x0, y0, dx, dy) as Pt | null | undefined) ?? null;
}
