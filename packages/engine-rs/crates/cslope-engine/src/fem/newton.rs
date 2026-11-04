//! Port of packages/engine/src/fem/newton.ts.
//!
//! Newton–Raphson solution at one strength reduction factor, with implicit
//! stress return and the consistent tangent: associated flow (Davis B or
//! associated) and, as an option, non-associated flow (srm.rs).
//!
//! Stress return: the closest point, in the energy norm of the elastic
//! compliance, of the trial stress on the yield set in principal stress
//! space: the Mohr–Coulomb plane f = (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin φ − c cos φ
//! ≤ 0, optionally the Rankine plane σ₁ ≤ 0 and, for a combined material
//! (the lesser of the drained and undrained strength), the Tresca plane
//! (σ₁ − σ₃)/2 ≤ cu, with the ordering
//! σ₁ ≥ σ₂ ≥ σ₃ as further planes, so that returns to an edge or the apex
//! of the pyramid come out of the same projection (Clausen, Damkilde &
//! Andersen 2006, IJNME 66, 1036–1059; de Souza Neto, Perić & Owen 2008,
//! Computational Methods for Plasticity, Wiley 2008, ch. 8). The active planes are found
//! by enumeration (at most three of the five planes active in three
//! dimensions).
//!
//! Tangent: in principal space D − D A (Aᵀ D A)⁻¹ Aᵀ D for the active planes
//! A, and in the plane of the principal directions the shear stiffness
//! (σ_A − σ_B) / (2(ε_A − ε_B)) of an isotropic tensor function (de Souza
//! Neto et al. 2008, appendix A), rotated to x, y. With associated flow it is
//! symmetric, so the system is solved by Cholesky (sparse.rs). With a
//! dilation angle ψ < φ the plastic flow follows the potential's normal G
//! and the tangent D − D G (Aᵀ D G)⁻¹ Aᵀ D is unsymmetric (de Souza Neto et
//! al. 2008, § 8.3), solved by LU on the same pattern; beyond the apex,
//! which the flow of ψ < φ cannot reach, the stress returns to the apex.
//!
//! Globalisation: backtracking line search with the sufficient decrease
//! (Armijo) condition on ½‖r‖², halving the step (Dennis & Schnabel,
//! Numerical Methods for Unconstrained Optimization and Nonlinear
//! Equations, 1983, ch. 6; Nocedal & Wright, Numerical Optimization, 2nd
//! ed., 2006, ch. 3 and 11). Where the tangent is singular (a mechanism has
//! formed) the step uses the elastic stiffness (initial stiffness method).
//!
//! Implementation choices (not from the literature): convergence at a
//! residual of 10⁻⁶ of the load, at most 200 iterations, and failure when
//! no step lowers the residual or it has not fallen by 10 % over 30
//! iterations (beyond the limit load it stagnates). A trial that Newton
//! does not converge fails (srm.rs). At a return to the apex of the
//! pyramid (all three principal stresses on the yield surface) the
//! tangent is 10⁻³ of the elastic one instead of zero (APEX_STIFFNESS): the
//! stress there is exact, but a cohesionless soil at the ground puts many
//! points at the apex, whose zero stiffness left Newton's direction no
//! descent direction of the residual, so that trials failed far below the
//! limit load (V049 with Davis B: 1.162 against 1.27 by the viscoplastic
//! iteration and Newton with this tangent).
//!
//! Rust notes: the module's work arrays are locals (one return at a time
//! per call); the tangent matrix, cached per model in TypeScript, is made
//! for each `newton_at_f` call from the model's pattern (its values are
//! zeroed before every assembly either way).

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

use crate::error::{EngineError, Result};
use crate::fem::bars::bar_internal;
use crate::fem::elements::GP_STRIDE;
use crate::fem::model::FeModel;
use crate::fem::piles::beam_internal;
use crate::fem::sparse::SparseCholesky;
use crate::js;

/// Result of `return_map`: the returned stress (the tangent is in the caller's array).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ReturnResult {
    /// Stress after return (σx, σy, τxy, σz).
    pub stress: [f64; 4],
    pub plastic: bool,
}

/// Solve a small dense system in place (Gaussian elimination with partial pivoting); false if singular.
fn solve_small(n: usize, a: &mut [f64], b: &mut [f64]) -> bool {
    for k in 0..n {
        let mut p = k;
        for i in k + 1..n {
            if a[i * n + k].abs() > a[p * n + k].abs() {
                p = i;
            }
        }
        if a[p * n + k].abs() < 1e-12 * (a[0].abs() + 1e-300) {
            return false;
        }
        if p != k {
            for j in 0..n {
                a.swap(k * n + j, p * n + j);
            }
            b.swap(k, p);
        }
        for i in k + 1..n {
            let m = a[i * n + k] / a[k * n + k];
            for j in k..n {
                a[i * n + j] -= m * a[k * n + j];
            }
            b[i] -= m * b[k];
        }
    }
    for i in (0..n).rev() {
        let mut s = b[i];
        for j in i + 1..n {
            s -= a[i * n + j] * b[j];
        }
        b[i] = s / a[i * n + i];
    }
    true
}

/// Candidate active sets of the closest-point return: subsets of the five
/// planes with at most three members, smallest first, as bit masks (a stable
/// sort by size of the masks in increasing order).
const SUBSET_MASKS: [u32; 25] = subset_masks();

