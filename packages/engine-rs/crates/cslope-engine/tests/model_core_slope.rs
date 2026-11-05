//! Ported unit tests of model/slope.ts and model/build-slope.ts
//! (slope-api.test.ts, water-table.test.ts, build-slope.test.ts, the
//! buildSlope parts of canonical-build.test.ts, review-fixes.test.ts,
//! point-limits.test.ts and model-coordinates.test.ts).
//! (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::{get_domain_x, mirror_x, to_canonical_slope_definition};
use cslope_engine::model::search::add_single_circular_plane;
use cslope_engine::model::slope::{AnalysisLimitsPatch, AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::types::{
    LineLoad, LineLoadParams, Material, MaterialId, MaterialParams, Pile, PorePressureHead,
    Reinforcement, Udl, UdlParams, WaterTableInput, ITERATIONS_RANGE, REFINED_ITERATIONS_RANGE,
    SLICES_RANGE,
};
use model_core_support::{close, def};
use serde_json::{json, Value};

const BOUNDARY: [[f64; 2]; 6] = [
    [0.0, -10.0],
    [0.0, 10.0],
    [10.0, 10.0],
    [25.0, 0.0],
    [40.0, 0.0],
    [40.0, -10.0],
];

fn soil() -> Material {
    Material::new(MaterialParams {
        name: Some("S".into()),
        unit_weight: Some(19.0),
        cohesion: Some(10.0),
        friction_angle: Some(25.0),
        ..Default::default()
    })
    .unwrap()
}

fn model() -> Slope {
    let mut s = Slope::new();
    s.add_material(soil());
    s.set_external_boundary(&BOUNDARY).unwrap();
    s
}

fn opts(v: Value) -> AnalysisOptionsPatch {
    serde_json::from_value(v).unwrap()
}

fn err<T: std::fmt::Debug>(r: cslope_engine::error::Result<T>) -> String {
    r.unwrap_err().message
}

fn first_material(s: &Slope) -> MaterialId {
    s.material_geometries()[0].material
}

// ── Slope: geometry setup ─────────────────────────────────────────

#[test]
fn rejects_a_boundary_with_fewer_than_3_points_and_closes_an_open_one() {
    assert!(
        err(Slope::new().set_external_boundary(&[[0.0, 0.0], [1.0, 1.0]]))
            .contains("at least 3 points")
    );
    assert!(err(Slope::new().set_external_boundary(&[])).contains("at least 3"));
    let s = model();
    assert_eq!(s.material_geometries()[0].px.len(), BOUNDARY.len() + 1);
    // Already closed: not closed again.
    let mut t = Slope::new();
    let mut closed = BOUNDARY.to_vec();
    closed.push(BOUNDARY[0]);
    t.set_external_boundary(&closed).unwrap();
    assert_eq!(t.material_geometries()[0].px.len(), BOUNDARY.len() + 1);
}

#[test]
fn uses_a_placeholder_material_without_add_material_add_material_ignores_duplicates() {
    let mut s = Slope::new();
    s.set_external_boundary(&BOUNDARY).unwrap();
    let placeholder = s.material(first_material(&s));
    assert_eq!(placeholder.unit_weight(), 20.0);
    let mut m = soil();
    m.external_key = Some(7); // one JavaScript object, added twice
    let mut t = Slope::new();
    let a = t.add_material(m.clone());
    let b = t.add_material(m);
    assert_eq!(a, b);
    assert_eq!(t.materials().len(), 1);
    t.set_external_boundary(&BOUNDARY).unwrap();
    assert_eq!(first_material(&t), a);
}

#[test]
fn material_boundaries_need_the_external_boundary_and_two_points() {
    assert!(
        err(Slope::new().set_material_boundaries(&[vec![[0.0, 0.0], [1.0, 0.0]]]))
            .contains("External boundary must be set")
    );
    assert!(
        err(model().set_material_boundary(&[[0.0, 0.0]])).contains("at least 2 coordinate points")
    );
    assert!(err(model().set_material_boundary(&[])).contains("at least 2"));
}

#[test]
fn set_material_boundary_reports_whether_it_split_anything() {
    let mut s = model();
    assert!(s
        .set_material_boundary(&[[0.0, 2.0], [40.0, -2.0]])
        .unwrap());
    assert_eq!(s.material_geometries().len(), 2);
    // Entirely outside the model.
    assert!(!s
        .set_material_boundary(&[[0.0, 50.0], [40.0, 50.0]])
        .unwrap());
    assert!(!s.split_failed());
}

#[test]
fn assign_material_accepts_only_materials_a_point_outside_every_region_is_ignored() {
    let mut s = model();
    assert!(err(s.assign_material([1.0, 1.0], MaterialId(99)))
        .contains("instances of the Material class"));
    let other = s.insert_material(
        Material::new(MaterialParams {
            name: Some("O".into()),
            unit_weight: Some(18.0),
            cohesion: Some(1.0),
            friction_angle: Some(30.0),
            ..Default::default()
        })
        .unwrap(),
    );
    s.assign_material([100.0, 100.0], other).unwrap();
    assert_eq!(s.material(first_material(&s)).name, "S");
    s.assign_material([1.0, 1.0], other).unwrap();
    assert_eq!(first_material(&s), other);
}

#[test]
fn model_area_height_and_ground_relief_minimum_slip_area_defaults_to_no_limit() {
    let empty = Slope::new();
    assert_eq!(empty.model_area(), 0.0);
    assert_eq!(empty.model_height(), 0.0);
    assert_eq!(empty.ground_relief(), 0.0);
    assert!(empty.surface_line_xy().is_none());
    let mut s = model();
    // 40 × 10 below y = 0 plus the slope above it.
    close(s.model_area(), 400.0 + 10.0 * 10.0 + 0.5 * 15.0 * 10.0, 9);
    assert_eq!(s.model_height(), 20.0);
    assert_eq!(s.ground_relief(), 10.0);
    assert_eq!(s.min_slip_area(), 0.0);
    s.update_analysis_options(&opts(json!({ "minSlipArea": 3 })))
        .unwrap();
    assert_eq!(s.min_slip_area(), 3.0);
    // null (older projects: automatic) is no limit
    s.update_analysis_options(&opts(json!({ "minSlipArea": null })))
        .unwrap();
    assert_eq!(s.min_slip_area(), 0.0);
}

#[test]
fn queries_need_the_geometry() {
    let s = Slope::new();
    assert!(err(s.get_external_y_intersection(1.0))
        .contains("Surface line coordinates are not defined"));
    assert!(err(s.get_circle_external_intersection(0.0, 0.0, 1.0))
        .contains("Surface line is not defined"));
    assert!(err(Slope::new().remove_analysis_limits()).contains("Surface line is not defined"));
    assert!(
        err(s.get_water_y_intersection(1.0)).contains("Water table coordinates are not defined")
    );
    assert!(!s.is_inside_external_boundary(0.0, 0.0));
    assert_eq!(s.to_string(), "Slope");
}

#[test]
fn surface_and_water_elevations_inside_test() {
    let mut s = model();
    close(s.get_external_y_intersection(17.5).unwrap(), 5.0, 12);
    assert!(s.is_inside_external_boundary(20.0, 0.0));
    assert!(!s.is_inside_external_boundary(20.0, 9.0));
    s.set_water_table(&WaterTableInput::Height {
        height: 2.0,
        follow_boundary: Some(false),
    })
    .unwrap();
    assert_eq!(s.get_water_y_intersection(30.0).unwrap(), 2.0);
}

#[test]
fn a_circle_through_a_surface_vertex_is_found_once() {
    let s = model();
    // Through (10, 10) and (25, 0), centre on their bisector.
    let xs: Vec<String> = s
        .get_circle_external_intersection(10.0, 0.0, 10.0)
        .unwrap()
        .iter()
        .map(|p| cslope_engine::js::num::to_fixed(p[0], 9))
        .collect();
    let mut unique = xs.clone();
    unique.dedup();
    assert_eq!(unique.len(), xs.len());
}

// ── Slope: water tables ───────────────────────────────────────────

fn custom(coordinates: &[[f64; 2]], follow: Option<bool>) -> WaterTableInput {
    WaterTableInput::Custom {
        coordinates: coordinates.to_vec(),
        follow_boundary: follow,
    }
}

#[test]
fn depth_and_height_need_the_external_boundary() {
    let depth = WaterTableInput::Depth {
        depth: 2.0,
        follow_boundary: None,
    };
    let height = WaterTableInput::Height {
        height: 2.0,
        follow_boundary: None,
    };
    assert!(err(Slope::new().set_water_table(&depth)).contains("before using depth"));
    assert!(err(Slope::new().set_water_table(&height)).contains("before setting water table"));
}

#[test]
fn depth_is_measured_below_the_highest_point_of_the_boundary() {
    let mut s = model();
    s.set_water_table(&WaterTableInput::Depth {
        depth: 4.0,
        follow_boundary: Some(false),
    })
    .unwrap();
    assert_eq!(s.water_rl_xy().unwrap().y, vec![6.0, 6.0]);
    assert!(s.has_water_table());
}

#[test]
fn rejects_non_finite_points_and_lines_with_fewer_than_two_points() {
    let mut s = model();
    assert!(
        err(s.set_water_table(&custom(&[[0.0, 1.0], [f64::NAN, 2.0]], None)))
            .contains("finite numbers")
    );
    assert!(err(s.set_water_table(&custom(&[[0.0, 1.0]], None))).contains("two points"));
    assert!(err(s.set_water_table_by_id("w", &[[5.0, 1.0]], true)).contains("two points"));
}

#[test]
fn accepts_two_points_at_one_x_as_a_vertical_step_extended_to_both_edges() {
    let mut s = model();
    s.set_water_table(&custom(&[[5.0, 1.0], [5.0, 2.0]], Some(false)))
        .unwrap();
    assert!(s.has_water_table());
    assert_eq!(s.water_rl_xy().unwrap().x[0], BOUNDARY[0][0]);
    s.set_water_table_by_id("w", &[[5.0, 1.0], [5.0, 3.0]], false)
        .unwrap();
}

#[test]
fn a_line_given_before_the_boundary_is_extended_to_its_edges_once_the_boundary_is_set() {
    let mut s = Slope::new();
    s.add_material(soil());
    s.set_water_table(&custom(&[[10.0, 1.0], [20.0, 0.0]], Some(false)))
        .unwrap();
    s.set_water_table_by_id("p", &[[10.0, -2.0], [30.0, -3.0]], false)
        .unwrap();
    s.set_external_boundary(&BOUNDARY).unwrap();
    let w = s.water_rl_xy().unwrap();
    assert_eq!(w.x[0], 0.0);
    assert_eq!(w.x[w.x.len() - 1], 40.0);
    let m = first_material(&s);
    s.assign_material_water_table(m, "p");
    assert!(s.has_material_water_tables());
    assert_eq!(s.get_water_line_for_material(Some(m)).unwrap().y[0], -2.0);
    assert_eq!(s.all_water_lines().len(), 2);
    // Unknown id: the default line.
    let other = s.insert_material(soil());
    s.assign_material_water_table(other, "missing");
    assert_eq!(s.get_water_line_for_material(Some(other)), s.water_rl_xy());
    assert_eq!(s.get_water_line_for_material(None), s.water_rl_xy());
}

#[test]
fn a_line_entered_right_to_left_is_reversed_remove_water_table_clears_every_line() {
    let mut s = model();
    s.set_water_table(&custom(&[[40.0, -1.0], [0.0, 3.0]], Some(false)))
        .unwrap();
    assert_eq!(s.water_rl_xy().unwrap().x, vec![0.0, 40.0]);
    assert_eq!(s.water_rl_xy().unwrap().y, vec![3.0, -1.0]);
    s.set_water_table_by_id("p", &[[0.0, 0.0], [40.0, 0.0]], true)
        .unwrap();
    s.assign_material_water_table(first_material(&s), "p");
    s.remove_water_table();
    assert!(!s.has_water_table());
    assert!(!s.has_material_water_tables());
    assert!(s.all_water_lines().is_empty());
    assert!(s
        .get_water_line_for_material(Some(first_material(&s)))
        .is_none());
}

#[test]
fn with_follow_boundary_the_line_never_rises_above_the_ground() {
    let mut s = model();
    s.set_water_table(&WaterTableInput::Height {
        height: 8.0,
        follow_boundary: None,
    })
    .unwrap();
    for x in [5.0, 15.0, 20.0, 30.0] {
        assert!(
            s.get_water_y_intersection(x).unwrap()
                <= s.get_external_y_intersection(x).unwrap() + 1e-9
        );
    }
}

// water-table.test.ts: Slope.setWaterTable with followBoundary
const WT_BOUNDARY: [[f64; 2]; 6] = [
    [0.0, -15.0],
    [0.0, 0.0],
    [20.0, 0.0],
    [40.0, -10.0],
    [50.0, -10.0],
    [50.0, -15.0],
];

fn wt_slope() -> Slope {
    let mut s = Slope::new();
    s.add_material(
        Material::new(MaterialParams {
            name: Some("M".into()),
            ..Default::default()
        })
        .unwrap(),
    );
    s.set_external_boundary(&WT_BOUNDARY).unwrap();
    s
}

#[test]
fn water_table_follow_boundary_cases() {
    let height = |h: f64| WaterTableInput::Height {
        height: h,
        follow_boundary: None,
    };
    // horizontal level below the crest follows the ground only where the ground is lower
    let mut s = wt_slope();
    s.set_water_table(&height(-5.0)).unwrap();
    assert_eq!(
        s.water_rl_xy().unwrap().x,
        vec![0.0, 20.0, 30.0, 40.0, 50.0]
    );
    assert_eq!(
        s.water_rl_xy().unwrap().y,
        vec![-5.0, -5.0, -5.0, -10.0, -10.0]
    );
    // level below the whole ground surface stays horizontal
    let mut s = wt_slope();
    s.set_water_table(&height(-12.0)).unwrap();
    assert!(s.water_rl_xy().unwrap().y.iter().all(|&y| y == -12.0));
    // level above the whole ground surface follows the ground surface
    let mut s = wt_slope();
    s.set_water_table(&height(5.0)).unwrap();
    assert!(s.has_water_table());
    assert_eq!(s.water_rl_xy().unwrap().y, vec![0.0, 0.0, -10.0, -10.0]);
    // custom line is clipped to the ground surface by default
    let mut s = wt_slope();
    s.set_water_table(&custom(&[[0.0, -3.0], [50.0, -3.0]], None))
        .unwrap();
    assert_eq!(
        s.water_rl_xy().unwrap().x,
        vec![0.0, 20.0, 26.0, 40.0, 50.0]
    );
    assert_eq!(
        s.water_rl_xy().unwrap().y,
        vec![-3.0, -3.0, -3.0, -10.0, -10.0]
    );
    // custom line is used as-is when followBoundary is false
    let mut s = wt_slope();
    s.set_water_table(&custom(&[[0.0, -3.0], [50.0, -3.0]], Some(false)))
        .unwrap();
    assert_eq!(s.water_rl_xy().unwrap().x, vec![0.0, 50.0]);
    assert_eq!(s.water_rl_xy().unwrap().y, vec![-3.0, -3.0]);
}

// ── Slope: loads ──────────────────────────────────────────────────

#[test]
fn drops_zero_loads_udls_add_up_line_loads_replace() {
    let mut s = model();
    let udl = |m: f64, x1: f64, x2: f64| {
        Udl::new(UdlParams {
            magnitude: m,
            x1,
            x2,
            ..Default::default()
        })
    };
    let ll = |m: f64, x: f64| {
        LineLoad::new(LineLoadParams {
            magnitude: m,
            x,
            ..Default::default()
        })
    };
    s.set_udls(vec![udl(10.0, 0.0, 5.0), udl(0.0, 0.0, 5.0)]);
    s.set_udls(vec![udl(5.0, 5.0, 8.0)]);
    assert_eq!(s.udls().len(), 2);
    s.remove_udls();
    assert_eq!(s.udls().len(), 0);
    s.set_line_loads(vec![ll(10.0, 3.0), ll(0.0, 4.0)]);
    s.set_line_loads(vec![ll(20.0, 5.0)]);
    assert_eq!(s.line_loads().len(), 1);
    s.remove_line_loads();
    assert_eq!(s.line_loads().len(), 0);
}

// ── Slope: reinforcement and pile validation ──────────────────────

fn nail(change: Value) -> Reinforcement {
    let mut v = json!({ "x1": 20, "y1": 4, "x2": 10, "y2": 1, "tensileCapacity": 100 });
    for (k, x) in change.as_object().unwrap() {
        v[k] = x.clone();
    }
    serde_json::from_value(v).unwrap()
}

#[test]
fn reinforcement_rejects_invalid_input() {
    let cases: [(&str, Value, &str); 12] = [
        (
            "non-finite end",
            json!({ "x2": "NaN" }),
            "finite end points",
        ),
        (
            "non-finite capacity",
            json!({ "tensileCapacity": "Infinity" }),
            "finite end points",
        ),
        (
            "negative capacity",
            json!({ "tensileCapacity": -1 }),
            "capacities must be ≥ 0",
        ),
        (
            "negative end capacity",
            json!({ "end1Capacity": -1 }),
            "capacities must be ≥ 0",
        ),
        (
            "NaN end capacity",
            json!({ "end2Capacity": "NaN" }),
            "capacities must be ≥ 0",
        ),
        (
            "zero spacing",
            json!({ "spacing": 0 }),
            "spacing must be > 0",
        ),
        (
            "bond strength < 0",
            json!({ "pullout": { "kind": "bond", "strength": -1 } }),
            "bond strength",
        ),
        (
            "bonded length < 0",
            json!({ "pullout": { "kind": "bond", "strength": 10, "bondedLength": -1 } }),
            "bond strength",
        ),
        (
            "development length < 0",
            json!({ "pullout": { "kind": "development", "length1": 1, "length2": -1 } }),
            "development lengths",
        ),
        (
            "adhesion < 0",
            json!({ "pullout": { "kind": "interface", "adhesion": -1, "frictionAngle": 20 } }),
            "adhesion",
        ),
        (
            "interface φ = 90",
            json!({ "pullout": { "kind": "interface", "adhesion": 0, "frictionAngle": 90 } }),
            "adhesion",
        ),
        (
            "coverage 0",
            json!({ "pullout": { "kind": "interface", "adhesion": 0, "frictionAngle": 20, "coverage": 0 } }),
            "adhesion",
        ),
    ];
    for (label, change, msg) in cases {
        let e = err(model().set_reinforcements(&[nail(change)]));
        assert!(e.contains(msg), "{label}: {e}");
    }
    // "development length missing": the length reads as NaN (TypeScript's
    // undefined), which the validation rejects with TypeScript's message
    let missing = json!({ "x1": 20, "y1": 4, "x2": 10, "y2": 1, "tensileCapacity": 100, "pullout": { "kind": "development", "length1": 1 } });
    let r: Reinforcement = serde_json::from_value(missing).expect("reads");
    let e = err(model().set_reinforcements(&[r]));
    assert!(e.contains("development lengths"), "{e}");
}

#[test]
fn reinforcement_accepts_the_boundary_values_and_keeps_zero_capacity_elements() {
    let mut s = model();
    s.set_reinforcements(&[
        nail(json!({ "tensileCapacity": 0, "end1Capacity": 0, "end2Capacity": 0, "spacing": 1e-6 })),
        nail(json!({ "pullout": { "kind": "bond", "strength": 0, "bondedLength": 0 } })),
        nail(json!({ "pullout": { "kind": "development", "length1": 0, "length2": 0 } })),
        nail(json!({ "pullout": { "kind": "interface", "adhesion": 0, "frictionAngle": 0, "coverage": 1e-6 } })),
    ])
    .unwrap();
    assert_eq!(s.reinforcements().len(), 4);
    assert_eq!(s.reinforcement_envelopes().len(), 4);
}

fn pile(change: Value) -> Pile {
    let mut v = json!({ "x1": 20, "y1": 4, "x2": 20, "y2": -8, "force": 50 });
    for (k, x) in change.as_object().unwrap() {
        if x.is_null() {
            v.as_object_mut().unwrap().remove(k);
        } else {
            v[k] = x.clone();
        }
    }
    serde_json::from_value(v).unwrap()
}

#[test]
fn pile_rejects_invalid_input() {
    let cases: [(&str, Value, &str); 12] = [
        (
            "non-finite tip",
            json!({ "y2": "NaN" }),
            "finite head and tip",
        ),
        (
            "negative force",
            json!({ "force": -1 }),
            "≥ 0, spacing and diameter > 0",
        ),
        (
            "negative shear capacity",
            json!({ "shearCapacity": -1 }),
            "≥ 0",
        ),
        (
            "NaN moment capacity",
            json!({ "momentCapacity": "NaN" }),
            "≥ 0",
        ),
        (
            "zero spacing",
            json!({ "spacing": 0 }),
            "spacing and diameter > 0",
        ),
        (
            "zero diameter",
            json!({ "diameter": 0 }),
            "spacing and diameter > 0",
        ),
        ("angle 90", json!({ "angle": 90 }), "between −90° and 90°"),
        (
            "angle NaN",
            json!({ "angle": "NaN" }),
            "between −90° and 90°",
        ),
        (
            "no force and no diameter",
            json!({ "force": null }),
            "shear force, or a diameter",
        ),
        (
            "Ito & Matsui inclined",
            json!({ "force": null, "diameter": 0.5, "spacing": 2, "x2": 21 }),
            "vertical pile",
        ),
        (
            "Ito & Matsui no gap",
            json!({ "force": null, "diameter": 1, "spacing": 1 }),
            "spacing larger than the pile diameter",
        ),
        (
            "Ito & Matsui default spacing",
            json!({ "force": null, "diameter": 1 }),
            "spacing larger",
        ),
    ];
    for (label, change, msg) in cases {
        let e = err(model().set_piles(&[pile(change)]));
        assert!(e.contains(msg), "{label}: {e}");
    }
    // an unknown direction (kept as `Other` on deserialization)
    let e = err(model().set_piles(&[pile(json!({ "direction": "down" }))]));
    assert!(e.contains("'angle', 'tangent' or 'perpendicular'"), "{e}");
}

#[test]
fn pile_accepts_the_boundary_values() {
    let mut s = model();
    s.set_piles(&[
        pile(json!({ "force": 0, "shearCapacity": 0, "momentCapacity": 0, "angle": -89.9 })),
        pile(json!({ "force": null, "diameter": 0.5, "spacing": 0.5001 })),
        pile(json!({ "direction": "tangent" })),
        pile(json!({ "direction": "perpendicular", "x2": 21 })),
    ])
    .unwrap();
    assert_eq!(s.piles().len(), 4);
    assert!(s.pile_profiles().unwrap()[0].is_none());
    assert!(s.pile_profiles().unwrap()[1].is_some());
}

// ── Slope: analysis options ───────────────────────────────────────

#[test]
fn rejects_invalid_options() {
    let invalid: [(&str, Value, &str); 10] = [
        (
            "crack depth < 0",
            json!({ "tensionCrackDepth": -1 }),
            "tensionCrackDepth",
        ),
        (
            "crack depth NaN",
            json!({ "tensionCrackDepth": "NaN" }),
            "tensionCrackDepth",
        ),
        (
            "crack water > 1",
            json!({ "tensionCrackWater": 1.01 }),
            "between 0 and 1",
        ),
        (
            "crack water < 0",
            json!({ "tensionCrackWater": -0.01 }),
            "between 0 and 1",
        ),
        (
            "crack water NaN",
            json!({ "tensionCrackWater": "NaN" }),
            "between 0 and 1",
        ),
        (
            "min slip depth < 0",
            json!({ "minSlipDepth": -1 }),
            "minSlipDepth",
        ),
        (
            "min slip depth Infinity",
            json!({ "minSlipDepth": "Infinity" }),
            "minSlipDepth",
        ),
        (
            "min slip area < 0",
            json!({ "minSlipArea": -1 }),
            "minSlipArea",
        ),
        (
            "partial factor 0",
            json!({ "partialFactors": { "cu": 1, "cohesion": 1, "tanPhi": 0, "variableLoad": 1 } }),
            "Partial factors",
        ),
        (
            "partial factor NaN",
            json!({ "partialFactors": { "cu": "NaN", "cohesion": 1, "tanPhi": 1, "variableLoad": 1 } }),
            "Partial factors",
        ),
    ];
    for (label, o, msg) in invalid {
        let e = err(model().update_analysis_options(&opts(o)));
        assert!(e.contains(msg), "{label}: {e}");
    }
    let e = err(model().update_analysis_options(&AnalysisOptionsPatch {
        min_slip_area: Some(Some(f64::NAN)),
        ..Default::default()
    }));
    assert!(e.contains("minSlipArea"), "min slip area NaN: {e}");
    // An unknown method, pore pressure head, search method or interslice
    // function: TypeScript's messages (the value is kept for the check)
    for (o, msg) in [
        (json!({ "method": "Spencer" }), "Method must be one of"),
        (json!({ "method": null }), "Method must be one of"),
        (
            json!({ "porePressureHead": "hydrostatic" }),
            "porePressureHead must be",
        ),
        (json!({ "searchMethod": 5 }), "searchMethod must be"),
        (
            json!({ "intersliceFunction": "cubic" }),
            "intersliceFunction must be one of",
        ),
    ] {
        let e = err(model().update_analysis_options(&opts(o.clone())));
        assert!(e.contains(msg), "{o}: {e}");
    }
}

#[test]
fn accepts_the_boundary_values() {
    let mut s = model();
    s.update_analysis_options(&opts(json!({
        "tensionCrackDepth": 0, "tensionCrackWater": 1, "minSlipDepth": 0, "minSlipArea": 0,
        "porePressureHead": "phreatic-correction",
        "partialFactors": { "cu": 1e-9, "cohesion": 1, "tanPhi": 1, "variableLoad": 1 },
        "tensionCrackAuto": true, "janbuCorrection": true, "nonCircularOptimization": true,
    })))
    .unwrap();
    assert_eq!(s.tension_crack_water(), 1.0);
    assert_eq!(s.pore_pressure_head(), PorePressureHead::PhreaticCorrection);
    assert_eq!(s.partial_factors().unwrap().cu, 1e-9);
    assert!(s.tension_crack_auto());
    assert!(s.janbu_correction());
    assert!(s.non_circular_optimization());
    s.update_analysis_options(&opts(json!({ "partialFactors": null })))
        .unwrap();
    assert!(s.partial_factors().is_none());
}

#[test]
fn clamps_slices_iterations_and_the_inner_iteration_limit() {
    let mut s = model();
    s.update_analysis_options(&opts(
        json!({ "slices": 1, "iterations": 1, "refinedIterations": -5, "maxIterations": 1 }),
    ))
    .unwrap();
    assert_eq!(s.slice_count(), SLICES_RANGE.min);
    assert_eq!(s.iterations(), ITERATIONS_RANGE.min);
    assert_eq!(s.refined_iterations(), REFINED_ITERATIONS_RANGE.min);
    assert_eq!(s.max_iterations(), 6.0);
    s.update_analysis_options(&opts(
        json!({ "slices": 1e9, "iterations": 1e12, "refinedIterations": 1e12 }),
    ))
    .unwrap();
    assert_eq!(s.slice_count(), SLICES_RANGE.max);
    assert_eq!(s.iterations(), ITERATIONS_RANGE.max);
    assert_eq!(s.refined_iterations(), REFINED_ITERATIONS_RANGE.max);
    // The minimum failure distance is at most 90 % of the model length.
    s.update_analysis_options(&opts(json!({ "minFailureDist": 1000 })))
        .unwrap();
    close(s.min_failure_distance(), 36.0, 12);
}

#[test]
fn keeps_only_finite_interslice_data_points_mirrored_models_mirror_them() {
    let mut s = model();
    s.update_analysis_options(&AnalysisOptionsPatch {
        interslice_function: Some(
            cslope_engine::types::IntersliceFunctionType::DataPointSpecified.into(),
        ),
        interslice_data_points: Some(
            vec![
                [0.0, 0.2],
                [f64::NAN, 1.0],
                [0.3, f64::INFINITY],
                [0.6, 1.0],
            ]
            .into(),
        ),
        ..Default::default()
    })
    .unwrap();
    assert_eq!(s.interslice_data_points(), vec![[0.0, 0.2], [0.6, 1.0]]);
    assert!(!s.mirrored());
    s.set_mirrored(true);
    assert!(s.mirrored());
    let mirrored = s.interslice_data_points();
    close(mirrored[0][0], 0.4, 12);
    assert_eq!(mirrored[0][1], 1.0);
    assert_eq!(mirrored[1], [1.0, 0.2]);
}

// ── Slope: analysis limits and results ────────────────────────────

fn limits(v: Value) -> AnalysisLimitsPatch {
    serde_json::from_value(v).unwrap()
}

#[test]
fn one_bound_of_a_pair_sets_both_bounds_are_put_in_order() {
    let mut s = model();
    s.set_analysis_limits(&limits(json!({ "entryLeftX": 5, "exitLeftX": 30 })));
    assert_eq!(s.limits(), [5.0, 5.0, 30.0, 30.0]);
    s.set_analysis_limits(&limits(
        json!({ "entryLeftX": 8, "entryRightX": 2, "exitLeftX": 39, "exitRightX": 26 }),
    ));
    assert_eq!(s.limits(), [2.0, 8.0, 26.0, 39.0]);
    // Only a right bound: the left one is kept.
    s.set_analysis_limits(&limits(json!({ "entryRightX": 9 })));
    assert_eq!(s.limits(), [2.0, 9.0, 26.0, 39.0]);
    s.remove_analysis_limits().unwrap();
    assert_eq!(s.limits(), [0.0, 40.0, 0.0, 40.0]);
}

/// The part of "result queries throw before an analysis and answer after it"
/// without the analysis (deferred: analyseSlope); results are set directly.
#[test]
fn result_queries_throw_before_an_analysis_and_answer_after_it() {
    let mut s = model();
    assert!(err(s.get_min_fos()).contains("No analysis results"));
    assert!(err(s.get_max_fos()).contains("No analysis results"));
    assert!(err(s.get_min_fos_circle()).contains("No analysis results"));
    assert!(err(s.get_min_fos_end_points()).contains("No analysis results"));
    add_single_circular_plane(&mut s, 20.0, 20.0, 18.0).unwrap();
    add_single_circular_plane(&mut s, 22.0, 16.0, 17.0).unwrap();
    s.set_custom_planes_only(true);
    assert!(s.custom_planes_only());
    let planes: Vec<SearchPlane> = s
        .individual_planes()
        .iter()
        .zip([1.3, 1.6])
        .map(|(p, f)| SearchPlane {
            fos: Some(f),
            ..p.clone()
        })
        .chain([SearchPlane::default()])
        .collect();
    s.set_search_results(planes);
    assert_eq!(s.get_min_fos().unwrap(), 1.3);
    assert_eq!(s.get_max_fos().unwrap(), 1.6);
    assert!(s.get_min_fos_circle().unwrap().2 > 0.0);
    let (entry, exit) = s.get_min_fos_end_points().unwrap();
    assert!(entry[0] < exit[0]);
    // Changing the model drops the results.
    s.materials_changed();
    assert!(err(s.get_min_fos()).contains("No analysis results"));
    s.remove_individual_planes();
    assert!(s.individual_planes().is_empty());
}

#[test]
fn fixed_slice_boundaries() {
    let mut s = model();
    s.add_fixed_slices(&[12.0, 15.0, 18.0]);
    assert_eq!(s.fixed_slices(), Some(&[12.0, 15.0, 18.0][..]));
}

// ── build-slope.test.ts ───────────────────────────────────────────

fn coords() -> Value {
    json!([[0, -15], [0, 0], [20, 0], [40, -10], [50, -10], [50, -15]])
}

fn materials() -> Value {
    json!([
        { "name": "A", "unitWeight": 18, "frictionAngle": 30, "cohesion": 1 },
        { "name": "B", "unitWeight": 19, "frictionAngle": 20, "cohesion": 9 },
    ])
}

#[test]
fn build_slope_region_assignments() {
    // applies an assignment when there are no interior boundaries
    let s = build_slope(&def(json!({ "coordinates": coords(), "materials": materials(), "regionAssignments": [{ "point": [10, -5], "materialName": "B" }] }))).unwrap();
    assert_eq!(s.material_geometries().len(), 1);
    assert_eq!(s.material(first_material(&s)).name, "B");
    // lets the first assignment win when two fall in the same region
    let s = build_slope(&def(json!({
        "coordinates": coords(), "materials": materials(),
        "regionAssignments": [{ "point": [10, -5], "materialName": "B" }, { "point": [5, -10], "materialName": "A" }],
    })))
    .unwrap();
    assert_eq!(s.material(first_material(&s)).name, "B");
}

#[test]
fn build_slope_rejects_a_part_carried_by_excess_pore_pressure_outside_0_to_1() {
    let d = |ratio: Value| {
        def(json!({
            "coordinates": coords(),
            "materials": [{ "name": "A", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30 } }],
            "udls": [{ "magnitude": 10, "x1": 0, "x2": 10, "excessPorePressure": [{ "material": "A", "ratio": ratio }] }],
        }))
    };
    for r in [json!(1.2), json!(-0.1), json!("NaN")] {
        assert!(err(build_slope(&d(r))).contains("between 0 and 1"));
    }
    assert!(build_slope(&d(json!(1))).is_ok());
}

