/**
 * The programs of the limit analysis bounds (lower-bound.ts, upper-bound.ts)
 * as second-order cone programs: their types.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/conic.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */

export interface Affine {
  cols: number[];
  vals: number[];
  /** Constant term. */
  c: number;
}

export interface ConicProgram {
  /** Column names (for the solution by name). */
  names: string[];
  /** Nonnegative columns (the others are free). */
  nonneg: Uint8Array;
  /** Expected magnitude of each column (scaling for Clarabel); 1 by default. */
  scale: Float64Array;
  sense: "min" | "max";
  /** Objective coefficients by column. */
  objective: Float64Array;
  /** Equalities Σ vals·x[cols] = rhs. */
  eqCols: number[][];
  eqVals: number[][];
  eqRhs: number[];
  /** Cones (t, u₁, u₂): t ≥ ‖(u₁, u₂)‖. */
  cones: { t: Affine; u1: Affine; u2: Affine }[];
}

export type ConicStatus = "optimal" | "infeasible" | "unbounded" | "time-limit" | "failed";

export interface ConicSolution {
  status: ConicStatus;
  /** The solver's own status text. */
  detail: string;
  objective: number;
  x: Float64Array;
  /** Clarabel's dual variables of the scaled rows (equalities, nonnegative columns, cones), for diagnosis. */
  z?: Float64Array;
}
