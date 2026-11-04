//! Port of packages/engine/src/model/reliability.ts
//!
//! Probabilistic (reliability) analysis.
//!
//! Material parameters are random variables (mean = the model value,
//! standard deviation given). Two methods:
//!
//! - Taylor series (TSPM, Duncan 2000; US Army Corps of Engineers): F at the
//!   most likely values and at mean ± σ of each variable in turn;
//!   σF = √Σ(ΔFᵢ/2)² (with correlation terms), COV = σF/F, lognormal
//!   reliability index β = ln(F/√(1+COV²))/√ln(1+COV²) and Pf = Φ(−β). The
//!   critical surface can be searched again for every evaluation.
//! - Monte Carlo on the critical surface at the mean values (commonly
//!   called the "Global Minimum" method; its "Overall Slope" method repeats the search
//!   for every sample, which is not done here): sampled parameters (normal
//!   or lognormal, truncated, optionally correlated), Pf = share of samples
//!   with F < 1.
//!
//! TypeScript's generator `reliabilitySteps` is the state machine
//! `ReliabilitySteps`: it asks its driver for an analysis of a slope
//! (`ReliabilityStep::Analyse`, `slope_mut`) or for the factors of the
//! Monte Carlo samples (`ReliabilityStep::Samples`, `samples`), which it
//! reads when resumed. `analyse_reliability` drives it with the run's
//! context: the searches' batches by its evaluator, the samples by
//! `Evaluator::map_samples` (drawn serially first, evaluated in any order,
//! each thread on its own copy of the sampler's slope, aggregated in
//! order: ARCHITECTURE.md §7.1), so a parallel run gives the serial result
//! bit for bit.
//!
//! Material fields are named by string (`RandomVariable.field`), as in
//! TypeScript, which reads and writes them on the model object: the model
//! is read and written as its JSON (`MaterialModel::from_json`).

use crate::api::ctx::{ProgressEvent, RunCtx, SampleJob};
use crate::error::{EngineError, Result};
use crate::js;
use crate::model::build_slope::build_slope;
use crate::model::canonical::SlopeOrientation;
use crate::model::canonical::{get_domain_x, mirror_point, mirror_x, resolve_orientation};
use crate::model::property_helpers::Rng;
use crate::model::slope::{AnalysisOptionsPatch, Slope};
use crate::model::solvers::analyse_slope;
use crate::types::material::MaterialId;
use crate::types::material_models::MaterialModel;
use crate::types::slope_definition::{
    material_model_of, with_material_model, CustomSearchPlane, CustomSurface, SlopeDefinition,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::f64::consts::PI;
use std::sync::Arc;

/// The distribution of a random variable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Distribution {
    Normal,
    Lognormal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RandomVariable {
    /// Index of the material in the definition's materials.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub material: f64,
    /// Field of the material model, e.g. "cohesion", "frictionAngle", "unitWeight", "undrainedShearStrength".
    pub field: String,
    /// Standard deviation (same unit as the field).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub sd: f64,
    /// Default "normal".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub distribution: Option<Distribution>,
    /// Truncation of sampled values (Monte Carlo). Default: ≥ 0 for strength and unit weight, φ < 90°.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub min: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub max: Option<f64>,
}

/// The method of a reliability analysis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReliabilityMethod {
    #[serde(rename = "taylor")]
    Taylor,
    #[serde(rename = "monte-carlo")]
    MonteCarlo,
}

/// A correlation coefficient between two variables (indices into the list).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Correlation {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub a: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub b: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub rho: f64,
}

/// TypeScript's `ReliabilityOptions` (its `onProgress` is the run
/// context's progress, `ProgressEvent::Reliability`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityOptions {
    pub method: ReliabilityMethod,
    /// Taylor series: search the critical surface again for each evaluation. Default true.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<bool>,
    /// Monte Carlo: number of samples (default 1000) and random seed (default 1).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub samples: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub seed: Option<f64>,
    /// Correlation coefficients between variables (indices into the list).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub correlations: Option<Vec<Correlation>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaylorTerm {
    pub variable: usize,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub mean: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub sd: f64,
    /// F with the variable at mean + σ and mean − σ.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub f_plus: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub f_minus: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CriticalSurface {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cx: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cy: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub radius: f64,
    pub lc: [f64; 2],
    pub rc: [f64; 2],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<[f64; 2]>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReliabilityResult {
    pub method: ReliabilityMethod,
    /// F at the most likely (mean) values.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub fos: f64,
    /// Mean and standard deviation of F (Taylor: F at the means and σF).
    #[serde(rename = "meanFOS", deserialize_with = "crate::types::json::num")]
    pub mean_fos: f64,
    #[serde(rename = "sdFOS", deserialize_with = "crate::types::json::num")]
    pub sd_fos: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cov: f64,
    /// Lognormal reliability index and its probability of failure Φ(−β).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub beta_lognormal: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub pf_lognormal: f64,
    /// Normal reliability index (μF − 1)/σF.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub beta_normal: f64,
    /// Monte Carlo: share of samples with F < 1.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub pf: Option<f64>,
    /// Monte Carlo: the sampled F (failed evaluations left out).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub samples: Option<Vec<f64>>,
    /// Taylor series: F at mean ± σ of each variable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub terms: Option<Vec<TaylorTerm>>,
    /// Critical surface at the mean values (canonical coordinates).
    pub surface: CriticalSurface,
    /// Evaluations without a FOS.
    pub failed: usize,
}

