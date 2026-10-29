/**
 * Reinforcement bars in the strength reduction.
 *
 * Method: three-node bar (truss) elements, the one-dimensional element of
 * the displacement method (Zienkiewicz, Taylor & Zhu 2013), along element
 * edges and sharing the soil's nodes; elastic–perfectly plastic with the
 * exact one-dimensional return N = min(T, max(0, EA (ε − εp))), relaxed
 * like the soil in the viscoplastic iteration (srm.ts) or with its tangent
 * in Newton's method.
 *
 * Implementation choices (not from the literature), with their reasons:
 * - Perfect bond between bar and soil: slip is represented by the pullout
 *   part of the capacity, not by an interface.
 * - 0 ≤ N ≤ T(s), with T the capacity envelope of cSlope's limit
 *   equilibrium analysis (tensile capacity, pullout from either end, end
 *   anchorage) per metre of slope, so that both analyses use the same
 *   reinforcement; no compression (geosynthetics, and conservatively bars
 *   and nails).
 * - Passive capacity divided by F, as the limit equilibrium solvers do;
 *   `reduceReinforcement` = false reduces only the soil.
 */

import type { FeModel } from "./model";
import { BAR_GP_STRIDE } from "./model";
import type { SparseCholesky } from "./sparse";
import { springCapacity } from "./piles";

function barDofs(model: FeModel, b: number, out: Int32Array): void {
  for (let k = 0; k < 3; k++) {
    const n = model.bars.nodes[3 * b + k];
    out[2 * k] = model.eq[2 * n];
    out[2 * k + 1] = model.eq[2 * n + 1];
  }
}

/** Capacity of a bar Gauss point at reduction F. */
function capacity(model: FeModel, b: number, g: number, F: number): number {
  const { bars } = model, i = 2 * b + g;
  const kind = bars.capKind[i];
  if (kind !== 0) return springCapacity(kind, bars.capC[i], bars.capSv[i], bars.capTan[i], F);
  const c = bars.capacity[i];
  return bars.passive[b] ? c / F : c;
}

/**
 * Viscoplastic step for the bars: returns each Gauss point's force to
 * [0, T] by a plastic strain increment and adds its body load ∫ Bᵀ EA Δεp.
 */
export function relaxBars(model: FeModel, u: Float64Array, barEp: Float64Array, F: number, bodyLoads: Float64Array): void {
  const { bars } = model;
  const d = new Int32Array(6);
  for (let b = 0; b < bars.count; b++) {
    barDofs(model, b, d);
    const ea = bars.stiffness[b];
    for (let g = 0; g < 2; g++) {
      const o = (2 * b + g) * BAR_GP_STRIDE, i = 2 * b + g;
      let eps = 0;
      for (let k = 0; k < 6; k++) if (d[k] >= 0) eps += bars.gp[o + k] * u[d[k]];
      const n = ea * (eps - barEp[i]);
      const t = capacity(model, b, g, F);
      const lo = bars.bothWays[b] ? -t : 0; // a pile spring acts both ways
      const excess = n > t ? n - t : n < lo ? n - lo : 0;
      if (excess === 0) continue;
      barEp[i] += excess / ea;
      const w = bars.gp[o + 6] * excess;
      for (let k = 0; k < 6; k++) if (d[k] >= 0) bodyLoads[d[k]] += bars.gp[o + k] * w;
    }
  }
}

/**
 * Internal forces of the bars (added to `fint`) for Newton, with the new
 * plastic strains in `barEpNew` and, when given, the tangent in `K`.
 */
export function barInternal(
  model: FeModel,
  u: Float64Array,
  barEpOld: Float64Array,
  F: number,
  fint: Float64Array,
  barEpNew: Float64Array,
  K: SparseCholesky | null,
): void {
  const { bars } = model;
  const d = new Int32Array(6);
  for (let b = 0; b < bars.count; b++) {
    barDofs(model, b, d);
    const ea = bars.stiffness[b];
    for (let g = 0; g < 2; g++) {
      const o = (2 * b + g) * BAR_GP_STRIDE, i = 2 * b + g;
      let eps = 0;
      for (let k = 0; k < 6; k++) if (d[k] >= 0) eps += bars.gp[o + k] * u[d[k]];
      const trial = ea * (eps - barEpOld[i]);
      const t = capacity(model, b, g, F);
      const lo = bars.bothWays[b] ? -t : 0; // a pile spring acts both ways
      const n = Math.min(t, Math.max(lo, trial));
      barEpNew[i] = eps - n / ea;
      const w = bars.gp[o + 6];
      for (let k = 0; k < 6; k++) if (d[k] >= 0) fint[d[k]] += bars.gp[o + k] * n * w;
      if (K && trial > lo && trial < t) {
        for (let k = 0; k < 6; k++) {
          if (d[k] < 0) continue;
          for (let j = 0; j <= k; j++) if (d[j] >= 0) K.add(d[k], d[j], ea * w * bars.gp[o + k] * bars.gp[o + j]);
        }
      }
    }
  }
}
