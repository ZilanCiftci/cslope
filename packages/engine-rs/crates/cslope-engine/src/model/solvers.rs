//! Port of packages/engine/src/model/solvers.ts
//!
//! Factor of Safety (FOS) solvers for slope stability analysis.
//!
//! All Numba JIT functions are ported to plain loops.
//!
//! The slice property arrays TypeScript allocates per solve
//! (`getSlicePropertyArrays`) are a reusable `SliceArrays` scratch here
//! (ARCHITECTURE.md §1.4); it also holds tan φ, cos α and sin α of each slice,
//! which TypeScript computes in every iteration (the same values). The
//! solvers write `undrained_governs` into the slices they are given, as
//! TypeScript's do.

use crate::api::ctx::{EvalCtx, RunCtx, SearchPhase};
use crate::error::{EngineError, Result};
use crate::js;
use crate::math::helpers::{extrapolate_lambda, get_interslice_function_value};
use crate::model::block_search::{best_distinct, block_search_steps, BLOCK_SEEDS};
use crate::model::drawdown::apply_rapid_drawdown;
use crate::model::mp_march::{analyse_morgenstern_price_march, LAMBDA_MAX, LAMBDA_MIN};
use crate::model::optimize::{optimise_non_circular_steps, optimise_polylines_steps};
use crate::model::search::{
    generate_local_planes, generate_refined_planes, is_plane_within_external_boundary, plane_key,
    plane_keys, set_entry_exit_planes,
};
use crate::model::slices::{get_slices, SliceScratch, WATER_LINE_GAP};
use crate::model::slope::{Pt, SearchPlane, Slope};
use crate::model::steps::{run_steps_with_hint, BoxedSteps, PlaneSteps, Step};
use crate::types::analysis::{
    AnalysisMethod, IntersliceFunctionType, SearchMethod, SurfaceRejection,
};
use crate::types::geometry::Slice;
use crate::types::hoek_brown::instantaneous_at_normal_stress;
use crate::types::strength::{design_strength, shear_normal_at, ResolvedStrength};
use std::collections::{HashMap, HashSet};
use std::f64::consts::PI;
use std::sync::atomic::{AtomicU8, Ordering};

/// Which Morgenstern-Price solver `analyse_slope` runs: the iterative one
/// (default) or the experimental march solver (`mp_march.rs`), for
/// comparison runs. Not an analysis option: set by scripts and tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MpSolver {
    #[default]
    Iterative,
    March,
}

/// The module global of TypeScript (process-wide, ARCHITECTURE.md §1.1).
static MORGENSTERN_PRICE_SOLVER: AtomicU8 = AtomicU8::new(0);

pub fn set_morgenstern_price_solver(solver: MpSolver) {
    MORGENSTERN_PRICE_SOLVER.store(
        match solver {
            MpSolver::Iterative => 0,
            MpSolver::March => 1,
        },
        Ordering::Relaxed,
    );
}

/// The Morgenstern-Price solver set (a parallel evaluator must use the same).
pub fn get_morgenstern_price_solver() -> MpSolver {
    match MORGENSTERN_PRICE_SOLVER.load(Ordering::Relaxed) {
        1 => MpSolver::March,
        _ => MpSolver::Iterative,
    }
}

// ────────────────────────────────────────────────────────────────
// Slice property arrays (replaces _get_slice_property_arrays)
// ────────────────────────────────────────────────────────────────

/// The slices' properties as arrays (TypeScript's `SliceArrays`), reused
/// from surface to surface (`fill`).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SliceArrays {
    pub weights: Vec<f64>,
    pub udls: Vec<f64>,
    pub lls: Vec<f64>,
    pub h_forces: Vec<f64>,
    pub extra_moments: Vec<f64>,
    /// Reinforcement [down, horizontal, moment]: active as is, passive ÷ F.
    pub active_v: Vec<f64>,
    pub active_h: Vec<f64>,
    pub active_m: Vec<f64>,
    pub passive_v: Vec<f64>,
    pub passive_h: Vec<f64>,
    pub passive_m: Vec<f64>,
    /// Moment arms of base shear and normal force about the centre.
    pub shear_arms: Vec<f64>,
    pub normal_arms: Vec<f64>,
    pub alphas: Vec<f64>,
    pub base_lengths: Vec<f64>,
    pub phis: Vec<f64>,
    pub us: Vec<f64>,
    pub cohesions: Vec<f64>,
    pub cohesion_undraineds: Vec<f64>,
    pub material_codes: Vec<i32>,
    pub dxs: Vec<f64>,
    pub funcs: Vec<f64>,
    /// tan φ, cos α, sin α of each slice (computed once; TypeScript computes
    /// the same values in each iteration).
    pub tan_phis: Vec<f64>,
    pub cos_as: Vec<f64>,
    pub sin_as: Vec<f64>,
    /// The base normal forces of the last solve (TypeScript's `nCurrent`).
    pub normals: Vec<f64>,
}

/// The solver scratch of one thread (ARCHITECTURE.md §1.4).
pub type SolverScratch = SliceArrays;

impl SliceArrays {
    pub fn new() -> Self {
        SliceArrays::default()
    }

    /// Number of slices.
    pub fn len(&self) -> usize {
        self.weights.len()
    }

    pub fn is_empty(&self) -> bool {
        self.weights.is_empty()
    }

    /// Refill from the slices of a surface from x0 to x1.
    pub fn fill(
        &mut self,
        slices: &[Slice],
        x0: f64,
        x1: f64,
        interslice_function: IntersliceFunctionType,
        interslice_data_points: &[Pt],
    ) {
        macro_rules! clear {
            ($($f:ident),*) => { $( self.$f.clear(); )* };
        }
        clear!(
            weights,
            udls,
            lls,
            h_forces,
            extra_moments,
            active_v,
            active_h,
            active_m,
            passive_v,
            passive_h,
            passive_m,
            shear_arms,
            normal_arms,
            alphas,
            base_lengths,
            phis,
            us,
            cohesions,
            cohesion_undraineds,
            material_codes,
            dxs,
            funcs,
            tan_phis,
            cos_as,
            sin_as,
            normals
        );
        for s in slices {
            self.weights.push(s.weight);
            // Free water on the slice acts like a surface load.
            self.udls.push(s.udl + s.water_load.unwrap_or(0.0));
            self.lls.push(s.ll);
            self.h_forces.push(s.h_force.unwrap_or(0.0));
            self.extra_moments.push(s.extra_moment.unwrap_or(0.0));
            let [av, ah, am] = s.reinforcement_active.unwrap_or([0.0; 3]);
            self.active_v.push(av);
            self.active_h.push(ah);
            self.active_m.push(am);
            let [pv, ph, pm] = s.reinforcement_passive.unwrap_or([0.0; 3]);
            self.passive_v.push(pv);
            self.passive_h.push(ph);
            self.passive_m.push(pm);
            self.shear_arms.push(s.r);
            self.normal_arms.push(s.normal_arm.unwrap_or(0.0));
            self.alphas.push(s.alpha);
            self.base_lengths.push(s.base_length);
            self.phis.push(s.phi);
            self.us.push(s.u);
            self.cohesions.push(s.cohesion);
            self.cohesion_undraineds.push(s.cohesion_undrained);
            self.material_codes
                .push(if s.is_combined == Some(true) { 1 } else { 0 });
            self.dxs.push(s.dx);
            self.funcs.push(get_interslice_function_value(
                Some(interslice_function),
                s.x_right,
                x0,
                x1,
                interslice_data_points,
            ));
            self.tan_phis.push(js::math::tan(s.phi));
            self.cos_as.push(js::math::cos(s.alpha));
            self.sin_as.push(js::math::sin(s.alpha));
            self.normals.push(0.0);
        }
    }

    /// Refill from the slices with the slope's interslice function.
    fn fill_for(&mut self, slope: &Slope, slices: &[Slice]) {
        let points = slope.interslice_data_points();
        self.fill(
            slices,
            slices[0].x_left,
            slices[slices.len() - 1].x_right,
            slope.interslice_function(),
            &points,
        );
    }
}

/// The slice property arrays (TypeScript's `getSlicePropertyArrays`).
pub fn get_slice_property_arrays(
    slices: &[Slice],
    x0: f64,
    x1: f64,
    interslice_function: IntersliceFunctionType,
    interslice_data_points: &[Pt],
) -> SliceArrays {
    let mut p = SliceArrays::new();
    p.fill(slices, x0, x1, interslice_function, interslice_data_points);
    p
}

// ────────────────────────────────────────────────────────────────
// Low-level iterative solvers
// ────────────────────────────────────────────────────────────────

/// A solve's result (TypeScript's `SolverResult` without `N`, which is left
/// in `SliceArrays::normals`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SolverResult {
    pub fos: Option<f64>,
    pub pushing: f64,
    pub resisting: f64,
    pub converged: bool,
}

/// Trial-FOS increases allowed when the driving side vanishes (×2 each: 0.1 → 400).
const MAX_NON_POSITIVE: u32 = 12;

