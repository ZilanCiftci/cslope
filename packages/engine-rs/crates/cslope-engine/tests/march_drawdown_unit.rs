//! Ports of packages/engine/src/model/mp-march.test.ts (the Morgenstern-
//! Price march solver) and drawdown.test.ts (the three-stage rapid
//! drawdown).
//!
//! The Morgenstern-Price solver choice is process-wide (as TypeScript's
//! module global) and Rust runs the tests of a file in parallel: every test
//! here that analyses takes `LOCK`, so the one that switches to the march
//! solver does not change the others' analyses.
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::drawdown::drawdown_strength;
use cslope_engine::model::mp_march::{
    analyse_morgenstern_price_march, march, set_march_search_options, solve_morgenstern_price_fast,
    solve_morgenstern_price_march, MpMarchOptions, RootRule,
};
use cslope_engine::model::search::add_single_circular_plane;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::{
    analyse_morgenstern_price, analyse_ordinary, analyse_slope, get_slice_property_arrays,
    set_morgenstern_price_solver, MpSolver, SliceArrays,
};
use cslope_engine::types::{Material, MaterialParams, SlopeDefinition};
use model_core_support::{close, layered};
use serde_json::{json, Value};
use solvers_support::{run_verification, verification_options};
use std::f64::consts::PI;
use std::sync::Mutex;

