/**
 * Unified strength resolution for all material models.
 *
 * `resolveStrength` is the SINGLE dispatch point that maps a
 * `MaterialModel` + geometric context → effective c / φ for a slice.
 * Solvers and the slice builder never inspect `model.kind` directly;
 * they only consume the `ResolvedStrength` output.
 */

import type { MaterialModel, MaterialModelKind } from "./material-models";
import type { PartialFactors } from "./analysis";
import { hoekBrownParameters, instantaneousAtNormalStress, type HoekBrownParameters } from "./hoek-brown";
import {
  interpolateIDW,
  interpolateNearest,
  type SpatialDataPoint,
} from "../math/interpolation";

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
}

// ── Resolver ───────────────────────────────────────────────────

/**
 * Whether resolving `model` uses `StrengthContext.yLayerTop`, so callers
 * only search the layer top when it matters.
 */
export function needsLayerTop(model: MaterialModel): boolean {
  return model.kind === "s-f-depth" && model.depthReference === "layer-top";
}

/**
 * Resolve effective shear-strength parameters for a single slice.
 *
 * @param model   The material model assigned to the slice base.
 * @param context Geometric context from the slice builder.
 * @returns Resolved c, φ (and flags) for the solver.
 */
export function resolveStrength(
  model: MaterialModel,
  context: StrengthContext,
): ResolvedStrength {
  switch (model.kind) {
    // ── Mohr-Coulomb (current default) ───────────────────────
    case "mohr-coulomb":
      return resolveMohrCoulomb(model, context);

    // ── Undrained (φ = 0, c = Su) ────────────────────────────
    case "undrained":
      return resolveUndrained(model, context);

    // ── High Strength ────────────────────────────────────────
    case "high-strength":
      return {
        cohesion: Infinity,
        frictionAngle: 90,
        cohesionUndrained: Infinity,
        skipSurface: true,
      };

    // ── Impenetrable (Bedrock) ───────────────────────────────
    case "impenetrable":
      return {
        cohesion: 0,
        frictionAngle: 0,
        cohesionUndrained: 0,
        impenetrable: true,
      };

    // ── Spatial Mohr-Coulomb ─────────────────────────────────
    case "spatial-mohr-coulomb":
      return resolveSpatialMohrCoulomb(model, context);

    // ── Anisotropic Function ─────────────────────────────────
    case "anisotropic-function":
      return resolveAnisotropic(model, context);

    // ── S = f(depth) ─────────────────────────────────────────
    case "s-f-depth":
      return resolveStrengthFromDepth(model, context);

    // ── S = f(datum) ─────────────────────────────────────────
    case "lime-cement-columns":
      return resolveLimeCementColumns(model, context);

    case "s-f-datum":
      return resolveStrengthFromDatum(model, context);

    // ── Generalised Hoek–Brown ───────────────────────────────
    case "hoek-brown": {
      // first estimate of the normal stress on the base: the overburden
      // γ·depth·cos²α (no pore pressure); the analyses refine it
      const hb = hoekBrownParameters(model.ucs, model.gsi, model.mi, model.disturbance ?? 0);
      const depth = Math.max(0, context.yGround - context.yBottom);
      const sn = model.unitWeight * depth * Math.cos(context.alpha) ** 2;
      const inst = instantaneousAtNormalStress(hb, sn);
      return { ...inst, cohesionUndrained: inst.cohesion, hoekBrown: hb };
    }

    default: {
      // Exhaustiveness guard — TypeScript will error if a new kind
      // is added to the union but not handled above.
      const _exhaustive: never = model;
      throw new Error(
        `Unknown material model kind: ${(_exhaustive as MaterialModel).kind}`,
      );
    }
  }
}

// ── Per-model resolvers ────────────────────────────────────────

function resolveMohrCoulomb(
  model: Extract<MaterialModel, { kind: "mohr-coulomb" }>,
  context: StrengthContext,
): ResolvedStrength {
  const refDepth = model.cohesionRefDepth ?? 0;
  const rateOfChange = model.cohesionRateOfChange ?? 0;
  const baseCohesion =
    model.cohesion + (refDepth - context.yBottom) * rateOfChange;

  const cFactor = model.cFactor ?? 0;
  const cohesion = nonNegative(
    cFactor !== 0 ? baseCohesion * cFactor : baseCohesion,
  );

  // Undrained cohesion (used by Combined method)
  const cohesionUndrained = nonNegative(
    (model.cohesionUndrained ?? model.cohesion) +
      (refDepth - context.yBottom) * rateOfChange,
  );

  return {
    cohesion,
    frictionAngle: model.frictionAngle,
    cohesionUndrained,
    isCombined: cFactor !== 0,
  };
}