/// Base normal force and right-hand interslice forces of one slice from
/// vertical equilibrium with the shear mobilised at the trial FOS.
///
/// `eff_c`: effective cohesion force C' = c·l − U·l·tanφ (kN/m); `tan_phi`:
/// tan of the friction angle governing the slice. Returns [N, E_right, X_right].
#[allow(clippy::too_many_arguments)]
#[inline]
pub fn solve_slice_normal(
    w: f64,
    x_left: f64,
    e_left: f64,
    eff_c: f64,
    tan_phi: f64,
    cos_a: f64,
    sin_a: f64,
    shear_factor: f64,
    fos: f64,
) -> [f64; 3] {
    let mut malpha = cos_a + (sin_a * tan_phi) / fos;
    if malpha.abs() < 1e-12 {
        malpha = if malpha >= 0.0 { 1e-12 } else { -1e-12 };
    }
    let base_constant = e_left + (eff_c * cos_a) / fos;
    let n_multiplier = (tan_phi * cos_a) / fos - sin_a;
    let num = w + x_left - (eff_c * sin_a) / fos + base_constant * shear_factor;
    let mut denom = malpha - n_multiplier * shear_factor;
    if denom.abs() < 1e-12 {
        denom = if denom >= 0.0 { 1e-12 } else { -1e-12 };
    }
    let n = num / denom;
    let e_right = base_constant + n * n_multiplier;
    [n, e_right, -e_right * shear_factor]
}

/// The secant step of both solvers (see below).
#[inline]
fn secant_next(iter: f64, fos: f64, prev_fos: f64, sec_f: &mut f64, sec_r: &mut f64) -> f64 {
    // Secant on r(F) = R(F)/D(F) − F, whose root is the fixed point: it
    // converges in a few iterations where the relaxed fixed-point step
    // F ← F + ½(R/D − F) needed 10–15. A step that leaves F ≤ 0.05 or
    // is not finite falls back to the plain fixed-point step.
    let r = fos - prev_fos;
    let mut next = fos;
    if iter > 0.0 && r != *sec_r {
        next = prev_fos - (r * (prev_fos - *sec_f)) / (r - *sec_r);
    }
    if !(next > 0.05) || !next.is_finite() {
        next = fos;
    }
    *sec_f = prev_fos;
    *sec_r = r;
    next
}

/// Generic moment equilibrium FOS solver.
#[allow(clippy::needless_range_loop)]
pub fn solve_fos_generic_moment(
    p: &mut SliceArrays,
    slices: &mut [Slice],
    lambda_val: f64,
    initial_fos: f64,
    max_iters: f64,
    tolerance: f64,
) -> SolverResult {
    let n = p.len();
    p.normals.clear();
    p.normals.resize(n, 0.0);
    let mut prev_fos = initial_fos;
    let mut fos = initial_fos;
    let mut pushing = 0.0;
    let mut resisting = 0.0;
    let mut non_positive = 0;
    let mut sec_f = 0.0;
    let mut sec_r = 0.0;

    let mut inner_converged = false;
    let mut iter = 0.0;
    while iter < max_iters {
        pushing = 0.0;
        resisting = 0.0;
        let mut passive_moment = 0.0;
        let mut e_left = 0.0;
        let mut x_left = 0.0;

        // Passive reinforcement mobilises with the soil: divided by F (an
        // initial guess of 0 from the Ordinary method would give NaN).
        let k_p = if prev_fos > 0.0 { 1.0 / prev_fos } else { 1.0 };
        for i in 0..n {
            let w = p.weights[i] + p.udls[i] + p.lls[i] + p.active_v[i] + p.passive_v[i] * k_p;
            // Horizontal external force in the sliding direction; with the
            // solvers' sign of E it reduces the interslice force on the right.
            let h = p.h_forces[i] + p.active_h[i] + p.passive_h[i] * k_p;
            let c = p.cohesions[i];
            let bl = p.base_lengths[i];
            let u = p.us[i];
            let dx = p.dxs[i];
            let f = p.funcs[i];
            let mat_code = p.material_codes[i];
            let cu = p.cohesion_undraineds[i];

            let tan_phi = p.tan_phis[i];
            let cos_a = p.cos_as[i];
            let sin_a = p.sin_as[i];
            let shear_factor = lambda_val * f;

            let [mut nn, mut e_right, mut x_right] = solve_slice_normal(
                w,
                x_left,
                e_left - h,
                c * bl - u * bl * tan_phi,
                tan_phi,
                cos_a,
                sin_a,
                shear_factor,
                prev_fos,
            );
            let r = p.shear_arms[i];
            let shear = c * bl + (nn - u * bl) * tan_phi;
            let mut res = shear * r;
            // Combined method: where the undrained strength governs, the
            // slice must be in equilibrium with that (smaller) shear too; a
            // negative drained shear (N′ < 0, e.g. m_α < 0 on a steep slice)
            // is replaced the same way, which keeps the iteration stable.
            // (Compared as forces: on a non-circular surface the arm can be
            // negative.)
            let mut undrained_governs = false;
            if mat_code == 1 && !(shear >= 0.0 && shear <= cu * bl) {
                undrained_governs = true;
                [nn, e_right, x_right] = solve_slice_normal(
                    w,
                    x_left,
                    e_left - h,
                    cu * bl,
                    0.0,
                    cos_a,
                    sin_a,
                    shear_factor,
                    prev_fos,
                );
                res = cu * bl * r;
            }
            resisting += res;
            if mat_code == 1 {
                slices[i].undrained_governs = Some(undrained_governs);
            }

            // On a non-circular surface the normal force has a moment too.
            // Passive reinforcement is resistance: its moment is collected
            // unscaled and taken off the driving side below.
            pushing += (w - p.passive_v[i] * k_p) * dx
                + p.extra_moments[i]
                + p.active_m[i]
                + nn * p.normal_arms[i];
            passive_moment += p.passive_v[i] * dx + p.passive_m[i];
            p.normals[i] = nn;
            e_left = e_right;
            x_left = x_right;
        }

        // F = R / (D + P/F)  ⇔  F = (R − P) / D, with P (< 0) the passive
        // moment: no division by a driving moment the passive force could
        // make vanish.
        resisting -= passive_moment;
        // A trial FOS far too low can make the driving side vanish for one
        // iteration (large active loads, steep slices): raise the trial
        // value instead of giving up on the surface.
        if pushing <= 0.0 {
            non_positive += 1;
            if non_positive > MAX_NON_POSITIVE {
                return SolverResult {
                    fos: None,
                    pushing,
                    resisting,
                    converged: false,
                };
            }
            prev_fos = js::math::max(2.0 * prev_fos, 0.1);
            iter += 1.0;
            continue;
        }

        fos = resisting / pushing;
        if (prev_fos - fos).abs() < tolerance {
            inner_converged = true;
            break;
        }
        prev_fos = secant_next(iter, fos, prev_fos, &mut sec_f, &mut sec_r);
        iter += 1.0;
    }
    SolverResult {
        fos: Some(fos),
        pushing,
        resisting,
        converged: inner_converged,
    }
}

/// Generic force equilibrium FOS solver for circular surfaces.
#[allow(clippy::needless_range_loop)]
pub fn solve_fos_generic_force_circular(
    p: &mut SliceArrays,
    slices: &mut [Slice],
    lambda_val: f64,
    initial_fos: f64,
    max_iters: f64,
    tolerance: f64,
) -> SolverResult {
    let n = p.len();
    p.normals.clear();
    p.normals.resize(n, 0.0);
    let mut prev_fos = initial_fos;
    let mut fos = initial_fos;
    let mut pushing = 0.0;
    let mut resisting = 0.0;
    let mut non_positive = 0;
    let mut sec_f = 0.0;
    let mut sec_r = 0.0;

    let mut inner_converged = false;
    let mut iter = 0.0;
    while iter < max_iters {
        pushing = 0.0;
        resisting = 0.0;
        let mut passive_force = 0.0;
        let mut e_left = 0.0;
        let mut x_left = 0.0;

        // Passive reinforcement mobilises with the soil: divided by F (an
        // initial guess of 0 from the Ordinary method would give NaN).
        let k_p = if prev_fos > 0.0 { 1.0 / prev_fos } else { 1.0 };
        for i in 0..n {
            let w = p.weights[i] + p.udls[i] + p.lls[i] + p.active_v[i] + p.passive_v[i] * k_p;
            // Horizontal external force in the sliding direction; with the
            // solvers' sign of E it reduces the interslice force on the right.
            let h = p.h_forces[i] + p.active_h[i] + p.passive_h[i] * k_p;
            let c = p.cohesions[i];
            let bl = p.base_lengths[i];
            let u = p.us[i];
            let f = p.funcs[i];
            let mat_code = p.material_codes[i];
            let cu = p.cohesion_undraineds[i];

            let tan_phi = p.tan_phis[i];
            let cos_a = p.cos_as[i];
            let sin_a = p.sin_as[i];
            let shear_factor = lambda_val * f;

            let [mut nn, mut e_right, mut x_right] = solve_slice_normal(
                w,
                x_left,
                e_left - h,
                c * bl - u * bl * tan_phi,
                tan_phi,
                cos_a,
                sin_a,
                shear_factor,
                prev_fos,
            );
            // Circular force equilibrium resistance
            let mut res = c * bl * cos_a + (nn - u * bl) * cos_a * tan_phi;
            // Combined method: where the undrained strength governs, N and the
            // interslice forces must follow from that shear as well.
            let mut undrained_governs = false;
            if mat_code == 1 && !(res >= 0.0 && res <= cu * bl * cos_a) {
                undrained_governs = true;
                [nn, e_right, x_right] = solve_slice_normal(
                    w,
                    x_left,
                    e_left - h,
                    cu * bl,
                    0.0,
                    cos_a,
                    sin_a,
                    shear_factor,
                    prev_fos,
                );
                res = cu * bl * cos_a;
            }
            resisting += res;
            if mat_code == 1 {
                slices[i].undrained_governs = Some(undrained_governs);
            }

            pushing += nn * sin_a + h - p.passive_h[i] * k_p;
            passive_force += p.passive_h[i];
            p.normals[i] = nn;
            e_left = e_right;
            x_left = x_right;
        }

        // Passive horizontal force (< 0) on the resisting side, as above.
        resisting -= passive_force;
        // As in the moment solver: a too-low trial value is raised.
        if pushing <= 0.0 {
            non_positive += 1;
            if non_positive > MAX_NON_POSITIVE {
                return SolverResult {
                    fos: None,
                    pushing,
                    resisting,
                    converged: false,
                };
            }
            prev_fos = js::math::max(2.0 * prev_fos, 0.1);
            iter += 1.0;
            continue;
        }

        fos = resisting / pushing;
        if (prev_fos - fos).abs() < tolerance {
            inner_converged = true;
            break;
        }
        prev_fos = secant_next(iter, fos, prev_fos, &mut sec_f, &mut sec_r);
        iter += 1.0;
    }
    SolverResult {
        fos: Some(fos),
        pushing,
        resisting,
        converged: inner_converged,
    }
}