static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// A verification case and its Morgenstern-Price check (the fixture's
/// options are verificationOptions already).
fn case(id: &str) -> (Value, Value, f64) {
    let cases: Vec<Value> = common::verification_cases();
    let c = cases.into_iter().find(|c| c["id"] == id).unwrap();
    let k = c["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["method"] == "Morgenstern-Price")
        .unwrap()
        .clone();
    (
        c["definition"].clone(),
        k["options"].clone(),
        k["published"].as_f64().unwrap(),
    )
}

fn analyse(def: &Value, options: &Value) -> (Option<f64>, Slope) {
    let d: SlopeDefinition = serde_json::from_value(def.clone()).unwrap();
    let mut slope = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    slope
        .update_analysis_options(
            &serde_json::from_value::<AnalysisOptionsPatch>(options.clone()).unwrap(),
        )
        .unwrap();
    let f = analyse_slope(&mut slope, &mut RunCtx::default()).unwrap();
    (f, slope)
}

fn props_of(slope: &Slope) -> (SliceArrays, f64) {
    let plane = slope
        .search()
        .iter()
        .find(|p| p.fos.is_some() && p.slices.is_some())
        .unwrap();
    let s = plane.slices.as_ref().unwrap();
    let props = get_slice_property_arrays(
        s,
        s[0].x_left,
        s[s.len() - 1].x_right,
        slope.interslice_function(),
        &slope.interslice_data_points(),
    );
    (props, analyse_ordinary(slope, s).unwrap())
}

/// The critical surface of the iterative search for a verification problem.
fn critical(id: &str) -> (f64, SliceArrays, f64, f64) {
    let (def, options, published) = case(id);
    let (fos, slope) = analyse(&def, &options);
    let (props, f0) = props_of(&slope);
    (fos.unwrap(), props, f0, published)
}

/// V002's critical surface of the optimisation before its best surface was
/// optimised further (FOS 0.4119), on which the iterative solver reaches a
/// far root: canonical coordinates, moment axis.
fn v002_surface() -> Value {
    json!({
        "points": [[32.9006, 35], [34.6453, 31.4463], [38.0925, 28.8535], [41.0822, 26.546], [44.0631, 24.2221], [46.7363, 22.1455], [49.4385, 20.1175], [52.0906, 18.432], [54.8722, 16.9687], [57.6663, 15.7865], [60.551, 14.8205], [63.4418, 13.9426], [66.4016, 13.3364], [69.4227, 13.0618], [72.454, 13.1832], [75.3358, 13.7796], [78.0588, 15]],
        "axis": [69.7991, 60.2313],
    })
}

/// A fixed surface of a verification problem, analysed as its Morgenstern-Price check.
fn on_surface(id: &str, surface: Value) -> (SliceArrays, f64, f64) {
    let (def, options, published) = case(id);
    let d: SlopeDefinition = serde_json::from_value(def).unwrap();
    let mut canonical =
        serde_json::to_value(to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    canonical["customSurfaces"] = json!([surface]);
    canonical["customPlanesOnly"] = json!(true);
    let mut slope = build_slope(&serde_json::from_value(canonical).unwrap()).unwrap();
    let mut o = options;
    o["nonCircularOptimization"] = json!(false);
    slope
        .update_analysis_options(&serde_json::from_value::<AnalysisOptionsPatch>(o).unwrap())
        .unwrap();
    analyse_slope(&mut slope, &mut RunCtx::default()).unwrap();
    let (props, f0) = props_of(&slope);
    (props, f0, published)
}

#[test]
fn march_closes_equilibrium_at_its_root_and_agrees_with_the_iterative_solver_v001() {
    let _g = lock();
    let (fos, props, f0, _) = critical("V001");
    let r = solve_morgenstern_price_march(&props, f0, &MpMarchOptions::default());
    let chosen = r.chosen.unwrap();
    let m = march(&props, chosen.lambda, chosen.f);
    assert!(m.gf.abs() < 1e-6 * m.f_scale);
    assert!(m.gm.abs() < 1e-6 * m.m_scale);
    assert_eq!(m.out_of_band, 0);
    assert!((chosen.f - fos).abs() < 0.002);
    // The 2-D Newton fast path reaches the same root as the λ scan.
    let newton = r.newton.unwrap();
    assert!((newton.f - chosen.f).abs() < 1e-5);
    assert!((newton.lambda - chosen.lambda).abs() < 1e-4);
}

#[test]
fn march_keeps_the_far_root_of_v002_outside_the_band_and_reports_the_published_one() {
    let _g = lock();
    // The iterative solver reaches 0.344 at λ ≈ −1.08 on this surface when
    // the tolerance is tight; there every slice's denominator has changed
    // sign. The march solver only roots inside the band.
    let (props, f0, published) = on_surface("V002", v002_surface());
    let r = solve_morgenstern_price_march(&props, f0, &MpMarchOptions::default());
    assert_eq!(r.roots.len(), 1);
    assert!(r.roots[0].lambda > 0.0);
    assert!((r.roots[0].f - published).abs() < 0.003);
    assert!(march(&props, -1.08, 0.347).out_of_band > 0);
}

#[test]
fn march_reports_no_root_when_force_equilibrium_cannot_close_v027() {
    let _g = lock();
    // Moment equilibrium of a φ = 0 circle fixes F; here no λ closes force
    // equilibrium at that F, so the surface has no complete-equilibrium
    // solution. The iterative solver accepts it with a 0.02 gap instead.
    let (_, props, f0, _) = critical("V027");
    let r = solve_morgenstern_price_march(&props, f0, &MpMarchOptions::default());
    assert!(r.roots.is_empty());
    assert!(r.chosen.is_none());
}

#[test]
fn march_fast_solver_scan_alone_and_every_rule_give_the_same_single_root_v001() {
    let _g = lock();
    let (_, props, f0, _) = critical("V001");
    let full = solve_morgenstern_price_march(&props, f0, &MpMarchOptions::default());
    let fast = solve_morgenstern_price_fast(&props, f0, &MpMarchOptions::default());
    assert!(fast.newton.is_some());
    assert!((fast.chosen.unwrap().f - full.chosen.unwrap().f).abs() < 1e-5);
    let scan = solve_morgenstern_price_fast(
        &props,
        f0,
        &MpMarchOptions {
            scan_only: Some(true),
            ..Default::default()
        },
    );
    assert!(scan.newton.is_none());
    assert!((scan.chosen.unwrap().f - full.chosen.unwrap().f).abs() < 1e-5);
    for rule in [RootRule::Largest, RootRule::Smallest] {
        let r = solve_morgenstern_price_march(
            &props,
            f0,
            &MpMarchOptions {
                rule: Some(rule),
                ..Default::default()
            },
        );
        assert_eq!(r.chosen.unwrap().f, full.chosen.unwrap().f);
    }
}

#[test]
fn march_as_the_search_solver_reproduces_the_iterative_search_and_gives_no_answer_without_a_root() {
    let _g = lock();
    let run = |id: &str| {
        let (def, options, _) = case(id);
        analyse(&def, &options)
    };
    let iterative = run("V001").0.unwrap();
    // The iterative search's critical surface of V027 has no root (above).
    let (_, v027) = run("V027");
    let p27 = v027
        .search()
        .iter()
        .find(|p| p.fos.is_some() && p.slices.is_some())
        .unwrap()
        .clone();
    set_morgenstern_price_solver(MpSolver::March);
    set_march_search_options(MpMarchOptions::default());
    let result = std::panic::catch_unwind(|| {
        let (fos, slope) = run("V001");
        let fos = fos.unwrap();
        assert!((fos / iterative - 1.0).abs() < 0.005);
        // The drop-in solver on the critical surface: one root, reported as the FOS.
        let plane = slope
            .search()
            .iter()
            .find(|p| p.fos.is_some() && p.slices.is_some())
            .unwrap();
        let r = analyse_morgenstern_price_march(&slope, &mut plane.slices.clone().unwrap(), None)
            .unwrap();
        assert!(r.converged);
        assert!((r.fos.unwrap() - fos).abs() < 1e-6);
        assert_eq!(r.lff_array.unwrap().len(), 1);
        assert!(
            analyse_morgenstern_price_march(&v027, &mut p27.slices.clone().unwrap(), None)
                .unwrap()
                .fos
                .is_none()
        );
    });
    set_morgenstern_price_solver(MpSolver::Iterative);
    if let Err(e) = result {
        std::panic::resume_unwind(e);
    }
}

#[test]
fn march_a_combined_material_the_undrained_strength_governs_where_it_is_lower() {
    let _g = lock();
    let mut s = Slope::new();
    s.add_material(
        Material::new(MaterialParams {
            name: Some("C".into()),
            unit_weight: Some(19.0),
            cohesion: Some(5.0),
            friction_angle: Some(30.0),
            cohesion_undrained: Some(25.0),
            c_factor: Some(1.0),
            ..Default::default()
        })
        .unwrap(),
    );
    s.set_external_boundary(&[
        [0.0, -10.0],
        [0.0, 10.0],
        [10.0, 10.0],
        [25.0, 0.0],
        [40.0, 0.0],
        [40.0, -10.0],
    ])
    .unwrap();
    s.update_analysis_options(&AnalysisOptionsPatch {
        slices: Some(30.0),
        tolerance: Some(1e-4),
        max_iterations: Some(50.0),
        ..Default::default()
    })
    .unwrap();
    add_single_circular_plane(&mut s, 22.0, 18.0, 18.5).unwrap();
    let p = s.individual_planes()[0].clone();
    let mut slices = get_slices(
        &s,
        p.lc[0],
        p.rc[0],
        p.cx,
        p.cy,
        p.radius,
        None,
        &mut SliceScratch::new(),
    )
    .unwrap();
    let iterative = analyse_morgenstern_price(&s, &mut slices.clone())
        .unwrap()
        .fos
        .unwrap();
    let f = analyse_morgenstern_price_march(&s, &mut slices, None)
        .unwrap()
        .fos
        .unwrap();
    assert!((f - iterative).abs() < 0.002);
    assert!(slices.iter().any(|x| x.undrained_governs == Some(true)));
    assert!(slices.iter().any(|x| x.undrained_governs != Some(true)));
}

// ── drawdown.test.ts ──────────────────────────────────────────────

#[test]
fn drawdown_strength_between_the_r_envelope_at_kc_1_and_the_effective_envelope_at_kf() {
    let (c, phi, c_r, phi_r, sfc) = (10.0, 25.0, 20.0, 15.0, 100.0);
    let r = (phi_r * PI) / 180.0;
    let p = (phi * PI) / 180.0;
    // the Kc = 1 envelope by Duncan, Wright & Brandon (2014), Eqs. 9.6–9.7
    let tau1 =
        (c_r * r.cos() * p.cos()) / (1.0 - r.sin()) + sfc * ((r.sin() * p.cos()) / (1.0 - r.sin()));
    let tau_kf = c + sfc * ((phi * PI) / 180.0).tan();
    // isotropic consolidation (no shear): the R envelope
    close(drawdown_strength(sfc, 0.0, c, phi, c_r, phi_r), tau1, 9);
    // consolidated at failure (τfc on the effective envelope): the effective envelope
    close(
        drawdown_strength(sfc, tau_kf, c, phi, c_r, phi_r),
        tau_kf,
        6,
    );
    // in between
    let mid = drawdown_strength(sfc, tau_kf / 2.0, c, phi, c_r, phi_r);
    assert!(mid > tau1.min(tau_kf));
    assert!(mid < tau1.max(tau_kf));
}

#[test]
fn drawdown_strength_kc_1_envelope_of_pilarcitos_dam() {
    // Pilarcitos Dam (Duncan, Wright & Wong 1990): c′ = 0, φ′ = 45°,
    // cR = 60 psf, φR = 23° give the Kc = 1 envelope d = 64 psf, ψ = 24.4°
    // (64.10 and 24.39° by Eqs. 9.6–9.7 of Duncan, Wright & Brandon 2014).
    // With τfc = 0 (Kc = 1) τff is on that envelope.
    let tau = |sfc: f64| drawdown_strength(sfc, 0.0, 0.0, 45.0, 60.0, 23.0);
    let (s1, s2) = (500.0, 1500.0);
    let tan_psi = (tau(s2) - tau(s1)) / (s2 - s1);
    let d = tau(s1) - s1 * tan_psi;
    assert!((d - 64.10).abs() < 0.005, "d = {d}");
    let psi = tan_psi.atan().to_degrees();
    assert!((psi - 24.39).abs() < 0.005, "ψ = {psi}");
    close(
        tau(1000.0),
        64.10 + 1000.0 * 24.39_f64.to_radians().tan(),
        0,
    );
}

const DD_GROUND: [[f64; 2]; 4] = [[0.0, 0.0], [30.0, 15.0], [40.0, 15.0], [60.0, 15.0]];

fn dd_run(def: Value, extra: Value) -> f64 {
    let mut o = json!({ "intersliceFunction": "constant", "slices": 30 });
    for (k, v) in extra.as_object().unwrap() {
        o[k] = v.clone();
    }
    run_verification(def, "Morgenstern-Price", o).0.unwrap()
}

fn clay(extra: Value) -> Value {
    let mut m =
        json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 5, "frictionAngle": 28 });
    for (k, v) in extra.as_object().unwrap() {
        m[k] = v.clone();
    }
    m
}

