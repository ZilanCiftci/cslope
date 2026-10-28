/**
 * Equilibrium at one strength reduction factor by the constant stiffness
 * method with implicit stress return, accelerated by BFGS updates.
 *
 * Method and sources:
 * - Constant (elastic) stiffness iteration with an implicit return of the
 *   stresses to the yield surface at every iteration: the modified initial
 *   strain method of Vermeer (1979, Proc. 3rd Int. Conf. Num. Meth.
 *   Geomech., 377–387). For associated plasticity it converges also for
 *   large load increments (Vermeer & van Langen 1989, Ingenieur-Archiv 59,
 *   221–236), so that a trial that does not converge is beyond collapse.
 *   The elastic stiffness is factorised once per mesh (model.K).
 * - Acceleration: BFGS quasi-Newton updates of the inverse stiffness, with
 *   the elastic stiffness as the initial matrix (Matthies & Strang 1979,
 *   IJNME 14(11), 1613–1626), applied by the two-loop recursion of the
 *   limited-memory form (Nocedal 1980, Math. Comput. 35(151), 773–782),
 *   and the initial matrix scaled by γ = sᵀy / yᵀK⁻¹y at every iteration
 *   (Nocedal & Wright 2006, eq. 7.20, in the elastic energy norm).
 *   Pairs whose curvature sᵀy is not positive are skipped, which keeps the
 *   update positive definite (Nocedal & Wright, Numerical Optimization,
 *   2nd ed., 2006, ch. 6).
 * - Line search on the energy, as Matthies & Strang (1979): along the
 *   direction d the residual component g(α) = dᵀr(u + αd) is brought to
 *   at most half of g(0) by secant steps (STOL = 0.5).
 * - The stress return is the closest-point return of newton.ts (Clausen,
 *   Damkilde & Andersen 2006).
 *
 * Implementation choices (not from the literature): convergence at a
 * residual of `tolerance` (default 10⁻⁴) of the load; 50 stored pairs; at
 * most 2000 iterations; failure when the residual has not fallen by 10 %
 * over 200 iterations; at most 8 line search steps and a step of at most 8.
 * Near collapse the iterations grow steeply (V056: 654 at F = 0.50, 1495 at
 * 0.51, against Newton's 21), so the solver is an option, not the default.
 */

import type { FeModel } from "./model";
import { evaluate, norm2, type GaussStrength, type NewtonState } from "./newton";
import { barInternal } from "./bars";

export interface BfgsOptions {
  /** Relative residual tolerance ‖r‖/‖f‖; default 1e-4. */
  tolerance?: number;
  /** Iterations per trial; default 2000. */
  maxIterations?: number;
  tensionCutoff?: boolean;
}

/** Stored BFGS pairs. */
const MEMORY = 50;
/** Iterations over which the residual must fall by 10 %. */
const STALL_WINDOW = 200;
/** Line search: |g(α)| ≤ LS_TOL·g(0) (Matthies & Strang's STOL = 0.5), at most LS_STEPS steps, α ≤ MAX_STEP. */
const LS_TOL = 0.5;
const LS_STEPS = 8;
const MAX_STEP = 8;

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * BFGS iterations at one F from `state` (updated in place on convergence).
 * @returns whether equilibrium was reached and how many iterations it took.
 */
