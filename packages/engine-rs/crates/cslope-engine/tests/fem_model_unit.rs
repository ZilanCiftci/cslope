//! The TypeScript unit tests of the finite element model and strength
//! reduction, ported: fem/model.test.ts (all but "meshDomain" and
//! "SparseCholesky", ported with the leaves in fem_leaves_*.rs),
//! newton.test.ts, srm.test.ts, initial-stress.test.ts, piles.test.ts,
//! anchors.test.ts, transfer.test.ts, and the parts of analysis.test.ts and
//! model/suction-strength.test.ts that test these modules directly. Tests
//! that need analyzeFem are in fem_analysis_unit.rs. The strength
//! reductions are slow: run in release.
//! (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
// (the tests compute their expectations with std float methods, as the
// TypeScript tests with Math)
#![allow(clippy::needless_range_loop, clippy::disallowed_methods)]

mod fem_model_support;

use cslope_engine::error::ErrorKind;
use cslope_engine::fem::adapt::{dorfler_mark, refined_size_field, zz_indicator};
use cslope_engine::fem::initial_stress::{
    k0_stress, prepare_fe_model, InitialStressOptions, K0Options,
};
use cslope_engine::fem::model::{
    build_fe_model, ignored_input_warnings, solve_elastic, with_initial_stress,
    FeMaterialParameters, FeModel, FeModelOptions, PorePressureSource, BAR_GP_STRIDE,
};
use cslope_engine::fem::newton::{return_map, return_map_into};
use cslope_engine::fem::piles::{frame_stiffness, spring_capacity};
use cslope_engine::fem::seepage::van_genuchten_mualem;
use cslope_engine::fem::srm::{
    davis_b, empty_state, run_trial, strength_reduction, SrmOptions, TrialSolver,
};
use cslope_engine::fem::transfer::transfer_state;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slope::Slope;
use cslope_engine::types::{FlowRule, InitialStress, SlopeDefinition, WATER_UNIT_WEIGHT};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::f64::consts::PI;
use std::sync::Arc;

fn slope_of(def: Value) -> Slope {
    let def: SlopeDefinition = serde_json::from_value(def).expect("definition");
    build_slope(&to_canonical_slope_definition(&def, None).expect("canonical")).expect("build")
}

fn size(h: f64) -> FeModelOptions {
    FeModelOptions {
        element_size: Some(h),
        ..Default::default()
    }
}

fn params(name: &str, p: FeMaterialParameters) -> Option<BTreeMap<String, FeMaterialParameters>> {
    Some(BTreeMap::from([(name.to_string(), p)]))
}

fn max_abs(a: &[f64]) -> f64 {
    a.iter().fold(0.0f64, |m, &v| m.max(v.abs()))
}

#[track_caller]
fn close(a: f64, b: f64, digits: i32) {
    // toBeCloseTo: |a − b| < 10^−digits / 2
    assert!(
        (a - b).abs() < 10f64.powi(-digits) / 2.0,
        "{a} vs {b} ({digits} digits)"
    );
}

fn layer(extra: Value) -> Value {
    let mut d = json!({
        "coordinates": [[0, 0], [0, 10], [30, 10], [30, 0]],
        "materials": [{ "name": "Soil", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } }],
    });
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    d
}

fn water_at(y: f64) -> Value {
    json!({ "waterTable": { "mode": "custom", "value": [[0, y], [30, y]], "followBoundary": false } })
}

// ── fem/model.test.ts ────────────────────────────────────────────────

#[test]
fn elastic_gravity_gives_the_k0_stresses_of_a_horizontal_layer() {
    let slope = slope_of(layer(json!({})));
    let model = build_fe_model(&slope, &size(1.5)).unwrap();
    let stress = solve_elastic(&model).stress;
    let k0 = 0.3 / 0.7;
    let mut worst = 0.0f64;
    for i in 0..3 * model.element_count {
        let sy = -20.0 * (10.0 - model.gp_y[i]);
        worst = worst
            .max((stress[4 * i + 1] - sy).abs())
            .max((stress[4 * i] - k0 * sy).abs())
            .max(stress[4 * i + 2].abs())
            .max((stress[4 * i + 3] - 0.3 * (1.0 + k0) * sy).abs());
    }
    assert!(worst < 1e-6 * 200.0, "{worst}");
}

#[test]
fn elastic_gravity_carries_the_pore_pressure_of_a_water_table_in_effective_stress() {
    let slope = slope_of(layer(water_at(6.0)));
    let model = build_fe_model(&slope, &size(1.0)).unwrap();
    let stress = solve_elastic(&model).stress;
    // Effective vertical stress at the base: γH − γw·6 (exactly, by equilibrium of the column)
    let (mut sum, mut n) = (0.0, 0);
    for i in 0..3 * model.element_count {
        if model.gp_y[i] < 0.5 && model.gp_x[i] > 10.0 && model.gp_x[i] < 20.0 {
            let expected =
                -(20.0 * (10.0 - model.gp_y[i]) - WATER_UNIT_WEIGHT * (6.0 - model.gp_y[i]));
            sum += (stress[4 * i + 1] - expected) / expected;
            n += 1;
        }
    }
    assert!(n > 0);
    assert!((sum / n as f64).abs() < 0.01);
}

#[test]
fn elastic_gravity_applies_a_strip_load_over_its_width() {
    let slope = slope_of(layer(
        json!({ "udls": [{ "magnitude": 50, "x1": 0, "x2": 30 }] }),
    ));
    let model = build_fe_model(&slope, &size(2.0)).unwrap();
    let stress = solve_elastic(&model).stress;
    let mut worst = 0.0f64;
    for i in 0..3 * model.element_count {
        worst = worst.max((stress[4 * i + 1] - (-20.0 * (10.0 - model.gp_y[i]) - 50.0)).abs());
    }
    assert!(worst < 1e-4, "{worst}");
}

#[test]
fn reinforcement_bars_mesh_a_line_that_crosses_a_material_boundary() {
    let slope = slope_of(json!({
        "coordinates": [[0, 0], [0, 6], [20, 6], [20, 0]],
        "materials": [
            { "name": "Fill", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 0, "frictionAngle": 34 } },
            { "name": "Facing", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 2.5, "frictionAngle": 34 } },
        ],
        "materialBoundaries": [{ "coordinates": [[2, 0], [2, 6]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 3], "materialName": "Facing" }, { "point": [10, 3], "materialName": "Fill" }],
        "reinforcements": [{ "x1": 1, "y1": 3, "x2": 12, "y2": 3, "tensileCapacity": 20, "application": "passive" }],
    }));
    let model = build_fe_model(&slope, &size(1.0)).unwrap();
    assert!(model.bars.count > 5);
    // the bars cover the line's length (11 m) once
    let mut length = 0.0;
    for g in 0..2 * model.bars.count {
        length += model.bars.gp[7 * g + 6];
    }
    close(length, 11.0, 6);
    // capacity per metre of slope, the full tensile capacity (no pullout given)
    close(
        cslope_engine::js::math::max_of(&model.bars.capacity),
        20.0,
        9,
    );
}