function resolveLimeCementColumns(
  model: Extract<MaterialModel, { kind: "lime-cement-columns" }>,
  context: StrengthContext,
): ResolvedStrength {
  const rate = model.suRateOfChange ?? 0;
  const soil = applyCutoff(
    nonNegative(model.soilSu + ((model.suRefDepth ?? 0) - context.yBottom) * rate),
    rate,
    model.suMax,
  );
  const a = Math.min(1, Math.max(0, model.areaRatio));
  const undrained = a * model.columnSu + (1 - a) * soil;
  if (model.columnCohesion === undefined || model.columnFrictionAngle === undefined) {
    return { cohesion: undrained, frictionAngle: 0, cohesionUndrained: undrained };
  }
  // min over the column part: a·min(c′ + σ′ tan φ′, cu,col) + (1 − a)·cu,soil
  // = min((1 − a)·cu,soil + a·c′ + σ′·a·tan φ′, undrained): a combined
  // material with these drained parameters.
  const tanPhi = a * Math.tan((model.columnFrictionAngle * Math.PI) / 180);
  return {
    cohesion: (1 - a) * soil + a * model.columnCohesion,
    // The soil between the columns stays undrained: it takes γcu, the
    // columns' c′ γc′ (designStrength).
    cohesionUndrainedPart: (1 - a) * soil,
    frictionAngle: (Math.atan(tanPhi) * 180) / Math.PI,
    cohesionUndrained: undrained,
    isCombined: true,
  };
}

