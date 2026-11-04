//! Ports of packages/engine/src/model/slices-branches.test.ts (the Rankine
//! crack depth in every case, design strength per material model,
//! degenerate surfaces, per-material water) and slice-boundaries.test.ts
//! (slice edges at water-line vertices, the base material on a layer
//! boundary, fixed slices).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::geometry_ops::Polyline;
use cslope_engine::model::slices::{get_slices, head_factor, rankine_crack_depth, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::types::{
    PartialFactors, PorePressureHead, Slice, Udl, UdlParams, WaterTableInput, WATER_UNIT_WEIGHT,
};
use model_core_support::{close, def, layered, material, mc, su};
use serde_json::{json, Value};
use solvers_support::run_verification;
use std::f64::consts::PI;

const BOUNDARY: [[f64; 2]; 6] = [
    [0.0, -10.0],
    [0.0, 10.0],
    [10.0, 10.0],
    [25.0, 0.0],
    [40.0, 0.0],
    [40.0, -10.0],
];

fn f() -> PartialFactors {
    PartialFactors {
        cu: 1.4,
        cohesion: 1.25,
        tan_phi: 1.2,
        variable_load: 1.3,
        basis: None,
    }
}

fn slope_of(model: Value) -> Slope {
    let mut s = Slope::new();
    s.add_material(material("M", model));
    s.set_external_boundary(&BOUNDARY).unwrap();
    s
}

fn with_factors(s: &mut Slope) {
    s.update_analysis_options(&AnalysisOptionsPatch {
        partial_factors: Some(Some(f())),
        ..Default::default()
    })
    .unwrap();
}

fn udl(magnitude: f64, x1: f64, x2: f64) -> Udl {
    Udl::new(UdlParams {
        magnitude,
        x1,
        x2,
        ..Default::default()
    })
}

fn slices(
    s: &Slope,
    x0: f64,
    x1: f64,
    cx: f64,
    cy: f64,
    r: f64,
    pts: Option<&[[f64; 2]]>,
) -> Vec<Slice> {
    get_slices(s, x0, x1, cx, cy, r, pts, &mut SliceScratch::new()).unwrap()
}

fn rankine(s: &Slope, x: f64) -> f64 {
    rankine_crack_depth(s, x).unwrap()
}

// ── rankineCrackDepth ─────────────────────────────────────────────

#[test]
fn rankine_undrained_with_gamma_cu_less_the_factored_surcharge() {
    let mut s =
        slope_of(json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 27 }));
    close(rankine(&s, 5.0), 3.0, 9);
    with_factors(&mut s);
    close(rankine(&s, 5.0), (2.0 * 27.0) / 1.4 / 18.0, 9);
    s.set_udls(vec![udl(10.0, 8.0, 2.0)]);
    close(
        rankine(&s, 5.0),
        (2.0 * 27.0) / 1.4 / 18.0 - (10.0 * 1.3) / 18.0,
        9,
    );
    // A surcharge larger than the cohesion closes the crack.
    s.set_udls(vec![udl(100.0, 0.0, 10.0)]);
    assert_eq!(rankine(&s, 5.0), 0.0);
}