export function bfgsAtF(
  model: FeModel,
  eqs: Int32Array,
  strength: GaussStrength,
  state: NewtonState,
  options: BfgsOptions = {},
): { converged: boolean; iterations: number } {
  const tol = options.tolerance ?? 1e-4;
  const limit = options.maxIterations ?? 2000;
  const cutoff = options.tensionCutoff ?? false;
  const neq = model.eqCount, ngp = 3 * model.elementCount;
  const fnorm = norm2(model.f);
  const u = state.u.slice();
  const fint = new Float64Array(neq), r = new Float64Array(neq);
  const stress = new Float64Array(4 * ngp), ep = new Float64Array(4 * ngp);
  const barEp = new Float64Array(state.barEp.length);
  const trialU = new Float64Array(neq), d = new Float64Array(neq), rOld = new Float64Array(neq);
  const residual = (uu: Float64Array): number => {
    evaluate(model, eqs, uu, state.ep, strength, cutoff, fint, stress, ep, null);
    if (model.bars.count) barInternal(model, uu, state.barEp, state.F, fint, barEp, null);
    for (let i = 0; i < neq; i++) r[i] = model.f[i] - fint[i];
    return norm2(r);
  };
  // L-BFGS pairs: s = Δu, y = r_old − r_new (the change of the gradient −r).
  const S: Float64Array[] = [], Y: Float64Array[] = [], rho: number[] = [];
  const alphaK = new Float64Array(MEMORY);
  const Ky = new Float64Array(neq), sNew = new Float64Array(neq), yNew = new Float64Array(neq);
  // Initial matrix H0 = γ K⁻¹ with γ = sᵀy / yᵀK⁻¹y of the latest pair: the
  // scaling of Nocedal & Wright (2006, eq. 7.20) in the variables K^½ u in
  // which the elastic stiffness is the identity. Near collapse the secant
  // stiffness is far below the elastic one and γ ≫ 1.
  let gamma = 1;
  const direction = () => {
    d.set(r);
    for (let k = S.length - 1; k >= 0; k--) {
      alphaK[k] = rho[k] * dot(S[k], d);
      for (let i = 0; i < neq; i++) d[i] -= alphaK[k] * Y[k][i];
    }
    model.K.solve(d);
    if (gamma !== 1) for (let i = 0; i < neq; i++) d[i] *= gamma;
    for (let k = 0; k < S.length; k++) {
      const beta = rho[k] * dot(Y[k], d);
      for (let i = 0; i < neq; i++) d[i] += (alphaK[k] - beta) * S[k][i];
    }
  };
  let rn = residual(u);
  const history: number[] = [];
  for (let it = 1; it <= limit; it++) {
    if (rn <= tol * fnorm) {
      state.u.set(u); state.ep.set(ep); state.stress.set(stress); state.barEp.set(barEp);
      return { converged: true, iterations: it - 1 };
    }
    history.push(rn);
    if (it > STALL_WINDOW && rn > 0.9 * history[it - 1 - STALL_WINDOW]) return { converged: false, iterations: it };
    direction();
    rOld.set(r);
    // Line search on the energy (Matthies & Strang 1979): the residual
    // along the direction, g(α) = dᵀr(u + αd), is reduced to half of g(0)
    // in magnitude by secant (regula falsi) steps.
    const g0 = dot(d, rOld);
    const at = (a: number): number => {
      for (let i = 0; i < neq; i++) trialU[i] = u[i] + a * d[i];
      return residual(trialU);
    };
    let alpha = 1;
    let rt = at(alpha);
    let g = dot(d, r);
    if (g0 > 0 && Math.abs(g) > LS_TOL * g0) {
      let aLo = 0, gLo = g0, aHi = alpha, gHi = g;
      for (let ls = 0; ls < LS_STEPS && Math.abs(g) > LS_TOL * g0; ls++) {
        if (gHi > 0) {
          // still descending at the trial: extend the step
          aLo = aHi; gLo = gHi;
          aHi = Math.min(MAX_STEP, 2 * aHi);
          alpha = aHi;
        } else alpha = aLo - (gLo * (aHi - aLo)) / (gHi - gLo);
        rt = at(alpha);
        g = dot(d, r);
        if (g > 0) { aLo = alpha; gLo = g; } else { aHi = alpha; gHi = g; }
        if (aHi === MAX_STEP && gHi > 0) break;
      }
    }
    for (let i = 0; i < neq; i++) { sNew[i] = trialU[i] - u[i]; yNew[i] = rOld[i] - r[i]; }
    u.set(trialU);
    rn = rt;
    const sy = dot(sNew, yNew);
    if (sy > 1e-12 * norm2(sNew) * norm2(yNew)) {
      // Once the memory is full the oldest pair's arrays are reused.
      const full = S.length === MEMORY;
      const s = full ? S.shift()! : new Float64Array(neq), y = full ? Y.shift()! : new Float64Array(neq);
      if (full) rho.shift();
      s.set(sNew); y.set(yNew);
      S.push(s); Y.push(y); rho.push(1 / sy);
      Ky.set(y);
      model.K.solve(Ky);
      const yKy = dot(y, Ky);
      if (yKy > 0) gamma = sy / yKy;
    }
  }
  if (rn <= tol * fnorm) {
    state.u.set(u); state.ep.set(ep); state.stress.set(stress); state.barEp.set(barEp);
    return { converged: true, iterations: limit };
  }
  return { converged: false, iterations: limit };
}
