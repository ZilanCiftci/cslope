//! Differential tests of the types ports against fixtures exported from the
//! TypeScript engine under Node (tools/fixtures/types.fixture.ts).
//!
//! - Serde round trips: every definition the verification problems, the
//!   reliability cases and the app's example models (through the desktop's
//!   `buildSlopeDTOFromModel`) produce, the analysis options of every
//!   verification check and the app, and results with every optional field
//!   deserialize and serialize back to the same JSON value.
//! - Strength, design strength, validation, Hoek-Brown, materials, loads and
//!   partial factors: the same outputs for the same inputs. Tolerance: 1e-9
//!   relative (PORTING.md rule 6) for values through `Math.tan/exp/pow/asin`;
//!   validation messages, flags and the arithmetic-only values compare
//!   exactly (they pass at 1e-9 too, which the shared comparison uses).

mod common;

use common::{close, num};
use cslope_engine::model::canonical::SlopeOrientation;
use cslope_engine::types::*;
use serde::Serialize;
use serde_json::Value;

const REL: f64 = 1e-9;

/// A JSON number, a non-finite number as the fixtures encode it, or the
/// `null` that serde_json writes for one.
fn is_numeric(v: &Value) -> bool {
    matches!(v, Value::Number(_) | Value::Null)
        || matches!(v, Value::String(s) if s == "NaN" || s == "Infinity" || s == "-Infinity")
}

/// Compares the JSON Rust writes (`got`) with the JSON TypeScript wrote
/// (`want`): the same keys and values, numbers within `rel` (a non-finite
/// number is `null` on the Rust side).
#[track_caller]
fn json_eq(got: &Value, want: &Value, rel: f64, path: &str) {
    match (got, want) {
        (Value::Object(a), Value::Object(b)) => {
            let mut ka: Vec<_> = a.keys().collect();
            let mut kb: Vec<_> = b.keys().collect();
            ka.sort();
            kb.sort();
            assert_eq!(ka, kb, "keys at {path}");
            for (k, v) in a {
                json_eq(v, &b[k], rel, &format!("{path}.{k}"));
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "length at {path}");
            for (i, (x, y)) in a.iter().zip(b).enumerate() {
                json_eq(x, y, rel, &format!("{path}[{i}]"));
            }
        }
        (Value::Null, Value::Null) => {}
        (Value::Null, w) if is_numeric(w) => {
            assert!(!num(w).is_finite(), "{path}: null vs {w}");
        }
        (g, w) if is_numeric(g) && is_numeric(w) && !g.is_null() => {
            assert!(close(num(g), num(w), rel), "{path}: {g} vs {w}");
        }
        (g, w) => assert_eq!(g, w, "at {path}"),
    }
}

#[test]
#[should_panic(expected = ".a: 1 vs 1.5")]
fn json_eq_compares_numbers() {
    json_eq(
        &serde_json::json!({ "a": 1 }),
        &serde_json::json!({ "a": 1.5 }),
        1e-9,
        "",
    );
}

#[test]
#[should_panic(expected = "keys")]
fn json_eq_compares_keys() {
    json_eq(
        &serde_json::json!({ "a": 1 }),
        &serde_json::json!({ "a": 1, "b": null }),
        1e-9,
        "",
    );
}

#[test]
fn json_eq_takes_null_for_non_finite() {
    json_eq(
        &serde_json::json!([null, 2.0]),
        &serde_json::json!(["Infinity", 2]),
        0.0,
        "",
    );
}

fn to_value<T: Serialize>(t: &T) -> Value {
    serde_json::to_value(t).unwrap()
}

fn from<T: serde::de::DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
}

#[test]
fn definitions_round_trip() {
    let defs: Value = common::load("types", "definitions");
    let defs = defs.as_array().unwrap();
    assert!(defs.len() > 150);
    for d in defs {
        let id = d["id"].as_str().unwrap();
        let def: SlopeDefinition = from(&d["definition"]);
        json_eq(&to_value(&def), &d["definition"], 0.0, id);
    }
}