// ────────────────────────────────────────────────────────────────
// High-level analysis methods
// ────────────────────────────────────────────────────────────────

/// Ordinary (Swedish) method of slices.
pub fn analyse_ordinary(_slope: &Slope, slices: &[Slice]) -> Option<f64> {
    let mut pushing = 0.0;
    let mut resisting = 0.0;
    // External moments as forces along the base: divided by the mean shear
    // arm (the radius on a circle; per-slice arms on a polyline can be ~0).
    let mut arm_sum = 0.0;
    let mut len_sum = 0.0;
    for s in slices {
        arm_sum += s.r * s.base_length;
        len_sum += s.base_length;
    }
    let mean_arm = if len_sum > 0.0 {
        arm_sum / len_sum
    } else {
        0.0
    };
    // A composite circle (arc and slices along the floor): one moment balance
    // about the centre, each force with its own arm, over the mean arm.
    let composite = slices.iter().any(|s| s.circular == Some(true))
        && slices.iter().any(|s| s.circular != Some(true));

    for s in slices {
        // Reinforcement: active forces load the slice; passive ones (divided
        // by F in the solvers) are added to the resistance.
        let ra = s.reinforcement_active;
        let rp = s.reinforcement_passive;
        let w = slice_vertical_load(s) + ra.map_or(0.0, |r| r[0]);
        let r_moment = ra.map_or(0.0, |r| r[2]);
        // A horizontal force (+x, sliding direction: reinforcement, water on
        // the ground or in a crack) lifts the slice off its base.
        let h_normal =
            (ra.map_or(0.0, |r| r[1]) + s.h_force.unwrap_or(0.0)) * js::math::sin(s.alpha);
        if let Some(rp) = rp {
            if mean_arm > 1e-9 {
                resisting -= (rp[0] * s.dx + rp[2]) / mean_arm;
            }
        }

        let arm = if composite && mean_arm > 1e-9 {
            s.r / mean_arm
        } else {
            1.0
        };
        if s.is_combined == Some(true) {
            let fd = s.cohesion * s.base_length
                + js::math::max(
                    0.0,
                    w * js::math::cos(s.alpha) - h_normal - s.u * s.base_length,
                ) * js::math::tan(s.phi);
            let fu = s.cohesion_undrained * s.base_length;
            resisting += js::math::min(fd, fu) * arm;
        } else {
            resisting += (s.cohesion * s.base_length
                + js::math::max(
                    0.0,
                    w * js::math::cos(s.alpha) - h_normal - s.u * s.base_length,
                ) * js::math::tan(s.phi))
                * arm;
        }

        // Driving force along the base: on a circle the weight's moment W·dx
        // over the radius (the same moment as the other methods; α is at the
        // middle of the arc, where R sin α differs slightly from dx); on a
        // composite circle with the floor slices' normal forces' moments too.
        let drive = if composite && mean_arm > 1e-9 {
            (w * s.dx + (w * js::math::cos(s.alpha) - h_normal) * s.normal_arm.unwrap_or(0.0))
                / mean_arm
        } else {
            w * if s.circular == Some(true) {
                s.dx / s.r
            } else {
                js::math::sin(s.alpha)
            }
        };
        pushing += drive
            + if mean_arm > 1e-9 {
                (s.extra_moment.unwrap_or(0.0) + r_moment) / mean_arm
            } else {
                0.0
            };
    }

    if pushing <= 0.0 {
        return None;
    }
    Some(resisting / pushing)
}

/// (fos, pushing, resisting, converged) of Bishop's and Janbu's methods.
pub type MethodResult = (Option<f64>, Option<f64>, Option<f64>, bool);

/// Bishop's Simplified Method (`fs`: the initial FOS; None: the Ordinary
/// method's).
pub fn analyse_bishop(slope: &Slope, slices: &mut [Slice], fs: Option<f64>) -> MethodResult {
    analyse_bishop_with(slope, slices, fs, &mut SliceArrays::new())
}

/// `analyse_bishop` with a reused scratch.
pub fn analyse_bishop_with(
    slope: &Slope,
    slices: &mut [Slice],
    fs: Option<f64>,
    p: &mut SliceArrays,
) -> MethodResult {
    let fs = match fs {
        Some(f) => Some(f),
        None => analyse_ordinary(slope, slices),
    };
    let Some(fs) = fs else {
        return (None, None, None, true);
    };

    p.fill_for(slope, slices);
    let r = solve_fos_generic_moment(
        p,
        slices,
        0.0, // lambda = 0
        fs,
        slope.max_iterations(),
        slope.tolerance(),
    );

    match r.fos {
        None => (None, None, None, false),
        Some(fos) => (Some(fos), Some(r.pushing), Some(r.resisting), r.converged),
    }
}

/// Janbu correction factor f₀ (Janbu, 1973).
///
/// The Simplified Method underestimates FOS because it neglects interslice
/// shear forces. The empirical correction compensates for this:
///
///   F_corrected = f₀ × F_simplified
///   f₀ = 1 + b₁ × [d/L − 1.4 × (d/L)²]
///
/// where L = length of the chord connecting the entry and exit points of
/// the failure surface and d = the greatest depth of the surface measured
/// perpendicular to that chord, and b₁ depends on soil type:
///   c-only soil (φ=0): b₁ = 0.69
///   φ-only soil (c=0): b₁ = 0.31
///   c-φ soil:          b₁ = 0.50
pub fn janbu_correction_factor(slices: &[Slice]) -> f64 {
    if slices.is_empty() {
        return 1.0;
    }

    // Entry and exit points on the failure surface
    let x_entry = slices[0].x_left;
    let y_entry = slices[0].y0_bottom;
    let x_exit = slices[slices.len() - 1].x_right;
    let y_exit = slices[slices.len() - 1].y1_bottom;

    // L = chord length, d = largest depth perpendicular to the chord
    let l = js::math::hypot(&[x_exit - x_entry, y_exit - y_entry]);
    if l <= 0.0 {
        return 1.0;
    }
    let mut d = 0.0;
    for s in slices {
        // Signed distance of the base midpoint below the chord line
        let depth = ((x_exit - x_entry) * (y_entry - s.y_bottom)
            - (y_exit - y_entry) * (x_entry - s.x))
            / l;
        if depth > d {
            d = depth;
        }
    }

    let d_over_l = d / l;

    // Determine b₁ from the soil type across all slices.
    // Pure cohesion (φ=0): b₁ = 0.69, pure friction (c=0): b₁ = 0.31, mixed: b₁ = 0.50
    let mut has_cohesion = false;
    let mut has_friction = false;
    for s in slices {
        if s.cohesion > 0.0 {
            has_cohesion = true;
        }
        if s.phi > 0.0 {
            has_friction = true;
        }
        if has_cohesion && has_friction {
            break;
        }
    }

    let b1 = if has_cohesion && has_friction {
        0.5
    } else if has_cohesion {
        0.69
    } else {
        0.31
    };

    // f₀ = 1 + b₁ × [d/L − 1.4 × (d/L)²]
    1.0 + b1 * (d_over_l - 1.4 * d_over_l * d_over_l)
}

/// Janbu's Simplified Method with correction factor f₀ (Janbu, 1973).
///
/// Satisfies horizontal force equilibrium with λ = 0 (no interslice shear).
/// The empirical correction factor f₀ compensates for the systematic
/// underestimation inherent in the simplified assumption.
pub fn analyse_janbu(slope: &Slope, slices: &mut [Slice], fs: Option<f64>) -> MethodResult {
    analyse_janbu_with(slope, slices, fs, &mut SliceArrays::new())
}

/// `analyse_janbu` with a reused scratch.
pub fn analyse_janbu_with(
    slope: &Slope,
    slices: &mut [Slice],
    fs: Option<f64>,
    p: &mut SliceArrays,
) -> MethodResult {
    let fs = match fs {
        Some(f) => Some(f),
        None => analyse_ordinary(slope, slices),
    };
    let Some(fs) = fs else {
        return (None, None, None, true);
    };

    p.fill_for(slope, slices);
    let r = solve_fos_generic_force_circular(
        p,
        slices,
        0.0, // lambda = 0
        fs,
        slope.max_iterations(),
        slope.tolerance(),
    );

    let Some(fos) = r.fos else {
        return (None, None, None, false);
    };

    // Apply Janbu correction factor f₀ (only when enabled)
    let f0 = if slope.janbu_correction() {
        janbu_correction_factor(slices)
    } else {
        1.0
    };
    let corrected_fos = fos * f0;

    (
        Some(corrected_fos),
        Some(r.pushing),
        Some(r.resisting),
        r.converged,
    )
}

