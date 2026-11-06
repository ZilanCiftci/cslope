/**
 * Equilibrium at one strength reduction factor by the constant stiffness
 * method with implicit stress return, accelerated by BFGS updates.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/bfgs.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */

export interface BfgsOptions {
  /** Relative residual tolerance ‖r‖/‖f‖; default 1e-4. */
  tolerance?: number;
  /** Iterations per trial; default 2000. */
  maxIterations?: number;
  tensionCutoff?: boolean;
}
