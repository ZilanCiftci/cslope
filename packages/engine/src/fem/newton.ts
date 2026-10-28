/**
 * Newton–Raphson solution at one strength reduction factor, for associated
 * flow (Davis B or associated), with implicit stress return and the
 * consistent tangent.
 *
 * Stress return: the closest point, in the energy norm of the elastic
 * compliance, of the trial stress on the yield set in principal stress
 * space: the Mohr–Coulomb plane f = (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin φ − c cos φ
 * ≤ 0 and optionally the Rankine plane σ₁ ≤ 0, with the ordering
 * σ₁ ≥ σ₂ ≥ σ₃ as further planes, so that returns to an edge or the apex
 * of the pyramid come out of the same projection (Clausen, Damkilde &
 * Andersen 2006, IJNME 66, 1036–1059; de Souza Neto, Perić & Owen 2008,
 * Computational Methods for Plasticity, §8.2). The active planes are found
 * by enumeration (at most four planes in three dimensions).
 *
 * Tangent: in principal space D − D A (Aᵀ D A)⁻¹ Aᵀ D for the active planes
 * A, and in the plane of the principal directions the shear stiffness
 * (σ_A − σ_B) / (2(ε_A − ε_B)) of an isotropic tensor function (de Souza
 * Neto et al. 2008, appendix A), rotated to x, y. With associated flow it is
 * symmetric, so the system is solved by Cholesky; a step is accepted when
 * it reduces the residual (backtracking line search).
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

/** Solve a small dense symmetric system in place (Gaussian elimination); false if singular. */
function solveSmall(n: number, a: number[], b: number[]): boolean {
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

const SUBSETS: number[][] = [];
for (let mask = 1; mask < 16; mask++) {
  const s: number[] = [];
  for (let k = 0; k < 4; k++) if (mask & (1 << k)) s.push(k);
  if (s.length <= 3) SUBSETS.push(s);
}
SUBSETS.sort((a, b) => a.length - b.length);

/**
 * Closest-point return in sorted principal space.
 * @returns the returned stresses and the active planes, or null if elastic.
 */
function principalReturn(
  s: [number, number, number],
  lam: number,
  mu: number,
  c: number,
  sinPhi: number,
  cosPhi: number,
  cutoff: boolean,
): { s: [number, number, number]; active: number[][] } | null {
  // planes aᵀσ ≤ b: 0 Mohr–Coulomb, 1 Rankine, 2 σ₂ ≤ σ₁, 3 σ₃ ≤ σ₂
  const A = [
    [(1 + sinPhi) / 2, 0, -(1 - sinPhi) / 2],
    [1, 0, 0],
    [-1, 1, 0],
    [0, -1, 1],
  ];
  const B = [c * cosPhi, 0, 0, 0];
  const use = [true, cutoff, true, true];
  const tolF = 1e-10 * (Math.abs(s[0]) + Math.abs(s[2]) + c + 1);
  const f = (k: number, v: readonly number[]) => A[k][0] * v[0] + A[k][1] * v[1] + A[k][2] * v[2] - B[k];
  if (f(0, s) <= tolF && (!cutoff || f(1, s) <= tolF)) return null;
  const Dv = (a: number[]) => {
    const tr = a[0] + a[1] + a[2];
    return [lam * tr + 2 * mu * a[0], lam * tr + 2 * mu * a[1], lam * tr + 2 * mu * a[2]];
  };
  for (const S of SUBSETS) {
    if (S.some((k) => !use[k])) continue;
    if (!S.includes(0) && !S.includes(1)) continue; // ordering alone is not a return
    const n = S.length;
    const DA = S.map((k) => Dv(A[k]));
    const M: number[] = [];
    const rhs: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) M.push(A[S[i]][0] * DA[j][0] + A[S[i]][1] * DA[j][1] + A[S[i]][2] * DA[j][2]);
      rhs.push(f(S[i], s));
    }
    if (!solveSmall(n, M, rhs)) continue;
    if (rhs.some((l) => l < -1e-12 * (Math.abs(rhs[0]) + 1e-300))) continue;
    const out: [number, number, number] = [s[0], s[1], s[2]];
    for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) out[d] -= DA[i][d] * rhs[i];
    let ok = true;
    for (let k = 0; k < 4 && ok; k++) if (use[k] && !S.includes(k) && f(k, out) > tolF) ok = false;
    if (ok) return { s: out, active: S.map((k) => A[k]) };
  }
  throw new Error("stress return failed");
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
): ReturnResult {
  const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const [sx, sy, txy, sz] = trial;
  const pm = (sx + sy) / 2, hd = (sx - sy) / 2;
  const rad = Math.sqrt(hd * hd + txy * txy);
  const sA = pm + rad, sB = pm - rad;
  const c2 = rad > 0 ? hd / rad : 1, s2 = rad > 0 ? txy / rad : 0;
  // order of (A, B, z), largest first
  const pv = [sA, sB, sz];
  const idx = [0, 1, 2].sort((i, j) => pv[j] - pv[i]);
  const sorted: [number, number, number] = [pv[idx[0]], pv[idx[1]], pv[idx[2]]];
  const r = principalReturn(sorted, lam, mu, c, sinPhi, cosPhi, cutoff);
  const elastic = () => {
    out.fill(0);
    const d11 = lam + 2 * mu;
    out[0] = d11; out[1] = lam; out[3] = lam;
    out[4] = lam; out[5] = d11; out[7] = lam;
    out[10] = mu;
    out[12] = lam; out[13] = lam; out[15] = d11;
  };
  if (!r) {
    elastic();
    return { stress: [sx, sy, txy, sz], tangent: out, plastic: false };
  }
  // tangent in sorted principal space
  const D3 = [lam + 2 * mu, lam, lam, lam, lam + 2 * mu, lam, lam, lam, lam + 2 * mu];
  const Dep = D3.slice();
  const n = r.active.length;
  const DA = r.active.map((a) => [0, 1, 2].map((i) => D3[3 * i] * a[0] + D3[3 * i + 1] * a[1] + D3[3 * i + 2] * a[2]));
  const M: number[] = [];
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) M.push(r.active[i][0] * DA[j][0] + r.active[i][1] * DA[j][1] + r.active[i][2] * DA[j][2]);
  // Minv via solving for identity columns
  const Minv: number[] = new Array(n * n).fill(0);
  for (let j = 0; j < n; j++) {
    const e = new Array(n).fill(0); e[j] = 1;
    solveSmall(n, M.slice(), e);
    for (let i = 0; i < n; i++) Minv[i * n + j] = e[i];
  }
  for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) {
    let s = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) s += DA[i][p] * Minv[i * n + j] * DA[j][q];
    Dep[3 * p + q] -= s;
  }
  // back to (A, B, z) order
  const pos = [0, 0, 0];
  idx.forEach((k, i) => (pos[k] = i));
  const ret = [r.s[pos[0]], r.s[pos[1]], r.s[pos[2]]];
  const P = (i: number, j: number) => Dep[3 * pos[i] + pos[j]]; // i, j in A=0, B=1, z=2
  const dTrial = sA - sB;
  const G = Math.abs(dTrial) > 1e-12 * (Math.abs(sA) + Math.abs(sB) + 1) ? (mu * (ret[0] - ret[1])) / dTrial : mu;
  // principal-frame tangent in Voigt (A, B, AB, z)
  const Cp = [
    P(0, 0), P(0, 1), 0, P(0, 2),
    P(1, 0), P(1, 1), 0, P(1, 2),
    0, 0, G, 0,
    P(2, 0), P(2, 1), 0, P(2, 2),
  ];
  // strain transformation ε' = T ε for the principal direction at angle θ:
  // cos 2θ = c2, sin 2θ = s2
  const cc = (1 + c2) / 2, ss = (1 - c2) / 2, sc = s2 / 2;
  const T = [
    cc, ss, sc, 0,
    ss, cc, -sc, 0,
    -2 * sc, 2 * sc, c2, 0,
    0, 0, 0, 1,
  ];
  // C = Tᵀ Cp T
  const CT = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += Cp[4 * i + k] * T[4 * k + j];
    CT[4 * i + j] = s;
  }
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += T[4 * k + i] * CT[4 * k + j];
    out[4 * i + j] = s;
  }
  const rA = ret[0], rB = ret[1];
  const stress: [number, number, number, number] = [
    rA * cc + rB * ss,
    rA * ss + rB * cc,
    (rA - rB) * sc,
    ret[2],
  ];
  return { stress, tangent: out, plastic: true };
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
  /** Newton iterations per trial; default 25. */
  maxIterations?: number;
  tensionCutoff?: boolean;
}

