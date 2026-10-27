/**
 * Six-node (quadratic) triangles in plane strain.
 *
 * Node order: corners 0, 1, 2 counter-clockwise, then the midside nodes
 * 3 (edge 0–1), 4 (edge 1–2) and 5 (edge 2–0). Shape functions in area
 * coordinates L1 = 1 − ξ − η, L2 = ξ, L3 = η (Zienkiewicz, Taylor & Zhu,
 * The Finite Element Method, 7th ed., §6.3). Integration by the
 * three-point rule at (1/6, 1/6), (2/3, 1/6), (1/6, 2/3), which is exact
 * for the stiffness of a straight-sided T6 (BᵀDB is quadratic).
 *
 * Stresses and strains carry four components (x, y, xy, z) so that the
 * out-of-plane stress of plane strain enters the yield criterion
 * (Smith, Griffiths & Margetts, Programming the Finite Element Method,
 * 5th ed., ch. 6). Tension is positive; γxy is the engineering shear strain.
 */

/** Gauss points of the three-point rule: ξ, η and weight (reference area 1/2). */
export const GAUSS_T6: readonly (readonly [number, number, number])[] = [
  [1 / 6, 1 / 6, 1 / 6],
  [2 / 3, 1 / 6, 1 / 6],
  [1 / 6, 2 / 3, 1 / 6],
];

/** Shape functions of the T6 at (ξ, η), written into `out` (length 6). */
export function shapeT6(xi: number, eta: number, out: Float64Array | number[]): void {
  const l1 = 1 - xi - eta;
  out[0] = l1 * (2 * l1 - 1);
  out[1] = xi * (2 * xi - 1);
  out[2] = eta * (2 * eta - 1);
  out[3] = 4 * l1 * xi;
  out[4] = 4 * xi * eta;
  out[5] = 4 * eta * l1;
}

/** Derivatives of the T6 shape functions: dN/dξ into out[0..5], dN/dη into out[6..11]. */
export function shapeDerivT6(xi: number, eta: number, out: Float64Array): void {
  const l1 = 1 - xi - eta;
  out[0] = -(4 * l1 - 1);
  out[1] = 4 * xi - 1;
  out[2] = 0;
  out[3] = 4 * (l1 - xi);
  out[4] = 4 * eta;
  out[5] = -4 * eta;
  out[6] = -(4 * l1 - 1);
  out[7] = 0;
  out[8] = 4 * eta - 1;
  out[9] = -4 * xi;
  out[10] = 4 * xi;
  out[11] = 4 * (l1 - eta);
}

/** Per Gauss point record: dN/dx (6), dN/dy (6), weight × det J. */
export const GP_STRIDE = 13;

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
  const out = new Float64Array(ne * 3 * GP_STRIDE);
  const d = new Float64Array(12);
  for (let e = 0; e < ne; e++) {
    for (let g = 0; g < 3; g++) {
      const [xi, eta, w] = GAUSS_T6[g];
      shapeDerivT6(xi, eta, d);
      let j11 = 0, j12 = 0, j21 = 0, j22 = 0;
      for (let k = 0; k < 6; k++) {
        const n = el[6 * e + k];
        j11 += d[k] * x[n]; j12 += d[k] * y[n];
        j21 += d[6 + k] * x[n]; j22 += d[6 + k] * y[n];
      }
      const det = j11 * j22 - j12 * j21;
      if (!(det > 0)) throw new Error(`element ${e} has a non-positive Jacobian`);
      const o = (3 * e + g) * GP_STRIDE;
      for (let k = 0; k < 6; k++) {
        out[o + k] = (j22 * d[k] - j12 * d[6 + k]) / det;
        out[o + 6 + k] = (-j21 * d[k] + j11 * d[6 + k]) / det;
      }
      out[o + 12] = w * det;
    }
  }
  return out;
}

/** Lamé constants of an isotropic material from E and ν. */
export function lame(E: number, nu: number): { lambda: number; mu: number } {
  return { lambda: (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu: E / (2 * (1 + nu)) };
}

/**
 * Element stiffness Kₑ = Σ Bᵀ D B w|J| of a T6 (12 × 12, dofs ordered
 * u0, v0, u1, v1, …), for isotropic elasticity in plane strain.
 */
export function stiffnessT6(gp: Float64Array, e: number, E: number, nu: number, ke: Float64Array): void {
  const { lambda, mu } = lame(E, nu);
  const d11 = lambda + 2 * mu, d12 = lambda;
  ke.fill(0);
  for (let g = 0; g < 3; g++) {
    const o = (3 * e + g) * GP_STRIDE, w = gp[o + 12];
    for (let a = 0; a < 6; a++) {
      const ax = gp[o + a], ay = gp[o + 6 + a];
      for (let b = 0; b < 6; b++) {
        const bx = gp[o + b], by = gp[o + 6 + b];
        ke[24 * a + 2 * b] += w * (d11 * ax * bx + mu * ay * by);
        ke[24 * a + 2 * b + 1] += w * (d12 * ax * by + mu * ay * bx);
        ke[24 * a + 12 + 2 * b] += w * (d12 * ay * bx + mu * ax * by);
        ke[24 * a + 12 + 2 * b + 1] += w * (d11 * ay * by + mu * ax * bx);
      }
    }
  }
}
