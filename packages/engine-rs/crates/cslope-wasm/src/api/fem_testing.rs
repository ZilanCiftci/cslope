//! The FE internal functions the TypeScript unit tests import (testing
//! build only), dispatched by `__test_call` for names starting `fem/`
//! (see `testing.rs`). The arguments are read one by one from the argument
//! array (handles, typed arrays and functions do not go through serde).
//!
//! Engine objects with state cross as handles:
//! - an `FeModel` (`buildFeModel`, `prepareFeModel`, `withInitialStress`):
//!   the facade's `FeModel` object reads its fields lazily
//!   (`fem/model::$field`) and frees the handle with a FinalizationRegistry;
//!   the trials take the model mutably (Hoek–Brown strength, as TypeScript's
//!   `runTrial`), so the facade drops its cached fields after them;
//! - a `SparseCholesky` (the facade keeps `values` and `upper` in
//!   JavaScript and sends them with `factor`);
//! - an `Anderson` accelerator.
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
use cslope_engine::fem::adapt::{
    dissipation_indicator, dorfler_mark, refined_size_field, zz_indicator,
};
use cslope_engine::fem::analysis::{plastic_shear_per_element, shear_increment_per_element};
use cslope_engine::fem::anderson::Anderson;
use cslope_engine::fem::bound_adapt::bound_gap_indicator;
use cslope_engine::fem::elements::{gauss_data, lame, shape_deriv_t6, shape_t6, stiffness_t6};
use cslope_engine::fem::initial_stress::{
    k0_stress, prepare_fe_model, InitialStressOptions, K0Options,
};
use cslope_engine::fem::limit_common::{reduced_strength, StrengthRule};
use cslope_engine::fem::lower_bound::{lower_bound_problem, LowerBoundOptions};
use cslope_engine::fem::mesh::{mesh_domain, point_in_polygon, MeshInput, TriMesh};
use cslope_engine::fem::model::{
    build_fe_model, gauss_strains, ignored_input_warnings, polygon_thickness_samples,
    set_hoek_brown_strength, solve_elastic, with_initial_stress, FeModel, FeModelOptions,
};
use cslope_engine::fem::newton::{norm2, return_map, return_map_into};
use cslope_engine::fem::piles::{frame_stiffness, spring_capacity};
use cslope_engine::fem::seepage::{pore_pressure_from_head, van_genuchten_mualem};
use cslope_engine::fem::sparse::{nested_dissection, node_graph, SparseCholesky};
use cslope_engine::fem::srm::SrmState;
use cslope_engine::fem::srm::{
    davis_b, empty_state, run_trial, strength_reduction_with, trial_solver, SrmOptions, SrmResult,
    SrmTrial,
};
use cslope_engine::fem::transfer::transfer_state;
use cslope_engine::fem::upper_bound::upper_bound_problem;
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
    "fem/model::$count",
    "fem/model::solveElastic",
    "fem/model::withInitialStress",
    "fem/model::ignoredInputWarnings",
    "fem/model::gaussStrains",
    "fem/model::setHoekBrownStrength",
    "fem/model::polygonThicknessSamples",
    "fem/adapt::zzIndicator",
    "fem/adapt::dissipationIndicator",
    "fem/adapt::dorflerMark",
    "fem/adapt::refinedSizeField",
    "fem/initial-stress::k0Stress",
    "fem/initial-stress::prepareFeModel",
    "fem/srm::davisB",
    "fem/srm::emptyState",
    "fem/srm::trialSolver",
    "fem/srm::runTrial",
    "fem/srm::strengthReduction",
    "fem/transfer::transferState",
    "fem/analysis::shearIncrementPerElement",
    "fem/analysis::plasticShearPerElement",
    "fem/newton::returnMap",
    "fem/newton::returnMapInto",
    "fem/newton::norm2",
    "fem/piles::springCapacity",
    "fem/piles::frameStiffness",
    "fem/seepage::vanGenuchtenMualem",
    "fem/seepage::porePressureFromHead",
    "fem/elements::shapeT6",
    "fem/elements::shapeDerivT6",
    "fem/elements::gaussData",
    "fem/elements::lame",
    "fem/elements::stiffnessT6",
    "fem/mesh::pointInPolygon",
    "fem/mesh::meshDomain",
    "fem/sparse::nestedDissection",
    "fem/sparse::nodeGraph",
    "fem/sparse::$fromGroups",
    "fem/sparse::$emptyCopy",
    "fem/sparse::$indexOf",
    "fem/sparse::$factor",
    "fem/sparse::$solve",
    "fem/sparse::$free",
    "fem/anderson::$new",
    "fem/anderson::$step",
    "fem/anderson::$reset",
    "fem/anderson::$free",
    "fem/limit-common::reducedStrength",
    "fem/lower-bound::lowerBoundProblem",
    "fem/upper-bound::upperBoundProblem",
    "fem/bound-adapt::boundGapIndicator",
];

