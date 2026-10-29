/**
 * Strength reduction by finite elements (SRFEM).
 *
 * Method and sources:
 * - Strength reduction: c and tan φ divided by F until the slope fails;
 *   F at failure is the factor of safety (Zienkiewicz, Humpheson & Lewis
 *   1975, Géotechnique 25(4), 671–689; Matsui & San 1992, Soils Found.
 *   32(1), 59–70; Griffiths & Lane 1999, Géotechnique 49(3), 387–403).
 * - Viscoplastic algorithm (initial strain method) of Zienkiewicz &
 *   Cormeau (1974, IJNME 8(4), 821–845) as used for slopes by Griffiths &
 *   Lane (1999) and coded in Smith, Griffiths & Margetts (2014, Programming
 *   the Finite Element Method, 5th ed., Wiley, ch. 6): gravity is applied in
 *   one increment, the elastic stiffness is factorised once, and at every
 *   iteration the stress overshoot beyond the yield surface is relaxed by a
 *   viscoplastic strain increment f·∂Q/∂σ·Δt whose body loads enter the
 *   next solution.
 * - Failure: non-convergence within the iteration limit (Griffiths & Lane
 *   1999, 1000 iterations, tolerance on the displacement increment).
 * - Yield: Mohr–Coulomb in principal stresses (tension positive),
 *   f = (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin φ − c cos φ, the normalisation of
 *   Smith & Griffiths; optional Rankine tension cut-off f_t = σ₁ ≤ 0,
 *   relaxed in the same way.
 * - Time step: the explicit update is stable for Δt below 2/a, a = n_fᵀ D n_g
 *   (Cormeau 1975, IJNME 9(1), 109–127; for associated flow this is the
 *   step of Smith & Griffiths, 4(1 + ν)(1 − 2ν)/(E(1 − 2ν + sin²φ))).
 * - Flow rules (Sysala, Hrubešová, Michalec & Tschuchnigg 2021,
 *   arXiv:2101.01005, eq. 2.1 and 4.6–4.8):
 *   "davis-b" (default): c and tan φ divided by
 *   q_B(F) = F(1 − sin ψ_F sin φ_F)/(cos ψ_F cos φ_F), tan φ_F = tan φ/F,
 *   tan ψ_F = tan ψ/F, with associated flow in the reduced material
 *   (Davis 1968; Tschuchnigg, Schweiger & Sloan 2015, Comput. Geotech. 70,
 *   169–177); "non-associated": c/F, tan φ/F, tan ψ/F, flow with ψ_F
 *   (Griffiths & Lane 1999); "associated": c/F, tan φ/F and ψ = φ_F.
 * - Associated flow is solved by Newton's method (newton.ts); a trial fails
 *   when Newton does not reach equilibrium, the criterion of implicit
 *   strength reduction. Non-associated flow can be solved the same way
 *   with the unsymmetric tangent (option), F raised in increments with
 *   cutback since the result depends on the path. (A viscoplastic iteration deciding Newton's failed
 *   trials was tried and removed: its displacement-increment test accepted
 *   creeping states and raised F, e.g. V068 1.161 against 1.132, and its
 *   iteration limit failed slowly converging ones, V056.)
 * - Search: F is bracketed and bisected (Dawson, Roth & Drescher 1999,
 *   Géotechnique 49(6), 835–840). A trial above a converged one starts
 *   from that converged state; with associated flow the limit load does not
 *   depend on the stress path (the uniqueness theorems of limit analysis),
 *   with non-associated flow the bounding theorems do not apply
 *   (Zienkiewicz, Humpheson & Lewis 1975) and it may, so F then rises in
 *   small equal steps as in Griffiths & Lane's incremental reduction.
 *
 * Implementation choices (not from the literature), with their reasons:
 * - Δt = 1/a, half the stability limit: a stress on one yield plane returns
 *   to it in one step, and the corners of the pyramid do not oscillate
 *   (`relaxation` = 1; 2 is the limit).
 * - Iteration limit 1000·√(elements/2500), at least 1000: Griffiths &
 *   Lane's 1000 iterations are for meshes of a few hundred elements, and
 *   plastic flow must cross more elements on a finer mesh. The limit is a
 *   user parameter in every implementation of the non-convergence
 *   criterion, and F depends on it.
 * - A trial that fails from the unloaded state does not bound F from
 *   above; only a failure from a converged state does, a converged trial
 *   overrides failures below it, and the bounding failure is confirmed
 *   from the final converged state (up to three times per search).
 * - Viscoplastic convergence must hold in two successive iterations.
 * - Beyond the apex of the Mohr–Coulomb pyramid σ₁ is relaxed towards the
 *   apex as by the Rankine cut-off (see solveAtF); it does not change the
 *   yield surface, only lets ψ < φ return a stress from beyond the apex.
 */

import { GP_STRIDE } from "./elements";
import { BAR_GP_STRIDE, setHoekBrownStrength, type FeModel } from "./model";
import { evaluate, newtonAtF } from "./newton";
import { bfgsAtF } from "./bfgs";
import { barInternal, relaxBars } from "./bars";
import { beamInternal } from "./piles";

