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
 * which the flow of ψ < φ cannot reach, the stress returns to the apex.
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
 * does not converge fails (srm.ts). At a return to the apex of the
 * pyramid (all three principal stresses on the yield surface) the
 * tangent is 10⁻³ of the elastic one instead of zero (APEX_STIFFNESS): the
 * stress there is exact, but a cohesionless soil at the ground puts many
 * points at the apex, whose zero stiffness left Newton's direction no
 * descent direction of the residual, so that trials failed far below the
 * limit load (V049 with Davis B: 1.162 against 1.27 by the viscoplastic
 * iteration and Newton with this tangent).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { testCall } from "../facade/internal";

export interface ReturnResult {
  /** Stress after return (σx, σy, τxy, σz). */
  stress: [number, number, number, number];
  /** Consistent tangent (4 × 4, Voigt with engineering shear), row-major. */
  tangent: Float64Array;
  plastic: boolean;
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
  out: Float64Array,
  C: Float64Array | null,
  sinPsi?: number,
): boolean {
  const r = testCall<{ plastic: boolean; out: Float64Array; tangent?: Float64Array }>("fem/newton::returnMapInto", [
    sx, sy, txy, sz, E, nu, c, sinPhi, cosPhi, cutoff, cu, out, C, sinPsi,
  ]);
  out.set(r.out);
  if (C && r.tangent) C.set(r.tangent);
  return r.plastic;
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
): { stress: [number, number, number, number]; plastic: boolean } {
  const r = testCall<{ stress: Float64Array; plastic: boolean; tangent: Float64Array }>("fem/newton::returnMap", [
    trial, E, nu, c, sinPhi, cosPhi, cutoff, out, cu,
  ]);
  out.set(r.tangent.subarray(0, out.length));
  return { stress: [r.stress[0], r.stress[1], r.stress[2], r.stress[3]], plastic: r.plastic };
}

export function norm2(a: Float64Array): number {
  return testCall("fem/newton::norm2", [a]);
}
