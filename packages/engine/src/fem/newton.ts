/**
 * Newton–Raphson solution at one strength reduction factor, with implicit
 * stress return and the consistent tangent: associated flow (Davis B or
 * associated) and, as an option, non-associated flow (srm.ts).
 *
 * Stress return: the closest point, in the energy norm of the elastic
 * compliance, of the trial stress on the yield set in principal stress
 * space: the Mohr–Coulomb plane f = (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin φ − c cos φ
 * ≤ 0, optionally the Rankine plane σ₁ ≤ 0 and, for a combined material
 * (the lesser of the drained and undrained strength), the Tresca plane
 * (σ₁ − σ₃)/2 ≤ cu, with the ordering
 * σ₁ ≥ σ₂ ≥ σ₃ as further planes, so that returns to an edge or the apex
 * of the pyramid come out of the same projection (Clausen, Damkilde &
 * Andersen 2006, IJNME 66, 1036–1059; de Souza Neto, Perić & Owen 2008,
 * Computational Methods for Plasticity, Wiley 2008, ch. 8). The active planes are found
 * by enumeration (at most three of the five planes active in three
 * dimensions).
 *
 * Tangent: in principal space D − D A (Aᵀ D A)⁻¹ Aᵀ D for the active planes
 * A, and in the plane of the principal directions the shear stiffness
 * (σ_A − σ_B) / (2(ε_A − ε_B)) of an isotropic tensor function (de Souza
 * Neto et al. 2008, appendix A), rotated to x, y. With associated flow it is
 * symmetric, so the system is solved by Cholesky (sparse.ts). With a
 * dilation angle ψ < φ the plastic flow follows the potential's normal G
 * and the tangent D − D G (Aᵀ D G)⁻¹ Aᵀ D is unsymmetric (de Souza Neto et
 * al. 2008, § 8.3), solved by LU on the same pattern; beyond the apex,
 * which the flow of ψ < φ cannot reach, the stress returns to the apex and
 * its tangent is zero.
 *
 * Globalisation: backtracking line search with the sufficient decrease
 * (Armijo) condition on ½‖r‖², halving the step (Dennis & Schnabel,
 * Numerical Methods for Unconstrained Optimization and Nonlinear
 * Equations, 1983, ch. 6; Nocedal & Wright, Numerical Optimization, 2nd
 * ed., 2006, ch. 3 and 11). Where the tangent is singular (a mechanism has
 * formed) the step uses the elastic stiffness (initial stiffness method).
 *
 * Implementation choices (not from the literature): convergence at a
 * residual of 10⁻⁶ of the load, at most 200 iterations, and failure when
 * no step lowers the residual or it has not fallen by 10 % over 30
 * iterations (beyond the limit load it stagnates). A trial that Newton
 * does not converge fails (srm.ts).
 */

import { GP_STRIDE } from "./elements";
import type { FeModel } from "./model";
import type { SparseCholesky } from "./sparse";
import { barInternal } from "./bars";

export interface ReturnResult {
  /** Stress after return (σx, σy, τxy, σz). */
  stress: [number, number, number, number];
  /** Consistent tangent (4 × 4, Voigt with engineering shear), row-major. */
  tangent: Float64Array;
  plastic: boolean;
}

/** Solve a small dense system in place (Gaussian elimination with partial pivoting); false if singular. */
function solveSmall(n: number, a: Float64Array, b: Float64Array): boolean {
  for (let k = 0; k < n; k++) {
    let p = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i * n + k]) > Math.abs(a[p * n + k])) p = i;
    if (Math.abs(a[p * n + k]) < 1e-12 * (Math.abs(a[0]) + 1e-300)) return false;
    if (p !== k) {
      for (let j = 0; j < n; j++) { const t = a[k * n + j]; a[k * n + j] = a[p * n + j]; a[p * n + j] = t; }
      const t = b[k]; b[k] = b[p]; b[p] = t;
    }
    for (let i = k + 1; i < n; i++) {
      const m = a[i * n + k] / a[k * n + k];
      for (let j = k; j < n; j++) a[i * n + j] -= m * a[k * n + j];
      b[i] -= m * b[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= a[i * n + j] * b[j];
    b[i] = s / a[i * n + i];
  }
  return true;
}

