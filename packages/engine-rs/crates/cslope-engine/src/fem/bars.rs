//! Port of packages/engine/src/fem/bars.ts.
//!
//! Reinforcement bars in the strength reduction.
//!
//! Method: three-node bar (truss) elements, the one-dimensional element of
//! the displacement method (Zienkiewicz, Taylor & Zhu 2013), along element
//! edges and sharing the soil's nodes; elastic–perfectly plastic with the
//! exact one-dimensional return N = min(T, max(0, EA (ε − εp))), relaxed
//! like the soil in the viscoplastic iteration (srm.rs) or with its tangent
//! in Newton's method.
//!
//! Implementation choices (not from the literature), with their reasons:
//! - Perfect bond between bar and soil: slip is represented by the pullout
//!   part of the capacity, not by an interface.
//! - 0 ≤ N ≤ T(s), with T the capacity envelope of cSlope's limit
//!   equilibrium analysis (tensile capacity, pullout from either end, end
//!   anchorage) per metre of slope, so that both analyses use the same
//!   reinforcement; no compression (geosynthetics, and conservatively bars
//!   and nails).
//! - Passive capacity divided by F, as the limit equilibrium solvers do;
//!   `reduce_reinforcement` = false reduces only the soil.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::error::Result;
use crate::fem::model::{FeModel, BAR_GP_STRIDE};
use crate::fem::piles::spring_capacity;
use crate::fem::sparse::SparseCholesky;
use crate::js;

fn bar_dofs(model: &FeModel, b: usize, out: &mut [i64; 6]) {
    for k in 0..3 {
        let n = model.bars.nodes[3 * b + k];
        out[2 * k] = model.eq[2 * n];
        out[2 * k + 1] = model.eq[2 * n + 1];
    }
}

/// Capacity of a bar Gauss point at reduction F.
fn capacity(model: &FeModel, b: usize, g: usize, f: f64) -> f64 {
    let bars = &model.bars;
    let i = 2 * b + g;
    let kind = bars.cap_kind[i];
    if kind != 0 {
        return spring_capacity(kind, bars.cap_c[i], bars.cap_sv[i], bars.cap_tan[i], f);
    }
    let c = bars.capacity[i];
    if bars.passive[b] {
        c / f
    } else {
        c
    }
}

/// Viscoplastic step for the bars: returns each Gauss point's force to
/// [0, T] by a plastic strain increment and adds its body load ∫ Bᵀ EA Δεp.
pub fn relax_bars(model: &FeModel, u: &[f64], bar_ep: &mut [f64], f: f64, body_loads: &mut [f64]) {
    let bars = &model.bars;
    let mut d = [0i64; 6];
    for b in 0..bars.count {
        bar_dofs(model, b, &mut d);
        let ea = bars.stiffness[b];
        for g in 0..2 {
            let o = (2 * b + g) * BAR_GP_STRIDE;
            let i = 2 * b + g;
            let mut eps = 0.0;
            for k in 0..6 {
                if d[k] >= 0 {
                    eps += bars.gp[o + k] * u[d[k] as usize];
                }
            }
            let n = ea * (eps - bar_ep[i]);
            let t = capacity(model, b, g, f);
            let lo = if bars.both_ways[b] { -t } else { 0.0 }; // a pile spring acts both ways
            let excess = if n > t {
                n - t
            } else if n < lo {
                n - lo
            } else {
                0.0
            };
            if excess == 0.0 {
                continue;
            }
            bar_ep[i] += excess / ea;
            let w = bars.gp[o + 6] * excess;
            for k in 0..6 {
                if d[k] >= 0 {
                    body_loads[d[k] as usize] += bars.gp[o + k] * w;
                }
            }
        }
    }
}

/// Internal forces of the bars (added to `fint`) for Newton, with the new
/// plastic strains in `bar_ep_new` and, when given, the tangent in `k`.
pub fn bar_internal(
    model: &FeModel,
    u: &[f64],
    bar_ep_old: &[f64],
    f: f64,
    fint: &mut [f64],
    bar_ep_new: &mut [f64],
    mut k: Option<&mut SparseCholesky>,
) -> Result<()> {
    let bars = &model.bars;
    let mut d = [0i64; 6];
    for b in 0..bars.count {
        bar_dofs(model, b, &mut d);
        let ea = bars.stiffness[b];
        for g in 0..2 {
            let o = (2 * b + g) * BAR_GP_STRIDE;
            let i = 2 * b + g;
            let mut eps = 0.0;
            for kk in 0..6 {
                if d[kk] >= 0 {
                    eps += bars.gp[o + kk] * u[d[kk] as usize];
                }
            }
            let trial = ea * (eps - bar_ep_old[i]);
            let t = capacity(model, b, g, f);
            let lo = if bars.both_ways[b] { -t } else { 0.0 }; // a pile spring acts both ways
            let n = js::math::min(t, js::math::max(lo, trial));
            bar_ep_new[i] = eps - n / ea;
            let w = bars.gp[o + 6];
            for kk in 0..6 {
                if d[kk] >= 0 {
                    fint[d[kk] as usize] += bars.gp[o + kk] * n * w;
                }
            }
            if let Some(k) = k.as_deref_mut() {
                if trial > lo && trial < t {
                    for kk in 0..6 {
                        if d[kk] < 0 {
                            continue;
                        }
                        for j in 0..=kk {
                            if d[j] >= 0 {
                                k.add(
                                    d[kk] as usize,
                                    d[j] as usize,
                                    ea * w * bars.gp[o + kk] * bars.gp[o + j],
                                )?;
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}
