//! Port of packages/engine/src/fem/analysis.ts.
//!
//! Strength reduction analysis of a slope by finite elements: builds the
//! model, finds the factor of safety (srm.rs) and returns the fields for
//! display, optionally on adaptively refined meshes (adapt.rs).
//!
//! Implementation choices (not from the literature), with their reasons:
//! - Adaptive loop: up to `levels` refinements, stopping when F changes by
//!   less than 0.01; F on the coarser meshes to half that (the stop test's
//!   resolution), on the final mesh to `f_tolerance`, continuing the
//!   bracket of the last search. When no factor is found on a refined mesh,
//!   the coarser mesh's result stands, with a warning.
//! - A refined mesh starts its search at 0.6 × the coarser mesh's F with
//!   steps of 4 %, guided by that F: a finer mesh usually gives a lower
//!   collapse load (de Borst & Vermeer 1984, Géotechnique 34(2), 199–210),
//!   and trials rising from converged states avoid the false failures of a
//!   cold start.
//! - The failure mechanism is shown by the shear strain of the displacement
//!   increment between the last two converged reductions, which shows the
//!   band that moves at failure; the accumulated plastic strain also covers
//!   zones that yielded early and stopped.
//!
//! Rust notes (ARCHITECTURE.md §2.2): TypeScript's generator
//! `analyzeFemSearch` (which wraps one `strengthReductionSearch` per mesh,
//! `onModel`) is the state machine `FemSearch`, one `SrmSearch` per mesh;
//! `analyze_fem` runs its batches in turn. `onTrial` is the run's progress
//! (`ProgressEvent::FemTrial`), `elapsedMs` the run's clock.

// (index loops as in the TypeScript, for a line-by-line port)
#![allow(clippy::needless_range_loop)]

use crate::api::ctx::{Clock, FemStage, ProgressEvent, RunCtx};
use crate::error::{EngineError, Result};
use crate::fem::adapt::{dissipation_indicator, dorfler_mark, refined_size_field, zz_indicator};
use crate::fem::initial_stress::{prepare_fe_model, InitialStressOptions};
use crate::fem::model::{gauss_strains, FeModel, FeModelOptions, SizeField};
use crate::fem::piles::pile_forces;
use crate::fem::srm::{
    run_trial, trial_solver, SrmOptions, SrmResult, SrmResume, SrmSearch, SrmStep, SrmTrial,
    TrialBatch, TrialOutcome, TrialSolver,
};
use crate::fem::transfer::transfer_state;
use crate::js;
use crate::model::slope::Slope;
use crate::model::surface_slide::{frictional_surface_slide, surface_slide_message};
use crate::types::FlowRule;
use serde::{Deserialize, Serialize};
use std::f64::consts::PI;
use std::sync::Arc;

/// The indicator of the adaptive refinement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RefinementIndicator {
    /// The plastic dissipation (default).
    #[default]
    Dissipation,
    /// The Zienkiewicz–Zhu stress error.
    Zz,
}

/// Adaptive refinement (`FemAnalysisOptions.adaptive`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FemAdaptiveOptions {
    /// Refinements at most; default 3.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub levels: Option<f64>,
    /// Dörfler fraction; default 0.3.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub theta: Option<f64>,
    /// Stop when F changes less than this; default 0.01.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub tolerance: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indicator: Option<RefinementIndicator>,
}

/// `FemAnalysisOptions` (TypeScript's `FeModelOptions & SrmOptions &
/// InitialStressOptions & { adaptive }`; the same JSON).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemAnalysisOptions {
    #[serde(flatten)]
    pub model: FeModelOptions,
    #[serde(flatten)]
    pub srm: SrmOptions,
    #[serde(flatten)]
    pub initial: InitialStressOptions,
    /// Adaptive refinement: after each analysis the mesh is refined where the
    /// indicator at the factor of safety is largest (Dörfler marking, θ
    /// default 0.3), until F changes less than `tolerance` (default 0.01) or
    /// `levels` refinements (default 3) have been made. Default: off.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adaptive: Option<FemAdaptiveOptions>,
}

/// Largest forces of a pile at the factor of safety, per pile (kN, kNm).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemPileResult {
    /// Index in the slope's piles.
    pub pile: usize,
    pub max_axial_force: f64,
    pub max_shear_force: f64,
    pub max_moment: f64,
}

