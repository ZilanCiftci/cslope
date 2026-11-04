/**
 * Transfer of a converged state to a refined mesh of the same slope, as the
 * starting state of the strength reduction there (analysis.ts).
 *
 * The displacements are interpolated at the new nodes with the old
 * element's quadratic shape functions; the plastic strains and stresses of
 * a new Gauss point are those of the nearest Gauss point of the old element
 * that contains it (Peric, Hochard, Dutko & Owen 1996, Comput. Methods Appl.
 * Mech. Eng. 137, 331–344, transfer of the internal variables by the
 * Gauss points). The state is not in equilibrium on the new mesh: it only
 * starts the iteration, and each trial is decided there as before.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and fem/_handles.ts).
 */
import { testCall } from "../facade/internal";
import type { FeModel } from "./model";
import type { SrmState } from "./srm";
import { modelHandle } from "../facade/fem/_handles";

/** The converged `state` of `from` as a starting state on the mesh of `to`; null where a point of `to` lies outside `from`. */
export function transferState(from: FeModel, state: SrmState, to: FeModel): SrmState | null {
  return testCall("fem/transfer::transferState", [modelHandle(from), state, modelHandle(to)]);
}
