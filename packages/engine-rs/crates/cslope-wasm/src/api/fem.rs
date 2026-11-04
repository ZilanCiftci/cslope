//! Exports of `cslope_engine::fem` (the public API of
//! `packages/engine/src/fem/index.ts` and `fem/summary.ts`): the strength
//! reduction (`analyzeFem`), the bounds of limit analysis (`lowerBound`,
//! `upperBound`, `adaptiveBounds`) and the app's summary
//! (`runFemSummary`, `runFemSummaryWithBounds`). The facade shims are
//! `packages/engine/src/facade/fem/*.ts`.
//!
//! Conventions of the FE boundary (ARCHITECTURE.md §2.2, §3.1, §3.4):
//!
//! - **The slope** argument is the facade `Slope`'s handle (`{ $slope: h }`,
//!   the model facade's registry, [`with_slope`]).
//! - **Size fields** (TypeScript's `(x, y) => number` with `min`) are data
//!   (`SizeField`) in a registry of their own: a result's `sizeField` is a
//!   handle, which the facade wraps in a function (`size_field_at`), and an
//!   option's `sizeField` is passed as that handle. A JavaScript closure has
//!   no counterpart (PORTING.md, FE model).
//! - **Typed arrays**: the fields TypeScript holds as `Float64Array`,
//!   `Int32Array` or `Uint8Array` are built as such here (copies); metadata
//!   goes through serde.
//! - **Callbacks** (`onTrial`, `onLevel`, `onStage`) are JavaScript functions called
//!   from the run's progress (`RunCtx.progress`); an exception they throw
//!   stops the run and is rethrown unchanged.
//! - **Time** is `performance.now()` ([`PerfClock`]).

use crate::clock::WasmClock;
use crate::convert::{from_js, to_js};
use crate::errors::{js_error, to_js_error};
use crate::registry::{HandleError, Registry};
use cslope_engine::api::ctx::{Clock, ProgressEvent, RunCtx};
use cslope_engine::error::EngineError;
use cslope_engine::fem::analysis::{
    analyze_fem as engine_analyze_fem, FemAnalysisOptions, FemAnalysisResult,
};
use cslope_engine::fem::bound_adapt::{
    adaptive_bounds as engine_adaptive_bounds, AdaptiveBoundsOptions, AdaptiveBoundsResult,
};
use cslope_engine::fem::lower_bound::{lower_bound as engine_lower_bound, LowerBoundOptions};
use cslope_engine::fem::model::SizeField;
use cslope_engine::fem::summary::{
    run_fem_summary as engine_run_fem_summary,
    run_fem_summary_with_bounds as engine_run_fem_summary_with_bounds,
};
use cslope_engine::fem::upper_bound::{upper_bound as engine_upper_bound, UpperBoundResult};
use cslope_engine::model::slope::Slope;
use cslope_engine::types::{FemAnalysisSettings, SlopeDefinition};
use js_sys::{Float64Array, Function, Int32Array, Object, Reflect};
use std::cell::RefCell;
use std::ops::ControlFlow;
use std::sync::Arc;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

pub(crate) type JsResult<T> = Result<T, JsValue>;

// ── values ───────────────────────────────────────────────────────────────

/// A `Float64Array` copy of `v`.
pub(crate) fn f64s(v: &[f64]) -> JsValue {
    Float64Array::from(v).into()
}

/// An `Int32Array` copy of indices.
pub(crate) fn i32s_usize(v: &[usize]) -> JsValue {
    let t: Vec<i32> = v.iter().map(|&x| x as i32).collect();
    Int32Array::from(&t[..]).into()
}

/// A plain object under construction.
pub(crate) struct Obj(pub Object);

impl Obj {
    pub fn new() -> Self {
        Obj(Object::new())
    }
    pub fn set(&self, key: &str, value: impl Into<JsValue>) -> &Self {
        // (a new plain object's own field: setting it cannot fail)
        let _ = Reflect::set(&self.0, &JsValue::from_str(key), &value.into());
        self
    }
    pub fn js(self) -> JsValue {
        self.0.into()
    }
}