thread_local! {
    static MODELS: RefCell<Registry<FeModel>> = const { RefCell::new(Registry::new()) };
    static MATRICES: RefCell<Registry<SparseCholesky>> = const { RefCell::new(Registry::new()) };
    static ACCELERATORS: RefCell<Registry<Anderson>> = const { RefCell::new(Registry::new()) };
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
    fn usize(&self, i: u32) -> usize {
        self.num(i) as usize
    }
    fn handle(&self, i: u32) -> u32 {
        self.num(i) as u32
    }
    fn bool(&self, i: u32) -> bool {
        self.at(i).is_truthy()
    }
    fn f64s(&self, i: u32) -> Vec<f64> {
        read_f64s(&self.at(i))
    }
    fn opt_f64s(&self, i: u32) -> Option<Vec<f64>> {
        present(self.at(i)).map(|v| read_f64s(&v))
    }
    fn usizes(&self, i: u32) -> Vec<usize> {
        self.f64s(i).into_iter().map(|v| v as usize).collect()
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

fn with_two_models<R>(
    a: u32,
    b: u32,
    f: impl FnOnce(&FeModel, &FeModel) -> JsResult<R>,
) -> JsResult<R> {
    MODELS.with(|r| {
        let r = r.borrow();
        f(
            r.get(a).map_err(handle_error)?,
            r.get(b).map_err(handle_error)?,
        )
    })
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

fn strength_rule(v: &JsValue) -> JsResult<StrengthRule> {
    if v.is_undefined() {
        return Ok(StrengthRule::default());
    }
    from_js(v.clone(), "rule")
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
        "fem/model::$count" => num(MODELS.with(|r| r.borrow().len()) as f64),
        "fem/model::solveElastic" => with_model(a.handle(0), |m| {
            let s = solve_elastic(m);
            let o = Obj::new();
            o.set("u", f64s(&s.u)).set("stress", f64s(&s.stress));
            Ok(o.js())
        }),
        "fem/model::withInitialStress" => {
            let stress0 = a.f64s(1);
            let m = with_model(a.handle(0), |m| Ok(with_initial_stress(m, &stress0)))?;
            model_new(m)
        }
        "fem/model::ignoredInputWarnings" => {
            with_slope(&a.at(0), |s| ser(&ignored_input_warnings(s)))
        }
        "fem/model::gaussStrains" => with_model(a.handle(0), |m| {
            let u = a.f64s(1);
            let mut out = vec![0.0; 4 * 3 * m.element_count];
            gauss_strains(m, &u, &mut out);
            Ok(f64s(&out))
        }),
        "fem/model::setHoekBrownStrength" => {
            let stress = a.opt_f64s(1);
            with_model_mut(a.handle(0), |m| {
                set_hoek_brown_strength(m, stress.as_deref());
                Ok(JsValue::UNDEFINED)
            })
        }
        "fem/model::polygonThicknessSamples" => {
            let s = polygon_thickness_samples(&a.f64s(0), &a.f64s(1));
            let out = Array::new();
            for t in s {
                let o = Obj::new();
                o.set("x", t.x).set("y", t.y).set("t", t.t);
                out.push(&o.js());
            }
            Ok(out.into())
        }
        // ── adapt ──
        "fem/adapt::zzIndicator" => {
            with_model(a.handle(0), |m| Ok(f64s(&zz_indicator(m, &a.f64s(1)))))
        }
        "fem/adapt::dissipationIndicator" => with_model(a.handle(0), |m| {
            Ok(f64s(&dissipation_indicator(m, &a.f64s(1), &a.f64s(2))))
        }),
        "fem/adapt::dorflerMark" => Ok(u8s_bool(&dorfler_mark(&a.f64s(0), a.num_or(1, 0.5)))),
        "fem/adapt::refinedSizeField" => {
            let marked: Vec<bool> = a.f64s(1).into_iter().map(|v| v != 0.0).collect();
            let min = a.num_or(2, 0.0);
            let sf = with_model(a.handle(0), |m| Ok(refined_size_field(m, &marked, min)))?;
            num(size_field_new(sf)? as f64)
        }
        // ── initial-stress ──
        "fem/initial-stress::k0Stress" => {
            let o = a.at(2);
            let k0 = field(&o, "k0").as_f64();
            let g0 = field(&o, "originalGroundLevel").as_f64();
            let inactive: Vec<String> = match present(field(&o, "inactive")) {
                // a Set or a list of names
                Some(v) => Array::from(&v)
                    .iter()
                    .filter_map(|s| s.as_string())
                    .collect(),
                None => Vec::new(),
            };
            let k = K0Options {
                k0,
                original_ground_level: g0,
                inactive: &inactive,
            };
            with_model(a.handle(0), |m| {
                with_slope(&a.at(1), |s| Ok(f64s(&k0_stress(m, s, &k))))
            })
        }
        "fem/initial-stress::prepareFeModel" => {
            let mut mo: FeModelOptions = a.serde(1, "options")?;
            mo.size_field = a.size_field(3)?;
            let io: InitialStressOptions = a.serde(1, "options")?;
            let so = srm_options(&a.at(2))?;
            let p = with_slope(&a.at(0), |s| prepare_fe_model(s, &mo, &io, &so).js())?;
            let o = Obj::new();
            o.set("model", model_new(p.model)?)
                .set("warnings", ser(&p.warnings)?);
            Ok(o.js())
        }
        // ── srm ──
        "fem/srm::davisB" => num(davis_b(a.num(0), a.num(1), a.num(2))),
        "fem/srm::emptyState" => with_model(a.handle(0), |m| Ok(state_js(&empty_state(m)))),
        "fem/srm::trialSolver" => {
            let o = srm_options(&a.at(1))?;
            with_model(a.handle(0), |m| ser(&trial_solver(m, &o)))
        }
        "fem/srm::runTrial" => {
            let start = present(a.at(2)).map(|s| state_from_js(&s));
            let o = srm_options(&a.at(3))?;
            let start_f = a.num_or(4, 0.0);
            with_model_mut(a.handle(0), |m| {
                let r = run_trial(m, a.num(1), start.as_ref(), &o, start_f).js()?;
                let out = Obj::new();
                out.set("converged", r.converged)
                    .set("iterations", r.iterations as f64)
                    .set("solver", ser(&r.solver)?)
                    .set("state", state_js(&r.state));
                Ok(out.js())
            })
        }
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
        "fem/transfer::transferState" => {
            let st = state_from_js(&a.at(1));
            with_two_models(a.handle(0), a.handle(2), |from, to| {
                Ok(transfer_state(from, &st, to)
                    .as_ref()
                    .map(state_js)
                    .unwrap_or(JsValue::NULL))
            })
        }
        // ── analysis ──
        "fem/analysis::shearIncrementPerElement" => {
            let u = a.f64s(1);
            let prev = a.opt_f64s(2);
            with_model(a.handle(0), |m| {
                Ok(f64s(&shear_increment_per_element(m, &u, prev.as_deref())))
            })
        }
        "fem/analysis::plasticShearPerElement" => with_model(a.handle(0), |m| {
            Ok(f64s(&plastic_shear_per_element(m, &a.f64s(1))))
        }),
        // ── newton ──
        "fem/newton::returnMap" => {
            let t = a.f64s(0);
            let mut tangent = a.opt_f64s(7).unwrap_or_else(|| vec![0.0; 16]);
            let r = return_map(
                [t[0], t[1], t[2], t[3]],
                a.num(1),
                a.num(2),
                a.num(3),
                a.num(4),
                a.num(5),
                a.bool(6),
                &mut tangent,
                a.num_or(8, f64::INFINITY),
            )
            .js()?;
            let o = Obj::new();
            o.set("stress", f64s(&r.stress))
                .set("plastic", r.plastic)
                .set("tangent", f64s(&tangent));
            Ok(o.js())
        }
        "fem/newton::returnMapInto" => {
            let mut out = a.f64s(11);
            let mut tangent = a.opt_f64s(12);
            let sin_phi = a.num(7);
            let plastic = return_map_into(
                a.num(0),
                a.num(1),
                a.num(2),
                a.num(3),
                a.num(4),
                a.num(5),
                a.num(6),
                sin_phi,
                a.num(8),
                a.bool(9),
                a.num_or(10, f64::INFINITY),
                &mut out,
                tangent.as_deref_mut(),
                a.num_or(13, sin_phi),
            )
            .js()?;
            let o = Obj::new();
            o.set("plastic", plastic).set("out", f64s(&out));
            if let Some(t) = &tangent {
                o.set("tangent", f64s(t));
            }
            Ok(o.js())
        }
        "fem/newton::norm2" => num(norm2(&a.f64s(0))),
        // ── piles ──
        "fem/piles::springCapacity" => num(spring_capacity(
            a.num(0) as u8,
            a.num(1),
            a.num(2),
            a.num(3),
            a.num(4),
        )),
        "fem/piles::frameStiffness" => {
            let mut k = vec![0.0; 36];
            frame_stiffness(a.num(0), a.num(1), a.num(2), a.num(3), a.num(4), &mut k);
            Ok(f64s(&k))
        }
        // ── seepage ──
        "fem/seepage::vanGenuchtenMualem" => {
            num(van_genuchten_mualem(a.num(0), a.num(1), a.num(2)))
        }
        "fem/seepage::porePressureFromHead" => num(pore_pressure_from_head(a.num(0), a.num(1))),
        // ── elements ──
        "fem/elements::shapeT6" => {
            let mut out = vec![0.0; 6];
            shape_t6(a.num(0), a.num(1), &mut out);
            Ok(f64s(&out))
        }
        "fem/elements::shapeDerivT6" => {
            let mut out = vec![0.0; 12];
            shape_deriv_t6(a.num(0), a.num(1), &mut out);
            Ok(f64s(&out))
        }
        "fem/elements::gaussData" => {
            num_vec(gauss_data(&a.f64s(0), &a.f64s(1), &a.usizes(2), a.usize(3)).js()?)
        }
        "fem/elements::lame" => {
            let l = lame(a.num(0), a.num(1));
            let o = Obj::new();
            o.set("lambda", l.lambda).set("mu", l.mu);
            Ok(o.js())
        }
        "fem/elements::stiffnessT6" => {
            let mut ke = a.f64s(4);
            if ke.len() < 144 {
                ke.resize(144, 0.0);
            }
            stiffness_t6(&a.f64s(0), a.usize(1), a.num(2), a.num(3), &mut ke);
            Ok(f64s(&ke))
        }
        // ── mesh ──
        "fem/mesh::pointInPolygon" => {
            let poly: Vec<[f64; 2]> = from_js(a.at(2), "polygon")?;
            Ok(JsValue::from_bool(point_in_polygon(
                a.num(0),
                a.num(1),
                &poly,
            )))
        }
        "fem/mesh::meshDomain" => {
            let input = a.at(0);
            let boundary: Vec<[f64; 2]> = from_js(field(&input, "boundary"), "boundary")?;
            let segments: Vec<Vec<[f64; 2]>> = match present(field(&input, "segments")) {
                Some(s) => from_js(s, "segments")?,
                None => Vec::new(),
            };
            let size_v = field(&input, "size");
            let size_fn = size_v.dyn_ref::<Function>().cloned();
            let thrown: RefCell<Option<JsValue>> = RefCell::new(None);
            let size = |x: f64, y: f64| -> f64 {
                let Some(f) = &size_fn else { return f64::NAN };
                match f.call2(
                    &JsValue::UNDEFINED,
                    &JsValue::from_f64(x),
                    &JsValue::from_f64(y),
                ) {
                    Ok(v) => v.as_f64().unwrap_or(f64::NAN),
                    Err(e) => {
                        thrown.borrow_mut().get_or_insert(e);
                        f64::NAN
                    }
                }
            };
            let opt = |k: &str| field(&input, k).as_f64();
            let mi = MeshInput {
                boundary,
                segments,
                size: &size,
                min_angle: opt("minAngle"),
                min_size: opt("minSize"),
                size_min: opt("sizeMin").or_else(|| field(&size_v, "min").as_f64()),
                max_vertices: opt("maxVertices").map(|v| v as usize),
            };
            let r = mesh_domain(&mi);
            if let Some(e) = thrown.into_inner() {
                return Err(e);
            }
            Ok(tri_mesh_js(&r.js()?))
        }
        // ── sparse ──
        "fem/sparse::nestedDissection" => {
            let adj: Vec<Vec<usize>> = Array::from(&a.at(2))
                .iter()
                .map(|v| read_f64s(&v).into_iter().map(|x| x as usize).collect())
                .collect();
            Ok(i32s_usize(&nested_dissection(&a.f64s(0), &a.f64s(1), &adj)))
        }
        "fem/sparse::nodeGraph" => {
            let g = node_graph(&a.usizes(0), a.usize(1), a.usize(2));
            let out = Array::new();
            for row in g {
                out.push(&i32s_usize(&row));
            }
            Ok(out.into())
        }
        "fem/sparse::$fromGroups" => {
            let groups: Vec<i64> = a.f64s(1).into_iter().map(|v| v as i64).collect();
            matrix_new(SparseCholesky::from_groups(a.usize(0), &groups, a.usize(2)))
        }
        "fem/sparse::$emptyCopy" => {
            let m = with_matrix(a.handle(0), |k| Ok(k.empty_copy(a.bool(1))))?;
            matrix_new(m)
        }
        "fem/sparse::$indexOf" => with_matrix(a.handle(0), |k| {
            Ok(k.index_of(a.usize(1), a.usize(2)).js()? as f64)
        })
        .map(JsValue::from_f64),
        "fem/sparse::$factor" => {
            let values = a.f64s(1);
            let upper = a.opt_f64s(2);
            MATRICES.with(|r| {
                let mut r = r.borrow_mut();
                let k = r.get_mut(a.handle(0)).map_err(handle_error)?;
                k.values.copy_from_slice(&values);
                if let (Some(dst), Some(src)) = (k.upper.as_mut(), upper.as_ref()) {
                    dst.copy_from_slice(src);
                }
                k.factor().js()?;
                Ok(JsValue::UNDEFINED)
            })
        }
        "fem/sparse::$solve" => with_matrix(a.handle(0), |k| {
            let mut b = a.f64s(1);
            k.solve(&mut b);
            Ok(f64s(&b))
        }),
        "fem/sparse::$free" => Ok(JsValue::from_bool(
            MATRICES.with(|r| r.borrow_mut().remove(a.handle(0))),
        )),
        // ── anderson ──
        "fem/anderson::$new" => {
            let acc = Anderson::new(a.usize(0), a.usize(1), a.num_or(2, 0.0) as usize);
            ACCELERATORS
                .with(|r| r.borrow_mut().insert(acc).map_err(handle_error))
                .map(|h| JsValue::from_f64(h as f64))
        }
        "fem/anderson::$step" => ACCELERATORS.with(|r| {
            let mut r = r.borrow_mut();
            let acc = r.get_mut(a.handle(0)).map_err(handle_error)?;
            let mut g = a.f64s(2);
            acc.step(&a.f64s(1), &mut g);
            Ok(f64s(&g))
        }),
        "fem/anderson::$reset" => ACCELERATORS.with(|r| {
            r.borrow_mut()
                .get_mut(a.handle(0))
                .map_err(handle_error)?
                .reset();
            Ok(JsValue::UNDEFINED)
        }),
        "fem/anderson::$free" => Ok(JsValue::from_bool(
            ACCELERATORS.with(|r| r.borrow_mut().remove(a.handle(0))),
        )),
        // ── limit analysis ──
        "fem/limit-common::reducedStrength" => {
            let (c, phi) = reduced_strength(
                a.num(0),
                a.num(1),
                a.num(2),
                a.num(3),
                strength_rule(&a.at(4))?,
            );
            let o = Obj::new();
            o.set("c", c).set("phi", phi);
            Ok(o.js())
        }
        "fem/lower-bound::lowerBoundProblem" => {
            let mut o: LowerBoundOptions = a.serde(1, "options")?;
            o.model.size_field = a.size_field(2)?;
            with_slope(&a.at(0), |s| {
                let p = lower_bound_problem(s, &o).js()?;
                let split = Array::new();
                for &((x, y), n) in &p.mesh.split {
                    split.push(&Array::of2(
                        &JsValue::from_str(&format!("{x},{y}")),
                        &JsValue::from_f64(n as f64),
                    ));
                }
                let mesh = Obj::new();
                mesh.set("x", f64s(&p.mesh.x))
                    .set("y", f64s(&p.mesh.y))
                    .set("el", i32s_usize(&p.mesh.el))
                    .set("parent", i32s_usize(&p.mesh.parent))
                    .set("split", split);
                let out = Obj::new();
                out.set("sides", p.sides)
                    .set("allUndrained", p.all_undrained)
                    .set("elements", p.elements as f64)
                    .set("variables", p.variables as f64)
                    .set("constraints", p.constraints as f64)
                    .set("warnings", ser(&p.warnings)?)
                    .set("mesh", mesh.js());
                Ok(out.js())
            })
        }
        "fem/upper-bound::upperBoundProblem" => {
            let mut o: LowerBoundOptions = a.serde(1, "options")?;
            o.model.size_field = a.size_field(2)?;
            with_slope(&a.at(0), |s| {
                let p = upper_bound_problem(s, &o).js()?;
                let mesh = Obj::new();
                mesh.set("x", f64s(&p.mesh.x))
                    .set("y", f64s(&p.mesh.y))
                    .set("el", i32s_usize(&p.mesh.el));
                let out = Obj::new();
                out.set("sides", p.sides)
                    .set("allUndrained", p.all_undrained)
                    .set("cohesive", p.cohesive)
                    .set("elements", p.elements as f64)
                    .set("variables", p.variables as f64)
                    .set("constraints", p.constraints as f64)
                    .set("warnings", ser(&p.warnings)?)
                    .set("mesh", mesh.js());
                Ok(out.js())
            })
        }
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

fn num_vec(v: Vec<f64>) -> JsResult<JsValue> {
    Ok(f64s(&v))
}

fn matrix_new(m: SparseCholesky) -> JsResult<JsValue> {
    let h = MATRICES.with(|r| r.borrow_mut().insert(m).map_err(handle_error))?;
    let o = Obj::new();
    o.set("handle", h as f64).set("n", m_n(h)?);
    with_matrix(h, |k| {
        o.set("diag", i32s_usize(&k.diag))
            .set("values", f64s(&k.values))
            .set(
                "upper",
                k.upper.as_deref().map(f64s).unwrap_or(JsValue::NULL),
            );
        Ok(())
    })?;
    Ok(o.js())
}

fn m_n(h: u32) -> JsResult<f64> {
    with_matrix(h, |k| Ok(k.n as f64))
}

fn with_matrix<R>(h: u32, f: impl FnOnce(&SparseCholesky) -> JsResult<R>) -> JsResult<R> {
    MATRICES.with(|r| {
        let r = r.borrow();
        f(r.get(h).map_err(handle_error)?)
    })
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
