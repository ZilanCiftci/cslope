/**
 * Unified strength resolution for all material models.
 *
 * `resolveStrength` is the SINGLE dispatch point that maps a
 * `MaterialModel` + geometric context → effective c / φ for a slice.
 * Solvers and the slice builder never inspect `model.kind` directly;
 * they only consume the `ResolvedStrength` output.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { testCall, wasm } from "../facade/internal";
import type { MaterialModel, MaterialModelKind, TableSpline } from "./material-models";
import type { PartialFactors } from "./analysis";
import type { HoekBrownParameters } from "./hoek-brown";

// ── Result type ────────────────────────────────────────────────

/** Effective shear-strength parameters resolved for one slice. */
export interface ResolvedStrength {
  /** Effective cohesion for this slice (kPa). */
  cohesion: number;
  /** Effective friction angle for this slice (°). */
  frictionAngle: number;
  /** Undrained cohesion for Combined-method FOS (kPa). */
  cohesionUndrained: number;
  /**
   * Part of `cohesion` that is an undrained shear strength, so takes γcu
   * when design values are formed; the rest is drained c′ (γc′). Set by
   * lime-cement columns in their drained limit, whose cohesion
   * (1 − a)·cu,soil + a·c′ mixes the two. Not set: 0.
   */
  cohesionUndrainedPart?: number;
  /**
   * Part of `cohesion` (kPa) that is strength from matric suction,
   * min(suction, maxSuction)·tan φb (`UnsaturatedStrength`): drained, so
   * it takes γc′ when design values are formed, also on a material
   * entered with φ = 0. Not set: 0.
   */
  suctionStrength?: number;
  /**
   * When `true`, any slip surface passing through this material
   * should be treated as infinitely stable (FOS → ∞) and excluded
   * from the critical-surface search.
   */
  skipSurface?: boolean;
  /**
   * When `true`, the slip surface is not permitted to enter this
   * material.  The slice builder should return `null` for the slice.
   */
  impenetrable?: boolean;
  /**
   * When `true`, the solver should use the Combined method:
   * resistance = min(drained, undrained).
   */
  isCombined?: boolean;
  /**
   * A Hoek–Brown rock mass: c and φ are its instantaneous parameters at an
   * estimate of the normal stress (the overburden), which the analyses
   * update from the stress they find (types/hoek-brown.ts).
   */
  hoekBrown?: HoekBrownParameters;
  /** A shear-normal function: its tangent c, φ are updated like Hoek-Brown's. */
  shearNormal?: Extract<MaterialModel, { kind: "shear-normal" }>;
}

// ── Context supplied by the slice builder ──────────────────────

/** Geometric context available at the time of slice creation. */
export interface StrengthContext {
  /** Y-coordinate of the slice base (elevation). */
  yBottom: number;
  /** X-coordinate of the slice midpoint. */
  x: number;
  /** Ground-surface Y at this x-coordinate. */
  yGround: number;
  /**
   * Y of the top of the base material's layer at this x: the highest point
   * of the region of that material directly above the base (see
   * `materialLayerTopAt`). Only needed by models measuring depth from the
   * top of the layer (`needsLayerTop`); not set: the ground (`yGround`).
   */
  yLayerTop?: number;
  /** Base inclination angle α (rad). */
  alpha: number;
  /**
   * Matric suction ua − uw at the point (kPa, ≥ 0): the negative pore
   * pressure above the material's water line, for materials with φb
   * (`UnsaturatedStrength`). Not set: 0, no suction strength.
   */
  suction?: number;
  /**
   * Effective vertical stress at the base (kPa), for SHANSEP: the slice's
   * weight and loads per unit width less the pore pressure. Not set: the
   * overburden γ·(ground − base) of the model's unit weight.
   */
  effectiveVerticalStress?: number;
}

/** Design shear strength at one point (see `designStrength`). */
export interface DesignStrength {
  /** Cohesion of the drained (or only) branch (kPa). */
  cohesion: number;
  /** tan φ of the drained (or only) branch. */
  tanPhi: number;
  /** Undrained strength, the other branch of a combined material (kPa). */
  cohesionUndrained: number;
  /**
   * The only strength is undrained (total stress, φ = 0): Su,
   * S = f(depth/datum), undrained lime-cement columns and any model
   * entered with φ = 0, the common way to give undrained clay as
   * Mohr-Coulomb.
   */
  undrained: boolean;
}