impl Default for Obj {
    fn default() -> Self {
        Self::new()
    }
}

/// Field `key` of a JavaScript object (undefined when absent or not an object).
pub(crate) fn field(v: &JsValue, key: &str) -> JsValue {
    if !v.is_object() && !v.is_function() {
        return JsValue::UNDEFINED;
    }
    Reflect::get(v, &JsValue::from_str(key)).unwrap_or(JsValue::UNDEFINED)
}

/// `None` for `undefined` and `null` (the testing dispatcher's helper).
#[cfg(feature = "testing")]
pub(crate) fn present(v: JsValue) -> Option<JsValue> {
    (!v.is_undefined() && !v.is_null()).then_some(v)
}

pub(crate) fn handle_error(e: HandleError) -> JsValue {
    js_error(&e.to_string())
}

// ── the clock ────────────────────────────────────────────────────────────

/// `performance.now()` as the engine's clock (read on each call, so that
/// the clock holds no JavaScript object and is `Sync`).
pub struct PerfClock;

impl Clock for PerfClock {
    fn now_ms(&self) -> f64 {
        WasmClock::new().now_ms()
    }
}

// ── slopes ───────────────────────────────────────────────────────────────

/// Runs `f` on the slope `arg` names: `{ $slope: handle }`, the model
/// facade's slope (taken out of its registry while `f` runs, so that `f` may
/// call JavaScript), or `{ $definition: def }`, built here.
pub(crate) fn with_slope<R>(arg: &JsValue, f: impl FnOnce(&Slope) -> JsResult<R>) -> JsResult<R> {
    let handle = field(arg, "$slope");
    match handle.as_f64() {
        Some(h) => slope_by_handle(h as u32, f),
        None => Err(js_error(
            "The finite element analysis needs a slope of the engine (buildSlope).",
        )),
    }
}

/// The model facade's slope behind a handle (crates/cslope-wasm/src/api/slope.rs,
/// the facade `Slope`'s `_h`), taken out of its slot while `f` runs (FE
/// progress callbacks call JavaScript).
fn slope_by_handle<R>(handle: u32, f: impl FnOnce(&Slope) -> JsResult<R>) -> JsResult<R> {
    crate::api::slope::with_slope_mut(handle, |s| f(s))?
}

// ── size fields ──────────────────────────────────────────────────────────

thread_local! {
    static SIZE_FIELDS: RefCell<Registry<Arc<SizeField>>> = const { RefCell::new(Registry::new()) };
}

/// Stores a size field and returns its handle.
pub(crate) fn size_field_new(sf: Arc<SizeField>) -> JsResult<u32> {
    SIZE_FIELDS.with(|r| r.borrow_mut().insert(sf).map_err(handle_error))
}

/// The size field behind a handle.
pub(crate) fn size_field_get(handle: u32) -> JsResult<Arc<SizeField>> {
    SIZE_FIELDS.with(|r| r.borrow().get(handle).cloned().map_err(handle_error))
}

/// A size field option: a handle, or none.
pub(crate) fn size_field_opt(handle: Option<u32>) -> JsResult<Option<Arc<SizeField>>> {
    handle.map(size_field_get).transpose()
}

/// The element size at (x, y) of a size field.
#[wasm_bindgen]
pub fn size_field_at(handle: u32, x: f64, y: f64) -> JsResult<f64> {
    Ok(size_field_get(handle)?.at(x, y))
}

/// Its smallest value, when known (undefined otherwise).
#[wasm_bindgen]
pub fn size_field_min(handle: u32) -> JsResult<Option<f64>> {
    Ok(size_field_get(handle)?.min())
}