#[test]
fn rankine_c_phi_with_the_drained_factors() {
    let mut s = slope_of(
        json!({ "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 }),
    );
    let sqrt_ka = (PI / 4.0 - PI / 12.0).tan();
    close(rankine(&s, 5.0), (2.0 * 10.0) / (20.0 * sqrt_ka), 9);
    with_factors(&mut s);
    let phi_d = ((PI / 6.0).tan() / 1.2).atan();
    close(
        rankine(&s, 5.0),
        (2.0 * 10.0) / 1.25 / (20.0 * (PI / 4.0 - phi_d / 2.0).tan()),
        9,
    );
}

#[test]
fn rankine_free_water_is_a_surcharge_none_without_cohesion_in_rock_or_outside() {
    let mut s =
        slope_of(json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 36 }));
    s.set_water_table(&WaterTableInput::Height {
        height: 1.0,
        follow_boundary: Some(false),
    })
    .unwrap();
    // At x = 30 the ground is at 0: 1 m of water.
    close(rankine(&s, 30.0), 4.0 - WATER_UNIT_WEIGHT / 18.0, 9);
    // Below the ground the water is no surcharge.
    close(rankine(&s, 5.0), 4.0, 9);
    assert_eq!(
        rankine(
            &slope_of(
                json!({ "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 0, "frictionAngle": 35 })
            ),
            5.0
        ),
        0.0
    );
    assert_eq!(
        rankine(
            &slope_of(json!({ "kind": "high-strength", "unitWeight": 25 })),
            5.0
        ),
        0.0
    );
    assert_eq!(
        rankine(
            &slope_of(json!({ "kind": "impenetrable", "unitWeight": 25 })),
            5.0
        ),
        0.0
    );
    assert_eq!(rankine(&s, 50.0), 0.0);
    assert_eq!(rankine(&Slope::new(), 5.0), 0.0);
}

#[test]
fn rankine_lime_cement_columns_and_s_f_depth_from_the_layer_top() {
    let mut lcc = slope_of(json!({
        "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 10, "columnSu": 100, "areaRatio": 0.2,
        "columnCohesion": 20, "columnFrictionAngle": 30,
    }));
    let c = 0.8 * 10.0 + 0.2 * 20.0;
    let tan_phi = 0.2 * (PI / 6.0).tan();
    let z = |cc: f64, t: f64| (2.0 * cc) / (16.0 * (PI / 4.0 - t.atan() / 2.0).tan());
    close(rankine(&lcc, 5.0), z(c, tan_phi), 9);
    with_factors(&mut lcc);
    close(
        rankine(&lcc, 5.0),
        z((0.8 * 10.0) / 1.4 + (0.2 * 20.0) / 1.25, tan_phi / 1.2),
        9,
    );
    let sfd = slope_of(
        json!({ "kind": "s-f-depth", "unitWeight": 18, "suRef": 18, "depthRef": 0, "rate": 0, "depthReference": "layer-top" }),
    );
    close(rankine(&sfd, 5.0), 2.0, 6);
}

// ── design strength of the slices ─────────────────────────────────

fn slices_of(model: Value) -> Vec<Slice> {
    let (cx, cy, r) = (22.0, 18.0, 18.5);
    let mut s = slope_of(model);
    s.update_analysis_options(&AnalysisOptionsPatch {
        partial_factors: Some(Some(f())),
        slices: Some(10.0),
        ..Default::default()
    })
    .unwrap();
    let ints = s.get_circle_external_intersection(cx, cy, r).unwrap();
    slices(&s, ints[0][0], ints[ints.len() - 1][0], cx, cy, r, None)
}

#[test]
fn each_model_takes_its_own_factors() {
    let drained = &slices_of(
        json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 10, "frictionAngle": 30 }),
    )[0];
    close(drained.cohesion, 10.0 / 1.25, 12);
    close(drained.phi.tan(), (PI / 6.0).tan() / 1.2, 12);
    close(drained.friction_angle, (drained.phi * 180.0) / PI, 12);
    // φ = 0 Mohr-Coulomb is undrained clay.
    close(
        slices_of(
            json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 28, "frictionAngle": 0 }),
        )[0]
        .cohesion,
        20.0,
        12,
    );
    for m in [
        json!({ "kind": "undrained", "unitWeight": 19, "undrainedShearStrength": 28 }),
        json!({ "kind": "s-f-depth", "unitWeight": 19, "suRef": 28, "depthRef": 0, "rate": 0 }),
        json!({ "kind": "s-f-datum", "unitWeight": 19, "suRef": 28, "yRef": 0, "rate": 0 }),
    ] {
        let s = &slices_of(m)[0];
        close(s.cohesion, 20.0, 12);
        close(s.cohesion_undrained, 20.0, 12);
    }
    // Combined: drained c′ with γc′, its undrained strength with γcu.
    let combined = &slices_of(
        json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 10, "frictionAngle": 30, "cFactor": 1, "cohesionUndrained": 28 }),
    )[0];
    assert_eq!(combined.is_combined, Some(true));
    close(combined.cohesion, 8.0, 12);
    close(combined.cohesion_undrained, 20.0, 12);
    // Columns, drained limit: (1 − a)·cu,soil with γcu, a·c′ with γc′, tan φ′
    // with γφ′, the undrained a·cu,col + (1 − a)·cu,soil with γcu.
    let lcc = &slices_of(json!({
        "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 10, "columnSu": 100, "areaRatio": 0.2,
        "columnCohesion": 20, "columnFrictionAngle": 30,
    }))[0];
    close(lcc.cohesion, (0.8 * 10.0) / 1.4 + (0.2 * 20.0) / 1.25, 12);
    close(lcc.phi.tan(), (0.2 * (PI / 6.0).tan()) / 1.2, 12);
    close(lcc.cohesion_undrained, (0.2 * 100.0 + 0.8 * 10.0) / 1.4, 12);
    // Undrained columns: all of it with γcu.
    let lcc_u = &slices_of(
        json!({ "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 10, "columnSu": 100, "areaRatio": 0.2 }),
    )[0];
    close(lcc_u.cohesion, (0.2 * 100.0 + 0.8 * 10.0) / 1.4, 12);
    assert_eq!(lcc_u.phi, 0.0);
    // Strong rock is not factored (and the surface is skipped).
    let rock = &slices_of(json!({ "kind": "high-strength", "unitWeight": 25 }))[0];
    assert_eq!(rock.skip_surface, Some(true));
}

// ── degenerate surfaces ───────────────────────────────────────────

fn mc_slope() -> Slope {
    slope_of(
        json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 10, "frictionAngle": 30 }),
    )
}

