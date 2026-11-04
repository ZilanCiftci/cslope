//! Shared helpers of the tests: numbers from JSON, relative closeness, the
//! verification problems of golden/verification.json. Include with `mod common;`.
#![allow(dead_code, clippy::disallowed_methods)]

use serde::de::DeserializeOwned;
use serde_json::Value;
use std::path::PathBuf;

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

/// The verification problems with their checks (each check's options as
/// verificationOptions merges them), from golden/verification.json
/// (tools/golden.ts).
pub fn verification_cases<T: DeserializeOwned>() -> T {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../golden/verification.json");
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let mut v: Value = serde_json::from_str(&text).expect("golden JSON");
    serde_json::from_value(v["cases"].take()).expect("the verification cases")
}