// ── canonical-build.test.ts: buildSlope ───────────────────────────

const LTR: [[f64; 2]; 6] = BOUNDARY;

fn soil_def() -> Value {
    json!({ "name": "S", "unitWeight": 19, "cohesion": 10, "frictionAngle": 25 })
}

#[test]
fn build_slope_needs_at_least_one_material_and_rejects_an_invalid_one() {
    assert!(err(build_slope(&def(
        json!({ "coordinates": LTR, "materials": [] })
    )))
    .contains("at least one material"));
    let mut bad = soil_def();
    bad["cohesion"] = json!(-1);
    assert!(err(build_slope(&def(
        json!({ "coordinates": LTR, "materials": [bad] })
    )))
    .contains("Material \"S\" has invalid model"));
}

#[test]
fn build_slope_legacy_boundary_assignment() {
    let mut clay = soil_def();
    clay["name"] = json!("Clay");
    let mut top = soil_def();
    top["name"] = json!("Top");
    let d = json!({
        "coordinates": LTR,
        "materials": [soil_def(), clay, top],
        "materialBoundaries": [{ "coordinates": [[0, 2], [20, -1], [40, -3]], "materialName": "Clay" }],
        "topRegionMaterialName": "Top",
    });
    let names = |s: &Slope| {
        let mut v: Vec<String> = s
            .material_geometries()
            .iter()
            .map(|g| s.material(g.material).name.clone())
            .collect();
        v.sort();
        v
    };
    assert_eq!(
        names(&build_slope(&def(d.clone())).unwrap()),
        ["Clay", "Top"]
    );
    // Boundaries with a single point are ignored.
    let mut t = d.clone();
    t["materialBoundaries"]
        .as_array_mut()
        .unwrap()
        .push(json!({ "coordinates": [[5, 5]], "materialName": "S" }));
    t.as_object_mut().unwrap().remove("topRegionMaterialName");
    assert_eq!(names(&build_slope(&def(t)).unwrap()), ["Clay", "S"]);
}

