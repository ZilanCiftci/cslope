/**
 * Material type definitions for slope stability analysis.
 */

import type { MaterialModel, MohrCoulombModel } from "./material-models";
import { resolveStrength } from "./strength";
import type { StrengthContext } from "./strength";

/**
 * A material: its model, or (for brevity in code and tests) a Mohr-Coulomb
 * model from the flat fields, which are read only when `model` is absent.
 */
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
  /** Combined-method c-factor (default: 0). */
  cFactor?: number;
  /** The material model; the flat fields are ignored when it is given. */
  model?: MaterialModel;
}

/** Small tolerance for floating-point comparisons. */
export const MATERIAL_EPSILON = 1e-10;

export class Material {
  readonly name: string;
  readonly color: string;
  /** The material: unit weight and strength (see `resolveStrength`). */
  readonly model: MaterialModel;

  constructor(params: MaterialParams = {}) {
    this.name = params.name ?? "";
    this.color = params.color ?? "";
    if (params.model) {
      this.model = params.model;
    } else {
      const frictionAngle = params.frictionAngle ?? 35;
      if (frictionAngle < 0 || frictionAngle > 90) {
        throw new RangeError("friction_angle must be between 0 and 90");
      }
      this.model = {
        kind: "mohr-coulomb",
        unitWeight: params.unitWeight ?? 20,
        frictionAngle,
        cohesion: Math.abs(params.cohesion ?? 2),
        cohesionRefDepth: params.cohesionRefDepth ?? 0,
        cohesionRateOfChange: params.cohesionRateOfChange ?? 0,
        cohesionUndrained: params.cohesionUndrained ?? 20,
        cFactor: params.cFactor ?? 0,
      } satisfies MohrCoulombModel;
    }
    if (!(this.model.unitWeight >= 0 && this.model.unitWeight <= 500)) {
      throw new RangeError("unit weight must be between 0 and 500");
    }
  }

  /** Unit weight (kN/m³): the model's. */
  get unitWeight(): number {
    return this.model.unitWeight;
  }

  /** The strength at a point (see `resolveStrength`). */
  getStrength(context: StrengthContext) {
    return resolveStrength(this.model, context);
  }
}