/**
 * Whether resolving `model` uses `StrengthContext.yLayerTop`, so callers
 * only search the layer top when it matters.
 */
export function needsLayerTop(model: MaterialModel): boolean {
  return wasm().needs_layer_top(model);
}

/**
 * Resolve effective shear-strength parameters for a single slice.
 *
 * @param model   The material model assigned to the slice base.
 * @param context Geometric context from the slice builder.
 * @returns Resolved c, φ (and flags) for the solver.
 */
export function resolveStrength(model: MaterialModel, context: StrengthContext): ResolvedStrength {
  return wasm().resolve_strength(model, context);
}

/**
 * Strength from matric suction (kPa): min(suction, maxSuction)·tan φb for
 * a material with φb (`UnsaturatedStrength`), else 0.
 */
export function suctionStrength(model: MaterialModel, suction: number): number {
  return wasm().suction_strength(model, suction);
}

/**
 * Unit weight at a point (kN/m³).
 *
 * Only the spatial Mohr-Coulomb model varies γ: it is interpolated from
 * the data points that give a positive γ, the same way as c and φ.
 * Every other model (and a spatial model without γ data) uses
 * `fallback`, the material's own unit weight.
 */
export function resolveUnitWeight(model: MaterialModel, fallback: number, x: number, y: number): number {
  return wasm().resolve_unit_weight(model, fallback, x, y);
}

/**
 * Linearly interpolate a 1-D function defined by sorted (x, y) pairs.
 * Clamps to the nearest endpoint outside the data range.
 */
export function interpolateFunction(points: [number, number][], x: number): number {
  return wasm().interpolate_function(points, x);
}

// ── internal (testing build) ─────────────────────────────────────

/**
 * Design strength: each characteristic parameter divided by its own
 * partial factor, as EN 1997-1 (2004) 2.4.6.2 and Annex A set them per
 * parameter: γcu on undrained shear strength, γc′ on effective cohesion,
 * γφ′ on tan φ′. A strength summed from parts of both kinds factors each
 * part on its own: lime-cement columns in their drained limit,
 * (1 − a)·cu,soil + a·c′col, give (1 − a)·cu,soil/γcu + a·c′col/γc′ (the
 * composite strength of soil and columns in the Swedish guidance on deep
 * mixing, SGF Report 2:2000 and TK Geo 13, with the Eurocode factor of
 * each part). The undrained branch of a combined material takes γcu.
 * Strength from matric suction (φb) is drained and takes γc′ like c′,
 * also on a Mohr-Coulomb material entered with φ = 0.
 * Without factors (and for high-strength and bedrock) the characteristic
 * values are returned.
 *
 * The one place design strength is formed: the slices, the Rankine crack
 * depth and the Ito & Matsui pile pressure all use it.
 */
export function designStrength(
  kind: MaterialModelKind | undefined,
  st: Pick<ResolvedStrength, "cohesion" | "frictionAngle" | "cohesionUndrained" | "isCombined" | "cohesionUndrainedPart" | "suctionStrength">,
  f: PartialFactors | null | undefined,
): DesignStrength {
  return testCall("types/strength::designStrength", [kind, st, f]);
}

/**
 * Tangent c (kPa) and φ (°) of a shear-normal function at σ′n: of the
 * segment holding σ′n (the first or last beyond the ends), so that
 * c + σ′n·tan φ is the strength there. Where the tangent's intercept would
 * be negative (a convex part), the secant through the origin (c = 0,
 * tan φ = τ/σ′n); where the curve falls, its value as c with φ = 0.
 */
export function shearNormalAt(model: { points: readonly [number, number][]; spline?: TableSpline }, sn: number): { cohesion: number; frictionAngle: number } {
  return testCall("types/strength::shearNormalAt", [model, sn]);
}

/** SHANSEP undrained strength at the base (see ShansepModel). */
export function shansepSu(
  model: Extract<MaterialModel, { kind: "shansep" }>,
  context: Pick<StrengthContext, "yBottom" | "yGround" | "effectiveVerticalStress">,
): number {
  return testCall("types/strength::shansepSu", [model, context]);
}
