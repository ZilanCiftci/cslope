/** Facade shim of types/material.ts (see facade/internal.ts). */
import { wasm } from "../internal";
import type { MaterialModel } from "../../types/material-models";
import type { MaterialParams } from "../../types/material";
import type { ResolvedStrength, StrengthContext } from "../../types/strength";

export { MATERIAL_EPSILON } from "../../types/material";

let nextKey = 1;

/**
 * A material: a plain data object, its identity the JavaScript object (as
 * in TypeScript). The engine normalises the parameters and throws the
 * constructor's RangeErrors. A given `model` is kept as the same object.
 */
export class Material {
  readonly name: string;
  readonly color: string;
  readonly model: MaterialModel;
  /** @internal Unique per instance: how the engine refers back to this object. */
  declare readonly _key: number;

  constructor(params: MaterialParams = {}) {
    const m = wasm().material_new(params) as { name: string; color: string; model: MaterialModel };
    this.name = m.name;
    this.color = m.color;
    this.model = params.model ?? m.model;
    Object.defineProperty(this, "_key", { value: nextKey++, enumerable: false });
  }

  get unitWeight(): number {
    return this.model.unitWeight;
  }

  getStrength(context: StrengthContext): ResolvedStrength {
    return wasm().resolve_strength(this.model, context);
  }
}
