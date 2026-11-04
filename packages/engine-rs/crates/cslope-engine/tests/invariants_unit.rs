//! Property-based invariants on the seeded random models of
//! model/property_helpers.rs: invariants-search.test.ts and
//! invariants-paths.test.ts ported (same seeds, same cases, same bounds).
#![allow(clippy::disallowed_methods)]

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::{
    map_analysis_result_to_model_space, to_canonical_slope_definition,
};
use cslope_engine::model::property_helpers::*;
use cslope_engine::model::slope::{AnalysisOptionsPatch, SearchPlane};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::model::surface::circle_to_polyline;
use cslope_engine::types::analysis::{AnalysisMethod, AnalysisResult, SlipSurfaceResult};
use serde_json::{json, Value};

fn search_options() -> Value {
    spread(
        &property_options(),
        &json!({ "slices": 25, "iterations": 200, "refinedIterations": 40 }),
    )
}

fn search(def: &Value, method: Method, extra: Value) -> (Option<f64>, SearchPlane) {
    let canonical = to_canonical_slope_definition(&definition(def).unwrap(), None).unwrap();
    let mut slope = build_slope(&canonical).unwrap();
    let mut o = spread(&search_options(), &extra);
    o["method"] = json!(if method == "Ordinary" {
        "Bishop"
    } else {
        method
    });
    let p: AnalysisOptionsPatch = serde_json::from_value(o).unwrap();
    slope.update_analysis_options(&p).unwrap();
    let fos = analyse_slope(&mut slope, &mut RunCtx::default()).unwrap();
    (fos, slope.search()[0].clone())
}

fn circle_of(p: &SearchPlane) -> Circle {
    Circle {
        cx: p.cx,
        cy: p.cy,
        radius: p.radius,
    }
}

#[test]
fn the_critical_circle_re_analysed_alone_gives_the_reported_fos() {
    let mut r = rng(4040.0);
    for i in 0..4 {
        let g = random_case(
            &mut r,
            &GenerateOptions {
                water: i % 2 == 1,
                ..Default::default()
            },
        )
        .unwrap();
        let mut def = g.def.clone();
        if i % 3 == 0 {
            def["udls"] = json!([{ "magnitude": 15, "x1": 1, "x2": g.shape.crest - 1.0 }]);
        }
        for method in ["Bishop", "Morgenstern-Price"] {
            let (fos, best) = search(&on_circle(&def, &g.circle), method, json!({}));
            let fos = fos.unwrap_or_else(|| panic!("seed 4040 case {i} {method}"));
            let again = fos_of(
                &on_circle(&def, &circle_of(&best)),
                method,
                &json!({ "slices": 25 }),
            )
            .unwrap()
            .unwrap();
            assert!(
                rel_diff(again, fos) < 1e-6,
                "seed 4040 case {i} {method}: {again} vs {fos}"
            );
            if let Some(custom) = fos_of(
                &on_circle(&def, &g.circle),
                method,
                &json!({ "slices": 25 }),
            )
            .unwrap()
            {
                assert!(fos <= custom * (1.0 + 1e-9));
            }
        }
    }
}

#[test]
fn an_optimised_surface_re_analysed_about_its_axis_gives_the_reported_fos() {
    let mut r = rng(4041.0);
    for i in 0..2 {
        let g = random_case(
            &mut r,
            &GenerateOptions {
                layers: Some(2),
                ..Default::default()
            },
        )
        .unwrap();
        let (fos, best) = search(
            &g.def,
            "Morgenstern-Price",
            json!({ "nonCircularOptimization": true }),
        );
        let fos = fos.unwrap();
        let Some(points) = &best.points else { continue };
        let again = fos_of(
            &on_polyline(&g.def, points, Some([best.cx, best.cy])),
            "Morgenstern-Price",
            &json!({ "slices": 25 }),
        )
        .unwrap()
        .unwrap();
        assert!(
            rel_diff(again, fos) < 1e-4,
            "seed 4041 case {i}: {again} vs {fos}"
        );
    }
}