/// Effective base normal force N′ = N − u·l (kN) of each slice of a solved
/// surface, as the method's own equilibrium gives it at its factor of
/// safety: Bishop at λ = 0 (moment equation), Janbu at λ = 0 (force
/// equation, with the uncorrected factor), Morgenstern–Price at the accepted
/// λ (the point of `lff_array` with the smallest gap). None when the slices
/// cannot be solved at that factor. N′ can be negative (tension at the base
/// in cohesive soil without a tension crack). Writes `undrained_governs` of
/// the slices, as TypeScript's solvers do.
pub fn solved_effective_normals(
    slope: &Slope,
    slices: &mut [Slice],
    fos: f64,
    lff_array: Option<&[[f64; 4]]>,
) -> Option<Vec<f64>> {
    solved_effective_normals_with(slope, slices, fos, lff_array, &mut SliceArrays::new())
}

/// `solved_effective_normals` with a reused scratch.
pub fn solved_effective_normals_with(
    slope: &Slope,
    slices: &mut [Slice],
    fos: f64,
    lff_array: Option<&[[f64; 4]]>,
    p: &mut SliceArrays,
) -> Option<Vec<f64>> {
    if !solve_effective_normals_in(slope, slices, fos, lff_array, p) {
        return None;
    }
    Some((0..p.len()).map(|i| effective_normal(p, i)).collect())
}

/// N′ of slice `i` after `solve_effective_normals_in`.
#[inline]
fn effective_normal(p: &SliceArrays, i: usize) -> f64 {
    p.normals[i] - p.us[i] * p.base_lengths[i]
}

/// `solved_effective_normals` leaving the normal forces in `p` (read with
/// `effective_normal`); false where it gives None.
fn solve_effective_normals_in(
    slope: &Slope,
    slices: &mut [Slice],
    fos: f64,
    lff_array: Option<&[[f64; 4]]>,
    p: &mut SliceArrays,
) -> bool {
    if slices.is_empty() || !fos.is_finite() {
        return false;
    }
    p.fill_for(slope, slices);
    if slope.method() == AnalysisMethod::Janbu {
        let f = if slope.janbu_correction() {
            fos / janbu_correction_factor(slices)
        } else {
            fos
        };
        let r = solve_fos_generic_force_circular(
            p,
            slices,
            0.0,
            f,
            slope.max_iterations(),
            slope.tolerance(),
        );
        if r.fos.is_none() {
            return false;
        }
    } else {
        let mut lambda = 0.0;
        if slope.method() == AnalysisMethod::MorgensternPrice {
            if let Some(lff) = lff_array.filter(|l| !l.is_empty()) {
                lambda = smallest_gap(lff)[0];
            }
        }
        let r = solve_fos_generic_moment(
            p,
            slices,
            lambda,
            fos,
            slope.max_iterations(),
            slope.tolerance(),
        );
        if r.fos.is_none() {
            return false;
        }
    }
    true
}

/// `[...lffArray].sort((a, b) => a[3] - b[3])[0]`: the entry with the
/// smallest gap (the first of equal ones; V8's sort for NaN gaps).
fn smallest_gap(lff: &[[f64; 4]]) -> [f64; 4] {
    // With finite gaps the comparator is consistent and V8's sort stable:
    // its first entry is the first of the smallest, found without a copy.
    if lff.iter().all(|e| e[3].is_finite()) {
        let mut best = lff[0];
        for e in &lff[1..] {
            if e[3] < best[3] {
                best = *e;
            }
        }
        return best;
    }
    let mut sorted = lff.to_vec();
    js::array::sort_by(&mut sorted, |a, b| a[3] - b[3]);
    sorted[0]
}

/// λ extrapolation steps before falling back to the closest pair.
const MP_MAX_STEPS: u32 = 30;

/// Largest change of λ between two points. Fredlund (1984) moves λ by 0.1
/// per step; a larger jump can land the force iteration on another root of
/// the force equation (a near-pole root at λ = 0.4 on V017a, where the
/// step 0.3 was used).
const MP_MAX_LAMBDA_STEP: f64 = 0.1;

/// Cap on the tolerance of the Morgenstern–Price equilibrium gap |Fm − Ff|,
/// absolute and relative to F.
///
/// Morgenstern & Price (1965), Spencer (1967) and Fredlund & Krahn (1977)
/// define the solution by Fm = Ff: the factor that satisfies moment and
/// force equilibrium at once. The tolerance is the numerical precision of
/// that equality, not a licence for the two equilibria to disagree; the
/// published procedures iterate until F changes by a small amount (Zhu et
/// al. 2005 solve F and λ to convergence), and the default tolerances of
/// the common limit-equilibrium programs are 0.005 and 0.01. The analysis
/// tolerance also sets the Bishop and Janbu iterations, where a loose
/// value only coarsens F; applied to the gap, a loose value (the app
/// allows up to 0.1, the engine any positive value) accepted pairs that
/// are no solution. At tolerance 0.2 a surface was
/// accepted with Fm = −0.003 and Ff = 0.186 (a gap of 200 % of F), and a
/// 1-ulp change of one slice moved the result between −4.2 and 13.9.
///
/// So the gap must be below the tolerance, below 0.01, and below 1 % of F:
/// F is a ratio, and near F → 0 an absolute gap says nothing. 1 % is the
/// resolution at which factors of safety are reported (two decimals near
/// F = 1), and 0.01 is the loosest of the defaults above. At the engine's
/// default tolerance 0.001 the cap binds only for F < 0.1.
const MP_GAP_CAP: f64 = 0.01;

/// Whether a pair (Fm, Ff) meets: both factors positive (F is a ratio of
/// strength to mobilised shear; Fm ≤ 0 lies on the spurious branch of Fm(λ)
/// towards F → 0, see mp_march.rs) and the gap below `tol` (already capped
/// at `MP_GAP_CAP`) and below `MP_GAP_CAP` · F.
fn mp_pair_meets(fm: f64, ff: f64, tol: f64) -> bool {
    fm > 0.0 && ff > 0.0 && (fm - ff).abs() < js::math::min(tol, MP_GAP_CAP * js::math::max(fm, ff))
}

/// The factor where Fm(λ) and Ff(λ) meet, once the pair at `lambda` is
/// within the tolerance: the zero of Fm − Ff interpolated linearly in λ
/// between that pair and its nearest neighbour on the curves, and Fm
/// there. Fm at the accepted λ alone is off the crossing by up to about the
/// tolerance (0.7 % at the default 0.005 on fixed non-circular surfaces,
/// against a solution to 1e-9); near the root the curves are smooth, so the
/// secant through two points brings it to the precision of the pairs. With
/// no neighbour, or one that would extrapolate past it, the mean of the
/// pair.
fn crossing_fos(lff_array: &[[f64; 4]], lambda: f64, fm: f64, ff: f64) -> f64 {
    let mut near: Option<[f64; 4]> = None;
    for e in lff_array {
        if e[0] != lambda && near.is_none_or(|nr| (e[0] - lambda).abs() < (nr[0] - lambda).abs()) {
            near = Some(*e);
        }
    }
    let mean = (fm + ff) / 2.0;
    let Some(near) = near else {
        return mean;
    };
    let d = fm - ff;
    let dn = near[1] - near[2];
    if dn == d {
        return mean;
    }
    // Fraction of the way from `lambda` to the neighbour.
    let t = -d / (dn - d);
    if !(t.abs() <= 1.0) {
        return mean;
    }
    let f = fm + t * (near[1] - fm);
    if f > 0.0 && f.is_finite() {
        f
    } else {
        mean
    }
}

/// The result of `analyse_morgenstern_price` (TypeScript's tuple).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct MpOutcome {
    pub fos: Option<f64>,
    pub lff_array: Option<Vec<[f64; 4]>>,
    pub pushing: Option<f64>,
    pub resisting: Option<f64>,
    /// Complete equilibrium: Fm = Ff within the tolerance (capped, see
    /// `MP_GAP_CAP`) at some λ, both positive. False for a closest-pair
    /// solution (see `closest_pair`).
    pub converged: bool,
    /// |Fm − Ff| of the closest pair when the two never met within the
    /// tolerance; 0 or absent when they did.
    pub equilibrium_gap: Option<f64>,
    /// The curves never met and the closest pair is accepted: both
    /// iterations converged, both factors are positive and the gap is at
    /// most `mpEquilibriumTolerance`.
    /// The factor then satisfies moment equilibrium, force equilibrium only
    /// within the gap, so it is no complete-equilibrium solution in the sense
    /// of Morgenstern & Price (1965), Spencer (1967) and Fredlund & Krahn
    /// (1977), which define it by Fm = Ff; `converged` is false.
    pub closest_pair: Option<bool>,
}

fn mp(
    fos: Option<f64>,
    lff_array: Option<&[[f64; 4]]>,
    pushing: Option<f64>,
    resisting: Option<f64>,
    converged: bool,
) -> MpOutcome {
    MpOutcome {
        fos,
        lff_array: lff_array.map(|l| l.to_vec()),
        pushing,
        resisting,
        converged,
        equilibrium_gap: None,
        closest_pair: None,
    }
}