/** Confirmations of the bounding failure per search (see strengthReductionSearch). */
const MAX_CONFIRMATIONS = 3;

/** Iterations over which the contraction ratio is averaged. */
const RATIO_WINDOW = 10;

export type FlowRule = "davis-b" | "non-associated" | "associated";

export interface SrmOptions {
  flowRule?: FlowRule;
  /**
   * "newton" (default for Davis B and associated flow): implicit return and
   * consistent tangent (newton.ts), which decides convergence sharply; with
   * non-associated flow the tangent is unsymmetric (LU, sparse.ts) and F
   * rises in increments from the starting state (`runTrial`).
   * "viscoplastic" (default for non-associated flow): the explicit
   * iteration of Griffiths & Lane. Measured 2026-10-29 on five
   * non-associated cases (V055, V094 and three published benchmark
   * slopes), Newton's F lies within 1.3 % of the viscoplastic one, at 0.7
   * to 8 times its run time (4 times on the median case), so viscoplastic
   * stays the default. "bfgs": quasi-Newton on the elastic stiffness.
   */
  solver?: "newton" | "bfgs" | "viscoplastic";
  /** Rankine tension cut-off at zero effective stress; default false. */
  tensionCutoff?: boolean;
  /**
   * Convergence test: "increment" (default), max|Δu|/max|u| ≤ tolerance as
   * Griffiths & Lane (1999) and Smith & Griffiths (2014); "extrapolated", the
   * estimated distance to the fixed point Δu·r/(1 − r) instead of Δu, which
   * does not accept a slowly creeping state near collapse but needs more
   * iterations, so with the same limit it gives a lower F (V055: 1.31
   * against 1.35); "equilibrium", the increment test and in addition the
   * out-of-balance force of the stresses returned to the yield surface,
   * ‖f − ∫Bᵀσ‖ ≤ `unbalanceTolerance`·‖f‖ (the unbalanced-force criterion
   * of explicit and implicit codes), which does not depend on Δt.
   */
  convergence?: "increment" | "extrapolated" | "equilibrium";
  /** Relative out-of-balance force of the "equilibrium" test; default 1e-3. */
  unbalanceTolerance?: number;
  /** Convergence tolerance; default 1e-4 (viscoplastic), 1e-6 relative residual (Newton). */
  tolerance?: number;
  /** Viscoplastic iteration limit per trial (failure when reached); default 1000 × √(elements/2500), at least 1000. */
  maxIterations?: number;
  /** Newton iteration limit per trial; default 200 (newton.ts). */
  newtonIterations?: number;
  /** Absolute tolerance on F; default 0.005. */
  fTolerance?: number;
  /**
   * Viscoplastic step as a fraction of the stability limit 2/a (see `reduce`):
   * Δt = relaxation / a; default 1 (exact return on a single plane).
   */
  relaxation?: number;
  /** First trial F; default 1. */
  startF?: number;
  /** Relative step while bracketing F; default 0.25, and 0.1 (constant) for non-associated flow. */
  bracketStep?: number;
  /**
   * Expected F (a coarser mesh's): while rising towards it the steps stop
   * at 0.97 × guide and then rise by 0.02 × guide, so that F does not
   * overshoot far and leave failed trials to bisect.
   */
  guide?: number;
  /**
   * Continue an earlier search on the same model: its converged F and state
   * and its smallest failed F; only the bisection remains.
   */
  resume?: { lo: number; hi: number; state: SrmState; hiFrom?: number };
  /**
   * Trials per round (default 1, bisection): with n > 1 the search tries n
   * reductions per round from the same converged state (multisection), which
   * the app runs in parallel. The result depends on n, not on how the
   * trials are run.
   */
  trialsPerRound?: number;
  /** Called after each trial. */
  onTrial?: (trial: SrmTrial) => void;
}

export interface SrmTrial {
  F: number;
  converged: boolean;
  iterations: number;
  /** Solver that decided the trial. */
  solver: "newton" | "bfgs" | "viscoplastic";
  /** F of the converged state the trial started from; 0 for the unloaded state. */
  startF: number;
  /** Largest nodal displacement (m) at the end of the trial. */
  maxDisplacement: number;
}

export interface SrmState {
  /** Displacements per equation. */
  u: Float64Array;
  /** Total viscoplastic strain per Gauss point (εx, εy, γxy, εz). */
  evp: Float64Array;
  /** Body loads of the viscoplastic strains, per equation. */
  bodyLoads: Float64Array;
  /** Effective stresses per Gauss point (σx, σy, τxy, σz). */
  stress: Float64Array;
  /** Plastic axial strain of the reinforcement bars (2 per bar). */
  barEp: Float64Array;
}

