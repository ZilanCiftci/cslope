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
 * - Associated flow is solved by Newton's method (newton.ts).
 * - Search: F is bracketed and bisected (Dawson, Roth & Drescher 1999,
 *   Géotechnique 49(6), 835–840). A trial above a converged one starts
 *   from that converged state; with associated flow the limit load does not
 *   depend on the stress path (the uniqueness theorems of limit analysis),
 *   with non-associated flow it may, so F then rises in small equal steps
 *   as in Griffiths & Lane's incremental reduction.
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
 * - When Newton fails, the viscoplastic iteration decides the trial from
 *   the same starting state (see `strengthReduction`).
 * - A trial that fails from the unloaded state does not bound F from
 *   above; only a failure from a converged state does.
 */

import { GP_STRIDE } from "./elements";
import type { FeModel } from "./model";
import { newtonAtF } from "./newton";
import { barBodyLoads, relaxBars } from "./bars";

/** Iterations over which the contraction ratio is averaged. */
const RATIO_WINDOW = 10;

export type FlowRule = "davis-b" | "non-associated" | "associated";

export interface SrmOptions {
  flowRule?: FlowRule;
  /**
   * "newton" (default for Davis B and associated flow): implicit return and
   * consistent tangent (newton.ts), which decides convergence sharply;
   * "viscoplastic": the explicit iteration of Griffiths & Lane, always used
   * for non-associated flow, whose tangent is not symmetric.
   */
  solver?: "newton" | "viscoplastic";
  /** Rankine tension cut-off at zero effective stress; default false. */
  tensionCutoff?: boolean;
  /**
   * Convergence test: "increment" (default), max|Δu|/max|u| ≤ tolerance as
   * Griffiths & Lane (1999) and Smith & Griffiths (2014); "extrapolated", the
   * estimated distance to the fixed point Δu·r/(1 − r) instead of Δu, which
   * does not accept a slowly creeping state near collapse but needs more
   * iterations, so with the same limit it gives a lower F (V055: 1.31
   * against 1.35).
   */
  convergence?: "increment" | "extrapolated";
  /** Convergence tolerance; default 1e-4 (viscoplastic), 1e-6 relative residual (Newton). */
  tolerance?: number;
  /** Iteration limit per trial (failure when reached); default 1000 × √(elements/2500), at least 1000 (viscoplastic), 25 (Newton). */
  maxIterations?: number;
  /** Absolute tolerance on F; default 0.005. */
  fTolerance?: number;
  /**
   * Viscoplastic step as a fraction of the stability limit 2/a (see `reduce`):
   * Δt = relaxation / a; default 1 (exact return on a single plane).
   */
  relaxation?: number;
  /** First trial F; default 1. */
  startF?: number;
  /** Relative step while bracketing F; default 0.25. */
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
  resume?: { lo: number; hi: number; state: SrmState };
  /** Called after each trial. */
  onTrial?: (trial: SrmTrial) => void;
}

export interface SrmTrial {
  F: number;
  converged: boolean;
  iterations: number;
  /** Solver that decided the trial. */
  solver: "newton" | "viscoplastic";
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
  /** Smallest F that failed to converge. */
  failedF: number;
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
  dt: Float64Array;
  dtT: Float64Array;
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
    sinPsi: new Float64Array(ngp), dt: new Float64Array(ngp), dtT: new Float64Array(ngp),
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
  }
  return r;
}

/** Element dof → equation table (12 per element, −1 for fixed dofs). */
function elementEquations(model: FeModel): Int32Array {
  const out = new Int32Array(12 * model.elementCount);
  for (let e = 0; e < model.elementCount; e++) {
    for (let a = 0; a < 6; a++) {
      const n = model.el[6 * e + a];
      out[12 * e + 2 * a] = model.eq[2 * n];
      out[12 * e + 2 * a + 1] = model.eq[2 * n + 1];
    }
  }
  return out;
}

/** Body loads ∫ Bᵀ D εp dA of a plastic strain field, per equation. */
export function plasticBodyLoads(model: FeModel, eqs: Int32Array, ep: Float64Array): Float64Array {
  const out = new Float64Array(model.eqCount);
  const { gp, elementCount: ne, elE, elNu } = model;
  for (let e = 0; e < ne; e++) {
    const E = elE[e], nu = elNu[e];
    const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
    for (let g = 0; g < 3; g++) {
      const i = 3 * e + g, o = i * GP_STRIDE, s = 4 * i, w = gp[o + 12];
      const ex = ep[s], ey = ep[s + 1], gxy = ep[s + 2], ez = ep[s + 3];
      if (ex === 0 && ey === 0 && gxy === 0 && ez === 0) continue;
      const tr = ex + ey + ez;
      const sx = lam * tr + 2 * mu * ex, sy = lam * tr + 2 * mu * ey, txy = mu * gxy;
      for (let k = 0; k < 6; k++) {
        const dx = gp[o + k], dy = gp[o + 6 + k];
        const qx = eqs[12 * e + 2 * k], qy = eqs[12 * e + 2 * k + 1];
        if (qx >= 0) out[qx] += (dx * sx + dy * txy) * w;
        if (qy >= 0) out[qy] += (dy * sy + dx * txy) * w;
      }
    }
  }
  return out;
}

