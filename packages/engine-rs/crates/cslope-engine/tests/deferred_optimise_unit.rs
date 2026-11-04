//! The tests PORTING.md deferred to the optimisation, reliability and sgi3d
//! port: result-warnings.test.ts "is flagged for Bishop after the
//! non-circular optimisation", search-review-c2.test.ts V050b and V051,
//! review-fixes.test.ts "keeps the V002 non-circular Spencer search within
//! the published range", "samples V061's printed surface" and the strength
//! cutoff with reliability, normal-load.test.ts "enters the SGI 3D driving
//! moment".
#![allow(clippy::disallowed_methods)]

mod common;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::reliability::{analyse_reliability, RandomVariable, ReliabilityOptions};
use cslope_engine::model::result_warnings::analysis_warnings;
use cslope_engine::model::sgi3d::sgi3d_factor_of_safety;
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::analysis::AnalysisWarningCode;
use cslope_engine::types::constants::WATER_UNIT_WEIGHT;
use cslope_engine::types::sgi3d::Sgi3dOptions;
use cslope_engine::types::SlopeDefinition;
use serde_json::{json, Value};
use solvers_support::*;

fn case(id: &str) -> Value {
    let cases: Vec<Value> = common::verification_cases();
    cases.into_iter().find(|c| c["id"] == id).unwrap()
}

#[test]
fn is_flagged_for_bishop_after_the_non_circular_optimisation() {
    let mut circle_only = case("V046a")["definition"].clone();
    circle_only
        .as_object_mut()
        .unwrap()
        .remove("customSurfaces");
    circle_only["customPlanesOnly"] = json!(false);
    let (_, slope) = run_verification(
        circle_only,
        "Bishop",
        json!({ "iterations": 200, "refinedIterations": 0, "nonCircularOptimization": true }),
    );
    // The optimised surface follows the weak seam.
    assert!(slope
        .search()
        .iter()
        .find(|p| p.fos.is_some())
        .unwrap()
        .points
        .is_some());
    assert!(analysis_warnings(&slope, None)
        .unwrap()
        .iter()
        .any(|w| w.code == AnalysisWarningCode::BishopNonCircular));
}

fn optimised(id: &str) -> f64 {
    let c = case(id);
    let check = c["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["options"]["nonCircularOptimization"] == json!(true))
        .unwrap()
        .clone();
    // (the fixture's options are verificationOptions' already)
    let def: SlopeDefinition = serde_json::from_value(c["definition"].clone()).unwrap();
    let mut slope = build_slope(&to_canonical_slope_definition(&def, None).unwrap()).unwrap();
    let patch: AnalysisOptionsPatch = serde_json::from_value(check["options"].clone()).unwrap();
    slope.update_analysis_options(&patch).unwrap();
    analyse_slope(&mut slope, &mut RunCtx::default())
        .unwrap()
        .unwrap()
}

// Restarting the optimisation from its result lowered V050b from 1.2282
// to 1.2249 and V051 from 0.6975 to 0.6950: the search stopped while a
// cycle still gained more than the tolerance (0.001). V051 is checked
// with the phreatic correction since (0.7137; vertical head 0.6950).
#[test]
fn v050b_reaches_the_minimum_found_by_restarting_from_the_result() {
    assert!(optimised("V050b") < 1.2249 + 0.001);
}

#[test]
fn v051_reaches_the_minimum_found_by_restarting_from_the_result() {
    assert!(optimised("V051") < 0.7137 + 0.001);
}

#[test]
fn keeps_the_v002_non_circular_spencer_search_within_the_published_range() {
    // A commercial program 0.414, literature 0.39–0.44; the spurious
    // intersections gave 0.27–0.39 with exit segments of −60° and steeper.
    let (fos, slope) = run_verification(
        case("V002")["definition"].clone(),
        "Morgenstern-Price",
        json!({ "intersliceFunction": "constant", "nonCircularOptimization": true }),
    );
    let fos = fos.unwrap();
    assert!(fos > 0.39 && fos < 0.44, "{fos}");
    let points = slope
        .search()
        .iter()
        .find(|p| p.fos.is_some())
        .unwrap()
        .points
        .clone()
        .unwrap();
    let (a, b) = (points[points.len() - 2], points[points.len() - 1]);
    let exit_deg = (b[1] - a[1]).atan2(b[0] - a[0]).to_degrees();
    assert!(exit_deg < 45.0);
}

fn reliability(
    def: &Value,
    options: Value,
    vars: Value,
    ro: Value,
) -> cslope_engine::model::reliability::ReliabilityResult {
    let d: SlopeDefinition = serde_json::from_value(def.clone()).unwrap();
    let o: AnalysisOptionsPatch = serde_json::from_value(options).unwrap();
    let v: Vec<RandomVariable> = serde_json::from_value(vars).unwrap();
    let r: ReliabilityOptions = serde_json::from_value(ro).unwrap();
    analyse_reliability(&d, &o, &v, &r, &mut RunCtx::default()).unwrap()
}

#[test]
fn samples_v061s_printed_surface() {
    let c = case("V061");
    let def: SlopeDefinition = serde_json::from_value(c["definition"].clone()).unwrap();
    let canonical =
        serde_json::to_value(to_canonical_slope_definition(&def, None).unwrap()).unwrap();
    // `{ ...vp34.checks[0].options, method: "Morgenstern-Price", intersliceFunction: "constant" }`
    // (the check's own options: the fixture holds them merged with the
    // verification settings, which leave only the search settings apart)
    let mut options = c["checks"][0]["options"].clone();
    options["method"] = json!("Morgenstern-Price");
    options["intersliceFunction"] = json!("constant");
    let r = reliability(
        &canonical,
        options,
        json!([{ "material": 0, "field": "cohesion", "sd": 1e-6 }]),
        json!({ "method": "monte-carlo", "samples": 20 }),
    );
    assert_eq!(r.failed, 0);
    assert_eq!(r.samples.as_ref().unwrap().len(), 20);
    assert!((r.mean_fos - r.fos).abs() < 5e-7);
}

#[test]
fn a_strength_cutoff_floor_is_valid_for_reliability_with_varied_values() {
    // S = f(datum) 30 kPa at y = 0, decreasing 0.5 kPa/m downwards, floor 25:
    // Taylor's mean − σ (24 kPa) used to fail validation and abort the run.
    let def = json!({
        "coordinates": [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]],
        "materials": [{ "name": "Clay", "unitWeight": 18, "frictionAngle": 0, "cohesion": 0,
            "model": { "kind": "s-f-datum", "unitWeight": 18, "suRef": 30, "yRef": 0, "rate": -0.5, "suMax": 25 } }],
        "materialBoundaries": [],
        "regionAssignments": [{ "point": [5, 0], "materialName": "Clay" }],
    });
    let r = reliability(
        &def,
        json!({ "method": "Bishop", "iterations": 300, "refinedIterations": 100 }),
        json!([{ "material": 0, "field": "suRef", "sd": 6 }]),
        json!({ "method": "taylor", "search": false }),
    );
    assert!(r.fos.is_finite());
    assert!(r.terms.as_ref().unwrap()[0].f_minus > 0.0);
}

