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
import { wasm } from "../facade/internal";
import type { MaterialModel } from "./material-models";
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
