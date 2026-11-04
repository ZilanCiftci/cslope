//! Runs the verification analyses of one problem natively (a debugging
//! aid): `cargo run --release --example run_check -- V050b [filter]`, the
//! filter a substring of the check's options.
use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::SlopeDefinition;
use serde_json::Value;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let id = &args[1];
    let filter = args.get(2).cloned().unwrap_or_default();
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../golden/verification.json"
    );
    let mut golden: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let cases: Vec<Value> = serde_json::from_value(golden["cases"].take()).unwrap();
    let c = cases
        .iter()
        .find(|c| c["id"] == id.as_str())
        .expect("the problem");
    for k in c["checks"].as_array().unwrap() {
        if !k["options"].to_string().contains(&filter) {
            continue;
        }
        let def: SlopeDefinition = serde_json::from_value(c["definition"].clone()).unwrap();
        let mut slope = build_slope(&to_canonical_slope_definition(&def, None).unwrap()).unwrap();
        let patch: AnalysisOptionsPatch = serde_json::from_value(k["options"].clone()).unwrap();
        slope.update_analysis_options(&patch).unwrap();
        let t0 = Instant::now();
        let fos = analyse_slope(&mut slope, &mut RunCtx::default());
        println!(
            "{id} {}: {:?} (published {}, tolerance {}) {} planes, {:.0} ms",
            k["label"],
            fos,
            k["published"],
            k["tolerance"],
            slope.search().len(),
            t0.elapsed().as_secs_f64() * 1000.0
        );
    }
}
