//! Shared code of the limit analysis and analysis tests (fem/lower_bound.rs,
//! upper_bound.rs, bound_adapt.rs, analysis.rs, summary.rs).
#![allow(dead_code, clippy::disallowed_methods)]

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slope::Slope;
use cslope_engine::types::SlopeDefinition;
use serde_json::Value;

#[path = "../fem_model_support/mod.rs"]
pub mod fem_model_support;

pub use fem_model_support::*;

/// The slope of a definition as the app gives it (canonicalised, as the TypeScript does).
pub fn slope_of_raw(def: &Value) -> Slope {
    let def: SlopeDefinition = serde_json::from_value(def.clone()).expect("definition");
    let canonical = to_canonical_slope_definition(&def, None).expect("canonical");
    build_slope(&canonical).expect("build_slope")
}

pub fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap_or_else(|| panic!("not an array: {v}"))
        .iter()
        .map(|s| s.as_str().expect("string").to_string())
        .collect()
}

/// A running maximum with where it was seen.
#[derive(Debug, Default, Clone)]
pub struct Max {
    pub value: f64,
    pub at: String,
}

impl Max {
    pub fn see(&mut self, v: f64, at: impl FnOnce() -> String) {
        if v > self.value || (v.is_nan() && !self.value.is_nan()) {
            self.value = v;
            self.at = at();
        }
    }
}

/// Largest relative differences seen: (rounded numbers, F, bounds).
#[derive(Default, Debug)]
pub struct JsonDiff {
    pub numbers: Max,
    pub bounds: Max,
}

fn strip_digits(s: &str) -> String {
    s.chars().filter(|c| !c.is_ascii_digit()).collect()
}

/// Compare two JSON values; `path` names the place.
pub fn cmp_json(path: &str, a: &Value, b: &Value, d: &mut JsonDiff) {
    let in_bounds = path.contains(".bounds");
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<&String> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                if k == "elapsedMs" {
                    continue;
                }
                let (va, vb) = (
                    x.get(k).unwrap_or(&Value::Null),
                    y.get(k).unwrap_or(&Value::Null),
                );
                assert!(
                    x.contains_key(k) == y.contains_key(k),
                    "{path}.{k}: present in one only ({va} / {vb})"
                );
                cmp_json(&format!("{path}.{k}"), va, vb, d);
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            assert_eq!(x.len(), y.len(), "{path}: length");
            for (i, (va, vb)) in x.iter().zip(y).enumerate() {
                cmp_json(&format!("{path}[{i}]"), va, vb, d);
            }
        }
        (Value::String(x), Value::String(y)) if in_bounds => {
            assert_eq!(strip_digits(x), strip_digits(y), "{path}");
        }
        _ if (a.is_number() || a.is_null() || a.is_string())
            && (b.is_number() || b.is_null() || b.is_string())
            && !(a.is_string() && b.is_string()) =>
        {
            if a.is_null() || b.is_null() {
                // (serde_json writes a non-finite number as null, as JSON.stringify;
                // the fixture keeps it as "Infinity" or "NaN")
                assert!(
                    a == b
                        || (a.is_null() && !num(b).is_finite())
                        || (b.is_null() && !num(a).is_finite()),
                    "{path}: {a} vs {b}"
                );
                return;
            }
            let (x, y) = (num(a), num(b));
            let r = rel(x, y, 0.0);
            if in_bounds && (path.ends_with(".lower") || path.ends_with(".upper")) {
                d.bounds.see(r, || format!("{path}: {x} vs {y}"));
                assert!(r <= 1e-4, "{path}: {x} vs {y}");
            } else {
                d.numbers.see(r, || format!("{path}: {x} vs {y}"));
                assert!(r <= 1e-6 || (x - y).abs() <= 1e-12, "{path}: {x} vs {y}");
            }
        }
        _ => assert_eq!(a, b, "{path}"),
    }
}

/// True when the per-problem limit analysis fixtures are not exported
/// (CSLOPE_FEMA_PARTS without bounds/analysis/summary, as CI's quick Rust
/// job does: exporting them takes hours). Those tests then pass vacuously
/// with a note; the unit fixtures (`units`) are always exported.
pub fn heavy_fixtures_skipped() -> bool {
    match std::env::var("CSLOPE_FEMA_PARTS") {
        Ok(parts)
            if !parts
                .split(',')
                .any(|p| p == "bounds" || p == "analysis" || p == "summary") =>
        {
            eprintln!(
                "skipped: CSLOPE_FEMA_PARTS={parts} (no per-problem limit analysis fixtures)"
            );
            true
        }
        _ => false,
    }
}