/// Fields that cannot be negative (strengths and unit weights); rates and reference levels can.
const NON_NEGATIVE: [&str; 6] = [
    "cohesion",
    "frictionAngle",
    "undrainedShearStrength",
    "suRef",
    "cohesionUndrained",
    "unitWeight",
];

fn non_negative(field: &str) -> bool {
    NON_NEGATIVE.contains(&field)
}

/// Standard normal cumulative distribution (Abramowitz & Stegun 26.2.17).
pub fn normal_cdf(x: f64) -> f64 {
    let t = 1.0 / (1.0 + 0.2316419 * x.abs());
    let d = 0.3989422804014327 * js::math::exp((-x * x) / 2.0);
    let p = d
        * t
        * (0.31938153
            + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    if x >= 0.0 {
        1.0 - p
    } else {
        p
    }
}

/// Lognormal reliability index of a factor of safety with mean F and coefficient of variation COV.
pub fn lognormal_beta(f: f64, cov: f64) -> f64 {
    if !(cov > 0.0) {
        return if f >= 1.0 {
            f64::INFINITY
        } else {
            f64::NEG_INFINITY
        };
    }
    let s2 = js::math::log(1.0 + cov * cov);
    js::math::log(f / (1.0 + cov * cov).sqrt()) / s2.sqrt()
}

fn gaussian(random: &mut Rng) -> f64 {
    // Box–Muller
    let mut u = 0.0;
    while u == 0.0 {
        u = random.next();
    }
    (-2.0 * js::math::log(u)).sqrt() * js::math::cos(2.0 * PI * random.next())
}

/// Lower triangular L with L·Lᵀ = C (C positive definite).
#[allow(clippy::needless_range_loop)] // (the indices as TypeScript writes them)
fn cholesky(c: &[Vec<f64>]) -> Result<Vec<Vec<f64>>> {
    let n = c.len();
    let mut l = vec![vec![0.0; n]; n];
    for i in 0..n {
        for j in 0..=i {
            let mut s = c[i][j];
            for k in 0..j {
                s -= l[i][k] * l[j][k];
            }
            if i == j {
                if !(s > 0.0) {
                    return Err(EngineError::new(
                        "The correlation matrix is not positive definite.",
                    ));
                }
                l[i][i] = s.sqrt();
            } else {
                l[i][j] = s / l[j][j];
            }
        }
    }
    Ok(l)
}

/// An index given as a number, when it is one of `0..n` (`a < n` with an
/// integer; TypeScript reads `c[a]` of another number as undefined).
fn index_of(x: f64, n: usize) -> Option<usize> {
    if x >= 0.0 && x.fract() == 0.0 && x < n as f64 {
        Some(x as usize)
    } else {
        None
    }
}

fn correlation_matrix(n: usize, correlations: Option<&[Correlation]>) -> Result<Vec<Vec<f64>>> {
    let mut c: Vec<Vec<f64>> = (0..n)
        .map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect())
        .collect();
    for &Correlation { a, b, rho } in correlations.unwrap_or(&[]) {
        if a == b || a < 0.0 || b < 0.0 || a >= n as f64 || b >= n as f64 || !(rho.abs() < 1.0) {
            return Err(EngineError::new(
                "Correlations need two different variables and |ρ| < 1.",
            ));
        }
        // (TypeScript writes c[a][b] for any number in range; a fraction
        // would add a property no element reads)
        if let (Some(a), Some(b)) = (index_of(a, n), index_of(b, n)) {
            c[a][b] = rho;
            c[b][a] = rho;
        }
    }
    Ok(c)
}

