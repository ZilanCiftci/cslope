//! The FE internal functions the TypeScript tests import (testing build
//! only), dispatched by `__test_call` for names starting `fem/` (see
//! `testing.rs`): the model, its elastic solution, the strength reduction,
//! the refinement indicators and the bound gap. The other FE internals are
//! tested in Rust only (crates/cslope-engine/tests, issue #51). The
//! arguments are read one by one from the argument array (handles, typed
//! arrays and functions do not go through serde).
//!
//! An `FeModel` (`buildFeModel`) crosses as a handle: the facade's
//! `FeModel` object reads its fields lazily (`fem/model::$field`) and frees
//! the handle with a FinalizationRegistry; the strength reduction takes the
//! model mutably (Hoek–Brown strength), so the facade drops its cached
//! fields after it.
//!
//! Names of the form `fem/<module>::$<what>` are the facade's own
//! operations on those handles, not TypeScript functions.

use crate::api::fem::{
    f64s, field, handle_error, i32s_usize, present, size_field_new, size_field_opt, with_slope,
    JsResult, Obj,
};
use crate::convert::{from_js, to_js};
use crate::errors::{js_error, IntoJsResult};
use crate::registry::Registry;
use cslope_engine::fem::adapt::{dorfler_mark, refined_size_field, zz_indicator};
use cslope_engine::fem::bound_adapt::bound_gap_indicator;
use cslope_engine::fem::lower_bound::LowerBoundOptions;
use cslope_engine::fem::mesh::TriMesh;
use cslope_engine::fem::model::{build_fe_model, solve_elastic, FeModel, FeModelOptions};
use cslope_engine::fem::srm::{strength_reduction_with, SrmOptions, SrmResult, SrmState, SrmTrial};
use js_sys::{Array, Function, Map};
use js_sys::{Float64Array, Int32Array, Uint8Array};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::cell::RefCell;
use std::sync::Arc;
use wasm_bindgen::{JsCast, JsValue};

/// Every name [`call`] dispatches (`__test_functions` lists them with the others).
pub const FEM_TEST_FUNCTIONS: &[&str] = &[
    "fem/model::buildFeModel",
    "fem/model::$field",
    "fem/model::$free",
    "fem/model::solveElastic",
    "fem/adapt::zzIndicator",
    "fem/adapt::dorflerMark",
    "fem/adapt::refinedSizeField",
    "fem/srm::strengthReduction",
    "fem/bound-adapt::boundGapIndicator",
];

thread_local! {
    static MODELS: RefCell<Registry<FeModel>> = const { RefCell::new(Registry::new()) };
}

// ── arguments ────────────────────────────────────────────────────────────

struct Args(Array);

impl Args {
    fn at(&self, i: u32) -> JsValue {
        self.0.get(i)
    }
    fn num(&self, i: u32) -> f64 {
        self.at(i).as_f64().unwrap_or(f64::NAN)
    }
    /// A number that may be omitted (undefined: `default`).
    fn num_or(&self, i: u32, default: f64) -> f64 {
        let v = self.at(i);
        if v.is_undefined() {
            default
        } else {
            v.as_f64().unwrap_or(f64::NAN)
        }
    }
    fn handle(&self, i: u32) -> u32 {
        self.num(i) as u32
    }
    fn f64s(&self, i: u32) -> Vec<f64> {
        read_f64s(&self.at(i))
    }
    fn serde<T: DeserializeOwned>(&self, i: u32, what: &str) -> JsResult<T> {
        let v = self.at(i);
        if v.is_undefined() || v.is_null() {
            return from_js(js_sys::Object::new().into(), what);
        }
        from_js(v, what)
    }
    fn size_field(&self, i: u32) -> JsResult<Option<Arc<cslope_engine::fem::model::SizeField>>> {
        size_field_opt(self.at(i).as_f64().map(|h| h as u32))
    }
}

fn num(v: f64) -> JsResult<JsValue> {
    Ok(JsValue::from_f64(v))
}

fn ser<T: Serialize + ?Sized>(v: &T) -> JsResult<JsValue> {
    to_js(v)
}

// ── models ───────────────────────────────────────────────────────────────

fn model_new(m: FeModel) -> JsResult<JsValue> {
    MODELS
        .with(|r| r.borrow_mut().insert(m).map_err(handle_error))
        .map(|h| JsValue::from_f64(h as f64))
}

