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
  /**
   * Saturated unit weight (kN/m³) for the soil below the material's water
   * line. Not set: `unitWeight` throughout.
   */
  unitWeightSat?: number;
}

// ── Model variants ─────────────────────────────────────────────

/** Standard Mohr-Coulomb effective-stress model. */
export interface MohrCoulombModel extends MaterialModelBase {
  kind: "mohr-coulomb";
  /** Effective cohesion c (kPa). */
  cohesion: number;
  /** Friction angle φ (°). */
  frictionAngle: number;
  /**
   * Reference ELEVATION y (m, despite the name) where c = `cohesion`:
   * c = cohesion + (cohesionRefDepth − y_base) × cohesionRateOfChange.
   */
  cohesionRefDepth?: number;
  /** Rate of cohesion increase per metre below the reference elevation (kPa/m). */
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
  /** Rate of Su increase per metre below `suRefDepth` (kPa/m). */
  suRateOfChange?: number;
  /** Reference ELEVATION y (m, despite the name) where Su = `undrainedShearStrength`. */
  suRefDepth?: number;
  /**
   * Strength cutoff (kPa), as commercial programs offer it.
   * With `suRateOfChange` ≥ 0 (Su constant or increasing with depth) it is a
   * MAXIMUM: Su = min(Su, suMax). With a negative rate (Su decreasing with
   * depth) it is a MINIMUM: Su = max(Su, suMax). Not set: no cutoff.
   */
  suMax?: number;
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
  /**
   * Modifier vs base inclination: [[α_deg, factor], …].
   *
   * α is measured relative to the sliding direction, not geometrically:
   * positive where the slice base dips down in the direction of sliding
   * (the back scarp), negative where it rises (the toe).  The same
   * function therefore applies unchanged to left- and right-facing slopes.
   */
  modifierFunction: [number, number][];
}

/** Where the depth of an `s-f-depth` material is measured from. */
export type DepthReference = "ground" | "layer-top";

/**
 * Strength as a function of depth.
 *
 * φ = 0; Su = suRef + (depth − depthRef) × rate,
 * where depth = yTop − yBottom at the slice base centre, yTop being the
 * ground surface or the top of the material layer (see `depthReference`).
 */
export interface StrengthFromDepthModel extends MaterialModelBase {
  kind: "s-f-depth";
  /** Reference undrained shear strength Su (kPa). */
  suRef: number;
  /** Reference depth (m) below the depth reference. */
  depthRef: number;
  /** Rate of change of Su with depth (kPa/m); positive: Su increases downwards. */
  rate: number;
  /**
   * What the depth is measured from:
   * - "ground": the ground surface above the slice base;
   * - "layer-top": the top of the region of this material directly above
   *   the slice base (as commercial programs offer it); for the uppermost layer this is the ground.
   * Not set: "ground" (models saved before the option existed).
   */
  depthReference?: DepthReference;
  /**
   * Strength cutoff (kPa), as commercial programs offer it.
   * With `rate` ≥ 0 (Su constant or increasing with depth) it is a MAXIMUM:
   * Su = min(Su, suMax). With a negative rate (Su decreasing with depth) it
   * is a MINIMUM: Su = max(Su, suMax). Not set: no cutoff.
   */
  suMax?: number;
}

/**
 * Strength as a function of datum (absolute elevation y).
 *
 * φ = 0; Su = suRef + (yRef − y) × rate,
 * where y is the elevation of the slice base: a positive rate increases
 * Su with depth below the datum, as in commercial programs.
 */
export interface StrengthFromDatumModel extends MaterialModelBase {
  kind: "s-f-datum";
  /** Reference undrained shear strength Su (kPa). */
  suRef: number;
  /** Reference elevation y (m). */
  yRef: number;
  /** Increase of Su per metre below yRef (kPa/m). */
  rate: number;
  /**
   * Strength cutoff (kPa), as commercial programs offer it.
   * With `rate` ≥ 0 (Su constant or increasing below the datum) it is a
   * MAXIMUM: Su = min(Su, suMax). With a negative rate (Su decreasing
   * downwards) it is a MINIMUM: Su = max(Su, suMax). Not set: no cutoff.
   */
  suMax?: number;
}

/**
 * Clay improved with lime-cement columns (KC-pelare): the shear strength of
 * the improved block is the area-weighted mean of the columns and the soil
 * between them, τ = a·τcol + (1 − a)·cu,soil. Undrained by default; with a
 * drained column strength (c′, φ′) the column part is limited to
 * c′ + σ′·tan φ′ ≤ cu,col (combined analysis), as in Swedish practice.
 */
export interface LimeCementColumnModel extends MaterialModelBase {
  kind: "lime-cement-columns";
  /** Undrained shear strength of the soil between the columns (kPa) at the reference level. */
  soilSu: number;
  /** Reference level (elevation, m) of soilSu. Default 0. */
  suRefDepth?: number;
  /** Increase of soilSu per metre below the reference level (kPa/m). Default 0. */
  suRateOfChange?: number;
  /**
   * Cutoff (kPa) of the soil strength between the columns (soilSu with its
   * depth variation; the columns are not affected). With `suRateOfChange`
   * ≥ 0 it is a MAXIMUM: cu,soil = min(cu,soil, suMax); with a negative
   * rate a MINIMUM: cu,soil = max(cu,soil, suMax). Not set: no cutoff.
   */
  suMax?: number;
  /** Undrained shear strength of the columns (kPa). */
  columnSu: number;
  /** Area ratio a = column area / improved area, 0–1. */
  areaRatio: number;
  /** Drained cohesion of the columns c′ (kPa); with columnFrictionAngle. */
  columnCohesion?: number;
  /** Drained friction angle of the columns φ′ (°); with columnCohesion. */
  columnFrictionAngle?: number;
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
  | StrengthFromDatumModel
  | LimeCementColumnModel;

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
  "lime-cement-columns": "Lime-cement columns",
};
