//! Port of packages/engine/src/fem/srm.ts.
//!
//! Strength reduction by finite elements (SRFEM).
//!
//! Method and sources:
//! - Strength reduction: c and tan φ divided by F until the slope fails;
//!   F at failure is the factor of safety (Zienkiewicz, Humpheson & Lewis
//!   1975, Géotechnique 25(4), 671–689; Matsui & San 1992, Soils Found.
//!   32(1), 59–70; Griffiths & Lane 1999, Géotechnique 49(3), 387–403).
//! - Viscoplastic algorithm (initial strain method) of Zienkiewicz &
//!   Cormeau (1974, IJNME 8(4), 821–845) as used for slopes by Griffiths &
//!   Lane (1999) and coded in Smith, Griffiths & Margetts (2014, Programming
//!   the Finite Element Method, 5th ed., Wiley, ch. 6): gravity is applied in
//!   one increment, the elastic stiffness is factorised once, and at every
//!   iteration the stress overshoot beyond the yield surface is relaxed by a
//!   viscoplastic strain increment f·∂Q/∂σ·Δt whose body loads enter the
//!   next solution.
//! - Failure: non-convergence within the iteration limit (Griffiths & Lane
//!   1999, 1000 iterations, tolerance on the displacement increment); with
//!   the "equilibrium" test a trial converges only when, in addition, the
//!   stresses returned to the yield surface balance the loads (the
//!   unbalanced-force test of explicit and implicit codes), and the
//!   iteration is then accelerated (Anderson 1965; Walker & Ni 2011;
//!   anderson.rs) on the viscoplastic strains and body loads.
//! - Yield: Mohr–Coulomb in principal stresses (tension positive),
//!   f = (σ₁ − σ₃)/2 + (σ₁ + σ₃)/2·sin φ − c cos φ, the normalisation of
//!   Smith & Griffiths; optional Rankine tension cut-off f_t = σ₁ ≤ 0,
//!   relaxed in the same way.
//! - Time step: the explicit update is stable for Δt below 2/a, a = n_fᵀ D n_g
//!   (Cormeau 1975, IJNME 9(1), 109–127; for associated flow this is the
//!   step of Smith & Griffiths, 4(1 + ν)(1 − 2ν)/(E(1 − 2ν + sin²φ))).
//! - Flow rules (Sysala, Hrubešová, Michalec & Tschuchnigg 2021,
//!   arXiv:2101.01005, eq. 2.1 and 4.6–4.8):
//!   "davis-b" (default): c and tan φ divided by
//!   q_B(F) = F(1 − sin ψ_F sin φ_F)/(cos ψ_F cos φ_F), tan φ_F = tan φ/F,
//!   tan ψ_F = tan ψ/F, with associated flow in the reduced material
//!   (Davis 1968; Tschuchnigg, Schweiger & Sloan 2015, Comput. Geotech. 70,
//!   169–177); "non-associated": c/F, tan φ/F, tan ψ/F, flow with ψ_F
//!   (Griffiths & Lane 1999); "associated": c/F, tan φ/F and ψ = φ_F.
//! - Associated flow is solved by Newton's method (newton.rs); a trial fails
//!   when Newton does not reach equilibrium, the criterion of implicit
//!   strength reduction. Non-associated flow can be solved the same way
//!   with the unsymmetric tangent (option), F raised in increments with
//!   cutback since the result depends on the path. (A viscoplastic iteration deciding Newton's failed
//!   trials was tried and removed: its displacement-increment test accepted
//!   creeping states and raised F, e.g. V068 1.161 against 1.132, and its
//!   iteration limit failed slowly converging ones, V056.)
//! - Search: F is bracketed and bisected (Dawson, Roth & Drescher 1999,
//!   Géotechnique 49(6), 835–840). A trial above a converged one starts
//!   from that converged state; with associated flow the limit load does not
//!   depend on the stress path (the uniqueness theorems of limit analysis),
//!   with non-associated flow the bounding theorems do not apply
//!   (Zienkiewicz, Humpheson & Lewis 1975) and it may, so F then rises in
//!   small equal steps as in Griffiths & Lane's incremental reduction.
//!
//! Implementation choices (not from the literature), with their reasons:
//! - Δt = 1/a, half the stability limit: a stress on one yield plane returns
//!   to it in one step, and the corners of the pyramid do not oscillate
//!   (`relaxation` = 1; 2 is the limit).
//! - Iteration limit 1000·√(elements/2500), at least 1000 (1500 with the
//!   accelerated equilibrium test): Griffiths &
//!   Lane's 1000 iterations are for meshes of a few hundred elements, and
//!   plastic flow must cross more elements on a finer mesh. The limit is a
//!   user parameter in every implementation of the non-convergence
//!   criterion, and F depends on it.
//! - Acceleration and limit, measured 2026-10-29 on the base meshes of 16
//!   problems of a program's verification manual and Pruska's 17 slopes
//!   (four programs, ψ = 0): without acceleration the iteration needs many
//!   thousands of iterations near the limit (58-5: 6168 at F = 0.69, no
//!   convergence at 0.71 in 20000), so the limit set F (−4.2 % against the
//!   programs' mean on Pruska's slopes). With 10 iterates mixed the same
//!   trials converge in 150–400 iterations; Pruska −2.7 %, all 33 cases
//!   2.8 % mean absolute deviation (3.3 % before) at 1.4 times the run time
//!   with a limit of 1500 (2.7 % at 3 times with 3000). On the verification
//!   problems it moved the factors both ways (16 of a program's manual:
//!   2.34 → 2.69 % mean absolute deviation, 19 published research results
//!   2.42 → 2.67 %; adaptive meshes), so it is an option, not the default.
//! - A trial that fails from the unloaded state does not bound F from
//!   above; only a failure from a converged state does, a converged trial
//!   overrides failures below it, and the bounding failure is confirmed
//!   from the final converged state (up to three times per search).
//! - Viscoplastic convergence must hold in two successive iterations.
//! - Beyond the apex of the Mohr–Coulomb pyramid σ₁ is relaxed towards the
//!   apex as by the Rankine cut-off (see solve_at_f); it does not change the
//!   yield surface, only lets ψ < φ return a stress from beyond the apex.
//!
//! Rust notes (ARCHITECTURE.md §2.2): the TypeScript generator
//! `strengthReductionSearch` is the explicit state machine `SrmSearch`,
//! whose `step` takes the outcomes of the batch it asked for and returns the
//! next batch or the result; `strength_reduction` runs its batches in turn.
//! Converged states are shared (`Arc`), as TypeScript shares the objects.
//! `run_trial` takes the model mutably: TypeScript's `runTrial` sets the
//! Hoek–Brown strength of the model in place (`set_hoek_brown_strength`).

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop, clippy::too_many_arguments)]

use crate::error::{EngineError, Result};
use crate::fem::anderson::Anderson;
use crate::fem::bars::{bar_internal, relax_bars};
use crate::fem::bfgs::{bfgs_at_f, BfgsOptions};
use crate::fem::elements::GP_STRIDE;
use crate::fem::model::{set_hoek_brown_strength, FeModel, BAR_GP_STRIDE};
use crate::fem::newton::{
    evaluate, newton_at_f, GaussStrength, NewtonOptions, NewtonState, SolveOutcome,
};
use crate::fem::piles::beam_internal;
use crate::js;
use crate::types::FlowRule;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Confirmations of the bounding failure per search (see `SrmSearch`).
const MAX_CONFIRMATIONS: usize = 3;