/// Factor of safety of one mesh.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemLevel {
    pub elements: usize,
    pub factor_of_safety: f64,
    pub iterations: usize,
}

/// `FemMeshView`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FemMeshView {
    /// Corner node coordinates.
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    /// Corner nodes of each element (3 per element).
    pub triangles: Vec<usize>,
    /// Index into `material_names` per element.
    pub element_material: Vec<usize>,
    pub material_names: Vec<String>,
}

/// `FemAnalysisResult`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FemAnalysisResult {
    pub factor_of_safety: f64,
    /// Smallest F that did not converge.
    #[serde(rename = "failedF")]
    pub failed_f: f64,
    /// F by the displacement-jump criterion, when it could be found.
    #[serde(rename = "displacementJumpF")]
    pub displacement_jump_f: Option<f64>,
    pub trials: Vec<SrmTrial>,
    pub iterations: usize,
    pub warnings: Vec<String>,
    pub mesh: FemMeshView,
    /// Displacement (x, y) of each corner node at the factor of safety (m).
    pub displacement: Vec<f64>,
    /// Accumulated plastic shear strain per element at the factor of safety
    /// (mean over the Gauss points of (ε₁ − ε₃) of the viscoplastic strain).
    pub plastic_shear_strain: Vec<f64>,
    /// Shear strain of the displacement increment between the last two
    /// converged reductions (γmax per element, the mean of its Gauss points).
    pub shear_strain_increment: Vec<f64>,
    /// Factor of safety per mesh, coarsest first (one entry without refinement).
    pub levels: Vec<FemLevel>,
    /// The piles' largest forces at the factor of safety (per pile).
    pub piles: Vec<FemPileResult>,
    /// The element size of the final mesh as a size field, to mesh the same slope again.
    #[serde(skip)]
    pub size_field: Arc<SizeField>,
    pub elapsed_ms: f64,
}

/// In-plane maximum shear strain of the displacement change between two states, per element.
pub fn shear_increment_per_element(model: &FeModel, u: &[f64], u_prev: Option<&[f64]>) -> Vec<f64> {
    let du: Vec<f64> = match u_prev {
        Some(p) => u.iter().zip(p).map(|(v, w)| v - w).collect(),
        None => u.to_vec(),
    };
    let mut strain = vec![0.0f64; 4 * 3 * model.element_count];
    gauss_strains(model, &du, &mut strain);
    let mut out = vec![0.0f64; model.element_count];
    for e in 0..model.element_count {
        let mut s = 0.0;
        for g in 0..3 {
            let o = 4 * (3 * e + g);
            s += js::math::hypot(&[strain[o] - strain[o + 1], strain[o + 2]]);
        }
        out[e] = s / 3.0;
    }
    out
}

/// Plastic shear strain (ε₁ − ε₃ of the viscoplastic strain) per element.
pub fn plastic_shear_per_element(model: &FeModel, evp: &[f64]) -> Vec<f64> {
    let mut out = vec![0.0f64; model.element_count];
    for e in 0..model.element_count {
        let mut s = 0.0;
        for g in 0..3 {
            let o = 4 * (3 * e + g);
            let (ex, ey, gxy, ez) = (evp[o], evp[o + 1], evp[o + 2], evp[o + 3]);
            let r = (js::math::pow((ex - ey) / 2.0, 2.0) + js::math::pow(gxy / 2.0, 2.0)).sqrt();
            let a = (ex + ey) / 2.0 + r;
            let b = (ex + ey) / 2.0 - r;
            s += js::math::max(js::math::max(a, b), ez) - js::math::min(js::math::min(a, b), ez);
        }
        out[e] = s / 3.0;
    }
    out
}

/// A batch of trials of the analysis, with the mesh level they belong to
/// (TypeScript's `FemTrialBatch`, whose model is `FemSearch::model`).
#[derive(Debug, Clone, PartialEq)]
pub struct FemTrialBatch {
    pub batch: TrialBatch,
    /// Mesh level, 0 for the first mesh.
    pub level: usize,
    /// Options of the trials (`run_trial`).
    pub options: SrmOptions,
}

