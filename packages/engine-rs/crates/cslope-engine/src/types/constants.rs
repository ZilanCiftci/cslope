//! Port of packages/engine/src/types/constants.ts
//!
//! Numerical constants for slope stability analysis.

// ── Analysis defaults ──────────────────────────────────────────────
/// Default number of slices (range 10–500).
pub const DEFAULT_SLICES: f64 = 25.0;

/// Default number of search iterations (range 500–100,000).
pub const DEFAULT_ITERATIONS: f64 = 1000.0;

/// FOS convergence tolerance.
pub const FOS_TOLERANCE: f64 = 0.001;

/// Maximum FOS iterations (inner loop).
pub const MAX_FOS_ITERATIONS: f64 = 15.0;

/// Default analysis method.
pub const DEFAULT_METHOD: crate::types::analysis::AnalysisMethod =
    crate::types::analysis::AnalysisMethod::Bishop;

/// Bishop/Janbu/M-P FOS limit.
pub const FOS_LIMIT: f64 = 5.0;

// ── Morgenstern-Price parameters ───────────────────────────────────
/// M-P outer iteration limit.
pub const MP_OUTER_ITERATIONS: f64 = 15.0;

/// M-P lambda step limit.
pub const MP_LAMBDA_STEP_LIMIT: f64 = 0.3;

/// M-P max extrapolation iterations.
pub const MP_MAX_EXTRAPOLATION_ITERS: f64 = 5.0;

// ── Numerical guards ───────────────────────────────────────────────
/// Zero guard for m-alpha denominator.
pub const MALPHA_ZERO_GUARD: f64 = 1e-12;

/// Material epsilon for near-zero comparisons.
pub const MATERIAL_EPSILON: f64 = 1e-10;

/// Polygon intersection tolerance.
pub const POLYGON_INTERSECTION_TOLERANCE: f64 = 1e-9;

/// Slice dedup tolerance.
pub const SLICE_DEDUP_TOLERANCE: f64 = 1e-3;

// ── Physical constants ─────────────────────────────────────────────
/// Water unit weight (kN/m³): ρw·g = 1000 kg/m³ × 9.80665 m/s² (standard
/// gravity, CGPM 1901), rounded to 9.807; 9.81 until 2026-11-11.
pub const WATER_UNIT_WEIGHT: f64 = 9.807;

// ── Validation ranges ──────────────────────────────────────────────
/// An inclusive range `{ min, max }`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Range {
    pub min: f64,
    pub max: f64,
}

pub const SLICES_RANGE: Range = Range {
    min: 10.0,
    max: 500.0,
};
pub const ITERATIONS_RANGE: Range = Range {
    min: 500.0,
    max: 100_000.0,
};
pub const REFINED_ITERATIONS_RANGE: Range = Range {
    min: 0.0,
    max: 100_000.0,
};
pub const UNIT_WEIGHT_RANGE: Range = Range {
    min: 0.0,
    max: 500.0,
};
pub const FRICTION_ANGLE_RANGE: Range = Range {
    min: 0.0,
    max: 90.0,
};