/// Morgenstern-Price Method.
pub fn analyse_morgenstern_price(slope: &Slope, slices: &mut [Slice]) -> Result<MpOutcome> {
    analyse_morgenstern_price_with(slope, slices, &mut SliceArrays::new())
}

/// `analyse_morgenstern_price` with a reused scratch.
pub fn analyse_morgenstern_price_with(
    slope: &Slope,
    slices: &mut [Slice],
    props: &mut SliceArrays,
) -> Result<MpOutcome> {
    let Some(fs_ord) = analyse_ordinary(slope, slices) else {
        return Ok(mp(None, None, None, None, true));
    };

    props.fill_for(slope, slices);
    let max_iters = slope.max_iterations();
    // The tolerance of the gap Fm − Ff, at most MP_GAP_CAP (see there).
    let tol = js::math::min(slope.tolerance(), MP_GAP_CAP);
    let mp_equilibrium_tolerance = js::math::max(tol * 4.0, 0.02);
    // Fm(λ) and Ff(λ) are evaluated more precisely than the λ search
    // needs: near the root the gap Fm − Ff is of the order of `tol`, and
    // evaluation noise of that size sent the secant step the wrong way
    // (e.g. V081a, where Fm hardly depends on λ).
    let eval_tol = tol * 0.1;

    // Step 1: Initial Bishop solution (lambda = 0)
    let r = solve_fos_generic_moment(props, slices, 0.0, fs_ord, max_iters, eval_tol);
    let Some(mut fs_m) = r.fos else {
        return Ok(mp(None, None, None, None, false));
    };
    // (the first pushing/resisting values are replaced before they are read)
    let mut pushing0: f64;
    let mut resisting0: f64;

    // Step 1b: Initial force solution (lambda = 0)
    let mut rf = solve_fos_generic_force_circular(props, slices, 0.0, fs_ord, max_iters, eval_tol);
    if rf.fos.is_none() {
        // Retry with different initial FS values
        for fact in [2.0, 0.5, 1.5, 0.75, 1.1, 0.9] {
            rf = solve_fos_generic_force_circular(
                props,
                slices,
                0.0,
                fs_ord * fact,
                max_iters,
                eval_tol,
            );
            if rf.fos.is_some() {
                break;
            }
        }
        if rf.fos.is_none() {
            return Ok(mp(
                Some(fs_m),
                None,
                Some(rf.pushing),
                Some(rf.resisting),
                false,
            ));
        }
    }
    let mut fs_f = rf.fos.expect("checked above");
    let mut pushing_f = rf.pushing;
    let mut resisting_f = rf.resisting;

    let mut lff_array: Vec<[f64; 4]> = vec![[0.0, fs_m, fs_f, (fs_m - fs_f).abs()]];
    if mp_pair_meets(fs_m, fs_f, tol) {
        return Ok(mp(
            Some(crossing_fos(&lff_array, 0.0, fs_m, fs_f)),
            Some(&lff_array),
            Some(pushing_f),
            Some(resisting_f),
            true,
        ));
    }

    // Step 2: Second point (lambda = 0.1)
    let lambda2 = 0.1;
    let r = solve_fos_generic_moment(props, slices, lambda2, fs_m, max_iters, eval_tol);
    pushing0 = r.pushing;
    resisting0 = r.resisting;
    let Some(m2) = r.fos else {
        return Ok(mp(
            None,
            Some(&lff_array),
            Some(pushing0),
            Some(resisting0),
            false,
        ));
    };
    fs_m = m2;

    let rf = solve_fos_generic_force_circular(props, slices, lambda2, fs_f, max_iters, eval_tol);
    pushing_f = rf.pushing;
    resisting_f = rf.resisting;
    let Some(f2) = rf.fos else {
        return Ok(mp(
            Some(fs_m),
            Some(&lff_array),
            Some(pushing_f),
            Some(resisting_f),
            false,
        ));
    };
    fs_f = f2;

    lff_array.push([lambda2, fs_m, fs_f, (fs_m - fs_f).abs()]);
    js::array::sort_by(&mut lff_array, |a, b| a[0] - b[0]);
    if mp_pair_meets(fs_m, fs_f, tol) {
        return Ok(mp(
            Some(crossing_fos(&lff_array, lambda2, fs_m, fs_f)),
            Some(&lff_array),
            Some(pushing_f),
            Some(resisting_f),
            true,
        ));
    }

    // Step 3: Iterative extrapolation
    let mut unconverged_lambdas: Vec<f64> = Vec::new();
    let mut lff_triplets: Vec<[f64; 3]> = Vec::new();
    let mut ii = 0;
    while ii <= MP_MAX_STEPS {
        // Use the best-performing lambda (smallest gap) as pivot for step limiting,
        // NOT the largest lambda in the sorted array, which would prevent exploration
        // into the negative-lambda region where Fm and Ff may intersect.
        let best_entry = smallest_gap(&lff_array);
        let prev_lambda = best_entry[0];
        lff_triplets.clear();
        lff_triplets.extend(lff_array.iter().map(|e| [e[0], e[1], e[2]]));
        let [mut lambda_new, mut fs_extrap] = extrapolate_lambda(&lff_triplets)?;

        // Limit step size; the extrapolated FOS belongs to the unlimited λ,
        // so a limited step starts from the last moment FOS instead.
        if (lambda_new - prev_lambda).abs() > MP_MAX_LAMBDA_STEP {
            lambda_new = if lambda_new > prev_lambda {
                prev_lambda + MP_MAX_LAMBDA_STEP
            } else {
                prev_lambda - MP_MAX_LAMBDA_STEP
            };
            fs_extrap = fs_m;
        }
        if !(fs_extrap > 0.0) {
            fs_extrap = fs_m;
        }
        // Do not step to or past a λ where the equilibrium did not converge:
        // halve the step towards the pivot instead.
        for &bad in &unconverged_lambdas {
            if (bad - prev_lambda) * (lambda_new - prev_lambda) > 0.0
                && (lambda_new - prev_lambda).abs() >= (bad - prev_lambda).abs()
            {
                lambda_new = prev_lambda + (bad - prev_lambda) / 2.0;
                fs_extrap = fs_m;
            }
        }

        // Ensure unique lambda
        let mut nudge_count = 0;
        while lff_array.iter().any(|x| x[0] == lambda_new) {
            // Step a little further in the search direction (shrinking towards
            // 0 walked back over ground already covered).
            lambda_new += if lambda_new >= prev_lambda {
                0.05
            } else {
                -0.05
            };
            nudge_count += 1;
            if nudge_count > 50 {
                break;
            }
        }
        // The interslice inclination stays between −10° and +80° (Edris & Wright 1987):
        // beyond that the force equation has roots that are no solution. A
        // walk that wants to leave the range has no crossing inside it.
        let mut exhausted = false;
        if lambda_new < *LAMBDA_MIN || lambda_new > *LAMBDA_MAX {
            let limit = if lambda_new < *LAMBDA_MIN {
                *LAMBDA_MIN
            } else {
                *LAMBDA_MAX
            };
            if lff_array.iter().any(|x| x[0] == limit) {
                exhausted = true;
            } else {
                lambda_new = limit;
                fs_extrap = fs_m;
            }
        }

        if !exhausted {
            let tm =
                solve_fos_generic_moment(props, slices, lambda_new, fs_extrap, max_iters, eval_tol);
            let Some(trial_m) = tm.fos else {
                return Ok(mp(
                    None,
                    Some(&lff_array),
                    Some(tm.pushing),
                    Some(tm.resisting),
                    false,
                ));
            };

            let tf = solve_fos_generic_force_circular(
                props, slices, lambda_new, fs_f, max_iters, eval_tol,
            );
            let Some(trial_f) = tf.fos else {
                return Ok(mp(
                    Some(trial_m),
                    Some(&lff_array),
                    Some(tf.pushing),
                    Some(tf.resisting),
                    false,
                ));
            };

            if tm.converged && tf.converged {
                fs_m = trial_m;
                pushing0 = tm.pushing;
                resisting0 = tm.resisting;
                fs_f = trial_f;
                pushing_f = tf.pushing;
                resisting_f = tf.resisting;
                lff_array.push([lambda_new, fs_m, fs_f, (fs_m - fs_f).abs()]);
                js::array::sort_by(&mut lff_array, |a, b| a[0] - b[0]);

                if mp_pair_meets(fs_m, fs_f, tol) {
                    return Ok(mp(
                        Some(crossing_fos(&lff_array, lambda_new, fs_m, fs_f)),
                        Some(&lff_array),
                        Some(pushing_f),
                        Some(resisting_f),
                        true,
                    ));
                }
            } else {
                // An unconverged moment or force solution is no point of the
                // Fm(λ), Ff(λ) curves: far out in λ (e.g. λ ≈ −1 on V002's
                // non-circular surface) the force iteration drifts and its value
                // dropped onto Fm, a spurious "intersection" with a far too low FOS.
                unconverged_lambdas.push(lambda_new);
            }
        }

        if exhausted || ii >= MP_MAX_STEPS {
            // Fallback: pick closest match
            let [best_lambda, best_fs, _, _] = smallest_gap(&lff_array);
            let rm =
                solve_fos_generic_moment(props, slices, best_lambda, best_fs, max_iters, eval_tol);
            pushing0 = rm.pushing;
            resisting0 = rm.resisting;
            let Some(m) = rm.fos else {
                return Ok(mp(
                    None,
                    Some(&lff_array),
                    Some(pushing0),
                    Some(resisting0),
                    false,
                ));
            };
            fs_m = m;
            let converged_best_m = rm.converged;

            let rf = solve_fos_generic_force_circular(
                props,
                slices,
                best_lambda,
                best_fs,
                max_iters,
                eval_tol,
            );
            pushing_f = rf.pushing;
            resisting_f = rf.resisting;
            let Some(f) = rf.fos else {
                return Ok(mp(
                    Some(fs_m),
                    Some(&lff_array),
                    Some(pushing_f),
                    Some(resisting_f),
                    false,
                ));
            };
            fs_f = f;
            let converged_best_f = rf.converged;

            let equilibrium_gap = (fs_m - fs_f).abs();
            lff_array.push([best_lambda, fs_m, fs_f, equilibrium_gap]);

            let iterations_converged = converged_best_m && converged_best_f;
            // Re-solved at the best λ the pair may meet within the tolerance.
            let complete = iterations_converged && mp_pair_meets(fs_m, fs_f, tol);
            // A closest pair with a non-positive factor is no solution either.
            let closest_pair = iterations_converged
                && !complete
                && fs_m > 0.0
                && fs_f > 0.0
                && equilibrium_gap <= mp_equilibrium_tolerance;
            // The pushed pair is the last entry: the neighbour is another λ.
            let fos = if complete {
                crossing_fos(&lff_array[..lff_array.len() - 1], best_lambda, fs_m, fs_f)
            } else {
                fs_m
            };
            return Ok(MpOutcome {
                fos: Some(fos),
                lff_array: Some(lff_array),
                pushing: Some(pushing0),
                resisting: Some(resisting0),
                converged: complete,
                equilibrium_gap: Some(equilibrium_gap),
                closest_pair: Some(closest_pair),
            });
        }
        ii += 1;
    }

    Ok(mp(
        Some(fs_m),
        Some(&lff_array),
        Some(pushing0),
        Some(resisting0),
        false,
    ))
}

