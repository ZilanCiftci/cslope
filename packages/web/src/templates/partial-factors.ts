/**
 * Partial factors in Swedish practice, as the engine forms them
 * (`swedishPartialFactors`), computed here so that a template needs no
 * running engine; a test keeps them equal to the engine's. With partial
 * factors F is an over-design factor on design values, not a factor of
 * safety.
 */
import type { PartialFactors, SafetyClass, SwedishFactorBasis } from "@cslope/engine";

/** Partial factor γd on the load effects in safety class 1, 2 and 3 (EKS). */
export const SAFETY_CLASS_GAMMA_D: Record<SafetyClass, number> = { 1: 0.83, 2: 0.91, 3: 1.0 };

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * γcu = 1.5 / ηcu, γc′ = γφ′ = 1.3 / ηdrained and γQ = variableLoadBase · γd,
 * each rounded to three decimals as the engine does. Every value is an
 * engineering decision for the slope at hand, never a default.
 */
export function swedishPartialFactors(basis: SwedishFactorBasis): PartialFactors {
  const gd = SAFETY_CLASS_GAMMA_D[basis.safetyClass];
  if (gd === undefined) throw new Error("Safety class must be 1, 2 or 3");
  for (const [k, v] of Object.entries({ etaCu: basis.etaCu, etaDrained: basis.etaDrained, variableLoadBase: basis.variableLoadBase })) {
    if (!(Number.isFinite(v) && v > 0)) throw new Error(`${k} must be a positive number`);
  }
  return {
    cu: r3(1.5 / basis.etaCu),
    cohesion: r3(1.3 / basis.etaDrained),
    tanPhi: r3(1.3 / basis.etaDrained),
    variableLoad: r3(basis.variableLoadBase * gd),
    basis: { ...basis },
  };
}