/// Iterations over which the contraction ratio is averaged.
const RATIO_WINDOW: usize = 10;

/// The solver of a trial.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TrialSolver {
    Newton,
    Bfgs,
    Viscoplastic,
}

/// Convergence test of the viscoplastic iteration.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SrmConvergence {
    Increment,
    Extrapolated,
    Equilibrium,
}

/// An earlier search on the same model to continue (`SrmOptions.resume`).
#[derive(Debug, Clone, PartialEq)]
pub struct SrmResume {
    pub lo: f64,
    pub hi: f64,
    pub state: Arc<SrmState>,
    pub hi_from: Option<f64>,
}

/// `SrmOptions` (without `onTrial`: `strength_reduction_with` takes it, and
/// `SrmSearch::trials` lists the trials as they are made).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SrmOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flow_rule: Option<FlowRule>,
    /// "newton" (default for Davis B and associated flow): implicit return and
    /// consistent tangent (newton.rs), which decides convergence sharply; with
    /// non-associated flow the tangent is unsymmetric (LU, sparse.rs) and F
    /// rises in increments from the starting state (`run_trial`).
    /// "viscoplastic" (default for non-associated flow): the explicit
    /// iteration of Griffiths & Lane. Measured 2026-10-29 on five
    /// non-associated cases (V055, V094 and three published benchmark
    /// slopes), Newton's F lies within 1.3 % of the viscoplastic one, at 0.7
    /// to 8 times its run time (4 times on the median case), so viscoplastic
    /// stays the default. "bfgs": quasi-Newton on the elastic stiffness.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub solver: Option<TrialSolver>,
    /// Rankine tension cut-off at zero effective stress; default false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tension_cutoff: Option<bool>,
    /// Convergence test of the viscoplastic iteration: "increment", max|Δu|/max|u| ≤ tolerance as
    /// Griffiths & Lane (1999) and Smith & Griffiths (2014); "extrapolated", the
    /// estimated distance to the fixed point Δu·r/(1 − r) instead of Δu, which
    /// does not accept a slowly creeping state near collapse but needs more
    /// iterations, so with the same limit it gives a lower F (V055: 1.31
    /// against 1.35); "equilibrium", the increment test and in addition the
    /// out-of-balance force of the stresses returned to the yield surface,
    /// ‖f − ∫Bᵀσ‖ ≤ `unbalance_tolerance`·‖f‖ (the unbalanced-force criterion
    /// of explicit and implicit codes), which does not depend on Δt, and
    /// with which the iteration is accelerated (`acceleration`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub convergence: Option<SrmConvergence>,
    /// Anderson acceleration of the viscoplastic iteration (anderson.rs): the
    /// number of past iterates mixed; 0 turns it off. Default 10 with the
    /// "equilibrium" test, 0 otherwise: an accelerated iterate can have a small
    /// displacement change without equilibrium, which the increment test
    /// would accept (measured on 33 slopes: F far above the references on most, up to 97).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub acceleration: Option<usize>,
    /// Relative out-of-balance force of the "equilibrium" test; default 1e-3.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unbalance_tolerance: Option<f64>,
    /// Convergence tolerance; default 1e-4 (viscoplastic), 1e-6 relative residual (Newton).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tolerance: Option<f64>,
    /// Viscoplastic iteration limit per trial (failure when reached); default 1000 × √(elements/2500), at least 1000 (1500 with acceleration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_iterations: Option<usize>,
    /// Newton iteration limit per trial; default 200 (newton.rs).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub newton_iterations: Option<usize>,
    /// Absolute tolerance on F; default 0.005.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub f_tolerance: Option<f64>,
    /// Viscoplastic step as a fraction of the stability limit 2/a (see `reduce`):
    /// Δt = relaxation / a; default 1 (exact return on a single plane).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub relaxation: Option<f64>,
    /// First trial F; default 1.
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "startF")]
    pub start_f: Option<f64>,
    /// Relative step while bracketing F; default 0.25, and 0.1 (constant) for non-associated flow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bracket_step: Option<f64>,
    /// Expected F (a coarser mesh's): while rising towards it the steps stop
    /// at 0.97 × guide and then rise by 0.02 × guide, so that F does not
    /// overshoot far and leave failed trials to bisect.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guide: Option<f64>,
    /// Continue an earlier search on the same model: its converged F and state
    /// and its smallest failed F; only the bisection remains.
    #[serde(skip)]
    pub resume: Option<SrmResume>,
    /// A starting state for the first trials, e.g. a coarser mesh's converged
    /// state transferred to this one (transfer.rs): the trials start from it
    /// until one converges, but no F counts as converged from it alone.
    #[serde(skip)]
    pub warm_start: Option<Arc<SrmState>>,
    /// Trials per round (default 1, bisection): with n > 1 the search tries n
    /// reductions per round from the same converged state (multisection), which
    /// the app runs in parallel. The result depends on n, not on how the
    /// trials are run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trials_per_round: Option<f64>,
}

/// `SrmTrial`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SrmTrial {
    #[serde(rename = "F")]
    pub f: f64,
    pub converged: bool,
    pub iterations: usize,
    /// Solver that decided the trial.
    pub solver: TrialSolver,
    /// F of the converged state the trial started from; 0 for the unloaded state.
    #[serde(rename = "startF")]
    pub start_f: f64,
    /// Largest nodal displacement (m) at the end of the trial.
    pub max_displacement: f64,
}

/// `SrmState`.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SrmState {
    /// Displacements per equation.
    pub u: Vec<f64>,
    /// Total viscoplastic strain per Gauss point (εx, εy, γxy, εz).
    pub evp: Vec<f64>,
    /// Body loads of the viscoplastic strains, per equation.
    pub body_loads: Vec<f64>,
    /// Effective stresses per Gauss point (σx, σy, τxy, σz).
    pub stress: Vec<f64>,
    /// Plastic axial strain of the reinforcement bars (2 per bar).
    pub bar_ep: Vec<f64>,
}

/// `SrmResult`.
#[derive(Debug, Clone, PartialEq)]
pub struct SrmResult {
    /// Factor of safety: the largest converged F (non-convergence criterion).
    pub factor_of_safety: f64,
    /// Smallest F that failed to converge from a converged state below it.
    pub failed_f: f64,
    /// F of the converged state the trial at `failed_f` started from.
    pub failed_from: f64,
    /// F at the displacement jump (Huang & Jia 2009, Comput. Geotech. 36, 93–101:
    /// failure where a characteristic nodal displacement increases suddenly):
    /// the largest converged F before the growth rate of the largest
    /// displacement exceeds ten times that of the first trials; None when
    /// there are too few converged trials. The factor ten is an
    /// implementation choice: the source judges the jump from the curve.
    pub displacement_jump_f: Option<f64>,
    pub trials: Vec<SrmTrial>,
    /// State at the factor of safety.
    pub state: Arc<SrmState>,
    /// The converged state before it (lower F), if any: their difference shows the mechanism.
    pub previous_state: Option<Arc<SrmState>>,
    /// Total iterations.
    pub iterations: usize,
    /// Reason when no factor of safety could be bracketed.
    pub warning: Option<String>,
}

