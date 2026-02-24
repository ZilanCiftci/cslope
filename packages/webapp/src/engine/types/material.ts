/**
 * Material type definitions for slope stability analysis.
 *
 * Mirrors Python: src/pyslope/material.py
 */

/** Supported material constitutive models. */
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

    // Validation (mirrors Python __post_init__)
    if (this.unitWeight < 0 || this.unitWeight > 500) {
      throw new RangeError("unit weight must be between 0 and 500");
    }
    if (this.frictionAngle < 0 || this.frictionAngle > 90) {
      throw new RangeError("friction_angle must be between 0 and 90");
    }
  }

  /** Effective cohesion at a given depth (m). */
  getCohesion(depth: number = 0): number {
    const c =
      this.cohesion +
      (this.cohesionRefDepth - depth) * this.cohesionRateOfChange;
    return this.materialType === "Combined" ? c * this.cFactor : c;
  }

  /** Undrained cohesion at a given depth (m). */
  getCohesionUndrained(depth: number = 0): number {
    return (
      this.cohesion +
      (this.cohesionRefDepth - depth) * this.cohesionRateOfChange
    );
  }
}
