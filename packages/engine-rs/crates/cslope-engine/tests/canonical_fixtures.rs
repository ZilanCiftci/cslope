//! Differential tests of model/canonical.rs and model/waternet.rs against
//! fixtures exported from the TypeScript engine under Node
//! (tools/fixtures/canonical.fixture.ts). Mirroring is arithmetic only: the
//! canonical definitions and mapped results compare exactly as JSON values
//! (keys and numbers), and so do the waternet pore pressures.

mod common;

use common::{close, num};
use cslope_engine::model::canonical::*;
use cslope_engine::model::waternet::{waternet_pore_pressure, Waternet};
use cslope_engine::types::{AnalysisLimits, AnalysisResult, SlopeDefinition};
use serde::Serialize;
use serde_json::Value;

fn is_numeric(v: &Value) -> bool {
    matches!(v, Value::Number(_) | Value::Null)
        || matches!(v, Value::String(s) if s == "NaN" || s == "Infinity" || s == "-Infinity")
}

/// The JSON Rust writes (`got`) against the JSON TypeScript wrote: the same
/// keys and values, numbers within `rel` (non-finite: `null` in Rust).
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
        (Value::Null, w) if is_numeric(w) => assert!(!num(w).is_finite(), "{path}: null vs {w}"),
        (g, w) if is_numeric(g) && is_numeric(w) && !g.is_null() => {
            assert!(close(num(g), num(w), rel), "{path}: {g} vs {w}")
        }
        (g, w) => assert_eq!(g, w, "at {path}"),
    }
}

fn to_value<T: Serialize>(t: &T) -> Value {
    serde_json::to_value(t).unwrap()
}

fn from<T: serde::de::DeserializeOwned>(v: &Value) -> T {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
}

/// `{ ok }` or `{ error }` of a function that can throw.
#[track_caller]
fn check(got: cslope_engine::error::Result<SlopeDefinition>, want: &Value, what: &str) {
    match (got, want.get("ok")) {
        (Ok(d), Some(w)) => json_eq(&to_value(&d), w, 0.0, what),
        (Err(e), None) => assert_eq!(e.message, want["error"].as_str().unwrap(), "{what}"),
        (r, _) => panic!("{what}: {r:?} vs {want}"),
    }
}

#[test]
fn canonical_definitions() {
    let cases: Value = common::load("canonical", "definitions");
    let cases = cases.as_array().unwrap();
    assert!(cases.len() > 150);
    for c in cases {
        let id = c["id"].as_str().unwrap();
        let def: SlopeDefinition = from(&c["definition"]);
        assert_eq!(
            to_value(&infer_orientation_from_coordinates(&def.coordinates)),
            c["orientation"],
            "{id}"
        );
        json_eq(
            &to_value(&get_domain_x(&def.coordinates)),
            &c["domain"],
            0.0,
            id,
        );
        let canonical = to_canonical_slope_definition(&def, None);
        if let Ok(cd) = &canonical {
            check(
                opposite_direction_definition(cd),
                &c["opposite"],
                &format!("{id} opposite"),
            );
        }
        check(canonical, &c["canonical"], &format!("{id} canonical"));

        let rtl: SlopeDefinition = from(&c["rtl"]);
        let canonical = to_canonical_slope_definition(&rtl, None);
        if let Ok(cd) = &canonical {
            check(
                opposite_direction_definition(cd),
                &c["oppositeRtl"],
                &format!("{id} opposite rtl"),
            );
        }
        check(
            canonical,
            &c["canonicalRtl"],
            &format!("{id} canonical rtl"),
        );
        check(
            to_canonical_slope_definition(&rtl, Some([-100.0, 250.0])),
            &c["axis"],
            &format!("{id} axis"),
        );
    }
}

#[test]
fn results_to_model_space() {
    let f: Value = common::load("canonical", "results");
    for (i, m) in f["maps"].as_array().unwrap().iter().enumerate() {
        let def: SlopeDefinition = from(&m["canonical"]);
        let result: AnalysisResult = from(&m["result"]);
        json_eq(
            &to_value(&map_analysis_result_to_model_space(&result, &def)),
            &m["out"],
            0.0,
            &format!("map {i}"),
        );
    }
    for l in f["limits"].as_array().unwrap() {
        let limits: AnalysisLimits = from(&l["limits"]);
        json_eq(
            &to_value(&mirror_limits(&limits, 0.0, 40.0)),
            &l["out"],
            0.0,
            "mirrorLimits",
        );
        assert_eq!(mirror_x(limits.entry_left_x, -3.5, 41.25), num(&l["x"]));
    }
}

#[test]
fn waternet_pore_pressures() {
    let cases: Value = common::load("canonical", "waternet");
    let mut n = 0;
    for c in cases.as_array().unwrap() {
        let wn: Waternet = from(&c["waternet"]);
        for p in c["at"].as_array().unwrap() {
            let (x, z) = (num(&p["x"]), num(&p["z"]));
            let u = waternet_pore_pressure(&wn, x, z);
            assert_eq!(u, num(&p["u"]), "{} at ({x}, {z})", c["waternet"]);
            n += 1;
        }
    }
    assert!(n > 1000, "{n} points");
}