#[test]
fn steady_seepage_gives_hydrostatic_pore_pressure_under_a_water_table_at_the_ground() {
    let slope = slope_of(layer(water_at(10.0)));
    let a = build_fe_model(&slope, &size(2.0)).unwrap();
    let b = build_fe_model(
        &slope,
        &FeModelOptions {
            element_size: Some(2.0),
            pore_pressure: Some(PorePressureSource::Seepage),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(b.seepage.as_ref().unwrap().converged);
    let mut worst = 0.0f64;
    for i in 0..a.gp_u.len() {
        worst = worst.max((a.gp_u[i] - b.gp_u[i]).abs());
    }
    assert!(worst < 1e-6 * 100.0, "{worst}");
}

fn seepage(h: f64) -> FeModelOptions {
    FeModelOptions {
        element_size: Some(h),
        pore_pressure: Some(PorePressureSource::Seepage),
        ..Default::default()
    }
}

#[test]
fn steady_seepage_lowers_the_phreatic_surface_through_an_embankment() {
    // 2:1 embankment, reservoir 8 m deep on the left, tail water at the ground on the right
    let slope = slope_of(json!({
        "coordinates": [[0, 0], [0, 2], [20, 12], [26, 12], [46, 2], [60, 2], [60, 0]],
        "materials": [{ "name": "Fill", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 10, "frictionAngle": 30 } }],
        "waterTable": { "mode": "custom", "value": [[0, 10], [16, 10], [46, 2], [60, 2]], "followBoundary": false },
    }));
    let m = build_fe_model(&slope, &seepage(1.5)).unwrap();
    assert!(m.seepage.as_ref().unwrap().converged);
    // pressure head under the crest centre: between the tail water and the reservoir
    let (mut best, mut d) = (0, f64::INFINITY);
    for i in 0..m.gp_x.len() {
        let dd = (m.gp_x[i] - 23.0).hypot(m.gp_y[i] - 2.5);
        if dd < d {
            d = dd;
            best = i;
        }
    }
    let h = m.gp_u[best] / WATER_UNIT_WEIGHT + m.gp_y[best];
    assert!(h > 2.5 && h < 10.0, "{h}");
    // no pore pressure at the crest
    for i in 0..m.gp_x.len() {
        if m.gp_y[i] > 11.5 {
            assert_eq!(m.gp_u[i], 0.0);
        }
    }
}

#[test]
fn steady_seepage_holds_the_water_table_at_the_model_sides() {
    // natural slope, water table 2 m below the crest, at the toe level downstream
    let slope = slope_of(json!({
        "coordinates": [[0, 0], [0, 4], [20, 4], [40, 14], [60, 14], [60, 0]],
        "materials": [{ "name": "Soil", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 10, "frictionAngle": 30 } }],
        "waterTable": { "mode": "custom", "value": [[0, 4], [20, 4], [40, 12], [60, 12]], "followBoundary": false },
    }));
    let m = build_fe_model(&slope, &seepage(1.5)).unwrap();
    assert!(m.seepage.as_ref().unwrap().flow);
    assert!(m.seepage.as_ref().unwrap().converged);
    // near the side under the crest the head is the drawn water table's
    // (the model may be mirrored, so both sides are looked at)
    let head_near = |px: f64| {
        let (mut best, mut d) = (0, f64::INFINITY);
        for i in 0..m.gp_x.len() {
            let dd = (m.gp_x[i] - px).hypot(m.gp_y[i] - 5.0);
            if dd < d {
                d = dd;
                best = i;
            }
        }
        m.gp_u[best] / WATER_UNIT_WEIGHT + m.gp_y[best]
    };
    assert!(head_near(1.0).max(head_near(59.0)) > 11.5);
    assert!(head_near(1.0).min(head_near(59.0)) < 4.5);
}

#[test]
fn steady_seepage_keeps_each_materials_water_line_when_no_water_reaches_the_boundary() {
    let slope = slope_of(layer(water_at(-5.0)));
    let m = build_fe_model(&slope, &seepage(2.0)).unwrap();
    assert!(!m.seepage.as_ref().unwrap().flow);
    assert_eq!(cslope_engine::js::math::max_of(&m.gp_u), 0.0);
}

#[test]
fn steady_seepage_rejects_van_genuchten_n_up_to_1() {
    let slope = slope_of(layer(water_at(10.0)));
    let e = build_fe_model(
        &slope,
        &FeModelOptions {
            material_parameters: params(
                "*",
                FeMaterialParameters {
                    van_genuchten_n: Some(0.9),
                    ..Default::default()
                },
            ),
            ..seepage(2.0)
        },
    )
    .unwrap_err();
    assert!(e.message.contains("van Genuchten"), "{}", e.message);
    assert_eq!(e.kind, ErrorKind::Range);
}

#[test]
fn rigid_materials_are_stiffer_than_the_stiffest_soil_and_nearly_impervious() {
    let slope = slope_of(json!({
        "coordinates": [[0, 0], [0, 10], [30, 10], [30, 0]],
        "materials": [
            { "name": "Soil", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } },
            { "name": "Rock", "model": { "kind": "impenetrable", "unitWeight": 24 } },
        ],
        "materialBoundaries": [{ "coordinates": [[0, 4], [30, 4]], "materialName": "" }],
        "regionAssignments": [{ "point": [15, 7], "materialName": "Soil" }, { "point": [15, 2], "materialName": "Rock" }],
        "waterTable": { "mode": "custom", "value": [[0, 10], [30, 10]], "followBoundary": false },
    }));
    let m = build_fe_model(
        &slope,
        &FeModelOptions {
            element_size: Some(2.0),
            material_parameters: params(
                "*",
                FeMaterialParameters {
                    youngs_modulus: Some(1e7),
                    ..Default::default()
                },
            ),
            ..Default::default()
        },
    )
    .unwrap();
    let mut rock = 0;
    for e in 0..m.element_count {
        if !m.el_elastic[e] {
            continue;
        }
        rock += 1;
        assert!(m.el_e[e] >= 1e9);
    }
    assert!(rock > 0);
    // hydrostatic still: the rock carries the water table's pressure
    let s = build_fe_model(&slope, &seepage(2.0)).unwrap();
    assert!(s.seepage.as_ref().unwrap().converged);
}

