/**
 * Build a Slope model from a serialized SlopeDefinition DTO.
 *
 * Used by the Web Worker to reconstruct the model from UI data,
 * and also available for testing without worker context.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import type { SlopeDefinition } from "../types/slope-definition";
import { type Slope as TsSlope, Slope } from "./slope";
import { wasm } from "../facade/internal";

/**
 * Reconstruct a Slope model from a serialized SlopeDefinition DTO.
 */
export function buildSlope(def: SlopeDefinition): TsSlope {
  return Slope._wrap(wasm().build_slope(def) as number) as unknown as TsSlope;
}