#[test]
fn rejects_an_entry_at_or_right_of_the_exit_and_a_model_without_ground() {
    let s = mc_slope();
    let mut sc = SliceScratch::new();
    let e = get_slices(&s, 20.0, 20.0, 22.0, 18.0, 18.5, None, &mut sc).unwrap_err();
    assert!(e.message.contains("x0 must be less than x1"));
    let e = get_slices(&Slope::new(), 0.0, 1.0, 0.0, 5.0, 5.0, None, &mut sc).unwrap_err();
    assert!(e.message.contains("Surface line not defined"));
}

#[test]
fn a_crack_deeper_than_the_surface_leaves_no_sliding_mass() {
    let mut t = mc_slope();
    t.update_analysis_options(&AnalysisOptionsPatch {
        tension_crack_depth: Some(50.0),
        ..Default::default()
    })
    .unwrap();
    let ints = t
        .get_circle_external_intersection(22.0, 18.0, 18.5)
        .unwrap();
    let (x0, x1) = (ints[0][0], ints[ints.len() - 1][0]);
    assert!(slices(&t, x0, x1, 22.0, 18.0, 18.5, None).is_empty());
    // Automatic crack in clay too stiff to ever reach the surface.
    let mut u =
        slope_of(json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 900 }));
    u.update_analysis_options(&AnalysisOptionsPatch {
        tension_crack_auto: Some(true),
        ..Default::default()
    })
    .unwrap();
    assert!(slices(&u, x0, x1, 22.0, 18.0, 18.5, None).is_empty());
}

#[test]
fn a_polyline_through_the_air_is_no_surface() {
    let s = mc_slope();
    let pts = [[5.0, 10.0], [15.0, 12.0], [30.0, 0.0]];
    assert!(slices(&s, 5.0, 30.0, 15.0, 30.0, 0.0, Some(&pts)).is_empty());
}

