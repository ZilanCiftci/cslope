//! Port of packages/engine/src/fem/initial-stress.ts.
//!
//! Initial stresses of the finite element model: the K0 procedure and staged
//! construction.
//!
//! - K0 procedure (e.g. Potts & Zdravković, Finite Element Analysis in
//!   Geotechnical Engineering: Theory, 1999, § 9.2; the "K0 procedure" of
//!   most programs): the vertical effective stress from the overburden,
//!   σ′v = −Σ γ h + u (tension positive), and σ′h = σ′z = K0 σ′v, τ = 0,
//!   with K0 = 1 − sin φ′ (Jaky 1944) unless given; for φ = 0 (undrained)
//!   and rigid materials the elastic ν/(1 − ν). The field is in equilibrium
//!   only under a horizontal ground surface; under a slope its out-of-balance
//!   force is applied with the first solution (as the programs do). With an
//!   original ground level above the slope (a cut), the overburden is
//!   counted from it, the soil above the ground taken as the top material,
//!   and the out-of-balance force is the excavation's unloading.
//! - Staged construction: each material is built in a stage (a number; 0
//!   by default). The stages before the last are solved one after the
//!   other at F = 1, each from the stresses of the one before, with the
//!   materials of later stages inactive (model.rs: weightless and soft);
//!   the stress of the last is the initial stress of the full model, whose
//!   strength reduction then builds the last stage in its first trial.
//!   Displacements are counted from the start of each stage. The
//!   reinforcement acts from the last stage on (the stages before it are
//!   solved without it, so that the stresses carried on are in equilibrium
//!   without bar forces). A stage that fails with Newton's method is solved
//!   again by the viscoplastic iteration, whose last state is carried on.
//!
//! Implementation choices (not from the literature): the overburden is
//! integrated over the material polygons along the vertical through each
//! Gauss point, by the midpoint rule on steps of at most 0.25 m, with the
//! unit weight below each material's water line taken saturated (also with
//! seepage pore pressures); σ′v ≤ 0 (no tension).

use crate::error::Result;
use crate::fem::model::{
    build_fe_model, gauss_unit_weight, with_initial_stress, FeModel, FeModelOptions,
};
use crate::fem::srm::{run_trial, SrmOptions, TrialSolver};
use crate::js;
use crate::model::slope::Slope;
use crate::types::{InitialStress, MaterialId};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// `InitialStressOptions` (TypeScript passes them with the model's options,
/// `FeModelOptions & InitialStressOptions`; here they are a struct of their
/// own, the same JSON).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialStressOptions {
    /// Gravity (default): gravity applied in one increment from zero stress; K0: the K0 procedure.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial_stress: Option<InitialStress>,
    /// K0 of every soil; default 1 − sin φ′ per Gauss point (Jaky).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub k0: Option<f64>,
    /// Ground level before excavation (m): the overburden of the K0 procedure counts from it where it is above the ground.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_ground_level: Option<f64>,
    /// Construction stage per material name (default 0): materials of later stages are built later.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_stages: Option<BTreeMap<String, f64>>,
}

/// Options of `k0_stress`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct K0Options<'a> {
    pub k0: Option<f64>,
    pub original_ground_level: Option<f64>,
    /// Names of the materials left out (zero stress, no weight).
    pub inactive: &'a [String],
}

/// Intervals of y inside a polygon along the vertical at x.
fn vertical_intervals(px: &[f64], py: &[f64], x: f64) -> Vec<[f64; 2]> {
    let mut ys: Vec<f64> = Vec::new();
    let n = px.len();
    for i in 0..n {
        let j = (i + 1) % n;
        let (x1, x2) = (px[i], px[j]);
        // half-open rule: a vertex on the line counts once
        if (x1 <= x && x < x2) || (x2 <= x && x < x1) {
            ys.push(py[i] + ((x - x1) / (x2 - x1)) * (py[j] - py[i]));
        }
    }
    js::array::sort_by(&mut ys, |a, b| a - b);
    let mut out = Vec::new();
    let mut k = 0;
    while k + 1 < ys.len() {
        out.push([ys[k], ys[k + 1]]);
        k += 2;
    }
    out
}

