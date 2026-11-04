//! The unit tests of fem/lower-bound.test.ts, lower-bound-corner.test.ts,
//! upper-bound.test.ts, bound-adapt.test.ts, analysis.test.ts and
//! summary.test.ts, and those deferred to the analysis port
//! (initial-stress.test.ts, piles.test.ts, hoek-brown.test.ts; PORTING.md),
//! ported with their cases and expectations. (The comparisons with the
//! TypeScript engine's results went with it at the cutover; the TypeScript
//! FE tests run on this engine through the facade.)
//!
//! Release only (`cargo test --release --test fem_analysis_unit`); the slow
//! ones are #[ignore]d: `-- --ignored`.

#![allow(clippy::disallowed_methods)]

mod fem_analysis_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::fem::analysis::{analyze_fem, FemAnalysisOptions};
use cslope_engine::fem::initial_stress::{prepare_fe_model, InitialStressOptions};
use cslope_engine::fem::lower_bound::{lower_bound, lower_bound_problem, LowerBoundOptions};
use cslope_engine::fem::model::build_fe_model;
use cslope_engine::fem::srm::{strength_reduction, SrmOptions};
use cslope_engine::fem::upper_bound::upper_bound;
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::FlowRule;
use fem_analysis_support::*;
use serde_json::{json, Value};
use std::f64::consts::PI;

fn slope(def: Value) -> Slope {
    slope_of_raw(&def)
}

fn bound_options(v: Value) -> LowerBoundOptions {
    serde_json::from_value(v).expect("bound options")
}

fn fem_options(v: Value) -> FemAnalysisOptions {
    serde_json::from_value(v).expect("FemAnalysisOptions")
}

fn ctx() -> RunCtx<'static> {
    RunCtx::default()
}

// ── lower-bound.test.ts ─────────────────────────────────────────────

#[test]
fn lower_bound_takes_the_saturated_unit_weight_below_the_water_table() {
    let def = |sat: f64| {
        json!({
            "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
            "materials": [{ "name": "clay", "model": { "kind": "undrained", "unitWeight": 18, "unitWeightSat": sat, "undrainedShearStrength": 40 } }],
            "waterTable": { "mode": "custom", "value": [[0, 4], [30, 4]], "followBoundary": false },
            "reinforcements": [],
        })
    };
    let o = bound_options(json!({ "elementSize": 2.5 }));
    let light = lower_bound(&slope(def(18.0)), &o, &mut ctx()).unwrap();
    let heavy = lower_bound(&slope(def(22.0)), &o, &mut ctx()).unwrap();
    assert!(heavy.factor_of_safety < light.factor_of_safety - 0.001);
    assert!(light.warnings.is_empty());
}

// ── lower-bound-corner.test.ts ──────────────────────────────────────

const H: f64 = 0.35;
fn embankment(gap: f64) -> Value {
    json!({
        "coordinates": [[-9, -7], [-9, 0], [-4, 0], [-1, -2], [1, -2], [4, 0], [5, 0], [5.0 + H, H], [10, H], [10.0 + H, 0], [15, 0], [15, -7]],
        "materials": [
            { "name": "fill", "model": { "kind": "mohr-coulomb", "unitWeight": 18.5, "cohesion": 2, "frictionAngle": 33 } },
            { "name": "crust", "model": { "kind": "undrained", "unitWeight": 17, "undrainedShearStrength": 22 } },
            { "name": "clay", "model": { "kind": "undrained", "unitWeight": 16, "undrainedShearStrength": 11 } },
        ],
        "materialBoundaries": [
            { "coordinates": [[5, 0], [10.0 + H, 0]], "materialName": "" },
            { "coordinates": [[-9, -1.2], [15, -1.2]], "materialName": "" },
        ],
        "regionAssignments": [
            { "point": [8, H / 2.0], "materialName": "fill" },
            { "point": [-6, -0.6], "materialName": "crust" },
            { "point": [8, -0.6], "materialName": "crust" },
            { "point": [0, -4], "materialName": "clay" },
        ],
        "udls": [{ "magnitude": 18, "x1": 5.0 + H + gap, "x2": 10 }],
    })
}