/** Strength per Gauss point after reduction (see srm.ts). */
export interface GaussStrength {
  c: Float64Array;
  sinPhi: Float64Array;
  cosPhi: Float64Array;
}

/**
 * Internal force vector (and optionally the tangent) from displacements:
 * stresses by return from the trial ε(u) − εp of the last converged state.
 * @returns plastic strain increments are left in `epNew`.
 */
function evaluate(
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
  if (K) K.values.fill(0);
  const ue = new Float64Array(12);
  const C = new Float64Array(16);
  const ke = new Float64Array(144);
  const fe = new Float64Array(12);
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
      const trial: [number, number, number, number] = [lam * tr + 2 * mu * eex, lam * tr + 2 * mu * eey, mu * eg, lam * tr + 2 * mu * eez];
      let sig = trial;
      if (elElastic[e]) {
        C.fill(0);
        C[0] = lam + 2 * mu; C[1] = lam; C[4] = lam; C[5] = lam + 2 * mu; C[10] = mu;
        epNew[s] = epOld[s]; epNew[s + 1] = epOld[s + 1]; epNew[s + 2] = epOld[s + 2]; epNew[s + 3] = epOld[s + 3];
      } else {
        const r = returnMap(trial, E, nu, strength.c[i], strength.sinPhi[i], strength.cosPhi[i], cutoff, C);
        sig = r.stress;
        // plastic strain increment = D⁻¹ (σ_trial − σ)
        const d0 = trial[0] - sig[0], d1 = trial[1] - sig[1], d2 = trial[2] - sig[2], d3 = trial[3] - sig[3];
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
      if (K) {
        // ke += Bᵀ C B w with B rows (εx, εy, γxy); εz = 0
        for (let a = 0; a < 6; a++) {
          const ax = gp[o + a], ay = gp[o + 6 + a];
          // rows of Bᵀ C for dof (a, x): ax*C[0,:] + ay*C[2,:]; (a, y): ay*C[1,:] + ax*C[2,:]
          const rx0 = ax * C[0] + ay * C[8], rx1 = ax * C[1] + ay * C[9], rx2 = ax * C[2] + ay * C[10];
          const ry0 = ay * C[4] + ax * C[8], ry1 = ay * C[5] + ax * C[9], ry2 = ay * C[6] + ax * C[10];
          for (let b = 0; b < 6; b++) {
            const bx = gp[o + b], by = gp[o + 6 + b];
            ke[24 * a + 2 * b] += w * (rx0 * bx + rx2 * by);
            ke[24 * a + 2 * b + 1] += w * (rx1 * by + rx2 * bx);
            ke[24 * a + 12 + 2 * b] += w * (ry0 * bx + ry2 * by);
            ke[24 * a + 12 + 2 * b + 1] += w * (ry1 * by + ry2 * bx);
          }
        }
      }
    }
    for (let k = 0; k < 12; k++) { const q = eqs[12 * e + k]; if (q >= 0) fint[q] += fe[k]; }
    if (K) {
      for (let a = 0; a < 12; a++) {
        const ia = eqs[12 * e + a];
        if (ia < 0) continue;
        for (let b = 0; b <= a; b++) {
          const ib = eqs[12 * e + b];
          // symmetric tangent: average the two triangles against round-off
          if (ib >= 0) K.add(ia, ib, a === b ? ke[12 * a + b] : 0.5 * (ke[12 * a + b] + ke[12 * b + a]));
        }
      }
    }
  }
}