/// What `FemSearch::step` returns: the next batch of trials, or the result.
#[derive(Debug, Clone)]
#[allow(clippy::large_enum_variant)] // (a batch per step; the result once)
pub enum FemStep {
    Batch(FemTrialBatch),
    Done(Box<FemAnalysisResult>),
}

/// Default trials per round: 1, bisection. Measured 2026-10-28, three trials
/// per round run in parallel shortened the wall time only by 1.2–1.35 ×
/// (V018, V020) for 1.5–1.8 × the work: every round waits for a failed
/// trial, which runs to the iteration limit.
pub const DEFAULT_TRIALS_PER_ROUND: f64 = 1.0;

/// Which search is running (the program counter of `analyzeFemSearch`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// The search on the first mesh.
    First,
    /// The search on refined mesh `level + 1`.
    Refine,
    /// F to the requested tolerance on the final mesh.
    Final,
    Finished,
}

/// The analysis as a state machine (TypeScript's generator
/// `analyzeFemSearch`): `step` returns the trials it needs, receives their
/// outcomes in the same order with the next call, and finally the result.
/// The trials of a batch run on `model_mut()` (Hoek–Brown rock sets its
/// strength in the model, as TypeScript's `runTrial`).
pub struct FemSearch<'a> {
    slope: &'a Slope,
    clock: &'a dyn Clock,
    options: FemAnalysisOptions,
    t0: f64,
    warnings: Vec<String>,
    flow_rule: FlowRule,
    tension_cutoff: bool,
    coarse_tol: Option<f64>,
    per_round: f64,
    trial_options: SrmOptions,
    model: FeModel,
    search: SrmSearch,
    /// Mesh level of the running search.
    level: usize,
    reported: usize,
    new_trials: Vec<SrmTrial>,
    phase: Phase,
    r: Option<SrmResult>,
    levels: Vec<FemLevel>,
    capped: bool,
    /// The adaptive loop's refinement index, its last converged level and the coarser mesh.
    ad_level: usize,
    final_level: usize,
    prev: f64,
    coarser: Option<(FeModel, SrmResult)>,
    prior: Option<SrmResult>,
}

impl<'a> FemSearch<'a> {
    /// The analysis of `slope` with `options`: builds the first model (with
    /// its initial stresses) and its search.
    pub fn new(
        slope: &'a Slope,
        options: &FemAnalysisOptions,
        clock: &'a dyn Clock,
    ) -> Result<Self> {
        let t0 = clock.now_ms();
        let mut warnings: Vec<String> = Vec::new();
        let flow_rule = options.srm.flow_rule.unwrap_or(FlowRule::DavisB);
        // Hoek–Brown rock carries no tension here: its instantaneous Mohr–Coulomb
        // parameters at σ3 = 0 (types/hoek_brown.rs) would give it a tensile
        // strength c/tan φ far above the rock mass's s σci/mb (e.g. 200 against
        // 23 kPa), and a steep crest in tension would stand on it.
        let hoek_brown = slope
            .material_geometries()
            .iter()
            .any(|g| slope.material(g.material).model.kind() == "hoek-brown");
        let tension_cutoff = options
            .srm
            .tension_cutoff
            .unwrap_or(slope.tension_crack_depth() > 0.0 || slope.tension_crack_auto())
            || hoek_brown;
        if hoek_brown && options.srm.tension_cutoff == Some(false) {
            warnings.push("The tension cut-off is on: Hoek-Brown rock carries no tension in the finite element analysis.".to_string());
        }
        // With refinement to follow, the coarser meshes need F to half the change
        // that stops the refinement (0.01 by default), so that the stop test is
        // not decided by the bisection's scatter, and no finer than the final
        // tolerance.
        let coarse_tol = match &options.adaptive {
            Some(ad) => Some(js::math::max(
                options.srm.f_tolerance.unwrap_or(0.005),
                ad.tolerance.unwrap_or(0.01) / 2.0,
            )),
            None => options.srm.f_tolerance,
        };
        let per_round = options
            .srm
            .trials_per_round
            .unwrap_or(DEFAULT_TRIALS_PER_ROUND);
        let trial_options = SrmOptions {
            flow_rule: Some(flow_rule),
            tension_cutoff: Some(tension_cutoff),
            solver: options.srm.solver,
            tolerance: options.srm.tolerance,
            max_iterations: options.srm.max_iterations,
            newton_iterations: options.srm.newton_iterations,
            convergence: options.srm.convergence,
            unbalance_tolerance: options.srm.unbalance_tolerance,
            relaxation: options.srm.relaxation,
            ..Default::default()
        };
        let model = prepared(
            slope,
            &options.model,
            &options.initial,
            &trial_options,
            &mut warnings,
        )?;
        // Implementation choice: the warning from φ > 35°.
        if flow_rule == FlowRule::NonAssociated
            && model.gp_phi.iter().any(|&p| p > (35.0 * PI) / 180.0)
        {
            warnings.push("Non-associated flow at high friction angles can give an oscillating or non-unique factor of safety (Tschuchnigg et al. 2015); Davis B is recommended.".to_string());
        }
        let mut me = FemSearch {
            slope,
            clock,
            options: options.clone(),
            t0,
            warnings,
            flow_rule,
            tension_cutoff,
            coarse_tol,
            per_round,
            trial_options,
            search: SrmSearch::new(&model, &SrmOptions::default()),
            model,
            level: 0,
            reported: 0,
            new_trials: Vec::new(),
            phase: Phase::First,
            r: None,
            levels: Vec::new(),
            capped: false,
            ad_level: 0,
            final_level: 0,
            prev: 0.0,
            coarser: None,
            prior: None,
        };
        let o = me.search_options(|o, coarse| o.f_tolerance = coarse);
        me.search = SrmSearch::new(&me.model, &o);
        Ok(me)
    }

