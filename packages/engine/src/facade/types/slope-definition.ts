/** Facade shim of types/slope-definition.ts (see facade/internal.ts). */
import { shareUnchanged, wasm } from "../internal";
import type { MaterialModel } from "../../types/material-models";
import type { SlopeMaterialDefinition } from "../../types/slope-definition";

export function materialModelOf(m: SlopeMaterialDefinition): MaterialModel {
  // TypeScript returns the given model itself
  return m.model ?? wasm().material_model_of(m);
}

export function withMaterialModel(m: SlopeMaterialDefinition): SlopeMaterialDefinition {
  return shareUnchanged(m, wasm().with_material_model(m));
}
