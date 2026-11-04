//! Port of packages/engine/src/fem/bfgs.ts.
//!
//! Equilibrium at one strength reduction factor by the constant stiffness
//! method with implicit stress return, accelerated by BFGS updates.
//!
//! Method and sources:
//! - Constant (elastic) stiffness iteration with an implicit return of the
//!   stresses to the yield surface at every iteration: the modified initial
//!   strain method of Vermeer (1979, Proc. 3rd Int. Conf. Num. Meth.
//!   Geomech., 377–387). For associated plasticity it converges also for
//!   large load increments (Vermeer & van Langen 1989, Ingenieur-Archiv 59,
//!   221–236), so that a trial that does not converge is beyond collapse.
//!   The elastic stiffness is factorised once per mesh (model.k).
//! - Acceleration: BFGS quasi-Newton updates of the inverse stiffness, with
//!   the elastic stiffness as the initial matrix (Matthies & Strang 1979,
//!   IJNME 14(11), 1613–1626), applied by the two-loop recursion of the
//!   limited-memory form (Nocedal 1980, Math. Comput. 35(151), 773–782),
//!   and the initial matrix scaled by γ = sᵀy / yᵀK⁻¹y at every iteration
//!   (Nocedal & Wright 2006, eq. 7.20, in the elastic energy norm).
//!   Pairs whose curvature sᵀy is not positive are skipped, which keeps the
//!   update positive definite (Nocedal & Wright, Numerical Optimization,
//!   2nd ed., 2006, ch. 6).
//! - Line search on the energy, as Matthies & Strang (1979): along the
//!   direction d the residual component g(α) = dᵀr(u + αd) is brought to
//!   at most half of g(0) by secant steps (STOL = 0.5).
//! - The stress return is the closest-point return of newton.rs (Clausen,
//!   Damkilde & Andersen 2006).
//!
//! Implementation choices (not from the literature): convergence at a
//! residual of `tolerance` (default 10⁻⁴) of the load; 50 stored pairs; at
//! most 2000 iterations; failure when the residual has not fallen by 10 %
//! over 200 iterations; at most 8 line search steps and a step of at most 8.
//! Near collapse the iterations grow steeply (V056: 654 at F = 0.50, 1495 at
//! 0.51, against Newton's 21), so the solver is an option, not the default.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::error::Result;
use crate::fem::bars::bar_internal;
use crate::fem::model::FeModel;
use crate::fem::newton::{evaluate, norm2, GaussStrength, NewtonState, SolveOutcome};
use crate::fem::piles::beam_internal;
use crate::js;
use std::collections::VecDeque;

/// `BfgsOptions`.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct BfgsOptions {
    /// Relative residual tolerance ‖r‖/‖f‖; default 1e-4.
    pub tolerance: Option<f64>,
    /// Iterations per trial; default 2000.
    pub max_iterations: Option<usize>,
    pub tension_cutoff: Option<bool>,
}

/// Stored BFGS pairs.
const MEMORY: usize = 50;
/// Iterations over which the residual must fall by 10 %.
const STALL_WINDOW: usize = 200;
/// Line search: |g(α)| ≤ LS_TOL·g(0) (Matthies & Strang's STOL = 0.5), at most LS_STEPS steps, α ≤ MAX_STEP.
const LS_TOL: f64 = 0.5;
const LS_STEPS: usize = 8;
const MAX_STEP: f64 = 8.0;

fn dot(a: &[f64], b: &[f64]) -> f64 {
    let mut s = 0.0;
    for i in 0..a.len() {
        s += a[i] * b[i];
    }
    s
}