export interface SrmResult {
  /** Factor of safety: the largest converged F (non-convergence criterion). */
  factorOfSafety: number;
  /** Smallest F that failed to converge from a converged state below it. */
  failedF: number;
  /** F of the converged state the trial at `failedF` started from. */
  failedFrom: number;
  /**
   * F at the displacement jump (Huang & Jia 2009, Comput. Geotech. 36, 93–101:
   * failure where a characteristic nodal displacement increases suddenly):
   * the largest converged F before the growth rate of the largest
   * displacement exceeds ten times that of the first trials; null when
   * there are too few converged trials. The factor ten is an
   * implementation choice: the source judges the jump from the curve.
   */
  displacementJumpF: number | null;
  trials: SrmTrial[];
  /** State at the factor of safety. */
  state: SrmState;
  /** The converged state before it (lower F), if any: their difference shows the mechanism. */
  previousState: SrmState | null;
  /** Total iterations. */
  iterations: number;
  /** Reason when no factor of safety could be bracketed. */
  warning?: string;
}

interface ReducedStrength {
  c: Float64Array;
  sinPhi: Float64Array;
  cosPhi: Float64Array;
  sinPsi: Float64Array;
  /** Undrained cap cu/F of a combined material (Tresca, ψ = φ = 0); Infinity where there is none. */
  cu: Float64Array;
  dt: Float64Array;
  dtT: Float64Array;
  /** Viscoplastic step on the Tresca cap, Δt = relax/μ (a = n_fᵀ D n_g = μ). */
  dtU: Float64Array;
}

/** Davis B divisor q_B(F) for friction φ and dilation ψ (radians); Sysala et al. 2021 eq. 4.6. */
export function davisB(F: number, phi: number, psi: number): number {
  const phiF = Math.atan(Math.tan(phi) / F), psiF = Math.atan(Math.tan(psi) / F);
  return (F * (1 - Math.sin(psiF) * Math.sin(phiF))) / (Math.cos(psiF) * Math.cos(phiF));
}

function reduce(model: FeModel, F: number, rule: FlowRule, relax: number): ReducedStrength {
  const ngp = 3 * model.elementCount;
  const r: ReducedStrength = {
    c: new Float64Array(ngp), sinPhi: new Float64Array(ngp), cosPhi: new Float64Array(ngp),
    sinPsi: new Float64Array(ngp), cu: new Float64Array(ngp), dt: new Float64Array(ngp), dtT: new Float64Array(ngp),
    dtU: new Float64Array(ngp),
  };
  for (let i = 0; i < ngp; i++) {
    const e = (i / 3) | 0;
    const c = model.gpC[i], phi = model.gpPhi[i], psi0 = Math.min(model.elPsi[e], phi);
    let q = F, psiR: number;
    if (rule === "davis-b") q = davisB(F, phi, psi0);
    const phiR = Math.atan(Math.tan(phi) / q);
    if (rule === "non-associated") psiR = Math.atan(Math.tan(psi0) / F);
    else psiR = phiR;
    r.c[i] = c / q;
    // The undrained cap has φ = ψ = 0, for which Davis B's divisor is F.
    r.cu[i] = model.gpCu[i] / F;
    r.sinPhi[i] = Math.sin(phiR); r.cosPhi[i] = Math.cos(phiR);
    r.sinPsi[i] = Math.sin(psiR);
    const E = model.elE[e], nu = model.elNu[e];
    const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
    // a = n_fᵀ D n_g: the rate of decrease of f per unit viscoplastic step on
    // a single yield plane. Δt = ω/a; ω = 2 is the stability limit, which for
    // associated flow is the step of Smith & Griffiths (2014), and ω = 1 returns
    // a single plane exactly to the yield surface.
    const sf = r.sinPhi[i], sg = r.sinPsi[i];
    const a = lam * sf * sg + mu * (1 + sf * sg);
    r.dt[i] = relax / a;
    r.dtT[i] = relax / (lam + 2 * mu);
    r.dtU[i] = relax / mu;
  }
  return r;
}

const equationTables = new WeakMap<FeModel, Int32Array>();

/** Element dof → equation table (12 per element, −1 for fixed dofs), built once per model. */
function elementEquations(model: FeModel): Int32Array {
  const cached = equationTables.get(model);
  if (cached) return cached;
  const out = new Int32Array(12 * model.elementCount);
  equationTables.set(model, out);
  for (let e = 0; e < model.elementCount; e++) {
    for (let a = 0; a < 6; a++) {
      const n = model.el[6 * e + a];
      out[12 * e + 2 * a] = model.eq[2 * n];
      out[12 * e + 2 * a + 1] = model.eq[2 * n + 1];
    }
  }
  return out;
}