#[test]
fn a_materials_own_water_table_gives_its_slices_pore_pressure() {
    let mut t = mc_slope();
    t.set_water_table_by_id("w", &[[0.0, 2.0], [40.0, 1.0]], true)
        .unwrap();
    let m = t.material_geometries()[0].material;
    t.assign_material_water_table(m, "w");
    let ints = t
        .get_circle_external_intersection(22.0, 18.0, 18.5)
        .unwrap();
    let sl = slices(
        &t,
        ints[0][0],
        ints[ints.len() - 1][0],
        22.0,
        18.0,
        18.5,
        None,
    );
    assert!(sl.len() > 5);
    assert!(sl.iter().any(|q| q.u > 0.0));
}

#[test]
fn only_the_material_with_its_own_line_gets_pore_pressure() {
    let mut slope = build_slope(&def(json!({
        "coordinates": BOUNDARY,
        "materials": [
            { "name": "Top", "unitWeight": 19, "cohesion": 10, "frictionAngle": 25 },
            { "name": "Base", "unitWeight": 19, "cohesion": 10, "frictionAngle": 25, "waterTableId": "w" },
        ],
        "materialBoundaries": [{ "coordinates": [[0, 3], [40, -2]], "materialName": "Base" }],
        "regionAssignments": [{ "point": [1, 8], "materialName": "Top" }, { "point": [1, -5], "materialName": "Base" }],
        "waterTables": [{ "id": "w", "coordinates": [[0, 6], [40, 0]] }],
    })))
    .unwrap();
    slope
        .update_analysis_options(&AnalysisOptionsPatch {
            slices: Some(30.0),
            pore_pressure_head: Some(PorePressureHead::PhreaticCorrection.into()),
            ..Default::default()
        })
        .unwrap();
    let ints = slope
        .get_circle_external_intersection(22.0, 18.0, 18.5)
        .unwrap();
    let sl = slices(
        &slope,
        ints[0][0],
        ints[ints.len() - 1][0],
        22.0,
        18.0,
        18.5,
        None,
    );
    let name = |q: &Slice| slope.material(q.base_material.unwrap()).name.clone();
    let top: Vec<&Slice> = sl.iter().filter(|q| name(q) == "Top").collect();
    let base: Vec<&Slice> = sl.iter().filter(|q| name(q) == "Base").collect();
    assert!(!top.is_empty());
    assert!(top.iter().all(|q| q.u == 0.0));
    assert!(base.iter().any(|q| q.u > 0.0));
}

// ── slice-boundaries.test.ts ──────────────────────────────────────

/// Base at y = −6 from x = 20 to 22.67 (the review's probe slice).
const BASE: [[f64; 2]; 4] = [[8.0, 10.0], [20.0, -6.0], [22.67, -6.0], [35.0, 0.0]];

fn stepped_water(head: PorePressureHead) -> Slope {
    let mut s = Slope::new();
    s.add_material(material("M", mc(5.0, 30.0, 19.0)));
    s.set_external_boundary(&BOUNDARY).unwrap();
    // A wall at x = 21: water at −1 behind it, −4 in front.
    s.set_water_table(&WaterTableInput::Custom {
        coordinates: vec![[0.0, -1.0], [21.0, -1.0], [21.0, -4.0], [40.0, -4.0]],
        follow_boundary: Some(false),
    })
    .unwrap();
    s.update_analysis_options(&AnalysisOptionsPatch {
        slices: Some(25.0),
        pore_pressure_head: Some(head.into()),
        ..Default::default()
    })
    .unwrap();
    s
}

/// ∫u dx over the base between xa and xb.
fn pore_force(slices: &[Slice], xa: f64, xb: f64) -> f64 {
    slices
        .iter()
        .filter(|s| s.x_left >= xa - 1e-9 && s.x_right <= xb + 1e-9)
        .fold(0.0, |sum, s| sum + s.u * s.width)
}