export function emptyState(model: FeModel): SrmState {
  const ngp = 3 * model.elementCount;
  return {
    u: new Float64Array(model.eqCount),
    evp: new Float64Array(4 * ngp),
    bodyLoads: new Float64Array(model.eqCount),
    stress: new Float64Array(4 * ngp),
    barEp: new Float64Array(2 * model.bars.count),
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
  const neq = model.eqCount;
  const next = new Float64Array(neq);
  const ue = new Float64Array(12);
  const load = new Float64Array(12);
  let converged = false;
  let it = 0;
  let prevDu = 0, ratioCount = 0;
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
    converged = it > 1 && (maxU > 0 ? err / maxU <= tol : true);

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
        const sx = lam * tr + 2 * mu * ex, sy = lam * tr + 2 * mu * ey, txy = mu * gxy, sz = lam * tr + 2 * mu * ez;
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
        let r1 = 0, r3 = 0;
        if (f > 0) {
          const k = f * red.dt[i];
          r1 = (k * (1 + ssi)) / 2;
          r3 = (k * (-1 + ssi)) / 2;
        }
        if (cutoff && s1 > 0) r1 += s1 * red.dtT[i];
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

/** Factor of safety by strength reduction. */
export function strengthReduction(model: FeModel, options: SrmOptions = {}): SrmResult {
  const eqs = elementEquations(model);
  const fTol = options.fTolerance ?? 0.005;
  const rule = options.flowRule ?? "davis-b";
  // Non-associated flow is associated where ψ = φ (φ = 0 in undrained soil).
  const associated =
    rule !== "non-associated" ||
    model.gpPhi.every((phi, i) => model.elElastic[(i / 3) | 0] === 1 || Math.min(model.elPsi[(i / 3) | 0], phi) === phi);
  const useNewton = associated && (options.solver ?? "newton") === "newton";
  const nonAssociated = !associated;
  const trials: SrmTrial[] = [];
  let iterations = 0;
  let lo = options.resume?.lo ?? 0, hi = options.resume?.hi ?? Infinity;
  let loState: SrmState | null = options.resume ? cloneState(options.resume.state) : null;
  let prevState: SrmState | null = null;
  const run = (F: number): boolean => {
    const warm = loState !== null;
    let st = loState ? cloneState(loState) : emptyState(model);
    let solver: SrmTrial["solver"] = useNewton ? "newton" : "viscoplastic";
    let r = useNewton
      ? newtonAtF(model, eqs, reduce(model, F, rule, 1), { u: st.u, ep: st.evp, stress: st.stress, barEp: st.barEp, F }, {
          tolerance: options.tolerance,
          maxIterations: options.maxIterations,
          tensionCutoff: options.tensionCutoff,
        })
      : solveAtF(model, F, st, options, eqs);
    if (useNewton && !r.converged) {
      // Newton can cycle between the planes of the Mohr–Coulomb pyramid near
      // collapse, and from the unloaded state at the apex of cohesionless
      // soil. The viscoplastic iteration, which converges wherever a solution
      // exists, decides such a trial from the same starting state.
      iterations += r.iterations;
      st = loState ? cloneState(loState) : emptyState(model);
      st.bodyLoads = plasticBodyLoads(model, eqs, st.evp);
      barBodyLoads(model, st.barEp, st.bodyLoads);
      r = solveAtF(model, F, st, { ...options, tolerance: undefined, maxIterations: undefined }, eqs);
      solver = "viscoplastic";
    }
    iterations += r.iterations;
    const t: SrmTrial = { F, converged: r.converged, iterations: r.iterations, solver, maxDisplacement: maxAbs(st.u) };
    trials.push(t);
    options.onTrial?.(t);
    // A trial that fails from the unloaded state is no upper bound: with the
    // full weight applied at once the iteration can fail at an F that a
    // start from a converged lower F reaches easily (seen with Newton on
    // refined meshes). Only a failure from a converged state bounds F.
    if (r.converged) { lo = F; prevState = loState; loState = st; }
    else if (warm) hi = Math.min(hi, F);
    return r.converged;
  };

  // Bracket, then bisect (Dawson, Roth & Drescher 1999): step up from a
  // converged trial, down from a failed one, until a converged F and a
  // failed F above it are known.
  //
  // Implementation choices (not from the literature): the first trial
  // F = 1, the first step 25 %, a step growing by 1.5 up to 25 % while
  // associated trials keep converging, F / 1.5 after a failure from the
  // unloaded state, and the guide steps on refined meshes. They set how
  // many trials the bracket costs, not the factor found, which is decided
  // by the bisection to the tolerance; for non-associated flow, whose
  // state depends on the load path, the steps stay equal and small as in
  // Griffiths & Lane (1999).
  let F = options.startF ?? 1;
  const guide = options.guide;
  const step = options.bracketStep ?? 0.25;
  let warning: string | undefined;
  // Before any trial has converged a failure says little (the unloaded
  // start is the hard one), so F falls fast; from converged states it rises
  // with a step that grows while trials keep converging.
  let rise = step;
  for (let k = 0; k < 40 && !(lo > 0 && Number.isFinite(hi)); k++) {
    if (run(F)) {
      if (Number.isFinite(hi)) F = (F + hi) / 2;
      else {
        F *= 1 + rise;
        if (guide !== undefined && lo < 1.05 * guide) F = Math.min(F, lo < 0.97 * guide ? 0.97 * guide : lo + 0.02 * guide);
        // With associated flow the limit does not depend on the path, so the
        // step can grow; with non-associated flow the state does, and F
        // rises in equal small steps as in Griffiths & Lane.
        if (!nonAssociated) rise = Math.min(0.25, rise * 1.5);
      }
    } else F = lo > 0 ? (lo + F) / 2 : F / 1.5;
    if (F > 100) { warning = "no failure below F = 100"; break; }
    if (F < 0.01) { warning = "no converged trial above F = 0.01"; break; }
  }
  // Bisect.
  while (lo > 0 && Number.isFinite(hi) && hi - lo > fTol) run((lo + hi) / 2);

  const conv = trials.filter((t) => t.converged).sort((a, b) => a.F - b.F);
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
    displacementJumpF: jump,
    trials,
    state: loState ?? emptyState(model),
    previousState: prevState,
    iterations,
    warning,
  };
}