// ────────────────────────────────────────────────────────────────
// Top-level analysis orchestrator
// ────────────────────────────────────────────────────────────────

/// Run the full slope stability analysis.
///
/// 1. Generate search planes if none exist.
/// 2. For each plane: generate slices → compute FOS.
/// 3. Sort results by FOS and store on the Slope model.
///
/// The surfaces are evaluated by `ctx.evaluator` (serial or in parallel,
/// with the same result); returns the minimum FOS found, or None if no
/// valid surfaces.
pub fn analyse_slope(slope: &mut Slope, ctx: &mut RunCtx) -> Result<Option<f64>> {
    // (TypeScript's generator does this before its first yield)
    let block = slope.search_method() == SearchMethod::Block && !slope.custom_planes_only();
    if slope.search().is_empty() && !slope.custom_planes_only() && !block {
        set_entry_exit_planes(slope)?;
    }
    let mut steps = AnalyseSlopeSteps::new();
    // (for progress: the first pass and the refinement budget)
    let hint = slope.search().len()
        + slope.individual_planes().len()
        + js::math::max(slope.refined_iterations(), 0.0) as usize;
    let all_planes = run_steps_with_hint(&mut steps, slope, ctx, hint)?;
    let best = all_planes.iter().find_map(|p| p.fos);
    slope.set_search_results(all_planes);
    if ctx.retention == crate::api::ctx::SliceRetention::Critical {
        restore_critical_slices(slope)?;
    }
    Ok(best)
}

/// The slices of the critical surface, when an evaluator left them out:
/// evaluated again on a copy (the same surface gives the same slices).
pub fn restore_critical_slices(slope: &mut Slope) -> Result<()> {
    let Some(i) = slope.search().iter().position(|p| p.fos.is_some()) else {
        return Ok(());
    };
    if slope.search()[i].slices.is_some() {
        return Ok(());
    }
    let mut copy = slope.search()[i].clone();
    evaluate_planes(slope, std::slice::from_mut(&mut copy))?;
    let mut planes = slope.search().to_vec();
    planes[i].slices = copy.slices;
    slope.set_search_results(planes);
    Ok(())
}

/// Where `AnalyseSlopeSteps` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Start,
    AfterFirst,
    Block,
    BlockOptimise,
    AfterRefined,
    Local,
    AfterLocal,
    Optimise,
    Done,
}

/// The search of `analyse_slope` as steps (model/steps.rs; TypeScript's
/// generator `analyseSlopeSteps`): each batch of surfaces it yields is
/// independent and evaluated in place before it resumes. Its result is the
/// sorted plane list, which `analyse_slope` sets on the slope (TypeScript's
/// generator calls `setSearchResults` itself). The search planes must have
/// been generated (`analyse_slope` does it).
pub struct AnalyseSlopeSteps {
    stage: Stage,
    block: bool,
    all_planes: Vec<SearchPlane>,
    batch: Vec<SearchPlane>,
    budget: f64,
    level: f64,
    keys: HashSet<String>,
    sub: Option<BoxedSteps<Vec<SearchPlane>>>,
}

impl Default for AnalyseSlopeSteps {
    fn default() -> Self {
        Self::new()
    }
}

impl AnalyseSlopeSteps {
    pub fn new() -> Self {
        AnalyseSlopeSteps {
            stage: Stage::Start,
            block: false,
            all_planes: Vec::new(),
            batch: Vec::new(),
            budget: 0.0,
            level: 1.0,
            keys: HashSet::new(),
            sub: None,
        }
    }

    /// Sorts the planes by FOS (TypeScript's comparator: null as +∞).
    fn finish(&mut self) -> Vec<SearchPlane> {
        let mut planes = std::mem::take(&mut self.all_planes);
        sort_by_fos(&mut planes);
        self.stage = Stage::Done;
        planes
    }
}

/// `planes.sort((a, b) => (a.fos ?? ∞) − (b.fos ?? ∞))`.
pub fn sort_by_fos(planes: &mut [SearchPlane]) {
    js::array::sort_by(planes, |a, b| {
        a.fos.unwrap_or(f64::INFINITY) - b.fos.unwrap_or(f64::INFINITY)
    });
}

/// `{ ...p, fos: null, slices: null, crack: undefined, converged: true }`.
fn for_evaluation(p: &SearchPlane) -> SearchPlane {
    SearchPlane {
        fos: None,
        slices: None,
        crack: None,
        converged: Some(true),
        ..p.clone()
    }
}