/// Strength reduced at one F, with the viscoplastic steps (`ReducedStrength`).
#[derive(Debug, Clone, PartialEq)]
pub struct ReducedStrength {
    /// c, sin φ, cos φ, sin ψ (always given) and the undrained cap cu/F of a
    /// combined material (Tresca, ψ = φ = 0; Infinity where there is none).
    pub strength: GaussStrength,
    pub dt: Vec<f64>,
    pub dt_t: Vec<f64>,
    /// Viscoplastic step on the Tresca cap, Δt = relax/μ (a = n_fᵀ D n_g = μ).
    pub dt_u: Vec<f64>,
}

/// Davis B divisor q_B(F) for friction φ and dilation ψ (radians); Sysala et al. 2021 eq. 4.6.
pub fn davis_b(f: f64, phi: f64, psi: f64) -> f64 {
    let phi_f = js::math::atan(js::math::tan(phi) / f);
    let psi_f = js::math::atan(js::math::tan(psi) / f);
    (f * (1.0 - js::math::sin(psi_f) * js::math::sin(phi_f)))
        / (js::math::cos(psi_f) * js::math::cos(phi_f))
}

/// The strength at reduction F under a flow rule, and the viscoplastic steps.
pub fn reduce(model: &FeModel, f: f64, rule: FlowRule, relax: f64) -> ReducedStrength {
    let ngp = 3 * model.element_count;
    let mut c = vec![0.0; ngp];
    let mut sin_phi = vec![0.0; ngp];
    let mut cos_phi = vec![0.0; ngp];
    let mut sin_psi = vec![0.0; ngp];
    let mut cu = vec![0.0; ngp];
    let mut dt = vec![0.0; ngp];
    let mut dt_t = vec![0.0; ngp];
    let mut dt_u = vec![0.0; ngp];
    for i in 0..ngp {
        let e = i / 3;
        let ci = model.gp_c[i];
        let phi = model.gp_phi[i];
        let psi0 = js::math::min(model.el_psi[e], phi);
        let mut q = f;
        if rule == FlowRule::DavisB {
            q = davis_b(f, phi, psi0);
        }
        let phi_r = js::math::atan(js::math::tan(phi) / q);
        let psi_r = if rule == FlowRule::NonAssociated {
            js::math::atan(js::math::tan(psi0) / f)
        } else {
            phi_r
        };
        c[i] = ci / q;
        // The undrained cap has φ = ψ = 0, for which Davis B's divisor is F.
        cu[i] = model.gp_cu[i] / f;
        sin_phi[i] = js::math::sin(phi_r);
        cos_phi[i] = js::math::cos(phi_r);
        sin_psi[i] = js::math::sin(psi_r);
        let (young, nu) = (model.el_e[e], model.el_nu[e]);
        let lam = (young * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
        let mu = young / (2.0 * (1.0 + nu));
        // a = n_fᵀ D n_g: the rate of decrease of f per unit viscoplastic step on
        // a single yield plane. Δt = ω/a; ω = 2 is the stability limit, which for
        // associated flow is the step of Smith & Griffiths (2014), and ω = 1 returns
        // a single plane exactly to the yield surface.
        let (sf, sg) = (sin_phi[i], sin_psi[i]);
        let a = lam * sf * sg + mu * (1.0 + sf * sg);
        dt[i] = relax / a;
        dt_t[i] = relax / (lam + 2.0 * mu);
        dt_u[i] = relax / mu;
    }
    ReducedStrength {
        strength: GaussStrength {
            c,
            sin_phi,
            cos_phi,
            cu,
            sin_psi: Some(sin_psi),
        },
        dt,
        dt_t,
        dt_u,
    }
}

/// The unloaded starting state (with a prestressed anchor's initial strain).
pub fn empty_state(model: &FeModel) -> SrmState {
    let ngp = 3 * model.element_count;
    let bars = &model.bars;
    let mut body_loads = vec![0.0; model.eq_count];
    // A prestressed anchor starts with the plastic strain −P/EA in its free
    // length (bars.rs), whose force the viscoplastic iteration carries as the
    // body load ∫ Bᵀ EA εp.
    for b in 0..bars.count {
        for g in 0..2 {
            let ep = bars.ep0[2 * b + g];
            if ep == 0.0 {
                continue;
            }
            let o = (2 * b + g) * BAR_GP_STRIDE;
            let w = bars.gp[o + 6] * bars.stiffness[b] * ep;
            for k in 0..3 {
                let n = bars.nodes[3 * b + k];
                let ix = model.eq[2 * n];
                let iy = model.eq[2 * n + 1];
                if ix >= 0 {
                    body_loads[ix as usize] += bars.gp[o + 2 * k] * w;
                }
                if iy >= 0 {
                    body_loads[iy as usize] += bars.gp[o + 2 * k + 1] * w;
                }
            }
        }
    }
    SrmState {
        u: vec![0.0; model.eq_count],
        evp: vec![0.0; 4 * ngp],
        body_loads,
        stress: vec![0.0; 4 * ngp],
        bar_ep: bars.ep0.clone(),
    }
}

/// Viscoplastic iterations at one F, updating `state` in place. Returns
/// whether the iterations converged and how many were made. `eqs` is the
/// model's element equation table (`FeModel::element_equations`).
pub fn solve_at_f(
    model: &FeModel,
    f_red: f64,
    state: &mut SrmState,
    options: &SrmOptions,
    eqs: &[i64],
) -> Result<SolveOutcome> {
    let rule = options.flow_rule.unwrap_or(FlowRule::DavisB);
    let tol = options.tolerance.unwrap_or(1e-4);
    // Griffiths & Lane's 1000 iterations are for meshes of a few hundred
    // elements; plastic flow has to cross more elements on a finer mesh, so
    // the limit grows with the mesh's linear resolution, √(elements / 2500).
    let criterion = options.convergence.unwrap_or(SrmConvergence::Increment);
    let aa_m = options
        .acceleration
        .unwrap_or(if criterion == SrmConvergence::Equilibrium {
            10
        } else {
            0
        });
    let limit = match options.max_iterations {
        Some(l) => l,
        None => js::math::round(
            (if aa_m > 0 { 1500.0 } else { 1000.0 })
                * js::math::max(1.0, (model.element_count as f64 / 2500.0).sqrt()),
        ) as usize,
    };
    let cutoff = options.tension_cutoff.unwrap_or(false);
    let red = reduce(model, f_red, rule, options.relaxation.unwrap_or(1.0));
    let (gp, ne, el_e, el_nu, el_elastic) = (
        &model.gp,
        model.element_count,
        &model.el_e,
        &model.el_nu,
        &model.el_elastic,
    );
    let s0 = model.stress0.as_deref();
    let neq = model.eq_count;
    let mut next = vec![0.0f64; neq];
    let mut ue = [0.0f64; 12];
    let mut load = [0.0f64; 12];
    let equilibrium = criterion == SrmConvergence::Equilibrium;
    let (mut eq_fint, mut eq_stress, mut eq_ep, mut eq_bar_ep) = if equilibrium {
        (
            vec![0.0f64; neq],
            vec![0.0f64; 12 * ne],
            vec![0.0f64; 12 * ne],
            vec![0.0f64; state.bar_ep.len()],
        )
    } else {
        (Vec::new(), Vec::new(), Vec::new(), Vec::new())
    };
    let mut converged = false;
    let mut it: usize = 0;
    let mut prev_du = 0.0;
    let mut ratio_count = 0;
    let mut passed_before = false;
    let mut log_ratio = [0.0f64; RATIO_WINDOW];
    let ne4 = state.evp.len();
    let nb = state.bar_ep.len();
    let mut aa = if aa_m > 0 {
        Some(Anderson::new(ne4 + nb + neq, aa_m, ne4 + nb))
    } else {
        None
    };
    let mut aa_in = vec![0.0f64; if aa.is_some() { ne4 + nb + neq } else { 0 }];
    let mut aa_out = vec![0.0f64; if aa.is_some() { ne4 + nb + neq } else { 0 }];
    let SrmState {
        u,
        evp,
        body_loads,
        stress,
        bar_ep,
    } = state;
    while it < limit && !converged {
        it += 1;
        if aa.is_some() {
            aa_in[..ne4].copy_from_slice(evp);
            aa_in[ne4..ne4 + nb].copy_from_slice(bar_ep);
            aa_in[ne4 + nb..].copy_from_slice(body_loads);
        }
        for i in 0..neq {
            next[i] = model.f[i] + body_loads[i];
        }
        model.k.solve(&mut next);
        let mut max_u = 0.0;
        let mut max_du = 0.0;
        for i in 0..neq {
            let v = next[i];
            max_u = js::math::max(max_u, v.abs());
            max_du = js::math::max(max_du, (v - u[i]).abs());
            u[i] = v;
        }
        // The iteration converges linearly, Δu_k ≈ r·Δu_(k−1), so the distance to
        // the fixed point is about Δu_k·r/(1 − r) (e.g. Quarteroni, Sacco & Saleri,
        // Numerical Mathematics, 2nd ed., Springer 2007); r is the mean contraction over the
        // last iterations ("extrapolated" test). The first solve repeats the
        // starting state, so convergence counts only after the stresses have been
        // checked against this F's strength.
        if it > 1 && prev_du > 0.0 && max_du > 0.0 {
            log_ratio[it % RATIO_WINDOW] = js::math::log(max_du / prev_du);
            ratio_count += 1;
        }
        prev_du = max_du;
        let mut remaining = max_du;
        if ratio_count >= RATIO_WINDOW {
            let mut sum = 0.0;
            for &v in &log_ratio {
                sum += v;
            }
            let rate = js::math::exp(sum / RATIO_WINDOW as f64);
            remaining = if rate < 1.0 {
                (max_du * rate) / (1.0 - rate)
            } else {
                f64::INFINITY
            };
        } else if ratio_count > 0 {
            remaining = f64::INFINITY;
        }
        let err = if criterion == SrmConvergence::Extrapolated {
            js::math::max(max_du, remaining)
        } else {
            max_du
        };
        // The test must pass in two successive iterations: from a converged
        // state at a slightly lower F the first relaxation can be small
        // enough to pass it once although many more follow (implementation
        // choice; Griffiths & Lane test a single increment).
        let passed = it > 1
            && (if max_u > 0.0 {
                err / max_u <= tol
            } else {
                true
            });
        converged = passed && passed_before;
        passed_before = passed;
        if converged && equilibrium {
            // The stresses of the iteration are in equilibrium but may lie
            // outside the yield surface; their returns to it (along the flow
            // rule's potential, as in newton.rs) are the admissible stresses,
            // whose internal forces must balance the load.
            evaluate(
                model,
                eqs,
                u,
                evp,
                &red.strength,
                cutoff,
                &mut eq_fint,
                &mut eq_stress,
                &mut eq_ep,
                None,
            )?;
            if model.bars.count > 0 {
                bar_internal(model, u, bar_ep, f_red, &mut eq_fint, &mut eq_bar_ep, None)?;
            }
            if model.piles.count > 0 {
                beam_internal(&model.eq, &model.piles, u, &mut eq_fint, None)?;
            }
            let mut s = 0.0;
            for i in 0..neq {
                let d = model.f[i] - eq_fint[i];
                s += d * d;
            }
            if s.sqrt() > options.unbalance_tolerance.unwrap_or(1e-3) * model.load_norm {
                converged = false;
            }
        }

        for e in 0..ne {
            for kk in 0..12 {
                let q = eqs[12 * e + kk];
                ue[kk] = if q >= 0 { u[q as usize] } else { 0.0 };
            }
            let (young, nu) = (el_e[e], el_nu[e]);
            let lam = (young * nu) / ((1.0 + nu) * (1.0 - 2.0 * nu));
            let mu = young / (2.0 * (1.0 + nu));
            let mut any_load = false;
            load.fill(0.0);
            for g in 0..3 {
                let i = 3 * e + g;
                let o = i * GP_STRIDE;
                let s = 4 * i;
                let (mut ex, mut ey, mut gxy) = (0.0, 0.0, 0.0);
                for kk in 0..6 {
                    let dx = gp[o + kk];
                    let dy = gp[o + 6 + kk];
                    ex += dx * ue[2 * kk];
                    ey += dy * ue[2 * kk + 1];
                    gxy += dy * ue[2 * kk] + dx * ue[2 * kk + 1];
                }
                ex -= evp[s];
                ey -= evp[s + 1];
                gxy -= evp[s + 2];
                let ez = -evp[s + 3];
                let tr = ex + ey + ez;
                let mut sx = lam * tr + 2.0 * mu * ex;
                let mut sy = lam * tr + 2.0 * mu * ey;
                let mut txy = mu * gxy;
                let mut sz = lam * tr + 2.0 * mu * ez;
                // initial stress: σ₀ + D(ε − εvp); its forces are already in f (model.rs)
                if let Some(s0) = s0 {
                    sx += s0[s];
                    sy += s0[s + 1];
                    txy += s0[s + 2];
                    sz += s0[s + 3];
                }
                stress[s] = sx;
                stress[s + 1] = sy;
                stress[s + 2] = txy;
                stress[s + 3] = sz;
                if el_elastic[e] {
                    continue;
                }

                // In-plane principal stresses and the direction of the larger.
                let pm = (sx + sy) / 2.0;
                let hd = (sx - sy) / 2.0;
                let rad = (hd * hd + txy * txy).sqrt();
                let s_a = pm + rad;
                let s_b = pm - rad;
                let c2 = if rad > 0.0 { hd / rad } else { 1.0 };
                let s2 = if rad > 0.0 { txy / rad } else { 0.0 };
                // Largest (1) and smallest (3) principal stress: 0 = A, 1 = B, 2 = z.
                let i1 = if sz > s_a { 2 } else { 0 };
                let i3 = if sz < s_b { 2 } else { 1 };
                let s1 = if i1 == 2 { sz } else { s_a };
                let s3 = if i3 == 2 { sz } else { s_b };
                let sp = red.strength.sin_phi[i];
                let ssi = red.strength.sin_psi.as_ref().expect("reduce sets sin ψ")[i];
                let f = (s1 - s3) / 2.0 + ((s1 + s3) / 2.0) * sp
                    - red.strength.c[i] * red.strength.cos_phi[i];
                // The undrained cap of a combined material: the surface with the
                // larger return is relaxed (Tresca flows with ψ = 0).
                let f_u = (s1 - s3) / 2.0 - red.strength.cu[i];
                let (mut r1, mut r3) = (0.0, 0.0);
                if f_u > 0.0 && f_u * red.dt_u[i] > f * red.dt[i] {
                    let k = f_u * red.dt_u[i];
                    r1 = k / 2.0;
                    r3 = -k / 2.0;
                } else if f > 0.0 {
                    let k = f * red.dt[i];
                    r1 = (k * (1.0 + ssi)) / 2.0;
                    r3 = (k * (-1.0 + ssi)) / 2.0;
                }
                if cutoff && s1 > 0.0 {
                    r1 += s1 * red.dt_t[i];
                } else if sp > 0.0 && f > 0.0 {
                    // Beyond the apex of the pyramid, σ₁ > c cot φ, the deviatoric flow
                    // of ψ < φ cannot return the stress (with c = 0 a tensile point at
                    // the ground stays there and the iteration never converges); σ₁ is
                    // relaxed towards the apex as by the Rankine cut-off. The plane
                    // σ₁ ≤ c cot φ contains the whole pyramid, so the yield surface is
                    // unchanged (implementation choice).
                    let apex = (red.strength.c[i] * red.strength.cos_phi[i]) / sp;
                    if s1 > apex {
                        r1 += (s1 - apex) * red.dt_t[i];
                    }
                }
                if r1 == 0.0 && r3 == 0.0 {
                    continue;
                }
                // Back to Cartesian components (engineering shear strain).
                let e_a = if i1 == 0 { r1 } else { 0.0 };
                let e_b = if i3 == 1 { r3 } else { 0.0 };
                let e_z = (if i1 == 2 { r1 } else { 0.0 }) + (if i3 == 2 { r3 } else { 0.0 });
                let dex = (e_a * (1.0 + c2) + e_b * (1.0 - c2)) / 2.0;
                let dey = (e_a * (1.0 - c2) + e_b * (1.0 + c2)) / 2.0;
                let dg = (e_a - e_b) * s2;
                evp[s] += dex;
                evp[s + 1] += dey;
                evp[s + 2] += dg;
                evp[s + 3] += e_z;
                // body load ∫ Bᵀ D Δεvp
                let dtr = dex + dey + e_z;
                let dsx = lam * dtr + 2.0 * mu * dex;
                let dsy = lam * dtr + 2.0 * mu * dey;
                let dtxy = mu * dg;
                let w = gp[o + 12];
                for k2 in 0..6 {
                    let dx = gp[o + k2];
                    let dy = gp[o + 6 + k2];
                    load[2 * k2] += (dx * dsx + dy * dtxy) * w;
                    load[2 * k2 + 1] += (dy * dsy + dx * dtxy) * w;
                }
                any_load = true;
            }
            if any_load {
                for kk in 0..12 {
                    let q = eqs[12 * e + kk];
                    if q >= 0 {
                        body_loads[q as usize] += load[kk];
                    }
                }
            }
        }
        if model.bars.count > 0 {
            relax_bars(model, u, bar_ep, f_red, body_loads);
        }
        if let Some(aa) = aa.as_mut() {
            if !converged {
                aa_out[..ne4].copy_from_slice(evp);
                aa_out[ne4..ne4 + nb].copy_from_slice(bar_ep);
                aa_out[ne4 + nb..].copy_from_slice(body_loads);
                aa.step(&aa_in, &mut aa_out);
                evp.copy_from_slice(&aa_out[..ne4]);
                bar_ep.copy_from_slice(&aa_out[ne4..ne4 + nb]);
                body_loads.copy_from_slice(&aa_out[ne4 + nb..]);
            }
        }
    }
    Ok(SolveOutcome {
        converged,
        iterations: it,
    })
}

fn max_abs(a: &[f64]) -> f64 {
    let mut m = 0.0;
    for &v in a {
        m = js::math::max(m, v.abs());
    }
    m
}

/// Trials the search asks for: these reductions, each from the same starting state (None: unloaded).
#[derive(Debug, Clone, PartialEq)]
pub struct TrialBatch {
    pub start: Option<Arc<SrmState>>,
    /// F of the starting state; 0 for the unloaded state.
    pub start_f: f64,
    pub f: Vec<f64>,
}

/// The outcome of one trial, with the state it reached.
#[derive(Debug, Clone, PartialEq)]
pub struct TrialOutcome {
    pub converged: bool,
    pub iterations: usize,
    pub solver: TrialSolver,
    pub state: SrmState,
}

/// Smallest increment of F, as a fraction of the jump from the starting
/// state, of a non-associated Newton trial: three halvings (implementation
/// choice).
const MIN_INCREMENT: f64 = 0.125;

/// Whether the model's flow is associated everywhere (non-associated flow is associated where ψ = φ, as in undrained soil).
fn is_associated(model: &FeModel, rule: FlowRule) -> bool {
    rule != FlowRule::NonAssociated
        || model.gp_phi.iter().enumerate().all(|(i, &phi)| {
            model.el_elastic[i / 3] || js::math::min(model.el_psi[i / 3], phi) == phi
        })
}

/// The solver of the trials: Newton (default) or BFGS for associated flow, the viscoplastic iteration for non-associated flow unless another is asked for.
pub fn trial_solver(model: &FeModel, options: &SrmOptions) -> TrialSolver {
    let rule = options.flow_rule.unwrap_or(FlowRule::DavisB);
    if is_associated(model, rule) {
        options.solver.unwrap_or(TrialSolver::Newton)
    } else {
        match options.solver {
            Some(s @ (TrialSolver::Bfgs | TrialSolver::Newton)) => s,
            _ => TrialSolver::Viscoplastic,
        }
    }
}

/// One trial at reduction F from a starting state (None: unloaded): Newton's
/// method for associated flow, the viscoplastic iteration otherwise. A trial
/// converges when the solver finds equilibrium; Newton decides its trials
/// alone, as in implicit strength reduction. `start_f` is the F of the
/// starting state (TypeScript default 0).
pub fn run_trial(
    model: &mut FeModel,
    f_red: f64,
    start: Option<&SrmState>,
    options: &SrmOptions,
    start_f: f64,
) -> Result<TrialOutcome> {
    let rule = options.flow_rule.unwrap_or(FlowRule::DavisB);
    // Hoek–Brown rock: the instantaneous strength at the starting stresses
    // (before the solver is chosen, which reads φ)
    if !model.gp_hoek_brown.is_empty() {
        let stress = match start {
            Some(s) => Some(s.stress.clone()),
            None => model.stress0.clone(),
        };
        set_hoek_brown_strength(model, stress.as_deref());
    }
    let model: &FeModel = model;
    let eqs = model.element_equations();
    let solver = trial_solver(model, options);
    let mut st = match start {
        Some(s) => s.clone(),
        None => empty_state(model),
    };
    if solver == TrialSolver::Bfgs {
        let r = bfgs_at_f(
            model,
            eqs,
            &reduce(model, f_red, rule, 1.0).strength,
            &mut NewtonState {
                u: &mut st.u,
                ep: &mut st.evp,
                stress: &mut st.stress,
                bar_ep: &mut st.bar_ep,
                f: f_red,
            },
            &BfgsOptions {
                tolerance: options.tolerance,
                max_iterations: options.newton_iterations,
                tension_cutoff: options.tension_cutoff,
            },
        )?;
        return Ok(TrialOutcome {
            converged: r.converged,
            iterations: r.iterations,
            solver: TrialSolver::Bfgs,
            state: st,
        });
    }
    if solver == TrialSolver::Newton {
        let newton_options = NewtonOptions {
            tolerance: options.tolerance,
            max_iterations: options.newton_iterations,
            tension_cutoff: options.tension_cutoff,
        };
        let at = |f: f64, st: &mut SrmState| -> Result<SolveOutcome> {
            newton_at_f(
                model,
                eqs,
                &reduce(model, f, rule, 1.0).strength,
                &mut NewtonState {
                    u: &mut st.u,
                    ep: &mut st.evp,
                    stress: &mut st.stress,
                    bar_ep: &mut st.bar_ep,
                    f,
                },
                &newton_options,
            )
        };
        if is_associated(model, rule) || start.is_none() || !(f_red > start_f) {
            let r = at(f_red, &mut st)?;
            return Ok(TrialOutcome {
                converged: r.converged,
                iterations: r.iterations,
                solver: TrialSolver::Newton,
                state: st,
            });
        }
        // Non-associated flow is path dependent, and its Newton iteration
        // (unsymmetric tangent, a stress return that is not smooth) can fail
        // to converge from a state far below F: F is raised in increments from
        // the starting state, halving an increment that fails and growing it
        // by half after a success (automatic increments with cutback, as in
        // incremental plasticity). The trial fails when an increment below
        // MIN_INCREMENT of the jump fails.
        let jump = f_red - start_f;
        let mut fc = start_f;
        let mut inc = jump;
        let mut iterations = 0;
        loop {
            let ft = if fc + inc >= f_red - 1e-12 * f_red {
                f_red
            } else {
                fc + inc
            };
            let r = at(ft, &mut st)?;
            iterations += r.iterations;
            if r.converged {
                if ft == f_red {
                    return Ok(TrialOutcome {
                        converged: true,
                        iterations,
                        solver: TrialSolver::Newton,
                        state: st,
                    });
                }
                fc = ft;
                inc *= 1.5;
            } else {
                inc /= 2.0;
                if inc < MIN_INCREMENT * jump {
                    return Ok(TrialOutcome {
                        converged: false,
                        iterations,
                        solver: TrialSolver::Newton,
                        state: st,
                    });
                }
            }
        }
    }
    let v = solve_at_f(model, f_red, &mut st, options, eqs)?;
    Ok(TrialOutcome {
        converged: v.converged,
        iterations: v.iterations,
        solver: TrialSolver::Viscoplastic,
        state: st,
    })
}

/// Factor of safety by strength reduction, the trials run one after another.
pub fn strength_reduction(model: &mut FeModel, options: &SrmOptions) -> Result<SrmResult> {
    strength_reduction_with(model, options, &mut |_| {})
}

/// `strength_reduction` with TypeScript's `onTrial`, called after each trial.
pub fn strength_reduction_with(
    model: &mut FeModel,
    options: &SrmOptions,
    on_trial: &mut dyn FnMut(&SrmTrial),
) -> Result<SrmResult> {
    let mut search = SrmSearch::new(model, options);
    let mut outcomes: Option<Vec<TrialOutcome>> = None;
    loop {
        let before = search.trials().len();
        let step = search.step(model, outcomes.take())?;
        for t in &search.trials()[before..] {
            on_trial(t);
        }
        match step {
            SrmStep::Batch(batch) => {
                let mut out = Vec::with_capacity(batch.f.len());
                for &f in &batch.f {
                    out.push(run_trial(
                        model,
                        f,
                        batch.start.as_deref(),
                        options,
                        batch.start_f,
                    )?);
                }
                outcomes = Some(out);
            }
            SrmStep::Done(result) => return Ok(*result),
        }
    }
}

/// A warm start (`SrmOptions.warm_start`) is tried at most this often, each time F × WARM_FALL lower, before the unloaded state.
const WARM_TRIES: i64 = 3;
const WARM_FALL: f64 = 0.92;

/// What `SrmSearch::step` returns: the next batch of trials, or the result.
#[derive(Debug, Clone, PartialEq)]
pub enum SrmStep {
    Batch(TrialBatch),
    Done(Box<SrmResult>),
}

/// A failure from a converged state, with the F of the state it started from.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Failure {
    f: f64,
    from: f64,
}