#[test]
fn van_genuchten_mualem_is_1_when_saturated_and_matches_the_closed_form_for_n_2() {
    assert_eq!(van_genuchten_mualem(0.5, 3.6, 1.56), 1.0);
    // n = 2, α|ψ| = 1: Se = 2^(−1/2), kr = Se^½ (1 − (1 − Se²)^½)²
    let se = 2f64.powf(-0.5);
    close(
        van_genuchten_mualem(-1.0, 1.0, 2.0),
        se.sqrt() * (1.0 - (1.0 - se * se).sqrt()).powi(2),
        12,
    );
    // decreasing with suction, bounded below
    assert!(van_genuchten_mualem(-2.0, 3.6, 1.56) < van_genuchten_mualem(-1.0, 3.6, 1.56));
    assert_eq!(van_genuchten_mualem(-1e6, 3.6, 1.56), 1e-6);
}

// ── fem/newton.test.ts ───────────────────────────────────────────────

const E: f64 = 1e5;
const NU: f64 = 0.3;

fn lame() -> (f64, f64) {
    (
        (E * NU) / ((1.0 + NU) * (1.0 - 2.0 * NU)),
        E / (2.0 * (1.0 + NU)),
    )
}

fn elastic(e: &[f64]) -> [f64; 4] {
    let (lam, mu) = lame();
    let tr = e[0] + e[1] + e[3];
    [
        lam * tr + 2.0 * mu * e[0],
        lam * tr + 2.0 * mu * e[1],
        mu * e[2],
        lam * tr + 2.0 * mu * e[3],
    ]
}

fn principal(s: &[f64]) -> [f64; 3] {
    let pm = (s[0] + s[1]) / 2.0;
    let r = ((s[0] - s[1]) / 2.0).hypot(s[2]);
    let mut p = [pm + r, pm - r, s[3]];
    p.sort_by(|a, b| b.partial_cmp(a).unwrap());
    p
}

/// A return to the apex of the pyramid: all three principal stresses equal.
fn at_apex(p: &[f64; 3], c: f64) -> bool {
    p[0] - p[2] < 1e-9 * c
}

/// At the apex the tangent is 10⁻³ of the elastic one (newton.rs, APEX_STIFFNESS).
fn expect_apex_tangent(c: &[f64]) {
    let (lam, mu) = lame();
    let el = [
        lam + 2.0 * mu,
        lam,
        0.0,
        lam,
        lam,
        lam + 2.0 * mu,
        0.0,
        lam,
        0.0,
        0.0,
        mu,
        0.0,
        lam,
        lam,
        0.0,
        lam + 2.0 * mu,
    ];
    for k in 0..16 {
        assert!((c[k] - 1e-3 * el[k]).abs() < 1e-9 * E);
    }
}

/// The tests' generator: seed = seed · 16807 mod (2³¹ − 1), as a fraction.
struct Rand(f64);
impl Rand {
    fn next(&mut self) -> f64 {
        self.0 = (self.0 * 16807.0) % 2147483647.0;
        self.0 / 2147483647.0
    }
}

#[test]
fn return_map_returns_to_the_yield_surface_with_a_symmetric_tangent_that_matches_finite_differences(
) {
    let mut rand = Rand(7.0);
    for t in 0..400 {
        let phi = ([0.0, 20.0, 35.0, 45.0][t % 4] * PI) / 180.0;
        let c = 5.0 + 20.0 * rand.next();
        let cut = t % 3 == 0;
        let eps = [
            (rand.next() - 0.5) * 2e-3,
            (rand.next() - 0.5) * 2e-3,
            (rand.next() - 0.5) * 2e-3,
            0.0,
        ];
        let mut cm = [0.0; 16];
        let r = return_map(
            elastic(&eps),
            E,
            NU,
            c,
            phi.sin(),
            phi.cos(),
            cut,
            &mut cm,
            f64::INFINITY,
        )
        .unwrap();
        let p = principal(&r.stress);
        let f = (p[0] - p[2]) / 2.0 + ((p[0] + p[2]) / 2.0) * phi.sin() - c * phi.cos();
        assert!(f < 1e-9 * c);
        if cut {
            assert!(p[0] < 1e-9 * c);
        }
        if !r.plastic {
            continue;
        }
        for i in 0..4 {
            for j in 0..4 {
                assert!((cm[4 * i + j] - cm[4 * j + i]).abs() < 1e-9 * E);
            }
        }
        if !cut && at_apex(&p, c) {
            expect_apex_tangent(&cm);
            continue;
        }
        for j in 0..3 {
            let h = 1e-9;
            let (mut a, mut b) = (eps, eps);
            a[j] += h;
            b[j] -= h;
            let sa = return_map(
                elastic(&a),
                E,
                NU,
                c,
                phi.sin(),
                phi.cos(),
                cut,
                &mut [0.0; 16],
                f64::INFINITY,
            )
            .unwrap()
            .stress;
            let sb = return_map(
                elastic(&b),
                E,
                NU,
                c,
                phi.sin(),
                phi.cos(),
                cut,
                &mut [0.0; 16],
                f64::INFINITY,
            )
            .unwrap()
            .stress;
            for i in 0..3 {
                assert!(((sa[i] - sb[i]) / (2.0 * h) - cm[4 * i + j]).abs() < 1e-6 * E);
            }
        }
    }
}

#[test]
fn return_map_caps_a_combined_material_at_its_undrained_strength() {
    let mut rand = Rand(11.0);
    let phi = (30.0 * PI) / 180.0;
    let (c, cu) = (5.0, 12.0);
    let mut capped = 0;
    for _ in 0..300 {
        let eps = [
            (rand.next() - 0.7) * 2e-3,
            (rand.next() - 0.7) * 2e-3,
            (rand.next() - 0.5) * 2e-3,
            0.0,
        ];
        let mut cm = [0.0; 16];
        let r = return_map(
            elastic(&eps),
            E,
            NU,
            c,
            phi.sin(),
            phi.cos(),
            false,
            &mut cm,
            cu,
        )
        .unwrap();
        let p = principal(&r.stress);
        assert!((p[0] - p[2]) / 2.0 - cu < 1e-9 * cu);
        assert!((p[0] - p[2]) / 2.0 + ((p[0] + p[2]) / 2.0) * phi.sin() - c * phi.cos() < 1e-9 * c);
        if ((p[0] - p[2]) / 2.0 - cu).abs() < 1e-6 {
            capped += 1;
        }
        if !r.plastic {
            continue;
        }
        if at_apex(&p, c) {
            expect_apex_tangent(&cm);
            continue;
        }
        for j in 0..3 {
            let h = 1e-9;
            let (mut a, mut b) = (eps, eps);
            a[j] += h;
            b[j] -= h;
            let sa = return_map(
                elastic(&a),
                E,
                NU,
                c,
                phi.sin(),
                phi.cos(),
                false,
                &mut [0.0; 16],
                cu,
            )
            .unwrap()
            .stress;
            let sb = return_map(
                elastic(&b),
                E,
                NU,
                c,
                phi.sin(),
                phi.cos(),
                false,
                &mut [0.0; 16],
                cu,
            )
            .unwrap()
            .stress;
            for i in 0..3 {
                assert!(((sa[i] - sb[i]) / (2.0 * h) - cm[4 * i + j]).abs() < 1e-6 * E);
            }
        }
    }
    assert!(capped > 10, "{capped}");
}

