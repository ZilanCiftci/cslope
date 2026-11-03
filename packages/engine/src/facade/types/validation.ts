/** Facade shim of types/validation.ts (see facade/internal.ts). */
import { wasm } from "../internal";
import type { MaterialModel } from "../../types/material-models";

export function validateMaterialModel(model: MaterialModel): string[] {
  return wasm().validate_material_model(model);
}