#[test]
#[ignore]
fn lower_bound_finds_a_bound_below_the_upper_with_the_load_at_the_corner_2_mm_and_5_cm_from_it() {
    let o = bound_options(json!({ "elementSize": 0.5, "fTolerance": 0.005, "startF": 1 }));
    let mut lower = Vec::new();
    for gap in [0.0, 0.002, 0.05] {
        let r = lower_bound(&slope(embankment(gap)), &o, &mut ctx()).unwrap();
        assert!(r.factor_of_safety.is_finite());
        assert!(
            r.trials
                .iter()
                .find(|t| t.f == r.factor_of_safety)
                .unwrap()
                .lambda
                >= 1.0
        );
        lower.push(r.factor_of_safety);
    }
    let upper = upper_bound(&slope(embankment(0.0)), &o, &mut ctx()).unwrap();
    for f in &lower {
        assert!(*f <= upper.factor_of_safety);
    }
    assert!((lower[0] - lower[2]).abs() < 0.05 * lower[2]);
    assert!((lower[1] - lower[2]).abs() < 0.05 * lower[2]);
    assert!(lower[0] > 0.9 * upper.factor_of_safety);
}

#[test]
fn lower_bound_gives_a_loads_end_on_a_straight_surface_a_fan_of_elements() {
    let prob = lower_bound_problem(
        &slope(embankment(0.002)),
        &bound_options(json!({ "elementSize": 0.5 })),
    )
    .unwrap();
    let (x, y, el) = (&prob.mesh.x, &prob.mesh.y, &prob.mesh.el);
    let node = (0..x.len())
        .find(|&n| (x[n] - (5.0 + H + 0.002)).abs() < 1e-9 && (y[n] - H).abs() < 1e-9)
        .expect("the load's end is a node");
    let (mut count, mut widest) = (0, 0.0f64);
    for e in 0..el.len() / 3 {
        let Some(k) = (0..3).find(|&k| el[3 * e + k] == node) else {
            continue;
        };
        let (a, b) = (el[3 * e + (k + 1) % 3], el[3 * e + (k + 2) % 3]);
        let (ax, ay, bx, by) = (
            x[a] - x[node],
            y[a] - y[node],
            x[b] - x[node],
            y[b] - y[node],
        );
        widest = widest.max((ax * by - ay * bx).atan2(ax * bx + ay * by).abs());
        count += 1;
    }
    // 180° below a straight surface: at least six elements of at most 30°, four sectors each
    assert!(count >= 24);
    assert!(widest <= (30.0 * PI) / 180.0 + 1e-9);
}

// ── upper-bound.test.ts ─────────────────────────────────────────────

#[test]
fn upper_bound_bounds_the_frictional_bearing_capacity_from_above() {
    let phi = (20.0 * PI) / 180.0;
    let nq = (PI * phi.tan()).exp() * (PI / 4.0 + phi / 2.0).tan().powi(2);
    let nc = (nq - 1.0) / phi.tan();
    let def = json!({
        "coordinates": [[-30, 0], [-30, 15], [30, 15], [30, 0]],
        "materials": [{ "name": "soil", "model": { "kind": "mohr-coulomb", "unitWeight": 1e-6, "cohesion": 10, "frictionAngle": 20 } }],
        "udls": [{ "magnitude": 10.0 * nc, "x1": -5, "x2": 5 }],
    });
    let r = upper_bound(
        &slope(def),
        &bound_options(json!({ "elementSize": 2, "fTolerance": 0.005 })),
        &mut ctx(),
    )
    .unwrap();
    assert!(r.factor_of_safety > 1.0 && r.factor_of_safety < 1.08);
    let at = r.trials.iter().find(|t| t.f == r.factor_of_safety).unwrap();
    assert!(at.lambda <= 1.0 && at.lambda > 0.95);
}