#[test]
fn return_map_gives_an_unsymmetric_tangent_for_non_associated_flow() {
    let mut rand = Rand(5.0);
    let (mut unsymmetric, mut apex) = (0, 0);
    for t in 0..400 {
        let phi = ([20.0, 30.0, 40.0][t % 3] * PI) / 180.0;
        let psi = ([0.0, 10.0][t % 2] * PI) / 180.0;
        let c = 5.0 + 20.0 * rand.next();
        let cut = t % 4 == 0;
        let eps = [
            (rand.next() - 0.5) * 2e-3,
            (rand.next() - 0.5) * 2e-3,
            (rand.next() - 0.5) * 2e-3,
            0.0,
        ];
        let ret = |e: &[f64; 4], cm: Option<&mut [f64]>| {
            let s = elastic(e);
            let mut out = [0.0; 4];
            let plastic = return_map_into(
                s[0],
                s[1],
                s[2],
                s[3],
                E,
                NU,
                c,
                phi.sin(),
                phi.cos(),
                cut,
                f64::INFINITY,
                &mut out,
                cm,
                psi.sin(),
            )
            .unwrap();
            (out, plastic)
        };
        let mut cm = [0.0; 16];
        let (stress, plastic) = ret(&eps, Some(&mut cm));
        let p = principal(&stress);
        assert!((p[0] - p[2]) / 2.0 + ((p[0] + p[2]) / 2.0) * phi.sin() - c * phi.cos() < 1e-9 * c);
        if !plastic {
            continue;
        }
        if (cm[1] - cm[4]).abs() > 1e-3 * E {
            unsymmetric += 1;
        }
        if (p[0] - p[2]).abs() < 1e-9 * c {
            apex += 1;
            if !cut {
                expect_apex_tangent(&cm);
            }
            continue;
        }
        for j in 0..3 {
            let h = 1e-9;
            let (mut a, mut b) = (eps, eps);
            a[j] += h;
            b[j] -= h;
            let sa = ret(&a, None).0;
            let sb = ret(&b, None).0;
            for i in 0..3 {
                assert!(((sa[i] - sb[i]) / (2.0 * h) - cm[4 * i + j]).abs() < 1e-6 * E);
            }
        }
    }
    assert!(unsymmetric > 20, "{unsymmetric}");
    assert!(apex > 5, "{apex}");
}

#[test]
fn return_map_returns_a_tresca_trial_stress_by_half_the_excess_of_the_shear_stress() {
    // σ1 = 30, σ2 = 10, σ3 = 0 with c = 10, φ = 0: f = 5, return along (1, 0, −1)/2 → (25, 10, 5)
    let mut cm = [0.0; 16];
    let r = return_map(
        [30.0, 0.0, 0.0, 10.0],
        E,
        NU,
        10.0,
        0.0,
        1.0,
        false,
        &mut cm,
        f64::INFINITY,
    )
    .unwrap();
    close(r.stress[0], 25.0, 9);
    close(r.stress[1], 5.0, 9);
    close(r.stress[3], 10.0, 9);
}

// ── fem/srm.test.ts ──────────────────────────────────────────────────

const DEG: f64 = PI / 180.0;

#[test]
fn davis_b_reproduces_the_factors_of_sysala_et_al_2021_table_1() {
    // Single material: FS_B solves q_B(FS_B) = FS_associated = 1.52 (φ' = 45°).
    let solve = |psi: f64| {
        let (mut a, mut b) = (1.0, 1.52);
        for _ in 0..60 {
            let m = (a + b) / 2.0;
            if davis_b(m, 45.0 * DEG, psi * DEG) < 1.52 {
                a = m;
            } else {
                b = m;
            }
        }
        (a + b) / 2.0
    };
    close(solve(15.0), 1.356, 2);
    close(solve(0.0), 1.145, 2);
}

#[test]
fn davis_b_is_f_for_associated_flow_and_f_over_cos_phi_f_for_psi_0() {
    close(davis_b(1.3, 30.0 * DEG, 30.0 * DEG), 1.3, 12);
    let phi_f = ((30.0 * DEG).tan() / 1.3).atan();
    close(davis_b(1.3, 30.0 * DEG, 0.0), 1.3 / phi_f.cos(), 12);
}

#[test]
fn strength_reduction_with_reinforcement_raises_the_factor_of_safety() {
    let def = |reinforced: bool| {
        let r: Vec<Value> = if reinforced {
            [5.0, 6.5, 8.0]
                .iter()
                .map(|&y| json!({ "x1": 15.0 - ((y - 4.0) * 5.0) / 6.0, "y1": y, "x2": 2, "y2": y, "tensileCapacity": 60, "application": "passive" }))
                .collect()
        } else {
            vec![]
        };
        json!({
            "coordinates": [[0, 0], [0, 10], [10, 10], [15, 4], [30, 4], [30, 0]],
            "materials": [{ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 25 } }],
            "reinforcements": r,
        })
    };
    for solver in [TrialSolver::Newton, TrialSolver::Viscoplastic] {
        let o = SrmOptions {
            solver: Some(solver),
            f_tolerance: Some(0.02),
            ..Default::default()
        };
        let plain = strength_reduction(
            &mut build_fe_model(&slope_of(def(false)), &size(1.5)).unwrap(),
            &o,
        )
        .unwrap();
        let reinf = strength_reduction(
            &mut build_fe_model(&slope_of(def(true)), &size(1.5)).unwrap(),
            &o,
        )
        .unwrap();
        assert!(
            reinf.factor_of_safety > plain.factor_of_safety + 0.01,
            "{solver:?}"
        );
    }
}

