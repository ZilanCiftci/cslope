//! summarize_result (api/summary.rs, issue #55): F is a factor of safety on
//! characteristic values and an over-design factor on design values, with
//! the partial factors and their basis.
#![allow(clippy::disallowed_methods)]

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::api::run_analysis::run_analysis;
use cslope_engine::api::summary::{summarize_result, FosLabel, ValueBasis};
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::types::analysis::{
    public_default_options, swedish_partial_factors, SwedishFactorBasis,
};
use cslope_engine::types::SlopeDefinition;
use serde_json::json;

fn definition() -> SlopeDefinition {
    serde_json::from_value(json!({
        "coordinates": [[0, 0], [0, 15], [15, 15], [35, 5], [50, 5], [50, 0]],
        "materials": [{"name": "Clay", "model": {"kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 40}}],
        "udls": [{"magnitude": 10, "x1": 5, "x2": 12}]
    }))
    .unwrap()
}

fn quick(o: AnalysisOptionsPatch) -> AnalysisOptionsPatch {
    public_default_options().merged(&AnalysisOptionsPatch {
        iterations: Some(500.0),
        refined_iterations: Some(0.0),
        ..o
    })
}

#[test]
fn characteristic_values_give_a_factor_of_safety() {
    let o = quick(AnalysisOptionsPatch::default());
    let r = run_analysis(&definition(), &o, &mut RunCtx::default()).unwrap();
    let s = summarize_result(&r, &o, "test");
    assert_eq!(s.fos_label, FosLabel::FactorOfSafety);
    assert_eq!(s.value_basis, ValueBasis::Characteristic);
    assert!(s.partial_factors.is_none());
    assert_eq!(s.fos, Some(r.min_fos));
    assert!(
        s.method
            .starts_with("Morgenstern-Price (complete equilibrium), interslice function half-sine"),
        "{}",
        s.method
    );
    let cs = s.critical_surface.expect("a critical surface");
    assert!(cs.entry[0] < cs.exit[0]);
    assert_eq!(s.engine_build, "test");
    let v = serde_json::to_value(summarize_result(&r, &o, "test")).unwrap();
    assert_eq!(v["fosLabel"], "factor of safety");
    assert_eq!(v["valueBasis"], "characteristic");
    assert!(v["bothDirections"].is_null());
}

#[test]
fn swedish_partial_factors_give_an_over_design_factor() {
    let pf = swedish_partial_factors(&SwedishFactorBasis {
        safety_class: 2,
        eta_cu: 1.0,
        eta_drained: 1.0,
        variable_load_base: 1.4,
    })
    .unwrap();
    let o = quick(AnalysisOptionsPatch {
        partial_factors: Some(Some(pf)),
        both_directions: Some(true),
        ..Default::default()
    });
    let r = run_analysis(&definition(), &o, &mut RunCtx::default()).unwrap();
    let s = summarize_result(&r, &o, "test");
    assert_eq!(s.fos_label, FosLabel::OverDesignFactor);
    assert_eq!(s.value_basis, ValueBasis::Design);
    assert_eq!(s.fos_heading, "Over-design factor (design values)");
    let f = s.partial_factors.clone().expect("the factors");
    assert_eq!(f.cu, 1.5);
    assert_eq!(f.gamma_d, Some(0.91));
    assert_eq!(f.basis.as_ref().unwrap().safety_class, 2);
    assert!(f.text.contains("safety class 2"), "{}", f.text);
    assert!(s.both_directions.is_some());
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["fosLabel"], "over-design factor");
    assert_eq!(v["partialFactors"]["basis"]["etaCu"], 1.0);
}

#[test]
fn the_result_records_the_partial_factors() {
    let pf = swedish_partial_factors(&SwedishFactorBasis {
        safety_class: 3,
        eta_cu: 1.0,
        eta_drained: 1.0,
        variable_load_base: 1.3,
    })
    .unwrap();
    let o = quick(AnalysisOptionsPatch {
        partial_factors: Some(Some(pf.clone())),
        ..Default::default()
    });
    let r = run_analysis(&definition(), &o, &mut RunCtx::default()).unwrap();
    assert_eq!(r.partial_factors.as_ref(), Some(&pf));
    // summarized without the options: still an over-design factor
    let s = summarize_result(&r, &AnalysisOptionsPatch::default(), "test");
    assert_eq!(s.fos_label, FosLabel::OverDesignFactor);
    assert_eq!(s.value_basis, ValueBasis::Design);
    // a characteristic run records none
    let o = quick(AnalysisOptionsPatch::default());
    let r = run_analysis(&definition(), &o, &mut RunCtx::default()).unwrap();
    assert!(r.partial_factors.is_none());
    assert!(serde_json::to_value(&r)
        .unwrap()
        .get("partialFactors")
        .is_none());
}