/// The material of a variable in the definition.
fn material_index(def: &SlopeDefinition, v: &RandomVariable) -> Result<usize> {
    index_of(v.material, def.materials.len()).ok_or_else(|| {
        EngineError::new(format!(
            "Random variable: no material {}.",
            js::num::to_string(v.material + 1.0)
        ))
    })
}

/// A model as its JSON (TypeScript's object).
fn model_json(model: &MaterialModel) -> Value {
    serde_json::to_value(model).unwrap_or(Value::Null)
}

fn model_value(def: &SlopeDefinition, v: &RandomVariable) -> Result<f64> {
    let m = &def.materials[material_index(def, v)?];
    let model = model_json(&material_model_of(m)?);
    match model.get(&v.field).and_then(Value::as_f64) {
        Some(x) if x.is_finite() => Ok(x),
        _ => Err(EngineError::new(format!(
            "Random variable: material \"{}\" has no {}.",
            m.name, v.field
        ))),
    }
}

/// `model[field] = value` on a model's JSON.
fn set_field(model: &mut Value, field: &str, value: f64) {
    if let Some(o) = model.as_object_mut() {
        o.insert(field.to_string(), Value::from(value));
    }
}

/// `typeof model[field] === "number"`: the number.
fn number_field(model: &Value, field: &str) -> Option<f64> {
    model.get(field).and_then(Value::as_f64)
}

/// The definition with the variables at the given values.
fn definition_with(
    def: &SlopeDefinition,
    variables: &[RandomVariable],
    values: &[f64],
) -> Result<SlopeDefinition> {
    let mut materials = Vec::with_capacity(def.materials.len());
    let mut models: Vec<Value> = Vec::with_capacity(def.materials.len());
    for m in &def.materials {
        materials.push(with_material_model(m)?);
        models.push(model_json(&material_model_of(m)?));
    }
    for (i, v) in variables.iter().enumerate() {
        let model = &mut models[material_index(def, v)?];
        if v.field == "unitWeight" {
            // γsat keeps its difference to γ.
            let delta = values[i] - number_field(model, "unitWeight").unwrap_or(f64::NAN);
            set_field(model, "unitWeight", values[i]);
            if let Some(sat) = number_field(model, "unitWeightSat") {
                set_field(model, "unitWeightSat", sat + delta);
            }
        } else {
            set_field(model, &v.field, values[i]);
        }
    }
    for (m, model) in materials.iter_mut().zip(models) {
        m.model = Some(MaterialModel::from_json(model));
    }
    Ok(SlopeDefinition {
        materials,
        ..def.clone()
    })
}

fn build(def: &SlopeDefinition, options: &AnalysisOptionsPatch) -> Result<Slope> {
    let mut slope = build_slope(def)?;
    slope.update_analysis_options(options)?;
    Ok(slope)
}

/// The definition with only the given surface analysed.
fn on_surface(def: &SlopeDefinition, s: &CriticalSurface) -> SlopeDefinition {
    // The moment axis of a polyline is kept (an optimised surface uses its
    // seed circle's centre; the default axis would give another FOS).
    match &s.points {
        Some(points) => SlopeDefinition {
            custom_surfaces: Some(vec![CustomSurface {
                points: points.clone(),
                axis: Some([s.cx, s.cy]),
            }]),
            custom_search_planes: None,
            custom_planes_only: Some(true),
            ..def.clone()
        },
        None => SlopeDefinition {
            custom_search_planes: Some(vec![CustomSearchPlane {
                cx: s.cx,
                cy: s.cy,
                radius: s.radius,
            }]),
            custom_surfaces: None,
            custom_planes_only: Some(true),
            ..def.clone()
        },
    }
}

/// Lowest FOS of an analysed slope and its surface (the end of TypeScript's
/// `critical`, after its "analyse" step).
fn critical(slope: &Slope) -> Option<(f64, CriticalSurface)> {
    let best = slope.search().iter().find(|p| p.fos.is_some())?;
    let fos = best.fos?;
    Some((
        fos,
        CriticalSurface {
            cx: best.cx,
            cy: best.cy,
            radius: best.radius,
            lc: best.lc,
            rc: best.rc,
            points: best.points.clone(),
        },
    ))
}

/// The Monte Carlo sampler of a definition with only the critical surface
/// (onSurface): the slope is built once and only the materials change.
#[derive(Debug, Clone)]
pub struct MonteCarloSampler {
    slope: Slope,
    /// The slope's material of each definition material (by name), if any.
    materials_by_index: Vec<Option<MaterialId>>,
    /// Their models before any sample (JSON).
    base_models: Vec<Option<Value>>,
    variables: Vec<RandomVariable>,
}