// ── fem/initial-stress.test.ts ───────────────────────────────────────

fn k0_layer() -> Slope {
    slope_of(json!({
        "coordinates": [[0, 0], [0, 10], [40, 10], [40, 0]],
        "materials": [{ "name": "s", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } }],
    }))
}

fn norm(a: &[f64]) -> f64 {
    a.iter().map(|v| v * v).sum::<f64>().sqrt()
}

#[test]
fn k0_gives_the_elastic_gravity_stresses_of_level_ground_for_k0_nu_over_1_minus_nu() {
    let layer = k0_layer();
    let model = build_fe_model(&layer, &size(2.0)).unwrap();
    let elastic = solve_elastic(&model).stress;
    let k0 = k0_stress(
        &model,
        &layer,
        &K0Options {
            k0: Some(0.3 / 0.7),
            ..Default::default()
        },
    );
    let (mut diff, mut max) = (0.0f64, 0.0f64);
    for i in 0..k0.len() {
        diff = diff.max((k0[i] - elastic[i]).abs());
        max = max.max(elastic[i].abs());
    }
    assert!(diff < 1e-9 * max, "{diff}");
    // the out-of-balance force of a field in equilibrium vanishes
    assert!(norm(&with_initial_stress(&model, &k0).f) < 1e-9 * model.load_norm);
}

#[test]
fn k0_takes_jaky_by_default_and_counts_the_overburden_from_an_original_ground_level() {
    let layer = k0_layer();
    let model = build_fe_model(&layer, &size(2.0)).unwrap();
    let k0 = k0_stress(&model, &layer, &K0Options::default());
    let deep = k0_stress(
        &model,
        &layer,
        &K0Options {
            original_ground_level: Some(15.0),
            ..Default::default()
        },
    );
    let i = model.gp_y.iter().position(|&y| y < 2.0).unwrap();
    close(k0[4 * i] / k0[4 * i + 1], 1.0 - (PI / 6.0).sin(), 12);
    close(k0[4 * i + 1], -20.0 * (10.0 - model.gp_y[i]), 9);
    close(deep[4 * i + 1], -20.0 * (15.0 - model.gp_y[i]), 9);
}

fn embankment(foundation: Value) -> Value {
    json!({
        "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [40, 5], [40, 0]],
        "materials": [
            { "name": "found", "model": foundation },
            { "name": "fill1", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } },
            { "name": "fill2", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } },
        ],
        "materialBoundaries": [{ "coordinates": [[0, 5], [40, 5]], "materialName": "found" }, { "coordinates": [[0, 7.5], [40, 7.5]], "materialName": "fill1" }],
        "regionAssignments": [{ "point": [20, 2.5], "materialName": "found" }, { "point": [5, 6], "materialName": "fill1" }, { "point": [5, 9], "materialName": "fill2" }],
    })
}

fn found(c: f64) -> Value {
    json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": c, "frictionAngle": 25 })
}

fn stages(pairs: &[(&str, f64)]) -> InitialStressOptions {
    InitialStressOptions {
        material_stages: Some(pairs.iter().map(|(k, v)| (k.to_string(), *v)).collect()),
        ..Default::default()
    }
}

fn associated() -> SrmOptions {
    SrmOptions {
        flow_rule: Some(FlowRule::Associated),
        ..Default::default()
    }
}