/// A dam's upstream face (sliding to the left, towards the reservoir).
fn dd_def(m: Value, drawdown: bool) -> Value {
    let mut d = layered(&DD_GROUND, -10.0, &[("C", None, m)], json!({}));
    d["orientation"] = json!("rtl");
    d["waterTable"] =
        json!({ "mode": "custom", "value": [[0, 0], [60, 0]], "followBoundary": false });
    if drawdown {
        d["rapidDrawdown"] = json!({ "waterBefore": [[0, 13], [60, 13]] });
    }
    d["customSearchPlanes"] = json!([{ "cx": 12, "cy": 32, "radius": 30 }]);
    d["customPlanesOnly"] = json!(true);
    d
}

#[test]
fn drawdown_an_upstream_slope_no_higher_than_drained_free_draining_soil_unchanged() {
    let _g = lock();
    let drained = dd_run(dd_def(clay(json!({})), false), json!({}));
    let dd = dd_run(
        dd_def(
            clay(json!({ "drawdownStrength": { "cohesion": 15, "frictionAngle": 12 } })),
            true,
        ),
        json!({}),
    );
    assert!(dd < drained * 1.0001);
    assert!(dd > 0.3);
    // a free-draining material (no drawdown envelope): only the water after drawdown counts
    close(dd_run(dd_def(clay(json!({})), true), json!({})), drained, 9);
}