/** Iterations over which the residual must fall by 10 % (see newtonAtF). */
const STALL_WINDOW = 5;

function norm2(a: Float64Array): number {
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
  // Away from collapse Newton converges in 5–15 iterations; a trial that
  // needs more than 25 is within the F tolerance of collapse or beyond it.
  const limit = options.maxIterations ?? 25;
  const cutoff = options.tensionCutoff ?? false;
  const neq = model.eqCount, ngp = 3 * model.elementCount;
  const fnorm = norm2(model.f);
  const u = state.u.slice();
  const fint = new Float64Array(neq), r = new Float64Array(neq), du = new Float64Array(neq);
  const stress = new Float64Array(4 * ngp), ep = new Float64Array(4 * ngp);
  const barEp = new Float64Array(state.barEp.length);
  const trialU = new Float64Array(neq);
  const K = model.K.emptyCopy();
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
    if (it > STALL_WINDOW + 5 && rn > 0.9 * history[it - 1 - STALL_WINDOW]) return { converged: false, iterations: it };
    try {
      K.factor();
    } catch {
      return { converged: false, iterations: it };
    }
    du.set(r);
    K.solve(du);
    // backtracking line search on the residual norm
    let alpha = 1, accepted = false;
    for (let ls = 0; ls < 6; ls++) {
      for (let i = 0; i < neq; i++) trialU[i] = u[i] + alpha * du[i];
      const rt = residual(trialU, false);
      if (rt < rn || ls === 5) { accepted = rt < rn; u.set(trialU); rn = rt; break; }
      alpha /= 2;
    }
    if (!accepted && rn > 10 * fnorm) return { converged: false, iterations: it };
    rn = residual(u, true);
  }
  if (rn <= tol * fnorm) {
    state.u.set(u); state.ep.set(ep); state.stress.set(stress); state.barEp.set(barEp);
    return { converged: true, iterations: limit };
  }
  return { converged: false, iterations: limit };
}