export function emptyState(model: FeModel): SrmState {
  const ngp = 3 * model.elementCount;
  const { bars } = model;
  const bodyLoads = new Float64Array(model.eqCount);
  // A prestressed anchor starts with the plastic strain −P/EA in its free
  // length (bars.ts), whose force the viscoplastic iteration carries as the
  // body load ∫ Bᵀ EA εp.
  for (let b = 0; b < bars.count; b++) {
    for (let g = 0; g < 2; g++) {
      const ep = bars.ep0[2 * b + g];
      if (ep === 0) continue;
      const o = (2 * b + g) * BAR_GP_STRIDE, w = bars.gp[o + 6] * bars.stiffness[b] * ep;
      for (let k = 0; k < 3; k++) {
        const n = bars.nodes[3 * b + k], ix = model.eq[2 * n], iy = model.eq[2 * n + 1];
        if (ix >= 0) bodyLoads[ix] += bars.gp[o + 2 * k] * w;
        if (iy >= 0) bodyLoads[iy] += bars.gp[o + 2 * k + 1] * w;
      }
    }
  }
  return {
    u: new Float64Array(model.eqCount),
    evp: new Float64Array(4 * ngp),
    bodyLoads,
    stress: new Float64Array(4 * ngp),
    barEp: Float64Array.from(bars.ep0),
  };
}

function cloneState(s: SrmState): SrmState {
  return { u: s.u.slice(), evp: s.evp.slice(), bodyLoads: s.bodyLoads.slice(), stress: s.stress.slice(), barEp: s.barEp.slice() };
}

/**
 * Viscoplastic iterations at one F, updating `state` in place.
 * @returns whether the iterations converged and how many were made.
 */
