/**
 * Strength reduction by finite elements (SRFEM).
 *
 * Viscoplastic algorithm of Zienkiewicz & Cormeau (1974) as used for
 * slopes by Griffiths & Lane (1999, Géotechnique 49(3), 387–403) and
 * coded in Smith, Griffiths & Margetts (2014, Programming the Finite
 * Element Method, 5th ed., §6.5): gravity is applied in one increment,
 * the elastic stiffness is factorised once, and at every iteration the
 * stress overshoot beyond the yield surface is relaxed by a viscoplastic
 * strain increment f·∂Q/∂σ·Δt whose body loads enter the next solution.
 * Failure is non-convergence within the iteration limit.
 *
 * Yield: Mohr–Coulomb in principal stresses (tension positive),
 * f = (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin φ − c cos φ, the normalisation of
 * Smith & Griffiths. Their time step Δt = 4(1 + ν)(1 − 2ν)/(E(1 − 2ν + sin²φ))
 * is the stability limit 2/a of the explicit update for associated flow
 * (a = n_fᵀ D n_g); the default here is half of it, Δt = 1/a, which returns
 * a stress on one yield plane to the surface in one step and does not
 * oscillate at the corners of the pyramid. Optional tension cut-off
 * f_t = σ₁ ≤ 0 (Rankine), relaxed in the same way.
 *
 * Reduction (flow rules, after Sysala et al. 2021, eq. 2.1 and 4.6–4.8):
 * - "davis-b" (default): c and tan φ divided by
 *   q_B(F) = F(1 − sin ψ_F sin φ_F)/(cos ψ_F cos φ_F), tan φ_F = tan φ/F,
 *   tan ψ_F = tan ψ/F, with associated flow in the reduced material
 *   (Tschuchnigg, Schweiger & Sloan 2015, Comput. Geotech. 70, 169–177);
 * - "non-associated": c/F, tan φ/F, tan ψ/F, flow with ψ_F (Griffiths & Lane);
 * - "associated": c/F, tan φ/F and ψ = φ_F.
 *
 * F is bracketed and bisected (Dawson, Roth & Drescher 1999, Géotechnique
 * 49(6), 835–840); every trial above a converged one starts from that
 * converged state, which shortens the iterations without changing the
 * limit (the Mohr–Coulomb limit load does not depend on the stress path).
 */

import { GP_STRIDE } from "./elements";
import type { FeModel } from "./model";
import { newtonAtF } from "./newton";

/** Iterations over which the contraction ratio is averaged. */
const RATIO_WINDOW = 10;
/** Iterations before a trial may fail by its predicted iteration count. */
const EARLY_FAIL_AFTER = 200;

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
  /** Iteration limit per trial (failure when reached); default 1000 (viscoplastic), 25 (Newton). */
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
  /** Called after each trial. */
  onTrial?: (trial: SrmTrial) => void;
}

export interface SrmTrial {
  F: number;
  converged: boolean;
  iterations: number;
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
}

export interface SrmResult {
  /** Factor of safety: the largest converged F (non-convergence criterion). */
  factorOfSafety: number;
  /** Smallest F that failed to converge. */
  failedF: number;
  /**
   * F at the displacement jump (Huang & Jia 2009, Comput. Geotech. 36, 93–101):
   * the largest converged F whose displacement is within ten times the
   * first trial's growth rate; null when there are too few converged trials.
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
  };
}

function cloneState(s: SrmState): SrmState {
  return { u: s.u.slice(), evp: s.evp.slice(), bodyLoads: s.bodyLoads.slice(), stress: s.stress.slice() };
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
  const limit = options.maxIterations ?? 1000;
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
  let prevDu = 0, ratioCount = 0, hopeless = 0;
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
    // Numerical Mathematics, 2007, §6.5); r is the mean contraction over the
    // last iterations ("extrapolated" test). The first solve repeats the
    // starting state, so convergence counts only after the stresses have been
    // checked against this F's strength.
    if (it > 1 && prevDu > 0 && maxDu > 0) {
      logRatio[it % RATIO_WINDOW] = Math.log(maxDu / prevDu);
      ratioCount++;
    }
    prevDu = maxDu;
    let remaining = maxDu;
    let rate = NaN;
    if (ratioCount >= RATIO_WINDOW) {
      let sum = 0;
      for (const v of logRatio) sum += v;
      rate = Math.exp(sum / RATIO_WINDOW);
      remaining = rate < 1 ? (maxDu * rate) / (1 - rate) : Infinity;
    } else if (ratioCount > 0) remaining = Infinity;
    const err = criterion === "extrapolated" ? Math.max(maxDu, remaining) : maxDu;
    converged = it > 1 && (maxU > 0 ? err / maxU <= tol : true);
    // Early failure: once the contraction has settled, the iterations still
    // needed are log(tol·max|u| / Δu) / log r. A trial that would need more
    // than the limit (with a margin of 50 %, for 20 iterations in a row)
    // cannot converge in time, so it fails now, as it would at the limit.
    if (!converged && it >= EARLY_FAIL_AFTER && Number.isFinite(rate) && maxU > 0) {
      const needed = rate < 1 ? Math.log((tol * maxU) / maxDu) / Math.log(rate) : Infinity;
      hopeless = it + needed > 1.5 * limit ? hopeless + 1 : 0;
      if (hopeless >= 20) break;
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
  const trials: SrmTrial[] = [];
  let iterations = 0;
  let lo = 0, hi = Infinity;
  let loState: SrmState | null = null;
  let prevState: SrmState | null = null;
  const run = (F: number): boolean => {
    const warm = loState !== null;
    let st = loState ? cloneState(loState) : emptyState(model);
    let r = useNewton
      ? newtonAtF(model, eqs, reduce(model, F, rule, 1), { u: st.u, ep: st.evp, stress: st.stress }, {
          tolerance: options.tolerance,
          maxIterations: options.maxIterations,
          tensionCutoff: options.tensionCutoff,
        })
      : solveAtF(model, F, st, options, eqs);
    if (useNewton && !r.converged && loState) {
      // Newton can cycle between the planes of the Mohr–Coulomb pyramid near
      // collapse. The viscoplastic iteration, which converges wherever a
      // solution exists, decides such a trial (from the same converged state).
      iterations += r.iterations;
      st = cloneState(loState);
      st.bodyLoads = plasticBodyLoads(model, eqs, st.evp);
      r = solveAtF(model, F, st, { ...options, tolerance: undefined, maxIterations: undefined }, eqs);
    }
    iterations += r.iterations;
    const t = { F, converged: r.converged, iterations: r.iterations, maxDisplacement: maxAbs(st.u) };
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

  // Bracket: step up from a converged trial, down from a failed one.
  let F = options.startF ?? 1;
  const step = options.bracketStep ?? 0.25;
  let warning: string | undefined;
  for (let k = 0; k < 40 && !(lo > 0 && Number.isFinite(hi)); k++) {
    if (run(F)) F = Number.isFinite(hi) ? (F + hi) / 2 : F * (1 + step);
    else F = lo > 0 ? (lo + F) / 2 : F / (1 + step);
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
