/**
 * The programs of the limit analysis bounds (lower-bound.ts, upper-bound.ts)
 * as second-order cone programs: their types. The programs are built and
 * solved inside the engine (Rust, through WebAssembly).
 *
 * A program has linear equalities, nonnegative and free variables, a linear
 * objective and three-dimensional second-order cones t ≥ ‖(u₁, u₂)‖ on affine
 * expressions t, u₁, u₂ of the variables: in plane strain the Mohr–Coulomb
 * criterion is such a cone in the stresses and its flow rule one in the
 * strain rates (Makrodimopoulos & Martin 2006, IJNME 66(4), 604–634, and
 * 2007, IJNAMG 31(6), 835–865; Krabbenhøft, Lyamin & Sloan 2007, Int. J.
 * Solids Struct. 44(5), 1533–1549).
 *
 * Clarabel (Goulart & Chen 2024, arXiv:2405.12762), an interior point
 * method for conic programs, solves the cones exactly; it is linked into
 * the engine. The variables are scaled by `scale` (their expected
 * magnitude) and the objective by its largest coefficient before solving:
 * the solver's tolerances are absolute, and in imperial units (γ = 120 pcf,
 * c = 600 psf) the unscaled programs reported "solved" at a wrong optimum
 * (a prototype on V046a gave 0.864 for both bounds against 1.32–1.34
 * scaled). Its "almost" statuses (reduced tolerances, about 1e-4) count as
 * solved or infeasible: far below the tolerance on F. A numerical failure
 * is solved again with more static regularisation within the time left.
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
