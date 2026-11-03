//! Shared helpers for the differential tests against fixtures exported from
//! the TypeScript engine (see PORTING.md). Include with `mod common;`.
#![allow(dead_code, clippy::disallowed_methods)]

use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::PathBuf;

/// Path of fixtures/<area>/<name>.json.
pub fn fixture_path(area: &str, name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(area)
        .join(format!("{name}.json"))
}

/// Loads a fixture, decoding "NaN"/"Infinity"/"-Infinity" strings in numeric
/// positions is left to `num`/`JsNum`. Panics with a hint when the fixture
/// has not been exported.
pub fn load<T: DeserializeOwned>(area: &str, name: &str) -> T {
    let path = fixture_path(area, name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|_| {
        panic!(
            "missing fixture {}: run `cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts {area}`",
            path.display()
        )
    });
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("bad fixture {}: {e}", path.display()))
}

/// A JSON number or one of the non-finite strings, as f64.
pub fn num(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap(),
        Value::String(s) if s == "NaN" => f64::NAN,
        Value::String(s) if s == "Infinity" => f64::INFINITY,
        Value::String(s) if s == "-Infinity" => f64::NEG_INFINITY,
        Value::Null => f64::NAN,
        other => panic!("not a number: {other}"),
    }
}

/// Relative closeness with NaN == NaN and equal infinities.
pub fn close(a: f64, b: f64, rel: f64) -> bool {
    if a.is_nan() || b.is_nan() {
        return a.is_nan() && b.is_nan();
    }
    if a == b {
        return true;
    }
    (a - b).abs()
        <= rel
            * cslope_engine::js::math::max(cslope_engine::js::math::max(a.abs(), b.abs()), 1e-300)
}

#[track_caller]
pub fn assert_close(a: f64, b: f64, rel: f64, what: &str) {
    assert!(close(a, b, rel), "{what}: {a} vs {b} (rel {rel})");
}
