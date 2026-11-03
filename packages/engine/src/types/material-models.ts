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
  /**
   * B̄ (B-bar): the excess pore pressure at a slice base in this material
   * is B̄ times the vertical stress of the fill above it (the materials
   * with `bBarLoad`), added to the pore pressure of its water line: the
   * short-term pore pressure of a soft foundation under a new fill
   * (Skempton 1954; Bishop 1954). Not set: none.
   */
  bBar?: number;
  /** The weight of this material (a fill) raises the pore pressure of materials with `bBar` below it. */
  bBarLoad?: boolean;
  /**
   * Pore pressure ratio rᵤ = u / σv (Bishop & Morgenstern 1960): the pore
   * pressure at a slice base in this material is rᵤ times the weight of
   * the soil above it per unit width, added to the pore pressure of its
   * water line (if any). Not set: none.
   */
  ru?: number;
  /**
   * The strength of the material above its water line (the phreatic
   * level), when it differs from the strength below it (for example drained
   * above and undrained below). It also applies everywhere when the
   * material has no water line. Its unit weight is this model's.
   */
  aboveWater?: MaterialModel;
}

/**
 * Shear strength from matric suction above the water line, as the extended
 * Mohr-Coulomb criterion of Fredlund, Morgenstern & Widger (1978) gives it:
 * τ = c′ + (σn − ua)·tan φ′ + (ua − uw)·tan φb, with the pore-air pressure
 * ua = 0. Above the material's water line the pore pressure is negative,
 * u = −γw·(y_base − y_line) (with the same head convention as the positive
 * pore pressure below it), and the suction (−u)·tan φb, limited by
 * `maxSuction`, adds to the drained cohesion of the slice like an apparent
 * cohesion. Below the line, and without a water line, nothing changes.
 * Taken by the drained strength only: Mohr-Coulomb (the drained branch
 * of a combined material), the anisotropic function and the drained
 * branch of a combined S = f(depth); see `supportsSuctionStrength`.
 */
export interface UnsaturatedStrength {
  /** Angle φb (°) of the strength increase with matric suction, 0 ≤ φb < 90. Not set or 0: no suction strength. */
  phiB?: number;
  /** Largest matric suction (kPa) taken into account, > 0. Not set: no limit. */
  maxSuction?: number;
}

/** Whether a model kind takes `UnsaturatedStrength` (S = f(depth) only in a combined analysis). */
export function supportsSuctionStrength(kind: string): kind is "mohr-coulomb" | "anisotropic-function" | "s-f-depth" {
  return kind === "mohr-coulomb" || kind === "anisotropic-function" || kind === "s-f-depth";
}

/**
 * φb (°) a model uses: its `phiB` where the model takes suction strength
 * (an S = f(depth) material only in a combined analysis) and φb > 0, else 0.
 */
export function suctionAngle(model: { kind: string; phiB?: number; drainedCohesion?: number; drainedFrictionAngle?: number }): number {
  if (!supportsSuctionStrength(model.kind)) return 0;
  if (model.kind === "s-f-depth" && !isCombinedDepthModel(model)) return 0;
  const phiB = model.phiB;
  return phiB !== undefined && Number.isFinite(phiB) && phiB > 0 && phiB < 90 ? phiB : 0;
}

// ── Model variants ─────────────────────────────────────────────

/** Standard Mohr-Coulomb effective-stress model. */
/**
 * The drawdown (R) envelope of a soil that does not drain during rapid
 * drawdown: the total-stress envelope of isotropically consolidated
 * undrained tests (cR, φR), for the three-stage drawdown analysis.
 */
export interface DrawdownEnvelope {
  cohesion: number;
  frictionAngle: number;
}

export interface MohrCoulombModel extends MaterialModelBase, UnsaturatedStrength {
  kind: "mohr-coulomb";
  /** Effective cohesion c (kPa). */
  cohesion: number;
  /** Friction angle φ (°). */
  frictionAngle: number;
  /**
   * The drawdown (R) envelope: with a rapid drawdown analysis
   * (SlopeDefinition.rapidDrawdown) the soil does not drain and takes the
   * undrained strength of the three-stage procedure (model/drawdown.ts).
   * Not set: free-draining, its drained strength throughout.
   */
  drawdownStrength?: DrawdownEnvelope;
  /**
   * Reference ELEVATION y (m, despite the name) where c = `cohesion`:
   * c = cohesion + (cohesionRefDepth − y_base) × cohesionRateOfChange.
   */
  cohesionRefDepth?: number;
  /** Rate of cohesion increase per metre below the reference elevation (kPa/m). */
  cohesionRateOfChange?: number;
  /** Undrained cohesion Su (kPa). Used by Combined method. */
  cohesionUndrained?: number;
  /**
   * Combined-method c-factor: the drained c′ is `cohesion` × cFactor.
   * 0 = not combined, so cFactor = 0 cannot give a combined material
   * with c′ = 0; that takes `cohesion` = 0, any other cFactor and
   * `cohesionUndrained` set.
   */
  cFactor?: number;
}