    /// The model of the running search, on which its trials run.
    pub fn model(&self) -> &FeModel {
        &self.model
    }

    /// The model, for `run_trial` (which sets Hoek–Brown rock's strength in it).
    pub fn model_mut(&mut self) -> &mut FeModel {
        &mut self.model
    }

    /// The trials made since the last call (TypeScript's `onTrial` sees each as it is made).
    pub fn drain_trials(&mut self) -> Vec<SrmTrial> {
        std::mem::take(&mut self.new_trials)
    }

    /// The strength reduction's options (`{ ...options, ...o, flowRule,
    /// tensionCutoff, trialsPerRound }`): `set` writes `o` given the coarse tolerance.
    fn search_options(&self, set: impl FnOnce(&mut SrmOptions, Option<f64>)) -> SrmOptions {
        let mut o = self.options.srm.clone();
        set(&mut o, self.coarse_tol);
        o.flow_rule = Some(self.flow_rule);
        o.tension_cutoff = Some(self.tension_cutoff);
        o.trials_per_round = Some(self.per_round);
        o
    }

    fn start_search(&mut self, level: usize, options: SrmOptions) {
        self.search = SrmSearch::new(&self.model, &options);
        self.level = level;
        self.reported = 0;
    }

    /// One step: `outcomes` are those of the batch the previous step asked
    /// for (None on the first call).
    pub fn step(&mut self, outcomes: Option<Vec<TrialOutcome>>) -> Result<FemStep> {
        if self.phase == Phase::Finished {
            return Err(EngineError::new("the finite element analysis has ended"));
        }
        let mut outcomes = outcomes;
        loop {
            let st = self.search.step(&self.model, outcomes.take())?;
            let trials = self.search.trials();
            self.new_trials.extend_from_slice(&trials[self.reported..]);
            self.reported = trials.len();
            match st {
                SrmStep::Batch(batch) => {
                    return Ok(FemStep::Batch(FemTrialBatch {
                        batch,
                        level: self.level,
                        options: self.trial_options.clone(),
                    }))
                }
                SrmStep::Done(r) => {
                    if let Some(result) = self.search_done(*r)? {
                        self.phase = Phase::Finished;
                        return Ok(FemStep::Done(Box::new(result)));
                    }
                }
            }
        }
    }

