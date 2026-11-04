//! Shared code of the finite element model tests (fem/model.rs, srm.rs, …):
//! building the slope and the model of a case, and comparing
//! numbers with the tolerance policy's relative 1e-9.
#![allow(dead_code, clippy::disallowed_methods)]

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::types::SlopeDefinition;
use serde_json::Value;

#[path = "../common/mod.rs"]
pub mod common;

#[allow(unused_imports)] // (used by fem_analysis_unit)
pub use common::num;

/// The slope of a fixture case: its (canonical) definition, then its analysis options.
pub fn slope_of(case: &Value) -> Slope {
    let def: SlopeDefinition =
        serde_json::from_value(case["definition"].clone()).expect("definition");
    let mut slope = build_slope(&def).expect("build_slope");
    if let Some(o) = case.get("analysisOptions").filter(|v| !v.is_null()) {
        let patch: AnalysisOptionsPatch =
            serde_json::from_value(o.clone()).expect("analysisOptions");
        slope.update_analysis_options(&patch).expect("options");
    }
    slope
}

/// Largest relative difference seen, and how many numbers differ at all.
#[derive(Debug, Default, Clone)]
pub struct Diff {
    pub numbers: usize,
    pub differing: usize,
    pub max_rel: f64,
    pub at: String,
}

impl Diff {
    pub fn merge(&mut self, o: &Diff) {
        self.numbers += o.numbers;
        self.differing += o.differing;
        if o.max_rel > self.max_rel {
            self.max_rel = o.max_rel;
            self.at = o.at.clone();
        }
    }
}

/// Relative difference of two numbers, measured against the larger of
/// their magnitudes and `floor` (NaN equal to NaN, equal infinities 0).
pub fn rel(a: f64, b: f64, floor: f64) -> f64 {
    if a.is_nan() && b.is_nan() {
        return 0.0;
    }
    if a == b {
        return 0.0;
    }
    if a.is_nan() || b.is_nan() || a.is_infinite() || b.is_infinite() {
        return f64::INFINITY;
    }
    (a - b).abs() / a.abs().max(b.abs()).max(floor).max(1e-300)
}

/// The digest the fixture writes for a long vector.
pub fn digest(a: &[f64]) -> [f64; 4] {
    let (mut s, mut s1, mut s2, mut w) = (0.0, 0.0, 0.0, 0.0);
    for (i, &v) in a.iter().enumerate() {
        s += v;
        s1 += v.abs();
        s2 += v * v;
        w += v * ((i % 97) as f64 + 1.0);
    }
    [s, s1, s2, w]
}

/// Print a summary line.
pub fn report(what: &str, d: &Diff) {
    eprintln!(
        "{what}: {} numbers, {} not bit-identical, max rel {:e}{}",
        d.numbers,
        d.differing,
        d.max_rel,
        if d.at.is_empty() {
            String::new()
        } else {
            format!(" at {}", d.at)
        }
    );
}