#[test]
fn options_round_trip() {
    let opts: Value = common::load("types", "options");
    for (i, o) in opts.as_array().unwrap().iter().enumerate() {
        let parsed: AnalysisOptions = from(o);
        json_eq(&to_value(&parsed), o, 0.0, &format!("options[{i}]"));
    }
}

#[test]
fn results_round_trip() {
    let results: Value = common::load("types", "results");
    for (i, r) in results.as_array().unwrap().iter().enumerate() {
        let parsed: AnalysisResult = from(r);
        json_eq(&to_value(&parsed), r, 0.0, &format!("results[{i}]"));
    }
    let full: AnalysisResult = from(&results[0]);
    assert_eq!(full.other_direction_min_fos, Some(None));
    assert_eq!(full.sliding_direction, Some(SlopeOrientation::Rtl));
    assert_eq!(full.critical_slices[0].base_material.name, "Clay");
}

fn factors() -> [Option<PartialFactors>; 3] {
    let swedish = swedish_partial_factors(&SwedishFactorBasis {
        safety_class: 2,
        eta_cu: 1.1,
        eta_drained: 1.0,
        variable_load_base: 1.4,
    })
    .unwrap();
    [None, Some(EC7_DA3_FACTORS), Some(swedish)]
}

#[test]
fn strength() {
    let cases: Value = common::load("types", "strength");
    let factors = factors();
    let mut n = 0;
    for c in cases.as_array().unwrap() {
        let model: MaterialModel = from(&c["model"]);
        let tag = c["model"].to_string();
        // the model itself round-trips
        json_eq(&to_value(&model), &c["model"], 0.0, &tag);
        let errors: Vec<String> = from(&c["validate"]);
        assert_eq!(validate_material_model(&model), errors, "{tag}");
        assert_eq!(
            needs_layer_top(&model),
            c["needsLayerTop"].as_bool().unwrap()
        );
        assert_eq!(suction_angle(&model), num(&c["suctionAngle"]));
        assert_eq!(
            is_combined_depth_model(&model),
            c["isCombinedDepthModel"].as_bool().unwrap()
        );
        assert_eq!(
            supports_anisotropy(model.kind()),
            c["supportsAnisotropy"].as_bool().unwrap()
        );
        assert_eq!(
            supports_suction_strength(model.kind()),
            c["supportsSuctionStrength"].as_bool().unwrap()
        );
        assert_eq!(material_model_label(model.kind()), c["label"].as_str());
        for at in c["at"].as_array().unwrap() {
            let ctx: StrengthContext = from(&at["ctx"]);
            let what = format!("{tag} at {}", at["ctx"]);
            match (resolve_strength(&model, &ctx), at["strength"].get("ok")) {
                (Ok(r), Some(want)) => {
                    json_eq(&to_value(&r), want, REL, &what);
                    for (f, d) in factors.iter().zip(at["design"].as_array().unwrap()) {
                        let got = design_strength(Some(model.kind()), &r, f.as_ref());
                        json_eq(&to_value(&got), d, REL, &format!("design {what}"));
                    }
                }
                (Err(e), None) => assert_eq!(e.message, at["strength"]["error"].as_str().unwrap()),
                (r, _) => panic!("{what}: {r:?} vs {}", at["strength"]),
            }
            let uw = resolve_unit_weight(&model, model.unit_weight(), ctx.x, ctx.y_bottom);
            assert!(
                close(uw, num(&at["unitWeight"]), REL),
                "{what}: unit weight"
            );
            let ss = suction_strength(&model, ctx.suction.unwrap_or(0.0));
            assert!(close(ss, num(&at["suction"]), REL), "{what}: suction");
            if let MaterialModel::Shansep(m) = &model {
                let su = shansep_su(m, ctx.y_bottom, ctx.y_ground, ctx.effective_vertical_stress);
                assert!(close(su, num(&at["shansepSu"]), REL), "{what}: shansep");
            }
            n += 1;
        }
    }
    assert!(n > 2000, "{n} cases");
}

