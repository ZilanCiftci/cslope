/**
 * Numerical constants for slope stability analysis.
 *
 * See docs/typescript-conversion-guide.md Section 7.
 */

// ── Analysis defaults ──────────────────────────────────────────────
/** Default number of slices (range 10–500). */
export const DEFAULT_SLICES = 25;

/** Default number of search iterations (range 500–100,000). */
export const DEFAULT_ITERATIONS = 1000;

/** FOS convergence tolerance. */
export const FOS_TOLERANCE = 0.005;

/** Maximum FOS iterations (inner loop). */
export const MAX_FOS_ITERATIONS = 15;

/** Default analysis method. */
export const DEFAULT_METHOD = "Bishop" as const;

/** Bishop/Janbu/M-P FOS limit. */
export const FOS_LIMIT = 5;

// ── Morgenstern-Price parameters ───────────────────────────────────
/** M-P outer iteration limit. */
export const MP_OUTER_ITERATIONS = 15;

/** M-P lambda step limit. */
export const MP_LAMBDA_STEP_LIMIT = 0.3;

/** M-P max extrapolation iterations. */
export const MP_MAX_EXTRAPOLATION_ITERS = 5;

// ── Numerical guards ───────────────────────────────────────────────
/** Zero guard for m-alpha denominator. */
export const MALPHA_ZERO_GUARD = 1e-12;

/** Material epsilon for near-zero comparisons. */
export const MATERIAL_EPSILON = 1e-10;

/** Polygon intersection tolerance. */
export const POLYGON_INTERSECTION_TOLERANCE = 1e-9;

/** Slice dedup tolerance. */
export const SLICE_DEDUP_TOLERANCE = 1e-3;

// ── Physical constants ─────────────────────────────────────────────
/** Water unit weight (kN/m³). */
export const WATER_UNIT_WEIGHT = 9.81;

// ── Validation ranges ──────────────────────────────────────────────
export const SLICES_RANGE = { min: 10, max: 500 } as const;
export const ITERATIONS_RANGE = { min: 500, max: 100_000 } as const;
export const REFINED_ITERATIONS_RANGE = { min: 0, max: 100_000 } as const;
export const UNIT_WEIGHT_RANGE = { min: 0, max: 500 } as const;
export const FRICTION_ANGLE_RANGE = { min: 0, max: 90 } as const;