impl MonteCarloSampler {
    /// `monteCarloSampler(surfaceDef, options, variables)`.
    pub fn new(
        surface_def: &SlopeDefinition,
        options: &AnalysisOptionsPatch,
        variables: &[RandomVariable],
    ) -> Result<Self> {
        let slope = build(surface_def, options)?;
        if slope.individual_planes().is_empty() {
            return Err(EngineError::new(
                "The critical surface at the mean values could not be set up again for the samples.",
            ));
        }
        let materials_by_index: Vec<Option<MaterialId>> = surface_def
            .materials
            .iter()
            .map(|m| {
                slope
                    .material_geometries()
                    .iter()
                    .map(|g| g.material)
                    .find(|&id| slope.material(id).name == m.name)
            })
            .collect();
        let base_models = materials_by_index
            .iter()
            .map(|m| m.map(|id| model_json(&slope.material(id).model)))
            .collect();
        Ok(MonteCarloSampler {
            slope,
            materials_by_index,
            base_models,
            variables: variables.to_vec(),
        })
    }

    /// F of the sampler's slope with the variables at `values` (None when
    /// there is none), on `slope`: the sampler's own or a copy of it. Each
    /// sample sets the models from their base values, so the result does
    /// not depend on the samples before it.
    pub fn sample_on(
        &self,
        slope: &mut Slope,
        values: &[f64],
        ctx: &mut RunCtx,
    ) -> Result<Option<f64>> {
        self.apply_values(slope, values);
        slope.materials_changed();
        let fos = analyse_slope(slope, ctx)?;
        Ok(fos.filter(|f| f.is_finite()))
    }

    /// F with the variables at `values`, on the sampler's own slope.
    pub fn sample(&mut self, values: &[f64], ctx: &mut RunCtx) -> Result<Option<f64>> {
        let mut slope = std::mem::take(&mut self.slope);
        let r = self.sample_on(&mut slope, values, ctx);
        self.slope = slope;
        r
    }

    /// The sampler's slope (a copy per thread for parallel samples).
    pub fn slope(&self) -> &Slope {
        &self.slope
    }

    /// Set the variables on the slope's materials (from their base models).
    fn apply_values(&self, slope: &mut Slope, values: &[f64]) {
        // (a Map: by material, in the order first met)
        let mut next: Vec<(usize, Value)> = Vec::new();
        for (i, v) in self.variables.iter().enumerate() {
            let Some(index) = index_of(v.material, self.base_models.len()) else {
                continue;
            };
            let Some(b) = &self.base_models[index] else {
                continue;
            };
            if self.materials_by_index[index].is_none() {
                continue;
            }
            let pos = match next.iter().position(|(k, _)| *k == index) {
                Some(p) => p,
                None => {
                    next.push((index, b.clone()));
                    next.len() - 1
                }
            };
            let model = &mut next[pos].1;
            if v.field == "unitWeight" {
                // γsat keeps its difference to γ.
                set_field(model, "unitWeight", values[i]);
                if let Some(sat) = number_field(b, "unitWeightSat") {
                    let uw = number_field(b, "unitWeight").unwrap_or(f64::NAN);
                    set_field(model, "unitWeightSat", sat + values[i] - uw);
                }
            } else {
                set_field(model, &v.field, values[i]);
            }
        }
        // The samples change the materials in place (the slope is built once).
        for (index, model) in next {
            let id = self.materials_by_index[index].expect("checked above");
            slope.set_material_model(id, Arc::new(MaterialModel::from_json(model)));
        }
    }
}

/// What the reliability analysis asks of its driver when it pauses.
#[derive(Debug, Clone, PartialEq)]
pub enum ReliabilityStep {
    /// A full analysis of `ReliabilitySteps::slope_mut()` (built from the
    /// definition and options), in place, as analyseSlope; resume with None.
    Analyse,
    /// F of each set of values of `ReliabilitySteps::samples()` by its
    /// sampler (None where there is none), in order; resume with them.
    Samples,
    /// The result.
    Done(Box<ReliabilityResult>),
}

/// Where `ReliabilitySteps` is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum At {
    Start,
    AfterMean,
    /// Variable i, the analysis at mean + σ (false) or mean − σ (true) is out.
    Taylor {
        i: usize,
        minus: bool,
    },
    AfterSamples,
    Done,
}