#[test]
fn validation() {
    let cases: Value = common::load("types", "validation");
    for c in cases.as_array().unwrap() {
        let model: MaterialModel = from(&c["model"]);
        let errors: Vec<String> = from(&c["errors"]);
        assert_eq!(validate_material_model(&model), errors, "{}", c["model"]);
    }
}

#[test]
fn functions() {
    let f: Value = common::load("types", "functions");
    for c in f["shearNormal"].as_array().unwrap() {
        let MaterialModel::ShearNormal(m) = from::<MaterialModel>(&c["model"]) else {
            panic!("not a shear-normal model")
        };
        let got = shear_normal_at(&m.points, m.spline.as_ref(), num(&c["sn"]));
        json_eq(&to_value(&got), &c["out"], REL, "shearNormalAt");
    }
    for c in f["fns"].as_array().unwrap() {
        let pts: Vec<[f64; 2]> = c["pts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| [num(&p[0]), num(&p[1])])
            .collect();
        let got = interpolate_function(&pts, num(&c["x"]));
        let want = num(&c["out"]);
        assert!(
            got == want || (got.is_nan() && want.is_nan()),
            "interpolateFunction {} at {}",
            c["pts"],
            c["x"]
        );
    }
}

#[test]
fn hoek_brown() {
    let f: Value = common::load("types", "hoek_brown");
    for c in f["params"].as_array().unwrap() {
        let a: Vec<f64> = c["args"].as_array().unwrap().iter().map(num).collect();
        json_eq(
            &to_value(&hoek_brown_parameters(a[0], a[1], a[2], a[3])),
            &c["out"],
            REL,
            "hoekBrownParameters",
        );
    }
    for c in f["of"].as_array().unwrap() {
        let MaterialModel::HoekBrown(m) = from::<MaterialModel>(&c["model"]) else {
            panic!()
        };
        json_eq(&to_value(&hoek_brown_of(&m)), &c["out"], REL, "hoekBrownOf");
    }
    for c in f["inst"].as_array().unwrap() {
        let p: HoekBrownParameters = from(&c["p"]);
        for t in c["sigma3"].as_array().unwrap() {
            json_eq(
                &to_value(&instantaneous_at_sigma3(&p, num(&t["s3"]))),
                &t["out"],
                REL,
                "atSigma3",
            );
        }
        for t in c["sn"].as_array().unwrap() {
            json_eq(
                &to_value(&instantaneous_at_normal_stress(&p, num(&t["sn"]))),
                &t["out"],
                REL,
                "atNormalStress",
            );
        }
    }
}

fn opt(v: &Value, k: &str) -> Option<f64> {
    v.get(k).map(num)
}

fn opt_str(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|s| s.as_str()).map(String::from)
}