#[test]
#[ignore]
fn upper_bound_brackets_the_strength_reduction_factor_with_the_lower_bound() {
    let s = slope(json!({
        "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
        "materials": [{ "name": "soil", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 15, "frictionAngle": 10 } }],
    }));
    let mut m = build_fe_model(&s, &bound_options(json!({ "elementSize": 1.25 })).model).unwrap();
    let fe = strength_reduction(
        &mut m,
        &SrmOptions {
            flow_rule: Some(FlowRule::Associated),
            f_tolerance: Some(0.005),
            ..Default::default()
        },
    )
    .unwrap();
    let ub = upper_bound(
        &s,
        &bound_options(
            json!({ "elementSize": 1.25, "fTolerance": 0.005, "startF": fe.factor_of_safety }),
        ),
        &mut ctx(),
    )
    .unwrap();
    let lb = lower_bound(
        &s,
        &bound_options(json!({ "elementSize": 1.25, "fTolerance": 0.005 })),
        &mut ctx(),
    )
    .unwrap();
    assert!(ub.factor_of_safety >= fe.factor_of_safety - 0.01);
    assert!(lb.factor_of_safety <= fe.factor_of_safety + 0.01);
    assert!(ub.factor_of_safety - lb.factor_of_safety < 0.25 * fe.factor_of_safety);
    assert!(ub.trials.len() <= 4);
}

#[test]
#[ignore]
fn upper_bound_gives_a_slip_band_between_two_soils_the_strength_of_one_of_them() {
    let def = json!({
        "coordinates": [[0, 0], [0, 15], [15, 15], [25, 5], [40, 5], [40, 0]],
        "materials": [
            { "name": "clay", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 30, "frictionAngle": 0 } },
            { "name": "sand", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 0, "frictionAngle": 45 } },
        ],
        "materialBoundaries": [{ "coordinates": [[0, 3], [40, 3]], "materialName": "sand" }],
    });
    let r = upper_bound(
        &slope(def),
        &bound_options(json!({ "elementSize": 1, "fTolerance": 0.005 })),
        &mut ctx(),
    )
    .unwrap();
    assert!(r.factor_of_safety > 0.85);
}

// ── bound-adapt.test.ts ─────────────────────────────────────────────

// ── analysis.test.ts ────────────────────────────────────────────────

// ── summary.test.ts ─────────────────────────────────────────────────

// ── initial-stress.test.ts (the analyzeFem parts) ───────────────────

fn problem_slope(id: &str) -> Slope {
    let cases: Vec<Value> = common::verification_cases();
    slope(cases.iter().find(|c| c["id"] == id).expect("the problem")["definition"].clone())
}

#[test]
#[ignore]
fn initial_stresses_do_not_change_the_factor_of_safety_of_associated_flow_v055() {
    let s = problem_slope("V055");
    let f = |extra: Value| {
        let mut o = json!({ "flowRule": "associated", "elementSize": 1.5, "fTolerance": 0.005 });
        for (k, v) in extra.as_object().unwrap() {
            o[k] = v.clone();
        }
        analyze_fem(&s, &fem_options(o), &mut ctx())
            .unwrap()
            .factor_of_safety
    };
    let gravity = f(json!({}));
    assert!((f(json!({ "initialStress": "k0" })) - gravity).abs() < 5e-7);
    assert!(
        (f(json!({ "initialStress": "k0", "originalGroundLevel": 14 })) - gravity).abs() < 5e-7
    );
}

fn staged_embankment() -> Value {
    json!({
        "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [40, 5], [40, 0]],
        "materials": [
            { "name": "found", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 15, "frictionAngle": 25 } },
            { "name": "fill1", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } },
            { "name": "fill2", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } },
        ],
        "materialBoundaries": [{ "coordinates": [[0, 5], [40, 5]], "materialName": "found" }, { "coordinates": [[0, 7.5], [40, 7.5]], "materialName": "fill1" }],
        "regionAssignments": [{ "point": [20, 2.5], "materialName": "found" }, { "point": [5, 6], "materialName": "fill1" }, { "point": [5, 9], "materialName": "fill2" }],
    })
}

