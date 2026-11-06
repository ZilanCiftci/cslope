/**
 * A posteriori error estimation and mesh refinement.
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/adapt.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import { testCall } from "../facade/internal";
import type { FeModel } from "./model";
import { modelHandle, sizeFieldOf, type SizeFieldFn } from "../facade/fem/_handles";

/** Squared error indicator per element from Gauss point stresses (4 per point). */
export function zzIndicator(model: FeModel, stress: Float64Array): Float64Array {
  return testCall("fem/adapt::zzIndicator", [modelHandle(model), stress]);
}

/** Dörfler marking: the elements with the largest indicators that carry a fraction θ of the total. */
export function dorflerMark(eta2: Float64Array, theta = 0.5): Uint8Array {
  return testCall("fem/adapt::dorflerMark", [eta2, theta]);
}

/** The refined size field: the engine's data behind a function with `min` (fem/_handles.ts). */
export function refinedSizeField(model: FeModel, marked: Uint8Array, minSize = 0): SizeFieldFn & { min: number } {
  return sizeFieldOf(testCall<number>("fem/adapt::refinedSizeField", [modelHandle(model), marked, minSize])) as SizeFieldFn & { min: number };
}