/**
 * Anisotropy of an undrained shear strength (undrained, S = f(depth),
 * S = f(datum); see `supportsAnisotropy`).
 */
export interface UndrainedAnisotropy {
  /**
   * Anisotropy of the undrained shear strength: Su is multiplied by a
   * factor that depends on the slice base inclination α, given as
   * [[α°, factor], …] and interpolated linearly (constant beyond the ends),
   * as `anisotropic-function`'s modifier: α is positive where the base dips
   * down in the direction of sliding (the active zone near the crest),
   * negative where it rises (the passive zone at the toe). For example
   * [[-45, 0.82], [0, 1], [60, 1.5]] for passive 0.82, direct 1.0 and active
   * 1.5 relative to the direct shear strength. Analyses without a slip
   * surface base (finite elements, limit analysis, the strength profiles)
   * take the factor at α = 0. Not set or empty: isotropic.
   */
  anisotropy?: [number, number][];
}

/** Whether a model kind takes `UndrainedAnisotropy.anisotropy`. */
export function supportsAnisotropy(kind: string): kind is "undrained" | "s-f-depth" | "s-f-datum" | "shansep" {
  return kind === "undrained" || kind === "s-f-depth" || kind === "s-f-datum" || kind === "shansep";
}

/** Undrained strength model (φ = 0). */
export interface UndrainedModel extends MaterialModelBase, UndrainedAnisotropy {
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
  /**
   * Interpolation method (default: "idw", inverse distance weighting with
   * power 2). "linear" is inverse distance weighting with power 1, not a
   * linear (triangulated) interpolation.
   */
  interpolation?: "nearest" | "linear" | "idw";
}

/**
 * Anisotropic function model.
 *
 * Base c and φ are multiplied by a modifier that is a function of the
 * slice base inclination angle α.  The modifier function is supplied
 * as an array of (α_deg, factor) pairs and linearly interpolated.
 * The factor scales φ in degrees, not tan φ: 0.8 on φ = 30° gives
 * 24.0°, where 0.8·tan 30° would give 24.8°.
 */