export function solveAtF(
  model: FeModel,
  F: number,
  state: SrmState,
  options: SrmOptions = {},
  eqs: Int32Array = elementEquations(model),
): { converged: boolean; iterations: number } {
  const rule = options.flowRule ?? "davis-b";
  const tol = options.tolerance ?? 1e-4;
  // Griffiths & Lane's 1000 iterations are for meshes of a few hundred
  // elements; plastic flow has to cross more elements on a finer mesh, so
  // the limit grows with the mesh's linear resolution, √(elements / 2500).
  const limit = options.maxIterations ?? Math.round(1000 * Math.max(1, Math.sqrt(model.elementCount / 2500)));
  const cutoff = options.tensionCutoff ?? false;
  const criterion = options.convergence ?? "increment";
  const red = reduce(model, F, rule, options.relaxation ?? 1);
  const { gp, elementCount: ne, elE, elNu, elElastic } = model;
  const { u, evp, bodyLoads, stress } = state;
  const s0 = model.stress0;
  const neq = model.eqCount;
  const next = new Float64Array(neq);
  const ue = new Float64Array(12);
  const load = new Float64Array(12);
  const eqWork = criterion === "equilibrium" ? {
    fint: new Float64Array(neq), stress: new Float64Array(12 * ne), ep: new Float64Array(12 * ne), barEp: new Float64Array(state.barEp.length),
  } : { fint: new Float64Array(0), stress: new Float64Array(0), ep: new Float64Array(0), barEp: new Float64Array(0) };
  let converged = false;
  let it = 0;
  let prevDu = 0, ratioCount = 0, passedBefore = false;
  const logRatio = new Float64Array(RATIO_WINDOW);
  for (; it < limit && !converged; ) {
    it++;
    for (let i = 0; i < neq; i++) next[i] = model.f[i] + bodyLoads[i];
    model.K.solve(next);
    let maxU = 0, maxDu = 0;
    for (let i = 0; i < neq; i++) {
      const v = next[i];
      maxU = Math.max(maxU, Math.abs(v));
      maxDu = Math.max(maxDu, Math.abs(v - u[i]));
      u[i] = v;
    }
    // The iteration converges linearly, Δu_k ≈ r·Δu_(k−1), so the distance to
    // the fixed point is about Δu_k·r/(1 − r) (e.g. Quarteroni, Sacco & Saleri,
    // Numerical Mathematics, 2nd ed., Springer 2007); r is the mean contraction over the
    // last iterations ("extrapolated" test). The first solve repeats the
    // starting state, so convergence counts only after the stresses have been
    // checked against this F's strength.
    if (it > 1 && prevDu > 0 && maxDu > 0) {
      logRatio[it % RATIO_WINDOW] = Math.log(maxDu / prevDu);
      ratioCount++;
    }
    prevDu = maxDu;
    let remaining = maxDu;
    if (ratioCount >= RATIO_WINDOW) {
      let sum = 0;
      for (const v of logRatio) sum += v;
      const rate = Math.exp(sum / RATIO_WINDOW);
      remaining = rate < 1 ? (maxDu * rate) / (1 - rate) : Infinity;
    } else if (ratioCount > 0) remaining = Infinity;
    const err = criterion === "extrapolated" ? Math.max(maxDu, remaining) : maxDu;
    // The test must pass in two successive iterations: from a converged
    // state at a slightly lower F the first relaxation can be small
    // enough to pass it once although many more follow (implementation
    // choice; Griffiths & Lane test a single increment).
    const passed = it > 1 && (maxU > 0 ? err / maxU <= tol : true);
    converged = passed && passedBefore;
    passedBefore = passed;
    if (converged && criterion === "equilibrium") {
      // The stresses of the iteration are in equilibrium but may lie
      // outside the yield surface; their returns to it (along the flow
      // rule's potential, as in newton.ts) are the admissible stresses,
      // whose internal forces must balance the load.
      evaluate(model, eqs, u, evp, red, cutoff, eqWork.fint, eqWork.stress, eqWork.ep, null);
      if (model.bars.count) barInternal(model, u, state.barEp, F, eqWork.fint, eqWork.barEp, null);
      if (model.piles.count) beamInternal(model, u, eqWork.fint, null);
      let s = 0;
      for (let i = 0; i < neq; i++) { const d = model.f[i] - eqWork.fint[i]; s += d * d; }
      if (Math.sqrt(s) > (options.unbalanceTolerance ?? 1e-3) * model.loadNorm) converged = false;
    }

    for (let e = 0; e < ne; e++) {
      for (let k = 0; k < 12; k++) { const q = eqs[12 * e + k]; ue[k] = q >= 0 ? u[q] : 0; }
      const E = elE[e], nu = elNu[e];
      const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
      let anyLoad = false;
      load.fill(0);
      for (let g = 0; g < 3; g++) {
        const i = 3 * e + g, o = i * GP_STRIDE, s = 4 * i;
        let ex = 0, ey = 0, gxy = 0;
        for (let k = 0; k < 6; k++) {
          const dx = gp[o + k], dy = gp[o + 6 + k];
          ex += dx * ue[2 * k]; ey += dy * ue[2 * k + 1]; gxy += dy * ue[2 * k] + dx * ue[2 * k + 1];
        }
        ex -= evp[s]; ey -= evp[s + 1]; gxy -= evp[s + 2];
        const ez = -evp[s + 3];
        const tr = ex + ey + ez;
        let sx = lam * tr + 2 * mu * ex, sy = lam * tr + 2 * mu * ey, txy = mu * gxy, sz = lam * tr + 2 * mu * ez;
        // initial stress: σ₀ + D(ε − εvp); its forces are already in f (model.ts)
        if (s0) { sx += s0[s]; sy += s0[s + 1]; txy += s0[s + 2]; sz += s0[s + 3]; }
        stress[s] = sx; stress[s + 1] = sy; stress[s + 2] = txy; stress[s + 3] = sz;
        if (elElastic[e]) continue;

        // In-plane principal stresses and the direction of the larger.
        const pm = (sx + sy) / 2, hd = (sx - sy) / 2;
        const rad = Math.sqrt(hd * hd + txy * txy);
        const sA = pm + rad, sB = pm - rad;
        const c2 = rad > 0 ? hd / rad : 1, s2 = rad > 0 ? txy / rad : 0;
        // Largest (1) and smallest (3) principal stress: 0 = A, 1 = B, 2 = z.
        const i1 = sz > sA ? 2 : 0, i3 = sz < sB ? 2 : 1;
        const s1 = i1 === 2 ? sz : sA, s3 = i3 === 2 ? sz : sB;
        const sp = red.sinPhi[i], ssi = red.sinPsi[i];
        const f = (s1 - s3) / 2 + ((s1 + s3) / 2) * sp - red.c[i] * red.cosPhi[i];
        // The undrained cap of a combined material: the surface with the
        // larger return is relaxed (Tresca flows with ψ = 0).
        const fU = (s1 - s3) / 2 - red.cu[i];
        let r1 = 0, r3 = 0;
        if (fU > 0 && fU * red.dtU[i] > f * red.dt[i]) {
          const k = fU * red.dtU[i];
          r1 = k / 2;
          r3 = -k / 2;
        } else if (f > 0) {
          const k = f * red.dt[i];
          r1 = (k * (1 + ssi)) / 2;
          r3 = (k * (-1 + ssi)) / 2;
        }
        if (cutoff && s1 > 0) r1 += s1 * red.dtT[i];
        else if (sp > 0 && f > 0) {
          // Beyond the apex of the pyramid, σ₁ > c cot φ, the deviatoric flow
          // of ψ < φ cannot return the stress (with c = 0 a tensile point at
          // the ground stays there and the iteration never converges); σ₁ is
          // relaxed towards the apex as by the Rankine cut-off. The plane
          // σ₁ ≤ c cot φ contains the whole pyramid, so the yield surface is
          // unchanged (implementation choice).
          const apex = (red.c[i] * red.cosPhi[i]) / sp;
          if (s1 > apex) r1 += (s1 - apex) * red.dtT[i];
        }
        if (r1 === 0 && r3 === 0) continue;
        // Back to Cartesian components (engineering shear strain).
        const eA = i1 === 0 ? r1 : 0;
        const eB = i3 === 1 ? r3 : 0;
        const eZ = (i1 === 2 ? r1 : 0) + (i3 === 2 ? r3 : 0);
        const dex = (eA * (1 + c2) + eB * (1 - c2)) / 2;
        const dey = (eA * (1 - c2) + eB * (1 + c2)) / 2;
        const dg = (eA - eB) * s2;
        evp[s] += dex; evp[s + 1] += dey; evp[s + 2] += dg; evp[s + 3] += eZ;
        // body load ∫ Bᵀ D Δεvp
        const dtr = dex + dey + eZ;
        const dsx = lam * dtr + 2 * mu * dex, dsy = lam * dtr + 2 * mu * dey, dtxy = mu * dg;
        const w = gp[o + 12];
        for (let k2 = 0; k2 < 6; k2++) {
          const dx = gp[o + k2], dy = gp[o + 6 + k2];
          load[2 * k2] += (dx * dsx + dy * dtxy) * w;
          load[2 * k2 + 1] += (dy * dsy + dx * dtxy) * w;
        }
        anyLoad = true;
      }
      if (anyLoad) for (let k = 0; k < 12; k++) { const q = eqs[12 * e + k]; if (q >= 0) bodyLoads[q] += load[k]; }
    }
    if (model.bars.count) relaxBars(model, u, state.barEp, F, bodyLoads);
  }
  return { converged, iterations: it };
}