#[test]
fn build_slope_water_tables_in_every_mode_loads_reinforcement_piles_and_limits() {
    let mut m = soil_def();
    m["waterTableId"] = json!("p");
    let base = json!({ "coordinates": LTR, "materials": [m] });
    let with = |k: &str, v: Value| {
        let mut d = base.clone();
        d[k] = v;
        build_slope(&def(d)).unwrap()
    };
    assert_eq!(
        with("waterTable", json!({ "mode": "height", "value": 2 }))
            .water_rl_xy()
            .unwrap()
            .y[0],
        2.0
    );
    assert_eq!(
        with(
            "waterTable",
            json!({ "mode": "depth", "value": 3, "followBoundary": false })
        )
        .water_rl_xy()
        .unwrap()
        .y[0],
        7.0
    );
    assert!(with(
        "waterTable",
        json!({ "mode": "custom", "value": [[0, 1], [40, -1]] })
    )
    .water_rl_xy()
    .is_some());
    // A mode that does not fit its value is ignored.
    assert!(!with("waterTable", json!({ "mode": "height", "value": [[0, 1]] })).has_water_table());
    let mut d = base.clone();
    for (k, v) in [
        (
            "waterTables",
            json!([{ "id": "p", "coordinates": [[0, -1], [40, -2]] }]),
        ),
        ("udls", json!([{ "magnitude": 10, "x1": 1, "x2": 5 }])),
        ("lineLoads", json!([{ "magnitude": 20, "x": 3 }])),
        (
            "reinforcements",
            json!([{ "x1": 20, "y1": 4, "x2": 10, "y2": 1, "tensileCapacity": 100 }]),
        ),
        (
            "piles",
            json!([{ "x1": 20, "y1": 4, "x2": 20, "y2": -8, "force": 50 }]),
        ),
        (
            "analysisLimits",
            json!({ "entryLeftX": 2, "entryRightX": 8, "exitLeftX": 28, "exitRightX": 36 }),
        ),
    ] {
        d[k] = v;
    }
    let s = build_slope(&def(d)).unwrap();
    assert!(s.has_material_water_tables());
    assert_eq!(s.udls().len(), 1);
    assert_eq!(s.line_loads().len(), 1);
    assert_eq!(s.reinforcements().len(), 1);
    assert_eq!(s.piles().len(), 1);
    assert_eq!(s.limits(), [2.0, 8.0, 28.0, 36.0]);
}

