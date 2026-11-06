/**
 * Newton–Raphson solution at one strength reduction factor, with implicit
 * stress return and the consistent tangent: associated flow (Davis B or
 * associated) and, as an option, non-associated flow (srm.ts).
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/newton.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */

export interface ReturnResult {
  /** Stress after return (σx, σy, τxy, σz). */
  stress: [number, number, number, number];
  /** Consistent tangent (4 × 4, Voigt with engineering shear), row-major. */
  tangent: Float64Array;
  plastic: boolean;
}

export interface NewtonState {
  /** Displacements per equation. */
  u: Float64Array;
  /** Plastic strain per Gauss point (εx, εy, γxy, εz). */
  ep: Float64Array;
  /** Stress per Gauss point (σx, σy, τxy, σz). */
  stress: Float64Array;
  /** Plastic axial strain of the reinforcement bars (2 per bar). */
  barEp: Float64Array;
  /** Reduction factor (the bars' passive capacity is divided by it). */
  F: number;
}

export interface NewtonOptions {
  /** Relative residual tolerance ‖r‖/‖f‖; default 1e-6. */
  tolerance?: number;
  /** Newton iterations per trial; default 200. */
  maxIterations?: number;
  tensionCutoff?: boolean;
}

/** Strength per Gauss point after reduction (see srm.ts). */
export interface GaussStrength {
  c: Float64Array;
  sinPhi: Float64Array;
  cosPhi: Float64Array;
  /** Undrained cap (Tresca) of a combined material; Infinity where there is none. */
  cu: Float64Array;
  /** sin ψ of the plastic potential (non-associated flow); absent: associated (ψ = φ). */
  sinPsi?: Float64Array;
}