function maxAbs(a: Float64Array): number {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  return m;
}

/** Trials the search asks for: these reductions, each from the same starting state (null: unloaded). */
export interface TrialBatch {
  start: SrmState | null;
  /** F of the starting state; 0 for the unloaded state. */
  startF: number;
  F: number[];
}

/** The outcome of one trial, with the state it reached. */
export interface TrialOutcome {
  converged: boolean;
  iterations: number;
  solver: SrmTrial["solver"];
  state: SrmState;
}

/**
 * Smallest increment of F, as a fraction of the jump from the starting
 * state, of a non-associated Newton trial: three halvings (implementation
 * choice).
 */
const MIN_INCREMENT = 0.125;

/** Whether the model's flow is associated everywhere (non-associated flow is associated where ψ = φ, as in undrained soil). */
function isAssociated(model: FeModel, rule: FlowRule): boolean {
  return (
    rule !== "non-associated" ||
    model.gpPhi.every((phi, i) => model.elElastic[(i / 3) | 0] === 1 || Math.min(model.elPsi[(i / 3) | 0], phi) === phi)
  );
}

/**
 * One trial at reduction F from a starting state (null: unloaded): Newton's
 * method for associated flow, the viscoplastic iteration otherwise. A trial
 * converges when the solver finds equilibrium; Newton decides its trials
 * alone, as in implicit strength reduction.
 */
export function runTrial(
  model: FeModel,
  F: number,
  start: SrmState | null,
  options: SrmOptions = {},
  eqs: Int32Array = elementEquations(model),
  startF = 0,
): TrialOutcome {
  const rule = options.flowRule ?? "davis-b";
  // Hoek–Brown rock: the instantaneous strength at the starting stresses
  // (before the solver is chosen, which reads φ)
  if (model.gpHoekBrown.size) setHoekBrownStrength(model, start ? start.stress : model.stress0);
  const solver = isAssociated(model, rule) ? options.solver ?? "newton" : options.solver === "bfgs" || options.solver === "newton" ? options.solver : "viscoplastic";
  const useNewton = solver === "newton";
  const st = start ? cloneState(start) : emptyState(model);
  if (solver === "bfgs") {
    const r = bfgsAtF(model, eqs, reduce(model, F, rule, 1), { u: st.u, ep: st.evp, stress: st.stress, barEp: st.barEp, F }, {
      tolerance: options.tolerance,
      maxIterations: options.newtonIterations,
      tensionCutoff: options.tensionCutoff,
    });
    return { converged: r.converged, iterations: r.iterations, solver: "bfgs", state: st };
  }
  if (useNewton) {
    const at = (f: number) =>
      newtonAtF(model, eqs, reduce(model, f, rule, 1), { u: st.u, ep: st.evp, stress: st.stress, barEp: st.barEp, F: f }, {
        tolerance: options.tolerance,
        maxIterations: options.newtonIterations,
        tensionCutoff: options.tensionCutoff,
      });
    if (isAssociated(model, rule) || !start || !(F > startF)) {
      const r = at(F);
      return { converged: r.converged, iterations: r.iterations, solver: "newton", state: st };
    }
    // Non-associated flow is path dependent, and its Newton iteration
    // (unsymmetric tangent, a stress return that is not smooth) can fail
    // to converge from a state far below F: F is raised in increments from
    // the starting state, halving an increment that fails and growing it
    // by half after a success (automatic increments with cutback, as in
    // incremental plasticity). The trial fails when an increment below
    // MIN_INCREMENT of the jump fails.
    const jump = F - startF;
    let Fc = startF, inc = jump, iterations = 0;
    for (;;) {
      const Ft = Fc + inc >= F - 1e-12 * F ? F : Fc + inc;
      const r = at(Ft);
      iterations += r.iterations;
      if (r.converged) {
        if (Ft === F) return { converged: true, iterations, solver: "newton", state: st };
        Fc = Ft;
        inc *= 1.5;
      } else {
        inc /= 2;
        if (inc < MIN_INCREMENT * jump) return { converged: false, iterations, solver: "newton", state: st };
      }
    }
  }
  const v = solveAtF(model, F, st, options, eqs);
  return { converged: v.converged, iterations: v.iterations, solver: "viscoplastic", state: st };
}