#[test]
fn materials_loads_and_factors() {
    let f: Value = common::load("types", "materials");
    for c in f["materials"].as_array().unwrap() {
        let p = &c["params"];
        let params = MaterialParams {
            unit_weight: opt(p, "unitWeight"),
            friction_angle: opt(p, "frictionAngle"),
            cohesion: opt(p, "cohesion"),
            cohesion_ref_depth: opt(p, "cohesionRefDepth"),
            cohesion_rate_of_change: opt(p, "cohesionRateOfChange"),
            cohesion_undrained: opt(p, "cohesionUndrained"),
            name: opt_str(p, "name"),
            color: opt_str(p, "color"),
            c_factor: opt(p, "cFactor"),
            model: p.get("model").map(from),
        };
        match (Material::new(params), c["out"].get("ok")) {
            (Ok(m), Some(want)) => {
                let mut got = to_value(&m);
                got["unitWeight"] = m.unit_weight().into();
                json_eq(&got, want, 0.0, &p.to_string());
            }
            (Err(e), None) => {
                assert_eq!(e.message, c["out"]["error"].as_str().unwrap());
                assert_eq!(
                    e.kind == cslope_engine::error::ErrorKind::Range,
                    c["out"]["range"].as_bool().unwrap()
                );
            }
            (r, _) => panic!("{p}: {r:?} vs {}", c["out"]),
        }
    }
    for c in f["udls"].as_array().unwrap() {
        let p = &c["params"];
        let u = Udl::new(UdlParams {
            magnitude: num(&p["magnitude"]),
            x1: num(&p["x1"]),
            x2: num(&p["x2"]),
            color: opt_str(p, "color"),
            direction: p.get("direction").map(from),
            excess_pore_pressure: p.get("excessPorePressure").map(from),
        });
        let o = &c["out"];
        assert_eq!(
            (u.magnitude, u.x1, u.x2, u.length),
            (
                num(&o["magnitude"]),
                num(&o["x1"]),
                num(&o["x2"]),
                num(&o["length"])
            )
        );
        assert_eq!(u.color, o["color"].as_str().unwrap());
        assert_eq!(to_value(&u.direction), o["direction"]);
        json_eq(
            &to_value(&u.excess_pore_pressure),
            &o["excessPorePressure"],
            0.0,
            "udl excess pore pressure",
        );
    }
    for c in f["lineLoads"].as_array().unwrap() {
        let p = &c["params"];
        let l = LineLoad::new(LineLoadParams {
            magnitude: num(&p["magnitude"]),
            x: num(&p["x"]),
            angle: opt(p, "angle"),
            y: opt(p, "y"),
            color: opt_str(p, "color"),
        });
        let o = &c["out"];
        assert_eq!(
            (l.magnitude, l.x, l.angle),
            (num(&o["magnitude"]), num(&o["x"]), num(&o["angle"]))
        );
        assert_eq!(l.y, opt(o, "y"));
        assert_eq!(l.color, o["color"].as_str().unwrap());
    }
    for c in f["definitions"].as_array().unwrap() {
        let m: SlopeMaterialDefinition = from(&c["m"]);
        match (material_model_of(&m), c["of"].get("ok")) {
            (Ok(model), Some(want)) => json_eq(&to_value(&model), want, 0.0, "materialModelOf"),
            (Err(e), None) => assert_eq!(e.message, c["of"]["error"].as_str().unwrap()),
            (r, _) => panic!("{r:?}"),
        }
        match (with_material_model(&m), c["with"].get("ok")) {
            (Ok(d), Some(want)) => json_eq(&to_value(&d), want, 0.0, "withMaterialModel"),
            (Err(e), None) => assert_eq!(e.message, c["with"]["error"].as_str().unwrap()),
            (r, _) => panic!("{r:?}"),
        }
    }
    for c in f["swedish"].as_array().unwrap() {
        let b = &c["basis"];
        let basis = SwedishFactorBasis {
            safety_class: b["safetyClass"].as_u64().unwrap() as u8,
            eta_cu: num(&b["etaCu"]),
            eta_drained: num(&b["etaDrained"]),
            variable_load_base: num(&b["variableLoadBase"]),
        };
        match (swedish_partial_factors(&basis), c["out"].get("ok")) {
            (Ok(pf), Some(want)) => json_eq(&to_value(&pf), want, 0.0, "swedishPartialFactors"),
            (Err(e), None) => assert_eq!(e.message, c["out"]["error"].as_str().unwrap()),
            (r, _) => panic!("{r:?}"),
        }
    }
    let d = &f["defaults"];
    json_eq(
        &to_value(&default_analysis_options()),
        &d["options"],
        0.0,
        "DEFAULT_ANALYSIS_OPTIONS",
    );
    json_eq(
        &to_value(&default_fem_settings()),
        &d["fem"],
        0.0,
        "DEFAULT_FEM_SETTINGS",
    );
    json_eq(
        &to_value(&EC7_DA3_FACTORS),
        &d["ec7"],
        0.0,
        "EC7_DA3_FACTORS",
    );
}
