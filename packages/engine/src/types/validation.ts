/**
 * Material model validation.
 *
 * Returns an array of human-readable error strings.  An empty array
 * means the model is valid.  This is the single source of truth for
 * model validation — used by both the engine (`buildSlope()`) and the
 * desktop UI (inline error display).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { wasm } from "../facade/internal";
import type { MaterialModel } from "./material-models";

/**
 * Validate a `MaterialModel` and return any errors found.
 *
 * @returns An array of human-readable error messages.  Empty = valid.
 */
export function validateMaterialModel(model: MaterialModel): string[] {
  return wasm().validate_material_model(model);
}