/// `reliabilitySteps(def, options, variables, ro)` as a state machine.
pub struct ReliabilitySteps {
    def: SlopeDefinition,
    options: AnalysisOptionsPatch,
    variables: Vec<RandomVariable>,
    ro: ReliabilityOptions,
    at: At,
    /// The slope of the analysis that is out.
    slope: Option<Slope>,
    means: Vec<f64>,
    at_mean: Option<(f64, CriticalSurface)>,
    corr: Vec<Vec<f64>>,
    /// Taylor: the definition the evaluations start from, the terms, the
    /// evaluations without a factor, and F at mean + σ of the variable out.
    base: Option<SlopeDefinition>,
    terms: Vec<TaylorTerm>,
    failed: usize,
    f_plus: f64,
    /// Monte Carlo: the sampler and the drawn values.
    sampler: Option<MonteCarloSampler>,
    drawn: Vec<Vec<f64>>,
    n: f64,
    /// Progress to report (0–1), taken by the driver.
    progress: Option<f64>,
    /// The definition of the analysis out (TypeScript's `step.def`).
    analysed: Option<SlopeDefinition>,
}

impl ReliabilitySteps {
    pub fn new(
        def: &SlopeDefinition,
        options: &AnalysisOptionsPatch,
        variables: &[RandomVariable],
        ro: &ReliabilityOptions,
    ) -> Self {
        ReliabilitySteps {
            def: def.clone(),
            options: options.clone(),
            variables: variables.to_vec(),
            ro: ro.clone(),
            at: At::Start,
            slope: None,
            means: Vec::new(),
            at_mean: None,
            corr: Vec::new(),
            base: None,
            terms: Vec::new(),
            failed: 0,
            f_plus: 0.0,
            sampler: None,
            drawn: Vec::new(),
            n: 0.0,
            progress: None,
            analysed: None,
        }
    }

    /// The slope to analyse (after `ReliabilityStep::Analyse`).
    pub fn slope_mut(&mut self) -> &mut Slope {
        self.slope.as_mut().expect("an analysis is out")
    }

    /// The sampler and the values to sample (after `ReliabilityStep::Samples`).
    pub fn samples(&self) -> (&MonteCarloSampler, &[Vec<f64>]) {
        (self.sampler.as_ref().expect("samples are out"), &self.drawn)
    }

    /// The definition of the analysis out (after `ReliabilityStep::Analyse`;
    /// TypeScript's `step.def`). Not a port: for drivers that rebuild the
    /// slope elsewhere (the facade's evaluator pool).
    pub fn analysed_definition(&self) -> Option<&SlopeDefinition> {
        self.analysed.as_ref()
    }

    /// The definition the samples are analysed on (after
    /// `ReliabilityStep::Samples`; TypeScript's `step.def`): the critical
    /// surface at the means only. Not a port: for drivers that rebuild the
    /// sampler elsewhere (the facade's evaluator pool).
    pub fn samples_definition(&self) -> Option<SlopeDefinition> {
        self.at_mean.as_ref().map(|m| on_surface(&self.def, &m.1))
    }

    /// The number of samples (Monte Carlo; progress is done / n).
    pub fn sample_count(&self) -> f64 {
        self.n
    }

    /// Progress reached since the last call (TypeScript's `onProgress` at
    /// the end of each Taylor variable).
    pub fn take_progress(&mut self) -> Option<f64> {
        self.progress.take()
    }

    /// Starts an analysis of a definition (TypeScript's `critical`).
    fn analyse(&mut self, def: &SlopeDefinition) -> Result<ReliabilityStep> {
        self.slope = Some(build(def, &self.options)?);
        self.analysed = Some(def.clone());
        Ok(ReliabilityStep::Analyse)
    }

    /// The analysis of the Taylor evaluation of variable i, mean ± σ.
    fn taylor_step(&mut self, i: usize, minus: bool) -> Result<ReliabilityStep> {
        let v = &self.variables[i];
        let mut values = self.means.clone();
        if minus {
            values[i] -= v.sd;
        } else {
            values[i] += v.sd;
        }
        let base = self.base.as_ref().expect("the Taylor base");
        let values_def = definition_with(base, &self.variables, &values)?;
        self.at = At::Taylor { i, minus };
        self.analyse(&values_def)
    }

    /// Variable i of the Taylor series: its check, then F at mean + σ.
    fn taylor_variable(&mut self, i: usize) -> Result<ReliabilityStep> {
        if i >= self.variables.len() {
            return self.taylor_end();
        }
        let v = &self.variables[i];
        if non_negative(&v.field) && self.means[i] - v.sd < 0.0 {
            return Err(EngineError::new(format!(
                "Mean − σ of {} (material {}) is negative; use Monte Carlo, which truncates the samples.",
                v.field,
                js::num::to_string(v.material + 1.0)
            )));
        }
        self.taylor_step(i, false)
    }

