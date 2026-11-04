//! Internal functions of the limit equilibrium model for the testing build
//! (the second half of [`crate::testing`]'s dispatch): the search's plane
//! generators, the solvers' slice arrays and the march solver.
//!
//! A slope argument is `{ $slope: handle }`. The slice arrays of
//! `getSlicePropertyArrays` stay in the engine: the facade gets
//! `{ $arrays: handle }`, opaque as the tests use it.

use crate::api::model::{mp_tuple, result_with_slices};
use crate::api::slope::with_slope;
use crate::api::wire::{planes_from_js, planes_to_js, slices_from_js};
use crate::convert::{from_js, to_js};
use crate::errors::IntoJsResult;
use crate::registry::Registry;
use cslope_engine::model::mp_march as mp;
use cslope_engine::model::search;
use cslope_engine::model::solvers::{get_slice_property_arrays, SliceArrays};
use cslope_engine::types::IntersliceFunctionType;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashSet;
use std::sync::atomic::Ordering;
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

type JsResult<T> = Result<T, JsValue>;
type Pt = [f64; 2];

pub const TEST_FUNCTIONS: &[&str] = &[
    "model/solvers::getSlicePropertyArrays",
    "model/mp-march::march",
    "model/mp-march::forceBand",
    "model/mp-march::solveForceF",
    "model/mp-march::solveMorgensternPriceMarch",
    "model/mp-march::solveMorgensternPriceFast",
    "model/mp-march::setMarchSearchOptions",
    "model/mp-march::analyseMorgensternPriceMarch",
    "model/mp-march::marchCount",
    "model/search::generateRefinedPlanes",
    "model/search::generateLocalPlanes",
];

thread_local! {
    static ARRAYS: RefCell<Registry<SliceArrays>> = const { RefCell::new(Registry::new()) };
}

#[derive(Deserialize)]
struct SlopeRef {
    #[serde(rename = "$slope")]
    slope: u32,
}

#[derive(Deserialize, Serialize)]
struct ArraysRef {
    #[serde(rename = "$arrays")]
    arrays: u32,
}

fn args<T: DeserializeOwned>(value: JsValue, name: &str) -> JsResult<T> {
    from_js(value, &format!("{name} arguments"))
}