const fn subset_masks() -> [u32; 25] {
    let mut out = [0u32; 25];
    let mut n = 0;
    let mut size = 1;
    while size <= 3 {
        let mut mask = 1u32;
        while mask < 32 {
            if mask.count_ones() == size {
                out[n] = mask;
                n += 1;
            }
            mask += 1;
        }
        size += 1;
    }
    out
}

/// activeCount of a return to the apex of ψ < φ: the stress is fixed there (tangent: APEX_STIFFNESS).
const APEX: i32 = -1;
/// Tangent at a return to the apex, as a fraction of the elastic one (see the header).
const APEX_STIFFNESS: f64 = 1e-3;

/// Work arrays of the stress return (TypeScript's module-level PA, PB, PG,
/// ACT, RET and activeCount): the planes aᵀσ ≤ b (A, 5 × 3; B), the flow
/// directions G, the active set and the returned principal stresses.
struct Planes {
    pa: [f64; 15],
    pb: [f64; 5],
    pg: [f64; 15],
    act: [usize; 3],
    active_count: i32,
    ret: [f64; 3],
}

impl Planes {
    fn plane(&self, k: usize, v0: f64, v1: f64, v2: f64) -> f64 {
        self.pa[3 * k] * v0 + self.pa[3 * k + 1] * v1 + self.pa[3 * k + 2] * v2 - self.pb[k]
    }
}

/// Closest-point return in sorted principal space (s0 ≥ s1 ≥ s2): the
/// returned stresses in `ret` and the active planes in `act` / `active_count`.
/// Returns false if elastic.
fn principal_return(
    pl: &mut Planes,
    s0: f64,
    s1: f64,
    s2: f64,
    lam: f64,
    mu: f64,
    c: f64,
    sin_phi: f64,
    cos_phi: f64,
    cutoff: bool,
    cu: f64,
    sin_psi: f64,
) -> Result<bool> {
    // planes aᵀσ ≤ b: 0 Mohr–Coulomb, 1 Rankine, 2 σ₂ ≤ σ₁, 3 σ₃ ≤ σ₂,
    // 4 Tresca (σ₁ − σ₃)/2 ≤ cu, the undrained cap of a combined material.
    // The plastic flow is along g (PG): the plane's normal, except for the
    // Mohr–Coulomb plane with a dilation angle ψ < φ (non-associated flow),
    // whose potential (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin ψ has the normal
    // ((1 + sin ψ)/2, 0, −(1 − sin ψ)/2).
    let tresca = cu.is_finite();
    pl.pa = [
        (1.0 + sin_phi) / 2.0,
        0.0,
        -(1.0 - sin_phi) / 2.0,
        1.0,
        0.0,
        0.0,
        -1.0,
        1.0,
        0.0,
        0.0,
        -1.0,
        1.0,
        0.5,
        0.0,
        -0.5,
    ];
    pl.pb = [c * cos_phi, 0.0, 0.0, 0.0, if tresca { cu } else { 0.0 }];
    pl.pg = pl.pa;
    pl.pg[0] = (1.0 + sin_psi) / 2.0;
    pl.pg[2] = -(1.0 - sin_psi) / 2.0;
    let use_mask: u32 = 1 | (if cutoff { 2 } else { 0 }) | 4 | 8 | (if tresca { 16 } else { 0 });
    let tol_f = 1e-10 * (s0.abs() + s2.abs() + c + (if tresca { cu } else { 0.0 }) + 1.0);
    if pl.plane(0, s0, s1, s2) <= tol_f
        && (!cutoff || pl.plane(1, s0, s1, s2) <= tol_f)
        && (!tresca || pl.plane(4, s0, s1, s2) <= tol_f)
    {
        return Ok(false);
    }
    let mut da = [0.0f64; 9];
    let mut ms = [0.0f64; 9];
    let mut rhs = [0.0f64; 3];
    for &mask in SUBSET_MASKS.iter() {
        if mask & !use_mask != 0 {
            continue;
        }
        if mask & (1 | 2 | 16) == 0 {
            continue; // ordering alone is not a return
        }
        let mut n = 0;
        for k in 0..5 {
            if mask & (1 << k) != 0 {
                pl.act[n] = k;
                n += 1;
            }
        }
        for j in 0..n {
            let a = 3 * pl.act[j];
            let tr = pl.pg[a] + pl.pg[a + 1] + pl.pg[a + 2];
            da[3 * j] = lam * tr + 2.0 * mu * pl.pg[a];
            da[3 * j + 1] = lam * tr + 2.0 * mu * pl.pg[a + 1];
            da[3 * j + 2] = lam * tr + 2.0 * mu * pl.pg[a + 2];
        }
        for i in 0..n {
            let a = 3 * pl.act[i];
            for j in 0..n {
                ms[i * n + j] = pl.pa[a] * da[3 * j]
                    + pl.pa[a + 1] * da[3 * j + 1]
                    + pl.pa[a + 2] * da[3 * j + 2];
            }
            rhs[i] = pl.plane(pl.act[i], s0, s1, s2);
        }
        if !solve_small(n, &mut ms, &mut rhs) {
            continue;
        }
        let mut negative = false;
        for i in 0..n {
            if rhs[i] < -1e-12 * (rhs[0].abs() + 1e-300) {
                negative = true;
            }
        }
        if negative {
            continue;
        }
        let (mut o0, mut o1, mut o2) = (s0, s1, s2);
        for i in 0..n {
            o0 -= da[3 * i] * rhs[i];
            o1 -= da[3 * i + 1] * rhs[i];
            o2 -= da[3 * i + 2] * rhs[i];
        }
        let mut ok = true;
        let mut k = 0;
        while k < 5 && ok {
            if (use_mask >> k) & 1 != 0 && (mask >> k) & 1 == 0 && pl.plane(k, o0, o1, o2) > tol_f {
                ok = false;
            }
            k += 1;
        }
        if ok {
            pl.ret = [o0, o1, o2];
            pl.active_count = n as i32;
            return Ok(true);
        }
    }
    // Beyond the apex with ψ < φ the deviatoric flow cannot reach the yield
    // set: the stress returns to the apex σ₁ = σ₂ = σ₃ = c cot φ (or to zero
    // under the tension cut-off), the apex return of non-associated
    // Mohr–Coulomb (de Souza Neto, Perić & Owen 2008, § 8.2).
    if sin_phi > 0.0 && sin_psi < sin_phi {
        let apex = (c * cos_phi) / sin_phi;
        let v = if cutoff {
            js::math::min(apex, 0.0)
        } else {
            apex
        };
        pl.ret = [v, v, v];
        pl.active_count = APEX;
        return Ok(true);
    }
    Err(EngineError::new("stress return failed"))
}