    /// The end of a search: start the next one, or return the result.
    fn search_done(&mut self, r: SrmResult) -> Result<Option<FemAnalysisResult>> {
        match self.phase {
            Phase::First => {
                self.levels = vec![FemLevel {
                    elements: self.model.element_count,
                    factor_of_safety: r.factor_of_safety,
                    iterations: r.iterations,
                }];
                self.capped = self.model.triangulation.capped;
                let go = self.options.adaptive.is_some()
                    && r.factor_of_safety > 0.0
                    && r.failed_f.is_finite();
                self.r = Some(r);
                if go {
                    self.final_level = 0;
                    self.ad_level = 0;
                    return self.refine_or_final();
                }
                self.finish().map(Some)
            }
            Phase::Refine => {
                let level = self.ad_level;
                self.levels.push(FemLevel {
                    elements: self.model.element_count,
                    factor_of_safety: r.factor_of_safety,
                    iterations: r.iterations,
                });
                let (coarser, coarser_r) = self.coarser.take().expect("the coarser mesh");
                if !(r.factor_of_safety > 0.0 && r.failed_f.is_finite()) {
                    // No factor on the refined mesh: the result stays the coarser mesh's.
                    self.warnings.push(format!(
                        "No factor of safety was found on the refined mesh {}{}; the result is that of the coarser mesh.",
                        level + 1,
                        r.warning.as_ref().map_or(String::new(), |w| format!(" ({w})"))
                    ));
                    self.model = coarser;
                    self.r = Some(coarser_r);
                    self.levels.pop();
                    return self.final_check();
                }
                self.capped = self.capped || self.model.triangulation.capped;
                self.final_level = level + 1;
                let changed = (r.factor_of_safety - self.prev).abs();
                self.r = Some(r);
                let tol = self.adaptive().tolerance.unwrap_or(0.01);
                if changed < tol {
                    return self.final_check();
                }
                self.ad_level += 1;
                self.refine_or_final()
            }
            Phase::Final => {
                let prior = self.prior.take().expect("the prior search");
                let mut trials = prior.trials.clone();
                trials.extend_from_slice(&r.trials);
                let previous_state = r.previous_state.clone().or(prior.previous_state.clone());
                let r = SrmResult {
                    trials,
                    previous_state,
                    ..r
                };
                let fl = self.final_level;
                self.levels[fl] = FemLevel {
                    elements: self.model.element_count,
                    factor_of_safety: r.factor_of_safety,
                    iterations: self.levels[fl].iterations + r.iterations,
                };
                self.r = Some(r);
                self.finish().map(Some)
            }
            Phase::Finished => Err(EngineError::new("the finite element analysis has ended")),
        }
    }

    fn adaptive(&self) -> FemAdaptiveOptions {
        self.options.adaptive.clone().unwrap_or_default()
    }

    /// The next refinement while levels are left, else F to the final tolerance.
    fn refine_or_final(&mut self) -> Result<Option<FemAnalysisResult>> {
        let ad = self.adaptive();
        let max_levels = ad.levels.unwrap_or(3.0);
        if !((self.ad_level as f64) < max_levels) {
            return self.final_check();
        }
        let level = self.ad_level;
        let r = self.r.take().expect("a result");
        let eta = match ad.indicator {
            Some(RefinementIndicator::Zz) => zz_indicator(&self.model, &r.state.stress),
            _ => dissipation_indicator(&self.model, &r.state.stress, &r.state.evp),
        };
        let marked = dorfler_mark(&eta, ad.theta.unwrap_or(0.3));
        let mut mo = self.options.model.clone();
        mo.size_field = Some(refined_size_field(&self.model, &marked, 0.0));
        let model = prepared(
            self.slope,
            &mo,
            &self.options.initial,
            &self.trial_options,
            &mut self.warnings,
        )?;
        let coarser = std::mem::replace(&mut self.model, model);
        let prev = r.factor_of_safety;
        // Start below the coarser mesh's factor (a finer mesh gives less) and
        // step up from converged states. With associated flow (Newton or
        // BFGS, whose limit does not depend on the load path) the coarser
        // mesh's state, transferred to the new one, starts the trials just
        // below its factor instead of the unloaded state far below it (not
        // with reinforcement or piles, whose own variables are not moved).
        let mut merged = self.options.srm.clone();
        merged.flow_rule = self.trial_options.flow_rule;
        merged.tension_cutoff = self.trial_options.tension_cutoff;
        let warm_start = if trial_solver(&self.model, &merged) != TrialSolver::Viscoplastic
            && self.model.bars.count == 0
            && self.model.piles.count == 0
        {
            transfer_state(&coarser, &r.state, &self.model).map(Arc::new)
        } else {
            None
        };
        let o = self.search_options(|o, coarse| {
            o.start_f = Some(if warm_start.is_some() { 0.97 } else { 0.6 } * prev);
            o.bracket_step = Some(0.04);
            o.guide = Some(prev);
            o.f_tolerance = coarse;
            if let Some(w) = &warm_start {
                o.warm_start = Some(Arc::clone(w));
            }
        });
        self.prev = prev;
        self.coarser = Some((coarser, r));
        self.phase = Phase::Refine;
        self.start_search(level + 1, o);
        Ok(None)
    }

