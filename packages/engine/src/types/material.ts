/**
 * Material type definitions for slope stability analysis.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { wasm } from "../facade/internal";
import { registerMaterial } from "../facade/materials";
import type { MaterialModel } from "./material-models";
import type { ResolvedStrength, StrengthContext } from "./strength";

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

/**
 * A material: a plain data object, its identity the JavaScript object (as
 * in TypeScript). The engine normalises the parameters and throws the
 * constructor's RangeErrors. A given `model` is kept as the same object.
 */
export class Material {
  readonly name: string;
  readonly color: string;
  /** The material: unit weight and strength (see `resolveStrength`). */
  readonly model: MaterialModel;
  /** @internal Unique per instance: how the engine refers back to this object. */
  declare readonly _key: number;

  constructor(params: MaterialParams = {}) {
    const m = wasm().material_new(params) as { name: string; color: string; model: MaterialModel };
    this.name = m.name;
    this.color = m.color;
    this.model = params.model ?? m.model;
    Object.defineProperty(this, "_key", { value: registerMaterial(this), enumerable: false });
  }

  /** Unit weight (kN/m³): the model's. */
  get unitWeight(): number {
    return this.model.unitWeight;
  }

  /** The strength at a point (see `resolveStrength`). */
  getStrength(context: StrengthContext): ResolvedStrength {
    return wasm().resolve_strength(this.model, context);
  }
}