#[test]
fn drawdown_with_partial_factors_the_undrained_strength_takes_gamma_cu() {
    let _g = lock();
    let d = dd_def(
        clay(json!({ "drawdownStrength": { "cohesion": 15, "frictionAngle": 12 } })),
        true,
    );
    let plain = dd_run(d.clone(), json!({}));
    let factored = dd_run(
        d,
        json!({ "partialFactors": { "cu": 1.5, "cohesion": 1.5, "tanPhi": 1.5, "variableLoad": 1 } }),
    );
    assert!(factored < plain / 1.3);
}

#[test]
fn drawdown_with_a_waternet_the_water_before_is_water_before_alone() {
    let _g = lock();
    let m = clay(json!({ "drawdownStrength": { "cohesion": 15, "frictionAngle": 12 } }));
    let def = |waternet: bool, drawdown: bool| {
        let mut d = dd_def(m.clone(), drawdown);
        // hydrostatic below the line at 0: the water table's pore pressures
        if waternet {
            d["waternet"] = json!({
                "headLines": [{ "id": "h", "points": [[0, 0], [60, 0]] }],
                "referenceLines": [{ "points": [[0, -20], [60, -20]], "topHeadLineId": "h", "bottomHeadLineId": "h" }],
                "phreaticLineId": "h",
            });
        }
        d
    };
    close(
        dd_run(def(true, false), json!({})),
        dd_run(def(false, false), json!({})),
        9,
    );
    let dd = dd_run(def(true, true), json!({}));
    assert!((dd - dd_run(def(true, false), json!({}))).abs() > 0.01);
    close(dd, dd_run(def(false, true), json!({})), 9);
}