/// Where the search goes on (the program counter of the TypeScript generator).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Pos {
    /// The test of the bracketing loop (`k < 40 && !(lo > 0 && isFinite(hi))`).
    BracketTop,
    /// The test of the bisection loop.
    BisectTop,
    /// The test after the bisection: confirm the bounding failure, or end.
    ConfirmCheck,
    /// The result is to be returned.
    Finish,
    /// The result has been returned.
    Finished,
}

/// What to do when the outcomes of the batch asked for arrive.
#[derive(Debug, Clone, PartialEq)]
enum After {
    /// One trial while bracketing.
    Bracket1,
    /// The next steps of associated flow at once, with their rises.
    BracketN {
        rises: Vec<f64>,
    },
    Bisect,
    Confirm {
        failed: f64,
        failed_from: f64,
    },
}

/// The batch asked for and how to go on (`round`'s locals across its `yield`).
#[derive(Debug, Clone, PartialEq)]
struct Pending {
    fs: Vec<f64>,
    warm: bool,
    from: f64,
    after: After,
}

/// The search for the factor of safety as a state machine (TypeScript's
/// generator `strengthReductionSearch`): `step` returns the trials it needs
/// (a batch of reductions from one starting state), receives their outcomes
/// in the same order with the next call, and finally returns the result.
/// `strength_reduction` runs the batches in turn; the app runs a batch's
/// trials in parallel. Either way the result is the same: it depends on
/// `trials_per_round`, not on how many trials run at once.
#[derive(Debug, Clone)]
pub struct SrmSearch {
    f_tol: f64,
    non_associated: bool,
    per_round: f64,
    trials: Vec<SrmTrial>,
    iterations: usize,
    lo: f64,
    hi: f64,
    hi_from: f64,
    lo_state: Option<Arc<SrmState>>,
    warm_left: i64,
    prev_state: Option<Arc<SrmState>>,
    failures: Vec<Failure>,
    guide: Option<f64>,
    rise: f64,
    f: f64,
    warning: Option<String>,
    confirmations: usize,
    k: usize,
    pos: Pos,
    pending: Option<Pending>,
}