    /// F to the requested tolerance on the final mesh, or the result.
    fn final_check(&mut self) -> Result<Option<FemAnalysisResult>> {
        let r = self.r.as_ref().expect("a result");
        let f_tol = self.options.srm.f_tolerance.unwrap_or(0.005);
        if r.factor_of_safety > 0.0
            && r.failed_f.is_finite()
            && r.failed_f - r.factor_of_safety > f_tol
        {
            let prior = self.r.take().expect("a result");
            let resume = SrmResume {
                lo: prior.factor_of_safety,
                hi: prior.failed_f,
                hi_from: Some(prior.failed_from),
                state: Arc::clone(&prior.state),
            };
            let f_tolerance = self.options.srm.f_tolerance;
            let o = self.search_options(|o, _| {
                o.f_tolerance = f_tolerance;
                o.resume = Some(resume);
            });
            self.prior = Some(prior);
            self.phase = Phase::Final;
            let fl = self.final_level;
            self.start_search(fl, o);
            return Ok(None);
        }
        self.finish().map(Some)
    }

    /// The result on the final mesh (the end of `analyzeFemSearch`).
    fn finish(&mut self) -> Result<FemAnalysisResult> {
        let r = self.r.take().expect("a result");
        let model = &self.model;
        let slope = self.slope;
        let mut warnings = std::mem::take(&mut self.warnings);
        for w in &model.warnings {
            if !warnings.contains(w) {
                warnings.push(w.clone());
            }
        }
        // The piles' largest forces at the factor of safety, against their capacities.
        let mut pile_results: Vec<FemPileResult> = Vec::new();
        if model.piles.count > 0 {
            let piles = slope.piles();
            let forces = pile_forces(&model.eq, &model.piles, &r.state.u, |i| {
                piles[i].spacing.unwrap_or(1.0)
            });
            for (i, f) in forces {
                let p = &piles[i];
                pile_results.push(FemPileResult {
                    pile: i,
                    max_axial_force: f.axial,
                    max_shear_force: f.shear,
                    max_moment: f.moment,
                });
                if let Some(mc) = p.moment_capacity {
                    if f.moment > mc {
                        warnings.push(format!("Pile {}: the bending moment at the factor of safety, {} kNm per pile, exceeds its capacity {} kNm; the elastic pile overstates its support.", i + 1, js::num::to_fixed(f.moment, 0), js::num::to_string(mc)));
                    }
                }
                if let Some(sc) = p.shear_capacity {
                    if f.shear > sc {
                        warnings.push(format!("Pile {}: the shear force at the factor of safety, {} kN per pile, exceeds its capacity {} kN; the elastic pile overstates its support.", i + 1, js::num::to_fixed(f.shear, 0), js::num::to_string(sc)));
                    }
                }
            }
        }
        if model.seepage.as_ref().is_some_and(|s| !s.converged) {
            warnings.push(
                "The seepage iteration did not converge; the pore pressures are approximate."
                    .to_string(),
            );
        }
        if self.capped {
            warnings.push(
                "The mesh reached its vertex limit; the element size was not reached everywhere."
                    .to_string(),
            );
        }
        if model.triangulation.missing_segments > 0 {
            warnings.push("A material boundary shorter than the mesh's merge tolerance is not represented in the mesh.".to_string());
        }
        if let Some(w) = &r.warning {
            warnings.push(w.clone());
        }
        // A face in frictional soil with a lower infinite-slope factor (not with seepage pore pressures, which it does not take).
        let slide = if model.seepage.is_some() {
            None
        } else {
            frictional_surface_slide(slope, false)?
        };
        if let Some(s) = slide {
            if r.factor_of_safety > 0.0 && s.factor_of_safety < r.factor_of_safety {
                warnings.push(surface_slide_message(&s, r.factor_of_safety));
            }
        }

        let nc = model.corner_count;
        let mut displacement = vec![0.0f64; 2 * nc];
        for n in 0..nc {
            let ix = model.eq[2 * n];
            let iy = model.eq[2 * n + 1];
            displacement[2 * n] = if ix >= 0 { r.state.u[ix as usize] } else { 0.0 };
            displacement[2 * n + 1] = if iy >= 0 { r.state.u[iy as usize] } else { 0.0 };
        }
        let mut triangles = vec![0usize; 3 * model.element_count];
        for e in 0..model.element_count {
            for k in 0..3 {
                triangles[3 * e + k] = model.el[6 * e + k];
            }
        }
        Ok(FemAnalysisResult {
            factor_of_safety: r.factor_of_safety,
            failed_f: r.failed_f,
            displacement_jump_f: r.displacement_jump_f,
            trials: r.trials.clone(),
            iterations: r.iterations,
            warnings,
            mesh: FemMeshView {
                x: model.x[..nc].to_vec(),
                y: model.y[..nc].to_vec(),
                triangles,
                element_material: model.el_material.clone(),
                material_names: model.materials.iter().map(|m| m.name.clone()).collect(),
            },
            displacement,
            plastic_shear_strain: plastic_shear_per_element(model, &r.state.evp),
            shear_strain_increment: shear_increment_per_element(
                model,
                &r.state.u,
                r.previous_state.as_ref().map(|s| s.u.as_slice()),
            ),
            levels: std::mem::take(&mut self.levels),
            piles: pile_results,
            size_field: Arc::clone(&model.size_field),
            elapsed_ms: self.clock.now_ms() - self.t0,
        })
    }
}

