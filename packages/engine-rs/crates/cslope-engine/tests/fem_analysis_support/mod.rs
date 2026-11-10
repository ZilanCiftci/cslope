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

fn strip_digits(s: &str) -> String {
    s.chars().filter(|c| !c.is_ascii_digit()).collect()
}