impl SrmSearch {
    /// The search on `model` (read for its flow: associated or not) with `options`.
    pub fn new(model: &FeModel, options: &SrmOptions) -> SrmSearch {
        let f_tol = options.f_tolerance.unwrap_or(0.005);
        let rule = options.flow_rule.unwrap_or(FlowRule::DavisB);
        let non_associated = !is_associated(model, rule);
        let per_round = js::math::max(
            1.0,
            js::math::round(options.trials_per_round.unwrap_or(1.0)),
        );
        let lo = options.resume.as_ref().map_or(0.0, |r| r.lo);
        let lo_state = match (&options.resume, &options.warm_start) {
            (Some(r), _) => Some(Arc::clone(&r.state)),
            (None, Some(w)) => Some(Arc::clone(w)),
            (None, None) => None,
        };
        let warm_left = if options.warm_start.is_some() && options.resume.is_none() {
            WARM_TRIES
        } else {
            0
        };
        // Failures from converged states, with the F of the state each started
        // from. A failure from the unloaded state bounds nothing: with the full
        // weight applied at once the iteration can fail at an F that a start from
        // a converged lower F reaches easily (seen with Newton on refined meshes).
        let mut failures = Vec::new();
        if let Some(r) = &options.resume {
            if r.hi.is_finite() {
                failures.push(Failure {
                    f: r.hi,
                    from: r.hi_from.unwrap_or(lo),
                });
            }
        }
        let mut s = SrmSearch {
            f_tol,
            non_associated,
            per_round,
            trials: Vec::new(),
            iterations: 0,
            lo,
            hi: f64::INFINITY,
            hi_from: 0.0,
            lo_state,
            warm_left,
            prev_state: None,
            failures,
            guide: options.guide,
            rise: 0.0,
            f: 0.0,
            warning: None,
            confirmations: 0,
            k: 0,
            pos: Pos::BracketTop,
            pending: None,
        };
        s.update();
        // Bracket, then bisect (Dawson, Roth & Drescher 1999): step up from a
        // converged trial, down from a failed one, until a converged F and a
        // failed F above it are known. With `trials_per_round` = n > 1 the search
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
        s.rise = options
            .bracket_step
            .unwrap_or(if non_associated { 0.1 } else { 0.25 });
        s.f = if options.resume.is_some() {
            if s.hi.is_finite() {
                (s.lo + s.hi) / 2.0
            } else {
                s.lo * (1.0 + s.rise)
            }
        } else {
            options.start_f.unwrap_or(1.0)
        };
        s
    }