impl PlaneSteps for AnalyseSlopeSteps {
    type Output = Vec<SearchPlane>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        match &mut self.sub {
            Some(sub)
                if matches!(
                    self.stage,
                    Stage::Block | Stage::BlockOptimise | Stage::Optimise
                ) =>
            {
                sub.batch()
            }
            _ => &mut self.batch,
        }
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<SearchPlane>>> {
        loop {
            match self.stage {
                Stage::Start => {
                    self.block =
                        slope.search_method() == SearchMethod::Block && !slope.custom_planes_only();
                    // Combine search + individual planes
                    let search: &[SearchPlane] = if self.block { &[] } else { slope.search() };
                    let mut seen: HashMap<String, usize> = HashMap::new();
                    let mut all: Vec<SearchPlane> = Vec::new();
                    for p in search.iter().chain(slope.individual_planes()) {
                        let plane = for_evaluation(p);
                        let key = plane_key(&plane);
                        if let Some(&i) = seen.get(&key) {
                            // A custom plane the search also generated, or a
                            // custom plane given twice: the one kept stands
                            // for each in the result.
                            if let Some(custom) = plane.custom_plane {
                                if all[i].custom_plane.is_none() {
                                    all[i].custom_plane = Some(custom);
                                } else if all[i].custom_plane != Some(custom)
                                    && !all[i].custom_aliases.contains(&custom)
                                {
                                    all[i].custom_aliases.push(custom);
                                }
                            }
                            continue;
                        }
                        seen.insert(key, all.len());
                        all.push(plane);
                    }
                    self.batch = all;
                    self.stage = Stage::AfterFirst;
                    return Ok(Step::Batch(SearchPhase::First));
                }
                Stage::AfterFirst => {
                    self.all_planes = std::mem::take(&mut self.batch);
                    if self.block {
                        // Block search: surfaces through the block search objects,
                        // refined around the best; optimised as polylines on request.
                        self.sub = Some(block_search_steps(slope)?);
                        self.stage = Stage::Block;
                    } else if slope.refined_iterations() > 0.0 && !slope.custom_planes_only() {
                        sort_by_fos(&mut self.all_planes);
                        let refined = generate_refined_planes(
                            slope,
                            &self.all_planes,
                            slope.refined_iterations(),
                        )?;
                        // Spend the rest of the budget on a local search with
                        // shrinking steps.
                        self.budget = slope.refined_iterations() - refined.len() as f64;
                        if !refined.is_empty() {
                            self.batch = refined;
                            self.stage = Stage::AfterRefined;
                            return Ok(Step::Batch(SearchPhase::Refined));
                        }
                        self.keys = plane_keys(&self.all_planes);
                        self.level = 1.0;
                        self.stage = Stage::Local;
                    } else {
                        self.stage = Stage::Optimise;
                        self.sub = None;
                    }
                }
                Stage::AfterRefined => {
                    let refined = std::mem::take(&mut self.batch);
                    self.all_planes.extend(refined);
                    self.keys = plane_keys(&self.all_planes);
                    self.level = 1.0;
                    self.stage = Stage::Local;
                }
                Stage::Local => {
                    if !(self.budget > 0.0 && self.level <= 12.0) {
                        self.stage = Stage::Optimise;
                        self.sub = None;
                        continue;
                    }
                    let local = generate_local_planes(
                        slope,
                        &self.all_planes,
                        self.budget,
                        self.level,
                        &mut self.keys,
                        4,
                    )?;
                    if local.is_empty() {
                        self.stage = Stage::Optimise;
                        self.sub = None;
                        continue;
                    }
                    self.batch = local;
                    self.stage = Stage::AfterLocal;
                    return Ok(Step::Batch(SearchPhase::Local));
                }
                Stage::AfterLocal => {
                    let local = std::mem::take(&mut self.batch);
                    self.budget -= local.len() as f64;
                    self.all_planes.extend(local);
                    self.level += 1.0;
                    self.stage = Stage::Local;
                }
                Stage::Block => {
                    let sub = self.sub.as_mut().expect("block search steps");
                    match sub.resume(slope)? {
                        Step::Batch(_) => return Ok(Step::Batch(SearchPhase::Block)),
                        Step::Done(block_planes) => {
                            self.all_planes.extend(block_planes.iter().cloned());
                            if slope.non_circular_optimization() {
                                let span = match slope.surface_line_xy() {
                                    Some(g) => js::math::max_of(&g.x) - js::math::min_of(&g.x),
                                    None => 1.0,
                                };
                                let seeds = best_distinct(&block_planes, BLOCK_SEEDS, span);
                                // (TypeScript leaves out the optimised planes that
                                // are among allPlanes already, by identity: the
                                // seam returns only new ones; optimize.rs)
                                self.sub = Some(optimise_polylines_steps(slope, seeds)?);
                                self.stage = Stage::BlockOptimise;
                            } else {
                                self.sub = None;
                                return Ok(Step::Done(self.finish()));
                            }
                        }
                    }
                }
                Stage::BlockOptimise => {
                    let sub = self.sub.as_mut().expect("polyline optimisation steps");
                    match sub.resume(slope)? {
                        Step::Batch(_) => return Ok(Step::Batch(SearchPhase::Optimise)),
                        Step::Done(optimised) => {
                            self.all_planes.extend(optimised);
                            self.sub = None;
                            return Ok(Step::Done(self.finish()));
                        }
                    }
                }
                Stage::Optimise => {
                    // Non-circular optimisation of the best circles.
                    if self.sub.is_none() {
                        if !(slope.non_circular_optimization()
                            && !slope.custom_planes_only()
                            && !self.block)
                        {
                            return Ok(Step::Done(self.finish()));
                        }
                        self.sub = Some(optimise_non_circular_steps(slope, &self.all_planes)?);
                    }
                    let sub = self.sub.as_mut().expect("optimisation steps");
                    match sub.resume(slope)? {
                        Step::Batch(_) => return Ok(Step::Batch(SearchPhase::Optimise)),
                        Step::Done(optimised) => {
                            self.all_planes.extend(optimised);
                            self.sub = None;
                            return Ok(Step::Done(self.finish()));
                        }
                    }
                }
                Stage::Done => {
                    return Err(EngineError::new("analyseSlopeSteps: resumed after the end"));
                }
            }
        }
    }
}

/// Surfaces shallower than this fraction of the model height are degenerate.
const DEGENERATE_DEPTH: f64 = 1e-3;

/// The errors get_slices raises for a surface that has no valid slices.
const SURFACE_GEOMETRY_ERRORS: [&str; 3] = [
    WATER_LINE_GAP,
    "x0 must be less than x1",
    "Surface line not defined",
];

fn is_surface_geometry_error(error: &EngineError) -> bool {
    SURFACE_GEOMETRY_ERRORS.contains(&error.message.as_str())
}

/// Passes of the Hoek–Brown fixed point per surface, and its relative tolerance on F (implementation choices).
const HB_PASSES: u32 = 30;
const HB_TOLERANCE: f64 = 1e-4;

/// Each Hoek–Brown slice's instantaneous c and φ at its effective normal
/// stress N′/l (design values with the partial factors), halfway from the
/// present ones: the undamped update can cycle between two states
/// (implementation choice).
fn update_hoek_brown(slope: &Slope, slices: &mut [Slice], solved: &SliceArrays) {
    for (i, s) in slices.iter_mut().enumerate() {
        if s.hoek_brown.is_none() && s.shear_normal.is_none() {
            continue;
        }
        let sn = effective_normal(solved, i) / s.base_length;
        let inst = match (&s.hoek_brown, &s.shear_normal) {
            (Some(hb), _) => instantaneous_at_normal_stress(hb, sn),
            (None, Some(m)) => shear_normal_at(&m.points, m.spline.as_ref(), sn),
            (None, None) => unreachable!(),
        };
        let d = design_strength(
            Some(if s.hoek_brown.is_some() {
                "hoek-brown"
            } else {
                "shear-normal"
            }),
            &ResolvedStrength {
                cohesion: inst.cohesion,
                friction_angle: inst.friction_angle,
                cohesion_undrained: inst.cohesion,
                ..Default::default()
            },
            slope.partial_factors(),
        );
        s.cohesion = (s.cohesion + d.cohesion) / 2.0;
        s.cohesion_undrained = s.cohesion;
        s.phi = js::math::atan((js::math::tan(s.phi) + d.tan_phi) / 2.0);
        s.friction_angle = (s.phi * 180.0) / PI;
    }
}

/// The scratch buffers of one evaluating thread.
#[derive(Debug, Clone, Default)]
pub struct EvalScratch {
    pub slices: SliceScratch,
    pub arrays: SliceArrays,
}

impl EvalScratch {
    pub fn new() -> Self {
        EvalScratch {
            slices: SliceScratch::new(),
            arrays: SliceArrays::new(),
        }
    }
}

/// Evaluates the planes in place: slices, FOS by the slope's method,
/// convergence, crack and composite floor (None FOS when invalid). Each
/// plane is evaluated on its own, so a batch may be split in any way. Uses
/// the Morgenstern-Price solver set with `set_morgenstern_price_solver`.
pub fn evaluate_planes(slope: &Slope, all_planes: &mut [SearchPlane]) -> Result<()> {
    let solver = get_morgenstern_price_solver();
    let mut scratch = EvalScratch::new();
    for plane in all_planes.iter_mut() {
        evaluate_plane(slope, plane, solver, &mut scratch)?;
    }
    Ok(())
}

/// `evaluate_planes` with an evaluation context (the evaluators of api/ctx.rs).
pub fn evaluate_planes_ctx(
    slope: &Slope,
    planes: &mut [SearchPlane],
    ctx: &EvalCtx,
    scratch: &mut EvalScratch,
) -> Result<()> {
    for plane in planes.iter_mut() {
        evaluate_plane(slope, plane, ctx.mp_solver, scratch)?;
    }
    Ok(())
}