#[test]
fn build_slope_rejects_an_invalid_custom_circle_drops_custom_polylines_that_give_no_surface() {
    for p in [
        json!({ "cx": 1, "cy": 2, "radius": 0 }),
        json!({ "cx": "NaN", "cy": 2, "radius": 5 }),
        json!({ "cx": 1, "cy": "Infinity", "radius": 5 }),
    ] {
        let e = err(build_slope(&def(
            json!({ "coordinates": LTR, "materials": [soil_def()], "customSearchPlanes": [p] }),
        )));
        assert!(e.contains("finite center and a positive radius"), "{e}");
    }
    let s = build_slope(&def(json!({
        "coordinates": LTR, "materials": [soil_def()],
        "customSurfaces": [
            { "points": [[0, 20], [40, 20]] },
            { "points": [[5, 10], [15, 6], [20, -2], [33, 0]] },
            { "points": [[5, 10], [18, -2], [33, 0]], "axis": [20, 25] },
        ],
        "customPlanesOnly": true,
    })))
    .unwrap();
    assert_eq!(s.individual_planes().len(), 2);
    let p = &s.individual_planes()[1];
    assert_eq!((p.cx, p.cy, p.radius), (20.0, 25.0, 0.0));
    assert!(s.custom_planes_only());
}

// ── review-fixes.test.ts: water tables that do not span the slip surface ──