fn with_model<R>(h: u32, f: impl FnOnce(&FeModel) -> JsResult<R>) -> JsResult<R> {
    MODELS.with(|r| {
        let r = r.borrow();
        f(r.get(h).map_err(handle_error)?)
    })
}

/// The model taken out of its slot for a call that may run JavaScript or
/// change it.
fn with_model_mut<R>(h: u32, f: impl FnOnce(&mut FeModel) -> JsResult<R>) -> JsResult<R> {
    let mut m = MODELS.with(|r| r.borrow_mut().take(h).map_err(handle_error))?;
    let out = f(&mut m);
    MODELS.with(|r| r.borrow_mut().put_back(h, m));
    out
}

fn tri_mesh_js(t: &TriMesh) -> JsValue {
    let o = Obj::new();
    o.set("x", f64s(&t.x))
        .set("y", f64s(&t.y))
        .set("tri", i32s_usize(&t.tri))
        .set("count", t.count as f64)
        .set("capped", t.capped)
        .set("missingSegments", t.missing_segments as f64);
    o.js()
}

/// One field of an `FeModel`, as TypeScript holds it.
fn model_field(m: &FeModel, name: &str) -> JsResult<JsValue> {
    Ok(match name {
        "x" => f64s(&m.x),
        "y" => f64s(&m.y),
        "nodeCount" => JsValue::from_f64(m.node_count as f64),
        "cornerCount" => JsValue::from_f64(m.corner_count as f64),
        "el" => i32s_usize(&m.el),
        "elementCount" => JsValue::from_f64(m.element_count as f64),
        "materials" => ser(&m.materials)?,
        "elMaterial" => i32s_usize(&m.el_material),
        "elE" => f64s(&m.el_e),
        "elNu" => f64s(&m.el_nu),
        "elPsi" => f64s(&m.el_psi),
        "elElastic" => u8s_bool(&m.el_elastic),
        "gp" => f64s(&m.gp),
        "gpX" => f64s(&m.gp_x),
        "gpY" => f64s(&m.gp_y),
        "gpC" => f64s(&m.gp_c),
        "gpCu" => f64s(&m.gp_cu),
        "gpPhi" => f64s(&m.gp_phi),
        "gpU" => f64s(&m.gp_u),
        "eq" => i32s_i64(&m.eq),
        "eqCount" => JsValue::from_f64(m.eq_count as f64),
        "f" => f64s(&m.f),
        "stress0" => m.stress0.as_deref().map(f64s).unwrap_or(JsValue::NULL),
        "loadNorm" => JsValue::from_f64(m.load_norm),
        "elInactive" => u8s_bool(&m.el_inactive),
        "surfaceEdges" => i32s_usize(&m.surface_edges),
        "triangulation" => tri_mesh_js(&m.triangulation),
        "sizeField" => JsValue::from_f64(size_field_new(Arc::clone(&m.size_field))? as f64),
        "seepage" => match &m.seepage {
            None => JsValue::UNDEFINED,
            Some(s) => {
                let o = Obj::new();
                o.set("head", f64s(&s.head))
                    .set("iterations", s.iterations as f64)
                    .set("converged", s.converged)
                    .set("seepageFaceNodes", s.seepage_face_nodes as f64)
                    .set("flow", s.flow);
                o.js()
            }
        },
        "gpHoekBrown" => {
            let map = Map::new();
            for (i, p) in &m.gp_hoek_brown {
                map.set(&JsValue::from_f64(*i as f64), &ser(p)?);
            }
            map.into()
        }
        "partialFactors" => match &m.partial_factors {
            None => JsValue::NULL,
            Some(p) => ser(p)?,
        },
        "gpC0" => f64s(&m.gp_c0),
        "gpPhi0" => f64s(&m.gp_phi0),
        "piles" => {
            let p = &m.piles;
            let o = Obj::new();
            o.set("count", p.count as f64)
                .set("nodes", i32s_usize(&p.nodes))
                .set("c", f64s(&p.c))
                .set("s", f64s(&p.s))
                .set("length", f64s(&p.length))
                .set("ea", f64s(&p.ea))
                .set("ei", f64s(&p.ei))
                .set("source", i32s_usize(&p.source))
                .set("rotEq", i32s_i64(&p.rot_eq));
            o.js()
        }
        "warnings" => ser(&m.warnings)?,
        "bars" => {
            let b = &m.bars;
            let o = Obj::new();
            o.set("count", b.count as f64)
                .set("nodes", i32s_usize(&b.nodes))
                .set("source", i32s_i64(&b.source))
                .set("gp", f64s(&b.gp))
                .set("capacity", f64s(&b.capacity))
                .set("passive", u8s_bool(&b.passive))
                .set("stiffness", f64s(&b.stiffness))
                .set("ep0", f64s(&b.ep0))
                .set("bothWays", u8s_bool(&b.both_ways))
                .set("capKind", u8s(&b.cap_kind))
                .set("capC", f64s(&b.cap_c))
                .set("capSv", f64s(&b.cap_sv))
                .set("capTan", f64s(&b.cap_tan));
            o.js()
        }
        // the factorised stiffness matrix stays in the engine
        "K" => JsValue::NULL,
        _ => return Err(js_error(&format!("FeModel has no field \"{name}\""))),
    })
}