    fn taylor_end(&mut self) -> Result<ReliabilityStep> {
        if self.failed > 0 {
            return Err(EngineError::new(format!(
                "{} evaluation(s) at mean ± σ found no slip surface.",
                self.failed
            )));
        }
        let (f, surface) = self.at_mean.clone().expect("the mean");
        // σF² = Σᵢ Σⱼ ρᵢⱼ (ΔFᵢ/2)(ΔFⱼ/2), with signed ΔF = F⁺ − F⁻.
        let half: Vec<f64> = self
            .terms
            .iter()
            .map(|t| (t.f_plus - t.f_minus) / 2.0)
            .collect();
        let mut var_f = 0.0;
        for i in 0..half.len() {
            for j in 0..half.len() {
                var_f += self.corr[i][j] * half[i] * half[j];
            }
        }
        let sd = js::math::max(0.0, var_f).sqrt();
        let cov = sd / f;
        let beta = lognormal_beta(f, cov);
        self.at = At::Done;
        Ok(ReliabilityStep::Done(Box::new(ReliabilityResult {
            method: ReliabilityMethod::Taylor,
            fos: f,
            mean_fos: f,
            sd_fos: sd,
            cov,
            beta_lognormal: beta,
            pf_lognormal: normal_cdf(-beta),
            beta_normal: if sd > 0.0 {
                (f - 1.0) / sd
            } else if f >= 1.0 {
                f64::INFINITY
            } else {
                f64::NEG_INFINITY
            },
            pf: None,
            samples: None,
            terms: Some(std::mem::take(&mut self.terms)),
            surface,
            failed: 0,
        })))
    }