// Candidate active sets of the closest-point return: subsets of the five
// planes with at most three members, smallest first, as bit masks.
const SUBSET_MASKS: number[] = [];
{
  const sets: number[][] = [];
  for (let mask = 1; mask < 32; mask++) {
    const s: number[] = [];
    for (let k = 0; k < 5; k++) if (mask & (1 << k)) s.push(k);
    if (s.length <= 3) sets.push(s);
  }
  sets.sort((a, b) => a.length - b.length);
  for (const s of sets) SUBSET_MASKS.push(s.reduce((m, k) => m | (1 << k), 0));
}

// Work arrays of the stress return (one return at a time per thread): the
// planes aᵀσ ≤ b (A, 5 × 3; B), the active set and its D·a (DA, 3 × 3), the
// small systems, and the returned principal stresses.
const PA = new Float64Array(15), PB = new Float64Array(5), PG = new Float64Array(15);
const DY = new Float64Array(9);
const ACT = new Int32Array(3), DA = new Float64Array(9), MS = new Float64Array(9), RHS = new Float64Array(3);
const RET = new Float64Array(3);
const DEP = new Float64Array(9), MINV = new Float64Array(9), MC = new Float64Array(9), EC = new Float64Array(3);
const CP = new Float64Array(16), TT = new Float64Array(16), CT = new Float64Array(16);
let activeCount = 0;
/** activeCount of a return to the apex: the stress is fixed there and the principal tangent is zero. */
const APEX = -1;

function plane(k: number, v0: number, v1: number, v2: number): number {
  return PA[3 * k] * v0 + PA[3 * k + 1] * v1 + PA[3 * k + 2] * v2 - PB[k];
}

/**
 * Closest-point return in sorted principal space (s0 ≥ s1 ≥ s2): the
 * returned stresses in RET and the active planes in ACT / activeCount.
 * @returns false if elastic.
 */
function principalReturn(
  s0: number,
  s1: number,
  s2: number,
  lam: number,
  mu: number,
  c: number,
  sinPhi: number,
  cosPhi: number,
  cutoff: boolean,
  cu: number,
  sinPsi: number,
): boolean {
  // planes aᵀσ ≤ b: 0 Mohr–Coulomb, 1 Rankine, 2 σ₂ ≤ σ₁, 3 σ₃ ≤ σ₂,
  // 4 Tresca (σ₁ − σ₃)/2 ≤ cu, the undrained cap of a combined material.
  // The plastic flow is along g (PG): the plane's normal, except for the
  // Mohr–Coulomb plane with a dilation angle ψ < φ (non-associated flow),
  // whose potential (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin ψ has the normal
  // ((1 + sin ψ)/2, 0, −(1 − sin ψ)/2).
  const tresca = Number.isFinite(cu);
  PA[0] = (1 + sinPhi) / 2; PA[1] = 0; PA[2] = -(1 - sinPhi) / 2;
  PA[3] = 1; PA[4] = 0; PA[5] = 0;
  PA[6] = -1; PA[7] = 1; PA[8] = 0;
  PA[9] = 0; PA[10] = -1; PA[11] = 1;
  PA[12] = 0.5; PA[13] = 0; PA[14] = -0.5;
  PB[0] = c * cosPhi; PB[1] = 0; PB[2] = 0; PB[3] = 0; PB[4] = tresca ? cu : 0;
  for (let k = 0; k < 15; k++) PG[k] = PA[k];
  PG[0] = (1 + sinPsi) / 2; PG[2] = -(1 - sinPsi) / 2;
  const useMask = 1 | (cutoff ? 2 : 0) | 4 | 8 | (tresca ? 16 : 0);
  const tolF = 1e-10 * (Math.abs(s0) + Math.abs(s2) + c + (tresca ? cu : 0) + 1);
  if (plane(0, s0, s1, s2) <= tolF && (!cutoff || plane(1, s0, s1, s2) <= tolF) && (!tresca || plane(4, s0, s1, s2) <= tolF)) return false;
  for (const mask of SUBSET_MASKS) {
    if (mask & ~useMask) continue;
    if ((mask & (1 | 2 | 16)) === 0) continue; // ordering alone is not a return
    let n = 0;
    for (let k = 0; k < 5; k++) if (mask & (1 << k)) ACT[n++] = k;
    for (let j = 0; j < n; j++) {
      const a = 3 * ACT[j], tr = PG[a] + PG[a + 1] + PG[a + 2];
      DA[3 * j] = lam * tr + 2 * mu * PG[a];
      DA[3 * j + 1] = lam * tr + 2 * mu * PG[a + 1];
      DA[3 * j + 2] = lam * tr + 2 * mu * PG[a + 2];
    }
    for (let i = 0; i < n; i++) {
      const a = 3 * ACT[i];
      for (let j = 0; j < n; j++) MS[i * n + j] = PA[a] * DA[3 * j] + PA[a + 1] * DA[3 * j + 1] + PA[a + 2] * DA[3 * j + 2];
      RHS[i] = plane(ACT[i], s0, s1, s2);
    }
    if (!solveSmall(n, MS, RHS)) continue;
    let negative = false;
    for (let i = 0; i < n; i++) if (RHS[i] < -1e-12 * (Math.abs(RHS[0]) + 1e-300)) negative = true;
    if (negative) continue;
    let o0 = s0, o1 = s1, o2 = s2;
    for (let i = 0; i < n; i++) { o0 -= DA[3 * i] * RHS[i]; o1 -= DA[3 * i + 1] * RHS[i]; o2 -= DA[3 * i + 2] * RHS[i]; }
    let ok = true;
    for (let k = 0; k < 5 && ok; k++) if ((useMask >> k) & 1 && !((mask >> k) & 1) && plane(k, o0, o1, o2) > tolF) ok = false;
    if (ok) {
      RET[0] = o0; RET[1] = o1; RET[2] = o2;
      activeCount = n;
      return true;
    }
  }
  // Beyond the apex with ψ < φ the deviatoric flow cannot reach the yield
  // set: the stress returns to the apex σ₁ = σ₂ = σ₃ = c cot φ (or to zero
  // under the tension cut-off), the apex return of non-associated
  // Mohr–Coulomb (de Souza Neto, Perić & Owen 2008, § 8.2).
  if (sinPhi > 0 && sinPsi < sinPhi) {
    const apex = (c * cosPhi) / sinPhi, v = cutoff ? Math.min(apex, 0) : apex;
    RET[0] = v; RET[1] = v; RET[2] = v;
    activeCount = APEX;
    return true;
  }
  throw new Error("stress return failed");
}