    /// The trials made so far (TypeScript's `onTrial` sees each as it is made).
    pub fn trials(&self) -> &[SrmTrial] {
        &self.trials
    }

    /// The bracket: the highest converged F is the lower end, whose state the
    /// next trials start from; the lowest failure above it the upper end. A
    /// converged trial is an equilibrium state at its F, so it overrides
    /// failures below it (one that failed from a lower state was a false
    /// failure of the iteration).
    fn update(&mut self) {
        self.hi = f64::INFINITY;
        self.hi_from = 0.0;
        for f in &self.failures {
            if f.f > self.lo && (f.f < self.hi || (f.f == self.hi && f.from > self.hi_from)) {
                self.hi = f.f;
                self.hi_from = f.from;
            }
        }
    }

    /// The next reduction while rising from a converged one.
    fn next_up(&self, from: f64, r: f64) -> f64 {
        let mut next = from * (1.0 + r);
        if let Some(guide) = self.guide {
            if from < 1.05 * guide {
                next = js::math::min(
                    next,
                    if from < 0.97 * guide {
                        0.97 * guide
                    } else {
                        from + 0.02 * guide
                    },
                );
            }
        }
        next
    }

    /// Run a batch from the current converged state (or the unloaded one):
    /// the first half of `round`, up to its `yield`.
    fn start_round(&mut self, fs: Vec<f64>, after: After) -> SrmStep {
        // (a warm start bounds nothing either: only a converged F does)
        let warm = self.lo > 0.0 && self.lo_state.is_some();
        let from = self.lo;
        let batch = TrialBatch {
            start: self.lo_state.clone(),
            start_f: if warm { from } else { 0.0 },
            f: fs.clone(),
        };
        self.pending = Some(Pending {
            fs,
            warm,
            from,
            after,
        });
        SrmStep::Batch(batch)
    }