/// BFGS iterations at one F from `state` (updated in place on convergence).
/// Returns whether equilibrium was reached and how many iterations it took.
pub fn bfgs_at_f(
    model: &FeModel,
    eqs: &[i64],
    strength: &GaussStrength,
    state: &mut NewtonState,
    options: &BfgsOptions,
) -> Result<SolveOutcome> {
    let tol = options.tolerance.unwrap_or(1e-4);
    let limit = options.max_iterations.unwrap_or(2000);
    let cutoff = options.tension_cutoff.unwrap_or(false);
    let neq = model.eq_count;
    let ngp = 3 * model.element_count;
    let fnorm = model.load_norm;
    let mut u = state.u.to_vec();
    let mut fint = vec![0.0f64; neq];
    let mut r = vec![0.0f64; neq];
    let mut stress = vec![0.0f64; 4 * ngp];
    let mut ep = vec![0.0f64; 4 * ngp];
    let mut bar_ep = vec![0.0f64; state.bar_ep.len()];
    let mut trial_u = vec![0.0f64; neq];
    let mut d = vec![0.0f64; neq];
    let mut r_old = vec![0.0f64; neq];
    let ep_old: &[f64] = state.ep;
    let bar_ep_old: &[f64] = state.bar_ep;
    let f_red = state.f;
    let residual = |uu: &[f64],
                    fint: &mut [f64],
                    stress: &mut [f64],
                    ep: &mut [f64],
                    bar_ep: &mut [f64],
                    r: &mut [f64]|
     -> Result<f64> {
        evaluate(
            model, eqs, uu, ep_old, strength, cutoff, fint, stress, ep, None,
        )?;
        if model.bars.count > 0 {
            bar_internal(model, uu, bar_ep_old, f_red, fint, bar_ep, None)?;
        }
        if model.piles.count > 0 {
            beam_internal(&model.eq, &model.piles, uu, fint, None)?;
        }
        for i in 0..neq {
            r[i] = model.f[i] - fint[i];
        }
        Ok(norm2(r))
    };
    // L-BFGS pairs: s = Δu, y = r_old − r_new (the change of the gradient −r).
    let mut s_pairs: VecDeque<Vec<f64>> = VecDeque::new();
    let mut y_pairs: VecDeque<Vec<f64>> = VecDeque::new();
    let mut rho: VecDeque<f64> = VecDeque::new();
    let mut alpha_k = [0.0f64; MEMORY];
    let mut ky = vec![0.0f64; neq];
    let mut s_new = vec![0.0f64; neq];
    let mut y_new = vec![0.0f64; neq];
    // Initial matrix H0 = γ K⁻¹ with γ = sᵀy / yᵀK⁻¹y of the latest pair: the
    // scaling of Nocedal & Wright (2006, eq. 7.20) in the variables K^½ u in
    // which the elastic stiffness is the identity. Near collapse the secant
    // stiffness is far below the elastic one and γ ≫ 1.
    let mut gamma = 1.0;
    let mut rn = residual(&u, &mut fint, &mut stress, &mut ep, &mut bar_ep, &mut r)?;
    let mut history: Vec<f64> = Vec::new();
    let mut converged_at: Option<usize> = None;
    for it in 1..=limit {
        if rn <= tol * fnorm {
            converged_at = Some(it - 1);
            break;
        }
        history.push(rn);
        if it > STALL_WINDOW && rn > 0.9 * history[it - 1 - STALL_WINDOW] {
            return Ok(SolveOutcome {
                converged: false,
                iterations: it,
            });
        }
        // direction(): the two-loop recursion
        d.copy_from_slice(&r);
        for k in (0..s_pairs.len()).rev() {
            alpha_k[k] = rho[k] * dot(&s_pairs[k], &d);
            for i in 0..neq {
                d[i] -= alpha_k[k] * y_pairs[k][i];
            }
        }
        model.k.solve(&mut d);
        if gamma != 1.0 {
            for i in 0..neq {
                d[i] *= gamma;
            }
        }
        for k in 0..s_pairs.len() {
            let beta = rho[k] * dot(&y_pairs[k], &d);
            for i in 0..neq {
                d[i] += (alpha_k[k] - beta) * s_pairs[k][i];
            }
        }
        r_old.copy_from_slice(&r);
        // Line search on the energy (Matthies & Strang 1979): the residual
        // along the direction, g(α) = dᵀr(u + αd), is reduced to half of g(0)
        // in magnitude by secant (regula falsi) steps.
        let g0 = dot(&d, &r_old);
        let at = |a: f64,
                  trial_u: &mut [f64],
                  fint: &mut [f64],
                  stress: &mut [f64],
                  ep: &mut [f64],
                  bar_ep: &mut [f64],
                  r: &mut [f64]|
         -> Result<f64> {
            for i in 0..neq {
                trial_u[i] = u[i] + a * d[i];
            }
            residual(trial_u, fint, stress, ep, bar_ep, r)
        };
        let mut alpha = 1.0;
        let mut rt = at(
            alpha,
            &mut trial_u,
            &mut fint,
            &mut stress,
            &mut ep,
            &mut bar_ep,
            &mut r,
        )?;
        let mut g = dot(&d, &r);
        if g0 > 0.0 && g.abs() > LS_TOL * g0 {
            let (mut a_lo, mut g_lo, mut a_hi, mut g_hi) = (0.0, g0, alpha, g);
            let mut ls = 0;
            while ls < LS_STEPS && g.abs() > LS_TOL * g0 {
                if g_hi > 0.0 {
                    // still descending at the trial: extend the step
                    a_lo = a_hi;
                    g_lo = g_hi;
                    a_hi = js::math::min(MAX_STEP, 2.0 * a_hi);
                    alpha = a_hi;
                } else {
                    alpha = a_lo - (g_lo * (a_hi - a_lo)) / (g_hi - g_lo);
                }
                rt = at(
                    alpha,
                    &mut trial_u,
                    &mut fint,
                    &mut stress,
                    &mut ep,
                    &mut bar_ep,
                    &mut r,
                )?;
                g = dot(&d, &r);
                if g > 0.0 {
                    a_lo = alpha;
                    g_lo = g;
                } else {
                    a_hi = alpha;
                    g_hi = g;
                }
                if a_hi == MAX_STEP && g_hi > 0.0 {
                    break;
                }
                ls += 1;
            }
        }
        for i in 0..neq {
            s_new[i] = trial_u[i] - u[i];
            y_new[i] = r_old[i] - r[i];
        }
        u.copy_from_slice(&trial_u);
        rn = rt;
        let sy = dot(&s_new, &y_new);
        if sy > 1e-12 * norm2(&s_new) * norm2(&y_new) {
            // Once the memory is full the oldest pair's arrays are reused.
            let full = s_pairs.len() == MEMORY;
            let mut s = if full {
                s_pairs.pop_front().expect("full")
            } else {
                vec![0.0; neq]
            };
            let mut y = if full {
                y_pairs.pop_front().expect("full")
            } else {
                vec![0.0; neq]
            };
            if full {
                rho.pop_front();
            }
            s.copy_from_slice(&s_new);
            y.copy_from_slice(&y_new);
            ky.copy_from_slice(&y);
            s_pairs.push_back(s);
            y_pairs.push_back(y);
            rho.push_back(1.0 / sy);
            model.k.solve(&mut ky);
            let y_ky = dot(&y_new, &ky);
            if y_ky > 0.0 {
                gamma = sy / y_ky;
            }
        }
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