/** Elastic tangent (4 × 4, Voigt with engineering shear) into `out`. */
function elasticTangent(lam: number, mu: number, out: Float64Array): void {
  out.fill(0);
  const d11 = lam + 2 * mu;
  out[0] = d11; out[1] = lam; out[3] = lam;
  out[4] = lam; out[5] = d11; out[7] = lam;
  out[10] = mu;
  out[12] = lam; out[13] = lam; out[15] = d11;
}

/**
 * Stress return for one Gauss point from the trial (elastic) stress σx, σy,
 * τxy, σz, without allocation: the returned stress in `sOut` (4) and, when
 * `tangent` is given, the consistent tangent in it (4 × 4, row-major).
 * @returns whether the point is plastic.
 */
export function returnMapInto(
  sx: number,
  sy: number,
  txy: number,
  sz: number,
  E: number,
  nu: number,
  c: number,
  sinPhi: number,
  cosPhi: number,
  cutoff: boolean,
  cu: number,
  sOut: Float64Array,
  tangent: Float64Array | null,
  sinPsi: number = sinPhi,
): boolean {
  const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const pm = (sx + sy) / 2, hd = (sx - sy) / 2;
  const rad = Math.sqrt(hd * hd + txy * txy);
  const sA = pm + rad, sB = pm - rad;
  const c2 = rad > 0 ? hd / rad : 1, s2 = rad > 0 ? txy / rad : 0;
  // order of (A, B, z), largest first: idx0..2 (0 = A, 1 = B, 2 = z), stable
  // for ties as the sort it replaces; pos* is each one's place in that order
  let idx0: number, idx1: number, idx2: number;
  if (sz > sA) { idx0 = 2; idx1 = 0; idx2 = 1; }
  else if (sz > sB) { idx0 = 0; idx1 = 2; idx2 = 1; }
  else { idx0 = 0; idx1 = 1; idx2 = 2; }
  const v0 = idx0 === 0 ? sA : sz, v1 = idx1 === 0 ? sA : idx1 === 1 ? sB : sz, v2 = idx2 === 1 ? sB : sz;
  const plastic = principalReturn(v0, v1, v2, lam, mu, c, sinPhi, cosPhi, cutoff, cu, sinPsi);
  if (!plastic) {
    sOut[0] = sx; sOut[1] = sy; sOut[2] = txy; sOut[3] = sz;
    if (tangent) elasticTangent(lam, mu, tangent);
    return false;
  }
  const posA = idx0 === 0 ? 0 : idx1 === 0 ? 1 : 2;
  const posB = idx0 === 1 ? 0 : idx1 === 1 ? 1 : 2;
  const posZ = 3 - posA - posB;
  const rA = RET[posA], rB = RET[posB], rZ = RET[posZ];
  const cc = (1 + c2) / 2, ss = (1 - c2) / 2, sc = s2 / 2;
  sOut[0] = rA * cc + rB * ss;
  sOut[1] = rA * ss + rB * cc;
  sOut[2] = (rA - rB) * sc;
  sOut[3] = rZ;
  if (!tangent) return true;
  // tangent in sorted principal space: D − D G (Aᵀ D G)⁻¹ Aᵀ D, with the
  // flow directions G (= A for associated flow, then symmetric)
  const d11 = lam + 2 * mu;
  for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) DEP[3 * p + q] = p === q ? d11 : lam;
  const n = activeCount;
  if (n === APEX) DEP.fill(0);
  for (let j = 0; j < n; j++) {
    const a = 3 * ACT[j];
    for (let i = 0; i < 3; i++) {
      DA[3 * j + i] = DEP[3 * i] * PG[a] + DEP[3 * i + 1] * PG[a + 1] + DEP[3 * i + 2] * PG[a + 2];
      DY[3 * j + i] = DEP[3 * i] * PA[a] + DEP[3 * i + 1] * PA[a + 1] + DEP[3 * i + 2] * PA[a + 2];
    }
  }
  for (let i = 0; i < n; i++) {
    const a = 3 * ACT[i];
    for (let j = 0; j < n; j++) MS[i * n + j] = PA[a] * DA[3 * j] + PA[a + 1] * DA[3 * j + 1] + PA[a + 2] * DA[3 * j + 2];
  }
  // M⁻¹ by solving for the identity columns
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) EC[i] = i === j ? 1 : 0;
    for (let k = 0; k < n * n; k++) MC[k] = MS[k];
    solveSmall(n, MC, EC);
    for (let i = 0; i < n; i++) MINV[i * n + j] = EC[i];
  }
  for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
    let s = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += DA[3 * i + p] * MINV[i * n + j] * DY[3 * j + q];
    DEP[3 * p + q] -= s;
  }
  // back to (A, B, z) order: Paa = Dep in the rows/columns of A, B, z
  const a3 = 3 * posA, b3 = 3 * posB, z3 = 3 * posZ;
  const dTrial = sA - sB;
  // For equal in-plane principal strains the quotient's limit is the
  // derivative (Dep_AA − Dep_AB)/2 (de Souza Neto et al. 2008, appendix A).
  const G = Math.abs(dTrial) > 1e-12 * (Math.abs(sA) + Math.abs(sB) + 1) ? (mu * (rA - rB)) / dTrial : (DEP[a3 + posA] - DEP[a3 + posB]) / 2;
  // principal-frame tangent in Voigt (A, B, AB, z)
  CP[0] = DEP[a3 + posA]; CP[1] = DEP[a3 + posB]; CP[2] = 0; CP[3] = DEP[a3 + posZ];
  CP[4] = DEP[b3 + posA]; CP[5] = DEP[b3 + posB]; CP[6] = 0; CP[7] = DEP[b3 + posZ];
  CP[8] = 0; CP[9] = 0; CP[10] = G; CP[11] = 0;
  CP[12] = DEP[z3 + posA]; CP[13] = DEP[z3 + posB]; CP[14] = 0; CP[15] = DEP[z3 + posZ];
  // strain transformation ε' = T ε for the principal direction at angle θ:
  // cos 2θ = c2, sin 2θ = s2
  TT[0] = cc; TT[1] = ss; TT[2] = sc; TT[3] = 0;
  TT[4] = ss; TT[5] = cc; TT[6] = -sc; TT[7] = 0;
  TT[8] = -2 * sc; TT[9] = 2 * sc; TT[10] = c2; TT[11] = 0;
  TT[12] = 0; TT[13] = 0; TT[14] = 0; TT[15] = 1;
  // C = Tᵀ Cp T
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += CP[4 * i + k] * TT[4 * k + j];
    CT[4 * i + j] = s;
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += TT[4 * k + i] * CT[4 * k + j];
    tangent[4 * i + j] = s;
  }
  return true;
}