/// Elastic tangent (4 × 4, Voigt with engineering shear) into `out`.
fn elastic_tangent(lam: f64, mu: f64, out: &mut [f64]) {
    out[..16].fill(0.0);
    let d11 = lam + 2.0 * mu;
    out[0] = d11;
    out[1] = lam;
    out[3] = lam;
    out[4] = lam;
    out[5] = d11;
    out[7] = lam;
    out[10] = mu;
    out[12] = lam;
    out[13] = lam;
    out[15] = d11;
}

/// Stress return for one Gauss point from the trial (elastic) stress σx, σy,
/// τxy, σz, without allocation: the returned stress in `s_out` (4) and, when
/// `tangent` is given, the consistent tangent in it (4 × 4, row-major).
/// Returns whether the point is plastic. `sin_psi` is TypeScript's optional
/// last parameter (default sin φ: associated flow).
pub fn return_map_into(
    sx: f64,
    sy: f64,
    txy: f64,
    sz: f64,
    young: f64,
    nu: f64,
    c: f64,
    sin_phi: f64,
    cos_phi: f64,
    cutoff: bool,
    cu: f64,
    s_out: &mut [f64],
    tangent: Option<&mut [f64]>,
    sin_psi: f64,
) -> Result<bool> {
    let lam = (young * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
    let mu = young / (2.0 * (1.0 + nu));
    let pm = (sx + sy) / 2.0;
    let hd = (sx - sy) / 2.0;
    let rad = (hd * hd + txy * txy).sqrt();
    let s_a = pm + rad;
    let s_b = pm - rad;
    let c2 = if rad > 0.0 { hd / rad } else { 1.0 };
    let s2 = if rad > 0.0 { txy / rad } else { 0.0 };
    // order of (A, B, z), largest first: idx0..2 (0 = A, 1 = B, 2 = z), stable
    // for ties as the sort it replaces; pos* is each one's place in that order
    let (idx0, idx1, idx2) = if sz > s_a {
        (2, 0, 1)
    } else if sz > s_b {
        (0, 2, 1)
    } else {
        (0, 1, 2)
    };
    let v0 = if idx0 == 0 { s_a } else { sz };
    let v1 = if idx1 == 0 {
        s_a
    } else if idx1 == 1 {
        s_b
    } else {
        sz
    };
    let v2 = if idx2 == 1 { s_b } else { sz };
    let mut pl = Planes {
        pa: [0.0; 15],
        pb: [0.0; 5],
        pg: [0.0; 15],
        act: [0; 3],
        active_count: 0,
        ret: [0.0; 3],
    };
    let plastic = principal_return(
        &mut pl, v0, v1, v2, lam, mu, c, sin_phi, cos_phi, cutoff, cu, sin_psi,
    )?;
    if !plastic {
        s_out[0] = sx;
        s_out[1] = sy;
        s_out[2] = txy;
        s_out[3] = sz;
        if let Some(t) = tangent {
            elastic_tangent(lam, mu, t);
        }
        return Ok(false);
    }
    let pos_a = if idx0 == 0 {
        0
    } else if idx1 == 0 {
        1
    } else {
        2
    };
    let pos_b = if idx0 == 1 {
        0
    } else if idx1 == 1 {
        1
    } else {
        2
    };
    let pos_z = 3 - pos_a - pos_b;
    let (r_a, r_b, r_z) = (pl.ret[pos_a], pl.ret[pos_b], pl.ret[pos_z]);
    let cc = (1.0 + c2) / 2.0;
    let ss = (1.0 - c2) / 2.0;
    let sc = s2 / 2.0;
    s_out[0] = r_a * cc + r_b * ss;
    s_out[1] = r_a * ss + r_b * cc;
    s_out[2] = (r_a - r_b) * sc;
    s_out[3] = r_z;
    let Some(tangent) = tangent else {
        return Ok(true);
    };
    // tangent in sorted principal space: D − D G (Aᵀ D G)⁻¹ Aᵀ D, with the
    // flow directions G (= A for associated flow, then symmetric)
    let d11 = lam + 2.0 * mu;
    let mut dep = [0.0f64; 9];
    for p in 0..3 {
        for q in 0..3 {
            dep[3 * p + q] = if p == q { d11 } else { lam };
        }
    }
    let n = pl.active_count;
    if n == APEX {
        dep.fill(0.0);
    }
    // the apex: the Mohr–Coulomb plane and both ordering planes, or the apex
    // return of ψ < φ
    let apex = n == APEX || (n == 3 && pl.act[0] == 0 && pl.act[1] == 2 && pl.act[2] == 3);
    let nu_ = n.max(0) as usize;
    let mut da = [0.0f64; 9];
    let mut dy = [0.0f64; 9];
    let mut ms = [0.0f64; 9];
    let mut minv = [0.0f64; 9];
    let mut mc = [0.0f64; 9];
    let mut ec = [0.0f64; 3];
    for j in 0..nu_ {
        let a = 3 * pl.act[j];
        for i in 0..3 {
            da[3 * j + i] = dep[3 * i] * pl.pg[a]
                + dep[3 * i + 1] * pl.pg[a + 1]
                + dep[3 * i + 2] * pl.pg[a + 2];
            dy[3 * j + i] = dep[3 * i] * pl.pa[a]
                + dep[3 * i + 1] * pl.pa[a + 1]
                + dep[3 * i + 2] * pl.pa[a + 2];
        }
    }
    for i in 0..nu_ {
        let a = 3 * pl.act[i];
        for j in 0..nu_ {
            ms[i * nu_ + j] =
                pl.pa[a] * da[3 * j] + pl.pa[a + 1] * da[3 * j + 1] + pl.pa[a + 2] * da[3 * j + 2];
        }
    }
    // M⁻¹ by solving for the identity columns
    for j in 0..nu_ {
        for i in 0..nu_ {
            ec[i] = if i == j { 1.0 } else { 0.0 };
        }
        mc[..nu_ * nu_].copy_from_slice(&ms[..nu_ * nu_]);
        solve_small(nu_, &mut mc, &mut ec);
        for i in 0..nu_ {
            minv[i * nu_ + j] = ec[i];
        }
    }
    for p in 0..3 {
        for q in 0..3 {
            let mut s = 0.0;
            for i in 0..nu_ {
                for j in 0..nu_ {
                    s += da[3 * i + p] * minv[i * nu_ + j] * dy[3 * j + q];
                }
            }
            dep[3 * p + q] -= s;
        }
    }
    if apex {
        for p in 0..3 {
            for q in 0..3 {
                dep[3 * p + q] = APEX_STIFFNESS * (if p == q { d11 } else { lam });
            }
        }
    }
    // back to (A, B, z) order: Paa = Dep in the rows/columns of A, B, z
    let (a3, b3, z3) = (3 * pos_a, 3 * pos_b, 3 * pos_z);
    let d_trial = s_a - s_b;
    // For equal in-plane principal strains the quotient's limit is the
    // derivative (Dep_AA − Dep_AB)/2 (de Souza Neto et al. 2008, appendix A).
    let mut g = if d_trial.abs() > 1e-12 * (s_a.abs() + s_b.abs() + 1.0) {
        (mu * (r_a - r_b)) / d_trial
    } else {
        (dep[a3 + pos_a] - dep[a3 + pos_b]) / 2.0
    };
    if apex {
        g = js::math::max(g, APEX_STIFFNESS * mu);
    }
    // principal-frame tangent in Voigt (A, B, AB, z)
    let cp = [
        dep[a3 + pos_a],
        dep[a3 + pos_b],
        0.0,
        dep[a3 + pos_z],
        dep[b3 + pos_a],
        dep[b3 + pos_b],
        0.0,
        dep[b3 + pos_z],
        0.0,
        0.0,
        g,
        0.0,
        dep[z3 + pos_a],
        dep[z3 + pos_b],
        0.0,
        dep[z3 + pos_z],
    ];
    // strain transformation ε' = T ε for the principal direction at angle θ:
    // cos 2θ = c2, sin 2θ = s2
    let tt = [
        cc,
        ss,
        sc,
        0.0,
        ss,
        cc,
        -sc,
        0.0,
        -2.0 * sc,
        2.0 * sc,
        c2,
        0.0,
        0.0,
        0.0,
        0.0,
        1.0,
    ];
    // C = Tᵀ Cp T
    let mut ct = [0.0f64; 16];
    for i in 0..4 {
        for j in 0..4 {
            let mut s = 0.0;
            for k in 0..4 {
                s += cp[4 * i + k] * tt[4 * k + j];
            }
            ct[4 * i + j] = s;
        }
    }
    for i in 0..4 {
        for j in 0..4 {
            let mut s = 0.0;
            for k in 0..4 {
                s += tt[4 * k + i] * ct[4 * k + j];
            }
            tangent[4 * i + j] = s;
        }
    }
    Ok(true)
}

/// Stress return for one Gauss point from the trial (elastic) stress
/// (σx, σy, τxy, σz); the tangent goes into `out` (TypeScript's `cu`
/// default is Infinity).
pub fn return_map(
    trial: [f64; 4],
    young: f64,
    nu: f64,
    c: f64,
    sin_phi: f64,
    cos_phi: f64,
    cutoff: bool,
    out: &mut [f64],
    cu: f64,
) -> Result<ReturnResult> {
    let mut so = [0.0f64; 4];
    let plastic = return_map_into(
        trial[0],
        trial[1],
        trial[2],
        trial[3],
        young,
        nu,
        c,
        sin_phi,
        cos_phi,
        cutoff,
        cu,
        &mut so,
        Some(out),
        sin_phi,
    )?;
    Ok(ReturnResult {
        stress: so,
        plastic,
    })
}

/// The state of a Newton iteration (TypeScript's `NewtonState`: views of a
/// strength reduction state's arrays).
pub struct NewtonState<'a> {
    /// Displacements per equation.
    pub u: &'a mut [f64],
    /// Plastic strain per Gauss point (εx, εy, γxy, εz).
    pub ep: &'a mut [f64],
    /// Stress per Gauss point (σx, σy, τxy, σz).
    pub stress: &'a mut [f64],
    /// Plastic axial strain of the reinforcement bars (2 per bar).
    pub bar_ep: &'a mut [f64],
    /// Reduction factor (the bars' passive capacity is divided by it).
    pub f: f64,
}