#[test]
fn a_mirrored_model_finds_the_mirrored_minimum() {
    let mut r = rng(4042.0);
    for i in 0..4 {
        let g = random_case(&mut r, &GenerateOptions::default()).unwrap();
        let x_max = g.def["coordinates"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c[0].as_f64().unwrap())
            .fold(f64::NEG_INFINITY, f64::max);
        // Mirror onto the same domain: the canonical model is the original one.
        let mirrored = mirror_definition(&g.def, x_max / 2.0);
        for method in ["Bishop", "Janbu"] {
            let (a, _) = search(&g.def, method, json!({}));
            let (b, best) = search(&mirrored, method, json!({}));
            let (a, b) = (a.unwrap(), b.unwrap());
            // The search is chaotic in the last bits (many near-equal surfaces).
            assert!(
                rel_diff(a, b) < 5e-3,
                "seed 4042 case {i} {method}: {a} vs {b}"
            );
            let canonical =
                to_canonical_slope_definition(&definition(&mirrored).unwrap(), None).unwrap();
            let result = AnalysisResult {
                min_fos: b,
                max_fos: b,
                critical_surface: Some(SlipSurfaceResult {
                    cx: best.cx,
                    cy: best.cy,
                    radius: best.radius,
                    fos: b,
                    entry_point: best.lc,
                    exit_point: best.rc,
                    converged: None,
                    closest_pair: None,
                    lff_array: None,
                    equilibrium_gap: None,
                    points: None,
                    composite: None,
                    reinforcement_forces: None,
                    crack: None,
                }),
                all_surfaces: vec![],
                critical_slices: vec![],
                method: if method == "Bishop" {
                    AnalysisMethod::Bishop
                } else {
                    AnalysisMethod::Janbu
                },
                critical_lff_array: None,
                critical_pushing_moment: None,
                critical_resisting_moment: None,
                critical_slip_volume: None,
                elapsed_ms: 0.0,
                non_converged_surfaces: None,
                split_failure_count: None,
                warnings: None,
                discarded_by_size: None,
                sliding_direction: None,
                other_direction_min_fos: None,
                fem: None,
                sgi3d: None,
                sgi3d_error: None,
                fem_error: None,
            };
            let mapped = map_analysis_result_to_model_space(&result, &canonical)
                .critical_surface
                .unwrap();
            assert!((mapped.cx - (x_max - best.cx)).abs() < 5e-10);
            assert!(mapped.entry_point[0] > mapped.exit_point[0]);
            let back = fos_of(
                &on_circle(
                    &mirrored,
                    &Circle {
                        cx: mapped.cx,
                        cy: mapped.cy,
                        radius: mapped.radius,
                    },
                ),
                method,
                &json!({ "slices": 25 }),
            )
            .unwrap()
            .unwrap();
            assert!(rel_diff(back, b) < 1e-6, "case {i} {method} mapped");
        }
    }
}

const METHODS: [Method; 4] = ["Ordinary", "Bishop", "Janbu", "Morgenstern-Price"];

#[test]
fn a_circle_as_a_fine_polyline_about_its_centre_gives_the_circles_fos() {
    let mut r = rng(8080.0);
    let mut compared = 0;
    let feature_sets: [&[&str]; 4] = [&["water"], &["udl"], &["nail"], &["pile"]];
    for i in 0..12 {
        let g = random_case(&mut r, &GenerateOptions::default()).unwrap();
        let features = feature_sets[i % 4];
        let def = decorate(&mut r, &g, features);
        let Circle { cx, cy, radius } = g.circle;
        let y_in = g.shape.h;
        let lc = [cx - (radius.powi(2) - (y_in - cy).powi(2)).sqrt(), y_in];
        let x_toe = g.shape.crest + g.shape.run;
        // Exit on the toe (y = 0) or on the face.
        let x_out0 = cx + (radius.powi(2) - cy.powi(2)).sqrt();
        let rc = if x_out0 >= x_toe {
            [x_out0, 0.0]
        } else {
            // Bisection for the crossing with the face.
            let mut lo = cx.max(g.shape.crest);
            let mut hi = x_toe;
            let f = |x: f64| {
                cy - (radius.powi(2) - (x - cx).powi(2)).sqrt()
                    - g.shape.h * (1.0 - (x - g.shape.crest) / g.shape.run)
            };
            for _ in 0..80 {
                let mid = (lo + hi) / 2.0;
                if f(mid) < 0.0 {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            [hi, cy - (radius.powi(2) - (hi - cx).powi(2)).sqrt()]
        };
        let poly = circle_to_polyline(cx, cy, radius, lc, rc, 401);
        for method in METHODS {
            let a = fos_of(
                &on_circle(&def, &g.circle),
                method,
                &json!({ "slices": 400 }),
            )
            .unwrap();
            let b = fos_of(
                &on_polyline(&def, &poly, Some([cx, cy])),
                method,
                &json!({ "slices": 400 }),
            )
            .unwrap();
            assert_eq!(b.is_none(), a.is_none(), "seed 8080 case {i} {method}");
            if let (Some(a), Some(b)) = (a, b) {
                // Chords instead of the arc (400 of them, one slice each).
                assert!(
                    rel_diff(a, b) < 5e-4,
                    "seed 8080 case {i} {method} {features:?}: {a} vs {b}"
                );
                compared += 1;
            }
        }
    }
    assert!(compared > 36);
}

#[test]
fn a_line_load_equals_a_narrow_distributed_load() {
    let mut r = rng(8081.0);
    for i in 0..10 {
        let g = random_case(
            &mut r,
            &GenerateOptions {
                layers: Some(1),
                ..Default::default()
            },
        )
        .unwrap();
        let p = uniform(&mut r, 20.0, 120.0);
        let x = uniform(&mut r, 0.3, 0.9) * g.shape.crest;
        let w = 0.02;
        let line = on_circle(
            &spread(
                &g.def,
                &json!({ "lineLoads": [{ "magnitude": p, "x": x }] }),
            ),
            &g.circle,
        );
        let udl = on_circle(
            &spread(
                &g.def,
                &json!({ "udls": [{ "magnitude": p / w, "x1": x - w / 2.0, "x2": x + w / 2.0 }] }),
            ),
            &g.circle,
        );
        for method in METHODS {
            let a = fos_of(&line, method, &json!({ "slices": 50 }))
                .unwrap()
                .unwrap();
            let b = fos_of(&udl, method, &json!({ "slices": 50 }))
                .unwrap()
                .unwrap();
            assert!(
                rel_diff(a, b) < 1e-4,
                "seed 8081 case {i} {method}: {a} vs {b}"
            );
        }
    }
}