#[test]
fn staged_construction_leaves_materials_of_later_stages_weightless() {
    let slope = slope_of(embankment(found(15.0)));
    let full = build_fe_model(&slope, &size(1.5)).unwrap();
    let first = build_fe_model(
        &slope,
        &FeModelOptions {
            element_size: Some(1.5),
            inactive_materials: Some(vec!["fill1".into(), "fill2".into()]),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(first.element_count, full.element_count);
    assert!(first.el_inactive.iter().any(|&v| v));
    assert!(first.load_norm < full.load_norm);
}

/// The prepareFeModel part of "builds the embankment in layers" (its
/// analyzeFem part waits for the analysis port).
#[test]
fn staged_construction_carries_the_stresses_over() {
    let slope = slope_of(embankment(found(15.0)));
    let p = prepare_fe_model(
        &slope,
        &size(1.5),
        &stages(&[("fill1", 1.0), ("fill2", 2.0)]),
        &associated(),
    )
    .unwrap();
    let model = p.model;
    let top = model
        .materials
        .iter()
        .position(|m| m.name == "fill2")
        .unwrap();
    let base = model
        .materials
        .iter()
        .position(|m| m.name == "found")
        .unwrap();
    let s0 = model.stress0.as_ref().unwrap();
    let (mut top_max, mut base_min) = (0.0f64, 0.0f64);
    for e in 0..model.element_count {
        for g in 0..3 {
            let sy = s0[4 * (3 * e + g) + 1];
            if model.el_material[e] == top {
                top_max = top_max.max(sy.abs());
            }
            if model.el_material[e] == base {
                base_min = base_min.min(sy);
            }
        }
    }
    assert_eq!(top_max, 0.0);
    assert!(base_min < -100.0, "{base_min}");
}

#[test]
fn staged_construction_warns_when_a_stage_fails_while_it_is_built() {
    // a foundation too weak for the first fill layer
    let slope = slope_of(embankment(
        json!({ "kind": "undrained", "unitWeight": 19, "undrainedShearStrength": 5 }),
    ));
    let r = prepare_fe_model(
        &slope,
        &size(1.5),
        &stages(&[("fill1", 1.0), ("fill2", 2.0)]),
        &associated(),
    )
    .unwrap();
    assert!(r
        .warnings
        .iter()
        .any(|w| w.contains("Construction stage 2 of 3 did not reach equilibrium")));
    // the failed stage's last state is carried on (Newton keeps none; the viscoplastic iteration does)
    assert!(max_abs(r.model.stress0.as_ref().unwrap()) > 50.0);
}

#[test]
fn k0_procedure_through_prepare_fe_model() {
    // (not a TypeScript test: the K0 option of prepareFeModel without stages)
    let layer = k0_layer();
    let p = prepare_fe_model(
        &layer,
        &size(2.0),
        &InitialStressOptions {
            initial_stress: Some(InitialStress::K0),
            k0: Some(0.3 / 0.7),
            ..Default::default()
        },
        &associated(),
    )
    .unwrap();
    assert!(norm(&p.model.f) < 1e-9 * p.model.load_norm);
}

// ── fem/piles.test.ts ────────────────────────────────────────────────

/// Solve a small dense system (Gaussian elimination).
fn solve(a: &[Vec<f64>], b: &[f64]) -> Vec<f64> {
    let n = b.len();
    let mut a: Vec<Vec<f64>> = a.to_vec();
    let mut x = b.to_vec();
    for k in 0..n {
        for i in k + 1..n {
            let m = a[i][k] / a[k][k];
            for j in k..n {
                a[i][j] -= m * a[k][j];
            }
            x[i] -= m * x[k];
        }
    }
    for i in (0..n).rev() {
        let mut s = x[i];
        for j in i + 1..n {
            s -= a[i][j] * x[j];
        }
        x[i] = s / a[i][i];
    }
    x
}

#[test]
fn pile_beams_bend_as_an_euler_bernoulli_cantilever_at_any_inclination() {
    // a cantilever of 4 elements, fixed at node 0, load P across its tip
    let (l, n, ei, ea, p) = (8.0, 4usize, 2e4, 1e6, 10.0);
    for angle in [0.0f64, 30.0, 90.0] {
        let (c, s) = ((angle * PI / 180.0).cos(), (angle * PI / 180.0).sin());
        let nn = 3 * (n + 1);
        let mut k = vec![vec![0.0; nn]; nn];
        let mut ke = [0.0; 36];
        for e in 0..n {
            frame_stiffness(c, s, l / n as f64, ea, ei, &mut ke);
            for i in 0..6 {
                for j in 0..6 {
                    k[3 * e + i][3 * e + j] += ke[6 * i + j];
                }
            }
        }
        let free: Vec<usize> = (3..nn).collect();
        let kf: Vec<Vec<f64>> = free
            .iter()
            .map(|&i| free.iter().map(|&j| k[i][j]).collect())
            .collect();
        let mut f = vec![0.0; nn];
        f[3 * n] = -s * p;
        f[3 * n + 1] = c * p; // perpendicular to the axis
        let u = solve(&kf, &free.iter().map(|&i| f[i]).collect::<Vec<_>>());
        let tip = -s * u[3 * n - 3] + c * u[3 * n - 2]; // deflection across the axis
        close(tip, (p * l.powi(3)) / (3.0 * ei), 9);
        close(u[3 * n - 1], (p * l * l) / (2.0 * ei), 9);
    }
}

#[test]
fn pile_springs_limit_the_soils_pressure_as_broms_reduced_with_the_strength() {
    let (d, c, sv, phi) = (0.6, 20.0, 50.0, 30.0 * PI / 180.0);
    let kp = (1.0 + phi.sin()) / (1.0 - phi.sin());
    close(
        spring_capacity(1, 9.0 * c * d, 3.0 * sv * d, phi.tan(), 1.0),
        9.0 * c * d + 3.0 * (kp - 1.0 / kp) * sv * d,
        9,
    );
    let phi_f = (phi.tan() / 2.0).atan();
    let kp_f = (1.0 + phi_f.sin()) / (1.0 - phi_f.sin());
    close(
        spring_capacity(1, 9.0 * c * d, 3.0 * sv * d, phi.tan(), 2.0),
        (9.0 * c * d) / 2.0 + 3.0 * (kp_f - 1.0 / kp_f) * sv * d,
        9,
    );
    // undrained (φ = 0): Broms' 9 c d alone; the support vanishes with the strength
    close(
        spring_capacity(1, 9.0 * c * d, 3.0 * sv * d, 0.0, 1.0),
        9.0 * c * d,
        9,
    );
    assert!(spring_capacity(1, 9.0 * c * d, 3.0 * sv * d, phi.tan(), 1e6) < 1e-3);
}

fn pile_def(piles: Value) -> Value {
    json!({
        "coordinates": [[0, 0], [0, 15], [15, 15], [30, 5], [50, 5], [50, 0]],
        "materials": [{ "name": "soil", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 8, "frictionAngle": 25 } }],
        "piles": piles,
    })
}

fn pile_row() -> Value {
    json!({ "x1": 22, "y1": 15.0 - (7.0 * 10.0) / 15.0, "x2": 22, "y2": 0.5, "diameter": 0.6, "spacing": 2, "application": "passive" })
}

/// The buildFeModel part of "warn where the forces exceed the pile's
/// capacity, and leave out a pile without a diameter" (its analyzeFem part
/// waits for the analysis port).
#[test]
fn pile_rows_leave_out_a_pile_without_a_diameter() {
    let mut row = pile_row();
    row.as_object_mut().unwrap().remove("diameter");
    row["force"] = json!(100);
    let m = build_fe_model(&slope_of(pile_def(json!([row]))), &size(2.0)).unwrap();
    assert_eq!(m.piles.count, 0);
    assert!(m.warnings.iter().any(|w| w.contains("no diameter")));
}

#[test]
fn pile_rows_keep_the_mesh_of_the_construction_stages_that_of_the_final_model() {
    let mut def = pile_def(json!([pile_row()]));
    def["materials"] = json!([
        { "name": "found", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 8, "frictionAngle": 25 } },
        { "name": "fill", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 8, "frictionAngle": 25 } },
    ]);
    def["materialBoundaries"] =
        json!([{ "coordinates": [[0, 8], [50, 8]], "materialName": "found" }]);
    def["regionAssignments"] = json!([{ "point": [40, 3], "materialName": "found" }, { "point": [5, 12], "materialName": "fill" }]);
    let slope = slope_of(def);
    let p = prepare_fe_model(&slope, &size(1.5), &stages(&[("fill", 1.0)]), &associated()).unwrap();
    let model = p.model;
    assert_eq!(
        model.stress0.as_ref().unwrap().len(),
        12 * model.element_count
    );
    assert!(model.f.iter().all(|v| v.is_finite()));
    assert!(model.piles.count > 0);
}

// ── fem/anchors.test.ts ──────────────────────────────────────────────

fn anchor_def(pullout: Value, prestress: f64) -> Value {
    json!({
        "coordinates": [[0, 0], [0, 10], [10, 10], [15, 4], [30, 4], [30, 0]],
        "materials": [{ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 25 } }],
        "reinforcements": [{ "x1": 13.75, "y1": 5.5, "x2": 1, "y2": 5.5, "tensileCapacity": 150, "end1Capacity": 200, "pullout": pullout, "prestress": prestress, "application": "active" }],
    })
}

fn anchor_model(pullout: Value, prestress: f64) -> FeModel {
    build_fe_model(&slope_of(anchor_def(pullout, prestress)), &size(1.0)).unwrap()
}