fn spanning_def() -> Value {
    json!({
        "coordinates": [[0, -20], [0, 0], [20, 0], [40, -10], [60, -10], [60, -20]],
        "materials": [
            { "name": "Upper", "unitWeight": 18, "frictionAngle": 28, "cohesion": 5, "waterTableId": "own" },
            { "name": "Lower", "unitWeight": 20, "frictionAngle": 32, "cohesion": 2 },
        ],
        "materialBoundaries": [{ "coordinates": [[0, -6], [60, -6]], "materialName": "" }],
        "regionAssignments": [{ "point": [5, -2], "materialName": "Upper" }, { "point": [5, -15], "materialName": "Lower" }],
        "waterTable": { "mode": "custom", "value": [[0, -4], [60, -4]] },
        "waterTables": [{ "id": "own", "coordinates": [[0, -3], [60, -3]] }],
    })
}

#[test]
fn rejects_a_material_water_table_that_cannot_span_anything() {
    let mut d = spanning_def();
    d["waterTables"] = json!([{ "id": "own", "coordinates": [[10, -3]] }]);
    assert!(err(build_slope(&def(d)))
        .to_lowercase()
        .contains("water table"));
    assert!(build_slope(&def(spanning_def())).is_ok());
}

#[test]
fn accepts_two_points_at_one_x_as_a_vertical_step_extended_both_ways() {
    let mut d = spanning_def();
    d["waterTable"] = json!({ "mode": "custom", "value": [[30, -5], [30, -2]] });
    let s = build_slope(&def(d)).unwrap();
    let w = s.water_rl_xy().unwrap();
    assert_eq!(w.x[0], 0.0);
    assert_eq!(w.x[w.x.len() - 1], 60.0);
    assert!(s.has_water_table());
}

