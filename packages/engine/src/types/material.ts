/**
 * Material type definitions for slope stability analysis.
 */

import type { MaterialModel, MohrCoulombModel } from "./material-models";
import { resolveStrength } from "./strength";
import type { StrengthContext } from "./strength";

/**
 * Supported material constitutive models.
 *
 * @deprecated Prefer `MaterialModelKind` from `material-models.ts`.
 *   Kept for backward compatibility with existing code that checks
 *   `materialType === "Combined"`.
 */
export type MaterialType = "Mohr-Coulomb" | "Combined";

/** Geological material unit properties. */
export interface MaterialParams {
  /** Material unit weight in kN/m³ (default: 20). */
  unitWeight?: number;
  /** Friction angle in degrees (default: 35). */
  frictionAngle?: number;
  /** Cohesion in kPa (default: 2). */
  cohesion?: number;
  /** Reference depth for cohesion variation (default: 0). */
  cohesionRefDepth?: number;
  /** Rate of cohesion change with depth (default: 0). */
  cohesionRateOfChange?: number;
  /** Undrained cohesion in kPa (default: 20). */
  cohesionUndrained?: number;
  /** Material name. */
  name?: string;
  /** Display color (hex or CSS name). */
  color?: string;
  /** Constitutive model type. */
  materialType?: MaterialType;
  /** Combined-method c-factor (default: 0). */
  cFactor?: number;
  /**
   * Full material model descriptor.
   * When provided, takes precedence over the flat parameter fields.
   * If omitted, a `MohrCoulombModel` is synthesised from the flat fields.
   */
  model?: MaterialModel;
}

/** Small tolerance for floating-point comparisons. */
export const MATERIAL_EPSILON = 1e-10;

export class Material {
  readonly unitWeight: number;
  readonly frictionAngle: number;
  readonly cohesion: number;
  readonly cohesionRefDepth: number;
  readonly cohesionRateOfChange: number;
  readonly cohesionUndrained: number;
  readonly name: string;
  readonly color: string;
  readonly materialType: MaterialType;
  readonly cFactor: number;

  /**
   * The canonical material model descriptor.
   *
   * This is the source of truth for strength resolution.  Legacy
   * properties (`cohesion`, `frictionAngle`, etc.) are kept in sync
   * for backward-compatible reads but new code should prefer
   * `resolveStrength(material.model, context)`.
   */
  readonly model: MaterialModel;

  constructor(params: MaterialParams = {}) {
    this.unitWeight = params.unitWeight ?? 20;
    this.frictionAngle = params.frictionAngle ?? 35;
    this.cohesion = Math.abs(params.cohesion ?? 2);
    this.cohesionRefDepth = params.cohesionRefDepth ?? 0;
    this.cohesionRateOfChange = params.cohesionRateOfChange ?? 0;
    this.cohesionUndrained = params.cohesionUndrained ?? 20;
    this.name = params.name ?? "";
    this.color = params.color ?? "";
    this.cFactor = params.cFactor ?? 0;

    const mt = params.materialType;
    this.materialType =
      mt === "Mohr-Coulomb" || mt === "Combined" ? mt : "Mohr-Coulomb";

    // Build the canonical MaterialModel from legacy params.
    // If a `model` was supplied directly, use it instead.
    if (params.model) {
      this.model = params.model;
    } else {
      this.model = Material.buildModelFromParams(params, this);
    }

    // Validation
    if (this.unitWeight < 0 || this.unitWeight > 500) {
      throw new RangeError("unit weight must be between 0 and 500");
    }
    if (this.frictionAngle < 0 || this.frictionAngle > 90) {
      throw new RangeError("friction_angle must be between 0 and 90");
    }
  }

  /**
   * Effective cohesion at a given depth (m).
   *
   * @deprecated Use `resolveStrength(material.model, context)` instead.
   */
  getCohesion(depth: number = 0): number {
    const result = resolveStrength(this.model, {
      yBottom: depth,
      x: 0,
      yGround: 0,
      alpha: 0,
    });
    return result.cohesion;
  }

  /**
   * Undrained cohesion at a given depth (m).
   *
   * @deprecated Use `resolveStrength(material.model, context)` instead.
   */
  getCohesionUndrained(depth: number = 0): number {
    const result = resolveStrength(this.model, {
      yBottom: depth,
      x: 0,
      yGround: 0,
      alpha: 0,
    });
    return result.cohesionUndrained;
  }

  /**
   * Resolve the effective strength at a given context.
   * Convenience wrapper around the free `resolveStrength()` function.
   */
  getStrength(context: StrengthContext) {
    return resolveStrength(this.model, context);
  }

  // ── Internal helpers ──────────────────────────────────────────

  /** Build a `MohrCoulombModel` from legacy `MaterialParams`. */
  private static buildModelFromParams(
    _params: MaterialParams,
    resolved: {
      unitWeight: number;
      frictionAngle: number;
      cohesion: number;
      cohesionRefDepth: number;
      cohesionRateOfChange: number;
      cohesionUndrained: number;
      name: string;
      color: string;
      cFactor: number;
    },
  ): MohrCoulombModel {
    return {
      kind: "mohr-coulomb",
      unitWeight: resolved.unitWeight,
      frictionAngle: resolved.frictionAngle,
      cohesion: resolved.cohesion,
      cohesionRefDepth: resolved.cohesionRefDepth,
      cohesionRateOfChange: resolved.cohesionRateOfChange,
      cohesionUndrained: resolved.cohesionUndrained,
      cFactor: resolved.cFactor,
      name: resolved.name || undefined,
      color: resolved.color || undefined,
    };
  }
}
