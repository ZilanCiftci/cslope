/**
 * Data shared by the lower and upper bound limit analyses (lower-bound.ts,
 * upper-bound.ts): the strength, pore pressure and unit weight of the
 * strength reduction model (model.ts) at points of a limit analysis mesh,
 * and the line loads spread over the ground surface.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { testCall } from "../facade/internal";

/** Centroids of the 16 sub-triangles of a 4 × 4 subdivision, in area coordinates (r, s). */
export const WEIGHT_POINTS: [number, number][] = [];
for (let i = 0; i < 4; i++) {
  for (let j = 0; i + j < 4; j++) {
    WEIGHT_POINTS.push([(i + 1 / 3) / 4, (j + 1 / 3) / 4]);
    if (i + j < 3) WEIGHT_POINTS.push([(i + 2 / 3) / 4, (j + 2 / 3) / 4]);
  }
}

/**
 * The strength at a reduction F: c/F and tan φ/F (associated flow in the
 * reduced material), or with "davis-b" both divided by Davis B's
 * q_B(F, φ, ψ) instead (srm.ts; Davis 1968, as modified for strength
 * reduction by Tschuchnigg, Schweiger & Sloan 2015): the associated
 * material that stands for flow with the dilation angle ψ. φ, ψ in
 * radians; φ = 0 (undrained) gives c/F either way.
 */
export function reducedStrength(c: number, phi: number, psi: number, F: number, rule: "associated" | "davis-b" = "associated"): { c: number; phi: number } {
  return testCall("fem/limit-common::reducedStrength", [c, phi, psi, F, rule]);
}