    /// The second half of `round`: take the outcomes; whether one converged above `lo`.
    fn finish_round(&mut self, p: &Pending, out: Vec<TrialOutcome>) -> bool {
        let fs = &p.fs;
        let mut best: i64 = -1;
        for (k, r) in out.iter().enumerate() {
            self.iterations += r.iterations;
            let t = SrmTrial {
                f: fs[k],
                converged: r.converged,
                iterations: r.iterations,
                solver: r.solver,
                start_f: if p.warm { p.from } else { 0.0 },
                max_displacement: max_abs(&r.state.u),
            };
            self.trials.push(t);
            if !r.converged && p.warm {
                self.failures.push(Failure {
                    f: fs[k],
                    from: p.from,
                });
            }
            if r.converged && fs[k] > self.lo && (best < 0 || fs[k] > fs[best as usize]) {
                best = k as i64;
            }
        }
        if best >= 0 {
            let best = best as usize;
            self.lo = fs[best];
            let state = out
                .into_iter()
                .nth(best)
                .expect("an outcome per trial")
                .state;
            self.prev_state = self.lo_state.take();
            self.lo_state = Some(Arc::new(state));
        } else if self.lo == 0.0 && self.lo_state.is_some() {
            // a warm start that did not converge is tried again lower (WARM_TRIES
            // in all, F × WARM_FALL each), then dropped: the trials go on from the
            // unloaded state
            self.warm_left -= 1;
            if self.warm_left <= 0 {
                self.lo_state = None;
            }
        }
        self.update();
        best >= 0
    }

    /// The end of the bracketing loop's body: the limits, then the loop's
    /// increment and test.
    fn end_bracket_body(&mut self) {
        if self.f > 100.0 {
            self.warning = Some("no failure below F = 100".to_string());
            self.pos = Pos::BisectTop;
            return;
        }
        if self.f < 0.01 {
            self.warning = Some("no converged trial above F = 0.01".to_string());
            self.pos = Pos::BisectTop;
            return;
        }
        self.k += 1;
        self.pos = Pos::BracketTop;
    }