export interface AnisotropicFunctionModel extends MaterialModelBase, UnsaturatedStrength {
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
 *
 * Combined (with `drainedCohesion` and `drainedFrictionAngle`): the
 * strength is the lesser of the undrained Su and the drained
 * c′ + σ′·tan φ′, with c′ = drainedCohesion + (depth − depthRef) ×
 * drainedCohesionRate at the same depth, as Swedish practice analyses
 * clay ("kombinerad analys") and commercial programs offer it.
 */
export interface StrengthFromDepthModel extends MaterialModelBase, UndrainedAnisotropy, UnsaturatedStrength {
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
  /**
   * Drained effective cohesion c′ (kPa) at the reference depth, for a
   * combined analysis. Set together with `drainedFrictionAngle`; either
   * not set: undrained only.
   */
  drainedCohesion?: number;
  /** Change of c′ per metre of depth (kPa/m), with the same depth as Su. Not set: 0. */
  drainedCohesionRate?: number;
  /** Drained friction angle φ′ (°) for a combined analysis (see `drainedCohesion`). */
  drainedFrictionAngle?: number;
}

/** Whether an S = f(depth) model has a drained branch (a combined analysis). */
export function isCombinedDepthModel(model: { kind: string; drainedCohesion?: number; drainedFrictionAngle?: number }): boolean {
  return model.kind === "s-f-depth" && model.drainedCohesion !== undefined && model.drainedFrictionAngle !== undefined;
}

/**
 * Strength as a function of datum (absolute elevation y).
 *
 * φ = 0; Su = suRef + (yRef − y) × rate,
 * where y is the elevation of the slice base: a positive rate increases
 * Su with depth below the datum, as in commercial programs.
 */
export interface StrengthFromDatumModel extends MaterialModelBase, UndrainedAnisotropy {
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

/**
 * Generalised Hoek–Brown rock mass (Hoek, Carranza-Torres & Corkum 2002):
 * σ1′ = σ3′ + σci (mb σ3′/σci + s)^a from the intact rock's σci and mi,
 * the Geological Strength Index and the disturbance factor D. The analyses
 * use its instantaneous Mohr–Coulomb parameters at the normal stress on the
 * slip surface (types/hoek-brown.ts).
 */
export interface HoekBrownModel extends MaterialModelBase {
  kind: "hoek-brown";
  /** Uniaxial compressive strength of the intact rock σci (kPa). */
  ucs: number;
  /** Geological Strength Index, 0–100. */
  gsi: number;
  /** Intact rock constant mi. */
  mi: number;
  /** Disturbance factor D, 0–1. Default 0. */
  disturbance?: number;
  /**
   * The criterion's own parameters, given directly (for example the
   * original criterion, a = 0.5): with `mb` and `s` set they are used
   * instead of those from GSI, mi and D (`a` not set: 0.5).
   */
  mb?: number;
  s?: number;
  a?: number;
}

// ── Union ──────────────────────────────────────────────────────

/** Discriminated union of all supported material models. */
/**
 * SHANSEP (Ladd & Foott 1974): the undrained strength from the effective
 * vertical stress at the slice base and the stress history,
 * Su = σ′v · S · OCR^m, with OCR constant or a function of elevation; or
 * Su as a function of σ′v. σ′v is the slice's weight and surface loads per
 * unit width less the pore pressure at its base (the overburden on the
 * base in the analysis's pore pressures), as commercial programs take it.
 */
export interface ShansepModel extends MaterialModelBase, UndrainedAnisotropy {
  kind: "shansep";
  /** S, the Su/σ′v ratio of the normally consolidated soil. */
  ratio: number;
  /** The exponent m. Default 0.8. */
  exponent?: number;
  /** OCR, constant. Default 1. */
  ocr?: number;
  /**
   * Pre-overburden pressure POP (kPa): OCR = (σ′v + POP)/σ′v at the base.
   * Replaces `ocr` and `ocrByElevation`.
   */
  pop?: number;
  /** Yield (preconsolidation) stress σ′y (kPa): OCR = σ′y/σ′v at the base, at least 1. Replaces `ocr` and `ocrByElevation`. */
  yieldStress?: number;
  /**
   * With an earlier stage (SlopeDefinition.earlierStage): the yield stress
   * is the effective vertical stress of the earlier stage at the base plus
   * `pop` (the stress history the soil kept from it), OCR = σ′y/σ′v, at
   * least 1.
   */
  yieldFromEarlierStage?: boolean;
  /** OCR against elevation, [[y, OCR], …], interpolated linearly (constant beyond the ends); replaces `ocr`. */
  ocrByElevation?: [number, number][];
  /** Su against σ′v, [[σ′v, Su], …], interpolated linearly (constant beyond the ends); replaces S, m and OCR. */
  suByStress?: [number, number][];
  /** Lower limit of Su (kPa). Default 0. */
  suMin?: number;
  /** Cubic splines through `ocrByElevation` / `suByStress` instead of straight lines; constant beyond the ends as with straight lines. */
  spline?: TableSpline;
}

/**
 * A curved strength envelope given as points of the shear strength against
 * the effective normal stress, τ = f(σ′n), interpolated linearly between
 * them or with a spline (the end segment extended beyond the ends): each
 * slice base takes
 * the tangent c and φ of the segment at its normal stress, which the
 * analysis updates from the stress it finds, as for Hoek-Brown.
 */
export interface ShearNormalModel extends MaterialModelBase {
  kind: "shear-normal";
  /** [[σ′n (kPa), τ (kPa)], …], σ′n increasing, τ ≥ 0. */
  points: [number, number][];
  /** A cubic spline through the points instead of straight lines (see `TableSpline`). */
  spline?: TableSpline;
}

/**
 * A cubic spline through a table's points: natural (zero curvature) at an
 * end without a slope, clamped to the slope given; a straight line with
 * the end slope beyond the ends (math/spline.ts).
 */
export interface TableSpline {
  startSlope?: number;
  endSlope?: number;
}

export type MaterialModel =
  | MohrCoulombModel
  | UndrainedModel
  | HighStrengthModel
  | ImpenetrableModel
  | SpatialMohrCoulombModel
  | AnisotropicFunctionModel
  | StrengthFromDepthModel
  | StrengthFromDatumModel
  | LimeCementColumnModel
  | HoekBrownModel
  | ShansepModel
  | ShearNormalModel;

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
  "hoek-brown": "Generalised Hoek-Brown",
  shansep: "SHANSEP",
  "shear-normal": "Shear-normal function",
};