fn srm_result_js(r: &SrmResult) -> JsResult<JsValue> {
    let o = Obj::new();
    o.set("factorOfSafety", r.factor_of_safety)
        .set("failedF", r.failed_f)
        .set("failedFrom", r.failed_from)
        .set(
            "displacementJumpF",
            r.displacement_jump_f
                .map(JsValue::from_f64)
                .unwrap_or(JsValue::NULL),
        )
        .set("trials", ser(&r.trials)?)
        .set("state", state_js(&r.state))
        .set(
            "previousState",
            r.previous_state
                .as_deref()
                .map(state_js)
                .unwrap_or(JsValue::NULL),
        )
        .set("iterations", r.iterations as f64);
    if let Some(w) = &r.warning {
        o.set("warning", w.as_str());
    }
    Ok(o.js())
}

/// `SrmOptions` with the warm start (a state object), read from JavaScript.
fn srm_options(v: &JsValue) -> JsResult<SrmOptions> {
    let mut o: SrmOptions = if v.is_undefined() || v.is_null() {
        SrmOptions::default()
    } else {
        from_js(v.clone(), "options")?
    };
    if let Some(ws) = present(field(v, "warmStart")) {
        o.warm_start = Some(Arc::new(state_from_js(&ws)));
    }
    Ok(o)
}

// ── the dispatcher ───────────────────────────────────────────────────────

