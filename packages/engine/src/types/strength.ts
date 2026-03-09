/**
 * Unified strength resolution for all material models.
 *
 * `resolveStrength` is the SINGLE dispatch point that maps a
 * `MaterialModel` + geometric context → effective c / φ for a slice.
 * Solvers and the slice builder never inspect `model.kind` directly;
 * they only consume the `ResolvedStrength` output.
 */

import type { MaterialModel } from "./material-models";
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
  /** Base inclination angle α (rad). */
  alpha: number;
}

// ── Resolver ───────────────────────────────────────────────────

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
    case "s-f-datum":
      return resolveStrengthFromDatum(model, context);

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
  const cohesion = cFactor !== 0 ? baseCohesion * cFactor : baseCohesion;

  // Undrained cohesion (used by Combined method)
  const cohesionUndrained =
    (model.cohesionUndrained ?? model.cohesion) +
    (refDepth - context.yBottom) * rateOfChange;

  return {
    cohesion,
    frictionAngle: model.frictionAngle,
    cohesionUndrained,
    isCombined: cFactor !== 0,
  };
}

function resolveUndrained(
  model: Extract<MaterialModel, { kind: "undrained" }>,
  context: StrengthContext,
): ResolvedStrength {
  const refDepth = model.suRefDepth ?? 0;
  const rate = model.suRateOfChange ?? 0;
  const su = model.undrainedShearStrength + (refDepth - context.yBottom) * rate;

  return {
    cohesion: su,
    frictionAngle: 0,
    cohesionUndrained: su,
  };
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
    cohesion: c,
    frictionAngle: phi,
    cohesionUndrained: c,
  };
}

function resolveAnisotropic(
  model: Extract<MaterialModel, { kind: "anisotropic-function" }>,
  context: StrengthContext,
): ResolvedStrength {
  const alphaDeg = (context.alpha * 180) / Math.PI;
  const factor = interpolateModifier(model.modifierFunction, alphaDeg);

  return {
    cohesion: model.cohesion * factor,
    frictionAngle: model.frictionAngle * factor,
    cohesionUndrained: model.cohesion * factor,
  };
}

function resolveStrengthFromDepth(
  model: Extract<MaterialModel, { kind: "s-f-depth" }>,
  context: StrengthContext,
): ResolvedStrength {
  const depth = context.yGround - context.yBottom;
  const su = interpolateFunction(model.strengthFunction, depth);

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
  const su = interpolateFunction(model.strengthFunction, context.yBottom);

  return {
    cohesion: su,
    frictionAngle: 0,
    cohesionUndrained: su,
  };
}

// ── Helpers ────────────────────────────────────────────────────

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
