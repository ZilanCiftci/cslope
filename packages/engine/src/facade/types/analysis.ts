/** Facade shim of types/analysis.ts (see facade/internal.ts). */
import { wasm } from "../internal";
import type { PartialFactors, SwedishFactorBasis } from "../../types/analysis";

// Data: kept as TypeScript (read at module load; the consistency test
// compares it with the engine's).
export { DEFAULT_ANALYSIS_OPTIONS, DEFAULT_FEM_SETTINGS, EC7_DA3_FACTORS, SAFETY_CLASS_GAMMA_D } from "../../types/analysis";

export function swedishPartialFactors(basis: SwedishFactorBasis): PartialFactors {
  return wasm().swedish_partial_factors(basis);
}