/// Initial effective stresses of the K0 procedure per Gauss point (σx, σy,
/// τxy, σz), the materials named in `inactive` excluded (zero stress, no
/// weight).
pub fn k0_stress(model: &FeModel, slope: &Slope, options: &K0Options) -> Vec<f64> {
    let ngp = 3 * model.element_count;
    let mut out = vec![0.0f64; 4 * ngp];
    let geoms: Vec<_> = slope
        .material_geometries()
        .iter()
        .filter(|g| !options.inactive.contains(&slope.material(g.material).name))
        .collect();
    const STEP: f64 = 0.25;
    let weight_over = |m: MaterialId, x: f64, lo: f64, hi: f64| -> f64 {
        if !(hi > lo) {
            return 0.0;
        }
        let n = js::math::max(1.0, ((hi - lo) / STEP).ceil());
        let h = (hi - lo) / n;
        let mat = slope.material(m);
        let wl = slope.get_water_line_for_material(Some(m));
        let mut s = 0.0;
        let mut k = 0.0;
        while k < n {
            s += gauss_unit_weight(mat, wl, false, 0.0, x, lo + (k + 0.5) * h) * h;
            k += 1.0;
        }
        s
    };
    for e in 0..model.element_count {
        if model.el_inactive[e] {
            continue;
        }
        let rigid = model.el_elastic[e];
        let nu = model.el_nu[e];
        for g in 0..3 {
            let i = 3 * e + g;
            let (x, y) = (model.gp_x[i], model.gp_y[i]);
            let mut sv = 0.0;
            let mut top = f64::NEG_INFINITY;
            let mut top_material: Option<MaterialId> = None;
            for geom in &geoms {
                for [lo, hi] in vertical_intervals(&geom.px, &geom.py, x) {
                    if hi > top {
                        top = hi;
                        top_material = Some(geom.material);
                    }
                    if hi > y {
                        sv += weight_over(geom.material, x, js::math::max(lo, y), hi);
                    }
                }
            }
            if let (Some(g0), Some(tm)) = (options.original_ground_level, top_material) {
                if g0 > top {
                    sv += weight_over(tm, x, top, g0);
                }
            }
            let sv_eff = js::math::min(0.0, -sv + model.gp_u[i]);
            let phi = model.gp_phi[i];
            // a given K0 is the soils'; rigid materials stay elastic
            let k0 = if rigid {
                nu / (1.0 - nu)
            } else {
                options.k0.unwrap_or(if phi > 0.0 {
                    1.0 - js::math::sin(phi)
                } else {
                    nu / (1.0 - nu)
                })
            };
            out[4 * i] = k0 * sv_eff;
            out[4 * i + 1] = sv_eff;
            out[4 * i + 3] = k0 * sv_eff;
        }
    }
    out
}

/// The model of `prepare_fe_model` and the warnings of its construction stages.
#[derive(Debug, Clone)]
pub struct PreparedModel {
    pub model: FeModel,
    pub warnings: Vec<String>,
}

/// The model for the strength reduction with its initial stresses: built
/// as `build_fe_model`, then with the K0 field or the stresses at the end of
/// the construction stages before the last (see above). `trial_options` are
/// those of the strength reduction's trials (flow rule, solver).
pub fn prepare_fe_model(
    slope: &Slope,
    options: &FeModelOptions,
    initial: &InitialStressOptions,
    trial_options: &SrmOptions,
) -> Result<PreparedModel> {
    let mut warnings = Vec::new();
    let k0 = initial.initial_stress == Some(InitialStress::K0);
    let stage_of = |name: &str| -> f64 {
        initial
            .material_stages
            .as_ref()
            .and_then(|m| m.get(name).copied())
            .unwrap_or(0.0)
    };
    // (a Set of the names: insertion order)
    let mut names: Vec<String> = Vec::new();
    for g in slope.material_geometries() {
        let name = &slope.material(g.material).name;
        if !names.contains(name) {
            names.push(name.clone());
        }
    }
    let mut stages: Vec<f64> = Vec::new();
    for n in &names {
        let s = stage_of(n);
        // (SameValueZero)
        if !stages.iter().any(|&t| t == s || (t.is_nan() && s.is_nan())) {
            stages.push(s);
        }
    }
    js::array::sort_by(&mut stages, |a, b| a - b);
    if stages.len() <= 1 {
        let model = build_fe_model(slope, options)?;
        let model = if k0 {
            let s = k0_stress(
                &model,
                slope,
                &K0Options {
                    k0: initial.k0,
                    original_ground_level: initial.original_ground_level,
                    inactive: &[],
                },
            );
            with_initial_stress(&model, &s)
        } else {
            model
        };
        return Ok(PreparedModel { model, warnings });
    }
    let mut sigma: Option<Vec<f64>> = None;
    for s in 0..stages.len() - 1 {
        let inactive: Vec<String> = names
            .iter()
            .filter(|n| stage_of(n) > stages[s])
            .cloned()
            .collect();
        let mut stage_options = options.clone();
        stage_options.inactive_materials = Some(inactive.clone());
        stage_options.without_reinforcement = Some(true);
        let mut model = build_fe_model(slope, &stage_options)?;
        if s == 0 && k0 {
            sigma = Some(k0_stress(
                &model,
                slope,
                &K0Options {
                    k0: initial.k0,
                    original_ground_level: initial.original_ground_level,
                    inactive: &inactive,
                },
            ));
        }
        if let Some(sg) = &sigma {
            model = with_initial_stress(&model, sg);
        }
        let mut r = run_trial(&mut model, 1.0, None, trial_options, 0.0)?;
        // Newton and BFGS keep no state from a trial that fails; the viscoplastic
        // iteration's last state shows how far the stage got.
        if !r.converged && r.solver != TrialSolver::Viscoplastic {
            let mut vp = trial_options.clone();
            vp.solver = Some(TrialSolver::Viscoplastic);
            r = run_trial(&mut model, 1.0, None, &vp, 0.0)?;
        }
        if !r.converged {
            warnings.push(format!("Construction stage {} of {} did not reach equilibrium at F = 1: the slope fails while it is built; the later stages start from its last state.", s + 1, stages.len()));
        }
        let mut sg = r.state.stress;
        // a material not yet built carries no stress into the next stage
        for e in 0..model.element_count {
            if model.el_inactive[e] {
                sg[12 * e..12 * e + 12].fill(0.0);
            }
        }
        sigma = Some(sg);
    }
    let model = build_fe_model(slope, options)?;
    if model.bars.count > 0 {
        warnings.push("The reinforcement acts from the last construction stage on.".to_string());
    }
    let sigma = sigma.expect("at least two stages");
    Ok(PreparedModel {
        model: with_initial_stress(&model, &sigma),
        warnings,
    })
}