#[test]
fn a_water_line_that_cannot_be_built_leaves_no_input_behind() {
    let mut s = Slope::new();
    s.add_material(soil());
    // Following the boundary before there is one fails...
    assert!(s
        .set_water_table(&custom(&[[0.0, 5.0], [10.0, 5.0]], Some(true)))
        .is_err());
    // ...and must not come back to life when the boundary is set later.
    s.set_external_boundary(&[[0.0, 0.0], [0.0, 10.0], [60.0, 10.0], [60.0, 0.0]])
        .unwrap();
    assert!(!s.has_water_table());
}

/// The geometry part of "extends a line given before the external boundary
/// to the model edges" (the pore pressure of the slices is deferred).
#[test]
fn extends_a_line_given_before_the_external_boundary_to_the_model_edges() {
    let mut s = Slope::new();
    s.add_material(soil());
    s.set_water_table(&custom(&[[15.0, -3.0], [25.0, -3.0]], Some(false)))
        .unwrap();
    s.set_water_table_by_id("own", &[[15.0, -4.0], [25.0, -4.0]], false)
        .unwrap();
    s.set_external_boundary(&[
        [0.0, -20.0],
        [0.0, 0.0],
        [20.0, 0.0],
        [40.0, -10.0],
        [60.0, -10.0],
        [60.0, -20.0],
    ])
    .unwrap();
    let w = s.water_rl_xy().unwrap();
    assert_eq!(w.x, vec![0.0, 15.0, 25.0, 60.0]);
    assert_eq!(w.y, vec![-3.0, -3.0, -3.0, -3.0]);
}

