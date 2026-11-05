/**
 * A posteriori error estimation and mesh refinement.
 *
 * Method and sources:
 * - Error indicator of Zienkiewicz & Zhu (1987, IJNME 24(2), 337–357): the
 *   finite element stresses are compared with a recovered, continuous
 *   stress field σ*, here the area-weighted nodal average of the element
 *   stresses interpolated linearly over each element, and
 *   η_e² = ∫_e (σ* − σ_h)ᵀ C (σ* − σ_h) dA with C the elastic compliance.
 * - Dissipation indicator (the default in analysis.ts): the plastic
 *   dissipation per element, after the dissipation-based adaptivity of
 *   finite element limit analysis (Lyamin, Sloan, Krabbenhøft & Hjiaj
 *   2005, IJNME 63(14), 1961–1974; Ciria, Peraire & Bonet 2008, IJNME
 *   75(8), 899–944).
 * - Marking by Dörfler's bulk criterion (Dörfler 1996, SIAM J. Numer.
 *   Anal. 33(3), 1106–1124): the smallest set of elements whose indicators
 *   sum to a fraction θ of the total.
 *
 * Implementation choices (not from the literature): C approximated by
 * 1/E; the dissipation taken from the accumulated viscoplastic strain at
 * the factor of safety (the limit analysis papers use the dissipation of
 * the collapse mechanism); marked elements get half their size in the
 * next mesh, through a size field on the old mesh; θ = 0.3 in analysis.ts.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and fem/_handles.ts).
 */
import { testCall } from "../facade/internal";
import type { FeModel } from "./model";
import { modelHandle, sizeFieldOf, type SizeFieldFn } from "../facade/fem/_handles";

/** Squared error indicator per element from Gauss point stresses (4 per point). */
export function zzIndicator(model: FeModel, stress: Float64Array): Float64Array {
  return testCall("fem/adapt::zzIndicator", [modelHandle(model), stress]);
}

/**
 * Plastic dissipation per element, ∫_e |σ : ε_vp| dA, from the stresses and
 * accumulated viscoplastic strains at the factor of safety. It concentrates
 * in the failure mechanism, which is where the factor of safety is decided
 * (see the sources in the file header).
 */
export function dissipationIndicator(model: FeModel, stress: Float64Array, evp: Float64Array): Float64Array {
  return testCall("fem/adapt::dissipationIndicator", [modelHandle(model), stress, evp]);
}

/** Dörfler marking: the elements with the largest indicators that carry a fraction θ of the total. */
export function dorflerMark(eta2: Float64Array, theta = 0.5): Uint8Array {
  return testCall("fem/adapt::dorflerMark", [eta2, theta]);
}

/** The refined size field: the engine's data behind a function with `min` (fem/_handles.ts). */
export function refinedSizeField(model: FeModel, marked: Uint8Array, minSize = 0): SizeFieldFn & { min: number } {
  return sizeFieldOf(testCall<number>("fem/adapt::refinedSizeField", [modelHandle(model), marked, minSize])) as SizeFieldFn & { min: number };
}