/// Axial force of each bar Gauss point.
fn forces(m: &FeModel, u: &[f64], bar_ep: &[f64]) -> Vec<f64> {
    let mut out = Vec::new();
    for b in 0..m.bars.count {
        for g in 0..2 {
            let o = (2 * b + g) * BAR_GP_STRIDE;
            let mut eps = 0.0;
            for k in 0..3 {
                let n = m.bars.nodes[3 * b + k];
                let (ix, iy) = (m.eq[2 * n], m.eq[2 * n + 1]);
                if ix >= 0 {
                    eps += m.bars.gp[o + 2 * k] * u[ix as usize];
                }
                if iy >= 0 {
                    eps += m.bars.gp[o + 2 * k + 1] * u[iy as usize];
                }
            }
            out.push(m.bars.stiffness[b] * (eps - bar_ep[2 * b + g]));
        }
    }
    out
}

fn free_bars(m: &FeModel) -> Vec<usize> {
    (0..m.bars.count)
        .filter(|&b| m.bars.nodes[3 * b] == m.bars.nodes[3 * b + 1])
        .collect()
}

#[test]
fn grouted_anchors_join_the_free_length_to_the_soil_only_at_its_ends() {
    let nail = anchor_model(json!({ "kind": "bond", "strength": 100 }), 0.0);
    let anchor = anchor_model(
        json!({ "kind": "bond", "strength": 100, "bondedLength": 4 }),
        0.0,
    );
    assert!(anchor.bars.count < nail.bars.count);
    // the free bar runs from the head (x = 13.75) to the start of the bonded length (x = 5)
    let free = free_bars(&anchor)[0];
    let (a, z) = (anchor.bars.nodes[3 * free], anchor.bars.nodes[3 * free + 2]);
    close(anchor.x[a], 13.75, 6);
    close(anchor.x[z], 5.0, 6);
}

#[test]
fn grouted_anchors_start_the_free_length_where_the_line_enters_the_soil() {
    // the head 1.5 m above the crest
    let mut d = anchor_def(
        json!({ "kind": "bond", "strength": 100, "bondedLength": 4 }),
        80.0,
    );
    d["reinforcements"][0]["x1"] = json!(8);
    d["reinforcements"][0]["y1"] = json!(11.5);
    d["reinforcements"][0]["x2"] = json!(1);
    d["reinforcements"][0]["y2"] = json!(5.5);
    let m = build_fe_model(&slope_of(d), &size(1.0)).unwrap();
    let free = free_bars(&m);
    assert_eq!(free.len(), 1);
    assert!(m.bars.ep0[2 * free[0]] < 0.0);
    assert!(m.warnings.is_empty(), "{:?}", m.warnings);
}

#[test]
fn grouted_anchors_carry_their_lock_off_load_in_the_free_length_with_both_solvers() {
    let free_force = |prestress: f64, solver: TrialSolver| {
        let mut m = anchor_model(
            json!({ "kind": "bond", "strength": 100, "bondedLength": 4 }),
            prestress,
        );
        // a strong soil (F = 0.5): the anchor works elastically
        let r = run_trial(
            &mut m,
            0.5,
            None,
            &SrmOptions {
                solver: Some(solver),
                ..Default::default()
            },
            0.0,
        )
        .unwrap();
        assert!(r.converged);
        let n = forces(&m, &r.state.u, &r.state.bar_ep);
        let b = free_bars(&m)[0];
        close(n[2 * b + 1], n[2 * b], 6); // constant along the free length
        n[2 * b]
    };
    for solver in [TrialSolver::Newton, TrialSolver::Viscoplastic] {
        let slack = free_force(0.0, solver);
        let locked = free_force(80.0, solver);
        // much of the lock-off load is lost as the head, a single node without a
        // bearing plate, presses into the soft soil (E = 10⁵ kPa)
        assert!(locked - slack > 10.0, "{solver:?}: {locked} − {slack}");
        assert!(locked <= 150.0 + 1e-6);
    }
}

// ── fem/transfer.test.ts ─────────────────────────────────────────────

fn transfer_slope() -> Slope {
    slope_of(json!({
        "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
        "materials": [{ "name": "soil", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 25 } }],
    }))
}

#[test]
fn transfer_state_reproduces_a_quadratic_displacement_field_and_carries_the_gauss_point_values() {
    let s = transfer_slope();
    let coarse = build_fe_model(&s, &size(3.0)).unwrap();
    let fine = build_fe_model(&s, &size(1.5)).unwrap();
    // the base is fixed and the sides carry no horizontal displacement
    let field = |x: f64, y: f64| (0.0, 0.02 * y * y + 0.01 * x * y);
    let mut st = empty_state(&coarse);
    for n in 0..coarse.node_count {
        let (ux, uy) = field(coarse.x[n], coarse.y[n]);
        if coarse.eq[2 * n] >= 0 {
            st.u[coarse.eq[2 * n] as usize] = ux;
        }
        if coarse.eq[2 * n + 1] >= 0 {
            st.u[coarse.eq[2 * n + 1] as usize] = uy;
        }
    }
    st.evp.fill(0.25);
    st.stress.fill(-7.0);
    let t = transfer_state(&coarse, &st, &fine).unwrap();
    for n in 0..fine.node_count {
        let (ux, uy) = field(fine.x[n], fine.y[n]);
        if fine.eq[2 * n] >= 0 {
            close(t.u[fine.eq[2 * n] as usize], ux, 9);
        }
        if fine.eq[2 * n + 1] >= 0 {
            close(t.u[fine.eq[2 * n + 1] as usize], uy, 9);
        }
    }
    assert_eq!(t.evp.len(), 12 * fine.element_count);
    assert!(t.evp.iter().all(|&v| v == 0.25) && t.stress.iter().all(|&v| v == -7.0));
}

#[test]
fn transfer_state_starts_the_search_on_a_refined_mesh_in_fewer_trials() {
    let s = transfer_slope();
    let mut coarse = build_fe_model(&s, &size(2.5)).unwrap();
    let mut fine = build_fe_model(&s, &size(1.5)).unwrap();
    let f_tol = SrmOptions {
        f_tolerance: Some(0.005),
        ..Default::default()
    };
    let r0 = strength_reduction(&mut coarse, &f_tol).unwrap();
    let f0 = r0.factor_of_safety;
    let cold = strength_reduction(
        &mut fine,
        &SrmOptions {
            start_f: Some(0.6 * f0),
            guide: Some(f0),
            bracket_step: Some(0.04),
            ..f_tol.clone()
        },
    )
    .unwrap();
    let warm_start = transfer_state(&coarse, &r0.state, &fine).unwrap();
    let warm = strength_reduction(
        &mut fine,
        &SrmOptions {
            start_f: Some(0.97 * f0),
            guide: Some(f0),
            bracket_step: Some(0.04),
            warm_start: Some(Arc::new(warm_start)),
            ..f_tol
        },
    )
    .unwrap();
    assert!((warm.factor_of_safety - cold.factor_of_safety).abs() <= 0.005);
    assert!(warm.trials.len() < cold.trials.len());
}