/// Runs the FE internal function `name` (one of [`FEM_TEST_FUNCTIONS`]).
pub fn call(name: &str, a: JsValue) -> JsResult<JsValue> {
    let a = Args(
        a.dyn_into::<Array>()
            .map_err(|_| js_error("__test_call: the arguments are not an array"))?,
    );
    match name {
        // ── model ──
        "fem/model::buildFeModel" => {
            let mut o: FeModelOptions = a.serde(1, "options")?;
            o.size_field = a.size_field(2)?;
            let m = with_slope(&a.at(0), |s| build_fe_model(s, &o).js())?;
            model_new(m)
        }
        "fem/model::$field" => {
            let field_name = a.at(1).as_string().unwrap_or_default();
            with_model(a.handle(0), |m| model_field(m, &field_name))
        }
        "fem/model::$free" => Ok(JsValue::from_bool(
            MODELS.with(|r| r.borrow_mut().remove(a.handle(0))),
        )),
        "fem/model::solveElastic" => with_model(a.handle(0), |m| {
            let s = solve_elastic(m);
            let o = Obj::new();
            o.set("u", f64s(&s.u)).set("stress", f64s(&s.stress));
            Ok(o.js())
        }),
        // ── adapt ──
        "fem/adapt::zzIndicator" => {
            with_model(a.handle(0), |m| Ok(f64s(&zz_indicator(m, &a.f64s(1)))))
        }
        "fem/adapt::dorflerMark" => Ok(u8s_bool(&dorfler_mark(&a.f64s(0), a.num_or(1, 0.5)))),
        "fem/adapt::refinedSizeField" => {
            let marked: Vec<bool> = a.f64s(1).into_iter().map(|v| v != 0.0).collect();
            let min = a.num_or(2, 0.0);
            let sf = with_model(a.handle(0), |m| Ok(refined_size_field(m, &marked, min)))?;
            num(size_field_new(sf)? as f64)
        }
        // ── srm ──
        "fem/srm::strengthReduction" => {
            let ov = a.at(1);
            let o = srm_options(&ov)?;
            let on_trial = field(&ov, "onTrial").dyn_into::<Function>().ok();
            let thrown: RefCell<Option<JsValue>> = RefCell::new(None);
            let r = with_model_mut(a.handle(0), |m| {
                let mut cb = |t: &SrmTrial| {
                    if let Some(f) = &on_trial {
                        if thrown.borrow().is_some() {
                            return;
                        }
                        if let Err(e) = to_js(t).and_then(|t| f.call1(&JsValue::UNDEFINED, &t)) {
                            *thrown.borrow_mut() = Some(e);
                        }
                    }
                };
                strength_reduction_with(m, &o, &mut cb).js()
            });
            if let Some(e) = thrown.into_inner() {
                return Err(e);
            }
            srm_result_js(&r?)
        }
        // ── limit analysis ──
        "fem/bound-adapt::boundGapIndicator" => {
            let mut o: LowerBoundOptions = a.serde(1, "options")?;
            o.model.size_field = a.size_field(3)?;
            let f = a.num(2);
            with_slope(&a.at(0), |s| {
                Ok(match bound_gap_indicator(s, &o, f).js()? {
                    None => JsValue::NULL,
                    Some(g) => {
                        let out = Obj::new();
                        out.set("eta", f64s(&g.eta))
                            .set("lambdaLower", g.lambda_lower)
                            .set("lambdaUpper", g.lambda_upper)
                            .set("withStress", g.with_stress);
                        out.js()
                    }
                })
            })
        }
        _ => Err(js_error(&format!(
            "__test_call: no internal function \"{name}\" in the testing build"
        ))),
    }
}

// ── values (the testing build's) ──

/// An `Int32Array` copy of signed indices (−1: none).
fn i32s_i64(v: &[i64]) -> JsValue {
    let t: Vec<i32> = v.iter().map(|&x| x as i32).collect();
    Int32Array::from(&t[..]).into()
}

/// A `Uint8Array` of flags (1: true).
fn u8s_bool(v: &[bool]) -> JsValue {
    let t: Vec<u8> = v.iter().map(|&b| u8::from(b)).collect();
    Uint8Array::from(&t[..]).into()
}

/// A `Uint8Array` copy of small numbers.
fn u8s(v: &[u8]) -> JsValue {
    Uint8Array::from(v).into()
}

/// The numbers of a JavaScript array or typed array.
fn read_f64s(v: &JsValue) -> Vec<f64> {
    if let Some(a) = v.dyn_ref::<Float64Array>() {
        return a.to_vec();
    }
    Float64Array::new(v).to_vec()
}

/// `SrmState` as TypeScript's object of typed arrays.
fn state_js(s: &SrmState) -> JsValue {
    let o = Obj::new();
    o.set("u", f64s(&s.u))
        .set("evp", f64s(&s.evp))
        .set("bodyLoads", f64s(&s.body_loads))
        .set("stress", f64s(&s.stress))
        .set("barEp", f64s(&s.bar_ep));
    o.js()
}

/// A state from JavaScript (`SrmState`); missing arrays are empty.
fn state_from_js(v: &JsValue) -> SrmState {
    let arr = |k: &str| {
        present(field(v, k))
            .map(|a| read_f64s(&a))
            .unwrap_or_default()
    };
    SrmState {
        u: arr("u"),
        evp: arr("evp"),
        body_loads: arr("bodyLoads"),
        stress: arr("stress"),
        bar_ep: arr("barEp"),
    }
}

#[cfg(test)]
mod tests {
    use super::FEM_TEST_FUNCTIONS;

    #[test]
    fn names_are_unique_and_dispatched() {
        let mut seen = std::collections::HashSet::new();
        let src = include_str!("fem_testing.rs");
        for n in FEM_TEST_FUNCTIONS {
            assert!(seen.insert(*n), "duplicate {n}");
            assert!(n.starts_with("fem/"), "{n}");
            assert!(src.contains(&format!("\"{n}\" =>")), "no arm for {n}");
        }
    }
}
