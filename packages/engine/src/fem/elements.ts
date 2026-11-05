/**
 * Six-node (quadratic) triangles in plane strain.
 *
 * Node order: corners 0, 1, 2 counter-clockwise, then the midside nodes
 * 3 (edge 0–1), 4 (edge 1–2) and 5 (edge 2–0). Shape functions in area
 * coordinates L1 = 1 − ξ − η, L2 = ξ, L3 = η (Zienkiewicz, Taylor & Zhu,
 * The Finite Element Method: Its Basis and Fundamentals, 7th ed., 2013).
 * Integration by the three-point rule at (1/6, 1/6), (2/3, 1/6),
 * (1/6, 2/3), exact for quadratics (Strang & Fix, An Analysis of the
 * Finite Element Method, 1973; Dunavant 1985, IJNME 21(6), 1129–1148), so
 * exact for the stiffness of a straight-sided T6 (BᵀDB is quadratic).
 *
 * Implementation choice: the six-node triangle, which has quadratic
 * displacements and fits unstructured meshes. Low-order elements can lock
 * under the constant-volume condition of plastic flow and then
 * overestimate collapse loads; Sloan & Randolph (1982, IJNAMG 6(1), 47–76)
 * recommend the 15-node triangle, and de Borst & Vermeer (1984,
 * Géotechnique 34(2), 199–210) discuss the element choice for frictional
 * soil. Adaptive refinement (adapt.ts) reduces the error of the T6.
 *
 * Stresses and strains carry four components (x, y, xy, z) so that the
 * out-of-plane stress of plane strain enters the yield criterion
 * (Smith, Griffiths & Margetts, Programming the Finite Element Method,
 * 5th ed., ch. 6). Tension is positive; γxy is the engineering shear strain.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { testCall } from "../facade/internal";

/** Gauss points of the three-point rule: ξ, η and weight (reference area 1/2). */
export const GAUSS_T6: readonly (readonly [number, number, number])[] = [
  [1 / 6, 1 / 6, 1 / 6],
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
];

/** Per Gauss point record: dN/dx (6), dN/dy (6), weight × det J. */
export const GP_STRIDE = 13;

/** Shape functions of the T6 at (ξ, η), written into `out` (length 6). */
export function shapeT6(xi: number, eta: number, out: Float64Array | number[]): void {
  const v = testCall<Float64Array>("fem/elements::shapeT6", [xi, eta]);
  for (let i = 0; i < 6; i++) out[i] = v[i];
}

/** Derivatives of the T6 shape functions: dN/dξ into out[0..5], dN/dη into out[6..11]. */
export function shapeDerivT6(xi: number, eta: number, out: Float64Array): void {
  out.set(testCall<Float64Array>("fem/elements::shapeDerivT6", [xi, eta]));
}

/**
 * Cartesian derivatives and integration weights of every Gauss point of
 * every element. Throws on an element with non-positive Jacobian.
 *
 * @param x,y Node coordinates.
 * @param el Element connectivity, 6 nodes per element.
 * @param ne Number of elements.
 * @returns Records of `GP_STRIDE` numbers, 3 per element.
 */
export function gaussData(x: Float64Array, y: Float64Array, el: Int32Array, ne: number): Float64Array {
  return testCall("fem/elements::gaussData", [x, y, el, ne]);
}

/** Lamé constants of an isotropic material from E and ν. */
export function lame(E: number, nu: number): { lambda: number; mu: number } {
  return testCall("fem/elements::lame", [E, nu]);
}

/**
 * Element stiffness Kₑ = Σ Bᵀ D B w|J| of a T6 (12 × 12, dofs ordered
 * u0, v0, u1, v1, …), for isotropic elasticity in plane strain.
 */
export function stiffnessT6(gp: Float64Array, e: number, E: number, nu: number, ke: Float64Array): void {
  ke.set(testCall<Float64Array>("fem/elements::stiffnessT6", [gp, e, E, nu, ke]).subarray(0, ke.length));
}