    /// Monte Carlo on the critical surface at the means: the slope is built
    /// once and only the materials change (MonteCarloSampler). The values of
    /// all samples are drawn first: they do not depend on the factors.
    fn monte_carlo(&mut self) -> Result<ReliabilityStep> {
        let n = js::math::max(
            10.0,
            js::math::min(100000.0, js::math::round(self.ro.samples.unwrap_or(1000.0))),
        );
        self.n = n;
        let mut random = Rng::new(self.ro.seed.unwrap_or(1.0));
        let l = cholesky(&self.corr)?;
        let surface = &self.at_mean.as_ref().expect("the mean").1;
        let surface_def = on_surface(&self.def, surface);
        let sampler = MonteCarloSampler::new(&surface_def, &self.options, &self.variables)?;
        struct Params {
            lognormal: bool,
            mu: f64,
            sigma: f64,
            min: f64,
            max: f64,
        }
        let params: Vec<Params> = self
            .variables
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let mean = self.means[i];
                let lognormal = v.distribution == Some(Distribution::Lognormal) && mean > 0.0;
                let s2 = if lognormal {
                    js::math::log(1.0 + js::math::pow(v.sd / mean, 2.0))
                } else {
                    0.0
                };
                Params {
                    lognormal,
                    mu: if lognormal {
                        js::math::log(mean) - s2 / 2.0
                    } else {
                        mean
                    },
                    sigma: if lognormal { s2.sqrt() } else { v.sd },
                    min: v.min.unwrap_or(if non_negative(&v.field) {
                        0.0
                    } else {
                        f64::NEG_INFINITY
                    }),
                    // φ below 90° (the samples skip the model validation).
                    max: v.max.unwrap_or(if v.field == "frictionAngle" {
                        89.9
                    } else {
                        f64::INFINITY
                    }),
                }
            })
            .collect();
        let nv = self.variables.len();
        let mut drawn: Vec<Vec<f64>> = Vec::new();
        let mut values = vec![0.0; nv];
        let mut k = 0.0;
        while k < n {
            // Correlated standard normals; resampled until within the truncation.
            for attempt in 0..100 {
                let z: Vec<f64> = (0..nv).map(|_| gaussian(&mut random)).collect();
                let mut ok = true;
                for i in 0..nv {
                    let mut zi = 0.0;
                    for j in 0..=i {
                        zi += l[i][j] * z[j];
                    }
                    let p = &params[i];
                    values[i] = if p.lognormal {
                        js::math::exp(p.mu + p.sigma * zi)
                    } else {
                        p.mu + p.sigma * zi
                    };
                    if values[i] < p.min || values[i] > p.max {
                        ok = false;
                    }
                }
                if ok {
                    break;
                }
                if attempt == 99 {
                    for (i, x) in values.iter_mut().enumerate() {
                        *x = js::math::min(params[i].max, js::math::max(params[i].min, *x));
                    }
                }
            }
            drawn.push(values.clone());
            k += 1.0;
        }
        self.sampler = Some(sampler);
        self.drawn = drawn;
        self.at = At::AfterSamples;
        Ok(ReliabilityStep::Samples)
    }

    fn monte_carlo_end(&mut self, factors: Vec<Option<f64>>) -> Result<ReliabilityStep> {
        let mut samples: Vec<f64> = Vec::new();
        let mut failed = 0;
        for fos in factors {
            match fos {
                None => failed += 1,
                Some(f) => samples.push(f),
            }
        }
        if samples.len() < 2 {
            return Err(EngineError::new("Too few Monte Carlo samples gave a FOS."));
        }
        let len = samples.len() as f64;
        let mut total = 0.0;
        for &s in &samples {
            total += s;
        }
        let mean = total / len;
        let mut squares = 0.0;
        for &s in &samples {
            squares += js::math::pow(s - mean, 2.0);
        }
        let sd = (squares / (len - 1.0)).sqrt();
        let cov = sd / mean;
        let beta = lognormal_beta(mean, cov);
        let (f, surface) = self.at_mean.clone().expect("the mean");
        let below = samples.iter().filter(|&&f| f < 1.0).count() as f64;
        self.at = At::Done;
        Ok(ReliabilityStep::Done(Box::new(ReliabilityResult {
            method: ReliabilityMethod::MonteCarlo,
            fos: f,
            mean_fos: mean,
            sd_fos: sd,
            cov,
            beta_lognormal: beta,
            pf_lognormal: normal_cdf(-beta),
            beta_normal: if sd > 0.0 {
                (mean - 1.0) / sd
            } else if mean >= 1.0 {
                f64::INFINITY
            } else {
                f64::NEG_INFINITY
            },
            pf: Some(below / len),
            samples: Some(samples),
            terms: None,
            surface,
            failed,
        })))
    }

    /// Runs to the next step. `factors`: the factors of a `Samples` step.
    pub fn resume(&mut self, factors: Option<Vec<Option<f64>>>) -> Result<ReliabilityStep> {
        match self.at {
            At::Start => {
                if self.variables.is_empty() {
                    return Err(EngineError::new("Give at least one random variable."));
                }
                for v in &self.variables {
                    if !(v.sd.is_finite() && v.sd >= 0.0) {
                        return Err(EngineError::new("Standard deviations must be ≥ 0."));
                    }
                }
                let mut means = Vec::with_capacity(self.variables.len());
                for v in &self.variables {
                    means.push(model_value(&self.def, v)?);
                }
                self.means = means;
                self.at = At::AfterMean;
                let def = self.def.clone();
                self.analyse(&def)
            }
            At::AfterMean => {
                let mean_slope = self.slope.take().expect("the mean slope");
                let Some(at_mean) = critical(&mean_slope) else {
                    return Err(EngineError::new(
                        "No valid slip surface at the mean values.",
                    ));
                };
                // A material in no region would vary nothing.
                for v in &self.variables {
                    let name = &self.def.materials[material_index(&self.def, v)?].name;
                    let used = mean_slope
                        .material_geometries()
                        .iter()
                        .any(|g| &mean_slope.material(g.material).name == name);
                    if !used {
                        return Err(EngineError::new(format!(
                            "Random variable: material \"{name}\" is not used in the model."
                        )));
                    }
                }
                self.corr =
                    correlation_matrix(self.variables.len(), self.ro.correlations.as_deref())?;
                let surface = at_mean.1.clone();
                self.at_mean = Some(at_mean);
                match self.ro.method {
                    ReliabilityMethod::Taylor => {
                        let search = self.ro.search.unwrap_or(true);
                        self.base = Some(if search {
                            self.def.clone()
                        } else {
                            on_surface(&self.def, &surface)
                        });
                        self.taylor_variable(0)
                    }
                    ReliabilityMethod::MonteCarlo => self.monte_carlo(),
                }
            }
            At::Taylor { i, minus } => {
                let slope = self.slope.take().expect("the Taylor slope");
                let f = match critical(&slope) {
                    Some((f, _)) => f,
                    None => {
                        self.failed += 1;
                        f64::NAN
                    }
                };
                if !minus {
                    self.f_plus = f;
                    return self.taylor_step(i, true);
                }
                let v = &self.variables[i];
                self.terms.push(TaylorTerm {
                    variable: i,
                    mean: self.means[i],
                    sd: v.sd,
                    f_plus: self.f_plus,
                    f_minus: f,
                });
                self.progress = Some((i + 1) as f64 / self.variables.len() as f64);
                self.taylor_variable(i + 1)
            }
            At::AfterSamples => {
                let factors = factors.ok_or_else(|| {
                    EngineError::new("reliabilitySteps: resumed without the samples' factors")
                })?;
                self.monte_carlo_end(factors)
            }
            At::Done => Err(EngineError::new("reliabilitySteps: resumed after the end")),
        }
    }
}