function resolveUndrained(
  model: Extract<MaterialModel, { kind: "undrained" }>,
  context: StrengthContext,
): ResolvedStrength {
  const refDepth = model.suRefDepth ?? 0;
  const rate = model.suRateOfChange ?? 0;
  const su = applyCutoff(
    nonNegative(model.undrainedShearStrength + (refDepth - context.yBottom) * rate),
    rate,
    model.suMax,
  );

  return {
    cohesion: su,
    frictionAngle: 0,
    cohesionUndrained: su,
  };
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
 * Design strength: each characteristic parameter divided by its own
 * partial factor, as EN 1997-1 (2004) 2.4.6.2 and Annex A set them per
 * parameter: γcu on undrained shear strength, γc′ on effective cohesion,
 * γφ′ on tan φ′. A strength summed from parts of both kinds factors each
 * part on its own: lime-cement columns in their drained limit,
 * (1 − a)·cu,soil + a·c′col, give (1 − a)·cu,soil/γcu + a·c′col/γc′ (the
 * composite strength of soil and columns in the Swedish guidance on deep
 * mixing, SGF Report 2:2000 and TK Geo 13, with the Eurocode factor of
 * each part). The undrained branch of a combined material takes γcu.
 * Without factors (and for high-strength and bedrock) the characteristic
 * values are returned.
 *
 * The one place design strength is formed: the slices, the Rankine crack
 * depth and the Ito & Matsui pile pressure all use it.
 */
export function designStrength(
  kind: MaterialModelKind | undefined,
  st: Pick<ResolvedStrength, "cohesion" | "frictionAngle" | "cohesionUndrained" | "isCombined" | "cohesionUndrainedPart">,
  f: PartialFactors | null | undefined,
): DesignStrength {
  const undrained =
    kind === "undrained" ||
    kind === "s-f-depth" ||
    kind === "s-f-datum" ||
    (st.frictionAngle === 0 && !st.isCombined);
  const tanPhi = undrained ? 0 : Math.tan((st.frictionAngle * Math.PI) / 180);
  if (!f || kind === "high-strength" || kind === "impenetrable") {
    return { cohesion: st.cohesion, tanPhi, cohesionUndrained: st.cohesionUndrained, undrained };
  }
  const cohesionUndrained = st.cohesionUndrained / f.cu;
  if (undrained) return { cohesion: st.cohesion / f.cu, tanPhi, cohesionUndrained, undrained };
  const part = Math.min(st.cohesion, st.cohesionUndrainedPart ?? 0);
  return {
    cohesion: part / f.cu + (st.cohesion - part) / f.cohesion,
    tanPhi: tanPhi / f.tanPhi,
    cohesionUndrained,
    undrained,
  };
}

/**
 * Unit weight at a point (kN/m³).
 *
 * Only the spatial Mohr-Coulomb model varies γ: it is interpolated from
 * the data points that give a positive γ, the same way as c and φ.
 * Every other model (and a spatial model without γ data) uses
 * `fallback`, the material's own unit weight.
 */
export function resolveUnitWeight(
  model: MaterialModel,
  fallback: number,
  x: number,
  y: number,
): number {
  if (model.kind !== "spatial-mohr-coulomb") return fallback;
  const points: SpatialDataPoint[] = model.dataPoints
    .filter(([, , , , gamma]) => Number.isFinite(gamma) && gamma > 0)
    .map(([px, py, , , gamma]) => ({ x: px, y: py, values: [gamma] }));
  if (points.length === 0) return fallback;
  const method = model.interpolation ?? "idw";
  const [gamma] =
    method === "nearest"
      ? interpolateNearest(points, x, y)
      : interpolateIDW(points, x, y, method === "linear" ? 1 : 2);
  return gamma;
}

function resolveSpatialMohrCoulomb(
  model: Extract<MaterialModel, { kind: "spatial-mohr-coulomb" }>,
  context: StrengthContext,
): ResolvedStrength {
  if (model.dataPoints.length === 0) {
    return { cohesion: 0, frictionAngle: 0, cohesionUndrained: 0 };
  }

  // Convert tuples to SpatialDataPoint format: values = [c, φ]
  const points: SpatialDataPoint[] = model.dataPoints.map(([x, y, c, phi]) => ({
    x,
    y,
    values: [c, phi],
  }));

  const method = model.interpolation ?? "idw";
  let result: number[];

  switch (method) {
    case "nearest":
      result = interpolateNearest(points, context.x, context.yBottom);
      break;
    case "idw":
    case "linear":
      // Both "idw" and "linear" use IDW; linear is treated as IDW(p=1).
      result = interpolateIDW(
        points,
        context.x,
        context.yBottom,
        method === "linear" ? 1 : 2,
      );
      break;
    default: {
      // Exhaustiveness guard
      method satisfies never;
      result = interpolateIDW(points, context.x, context.yBottom);
      break;
    }
  }

  const [c, phi] = result;
  return {
    cohesion: nonNegative(c),
    frictionAngle: physicalFrictionAngle(phi),
    cohesionUndrained: nonNegative(c),
  };
}

function resolveAnisotropic(
  model: Extract<MaterialModel, { kind: "anisotropic-function" }>,
  context: StrengthContext,
): ResolvedStrength {
  const alphaDeg = (context.alpha * 180) / Math.PI;
  const factor = interpolateModifier(model.modifierFunction, alphaDeg);

  return {
    cohesion: nonNegative(model.cohesion * factor),
    frictionAngle: physicalFrictionAngle(model.frictionAngle * factor),
    cohesionUndrained: nonNegative(model.cohesion * factor),
  };
}

function resolveStrengthFromDepth(
  model: Extract<MaterialModel, { kind: "s-f-depth" }>,
  context: StrengthContext,
): ResolvedStrength {
  const yTop =
    model.depthReference === "layer-top"
      ? (context.yLayerTop ?? context.yGround)
      : context.yGround;
  const depth = yTop - context.yBottom;
  const su = applyCutoff(
    nonNegative(model.suRef + (depth - model.depthRef) * model.rate),
    model.rate,
    model.suMax,
  );

  return {
    cohesion: su,
    frictionAngle: 0,
    cohesionUndrained: su,
  };
}

function resolveStrengthFromDatum(
  model: Extract<MaterialModel, { kind: "s-f-datum" }>,
  context: StrengthContext,
): ResolvedStrength {
  const su = applyCutoff(
    nonNegative(model.suRef + (model.yRef - context.yBottom) * model.rate),
    model.rate,
    model.suMax,
  );

  return {
    cohesion: su,
    frictionAngle: 0,
    cohesionUndrained: su,
  };
}

// ── Helpers ────────────────────────────────────────────────────

/**
 * Linearly varying strength can extrapolate below zero far from its
 * reference level; negative shear strength is not physical and would
 * produce a meaningless (near-zero) factor of safety.
 */
function nonNegative(value: number): number {
  return value > 0 ? value : 0;
}

/**
 * Strength cutoff (an upper or lower limit on Su). Every rate here is
 * positive where strength increases with depth; then (and for a constant
 * strength) the cutoff is a maximum, for a negative rate a minimum. A cutoff
 * that is not a positive number (rejected by validation) is ignored.
 */
function applyCutoff(su: number, rate: number, suMax: number | undefined): number {
  if (suMax === undefined || !Number.isFinite(suMax) || suMax <= 0) return su;
  return rate < 0 ? Math.max(su, suMax) : Math.min(su, suMax);
}

/** Highest friction angle used (tan φ must stay finite and positive). */
const MAX_FRICTION_ANGLE = 89.9;

/**
 * A modifier or interpolation can produce φ ≥ 90°, where tan φ becomes
 * huge or negative and the FOS meaningless; keep φ in [0°, 89.9°].
 */
function physicalFrictionAngle(phi: number): number {
  if (!(phi > 0)) return 0;
  return Math.min(phi, MAX_FRICTION_ANGLE);
}

/**
 * Linearly interpolate a 1-D function defined by sorted (x, y) pairs.
 * Clamps to the nearest endpoint outside the data range.
 */
export function interpolateFunction(
  points: [number, number][],
  x: number,
): number {
  if (points.length === 0) return 0;
  if (points.length === 1) return points[0][1];

  // Ensure sorted by x
  const sorted = [...points].sort((a, b) => a[0] - b[0]);

  if (x <= sorted[0][0]) return sorted[0][1];
  if (x >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];

  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }

  return sorted[sorted.length - 1][1];
}

/**
 * Interpolate the anisotropic modifier from (α_deg, factor) pairs.
 */
function interpolateModifier(
  modifierFunction: [number, number][],
  alphaDeg: number,
): number {
  if (modifierFunction.length === 0) return 1;
  return interpolateFunction(modifierFunction, alphaDeg);
}
