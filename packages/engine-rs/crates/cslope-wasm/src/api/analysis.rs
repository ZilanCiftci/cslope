//! Searches as steps, reliability, the optimisation with a JavaScript
//! evaluate function, and the product path (`runAnalysis`), for the facade
//! (TypeScript `src/model/solvers.ts` `analyseSlopeSteps`, `steps.ts`,
//! `optimize.ts`, `block-search.ts`, `reliability.ts`, `api/run-analysis.ts`).
//!
//! Steps cross as a handle: the facade's generator resumes the engine's
//! state machine, yields each batch to the driver (which evaluates it, in
//! JavaScript or on a pool of workers) and hands the evaluated planes back
//! on the next resume. A reliability analysis's slope to analyse is moved
//! into the slope registry while JavaScript analyses it.

use crate::api::model::{call, js_to_engine};
use crate::api::slope::{insert_slope, remove_slope, with_slope, with_slope_mut};
use crate::api::wire::{planes_from_js, planes_to_js};
use crate::convert::{from_js, to_js};
use crate::errors::{js_error, IntoJsResult};
use crate::registry::Registry;
use cslope_engine::api::ctx::{Clock, ProgressEvent, RunCtx};
use cslope_engine::api::run_analysis as ra;
use cslope_engine::error::Result as EngineResult;
use cslope_engine::model::block_search::{block_search, block_search_steps};
use cslope_engine::model::optimize::{
    optimise_non_circular, optimise_non_circular_steps_with, optimise_polylines,
    optimise_polylines_steps_with, OptimiseOptions,
};
use cslope_engine::model::reliability as rel;
use cslope_engine::model::search::set_entry_exit_planes;
use cslope_engine::model::slope::{AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::model::solvers::AnalyseSlopeSteps;
use cslope_engine::model::steps::{BoxedSteps, PlaneSteps, Step};
use cslope_engine::types::{SearchMethod, SlopeDefinition};
use js_sys::Function;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::ops::ControlFlow;
use wasm_bindgen::prelude::*;

type JsResult<T> = Result<T, JsValue>;

/// `performance.now()` for the engine's clock (wasm is single-threaded).
struct JsClock;

impl Clock for JsClock {
    fn now_ms(&self) -> f64 {
        crate::clock::WasmClock::new().now_ms()
    }
}

// ── a JavaScript evaluate function ───────────────────────────────

/// `bridge(planes) => planes`: the facade's adapter around the caller's
/// evaluate function (it maps the materials and writes the result back).
fn js_evaluate(
    bridge: &Function,
) -> impl FnMut(&Slope, &mut [SearchPlane]) -> EngineResult<()> + '_ {
    move |_, planes| {
        let js = planes_to_js(planes).map_err(js_to_engine)?;
        let out = call(bridge, &[js]).map_err(js_to_engine)?;
        let back = planes_from_js(out).map_err(js_to_engine)?;
        for (p, b) in planes.iter_mut().zip(back) {
            *p = b;
        }
        Ok(())
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct OptimiseOptionsDto {
    #[serde(default)]
    budget_per_seed: Option<f64>,
}

fn optimise_options(v: JsValue) -> JsResult<OptimiseOptions> {
    let o: Option<OptimiseOptionsDto> = from_js(v, "optimise options")?;
    Ok(OptimiseOptions {
        budget_per_seed: o.and_then(|o| o.budget_per_seed),
    })
}

#[wasm_bindgen]
pub fn optimise_non_circular_with(
    handle: u32,
    evaluated: JsValue,
    bridge: &Function,
    options: JsValue,
) -> JsResult<JsValue> {
    let e = planes_from_js(evaluated)?;
    let o = optimise_options(options)?;
    let r = with_slope(handle, |s| {
        optimise_non_circular(s, &e, js_evaluate(bridge), o)
    })?
    .js()?;
    planes_to_js(&r)
}

#[wasm_bindgen]
pub fn optimise_polylines_with(
    handle: u32,
    seeds: JsValue,
    bridge: &Function,
    options: JsValue,
) -> JsResult<JsValue> {
    let seeds = planes_from_js(seeds)?;
    let o = optimise_options(options)?;
    let r = with_slope(handle, |s| {
        optimise_polylines(s, seeds, js_evaluate(bridge), o)
    })?
    .js()?;
    planes_to_js(&r)
}

#[wasm_bindgen]
pub fn block_search_with(handle: u32, bridge: &Function) -> JsResult<JsValue> {
    let r = with_slope(handle, |s| block_search(s, js_evaluate(bridge)))?.js()?;
    planes_to_js(&r)
}

// ── steps ────────────────────────────────────────────────────────

enum Kind {
    /// analyseSlopeSteps: sets the results on the slope at the end.
    Analyse(AnalyseSlopeSteps),
    /// A search returning planes (block search, optimisation).
    Planes(BoxedSteps<Vec<SearchPlane>>),
}

struct StepsEntry {
    slope: u32,
    kind: Kind,
}

thread_local! {
    static STEPS: RefCell<Registry<StepsEntry>> = const { RefCell::new(Registry::new()) };
}

fn steps_insert(e: StepsEntry) -> JsResult<u32> {
    STEPS.with(|r| {
        r.borrow_mut()
            .insert(e)
            .map_err(|e| js_error(&e.to_string()))
    })
}

/// `analyseSlopeSteps(slope)`: generates the search planes first, as the
/// TypeScript generator does before its first yield.
#[wasm_bindgen]
pub fn analyse_steps_new(handle: u32) -> JsResult<u32> {
    with_slope_mut(handle, |s| {
        let block = s.search_method() == SearchMethod::Block && !s.custom_planes_only();
        if s.search().is_empty() && !s.custom_planes_only() && !block {
            set_entry_exit_planes(s)?;
        }
        Ok(())
    })?
    .js()?;
    steps_insert(StepsEntry {
        slope: handle,
        kind: Kind::Analyse(AnalyseSlopeSteps::new()),
    })
}

#[wasm_bindgen]
pub fn block_search_steps_new(handle: u32) -> JsResult<u32> {
    let s = with_slope(handle, block_search_steps)?.js()?;
    steps_insert(StepsEntry {
        slope: handle,
        kind: Kind::Planes(s),
    })
}

#[wasm_bindgen]
pub fn optimise_non_circular_steps_new(
    handle: u32,
    evaluated: JsValue,
    options: JsValue,
) -> JsResult<u32> {
    let e = planes_from_js(evaluated)?;
    let o = optimise_options(options)?;
    let s = with_slope(handle, |s| optimise_non_circular_steps_with(s, &e, o))?.js()?;
    steps_insert(StepsEntry {
        slope: handle,
        kind: Kind::Planes(s),
    })
}

#[wasm_bindgen]
pub fn optimise_polylines_steps_new(
    handle: u32,
    seeds: JsValue,
    options: JsValue,
) -> JsResult<u32> {
    let seeds = planes_from_js(seeds)?;
    let o = optimise_options(options)?;
    let s = optimise_polylines_steps_with(seeds, o).js()?;
    steps_insert(StepsEntry {
        slope: handle,
        kind: Kind::Planes(s),
    })
}

#[wasm_bindgen]
pub fn steps_free(handle: u32) -> bool {
    STEPS.with(|r| {
        r.try_borrow_mut()
            .map(|mut r| r.remove(handle))
            .unwrap_or(false)
    })
}

struct StepOut {
    done: bool,
    batch: Option<JsValue>,
    planes: Option<JsValue>,
    fos: Option<Option<f64>>,
}

impl StepOut {
    fn to_js(&self) -> JsResult<JsValue> {
        let o = js_sys::Object::new();
        js_sys::Reflect::set(&o, &"done".into(), &JsValue::from_bool(self.done))?;
        if let Some(b) = &self.batch {
            js_sys::Reflect::set(&o, &"batch".into(), b)?;
        }
        if let Some(p) = &self.planes {
            js_sys::Reflect::set(&o, &"planes".into(), p)?;
        }
        if let Some(f) = self.fos {
            js_sys::Reflect::set(&o, &"fos".into(), &to_js(&f)?)?;
        }
        Ok(o.into())
    }
}

/// Resumes the steps: `evaluated` is the last batch as the driver
/// evaluated it (undefined on the first call). Returns `{ done: false,
/// batch }` or `{ done: true, fos }` (analyseSlopeSteps, the results set on
/// the slope) / `{ done: true, planes }`.
#[wasm_bindgen]
pub fn steps_resume(handle: u32, evaluated: JsValue) -> JsResult<JsValue> {
    let mut back = if evaluated.is_undefined() || evaluated.is_null() {
        None
    } else {
        Some(planes_from_js(evaluated)?)
    };
    let analyse = STEPS.with(|r| {
        r.borrow()
            .get(handle)
            .map(|e| matches!(e.kind, Kind::Analyse(_)))
            .unwrap_or(false)
    });
    // analyseSlopeSteps keeps the critical slices only, as analyse_slope
    if analyse {
        for p in back.iter_mut().flatten() {
            p.slices = None;
        }
    }
    let mut entry = STEPS.with(|r| {
        r.borrow_mut()
            .take(handle)
            .map_err(|e| js_error(&e.to_string()))
    })?;
    let out = resume(&mut entry, back);
    STEPS.with(|r| r.borrow_mut().put_back(handle, entry));
    out?.to_js()
}

fn resume(entry: &mut StepsEntry, back: Option<Vec<SearchPlane>>) -> JsResult<StepOut> {
    fn step<S: PlaneSteps + ?Sized>(
        steps: &mut S,
        slope: u32,
        back: Option<Vec<SearchPlane>>,
    ) -> JsResult<Step<S::Output>> {
        if let Some(b) = back {
            *steps.batch() = b;
        }
        let r = with_slope(slope, |s| steps.resume(s))?.js()?;
        Ok(r)
    }
    let slope = entry.slope;
    match &mut entry.kind {
        Kind::Analyse(s) => match step(s, slope, back)? {
            Step::Batch(_) => Ok(StepOut {
                done: false,
                batch: Some(planes_to_js(s.batch())?),
                planes: None,
                fos: None,
            }),
            Step::Done(planes) => {
                let best = planes.iter().find_map(|p| p.fos);
                with_slope_mut(slope, |sl| {
                    sl.set_search_results(planes);
                    cslope_engine::model::solvers::restore_critical_slices(sl)
                })?
                .js()?;
                crate::api::slope::mark_slices_dropped(slope);
                Ok(StepOut {
                    done: true,
                    batch: None,
                    planes: None,
                    fos: Some(best),
                })
            }
        },
        Kind::Planes(s) => match step(s, slope, back)? {
            Step::Batch(_) => Ok(StepOut {
                done: false,
                batch: Some(planes_to_js(s.batch())?),
                planes: None,
                fos: None,
            }),
            Step::Done(planes) => Ok(StepOut {
                done: true,
                batch: None,
                planes: Some(planes_to_js(&planes)?),
                fos: None,
            }),
        },
    }
}

// ── reliability ──────────────────────────────────────────────────

fn reliability_args(
    def: JsValue,
    options: JsValue,
    variables: JsValue,
    ro: JsValue,
) -> JsResult<(
    SlopeDefinition,
    AnalysisOptionsPatch,
    Vec<rel::RandomVariable>,
    rel::ReliabilityOptions,
)> {
    Ok((
        from_js(def, "slope definition")?,
        from_js::<Option<AnalysisOptionsPatch>>(options, "analysis options")?.unwrap_or_default(),
        from_js(variables, "random variables")?,
        from_js(ro, "reliability options")?,
    ))
}

/// `analyseReliability(def, options, variables, ro)`; `on_progress` is
/// `ro.onProgress`.
#[wasm_bindgen]
pub fn analyse_reliability(
    def: JsValue,
    options: JsValue,
    variables: JsValue,
    ro: JsValue,
    on_progress: Option<Function>,
) -> JsResult<JsValue> {
    let (def, options, vars, ro) = reliability_args(def, options, variables, ro)?;
    let error: RefCell<Option<JsValue>> = RefCell::new(None);
    let mut progress = |e: ProgressEvent| {
        if let (ProgressEvent::Reliability(p), Some(f)) = (e, on_progress.as_ref()) {
            if let Err(err) = f.call1(&JsValue::NULL, &JsValue::from_f64(p)) {
                error.borrow_mut().get_or_insert(err);
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    };
    let mut ctx = RunCtx {
        progress: if on_progress.is_some() {
            Some(&mut progress)
        } else {
            None
        },
        ..RunCtx::default()
    };
    let r = rel::analyse_reliability(&def, &options, &vars, &ro, &mut ctx);
    if let Some(e) = error.take() {
        return Err(e);
    }
    to_js(&r.js()?)
}

#[wasm_bindgen]
pub fn normal_cdf(x: f64) -> f64 {
    rel::normal_cdf(x)
}

#[wasm_bindgen]
pub fn lognormal_beta(f: f64, cov: f64) -> f64 {
    rel::lognormal_beta(f, cov)
}

#[wasm_bindgen]
pub fn reliability_surface_to_model_space(surface: JsValue, def: JsValue) -> JsResult<JsValue> {
    let s: rel::CriticalSurface = from_js(surface, "surface")?;
    let d: SlopeDefinition = from_js(def, "slope definition")?;
    to_js(&rel::reliability_surface_to_model_space(&s, &d))
}

struct RelEntry {
    steps: rel::ReliabilitySteps,
    /// The slope handed to JavaScript to analyse (its handle).
    out: Option<u32>,
    /// A copy of the sampler's slope for samples evaluated here.
    sample_slope: Option<Slope>,
}

thread_local! {
    static RELIABILITY: RefCell<Registry<RelEntry>> = const { RefCell::new(Registry::new()) };
    static SAMPLERS: RefCell<Registry<rel::MonteCarloSampler>> = const { RefCell::new(Registry::new()) };
}

#[wasm_bindgen]
pub fn reliability_steps_new(
    def: JsValue,
    options: JsValue,
    variables: JsValue,
    ro: JsValue,
) -> JsResult<u32> {
    let (def, options, vars, ro) = reliability_args(def, options, variables, ro)?;
    RELIABILITY.with(|r| {
        r.borrow_mut()
            .insert(RelEntry {
                steps: rel::ReliabilitySteps::new(&def, &options, &vars, &ro),
                out: None,
                sample_slope: None,
            })
            .map_err(|e| js_error(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn reliability_steps_free(handle: u32) -> bool {
    let e = RELIABILITY.with(|r| {
        let mut r = r.borrow_mut();
        let e = r.take(handle).ok();
        r.remove(handle);
        e
    });
    if let Some(slope) = e.and_then(|e| e.out) {
        let _ = remove_slope(slope);
    }
    true
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RelStepOut {
    kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    slope: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    values: Option<Vec<Vec<f64>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    def: Option<SlopeDefinition>,
    #[serde(skip_serializing_if = "Option::is_none")]
    count: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<rel::ReliabilityResult>,
}

/// Resumes a reliability analysis: `factors` are the samples' factors
/// after a samples step. Returns `{ kind: "analyse", slope }` (a slope
/// handle to analyse, given back on the next resume), `{ kind: "samples",
/// values, def, count }` or `{ kind: "done", result }`, with the progress
/// reached since the last step.
#[wasm_bindgen]
pub fn reliability_steps_resume(handle: u32, factors: JsValue) -> JsResult<JsValue> {
    let factors: Option<Vec<Option<f64>>> = from_js(factors, "factors")?;
    let mut e = RELIABILITY.with(|r| {
        r.borrow_mut()
            .take(handle)
            .map_err(|e| js_error(&e.to_string()))
    })?;
    let out = rel_resume(&mut e, factors);
    RELIABILITY.with(|r| r.borrow_mut().put_back(handle, e));
    to_js(&out?)
}

fn rel_resume(e: &mut RelEntry, factors: Option<Vec<Option<f64>>>) -> JsResult<RelStepOut> {
    if let Some(h) = e.out.take() {
        *e.steps.slope_mut() = remove_slope(h)?;
    }
    let step = e.steps.resume(factors).js()?;
    let progress = e.steps.take_progress();
    let mut out = RelStepOut {
        kind: "done",
        progress,
        slope: None,
        values: None,
        def: None,
        count: None,
        result: None,
    };
    match step {
        rel::ReliabilityStep::Done(r) => out.result = Some(*r),
        rel::ReliabilityStep::Analyse => {
            let slope = std::mem::take(e.steps.slope_mut());
            let h = insert_slope(slope)?;
            e.out = Some(h);
            out.kind = "analyse";
            out.slope = Some(h);
            out.def = e.steps.analysed_definition().cloned();
        }
        rel::ReliabilityStep::Samples => {
            out.kind = "samples";
            out.values = Some(e.steps.samples().1.to_vec());
            out.def = e.steps.samples_definition();
            out.count = Some(e.steps.sample_count());
            e.sample_slope = None;
        }
    }
    Ok(out)
}

/// F of one set of values of the samples step out (the step's sampler).
#[wasm_bindgen]
pub fn reliability_steps_sample(handle: u32, values: &[f64]) -> JsResult<Option<f64>> {
    let mut e = RELIABILITY.with(|r| {
        r.borrow_mut()
            .take(handle)
            .map_err(|e| js_error(&e.to_string()))
    })?;
    let r = {
        let (sampler, _) = e.steps.samples();
        let slope = e
            .sample_slope
            .get_or_insert_with(|| sampler.slope().clone());
        sampler.sample_on(slope, values, &mut RunCtx::default())
    };
    RELIABILITY.with(|r| r.borrow_mut().put_back(handle, e));
    r.js()
}

#[wasm_bindgen]
pub fn monte_carlo_sampler_new(
    def: JsValue,
    options: JsValue,
    variables: JsValue,
) -> JsResult<u32> {
    let def: SlopeDefinition = from_js(def, "slope definition")?;
    let options: AnalysisOptionsPatch =
        from_js::<Option<_>>(options, "analysis options")?.unwrap_or_default();
    let vars: Vec<rel::RandomVariable> = from_js(variables, "random variables")?;
    let s = rel::MonteCarloSampler::new(&def, &options, &vars).js()?;
    SAMPLERS.with(|r| {
        r.borrow_mut()
            .insert(s)
            .map_err(|e| js_error(&e.to_string()))
    })
}

#[wasm_bindgen]
pub fn monte_carlo_sampler_free(handle: u32) -> bool {
    SAMPLERS.with(|r| {
        r.try_borrow_mut()
            .map(|mut r| r.remove(handle))
            .unwrap_or(false)
    })
}

#[wasm_bindgen]
pub fn monte_carlo_sample(handle: u32, values: &[f64]) -> JsResult<Option<f64>> {
    SAMPLERS.with(|r| {
        let mut r = r.borrow_mut();
        let s = r.get_mut(handle).map_err(|e| js_error(&e.to_string()))?;
        s.sample(values, &mut RunCtx::default()).js()
    })
}

// ── the product path ─────────────────────────────────────────────

/// `runAnalysis(def, options, { onProgress })`: `on_progress` gets the
/// surfaces evaluated so far in the direction analysed.
#[wasm_bindgen]
pub fn run_analysis(
    def: JsValue,
    options: JsValue,
    on_progress: Option<Function>,
) -> JsResult<JsValue> {
    let def: SlopeDefinition = from_js(def, "slope definition")?;
    let options: AnalysisOptionsPatch = from_js(options, "analysis options")?;
    let error: RefCell<Option<JsValue>> = RefCell::new(None);
    let mut progress = |e: ProgressEvent| {
        if let (ProgressEvent::Search { done, .. }, Some(f)) = (e, on_progress.as_ref()) {
            if let Err(err) = f.call1(&JsValue::NULL, &JsValue::from_f64(done as f64)) {
                error.borrow_mut().get_or_insert(err);
                return ControlFlow::Break(());
            }
        }
        ControlFlow::Continue(())
    };
    let clock = JsClock;
    // (the product path: the critical slices only, as the app's worker)
    let mut ctx = RunCtx {
        retention: cslope_engine::api::ctx::SliceRetention::Critical,
        progress: if on_progress.is_some() {
            Some(&mut progress)
        } else {
            None
        },
        clock: &clock,
        ..RunCtx::default()
    };
    let r = ra::run_analysis(&def, &options, &mut ctx);
    if let Some(e) = error.take() {
        return Err(e);
    }
    to_js(&r.js()?)
}

/// `analysisResult(slope, minFOS, options, start)`: `elapsed_ms` is the
/// time since `start`.
#[wasm_bindgen]
pub fn analysis_result(
    handle: u32,
    min_fos: Option<f64>,
    options: JsValue,
    elapsed_ms: f64,
) -> JsResult<JsValue> {
    let options: AnalysisOptionsPatch = from_js(options, "analysis options")?;
    let dropped = crate::api::slope::slices_dropped(handle);
    let r = with_slope_mut(handle, |s| {
        ra::analysis_result(s, min_fos, &options, elapsed_ms)
    })?
    .js()?;
    // (it writes the critical slices' flags, without a new version; the
    // other planes are as they were)
    crate::api::slope::touch(handle);
    if dropped {
        crate::api::slope::mark_slices_dropped(handle);
    }
    to_js(&r)
}

#[wasm_bindgen]
pub fn ray_to_ground(ground: JsValue, x0: f64, y0: f64, dx: f64, dy: f64) -> JsResult<JsValue> {
    let g: cslope_engine::model::geometry_ops::Polyline = from_js(ground, "ground")?;
    to_js(&cslope_engine::model::optimize::ray_to_ground(
        &g, x0, y0, dx, dy,
    ))
}

#[wasm_bindgen]
pub fn display_points(plane: JsValue) -> JsResult<JsValue> {
    let p = crate::api::slope::plane_in(plane)?;
    to_js(&ra::display_points(&p))
}