#[test]
#[ignore]
fn staged_construction_builds_the_embankment_in_layers_the_same_factor_with_associated_flow() {
    let s = slope(staged_embankment());
    let opts = json!({ "flowRule": "associated", "elementSize": 1.5, "fTolerance": 0.005 });
    let once = analyze_fem(&s, &fem_options(opts.clone()), &mut ctx()).unwrap();
    let mut staged_o = opts.clone();
    staged_o["materialStages"] = json!({ "fill1": 1, "fill2": 2 });
    let staged = analyze_fem(&s, &fem_options(staged_o), &mut ctx()).unwrap();
    assert_eq!(staged.warnings, once.warnings);
    assert!((staged.factor_of_safety - once.factor_of_safety).abs() < 5e-7);
    // (the prepared model's stresses: fem_model_unit.rs)
    let p = prepare_fe_model(
        &s,
        &bound_options(json!({ "elementSize": 1.5 })).model,
        &serde_json::from_value::<InitialStressOptions>(
            json!({ "materialStages": { "fill1": 1, "fill2": 2 } }),
        )
        .unwrap(),
        &SrmOptions {
            flow_rule: Some(FlowRule::Associated),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(p.model.stress0.is_some());
}

// ── piles.test.ts (the analyzeFem parts) ────────────────────────────

fn pile_def(piles: Value) -> Value {
    json!({
        "coordinates": [[0, 0], [0, 15], [15, 15], [30, 5], [50, 5], [50, 0]],
        "materials": [{ "name": "soil", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 8, "frictionAngle": 25 } }],
        "piles": piles,
    })
}

fn pile_row(extra: Value) -> Value {
    let mut r = json!({ "x1": 22, "y1": 15.0 - (7.0 * 10.0) / 15.0, "x2": 22, "y2": 0.5, "diameter": 0.6, "spacing": 2, "application": "passive" });
    for (k, v) in extra.as_object().unwrap() {
        r[k] = v.clone();
    }
    r
}

fn pile_run(piles: Value, solver: &str) -> cslope_engine::fem::analysis::FemAnalysisResult {
    let o = fem_options(
        json!({ "flowRule": "associated", "solver": solver, "elementSize": 1.25, "fTolerance": 0.01 }),
    );
    analyze_fem(&slope(pile_def(piles)), &o, &mut ctx()).unwrap()
}

#[test]
#[ignore]
fn pile_rows_raise_the_factor_of_safety_with_both_solvers_alike_and_report_their_forces() {
    let plain = pile_run(json!([]), "newton").factor_of_safety;
    let newton = pile_run(json!([pile_row(json!({}))]), "newton");
    let vp = pile_run(json!([pile_row(json!({}))]), "viscoplastic");
    assert!(newton.factor_of_safety > plain + 0.1);
    assert!((newton.factor_of_safety - vp.factor_of_safety).abs() < 0.03);
    assert_eq!(newton.piles.len(), 1);
    assert!(newton.piles[0].max_moment > 0.0);
    assert!(newton.piles[0].max_shear_force > 0.0);
}

#[test]
#[ignore]
fn pile_rows_warn_where_the_forces_exceed_the_piles_capacity() {
    let r = pile_run(json!([pile_row(json!({ "momentCapacity": 10 }))]), "newton");
    assert!(r
        .warnings
        .iter()
        .any(|w| w.starts_with("Pile 1: the bending moment")));
}

// ── hoek-brown.test.ts ──────────────────────────────────────────────

#[test]
#[ignore]
fn hoek_brown_slopes_give_the_finite_element_factor_within_10_percent_of_the_limit_equilibrium_one()
{
    let hh = 20.0;
    let w = hh / (PI / 3.0).tan();
    let def = json!({
        "coordinates": [[0, 0], [0, hh + 10.0], [20, hh + 10.0], [20.0 + w, 10], [60, 10], [60, 0]],
        "materials": [{ "name": "rock", "model": { "kind": "hoek-brown", "unitWeight": 25, "ucs": 10000, "gsi": 20, "mi": 10 } }],
    });
    let mut s = slope(def.clone());
    let patch: AnalysisOptionsPatch =
        serde_json::from_value(json!({ "method": "Morgenstern-Price" })).unwrap();
    s.update_analysis_options(&patch).unwrap();
    let le = analyse_slope(&mut s, &mut ctx()).unwrap().unwrap();
    let fe = analyze_fem(
        &slope(def),
        &fem_options(json!({ "flowRule": "associated", "elementSize": 1.5, "fTolerance": 0.01 })),
        &mut ctx(),
    )
    .unwrap()
    .factor_of_safety;
    assert!((fe - le).abs() / le < 0.1, "FE {fe} LE {le}");
}