#[test]
fn drawdown_shansep_below_mc_above_earlier_stage_and_unconsolidated_load_no_change_without_drawdown(
) {
    let _g = lock();
    let clay = json!({
        "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "exponent": 0.8, "yieldFromEarlierStage": true,
        "aboveWater": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 8, "frictionAngle": 30 },
    });
    let water = json!([[0, 8], [60, 8]]);
    let def = |drawdown: bool| {
        let d = layered(
            &DD_GROUND,
            -10.0,
            &[("C", None, clay.clone())],
            json!({ "waterTable": { "mode": "custom", "value": water, "followBoundary": false } }),
        );
        let mut out = d.clone();
        let mut earlier = d;
        earlier["orientation"] = json!("rtl");
        earlier["udls"] = json!([{ "magnitude": 60, "x1": 30, "x2": 60 }]);
        out["orientation"] = json!("rtl");
        out["earlierStage"] = earlier;
        out["udls"] = json!([{ "magnitude": 20, "x1": 35, "x2": 60, "excessPorePressure": [{ "material": "C", "ratio": 0.5 }] }]);
        if drawdown {
            out["rapidDrawdown"] = json!({ "waterBefore": water });
        }
        out["customSearchPlanes"] = json!([{ "cx": 12, "cy": 32, "radius": 30 }]);
        out["customPlanesOnly"] = json!(true);
        out
    };
    let (_, slope) = run_verification(
        def(false),
        "Morgenstern-Price",
        json!({ "intersliceFunction": "constant", "slices": 30 }),
    );
    let slices = slope.search()[0].slices.clone().unwrap();
    // both strengths on the surface
    assert!(slices.iter().any(|s| s
        .strength_model
        .as_ref()
        .is_some_and(|m| m.kind() == "mohr-coulomb")));
    assert!(slices.iter().any(|s| s.strength_model.is_none()
        && slope.material(s.base_material.unwrap()).model.kind() == "shansep"));
    close(
        dd_run(def(true), json!({})),
        dd_run(def(false), json!({})),
        9,
    );
}

/// verification_options is idempotent (the fixture's options are merged once more by run_verification).
#[test]
fn verification_options_merge_twice_alike() {
    let o = verification_options("Bishop", json!({ "slices": 40 }));
    assert_eq!(verification_options("Bishop", o.clone()), o);
}