/// Samples between two progress reports (TypeScript reports every 50).
const PROGRESS_SAMPLES: usize = 50;

/// Reliability of a slope (canonical definition, analysis options as for
/// a normal run) for the given random variables. The searches' surfaces
/// are evaluated by the context's evaluator, and so are the Monte Carlo
/// samples (`Evaluator::map_samples`); progress (0–1) is reported as
/// `ProgressEvent::Reliability`.
pub fn analyse_reliability(
    def: &SlopeDefinition,
    options: &AnalysisOptionsPatch,
    variables: &[RandomVariable],
    ro: &ReliabilityOptions,
    ctx: &mut RunCtx,
) -> Result<ReliabilityResult> {
    let mut steps = ReliabilitySteps::new(def, options, variables, ro);
    let mut input: Option<Vec<Option<f64>>> = None;
    loop {
        ctx.check_cancelled()?;
        let step = steps.resume(input.take())?;
        if let Some(p) = steps.take_progress() {
            ctx.report(ProgressEvent::Reliability(p))?;
        }
        match step {
            ReliabilityStep::Done(r) => return Ok(*r),
            ReliabilityStep::Analyse => {
                // (the analyses report no progress of their own, as in TypeScript)
                let mut inner = RunCtx {
                    progress: None,
                    cancel: ctx.cancel,
                    clock: ctx.clock,
                    evaluator: ctx.evaluator,
                    retention: ctx.retention,
                };
                analyse_slope(steps.slope_mut(), &mut inner)?;
            }
            ReliabilityStep::Samples => {
                input = Some(sample_factors(&steps, ctx)?);
            }
        }
    }
}

/// The factors of the drawn samples, in order, by the context's evaluator
/// (in chunks between progress reports when progress is reported or the
/// run can be cancelled; the results do not depend on the chunks).
fn sample_factors(steps: &ReliabilitySteps, ctx: &mut RunCtx) -> Result<Vec<Option<f64>>> {
    let (sampler, values) = steps.samples();
    let n = steps.sample_count();
    let count = values.len();
    let chunk = if ctx.progress.is_some() || ctx.cancel.is_some() {
        PROGRESS_SAMPLES
    } else {
        count.max(1)
    };
    let cancel = ctx.cancel;
    let clock = ctx.clock;
    let evaluator = ctx.evaluator;
    let retention = ctx.retention;
    let mut out: Vec<Option<f64>> = Vec::with_capacity(count);
    let mut start = 0;
    while start < count {
        ctx.check_cancelled()?;
        let end = (start + chunk).min(count);
        let job = |state: &mut Option<Slope>, i: usize| -> Result<Option<f64>> {
            let slope = state.get_or_insert_with(|| sampler.slope().clone());
            let mut inner = RunCtx {
                progress: None,
                cancel,
                clock,
                // each sample's analysis serial: the samples are the parallel part
                evaluator: &crate::api::ctx::Serial,
                retention,
            };
            sampler.sample_on(slope, &values[start + i], &mut inner)
        };
        let part = evaluator.map_samples(end - start, &job as &SampleJob)?;
        out.extend(part);
        // (TypeScript reports after every 50th sample)
        if end % PROGRESS_SAMPLES == 0 {
            ctx.report(ProgressEvent::Reliability(end as f64 / n))?;
        }
        start = end;
    }
    Ok(out)
}

/// The critical surface of a result in model coordinates. `def` is the
/// model definition whose canonical form was analysed (a right-to-left
/// model is mirrored back).
pub fn reliability_surface_to_model_space(
    surface: &CriticalSurface,
    def: &SlopeDefinition,
) -> CriticalSurface {
    if resolve_orientation(def.orientation, &def.coordinates) != SlopeOrientation::Rtl {
        return surface.clone();
    }
    let [x_min, x_max] = get_domain_x(&def.coordinates);
    let m = |p: [f64; 2]| mirror_point(p, x_min, x_max);
    CriticalSurface {
        cx: mirror_x(surface.cx, x_min, x_max),
        cy: surface.cy,
        radius: surface.radius,
        lc: m(surface.lc),
        rc: m(surface.rc),
        points: surface
            .points
            .as_ref()
            .map(|ps| ps.iter().map(|&p| m(p)).collect()),
    }
}