/**
 * Stress return for one Gauss point from the trial (elastic) stress.
 * @param trial σx, σy, τxy, σz of the trial state.
 */
export function returnMap(
  trial: readonly [number, number, number, number],
  E: number,
  nu: number,
  c: number,
  sinPhi: number,
  cosPhi: number,
  cutoff: boolean,
  out: Float64Array,
  cu = Infinity,
): ReturnResult {
  const so = new Float64Array(4);
  const plastic = returnMapInto(trial[0], trial[1], trial[2], trial[3], E, nu, c, sinPhi, cosPhi, cutoff, cu, so, out);
  return { stress: [so[0], so[1], so[2], so[3]], tangent: out, plastic };
}

export interface NewtonState {
  /** Displacements per equation. */
  u: Float64Array;
  /** Plastic strain per Gauss point (εx, εy, γxy, εz). */
  ep: Float64Array;
  /** Stress per Gauss point (σx, σy, τxy, σz). */
  stress: Float64Array;
  /** Plastic axial strain of the reinforcement bars (2 per bar). */
  barEp: Float64Array;
  /** Reduction factor (the bars' passive capacity is divided by it). */
  F: number;
}

export interface NewtonOptions {
  /** Relative residual tolerance ‖r‖/‖f‖; default 1e-6. */
  tolerance?: number;
  /** Newton iterations per trial; default 200. */
  maxIterations?: number;
  tensionCutoff?: boolean;
}