#[wasm_bindgen]
pub fn size_field_free(handle: u32) -> bool {
    SIZE_FIELDS.with(|r| r.borrow_mut().remove(handle))
}

/// Live size field handles (for the facade's leak test).
#[wasm_bindgen]
pub fn size_field_count() -> usize {
    SIZE_FIELDS.with(|r| r.borrow().len())
}

/// A constant size field (`() => value`, with `min` when given): the
/// one closure the facade can turn into data.
#[wasm_bindgen]
pub fn size_field_constant(value: f64, min: Option<f64>) -> JsResult<u32> {
    size_field_new(Arc::new(SizeField::Constant { value, min }))
}

// ── progress ─────────────────────────────────────────────────────────────

/// The JavaScript callbacks of a run, and the exception one of them threw.
#[derive(Default)]
pub(crate) struct Callbacks {
    pub on_trial: Option<Function>,
    pub on_level: Option<Function>,
    /// The stages of the finite element analysis (`FemStage`), progress only.
    pub on_stage: Option<Function>,
    pub thrown: RefCell<Option<JsValue>>,
}

impl Callbacks {
    pub fn new(on_trial: Option<Function>, on_level: Option<Function>) -> Self {
        Callbacks {
            on_trial,
            on_level,
            on_stage: None,
            thrown: RefCell::new(None),
        }
    }

    /// The same with a callback for the stages.
    pub fn with_stage(mut self, on_stage: Option<Function>) -> Self {
        self.on_stage = on_stage;
        self
    }

    fn call(&self, f: &Function, arg: JsResult<JsValue>) -> ControlFlow<()> {
        let r = arg.and_then(|a| f.call1(&JsValue::UNDEFINED, &a));
        match r {
            Ok(_) => ControlFlow::Continue(()),
            Err(e) => {
                *self.thrown.borrow_mut() = Some(e);
                ControlFlow::Break(())
            }
        }
    }

    /// The progress function of `RunCtx`.
    pub fn progress(&self, event: ProgressEvent) -> ControlFlow<()> {
        match event {
            ProgressEvent::FemTrial(t) => match &self.on_trial {
                Some(f) => self.call(f, to_js(&t)),
                None => ControlFlow::Continue(()),
            },
            ProgressEvent::Bounds(level) => match &self.on_level {
                Some(f) => self.call(f, to_js(&level)),
                None => ControlFlow::Continue(()),
            },
            ProgressEvent::FemStage(stage) => match &self.on_stage {
                Some(f) => self.call(f, to_js(&stage)),
                None => ControlFlow::Continue(()),
            },
            _ => ControlFlow::Continue(()),
        }
    }

    /// An engine error as a JavaScript one, or the callback's own exception
    /// when one stopped the run.
    pub fn error(&self, e: EngineError) -> JsValue {
        self.thrown
            .borrow_mut()
            .take()
            .unwrap_or_else(|| to_js_error(&e))
    }
}

/// Runs `f` with a `RunCtx` on `performance.now()` whose progress calls
/// the callbacks.
pub(crate) fn run_with<R>(
    callbacks: &Callbacks,
    f: impl FnOnce(&mut RunCtx) -> Result<R, EngineError>,
) -> JsResult<R> {
    let mut progress = |e: ProgressEvent| callbacks.progress(e);
    let mut ctx = RunCtx {
        progress: Some(&mut progress),
        clock: &PerfClock,
        ..RunCtx::default()
    };
    let r = f(&mut ctx);
    r.map_err(|e| callbacks.error(e))
}

fn function_opt(v: JsValue) -> Option<Function> {
    v.dyn_into::<Function>().ok()
}

// ── results ──────────────────────────────────────────────────────────────

fn opt_num(v: Option<f64>) -> JsValue {
    v.map(JsValue::from_f64).unwrap_or(JsValue::NULL)
}