/// One plane of `evaluate_planes`.
pub fn evaluate_plane(
    slope: &Slope,
    plane: &mut SearchPlane,
    mp_solver: MpSolver,
    scratch: &mut EvalScratch,
) -> Result<()> {
    plane.below_min_size = None;
    plane.composite = None;
    plane.rejection = None;
    // A circle given directly (add_single_circular_plane) that leaves the
    // model where it is no composite surface.
    if plane.unchecked == Some(true)
        && plane.points.is_none()
        && !is_plane_within_external_boundary(slope, plane, false)
    {
        plane.fos = None;
        plane.rejection = Some(SurfaceRejection::OutsideModel);
        return Ok(());
    }
    let mut slices = match get_slices(
        slope,
        plane.lc[0],
        plane.rc[0],
        plane.cx,
        plane.cy,
        plane.radius,
        plane.points.as_deref(),
        &mut scratch.slices,
    ) {
        Ok(s) => s,
        // A surface the slices cannot be built for is no candidate; any other
        // error is a fault that must not silently remove surfaces (and so
        // raise the minimum).
        Err(e) if is_surface_geometry_error(&e) => {
            plane.fos = None;
            plane.rejection = Some(SurfaceRejection::NoSlices);
            return Ok(());
        }
        Err(e) => return Err(e),
    };
    // Refined and local planes arrive with a placeholder FOS; a surface
    // without slices (e.g. too shallow for the tension crack) is invalid.
    if slices.is_empty() {
        plane.fos = None;
        plane.rejection = Some(SurfaceRejection::NoSlices);
        return Ok(());
    }
    if slices[0].x_left > plane.lc[0] + 1e-9 {
        plane.crack = Some([slices[0].x_left, slices[0].y0_bottom]);
    }
    // A composite circle: the surface as analysed, along the floor where the
    // circle went below it.
    if plane.points.is_none() && slices.iter().any(|s| s.circular == Some(false)) {
        // both sides of a step in the floor (a slice edge with two heights)
        let mut pts: Vec<Pt> = Vec::new();
        for s in &slices {
            match pts.last() {
                Some(last) if (last[1] - s.y0_bottom).abs() <= 1e-9 => {}
                _ => pts.push([s.x_left, s.y0_bottom]),
            }
            pts.push([s.x_right, s.y1_bottom]);
        }
        plane.composite = Some(pts);
    }

    // Minimum depth: shallower surfaces are not analysed. Surfaces that
    // only scratch the ground (thinner than 0.1 % of the model height) are
    // always skipped: their FOS grows without bound as c/(γ·depth) and
    // tells nothing about the slope.
    let degenerate_depth = DEGENERATE_DEPTH * slope.model_height();
    let min_depth = js::math::max(slope.min_slip_depth(), degenerate_depth);
    // Surfaces left out by the minimum depth or area are counted (reported
    // as AnalysisResult.discardedBySize), so that a local failure the
    // filters hide is not hidden silently. Not counted: the degenerate ones
    // and those that would be rejected anyway (high-strength or
    // impenetrable material).
    let rejected = |slices: &[Slice]| {
        slices
            .iter()
            .any(|s| s.skip_surface == Some(true) || s.impenetrable == Some(true))
    };
    let count_as_small = |slices: &[Slice]| if !rejected(slices) { Some(true) } else { None };
    if min_depth > 0.0 {
        let mut max_depth = 0.0;
        for s in &slices {
            max_depth = js::math::max(
                js::math::max(max_depth, s.y0_top - s.y0_bottom),
                s.y1_top - s.y1_bottom,
            );
        }
        if max_depth < min_depth {
            plane.fos = None;
            plane.converged = Some(true);
            plane.rejection = Some(SurfaceRejection::TooShallow);
            if max_depth >= degenerate_depth {
                plane.below_min_size = count_as_small(&slices);
            }
            plane.slices = Some(slices);
            return Ok(());
        }
    }

    // Minimum size of the sliding mass, when the user set one (default 0:
    // no limit); see Slope.min_slip_area.
    let min_area = slope.min_slip_area();
    if min_area > 0.0 {
        let mut area = 0.0;
        for s in &slices {
            area += s.area;
        }
        if area < min_area {
            plane.fos = None;
            plane.converged = Some(true);
            plane.rejection = Some(SurfaceRejection::BelowMinArea);
            plane.below_min_size = count_as_small(&slices);
            plane.slices = Some(slices);
            return Ok(());
        }
    }

    // If any slice has skipSurface (e.g. high-strength material) or
    // impenetrable (bedrock), the surface is invalid — skip analysis.
    if rejected(&slices) {
        plane.fos = None;
        plane.slices = Some(slices);
        plane.converged = Some(true);
        plane.rejection = Some(SurfaceRejection::ImpenetrableMaterial);
        return Ok(());
    }

    // A surface with no net driving moment in the sliding direction (e.g.
    // a symmetric circle under level ground, or one that would slide the
    // other way) cannot fail here.  The iterative solvers oscillate on
    // such surfaces, which used to report them as "weak equilibrium".
    if !has_driving_moment(&slices) {
        plane.fos = None;
        plane.slices = Some(slices);
        plane.converged = Some(true);
        plane.rejection = Some(SurfaceRejection::NoDrivingMoment);
        return Ok(());
    }

    let mut fos: Option<f64>;
    let mut converged: bool;
    // The factor the slice normal forces were solved with, when not `fos`.
    let mut solved_fos: Option<f64> = None;
    // Morgenstern-Price closest pair: not converged, but its factor is kept.
    let mut accepted_closest_pair = false;

    // Rapid drawdown: the undrained strength from the consolidation
    // stresses before drawdown (model/drawdown.rs).
    if slope.drawdown_before().is_some()
        && !apply_rapid_drawdown(slope, &mut slices, plane, scratch)?
    {
        plane.fos = None;
        plane.slices = Some(slices);
        plane.rejection = Some(SurfaceRejection::Drawdown);
        return Ok(());
    }

    // Hoek–Brown bases: the instantaneous strength at the normal stress
    // the solution finds, repeated until F settles (a fixed point; the
    // first pass uses the overburden estimate of the slice builder).
    let hoek_brown = slices
        .iter()
        .any(|s| s.hoek_brown.is_some() || s.shear_normal.is_some());
    let mut last_hb_fos = f64::NAN;
    let mut pass = 0;
    loop {
        match slope.method() {
            AnalysisMethod::Bishop => {
                let (f, _, _, cvg) =
                    analyse_bishop_with(slope, &mut slices, None, &mut scratch.arrays);
                fos = f;
                converged = cvg;
            }
            AnalysisMethod::Janbu => {
                let (f, _, _, cvg) =
                    analyse_janbu_with(slope, &mut slices, None, &mut scratch.arrays);
                fos = f;
                // The normal forces are those of the uncorrected factor: the f₀
                // correction scales the result, not the slice equilibrium.
                if let (Some(f), true) = (f, slope.janbu_correction()) {
                    solved_fos = Some(f / janbu_correction_factor(&slices));
                }
                converged = cvg;
            }
            AnalysisMethod::MorgensternPrice => {
                let r = match mp_solver {
                    MpSolver::March => analyse_morgenstern_price_march(slope, &mut slices, None)?,
                    MpSolver::Iterative => {
                        analyse_morgenstern_price_with(slope, &mut slices, &mut scratch.arrays)?
                    }
                };
                fos = r.fos;
                plane.lff_array = r.lff_array;
                let closest = r.closest_pair == Some(true);
                // A solution accepted with the closest pair, not a crossing: the
                // factor of safety satisfies moment equilibrium, force equilibrium
                // only within the gap. It keeps its factor (on a φ = 0 circle, e.g.
                // V027, moment equilibrium alone fixes F) but is reported as not
                // converged, with the gap, so that it is not mistaken for a
                // complete-equilibrium solution (Fm = Ff; Morgenstern & Price 1965).
                plane.closest_pair = if closest { Some(true) } else { None };
                plane.equilibrium_gap = if closest { r.equilibrium_gap } else { None };
                accepted_closest_pair = closest;
                // A candidate of the non-circular optimisation is kept only with a
                // crossing: the optimisation is a minimum over thousands of
                // surfaces and finds every one where the closest pair reads low.
                // The surface is abandoned, as in Edris & Wright (1987, para. 101).
                if plane.optimised == Some(true) && closest {
                    fos = None;
                }
                converged = r.converged;
            }
        }
        let Some(f) = fos else {
            break;
        };
        if !hoek_brown {
            break;
        }
        if (f - last_hb_fos).abs() <= HB_TOLERANCE * f.abs() {
            break;
        }
        if pass >= HB_PASSES {
            // F has not settled: the surface is reported as not converged
            converged = false;
            break;
        }
        last_hb_fos = f;
        // (solved_effective_normals takes the factor as the method reports it, Janbu's corrected one included)
        // (the normal forces are read from the scratch: no vector per pass)
        if !solve_effective_normals_in(
            slope,
            &mut slices,
            f,
            plane.lff_array.as_deref(),
            &mut scratch.arrays,
        ) {
            break;
        }
        update_hoek_brown(slope, &mut slices, &scratch.arrays);
        pass += 1;
    }

    // Discard non-converged or negative FoS — these arise from
    // degenerate surfaces (e.g. flat terrain with near-zero driving
    // moment) where the iterative solver produces meaningless values.
    if let Some(f) = fos {
        if (!converged && !accepted_closest_pair) || f < 0.0 {
            fos = None;
        }
    }
    // m_α = cos α + sin α·tan φ / F ≤ 0 on a slice makes its normal force
    // meaningless (infinite or negative): raising strength could then
    // lower the FOS. Such surfaces are rejected, as is common practice.
    if let Some(f) = fos {
        let at = solved_fos.unwrap_or(f);
        if slices.iter().any(|s| m_alpha(s, at) <= 0.0) {
            fos = None;
        }
    }

    plane.fos = fos;
    plane.slices = Some(slices);
    plane.converged = Some(converged);
    if fos.is_none() {
        plane.rejection = Some(SurfaceRejection::NotConverged);
    }
    Ok(())
}

/// Vertical load on a slice: soil weight, surface loads and free water.
pub fn slice_vertical_load(s: &Slice) -> f64 {
    s.weight + s.udl + s.ll + s.water_load.unwrap_or(0.0)
}

/// Driving moment of a slice about the circle centre (kN·m). On a
/// non-circular surface the base normal force has a moment too; it is
/// estimated here with N ≈ W·cos α (the solvers use the solved N).
pub fn slice_driving_moment(s: &Slice) -> f64 {
    let w = slice_vertical_load(s);
    w * s.dx
        + s.extra_moment.unwrap_or(0.0)
        + w * js::math::cos(s.alpha) * s.normal_arm.unwrap_or(0.0)
}

/// True when the slices' net driving moment is clearly positive.
fn has_driving_moment(slices: &[Slice]) -> bool {
    let mut net = 0.0;
    let mut gross = 0.0;
    for s in slices {
        let m = slice_driving_moment(s);
        net += m;
        gross += m.abs();
    }
    // 0.1 % of the gross moment: below that FOS runs into the thousands
    // (meaningless "Max FOS" and colour scale) and the surface is never
    // critical.
    gross > 0.0 && net > 1e-3 * gross
}

fn m_alpha(s: &Slice, fos: f64) -> f64 {
    // A combined-method slice in equilibrium with its undrained strength has
    // tan φ = 0 in the equation that was solved.
    let tan_phi = if s.undrained_governs == Some(true) {
        0.0
    } else {
        js::math::tan(s.phi)
    };
    js::math::cos(s.alpha) + (js::math::sin(s.alpha) * tan_phi) / fos
}