// ── point-limits.test.ts (the limits; the analyses are deferred) ──

#[test]
fn a_search_range_given_as_a_point_is_widened_only_by_the_search() {
    let d = |l: Value| {
        def(json!({
            "orientation": "ltr",
            "coordinates": [[8.5, 20], [22.5, 20], [30.5, 10], [40, 10], [40, 5], [8.5, 5]],
            "materials": [{ "name": "S", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 15, "frictionAngle": 30 } }],
            "analysisLimits": l,
        }))
    };
    let s = build_slope(&to_canonical_slope_definition(&d(json!({ "entryLeftX": 17, "entryRightX": 21.5, "exitLeftX": 30.5, "exitRightX": 30.5 })), None).unwrap()).unwrap();
    assert_eq!(s.limits(), [17.0, 21.5, 30.5, 30.5]);
    let s = build_slope(&to_canonical_slope_definition(&d(json!({ "entryLeftX": 17, "entryRightX": 21.5, "exitLeftX": 30.5, "exitRightX": 35 })), None).unwrap()).unwrap();
    assert_eq!(s.limits(), [17.0, 21.5, 30.5, 35.0]);
    let w = 1e-5 * 31.5;
    assert_eq!(s.search_limits(), [17.0, 21.5, 30.5 - w, 35.0]);
}