fn with_arrays<R>(r: &ArraysRef, f: impl FnOnce(&SliceArrays) -> R) -> JsResult<R> {
    ARRAYS.with(|a| {
        let a = a.borrow();
        let p = a
            .get(r.arrays)
            .map_err(|e| crate::errors::js_error(&e.to_string()))?;
        Ok(f(p))
    })
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct MarchOptionsDto {
    lambda_max: Option<f64>,
    lambda_min: Option<f64>,
    lambda_step: Option<f64>,
    rule: Option<String>,
    scan_only: Option<bool>,
    min_denominator: Option<f64>,
}

impl From<MarchOptionsDto> for mp::MpMarchOptions {
    fn from(o: MarchOptionsDto) -> Self {
        mp::MpMarchOptions {
            lambda_max: o.lambda_max,
            lambda_min: o.lambda_min,
            lambda_step: o.lambda_step,
            rule: o.rule.map(|r| match r.as_str() {
                "largest" => mp::RootRule::Largest,
                "smallest" => mp::RootRule::Smallest,
                _ => mp::RootRule::NearestZero,
            }),
            scan_only: o.scan_only,
            min_denominator: o.min_denominator,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarchDto {
    gf: f64,
    gm: f64,
    f_scale: f64,
    m_scale: f64,
    #[serde(rename = "N")]
    n: Vec<f64>,
    #[serde(rename = "E")]
    e: Vec<f64>,
    #[serde(rename = "X")]
    x: Vec<f64>,
    min_denom: f64,
    out_of_band: usize,
    negative_n: usize,
    max_z_over_load: f64,
    undrained: Vec<u8>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RootDto {
    lambda: f64,
    #[serde(rename = "F")]
    f: f64,
    negative_n: usize,
    max_z_over_load: f64,
    min_denom: f64,
}

fn root(r: &mp::MpRoot) -> RootDto {
    RootDto {
        lambda: r.lambda,
        f: r.f,
        negative_n: r.negative_n,
        max_z_over_load: r.max_z_over_load,
        min_denom: r.min_denom,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MarchResultDto {
    roots: Vec<RootDto>,
    rejected: Vec<RootDto>,
    newton: Option<RootDto>,
    chosen: Option<RootDto>,
    holes: usize,
    multi_ff: usize,
    evaluations: usize,
}

fn march_result(r: &mp::MpMarchResult) -> MarchResultDto {
    MarchResultDto {
        roots: r.roots.iter().map(root).collect(),
        rejected: r.rejected.iter().map(root).collect(),
        newton: r.newton.as_ref().map(root),
        chosen: r.chosen.as_ref().map(root),
        holes: r.holes,
        multi_ff: r.multi_ff,
        evaluations: r.evaluations,
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ForceRootDto {
    #[serde(rename = "F")]
    f: f64,
    count: usize,
}

/// Argument `i` of an argument list.
fn arg(a: &JsValue, i: u32) -> JsValue {
    js_sys::Reflect::get_u32(a, i).unwrap_or(JsValue::UNDEFINED)
}

/// The arguments after the first `skip` (which the caller reads itself).
fn rest(a: &JsValue, skip: u32) -> JsValue {
    let arr: &js_sys::Array = a.unchecked_ref();
    arr.slice(skip, arr.length()).into()
}

/// Runs the internal function `name` on `a`, or `None` if it is not one of
/// this module's.
pub fn call(name: &str, a: JsValue) -> Option<JsResult<JsValue>> {
    Some(match name {
        "model/solvers::getSlicePropertyArrays" => (|| {
            let s = slices_from_js(arg(&a, 0))?;
            let (x0, x1, f, pts): (f64, f64, IntersliceFunctionType, Vec<Pt>) =
                args(rest(&a, 1), name)?;
            let p = get_slice_property_arrays(&s, x0, x1, f, &pts);
            let h = ARRAYS
                .with(|r| r.borrow_mut().insert(p))
                .map_err(|e| crate::errors::js_error(&e.to_string()))?;
            to_js(&ArraysRef { arrays: h })
        })(),
        "model/mp-march::march" => (|| {
            let (p, lambda, f): (ArraysRef, f64, f64) = args(a, name)?;
            let m = with_arrays(&p, |p| mp::march(p, lambda, f))?;
            to_js(&MarchDto {
                gf: m.gf,
                gm: m.gm,
                f_scale: m.f_scale,
                m_scale: m.m_scale,
                n: m.n,
                e: m.e,
                x: m.x,
                min_denom: m.min_denom,
                out_of_band: m.out_of_band,
                negative_n: m.negative_n,
                max_z_over_load: m.max_z_over_load,
                undrained: m.undrained,
            })
        })(),
        "model/mp-march::forceBand" => (|| {
            let (p, lambda): (ArraysRef, f64) = args(a, name)?;
            to_js(&with_arrays(&p, |p| mp::force_band(p, lambda))?)
        })(),
        "model/mp-march::solveForceF" => (|| {
            let (p, lambda, seed): (ArraysRef, f64, f64) = args(a, name)?;
            let r = with_arrays(&p, |p| mp::solve_force_f(p, lambda, seed))?;
            to_js(&r.map(|r| ForceRootDto {
                f: r.f,
                count: r.count,
            }))
        })(),
        "model/mp-march::solveMorgensternPriceMarch"
        | "model/mp-march::solveMorgensternPriceFast" => (|| {
            let (p, f0, o): (ArraysRef, f64, Option<MarchOptionsDto>) = args(a, name)?;
            let o: mp::MpMarchOptions = o.unwrap_or_default().into();
            let fast = name.ends_with("Fast");
            let r = with_arrays(&p, |p| {
                if fast {
                    mp::solve_morgenstern_price_fast(p, f0, &o)
                } else {
                    mp::solve_morgenstern_price_march(p, f0, &o)
                }
            })?;
            to_js(&march_result(&r))
        })(),
        "model/mp-march::setMarchSearchOptions" => (|| {
            let (o,): (MarchOptionsDto,) = args(a, name)?;
            mp::set_march_search_options(o.into());
            Ok(JsValue::UNDEFINED)
        })(),
        "model/mp-march::analyseMorgensternPriceMarch" => (|| {
            let mut slices = slices_from_js(arg(&a, 1))?;
            let (s,): (SlopeRef,) =
                args(a.unchecked_ref::<js_sys::Array>().slice(0, 1).into(), name)?;
            let (o,): (Option<MarchOptionsDto>,) = args(rest(&a, 2), name)?;
            let o: Option<mp::MpMarchOptions> = o.map(Into::into);
            let r = with_slope(s.slope, |sl| {
                mp::analyse_morgenstern_price_march(sl, &mut slices, o.as_ref())
            })?
            .js()?;
            result_with_slices(&mp_tuple(&r)?, &slices)
        })(),
        "model/mp-march::marchCount" => Ok(JsValue::from_f64(
            mp::MARCH_COUNTER.load(Ordering::Relaxed) as f64,
        )),
        "model/search::generateRefinedPlanes" => (|| {
            let planes = planes_from_js(arg(&a, 1))?;
            let (s,): (SlopeRef,) =
                args(a.unchecked_ref::<js_sys::Array>().slice(0, 1).into(), name)?;
            let (n,): (f64,) = args(rest(&a, 2), name)?;
            let r = with_slope(s.slope, |sl| {
                search::generate_refined_planes(sl, &planes, n)
            })?
            .js()?;
            planes_to_js(&r)
        })(),
        "model/search::generateLocalPlanes" => (|| {
            let planes = planes_from_js(arg(&a, 1))?;
            let (s,): (SlopeRef,) =
                args(a.unchecked_ref::<js_sys::Array>().slice(0, 1).into(), name)?;
            let (budget, level, keys, seeds): (f64, f64, Option<Vec<String>>, Option<f64>) =
                args(rest(&a, 2), name)?;
            let mut keys: HashSet<String> = match keys {
                Some(k) => k.into_iter().collect(),
                None => search::plane_keys(&planes),
            };
            let before = keys.clone();
            let r = with_slope(s.slope, |sl| {
                search::generate_local_planes(
                    sl,
                    &planes,
                    budget,
                    level,
                    &mut keys,
                    seeds.unwrap_or(4.0) as usize,
                )
            })?
            .js()?;
            let mut added: Vec<String> = keys.difference(&before).cloned().collect();
            added.sort();
            let out = js_sys::Object::new();
            js_sys::Reflect::set(&out, &"planes".into(), &planes_to_js(&r)?)?;
            js_sys::Reflect::set(&out, &"keys".into(), &to_js(&added)?)?;
            Ok(out.into())
        })(),
        _ => return None,
    })
}
