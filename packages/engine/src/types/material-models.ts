/**
 * Discriminated-union material model types.
 *
 * Each model variant carries only the parameters relevant to its
 * constitutive behaviour.  The `kind` field acts as the discriminant
 * for exhaustive `switch` / `if` branching.
 *
 * Adding a new model requires:
 *   1. Define a new interface here extending `MaterialModelBase`.
 *   2. Add it to the `MaterialModel` union.
 *   3. Handle the `kind` in `resolveStrength()` (strength.ts).
 */

// ── Base ───────────────────────────────────────────────────────

/** Fields shared by every material model. */
export interface MaterialModelBase {
  /** Material unit weight in kN/m³. */
  unitWeight: number;
}

// ── Model variants ─────────────────────────────────────────────

/** Standard Mohr-Coulomb effective-stress model. */
export interface MohrCoulombModel extends MaterialModelBase {
  kind: "mohr-coulomb";
  /** Effective cohesion c (kPa). */
  cohesion: number;
  /** Friction angle φ (°). */
  frictionAngle: number;
  /** Reference depth for cohesion variation (m). */
  cohesionRefDepth?: number;
  /** Rate of cohesion change with depth (kPa/m). */
  cohesionRateOfChange?: number;
  /** Undrained cohesion Su (kPa). Used by Combined method. */
  cohesionUndrained?: number;
  /** Combined-method c-factor. 0 = not combined. */
  cFactor?: number;
}

/** Undrained strength model (φ = 0). */
export interface UndrainedModel extends MaterialModelBase {
  kind: "undrained";
  /** Undrained shear strength Su (kPa). */
  undrainedShearStrength: number;
  /** Rate of Su change with depth (kPa/m). */
  suRateOfChange?: number;
  /** Reference depth for Su variation (m). */
  suRefDepth?: number;
}

/**
 * High-strength material (e.g. concrete retaining wall).
 *
 * Strength is treated as infinite — any slip surface passing through
 * this material is considered very stable and effectively skipped.
 * Only `unitWeight` is used (for overburden calculation).
 */
export interface HighStrengthModel extends MaterialModelBase {
  kind: "high-strength";
}

/**
 * Impenetrable material (bedrock).
 *
 * The slip surface cannot enter this region.  Any slice whose base
 * falls inside this material causes the surface to be rejected.
 * `unitWeight` is still needed for overburden on layers below.
 */
export interface ImpenetrableModel extends MaterialModelBase {
  kind: "impenetrable";
}

/**
 * Spatial Mohr-Coulomb — c, φ vary as functions of (x, y).
 *
 * The user supplies a set of data points with known c, φ, γ values.
 * At analysis time, the effective parameters are interpolated from
 * the nearest data points.
 */
export interface SpatialMohrCoulombModel extends MaterialModelBase {
  kind: "spatial-mohr-coulomb";
  /** Data points: [x, y, c (kPa), φ (°), γ (kN/m³)]. */
  dataPoints: [number, number, number, number, number][];
  /** Interpolation method (default: "idw"). */
  interpolation?: "nearest" | "linear" | "idw";
}

/**
 * Anisotropic function model.
 *
 * Base c and φ are multiplied by a modifier that is a function of the
 * slice base inclination angle α.  The modifier function is supplied
 * as an array of (α_deg, factor) pairs and linearly interpolated.
 */
export interface AnisotropicFunctionModel extends MaterialModelBase {
  kind: "anisotropic-function";
  /** Base effective cohesion c (kPa). */
  cohesion: number;
  /** Base friction angle φ (°). */
  frictionAngle: number;
  /** Modifier vs inclination: [[α_deg, factor], …]. */
  modifierFunction: [number, number][];
}

/**
 * Strength as a function of depth below the ground surface.
 *
 * φ = 0; Su = suRef + (depth − depthRef) × rate,
 * where depth = yGround − yBottom at the slice.
 */
export interface StrengthFromDepthModel extends MaterialModelBase {
  kind: "s-f-depth";
  /** Reference undrained shear strength Su (kPa). */
  suRef: number;
  /** Reference depth below ground surface (m). */
  depthRef: number;
  /** Rate of change of Su with depth (kPa/m). */
  rate: number;
}

/**
 * Strength as a function of datum (absolute elevation y).
 *
 * φ = 0; Su = suRef + (y − yRef) × rate,
 * where y is the elevation of the slice base.
 */
export interface StrengthFromDatumModel extends MaterialModelBase {
  kind: "s-f-datum";
  /** Reference undrained shear strength Su (kPa). */
  suRef: number;
  /** Reference elevation y (m). */
  yRef: number;
  /** Rate of change of Su with elevation (kPa/m). */
  rate: number;
}

// ── Union ──────────────────────────────────────────────────────

/** Discriminated union of all supported material models. */
export type MaterialModel =
  | MohrCoulombModel
  | UndrainedModel
  | HighStrengthModel
  | ImpenetrableModel
  | SpatialMohrCoulombModel
  | AnisotropicFunctionModel
  | StrengthFromDepthModel
  | StrengthFromDatumModel;

/** All valid `kind` string literals. */
export type MaterialModelKind = MaterialModel["kind"];

/** Human-readable labels for each model kind (UI display). */
export const MATERIAL_MODEL_LABELS: Record<MaterialModelKind, string> = {
  "mohr-coulomb": "Mohr-Coulomb",
  undrained: "Undrained",
  "high-strength": "High Strength",
  impenetrable: "Impenetrable (Bedrock)",
  "spatial-mohr-coulomb": "Spatial Mohr-Coulomb",
  "anisotropic-function": "Anisotropic Function",
  "s-f-depth": "S = f(depth)",
  "s-f-datum": "S = f(datum)",
};