/// `FemAnalysisResult` with its typed arrays and its size field as a handle.
fn fem_result_js(r: &FemAnalysisResult) -> JsResult<JsValue> {
    let mesh = Obj::new();
    mesh.set("x", f64s(&r.mesh.x))
        .set("y", f64s(&r.mesh.y))
        .set("triangles", i32s_usize(&r.mesh.triangles))
        .set("elementMaterial", i32s_usize(&r.mesh.element_material))
        .set("materialNames", to_js(&r.mesh.material_names)?);
    let o = Obj::new();
    o.set("factorOfSafety", r.factor_of_safety)
        .set("failedF", r.failed_f)
        .set("displacementJumpF", opt_num(r.displacement_jump_f))
        .set("trials", to_js(&r.trials)?)
        .set("iterations", r.iterations as f64)
        .set("warnings", to_js(&r.warnings)?)
        .set("mesh", mesh.js())
        .set("displacement", f64s(&r.displacement))
        .set("plasticShearStrain", f64s(&r.plastic_shear_strain))
        .set("shearStrainIncrement", f64s(&r.shear_strain_increment))
        .set("levels", to_js(&r.levels)?)
        .set("piles", to_js(&r.piles)?)
        .set("sizeField", size_field_new(Arc::clone(&r.size_field))?)
        .set("elapsedMs", r.elapsed_ms);
    Ok(o.js())
}

/// `UpperBoundResult` with the mechanism's typed arrays.
fn upper_result_js(r: &UpperBoundResult) -> JsResult<JsValue> {
    let v = to_js(r)?;
    if let Some(m) = &r.mechanism {
        let o = Obj::new();
        o.set("x", f64s(&m.x))
            .set("y", f64s(&m.y))
            .set("el", i32s_usize(&m.el))
            .set("velocity", f64s(&m.velocity));
        let _ = Reflect::set(&v, &JsValue::from_str("mechanism"), &o.js());
    }
    Ok(v)
}

/// `AdaptiveBoundsResult` with its size field as a handle.
fn adaptive_result_js(r: &AdaptiveBoundsResult) -> JsResult<JsValue> {
    let o = Obj::new();
    o.set("lower", r.lower)
        .set("upper", r.upper)
        .set("levels", to_js(&r.levels)?)
        .set("sizeField", size_field_new(Arc::clone(&r.size_field))?)
        .set("warnings", to_js(&r.warnings)?);
    Ok(o.js())
}

// ── the exports ──────────────────────────────────────────────────────────

/// `analyzeFem(slope, options)`; `size_field` is the handle of
/// `options.sizeField`, `on_trial` its `onTrial`.
#[wasm_bindgen]
pub fn analyze_fem(
    slope: JsValue,
    options: JsValue,
    size_field: Option<u32>,
    on_trial: JsValue,
) -> JsResult<JsValue> {
    let mut o: FemAnalysisOptions = from_js(options, "options")?;
    o.model.size_field = size_field_opt(size_field)?;
    let cb = Callbacks::new(function_opt(on_trial), None);
    let r = with_slope(&slope, |s| {
        run_with(&cb, |ctx| engine_analyze_fem(s, &o, ctx))
    })?;
    fem_result_js(&r)
}

/// `lowerBound(slope, options)`.
#[wasm_bindgen]
pub fn lower_bound(slope: JsValue, options: JsValue, size_field: Option<u32>) -> JsResult<JsValue> {
    let mut o: LowerBoundOptions = from_js(options, "options")?;
    o.model.size_field = size_field_opt(size_field)?;
    let cb = Callbacks::default();
    let r = with_slope(&slope, |s| {
        run_with(&cb, |ctx| engine_lower_bound(s, &o, ctx))
    })?;
    to_js(&r)
}

/// `upperBound(slope, options)`.
#[wasm_bindgen]
pub fn upper_bound(slope: JsValue, options: JsValue, size_field: Option<u32>) -> JsResult<JsValue> {
    let mut o: LowerBoundOptions = from_js(options, "options")?;
    o.model.size_field = size_field_opt(size_field)?;
    let cb = Callbacks::default();
    let r = with_slope(&slope, |s| {
        run_with(&cb, |ctx| engine_upper_bound(s, &o, ctx))
    })?;
    upper_result_js(&r)
}