/// `NewtonOptions`.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct NewtonOptions {
    /// Relative residual tolerance ‖r‖/‖f‖; default 1e-6.
    pub tolerance: Option<f64>,
    /// Newton iterations per trial; default 200.
    pub max_iterations: Option<usize>,
    pub tension_cutoff: Option<bool>,
}

/// Strength per Gauss point after reduction (see srm.rs).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct GaussStrength {
    pub c: Vec<f64>,
    pub sin_phi: Vec<f64>,
    pub cos_phi: Vec<f64>,
    /// Undrained cap (Tresca) of a combined material; Infinity where there is none.
    pub cu: Vec<f64>,
    /// sin ψ of the plastic potential (non-associated flow); None: associated (ψ = φ).
    pub sin_psi: Option<Vec<f64>>,
}

/// Iterations of a solve at one F (`{ converged, iterations }`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SolveOutcome {
    pub converged: bool,
    pub iterations: usize,
}

/// Position in the matrix values of each element's lower-triangle entries
/// (78 per element, row a ≥ column b of the 12 dofs; −1 for a fixed dof),
/// so that assembly does not search the pattern. Built once per model.
fn scatter_index<'m>(model: &'m FeModel, eqs: &[i64], k: &SparseCholesky) -> Result<&'m [i64]> {
    if let Some(m) = model.scatter.get() {
        return Ok(m);
    }
    let mut m = vec![0i64; 78 * model.element_count];
    let mut t = 0;
    for e in 0..model.element_count {
        for a in 0..12 {
            let ia = eqs[12 * e + a];
            for b in 0..=a {
                let ib = eqs[12 * e + b];
                m[t] = if ia >= 0 && ib >= 0 {
                    k.index_of(ia as usize, ib as usize)? as i64
                } else {
                    -1
                };
                t += 1;
            }
        }
    }
    let _ = model.scatter.set(m);
    Ok(model.scatter.get().expect("set above"))
}