/** Strength per Gauss point after reduction (see srm.ts). */
export interface GaussStrength {
  c: Float64Array;
  sinPhi: Float64Array;
  cosPhi: Float64Array;
  /** Undrained cap (Tresca) of a combined material; Infinity where there is none. */
  cu: Float64Array;
  /** sin ψ of the plastic potential (non-associated flow); absent: associated (ψ = φ). */
  sinPsi?: Float64Array;
}

/**
 * Internal force vector (and optionally the tangent) from displacements:
 * stresses by return from the trial ε(u) − εp of the last converged state.
 * @returns plastic strain increments are left in `epNew`.
 */
export function evaluate(
  model: FeModel,
  eqs: Int32Array,
  u: Float64Array,
  epOld: Float64Array,
  strength: GaussStrength,
  cutoff: boolean,
  fint: Float64Array,
  stress: Float64Array,
  epNew: Float64Array,
  K: SparseCholesky | null,
): void {
  const { gp, elementCount: ne, elE, elNu, elElastic } = model;
  fint.fill(0);
  if (K) { K.values.fill(0); K.upper?.fill(0); }
  const scatter = K ? scatterIndex(model, eqs, K) : null;
  const kv = K ? K.values : null, ku = K ? K.upper : null;
  const ue = EV_UE, C = EV_C, ke = EV_KE, fe = EV_FE, sig = EV_SIG;
  const sinPsi = strength.sinPsi;
  for (let e = 0; e < ne; e++) {
    for (let k = 0; k < 12; k++) { const q = eqs[12 * e + k]; ue[k] = q >= 0 ? u[q] : 0; }
    const E = elE[e], nu = elNu[e];
    const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
    fe.fill(0);
    if (K) ke.fill(0);
    for (let g = 0; g < 3; g++) {
      const i = 3 * e + g, o = i * GP_STRIDE, s = 4 * i, w = gp[o + 12];
      let ex = 0, ey = 0, gxy = 0;
      for (let k = 0; k < 6; k++) {
        const dx = gp[o + k], dy = gp[o + 6 + k];
        ex += dx * ue[2 * k]; ey += dy * ue[2 * k + 1]; gxy += dy * ue[2 * k] + dx * ue[2 * k + 1];
      }
      const eex = ex - epOld[s], eey = ey - epOld[s + 1], eg = gxy - epOld[s + 2], eez = -epOld[s + 3];
      const tr = eex + eey + eez;
      const t0 = lam * tr + 2 * mu * eex, t1 = lam * tr + 2 * mu * eey, t2 = mu * eg, t3 = lam * tr + 2 * mu * eez;
      if (elElastic[e]) {
        sig[0] = t0; sig[1] = t1; sig[2] = t2; sig[3] = t3;
        if (K) { C.fill(0); C[0] = lam + 2 * mu; C[1] = lam; C[4] = lam; C[5] = lam + 2 * mu; C[10] = mu; }
        epNew[s] = epOld[s]; epNew[s + 1] = epOld[s + 1]; epNew[s + 2] = epOld[s + 2]; epNew[s + 3] = epOld[s + 3];
      } else {
        returnMapInto(t0, t1, t2, t3, E, nu, strength.c[i], strength.sinPhi[i], strength.cosPhi[i], cutoff, strength.cu[i], sig, K ? C : null, sinPsi ? sinPsi[i] : strength.sinPhi[i]);
        // plastic strain increment = D⁻¹ (σ_trial − σ)
        const d0 = t0 - sig[0], d1 = t1 - sig[1], d2 = t2 - sig[2], d3 = t3 - sig[3];
        const dm = (d0 + d1 + d3) * nu / E;
        epNew[s] = epOld[s] + ((1 + nu) * d0) / E - dm;
        epNew[s + 1] = epOld[s + 1] + ((1 + nu) * d1) / E - dm;
        epNew[s + 2] = epOld[s + 2] + d2 / mu;
        epNew[s + 3] = epOld[s + 3] + ((1 + nu) * d3) / E - dm;
      }
      stress[s] = sig[0]; stress[s + 1] = sig[1]; stress[s + 2] = sig[2]; stress[s + 3] = sig[3];
      for (let k = 0; k < 6; k++) {
        const dx = gp[o + k], dy = gp[o + 6 + k];
        fe[2 * k] += (dx * sig[0] + dy * sig[2]) * w;
        fe[2 * k + 1] += (dy * sig[1] + dx * sig[2]) * w;
      }
      if (K && ku) {
        // unsymmetric tangent (non-associated flow): the whole of
        // ke += Bᵀ C B w, B rows (εx, εy, γxy)
        for (let a = 0; a < 6; a++) {
          const ax = gp[o + a], ay = gp[o + 6 + a];
          const rx0 = ax * C[0] + ay * C[8], rx1 = ax * C[1] + ay * C[9], rx2 = ax * C[2] + ay * C[10];
          const ry0 = ay * C[4] + ax * C[8], ry1 = ay * C[5] + ax * C[9], ry2 = ay * C[6] + ax * C[10];
          const rowX = 24 * a, rowY = 24 * a + 12;
          for (let b = 0; b < 6; b++) {
            const bx = gp[o + b], by = gp[o + 6 + b];
            ke[rowX + 2 * b] += w * (rx0 * bx + rx2 * by);
            ke[rowX + 2 * b + 1] += w * (rx1 * by + rx2 * bx);
            ke[rowY + 2 * b] += w * (ry0 * bx + ry2 * by);
            ke[rowY + 2 * b + 1] += w * (ry1 * by + ry2 * bx);
          }
        }
      } else if (K) {
        // ke += Bᵀ C B w with B rows (εx, εy, γxy); εz = 0. The in-plane
        // part of C is symmetric (associated flow); it is symmetrised
        // against round-off and only the lower triangle of ke is formed.
        const c00 = C[0], c01 = (C[1] + C[4]) / 2, c02 = (C[2] + C[8]) / 2;
        const c11 = C[5], c12 = (C[6] + C[9]) / 2, c22 = C[10];
        for (let a = 0; a < 6; a++) {
          const ax = gp[o + a], ay = gp[o + 6 + a];
          // rows of Bᵀ C for dof (a, x): ax*C[0,:] + ay*C[2,:]; (a, y): ay*C[1,:] + ax*C[2,:]
          const rx0 = ax * c00 + ay * c02, rx1 = ax * c01 + ay * c12, rx2 = ax * c02 + ay * c22;
          const ry0 = ay * c01 + ax * c02, ry1 = ay * c11 + ax * c12, ry2 = ay * c12 + ax * c22;
          const rowX = 24 * a, rowY = 24 * a + 12;
          for (let b = 0; b < a; b++) {
            const bx = gp[o + b], by = gp[o + 6 + b];
            ke[rowX + 2 * b] += w * (rx0 * bx + rx2 * by);
            ke[rowX + 2 * b + 1] += w * (rx1 * by + rx2 * bx);
            ke[rowY + 2 * b] += w * (ry0 * bx + ry2 * by);
            ke[rowY + 2 * b + 1] += w * (ry1 * by + ry2 * bx);
          }
          ke[rowX + 2 * a] += w * (rx0 * ax + rx2 * ay);
          ke[rowY + 2 * a] += w * (ry0 * ax + ry2 * ay);
          ke[rowY + 2 * a + 1] += w * (ry1 * ay + ry2 * ax);
        }
      }
    }
    for (let k = 0; k < 12; k++) { const q = eqs[12 * e + k]; if (q >= 0) fint[q] += fe[k]; }
    if (kv && ku && scatter) {
      // ke(a, b) is A(ia, ib): below the diagonal into `values`, above it
      // into `upper`, both at the position of the lower-triangle entry
      let t = 78 * e;
      for (let a = 0; a < 12; a++) {
        const ia = eqs[12 * e + a];
        for (let b = 0; b <= a; b++, t++) {
          const at = scatter[t];
          if (at < 0) continue;
          const lo = ke[12 * a + b], hi = ke[12 * b + a];
          if (ia > eqs[12 * e + b]) { kv[at] += lo; if (a !== b) ku[at] += hi; }
          else if (ia < eqs[12 * e + b]) { kv[at] += hi; ku[at] += lo; }
          else kv[at] += lo;
        }
      }
    } else if (kv && scatter) {
      let t = 78 * e;
      for (let a = 0; a < 12; a++) {
        for (let b = 0; b <= a; b++, t++) {
          const at = scatter[t];
          if (at >= 0) kv[at] += ke[12 * a + b];
        }
      }
    }
  }
}