/** Factor of safety by strength reduction, the trials run one after another. */
export function strengthReduction(model: FeModel, options: SrmOptions = {}): SrmResult {
  const eqs = elementEquations(model);
  const search = strengthReductionSearch(model, options);
  let step = search.next();
  while (!step.done) {
    const batch = step.value;
    step = search.next(batch.F.map((F) => runTrial(model, F, batch.start, options, eqs, batch.startF)));
  }
  return step.value;
}

/**
 * The search for the factor of safety as a generator: it yields the trials
 * it needs (a batch of reductions from one starting state), receives their
 * outcomes in the same order, and returns the result. `strengthReduction`
 * runs the batches in turn; the app runs a batch's trials in parallel.
 * Either way the result is the same: it depends on `trialsPerRound`, not on
 * how many trials run at once.
 */
export function* strengthReductionSearch(model: FeModel, options: SrmOptions = {}): Generator<TrialBatch, SrmResult, TrialOutcome[]> {
  const fTol = options.fTolerance ?? 0.005;
  const rule = options.flowRule ?? "davis-b";
  const nonAssociated = !isAssociated(model, rule);
  const perRound = Math.max(1, Math.round(options.trialsPerRound ?? 1));
  const trials: SrmTrial[] = [];
  let iterations = 0;
  let lo = options.resume?.lo ?? 0, hi = Infinity, hiFrom = 0;
  let loState: SrmState | null = options.resume ? cloneState(options.resume.state) : null;
  let prevState: SrmState | null = null;
  // Failures from converged states, with the F of the state each started
  // from. A failure from the unloaded state bounds nothing: with the full
  // weight applied at once the iteration can fail at an F that a start from
  // a converged lower F reaches easily (seen with Newton on refined meshes).
  const failures: { F: number; from: number }[] = [];
  if (options.resume && Number.isFinite(options.resume.hi)) failures.push({ F: options.resume.hi, from: options.resume.hiFrom ?? lo });
  // The bracket: the highest converged F is the lower end, whose state the
  // next trials start from; the lowest failure above it the upper end. A
  // converged trial is an equilibrium state at its F, so it overrides
  // failures below it (one that failed from a lower state was a false
  // failure of the iteration).
  const update = () => {
    hi = Infinity; hiFrom = 0;
    for (const f of failures) {
      if (f.F > lo && (f.F < hi || (f.F === hi && f.from > hiFrom))) { hi = f.F; hiFrom = f.from; }
    }
  };
  update();
  // Run a batch from the current converged state (or the unloaded one).
  function* round(Fs: number[]): Generator<TrialBatch, boolean, TrialOutcome[]> {
    const warm = loState !== null, from = lo;
    const out = yield { start: loState, startF: warm ? from : 0, F: Fs };
    let best = -1;
    for (let k = 0; k < Fs.length; k++) {
      const r = out[k];
      iterations += r.iterations;
      const t: SrmTrial = { F: Fs[k], converged: r.converged, iterations: r.iterations, solver: r.solver, startF: warm ? from : 0, maxDisplacement: maxAbs(r.state.u) };
      trials.push(t);
      options.onTrial?.(t);
      if (!r.converged && warm) failures.push({ F: Fs[k], from });
      if (r.converged && Fs[k] > lo && (best < 0 || Fs[k] > Fs[best])) best = k;
    }
    if (best >= 0) { lo = Fs[best]; prevState = loState; loState = out[best].state; }
    update();
    return best >= 0;
  }

  // Bracket, then bisect (Dawson, Roth & Drescher 1999): step up from a
  // converged trial, down from a failed one, until a converged F and a
  // failed F above it are known. With `trialsPerRound` = n > 1 the search
  // tries n reductions per round from the same converged state: the next n
  // steps up while bracketing, and n points dividing the bracket into n + 1
  // equal parts while bisecting (multisection, the parallel form of
  // bisection: Miranker 1969, IBM J. Res. Dev. 13(3), 297; Miranker 1978,
  // Math. Comput. Simul. 20(2), 93–101), so that the bracket shrinks by
  // n + 1 per round instead of 2.
  //
  // Implementation choices (not from the literature): the first trial
  // F = 1, the first step 25 %, a step growing by 1.5 up to 25 % while
  // associated trials keep converging, F / 1.5 after a failure from the
  // unloaded state, and the guide steps on refined meshes. They set how
  // many trials the bracket costs, not the factor found, which is decided
  // by the bisection to the tolerance; for non-associated flow, whose
  // state depends on the load path, the steps stay equal (10 %) as in
  // Griffiths & Lane's (1999) incremental reduction, one trial at a time,
  // and only the bisection runs several trials per round.
  //
  // At the end the failure that bounds F is confirmed from the final
  // converged state when it was decided from a lower one (bisection keeps
  // the first failure), so that a single false failure of the iteration
  // cannot set F; if it converges the search goes on above it.
  const guide = options.guide;
  let rise = options.bracketStep ?? (nonAssociated ? 0.1 : 0.25);
  let F = options.resume ? (Number.isFinite(hi) ? (lo + hi) / 2 : lo * (1 + rise)) : options.startF ?? 1;
  let warning: string | undefined;
  // The next reduction while rising from a converged one.
  const nextUp = (from: number, r: number): number => {
    let next = from * (1 + r);
    if (guide !== undefined && from < 1.05 * guide) next = Math.min(next, from < 0.97 * guide ? 0.97 * guide : from + 0.02 * guide);
    return next;
  };
  for (let confirmations = 0; ; confirmations++) {
    for (let k = 0; k < 40 && !(lo > 0 && Number.isFinite(hi)); k++) {
      if (loState === null || Number.isFinite(hi) || nonAssociated || perRound === 1) {
        // One trial: from the unloaded state, or towards a known failure, or
        // in the equal steps of non-associated flow.
        const ok = yield* round([F]);
        if (ok) {
          if (Number.isFinite(hi)) F = (F + hi) / 2;
          else {
            F = nextUp(F, rise);
            // With associated flow the limit does not depend on the path, so
            // the step can grow; with non-associated flow the state does, and
            // F rises in equal steps as in Griffiths & Lane.
            if (!nonAssociated) rise = Math.min(0.25, rise * 1.5);
          }
        } else F = lo > 0 ? (lo + F) / 2 : F / 1.5;
      } else {
        // Associated flow rising from a converged state: the next steps at once.
        const Fs: number[] = [];
        const rises: number[] = [];
        let f = lo, r = rise;
        for (let n = 0; n < perRound; n++) {
          f = nextUp(f, r);
          Fs.push(f);
          r = Math.min(0.25, r * 1.5);
          rises.push(r);
        }
        yield* round(Fs);
        if (!Number.isFinite(hi)) {
          F = nextUp(lo, rises[perRound - 1]);
          rise = rises[perRound - 1];
        } else F = (lo + hi) / 2;
      }
      if (F > 100) { warning = "no failure below F = 100"; break; }
      if (F < 0.01) { warning = "no converged trial above F = 0.01"; break; }
    }
    // Bisect (multisect): as many points as needed to bring the bracket
    // within the tolerance in one round, at most `trialsPerRound`.
    while (lo > 0 && Number.isFinite(hi) && hi - lo > fTol) {
      const n = Math.min(perRound, Math.max(1, Math.ceil((hi - lo) / fTol) - 1));
      const Fs = Array.from({ length: n }, (_, k) => lo + ((hi - lo) * (k + 1)) / (n + 1));
      yield* round(Fs);
    }
    if (warning || !(lo > 0 && Number.isFinite(hi)) || hiFrom >= lo || confirmations >= MAX_CONFIRMATIONS) break;
    const failed = hi, failedFrom = hiFrom;
    yield* round([failed]);
    if (hi === failed) break;
    // The failure was false. Other failures decided from the same or a
    // lower state are suspect too: they are dropped, and the search goes on
    // above in small steps and finds them again if they are real.
    for (let k = failures.length - 1; k >= 0; k--) if (failures[k].from <= failedFrom) failures.splice(k, 1);
    update();
    rise = Math.min(rise, 0.04);
    F = Number.isFinite(hi) ? (lo + hi) / 2 : nextUp(lo, rise);
  }

  if (!warning && lo > 0 && Number.isFinite(hi) && hiFrom < lo) {
    warning = `the failure at F = ${hi.toFixed(3)} was not confirmed from the converged state at ${lo.toFixed(3)}`;
  }
  // Displacements depend on the load path, so only trials that rose from a
  // converged state are compared (a trial from the unloaded state carries
  // the whole weight at once); the reference rate is that of the first two.
  // A reduction converged more than once keeps its first trial.
  const conv = trials
    .filter((t) => t.converged && t.startF > 0)
    .sort((a, b) => a.F - b.F)
    .filter((t, k, all) => k === 0 || t.F > all[k - 1].F);
  let jump: number | null = null;
  if (conv.length >= 3) {
    const rate0 = (conv[1].maxDisplacement - conv[0].maxDisplacement) / (conv[1].F - conv[0].F);
    jump = conv[conv.length - 1].F;
    for (let k = 2; k < conv.length; k++) {
      const rate = (conv[k].maxDisplacement - conv[k - 1].maxDisplacement) / (conv[k].F - conv[k - 1].F);
      if (rate0 > 0 && rate > 10 * rate0) { jump = conv[k - 1].F; break; }
    }
  }
  return {
    factorOfSafety: lo,
    failedF: hi,
    failedFrom: hiFrom,
    displacementJumpF: jump,
    trials,
    state: loState ?? emptyState(model),
    previousState: prevState,
    iterations,
    warning,
  };
}