    /// One step: `outcomes` are those of the batch the previous step asked
    /// for (None on the first call). Returns the next batch or the result.
    pub fn step(
        &mut self,
        model: &FeModel,
        outcomes: Option<Vec<TrialOutcome>>,
    ) -> Result<SrmStep> {
        if self.pos == Pos::Finished {
            return Err(EngineError::new("the strength reduction search has ended"));
        }
        match (self.pending.take(), outcomes) {
            (Some(p), Some(out)) => {
                if out.len() != p.fs.len() {
                    return Err(EngineError::new(format!(
                        "the strength reduction search asked for {} trials and got {}",
                        p.fs.len(),
                        out.len()
                    )));
                }
                let ok = self.finish_round(&p, out);
                match p.after {
                    After::Bracket1 => {
                        if ok {
                            if self.hi.is_finite() {
                                self.f = (self.f + self.hi) / 2.0;
                            } else {
                                self.f = self.next_up(self.f, self.rise);
                                // With associated flow the limit does not depend on the path, so
                                // the step can grow; with non-associated flow the state does, and
                                // F rises in equal steps as in Griffiths & Lane.
                                if !self.non_associated {
                                    self.rise = js::math::min(0.25, self.rise * 1.5);
                                }
                            }
                        } else {
                            self.f = if self.lo > 0.0 {
                                (self.lo + self.f) / 2.0
                            } else if self.lo_state.is_some() {
                                self.f * WARM_FALL
                            } else {
                                self.f / 1.5
                            };
                        }
                        self.end_bracket_body();
                    }
                    After::BracketN { rises } => {
                        // (rises[perRound − 1]: undefined, NaN in arithmetic, if there are none)
                        let last = rises.last().copied().unwrap_or(f64::NAN);
                        if !self.hi.is_finite() {
                            self.f = self.next_up(self.lo, last);
                            self.rise = last;
                        } else {
                            self.f = (self.lo + self.hi) / 2.0;
                        }
                        self.end_bracket_body();
                    }
                    After::Bisect => self.pos = Pos::BisectTop,
                    After::Confirm {
                        failed,
                        failed_from,
                    } => {
                        if self.hi == failed {
                            self.pos = Pos::Finish;
                        } else {
                            // The failure was false. Other failures decided from the same or a
                            // lower state are suspect too: they are dropped, and the search goes on
                            // above in small steps and finds them again if they are real.
                            self.failures.retain(|f| !(f.from <= failed_from));
                            self.update();
                            self.rise = js::math::min(self.rise, 0.04);
                            self.f = if self.hi.is_finite() {
                                (self.lo + self.hi) / 2.0
                            } else {
                                self.next_up(self.lo, self.rise)
                            };
                            self.confirmations += 1;
                            self.k = 0;
                            self.pos = Pos::BracketTop;
                        }
                    }
                }
            }
            (None, None) => {}
            (Some(p), None) => {
                self.pending = Some(p);
                return Err(EngineError::new(
                    "the strength reduction search is waiting for the outcomes of its trials",
                ));
            }
            (None, Some(_)) => {
                return Err(EngineError::new(
                    "the strength reduction search asked for no trials",
                ))
            }
        }
        loop {
            match self.pos {
                Pos::BracketTop => {
                    if self.k < 40 && !(self.lo > 0.0 && self.hi.is_finite()) {
                        if self.lo == 0.0
                            || self.hi.is_finite()
                            || self.non_associated
                            || self.per_round == 1.0
                        {
                            // One trial: from the unloaded state, or towards a known failure, or
                            // in the equal steps of non-associated flow.
                            return Ok(self.start_round(vec![self.f], After::Bracket1));
                        }
                        // Associated flow rising from a converged state: the next steps at once.
                        let mut fs = Vec::new();
                        let mut rises = Vec::new();
                        let mut f = self.lo;
                        let mut r = self.rise;
                        let mut n = 0.0;
                        while n < self.per_round {
                            f = self.next_up(f, r);
                            fs.push(f);
                            r = js::math::min(0.25, r * 1.5);
                            rises.push(r);
                            n += 1.0;
                        }
                        return Ok(self.start_round(fs, After::BracketN { rises }));
                    }
                    self.pos = Pos::BisectTop;
                }
                Pos::BisectTop => {
                    // Bisect (multisect): as many points as needed to bring the bracket
                    // within the tolerance in one round, at most `trials_per_round`.
                    let (lo, hi) = (self.lo, self.hi);
                    if lo > 0.0 && hi.is_finite() && hi - lo > self.f_tol {
                        let n = js::math::min(
                            self.per_round,
                            js::math::max(1.0, ((hi - lo) / self.f_tol).ceil() - 1.0),
                        );
                        let mut fs = Vec::new();
                        let mut k = 0.0;
                        while k < n {
                            fs.push(lo + ((hi - lo) * (k + 1.0)) / (n + 1.0));
                            k += 1.0;
                        }
                        return Ok(self.start_round(fs, After::Bisect));
                    }
                    self.pos = Pos::ConfirmCheck;
                }
                Pos::ConfirmCheck => {
                    if self.warning.is_some()
                        || !(self.lo > 0.0 && self.hi.is_finite())
                        || self.hi_from >= self.lo
                        || self.confirmations >= MAX_CONFIRMATIONS
                    {
                        self.pos = Pos::Finish;
                        continue;
                    }
                    let (failed, failed_from) = (self.hi, self.hi_from);
                    return Ok(self.start_round(
                        vec![failed],
                        After::Confirm {
                            failed,
                            failed_from,
                        },
                    ));
                }
                Pos::Finish => {
                    self.pos = Pos::Finished;
                    return Ok(SrmStep::Done(Box::new(self.result(model))));
                }
                Pos::Finished => unreachable!("checked on entry"),
            }
        }
    }

    fn result(&mut self, model: &FeModel) -> SrmResult {
        let (lo, hi, hi_from) = (self.lo, self.hi, self.hi_from);
        if self.warning.is_none() && lo > 0.0 && hi.is_finite() && hi_from < lo {
            self.warning = Some(format!(
                "the failure at F = {} was not confirmed from the converged state at {}",
                js::num::to_fixed(hi, 3),
                js::num::to_fixed(lo, 3)
            ));
        }
        // Displacements depend on the load path, so only trials that rose from a
        // converged state are compared (a trial from the unloaded state carries
        // the whole weight at once); the reference rate is that of the first two.
        // A reduction converged more than once keeps its first trial.
        let mut sorted: Vec<&SrmTrial> = self
            .trials
            .iter()
            .filter(|t| t.converged && t.start_f > 0.0)
            .collect();
        js::array::sort_by(&mut sorted, |a, b| a.f - b.f);
        let conv: Vec<&SrmTrial> = (0..sorted.len())
            .filter(|&k| k == 0 || sorted[k].f > sorted[k - 1].f)
            .map(|k| sorted[k])
            .collect();
        let mut jump: Option<f64> = None;
        if conv.len() >= 3 {
            let rate0 =
                (conv[1].max_displacement - conv[0].max_displacement) / (conv[1].f - conv[0].f);
            jump = Some(conv[conv.len() - 1].f);
            for k in 2..conv.len() {
                let rate = (conv[k].max_displacement - conv[k - 1].max_displacement)
                    / (conv[k].f - conv[k - 1].f);
                if rate0 > 0.0 && rate > 10.0 * rate0 {
                    jump = Some(conv[k - 1].f);
                    break;
                }
            }
        }
        SrmResult {
            factor_of_safety: lo,
            failed_f: hi,
            failed_from: hi_from,
            displacement_jump_f: jump,
            trials: self.trials.clone(),
            state: match &self.lo_state {
                Some(s) => Arc::clone(s),
                None => Arc::new(empty_state(model)),
            },
            previous_state: self.prev_state.clone(),
            iterations: self.iterations,
            warning: self.warning.clone(),
        }
    }
}