#[test]
fn a_vertical_step_in_a_water_line_is_a_slice_edge_and_the_pore_pressure_is_exact() {
    for head in [
        PorePressureHead::Vertical,
        PorePressureHead::PhreaticCorrection,
    ] {
        let s = stepped_water(head);
        let sl = slices(&s, 8.0, 35.0, 20.0, 20.0, 0.0, Some(&BASE));
        assert!(sl.iter().any(|q| q.x_right == 21.0), "{head:?}");
        for q in sl
            .iter()
            .filter(|q| q.x_left >= 20.0 - 1e-9 && q.x_right <= 22.67 + 1e-9)
        {
            close(
                q.u,
                WATER_UNIT_WEIGHT * if q.x < 21.0 { 5.0 } else { 2.0 },
                9,
            );
        }
        // Mean over the probe slice 20–22.67: 30.6 kPa (was 19.6 with vertical
        // head and 8.66 with the phreatic correction).
        let mean = pore_force(&sl, 20.0, 22.67) / 2.67;
        close(
            mean,
            (WATER_UNIT_WEIGHT * (5.0 * 1.0 + 2.0 * 1.67)) / 2.67,
            9,
        );
        close(mean, 30.6, 1);
    }
}

#[test]
fn gets_no_cos2_correction_where_the_step_lies_inside_a_slice() {
    let line = Polyline {
        x: vec![0.0, 21.0, 21.0, 40.0],
        y: vec![-1.0, -1.0, -4.0, -4.0],
    };
    assert_eq!(head_factor(&line, -1.0, -4.0, 20.0, 22.67, false), 1.0);
    // A sloping line keeps it.
    let sloping = Polyline {
        x: vec![0.0, 20.0, 22.67, 40.0],
        y: vec![-1.0, -1.0, -4.0, -4.0],
    };
    close(
        head_factor(&sloping, -1.0, -4.0, 20.0, 22.67, false),
        (3.0f64 / 2.67).atan().cos().powi(2),
        12,
    );
    // The step on a slice edge is not inside the slice.
    close(
        head_factor(&line, -4.0, -5.0, 21.0, 23.0, false),
        (1.0f64 / 2.0).atan().cos().powi(2),
        12,
    );
}

#[test]
fn vertices_of_the_line_above_the_slip_surface_are_slice_edges_those_below_are_not() {
    let mut s = Slope::new();
    s.add_material(material("M", mc(5.0, 30.0, 19.0)));
    s.set_external_boundary(&BOUNDARY).unwrap();
    s.set_water_table(&WaterTableInput::Custom {
        coordinates: vec![[0.0, -1.0], [17.3, -2.0], [29.1, -9.0], [40.0, -9.0]],
        follow_boundary: Some(false),
    })
    .unwrap();
    s.update_analysis_options(&AnalysisOptionsPatch {
        slices: Some(25.0),
        ..Default::default()
    })
    .unwrap();
    let edges: Vec<f64> = slices(&s, 8.0, 35.0, 20.0, 20.0, 0.0, Some(&BASE))
        .iter()
        .map(|q| q.x_left)
        .collect();
    assert!(edges.contains(&17.3));
    assert!(!edges.contains(&29.1));
}

const LTR: [[f64; 2]; 4] = [[0.0, 10.0], [15.0, 10.0], [30.0, 0.0], [40.0, 0.0]];

/// Polyline running along y = y_run between x = 14 and 28.
fn along(y_run: f64) -> [[f64; 2]; 4] {
    [[5.0, 10.0], [14.0, y_run], [28.0, y_run], [35.0, 0.0]]
}

fn flat(slices: &[Slice]) -> Vec<&Slice> {
    slices
        .iter()
        .filter(|s| s.x_left >= 14.0 - 1e-9 && s.x_right <= 28.0 + 1e-9)
        .collect()
}

