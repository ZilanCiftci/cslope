/**
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts): the accelerator lives in the engine.
 */
import { engineEpoch } from "../engine";
import { testCall } from "../facade/internal";

const finalizer = new FinalizationRegistry<{ handle: number; epoch: number }>((h) => {
  if (h.epoch === engineEpoch()) testCall("fem/anderson::$free", [h.handle]);
});

/**
 * Anderson acceleration of a fixed-point iteration x ← G(x) (Anderson 1965,
 * J. ACM 12(4), 547–560; Walker & Ni 2011, SIAM J. Numer. Anal. 49(4),
 * 1715–1735, "Type II" with the residual f = G(x) − x): the next iterate
 * is G(x_k) − Σ γ_j ΔG_j, with γ minimising ‖f_k − Σ γ_j Δf_j‖ over the
 * last m differences.
 *
 * Implementation choices (not from the literature): the least squares
 * problem by its normal equations with a relative Tikhonov term of 10⁻¹⁰
 * on the trace, the Gram matrix of the differences kept and updated by one
 * row per iteration; the residual may be measured on a part of the vector
 * (`residualStart`): the viscoplastic iteration mixes its plastic strains
 * and body loads with the same coefficients and measures the residual on
 * the body loads (forces, one unit).
 */
export class Anderson {
  private readonly h: { handle: number; epoch: number };

  constructor(n: number, m: number, residualStart = 0) {
    this.h = { handle: testCall<number>("fem/anderson::$new", [n, m, residualStart]), epoch: engineEpoch() };
    finalizer.register(this, this.h);
  }

  /** Forget the history (e.g. after the problem changed). */
  reset(): void {
    testCall("fem/anderson::$reset", [this.h.handle]);
  }

  /** One step: `x` the iterate that went in, `g` = G(x) that came out; `g` is overwritten by the accelerated next iterate. */
  step(x: Float64Array, g: Float64Array): void {
    g.set(testCall<Float64Array>("fem/anderson::$step", [this.h.handle, x, g]));
  }
}