/// Internal force vector (and optionally the tangent) from displacements:
/// stresses by return from the trial ε(u) − εp of the last converged state.
/// The plastic strains are left in `ep_new`.
pub fn evaluate(
    model: &FeModel,
    eqs: &[i64],
    u: &[f64],
    ep_old: &[f64],
    strength: &GaussStrength,
    cutoff: bool,
    fint: &mut [f64],
    stress: &mut [f64],
    ep_new: &mut [f64],
    mut k: Option<&mut SparseCholesky>,
) -> Result<()> {
    let (gp, ne, el_e, el_nu, el_elastic) = (
        &model.gp,
        model.element_count,
        &model.el_e,
        &model.el_nu,
        &model.el_elastic,
    );
    fint.fill(0.0);
    let scatter: Option<&[i64]> = match k.as_deref_mut() {
        Some(km) => {
            km.values.fill(0.0);
            if let Some(up) = km.upper.as_mut() {
                up.fill(0.0);
            }
            Some(scatter_index(model, eqs, km)?)
        }
        None => None,
    };
    let unsym = k.as_ref().is_some_and(|km| km.upper.is_some());
    let with_k = k.is_some();
    let mut ue = [0.0f64; 12];
    let mut cmat = [0.0f64; 16];
    let mut ke = [0.0f64; 144];
    let mut fe = [0.0f64; 12];
    let mut sig = [0.0f64; 4];
    let sin_psi = strength.sin_psi.as_deref();
    let s0 = model.stress0.as_deref();
    for e in 0..ne {
        for kk in 0..12 {
            let q = eqs[12 * e + kk];
            ue[kk] = if q >= 0 { u[q as usize] } else { 0.0 };
        }
        let (young, nu) = (el_e[e], el_nu[e]);
        let lam = (young * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
        let mu = young / (2.0 * (1.0 + nu));
        fe.fill(0.0);
        if with_k {
            ke.fill(0.0);
        }
        for g in 0..3 {
            let i = 3 * e + g;
            let o = i * GP_STRIDE;
            let s = 4 * i;
            let w = gp[o + 12];
            let (mut ex, mut ey, mut gxy) = (0.0, 0.0, 0.0);
            for kk in 0..6 {
                let dx = gp[o + kk];
                let dy = gp[o + 6 + kk];
                ex += dx * ue[2 * kk];
                ey += dy * ue[2 * kk + 1];
                gxy += dy * ue[2 * kk] + dx * ue[2 * kk + 1];
            }
            let eex = ex - ep_old[s];
            let eey = ey - ep_old[s + 1];
            let eg = gxy - ep_old[s + 2];
            let eez = -ep_old[s + 3];
            let tr = eex + eey + eez;
            let mut t0 = lam * tr + 2.0 * mu * eex;
            let mut t1 = lam * tr + 2.0 * mu * eey;
            let mut t2 = mu * eg;
            let mut t3 = lam * tr + 2.0 * mu * eez;
            // initial stress: the stress is σ₀ + D(ε − εp), its forces are already in f (model.rs)
            let (mut a0, mut a1, mut a2) = (0.0, 0.0, 0.0);
            if let Some(s0) = s0 {
                a0 = s0[s];
                a1 = s0[s + 1];
                a2 = s0[s + 2];
                t0 += a0;
                t1 += a1;
                t2 += a2;
                t3 += s0[s + 3];
            }
            if el_elastic[e] {
                sig = [t0, t1, t2, t3];
                if with_k {
                    cmat.fill(0.0);
                    cmat[0] = lam + 2.0 * mu;
                    cmat[1] = lam;
                    cmat[4] = lam;
                    cmat[5] = lam + 2.0 * mu;
                    cmat[10] = mu;
                }
                ep_new[s] = ep_old[s];
                ep_new[s + 1] = ep_old[s + 1];
                ep_new[s + 2] = ep_old[s + 2];
                ep_new[s + 3] = ep_old[s + 3];
            } else {
                return_map_into(
                    t0,
                    t1,
                    t2,
                    t3,
                    young,
                    nu,
                    strength.c[i],
                    strength.sin_phi[i],
                    strength.cos_phi[i],
                    cutoff,
                    strength.cu[i],
                    &mut sig,
                    if with_k { Some(&mut cmat) } else { None },
                    match sin_psi {
                        Some(sp) => sp[i],
                        None => strength.sin_phi[i],
                    },
                )?;
                // plastic strain increment = D⁻¹ (σ_trial − σ)
                let d0 = t0 - sig[0];
                let d1 = t1 - sig[1];
                let d2 = t2 - sig[2];
                let d3 = t3 - sig[3];
                let dm = (d0 + d1 + d3) * nu / young;
                ep_new[s] = ep_old[s] + ((1.0 + nu) * d0) / young - dm;
                ep_new[s + 1] = ep_old[s + 1] + ((1.0 + nu) * d1) / young - dm;
                ep_new[s + 2] = ep_old[s + 2] + d2 / mu;
                ep_new[s + 3] = ep_old[s + 3] + ((1.0 + nu) * d3) / young - dm;
            }
            stress[s] = sig[0];
            stress[s + 1] = sig[1];
            stress[s + 2] = sig[2];
            stress[s + 3] = sig[3];
            let q0 = sig[0] - a0;
            let q1 = sig[1] - a1;
            let q2 = sig[2] - a2;
            for kk in 0..6 {
                let dx = gp[o + kk];
                let dy = gp[o + 6 + kk];
                fe[2 * kk] += (dx * q0 + dy * q2) * w;
                fe[2 * kk + 1] += (dy * q1 + dx * q2) * w;
            }
            if with_k && unsym {
                // unsymmetric tangent (non-associated flow): the whole of
                // ke += Bᵀ C B w, B rows (εx, εy, γxy)
                let c = &cmat;
                for a in 0..6 {
                    let ax = gp[o + a];
                    let ay = gp[o + 6 + a];
                    let rx0 = ax * c[0] + ay * c[8];
                    let rx1 = ax * c[1] + ay * c[9];
                    let rx2 = ax * c[2] + ay * c[10];
                    let ry0 = ay * c[4] + ax * c[8];
                    let ry1 = ay * c[5] + ax * c[9];
                    let ry2 = ay * c[6] + ax * c[10];
                    let row_x = 24 * a;
                    let row_y = 24 * a + 12;
                    for b in 0..6 {
                        let bx = gp[o + b];
                        let by = gp[o + 6 + b];
                        ke[row_x + 2 * b] += w * (rx0 * bx + rx2 * by);
                        ke[row_x + 2 * b + 1] += w * (rx1 * by + rx2 * bx);
                        ke[row_y + 2 * b] += w * (ry0 * bx + ry2 * by);
                        ke[row_y + 2 * b + 1] += w * (ry1 * by + ry2 * bx);
                    }
                }
            } else if with_k {
                // ke += Bᵀ C B w with B rows (εx, εy, γxy); εz = 0. The in-plane
                // part of C is symmetric (associated flow); it is symmetrised
                // against round-off and only the lower triangle of ke is formed.
                let c = &cmat;
                let c00 = c[0];
                let c01 = (c[1] + c[4]) / 2.0;
                let c02 = (c[2] + c[8]) / 2.0;
                let c11 = c[5];
                let c12 = (c[6] + c[9]) / 2.0;
                let c22 = c[10];
                for a in 0..6 {
                    let ax = gp[o + a];
                    let ay = gp[o + 6 + a];
                    // rows of Bᵀ C for dof (a, x): ax*C[0,:] + ay*C[2,:]; (a, y): ay*C[1,:] + ax*C[2,:]
                    let rx0 = ax * c00 + ay * c02;
                    let rx1 = ax * c01 + ay * c12;
                    let rx2 = ax * c02 + ay * c22;
                    let ry0 = ay * c01 + ax * c02;
                    let ry1 = ay * c11 + ax * c12;
                    let ry2 = ay * c12 + ax * c22;
                    let row_x = 24 * a;
                    let row_y = 24 * a + 12;
                    for b in 0..a {
                        let bx = gp[o + b];
                        let by = gp[o + 6 + b];
                        ke[row_x + 2 * b] += w * (rx0 * bx + rx2 * by);
                        ke[row_x + 2 * b + 1] += w * (rx1 * by + rx2 * bx);
                        ke[row_y + 2 * b] += w * (ry0 * bx + ry2 * by);
                        ke[row_y + 2 * b + 1] += w * (ry1 * by + ry2 * bx);
                    }
                    ke[row_x + 2 * a] += w * (rx0 * ax + rx2 * ay);
                    ke[row_y + 2 * a] += w * (ry0 * ax + ry2 * ay);
                    ke[row_y + 2 * a + 1] += w * (ry1 * ay + ry2 * ax);
                }
            }
        }
        for kk in 0..12 {
            let q = eqs[12 * e + kk];
            if q >= 0 {
                fint[q as usize] += fe[kk];
            }
        }
        if let (Some(km), Some(scatter)) = (k.as_deref_mut(), scatter) {
            let mut t = 78 * e;
            if let Some(ku) = km.upper.as_mut() {
                // ke(a, b) is A(ia, ib): below the diagonal into `values`, above it
                // into `upper`, both at the position of the lower-triangle entry
                let kv = &mut km.values;
                for a in 0..12 {
                    let ia = eqs[12 * e + a];
                    for b in 0..=a {
                        let at = scatter[t];
                        t += 1;
                        if at < 0 {
                            continue;
                        }
                        let at = at as usize;
                        let lo = ke[12 * a + b];
                        let hi = ke[12 * b + a];
                        let ib = eqs[12 * e + b];
                        if ia > ib {
                            kv[at] += lo;
                            if a != b {
                                ku[at] += hi;
                            }
                        } else if ia < ib {
                            kv[at] += hi;
                            ku[at] += lo;
                        } else {
                            kv[at] += lo;
                        }
                    }
                }
            } else {
                let kv = &mut km.values;
                for a in 0..12 {
                    for b in 0..=a {
                        let at = scatter[t];
                        t += 1;
                        if at >= 0 {
                            kv[at as usize] += ke[12 * a + b];
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

/// Failure by stagnation: the residual has not fallen below STALL_FALL of
/// its value STALL_WINDOW iterations earlier. Near collapse the line search
/// takes short steps that lower the residual by 1–3 % per iteration for
/// 10–25 iterations before quadratic convergence sets in (V056), so the
/// window must be longer than that.
const STALL_WINDOW: usize = 30;
const STALL_FALL: f64 = 0.9;
/// Line search: at most LS_STEPS trial steps α = 1, ½, …, 2⁻⁹; sufficient decrease constant c (Nocedal & Wright's 10⁻⁴).
const LS_STEPS: usize = 10;
const ARMIJO_C: f64 = 1e-4;

pub fn norm2(a: &[f64]) -> f64 {
    let mut s = 0.0;
    for &v in a {
        s += v * v;
    }
    s.sqrt()
}

/// Newton iterations at one F from `state` (updated in place on convergence).
/// Returns whether equilibrium was reached and how many iterations it took.
pub fn newton_at_f(
    model: &FeModel,
    eqs: &[i64],
    strength: &GaussStrength,
    state: &mut NewtonState,
    options: &NewtonOptions,
) -> Result<SolveOutcome> {
    let tol = options.tolerance.unwrap_or(1e-6);
    // Away from collapse Newton converges in 5–15 iterations; near collapse
    // the line search can need 20–40, and the stagnation test ends a trial
    // beyond the limit load.
    let limit = options.max_iterations.unwrap_or(200);
    let cutoff = options.tension_cutoff.unwrap_or(false);
    let neq = model.eq_count;
    let ngp = 3 * model.element_count;
    let fnorm = model.load_norm;
    let mut u = state.u.to_vec();
    let mut fint = vec![0.0f64; neq];
    let mut r = vec![0.0f64; neq];
    let mut du = vec![0.0f64; neq];
    let mut stress = vec![0.0f64; 4 * ngp];
    let mut ep = vec![0.0f64; 4 * ngp];
    let mut bar_ep = vec![0.0f64; state.bar_ep.len()];
    let mut trial_u = vec![0.0f64; neq];
    // With a dilation angle below the friction angle the consistent tangent
    // is unsymmetric and the system is solved by LU (sparse.rs).
    let mut unsymmetric = false;
    if let Some(sp) = &strength.sin_psi {
        let mut i = 0;
        while i < sp.len() && !unsymmetric {
            if sp[i] != strength.sin_phi[i] {
                unsymmetric = true;
            }
            i += 1;
        }
    }
    let mut kt = model.k.empty_copy(unsymmetric);
    let ep_old: &[f64] = state.ep;
    let bar_ep_old: &[f64] = state.bar_ep;
    let residual = |uu: &[f64],
                    with_k: bool,
                    kt: &mut SparseCholesky,
                    fint: &mut [f64],
                    stress: &mut [f64],
                    ep: &mut [f64],
                    bar_ep: &mut [f64],
                    r: &mut [f64]|
     -> Result<f64> {
        evaluate(
            model,
            eqs,
            uu,
            ep_old,
            strength,
            cutoff,
            fint,
            stress,
            ep,
            if with_k { Some(&mut *kt) } else { None },
        )?;
        if model.bars.count > 0 {
            bar_internal(
                model,
                uu,
                bar_ep_old,
                state.f,
                fint,
                bar_ep,
                if with_k { Some(&mut *kt) } else { None },
            )?;
        }
        if model.piles.count > 0 {
            beam_internal(
                &model.eq,
                &model.piles,
                uu,
                fint,
                if with_k { Some(&mut *kt) } else { None },
            )?;
        }
        for i in 0..neq {
            r[i] = model.f[i] - fint[i];
        }
        Ok(norm2(r))
    };
    let mut rn = residual(
        &u,
        true,
        &mut kt,
        &mut fint,
        &mut stress,
        &mut ep,
        &mut bar_ep,
        &mut r,
    )?;
    let mut history: Vec<f64> = Vec::new();
    let mut converged_at: Option<usize> = None;
    for it in 1..=limit {
        if rn <= tol * fnorm {
            converged_at = Some(it - 1);
            break;
        }
        // Stagnation: beyond the limit load the residual stops falling.
        history.push(rn);
        if it > STALL_WINDOW && rn > STALL_FALL * history[it - 1 - STALL_WINDOW] {
            return Ok(SolveOutcome {
                converged: false,
                iterations: it,
            });
        }
        // The tangent of perfect plasticity is only positive semidefinite along
        // a mechanism that has formed; where the factorisation meets a pivot
        // ≤ 0 the step is taken with the elastic stiffness instead (the
        // initial stiffness method, e.g. Zienkiewicz & Taylor, The Finite
        // Element Method for Solid and Structural Mechanics, 6th ed., 2005,
        // ch. 3), which is always positive definite.
        let tangent = kt.factor().is_ok();
        du.copy_from_slice(&r);
        if tangent {
            kt.solve(&mut du);
        } else {
            model.k.solve(&mut du);
        }
        // Backtracking line search with the sufficient decrease (Armijo)
        // condition on the merit ½‖r‖²: along the Newton direction its slope
        // is −‖r‖², so a step α is accepted when ‖r(u + αdu)‖² ≤ (1 − 2c·α)‖r‖²
        // (Dennis & Schnabel 1983, § 6.3 and 6.5; Nocedal & Wright 2006, § 3.1
        // and 11.2). The elastic stiffness gives no guaranteed descent
        // direction of the merit (its slope is −rᵀK_t K_e⁻¹ r), so plain
        // decrease is required then. A step that does not lower the residual
        // is never taken: if none is found the trial fails.
        let rn0 = rn;
        let mut alpha = 1.0;
        let mut accepted = false;
        let mut best_alpha = 0.0;
        let mut best_rn = rn0;
        for _ in 0..LS_STEPS {
            for i in 0..neq {
                trial_u[i] = u[i] + alpha * du[i];
            }
            let rt = residual(
                &trial_u,
                true,
                &mut kt,
                &mut fint,
                &mut stress,
                &mut ep,
                &mut bar_ep,
                &mut r,
            )?;
            if rt < best_rn {
                best_rn = rt;
                best_alpha = alpha;
            }
            let target = if tangent {
                (1.0 - 2.0 * ARMIJO_C * alpha).sqrt() * rn0
            } else {
                rn0
            };
            if rt <= target {
                accepted = true;
                break;
            }
            alpha /= 2.0;
        }
        if best_alpha == 0.0 {
            return Ok(SolveOutcome {
                converged: false,
                iterations: it,
            });
        }
        if !accepted || alpha != best_alpha {
            // The step with the lowest residual is taken; its stresses and
            // tangent are evaluated again (the trial points overwrote them).
            for i in 0..neq {
                trial_u[i] = u[i] + best_alpha * du[i];
            }
            residual(
                &trial_u,
                true,
                &mut kt,
                &mut fint,
                &mut stress,
                &mut ep,
                &mut bar_ep,
                &mut r,
            )?;
        }
        u.copy_from_slice(&trial_u);
        rn = best_rn;
    }
    let iterations = match converged_at {
        Some(it) => it,
        None if rn <= tol * fnorm => limit,
        None => {
            return Ok(SolveOutcome {
                converged: false,
                iterations: limit,
            })
        }
    };
    state.u.copy_from_slice(&u);
    state.ep.copy_from_slice(&ep);
    state.stress.copy_from_slice(&stress);
    state.bar_ep.copy_from_slice(&bar_ep);
    Ok(SolveOutcome {
        converged: true,
        iterations,
    })
}