#[test]
fn base_on_a_layer_boundary_takes_the_weak_layer_below() {
    let d = layered(
        &LTR,
        -20.0,
        &[
            ("Upper", None, su(40.0, 19.0)),
            ("Weak", Some(-12.0), su(10.0, 19.0)),
        ],
        json!({}),
    );
    let (_, slope) = run_verification(d, "Bishop", json!({ "iterations": 200 }));
    let on_s = slices(&slope, 5.0, 35.0, 20.0, 30.0, 0.0, Some(&along(-12.0)));
    let below_s = slices(&slope, 5.0, 35.0, 20.0, 30.0, 0.0, Some(&along(-12.001)));
    let (on, below) = (flat(&on_s), flat(&below_s));
    let name = |q: &Slice| slope.material(q.base_material.unwrap()).name.clone();
    assert!(!on.is_empty());
    assert!(on.iter().all(|s| name(s) == "Weak"));
    assert!(below.iter().all(|s| name(s) == "Weak"));
    assert!(on.iter().all(|s| s.cohesion == 10.0));
}

#[test]
fn keeps_the_soil_above_on_impenetrable_and_high_strength_material() {
    for kind in ["impenetrable", "high-strength"] {
        let d = layered(
            &LTR,
            -20.0,
            &[
                ("Upper", None, su(40.0, 19.0)),
                (
                    "Rock",
                    Some(-12.0),
                    json!({ "kind": kind, "unitWeight": 22 }),
                ),
            ],
            json!({}),
        );
        let (_, slope) = run_verification(d, "Bishop", json!({ "iterations": 200 }));
        let on_s = slices(&slope, 5.0, 35.0, 20.0, 30.0, 0.0, Some(&along(-12.0)));
        let on = flat(&on_s);
        assert!(!on.is_empty(), "{kind}");
        assert!(
            on.iter()
                .all(|s| slope.material(s.base_material.unwrap()).name == "Upper"
                    && s.impenetrable != Some(true)
                    && s.skip_surface != Some(true)),
            "{kind}"
        );
    }
}

#[test]
fn fixed_slices_are_split_at_layer_and_water_crossings_like_the_regular_slices() {
    let d = layered(
        &[[0.0, 10.0], [15.0, 10.0], [30.0, 0.0], [40.0, 0.0]],
        -20.0,
        &[
            ("Upper", None, mc(5.0, 30.0, 19.0)),
            ("Lower", Some(0.0), mc(10.0, 25.0, 19.0)),
        ],
        json!({}),
    );
    let (_, mut slope) = run_verification(d, "Bishop", json!({ "iterations": 200 }));
    slope
        .set_water_table(&WaterTableInput::Custom {
            coordinates: vec![[0.0, 4.0], [40.0, 4.0]],
            follow_boundary: Some(false),
        })
        .unwrap();
    slope.add_fixed_slices(&[10.0, 20.0, 30.0]);
    let (cx, cy, r) = (22.0, 22.0, 24.0);
    let ints = slope.get_circle_external_intersection(cx, cy, r).unwrap();
    let (x0, x1) = (ints[0][0], ints[1][0]);
    let sl = slices(&slope, x0, x1, cx, cy, r, None);
    let mut edges: Vec<f64> = sl.iter().map(|s| s.x_left).collect();
    edges.push(sl[sl.len() - 1].x_right);
    for fx in [10.0, 20.0, 30.0] {
        assert!(edges.iter().any(|e| (e - fx).abs() < 1e-9), "{fx}");
    }
    // The circle crosses the layer boundary y = 0 and the water line y = 4.
    let crossings = |y: f64| {
        let d = (r * r - (cy - y) * (cy - y)).sqrt();
        [cx - d, cx + d]
    };
    let inside: Vec<f64> = crossings(0.0)
        .into_iter()
        .chain(crossings(4.0))
        .filter(|&x| x > x0 + 1e-3 && x < x1 - 1e-3)
        .collect();
    assert_eq!(inside.len(), 2);
    for xc in inside {
        assert!(edges.iter().any(|e| (e - xc).abs() < 1e-6), "{xc}");
    }
}