// Work arrays of `evaluate` (one evaluation at a time per thread).
const EV_UE = new Float64Array(12), EV_C = new Float64Array(16), EV_KE = new Float64Array(144);
const EV_FE = new Float64Array(12), EV_SIG = new Float64Array(4);

/**
 * Position in the matrix values of each element's lower-triangle entries
 * (78 per element, row a ≥ column b of the 12 dofs; −1 for a fixed dof),
 * so that assembly does not search the pattern. Built once per model.
 */
const scatterCache = new WeakMap<FeModel, Int32Array>();
function scatterIndex(model: FeModel, eqs: Int32Array, K: SparseCholesky): Int32Array {
  let m = scatterCache.get(model);
  if (m) return m;
  m = new Int32Array(78 * model.elementCount);
  let t = 0;
  for (let e = 0; e < model.elementCount; e++) {
    for (let a = 0; a < 12; a++) {
      const ia = eqs[12 * e + a];
      for (let b = 0; b <= a; b++, t++) {
        const ib = eqs[12 * e + b];
        m[t] = ia >= 0 && ib >= 0 ? K.indexOf(ia, ib) : -1;
      }
    }
  }
  scatterCache.set(model, m);
  return m;
}

/**
 * Failure by stagnation: the residual has not fallen below STALL_FALL of
 * its value STALL_WINDOW iterations earlier. Near collapse the line search
 * takes short steps that lower the residual by 1–3 % per iteration for
 * 10–25 iterations before quadratic convergence sets in (V056), so the
 * window must be longer than that.
 */