// ── normal-load.test.ts ───────────────────────────────────────────

fn ground_at(x: f64) -> f64 {
    if x <= 10.0 {
        10.0
    } else if x >= 20.0 {
        5.0
    } else {
        10.0 - (x - 10.0) / 2.0
    }
}

fn base(udls: Value) -> Value {
    json!({
        "orientation": "ltr",
        "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
        "materials": [{ "name": "clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 20 } }],
        "regionAssignments": [{ "point": [15, 2], "materialName": "clay" }],
        "customSearchPlanes": [{ "cx": 14, "cy": 16, "radius": 12 }],
        "customPlanesOnly": true,
        "udls": udls,
    })
}

/// Water to level h as distributed loads γw·(h − ground) in strips of width dx.
fn pond(h: f64, from: f64, to: f64, dx: f64, direction: &str) -> Value {
    let mut out = Vec::new();
    let mut x = from;
    while x < to - 1e-9 {
        let d = h - ground_at(x + dx / 2.0);
        if d > 0.0 {
            out.push(json!({ "magnitude": WATER_UNIT_WEIGHT * d, "x1": x, "x2": to.min(x + dx), "direction": direction }));
        }
        x += dx;
    }
    Value::Array(out)
}

#[test]
fn a_normal_load_enters_the_sgi3d_driving_moment() {
    let run = |def: Value| -> f64 {
        let d: SlopeDefinition = serde_json::from_value(def).unwrap();
        let mut s: Slope = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
        let p: AnalysisOptionsPatch =
            serde_json::from_value(json!({ "method": "Morgenstern-Price", "slices": 30 })).unwrap();
        s.update_analysis_options(&p).unwrap();
        analyse_slope(&mut s, &mut RunCtx::default()).unwrap();
        sgi3d_factor_of_safety(
            &s,
            &Sgi3dOptions {
                length: 10.0,
                overstrong_f2d: None,
                exclude_materials: None,
                cell_size: None,
            },
        )
        .unwrap()
        .unwrap()
        .factor_of_safety
    };
    let flat = json!({ "magnitude": 30, "x1": 2, "x2": 8 });
    let mut normal = flat.clone();
    normal["direction"] = json!("normal");
    let a = run(base(json!([normal])));
    let b = run(base(json!([flat])));
    assert!((a - b).abs() < 5e-9);
    let n = run(base(pond(8.0, 14.0, 30.0, 0.1, "normal")));
    let v = run(base(pond(8.0, 14.0, 30.0, 0.1, "vertical")));
    // the thrust into the slope lowers the driving moment: a higher F3D
    assert!(n > v + 0.005);
}