// ── model-coordinates.test.ts (without the analysis) ──────────────

#[test]
fn model_space_x_and_circles() {
    for rtl in [false, true] {
        let m = |x: f64| if rtl { 20.0 - x } else { x };
        let mut p: Vec<[f64; 2]> = [
            [0.0, -6.0],
            [0.0, 0.0],
            [6.0, 0.0],
            [14.0, -4.0],
            [20.0, -4.0],
            [20.0, -6.0],
        ]
        .iter()
        .map(|&[x, y]| [m(x), y])
        .collect();
        if rtl {
            p.reverse();
        }
        let d = def(json!({
            "orientation": if rtl { "rtl" } else { "ltr" },
            "coordinates": p,
            "materials": [{ "name": "clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 20 } }],
            "regionAssignments": [{ "point": [10, -5], "materialName": "clay" }],
            "udls": [{ "magnitude": 15, "x1": m(1.0).min(m(5.0)), "x2": m(1.0).max(m(5.0)) }],
        }));
        let s = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
        let [lo, hi] = get_domain_x(&d.coordinates);
        let x = 7.25;
        close(
            s.to_model_x(x).unwrap(),
            if rtl { mirror_x(x, lo, hi) } else { x },
            12,
        );
        let plane = SearchPlane {
            cx: 7.0,
            cy: 9.0,
            radius: 8.0,
            ..Default::default()
        };
        let (cx, cy, r) = s.to_model_circle(&plane).unwrap();
        assert_eq!((cx, cy, r), (if rtl { 13.0 } else { 7.0 }, 9.0, 8.0));
        // a non-circular surface is not passed off as a circle
        let poly = SearchPlane {
            points: Some(vec![[0.0, 0.0], [1.0, -1.0]]),
            ..plane
        };
        assert!(err(s.to_model_circle(&poly)).contains("non-circular"));
    }
}

// ── review-fixes.test.ts: interslice data points of a right-to-left model ──
