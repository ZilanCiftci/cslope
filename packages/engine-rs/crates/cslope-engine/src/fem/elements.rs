//! Port of packages/engine/src/fem/elements.ts.
//!
//! Six-node (quadratic) triangles in plane strain.
//!
//! Node order: corners 0, 1, 2 counter-clockwise, then the midside nodes
//! 3 (edge 0–1), 4 (edge 1–2) and 5 (edge 2–0). Shape functions in area
//! coordinates L1 = 1 − ξ − η, L2 = ξ, L3 = η (Zienkiewicz, Taylor & Zhu,
//! The Finite Element Method: Its Basis and Fundamentals, 7th ed., 2013).
//! Integration by the three-point rule at (1/6, 1/6), (2/3, 1/6),
//! (1/6, 2/3), exact for quadratics (Strang & Fix, An Analysis of the
//! Finite Element Method, 1973; Dunavant 1985, IJNME 21(6), 1129–1148), so
//! exact for the stiffness of a straight-sided T6 (BᵀDB is quadratic).
//!
//! Implementation choice: the six-node triangle, which has quadratic
//! displacements and fits unstructured meshes. Low-order elements can lock
//! under the constant-volume condition of plastic flow and then
//! overestimate collapse loads; Sloan & Randolph (1982, IJNAMG 6(1), 47–76)
//! recommend the 15-node triangle, and de Borst & Vermeer (1984,
//! Géotechnique 34(2), 199–210) discuss the element choice for frictional
//! soil. Adaptive refinement (adapt.ts) reduces the error of the T6.
//!
//! Stresses and strains carry four components (x, y, xy, z) so that the
//! out-of-plane stress of plane strain enters the yield criterion
//! (Smith, Griffiths & Margetts, Programming the Finite Element Method,
//! 5th ed., ch. 6). Tension is positive; γxy is the engineering shear strain.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::error::{EngineError, Result};

/// Gauss points of the three-point rule: ξ, η and weight (reference area 1/2).
pub const GAUSS_T6: [[f64; 3]; 3] = [
    [1.0 / 6.0, 1.0 / 6.0, 1.0 / 6.0],
    [2.0 / 3.0, 1.0 / 6.0, 1.0 / 6.0],
    [1.0 / 6.0, 2.0 / 3.0, 1.0 / 6.0],
];

/// Shape functions of the T6 at (ξ, η), written into `out` (length 6).
pub fn shape_t6(xi: f64, eta: f64, out: &mut [f64]) {
    let l1 = 1.0 - xi - eta;
    out[0] = l1 * (2.0 * l1 - 1.0);
    out[1] = xi * (2.0 * xi - 1.0);
    out[2] = eta * (2.0 * eta - 1.0);
    out[3] = 4.0 * l1 * xi;
    out[4] = 4.0 * xi * eta;
    out[5] = 4.0 * eta * l1;
}

/// Derivatives of the T6 shape functions: dN/dξ into out[0..5], dN/dη into out[6..11].
pub fn shape_deriv_t6(xi: f64, eta: f64, out: &mut [f64]) {
    let l1 = 1.0 - xi - eta;
    out[0] = -(4.0 * l1 - 1.0);
    out[1] = 4.0 * xi - 1.0;
    out[2] = 0.0;
    out[3] = 4.0 * (l1 - xi);
    out[4] = 4.0 * eta;
    out[5] = -4.0 * eta;
    out[6] = -(4.0 * l1 - 1.0);
    out[7] = 0.0;
    out[8] = 4.0 * eta - 1.0;
    out[9] = -4.0 * xi;
    out[10] = 4.0 * xi;
    out[11] = 4.0 * (l1 - eta);
}

/// Per Gauss point record: dN/dx (6), dN/dy (6), weight × det J.
pub const GP_STRIDE: usize = 13;

/// Cartesian derivatives and integration weights of every Gauss point of
/// every element. An error on an element with non-positive Jacobian.
///
/// `x`, `y`: node coordinates; `el`: element connectivity, 6 nodes per
/// element; `ne`: number of elements. Returns records of `GP_STRIDE`
/// numbers, 3 per element.
pub fn gauss_data(x: &[f64], y: &[f64], el: &[usize], ne: usize) -> Result<Vec<f64>> {
    let mut out = vec![0.0f64; ne * 3 * GP_STRIDE];
    let mut d = [0.0f64; 12];
    for e in 0..ne {
        for (g, &[xi, eta, w]) in GAUSS_T6.iter().enumerate() {
            shape_deriv_t6(xi, eta, &mut d);
            let (mut j11, mut j12, mut j21, mut j22) = (0.0, 0.0, 0.0, 0.0);
            for k in 0..6 {
                let n = el[6 * e + k];
                j11 += d[k] * x[n];
                j12 += d[k] * y[n];
                j21 += d[6 + k] * x[n];
                j22 += d[6 + k] * y[n];
            }
            let det = j11 * j22 - j12 * j21;
            // (!(det > 0): NaN fails too)
            if det.is_nan() || det <= 0.0 {
                return Err(EngineError::new(format!(
                    "element {e} has a non-positive Jacobian"
                )));
            }
            let o = (3 * e + g) * GP_STRIDE;
            for k in 0..6 {
                out[o + k] = (j22 * d[k] - j12 * d[6 + k]) / det;
                out[o + 6 + k] = (-j21 * d[k] + j11 * d[6 + k]) / det;
            }
            out[o + 12] = w * det;
        }
    }
    Ok(out)
}

/// Lamé constants of an isotropic material.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lame {
    pub lambda: f64,
    pub mu: f64,
}

/// Lamé constants of an isotropic material from E and ν.
pub fn lame(e: f64, nu: f64) -> Lame {
    Lame {
        lambda: (e * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu)),
        mu: e / (2.0 * (1.0 + nu)),
    }
}

/// Element stiffness Kₑ = Σ Bᵀ D B w|J| of a T6 (12 × 12, dofs ordered
/// u0, v0, u1, v1, …), for isotropic elasticity in plane strain.
pub fn stiffness_t6(gp: &[f64], e: usize, young: f64, nu: f64, ke: &mut [f64]) {
    let Lame { lambda, mu } = lame(young, nu);
    let d11 = lambda + 2.0 * mu;
    let d12 = lambda;
    ke.fill(0.0);
    for g in 0..3 {
        let o = (3 * e + g) * GP_STRIDE;
        let w = gp[o + 12];
        for a in 0..6 {
            let ax = gp[o + a];
            let ay = gp[o + 6 + a];
            for b in 0..6 {
                let bx = gp[o + b];
                let by = gp[o + 6 + b];
                ke[24 * a + 2 * b] += w * (d11 * ax * bx + mu * ay * by);
                ke[24 * a + 2 * b + 1] += w * (d12 * ax * by + mu * ay * bx);
                ke[24 * a + 12 + 2 * b] += w * (d12 * ay * bx + mu * ax * by);
                ke[24 * a + 12 + 2 * b + 1] += w * (d11 * ay * by + mu * ax * bx);
            }
        }
    }
}