/// The model with its initial stresses (K0 procedure, construction stages;
/// initial_stress.rs), its warnings added once.
fn prepared(
    slope: &Slope,
    model: &FeModelOptions,
    initial: &InitialStressOptions,
    trial_options: &SrmOptions,
    warnings: &mut Vec<String>,
) -> Result<FeModel> {
    let p = prepare_fe_model(slope, model, initial, trial_options)?;
    for w in p.warnings {
        if !warnings.contains(&w) {
            warnings.push(w);
        }
    }
    Ok(p.model)
}

/// The analysis with its trials run one after another; each trial is
/// reported to the run's progress (`ProgressEvent::FemTrial`), whose `Break`
/// cancels.
pub fn analyze_fem(
    slope: &Slope,
    options: &FemAnalysisOptions,
    ctx: &mut RunCtx,
) -> Result<FemAnalysisResult> {
    ctx.report(ProgressEvent::FemStage(FemStage::Mesh))?;
    let mut search = FemSearch::new(slope, options, ctx.clock)?;
    let mut outcomes: Option<Vec<TrialOutcome>> = None;
    // the meshes there can be: the first and the refinements
    let meshes = 1 + options.adaptive.as_ref().map_or(0, |a| {
        js::math::max(0.0, js::math::round(a.levels.unwrap_or(3.0))) as usize
    });
    let mut reported_mesh: Option<usize> = None;
    loop {
        let step = search.step(outcomes.take())?;
        for t in search.drain_trials() {
            ctx.report(ProgressEvent::FemTrial(t))?;
        }
        match step {
            FemStep::Batch(b) => {
                if reported_mesh != Some(b.level) {
                    reported_mesh = Some(b.level);
                    ctx.report(ProgressEvent::FemStage(FemStage::StrengthReduction {
                        mesh: b.level,
                        meshes: meshes.max(b.level + 1),
                    }))?;
                }
                let mut out = Vec::with_capacity(b.batch.f.len());
                for &f in &b.batch.f {
                    ctx.check_cancelled()?;
                    out.push(run_trial(
                        search.model_mut(),
                        f,
                        b.batch.start.as_deref(),
                        &b.options,
                        b.batch.start_f,
                    )?);
                }
                outcomes = Some(out);
            }
            FemStep::Done(r) => return Ok(*r),
        }
    }
}