// ── fem/analysis.test.ts (the parts that test model.rs and adapt.rs) ─

fn cut(extra: Value) -> Value {
    let mut d = json!({
        "coordinates": [[0, 0], [0, 10], [10, 10], [15, 5], [30, 5], [30, 0]],
        "materials": [{ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 20 } }],
    });
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    d
}

#[test]
fn a_model_without_ignored_inputs_gets_none_of_their_warnings() {
    // the ignoredInputWarnings part of "warns that rᵤ is not included"
    assert!(ignored_input_warnings(&slope_of(cut(json!({})))).is_empty());
    let ru = slope_of(cut(
        json!({ "materials": [{ "name": "Clay", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 10, "frictionAngle": 25, "ru": 0.3 } }] }),
    ));
    let w = ignored_input_warnings(&ru);
    assert!(w.iter().any(|x| x.contains("rᵤ") && x.contains("Clay")));
}

#[test]
fn inputs_the_finite_element_analyses_do_not_take_are_each_named() {
    let clay = json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "bBar": 0.5, "aboveWater": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30 } });
    let water = json!({ "mode": "custom", "value": [[0, 6], [30, 6]], "followBoundary": false });
    let def = cut(json!({
        "materials": [{ "name": "Clay", "model": clay }],
        "waterTable": water,
        "waternet": { "headLines": [{ "id": "h", "points": [[0, 6], [30, 6]] }], "referenceLines": [{ "points": [[0, -5], [30, -5]], "topHeadLineId": "h", "bottomHeadLineId": "h" }] },
        "udls": [{ "magnitude": 10, "x1": 1, "x2": 5, "excessPorePressure": [{ "material": "Clay", "ratio": 0.5 }] }],
        "earlierStage": cut(json!({ "materials": [{ "name": "Clay", "model": clay }] })),
        "rapidDrawdown": { "waterBefore": [[0, 8], [30, 8]] },
    }));
    let w = ignored_input_warnings(&slope_of(def));
    for what in [
        "waternet",
        "B̄",
        "above the water table",
        "distributed loads",
        "earlier stage",
        "Rapid drawdown",
    ] {
        assert!(w.iter().any(|x| x.contains(what)), "{what}: {w:?}");
    }
}

#[test]
fn adaptive_refinement_halves_the_size_of_marked_elements_only() {
    let slope = slope_of(cut(json!({})));
    let model = build_fe_model(&slope, &size(2.0)).unwrap();
    let stress = solve_elastic(&model).stress;
    let eta = zz_indicator(&model, &stress);
    let marked = dorfler_mark(&eta, 0.5);
    let (mut sum, mut marked_sum, mut count) = (0.0, 0.0, 0);
    for e in 0..eta.len() {
        sum += eta[e];
        if marked[e] {
            marked_sum += eta[e];
            count += 1;
        }
    }
    assert!(marked_sum >= 0.5 * sum);
    assert!(count < eta.len());
    let field = refined_size_field(&model, &marked, 0.0);
    let finer = build_fe_model(
        &slope,
        &FeModelOptions {
            size_field: Some(field),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(finer.element_count > model.element_count);
}

// ── model/suction-strength.test.ts ("is taken by the finite element model") ─

#[test]
fn suction_strength_is_taken_by_the_finite_element_model_at_its_gauss_points() {
    let def = |model: Value| {
        let mut m =
            json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 5, "frictionAngle": 28 });
        for (k, v) in model.as_object().unwrap() {
            m[k] = v.clone();
        }
        // (buildSlope directly, as the TypeScript test: no canonical form)
        let d: SlopeDefinition = serde_json::from_value(json!({
            "coordinates": [[0, -25], [0, 0], [20, 0], [40, -10], [60, -10], [60, -25]],
            "materials": [{ "name": "Soil", "model": m }],
            "waterTable": { "mode": "custom", "value": [[0, -15], [60, -15]] },
        }))
        .unwrap();
        build_slope(&d).unwrap()
    };
    let tan = |deg: f64| (deg * PI / 180.0).tan();
    let m0 = build_fe_model(&def(json!({})), &size(3.0)).unwrap();
    let m1 = build_fe_model(&def(json!({ "phiB": 15, "maxSuction": 60 })), &size(3.0)).unwrap();
    assert_eq!(m1.gp_c.len(), m0.gp_c.len());
    let mut checked = 0;
    for i in 0..m0.gp_c.len() {
        let suction = (WATER_UNIT_WEIGHT * (m0.gp_y[i] + 15.0)).max(0.0);
        close(m1.gp_c[i], m0.gp_c[i] + suction.min(60.0) * tan(15.0), 9);
        if suction > 0.0 {
            checked += 1;
        }
    }
    assert!(checked > 0);
}

// ── SrmSearch (the generator as a state machine; not a TypeScript test) ─

#[test]
fn srm_search_steps_give_the_result_of_strength_reduction() {
    use cslope_engine::fem::srm::{SrmSearch, SrmStep};
    let slope = slope_of(cut(json!({})));
    let mut model = build_fe_model(&slope, &size(2.5)).unwrap();
    let options = SrmOptions {
        trials_per_round: Some(3.0),
        ..Default::default()
    };
    let direct = strength_reduction(&mut model, &options).unwrap();
    let mut search = SrmSearch::new(&model, &options);
    // outcomes before any batch was asked for
    assert!(search.step(&model, Some(vec![])).is_err());
    let mut outcomes = None;
    let mut batches = 0;
    let result = loop {
        match search.step(&model, outcomes.take()).unwrap() {
            SrmStep::Batch(b) => {
                batches += 1;
                if batches == 1 {
                    // a step without the outcomes it waits for is refused, and the batch stays
                    assert!(search.step(&model, None).is_err());
                }
                // the trials of a batch run in any order (here in reverse) give the same result
                let mut out: Vec<_> = b
                    .f
                    .iter()
                    .rev()
                    .map(|&f| {
                        run_trial(&mut model, f, b.start.as_deref(), &options, b.start_f).unwrap()
                    })
                    .collect();
                out.reverse();
                outcomes = Some(out);
            }
            SrmStep::Done(r) => break *r,
        }
    };
    assert_eq!(result.factor_of_safety, direct.factor_of_safety);
    assert_eq!(result.trials, direct.trials);
    assert!(batches < result.trials.len(), "three trials per round");
    assert!(search.step(&model, None).is_err(), "the search has ended");
}