const STALL_WINDOW = 30;
const STALL_FALL = 0.9;
/** Line search: at most LS_STEPS trial steps α = 1, ½, …, 2⁻⁹; sufficient decrease constant c (Nocedal & Wright's 10⁻⁴). */
const LS_STEPS = 10;
const ARMIJO_C = 1e-4;

/** The tangent matrices of a model (symmetric, unsymmetric), allocated once (trials of one model run one at a time per thread). */
const tangents = new WeakMap<FeModel, SparseCholesky>(), unsymmetricTangents = new WeakMap<FeModel, SparseCholesky>();
function tangentMatrix(model: FeModel, unsymmetric: boolean): SparseCholesky {
  const cache = unsymmetric ? unsymmetricTangents : tangents;
  let K = cache.get(model);
  if (!K) { K = model.K.emptyCopy(unsymmetric); cache.set(model, K); }
  return K;
}

export function norm2(a: Float64Array): number {
  let s = 0;
  for (const v of a) s += v * v;
  return Math.sqrt(s);
}

/**
 * Newton iterations at one F from `state` (updated in place on convergence).
 * @returns whether equilibrium was reached and how many iterations it took.
 */
export function newtonAtF(
  model: FeModel,
  eqs: Int32Array,
  strength: GaussStrength,
  state: NewtonState,
  options: NewtonOptions = {},
): { converged: boolean; iterations: number } {
  const tol = options.tolerance ?? 1e-6;
  // Away from collapse Newton converges in 5–15 iterations; near collapse
  // the line search can need 20–40, and the stagnation test ends a trial
  // beyond the limit load.
  const limit = options.maxIterations ?? 200;
  const cutoff = options.tensionCutoff ?? false;
  const neq = model.eqCount, ngp = 3 * model.elementCount;
  const fnorm = norm2(model.f);
  const u = state.u.slice();
  const fint = new Float64Array(neq), r = new Float64Array(neq), du = new Float64Array(neq);
  const stress = new Float64Array(4 * ngp), ep = new Float64Array(4 * ngp);
  const barEp = new Float64Array(state.barEp.length);
  const trialU = new Float64Array(neq);
  // With a dilation angle below the friction angle the consistent tangent
  // is unsymmetric and the system is solved by LU (sparse.ts).
  const sp = strength.sinPsi;
  let unsymmetric = false;
  if (sp) for (let i = 0; i < sp.length && !unsymmetric; i++) if (sp[i] !== strength.sinPhi[i]) unsymmetric = true;
  const K = tangentMatrix(model, unsymmetric);
  const residual = (uu: Float64Array, withK: boolean): number => {
    evaluate(model, eqs, uu, state.ep, strength, cutoff, fint, stress, ep, withK ? K : null);
    if (model.bars.count) barInternal(model, uu, state.barEp, state.F, fint, barEp, withK ? K : null);
    for (let i = 0; i < neq; i++) r[i] = model.f[i] - fint[i];
    return norm2(r);
  };
  let rn = residual(u, true);
  const history: number[] = [];
  for (let it = 1; it <= limit; it++) {
    if (rn <= tol * fnorm) {
      state.u.set(u); state.ep.set(ep); state.stress.set(stress); state.barEp.set(barEp);
      return { converged: true, iterations: it - 1 };
    }
    // Stagnation: beyond the limit load the residual stops falling.
    history.push(rn);
    if (it > STALL_WINDOW && rn > STALL_FALL * history[it - 1 - STALL_WINDOW]) return { converged: false, iterations: it };
    // The tangent of perfect plasticity is only positive semidefinite along
    // a mechanism that has formed; where the factorisation meets a pivot
    // ≤ 0 the step is taken with the elastic stiffness instead (the
    // initial stiffness method, e.g. Zienkiewicz & Taylor, The Finite
    // Element Method for Solid and Structural Mechanics, 6th ed., 2005,
    // ch. 3), which is always positive definite.
    let tangent = true;
    try {
      K.factor();
    } catch {
      tangent = false;
    }
    du.set(r);
    (tangent ? K : model.K).solve(du);
    // Backtracking line search with the sufficient decrease (Armijo)
    // condition on the merit ½‖r‖²: along the Newton direction its slope
    // is −‖r‖², so a step α is accepted when ‖r(u + αdu)‖² ≤ (1 − 2c·α)‖r‖²
    // (Dennis & Schnabel 1983, § 6.3 and 6.5; Nocedal & Wright 2006, § 3.1
    // and 11.2). The elastic stiffness gives no guaranteed descent
    // direction of the merit (its slope is −rᵀK_t K_e⁻¹ r), so plain
    // decrease is required then. A step that does not lower the residual
    // is never taken: if none is found the trial fails.
    const rn0 = rn;
    let alpha = 1, accepted = false, bestAlpha = 0, bestRn = rn0;
    for (let ls = 0; ls < LS_STEPS; ls++) {
      for (let i = 0; i < neq; i++) trialU[i] = u[i] + alpha * du[i];
      const rt = residual(trialU, true);
      if (rt < bestRn) { bestRn = rt; bestAlpha = alpha; }
      const target = tangent ? Math.sqrt(1 - 2 * ARMIJO_C * alpha) * rn0 : rn0;
      if (rt <= target) { accepted = true; break; }
      alpha /= 2;
    }
    if (bestAlpha === 0) return { converged: false, iterations: it };
    if (!accepted || alpha !== bestAlpha) {
      // The step with the lowest residual is taken; its stresses and
      // tangent are evaluated again (the trial points overwrote them).
      for (let i = 0; i < neq; i++) trialU[i] = u[i] + bestAlpha * du[i];
      residual(trialU, true);
    }
    u.set(trialU);
    rn = bestRn;
  }
  if (rn <= tol * fnorm) {
    state.u.set(u); state.ep.set(ep); state.stress.set(stress); state.barEp.set(barEp);
    return { converged: true, iterations: limit };
  }
  return { converged: false, iterations: limit };
}