/// `adaptiveBounds(slope, options)`; `on_level` is `options.onLevel`.
#[wasm_bindgen]
pub fn adaptive_bounds(
    slope: JsValue,
    options: JsValue,
    size_field: Option<u32>,
    on_level: JsValue,
) -> JsResult<JsValue> {
    let mut o: AdaptiveBoundsOptions = from_js(options, "options")?;
    o.bounds.model.size_field = size_field_opt(size_field)?;
    let cb = Callbacks::new(None, function_opt(on_level));
    let r = with_slope(&slope, |s| {
        run_with(&cb, |ctx| engine_adaptive_bounds(s, &o, ctx))
    })?;
    adaptive_result_js(&r)
}

/// `runFemSummary(definition, settings, onTrial, onStage)`.
#[wasm_bindgen]
pub fn run_fem_summary(
    definition: JsValue,
    settings: JsValue,
    on_trial: JsValue,
    on_stage: JsValue,
) -> JsResult<JsValue> {
    let def: SlopeDefinition = from_js(definition, "slope definition")?;
    let settings: FemAnalysisSettings = from_js(settings, "settings")?;
    let cb = Callbacks::new(function_opt(on_trial), None).with_stage(function_opt(on_stage));
    let r = run_with(&cb, |ctx| engine_run_fem_summary(&def, &settings, ctx))?;
    to_js(&r)
}

/// `runFemSummaryWithBounds(definition, settings, onTrial, onStage)`
/// (Clarabel is linked in: the facade's `solvers` loader is not called).
#[wasm_bindgen]
pub fn run_fem_summary_with_bounds(
    definition: JsValue,
    settings: JsValue,
    on_trial: JsValue,
    on_stage: JsValue,
) -> JsResult<JsValue> {
    let def: SlopeDefinition = from_js(definition, "slope definition")?;
    let settings: FemAnalysisSettings = from_js(settings, "settings")?;
    let cb = Callbacks::new(function_opt(on_trial), None).with_stage(function_opt(on_stage));
    let r = run_with(&cb, |ctx| {
        engine_run_fem_summary_with_bounds(&def, &settings, ctx)
    })?;
    to_js(&r)
}

/// The engine's values of the FE modules' data constants, which the facade
/// keeps as TypeScript (its test compares them).
#[wasm_bindgen]
pub fn fem_constants() -> JsResult<JsValue> {
    use cslope_engine::fem::{analysis, elements, limit_common, model, piles};
    let o = Obj::new();
    o.set("GP_STRIDE", elements::GP_STRIDE as f64)
        .set("GAUSS_T6", to_js(&elements::GAUSS_T6)?)
        .set("BAR_GP_STRIDE", model::BAR_GP_STRIDE as f64)
        .set("DEFAULT_YOUNGS_MODULUS", model::DEFAULT_YOUNGS_MODULUS)
        .set("DEFAULT_PERMEABILITY", model::DEFAULT_PERMEABILITY)
        .set("DEFAULT_POISSONS_RATIO", model::DEFAULT_POISSONS_RATIO)
        .set(
            "DEFAULT_REINFORCEMENT_STIFFNESS",
            model::DEFAULT_REINFORCEMENT_STIFFNESS,
        )
        .set("PILE_DEFAULT_E", piles::PILE_DEFAULT_E)
        .set("NO_YIELD", piles::NO_YIELD)
        .set(
            "DEFAULT_TRIALS_PER_ROUND",
            analysis::DEFAULT_TRIALS_PER_ROUND,
        )
        .set("WEIGHT_POINTS", to_js(&*limit_common::WEIGHT_POINTS)?);
    Ok(o.js())
}
