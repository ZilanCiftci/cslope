//! Ported unit tests of model/reinforcement.ts: capacity envelopes and
//! effective vertical stress (reinforcement.test.ts, reinforcement-branches.test.ts,
//! review-fixes.test.ts, staged-water.test.ts), the FHWA pullout tables, Ito &
//! Matsui pile forces (pile.test.ts, layer-top-depth.test.ts) and the forces
//! on the slices. TypeScript takes the slices for `applyReinforcement` from
//! `getSlices` (solver phase); here they are made directly on the same arc
//! (30 slices of equal width), which keeps every property the tests check.
//! The factor-of-safety checks of these files are deferred (PORTING.md).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::reinforcement::{
    apply_reinforcement, build_envelope, build_pile_profile, effective_vertical_stress,
    effective_vertical_stress_with_loads, envelope_at, ito_matsui_coefficients, pile_force,
    pile_force_direction, pile_force_with_profile, pullout_beyond, PileGoverns,
};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::types::{
    Pile, Reinforcement, ReinforcementForce, Slice, WaterTableInput, WATER_UNIT_WEIGHT,
};
use model_core_support::{close, def, layered, material, mc, su};
use serde_json::{json, Value};
use std::f64::consts::PI;

fn reinf(v: Value) -> Reinforcement {
    serde_json::from_value(v).unwrap()
}

fn pile(v: Value) -> Pile {
    serde_json::from_value(v).unwrap()
}

/// `{ ...base, ...change }`.
fn with(base: &Value, change: Value) -> Value {
    let mut v = base.clone();
    for (k, x) in change.as_object().unwrap() {
        v[k] = x.clone();
    }
    v
}

fn opts(v: Value) -> AnalysisOptionsPatch {
    serde_json::from_value(v).unwrap()
}

// ── reinforcement.test.ts: Capacity envelope ──────────────────────

fn envelope_slope() -> Slope {
    build_slope(&def(layered(
        &[[0.0, 10.0], [10.0, 10.0], [20.0, 0.0], [30.0, 0.0]],
        -10.0,
        &[("S", None, mc(0.0, 30.0, 20.0))],
        json!({}),
    )))
    .unwrap()
}

fn line() -> Value {
    json!({ "x1": 0, "y1": 5, "x2": 10, "y2": 5, "tensileCapacity": 100 })
}

#[test]
fn fully_anchored_without_pullout() {
    let env = build_envelope(&envelope_slope(), &reinf(line()));
    for s in [0.0, 3.0, 10.0] {
        assert_eq!(envelope_at(&env, s), 100.0);
    }
}

#[test]
fn bond_with_a_plate_and_a_bonded_length() {
    let env = build_envelope(
        &envelope_slope(),
        &reinf(with(
            &line(),
            json!({ "end1Capacity": 60, "pullout": { "kind": "bond", "strength": 20, "bondedLength": 4 } }),
        )),
    );
    close(envelope_at(&env, 2.0), 60.0, 9);
    close(envelope_at(&env, 7.0), 60.0, 9);
    close(envelope_at(&env, 9.0), 20.0, 9);
    close(pullout_beyond(&env, 2.0), 80.0, 9);
}

#[test]
fn development_lengths_0_is_a_fully_anchored_end() {
    let env = build_envelope(
        &envelope_slope(),
        &reinf(with(
            &line(),
            json!({ "pullout": { "kind": "development", "length1": 0, "length2": 5 } }),
        )),
    );
    close(envelope_at(&env, 0.0), 100.0, 9);
    close(envelope_at(&env, 8.0), 40.0, 9);
}

#[test]
fn interface_friction_from_the_overburden() {
    // 5 m of soil above the line: σ′v = 100 kPa, r = 2·100·tan 20°.
    let env = build_envelope(
        &envelope_slope(),
        &reinf(with(
            &line(),
            json!({ "tensileCapacity": 1e6, "pullout": { "kind": "interface", "adhesion": 0, "frictionAngle": 20 } }),
        )),
    );
    close(
        pullout_beyond(&env, 6.0),
        2.0 * 100.0 * (20.0 * PI / 180.0).tan() * 4.0,
        6,
    );
}

#[test]
fn no_interface_outside_the_soil() {
    let adhesion = json!({ "kind": "interface", "adhesion": 10, "frictionAngle": 0 });
    let s = envelope_slope();
    let inside = build_envelope(
        &s,
        &reinf(with(
            &line(),
            json!({ "x2": 15, "tensileCapacity": 1e6, "pullout": adhesion }),
        )),
    );
    let in_air = build_envelope(
        &s,
        &reinf(with(
            &line(),
            json!({ "x2": 25, "tensileCapacity": 1e6, "pullout": adhesion }),
        )),
    );
    close(
        pullout_beyond(&in_air, 0.0),
        pullout_beyond(&inside, 0.0),
        6,
    );
    close(pullout_beyond(&inside, 0.0), 2.0 * 10.0 * 15.0, 6);
}

#[test]
fn no_bond_outside_the_soil() {
    let s = envelope_slope();
    let env = build_envelope(
        &s,
        &reinf(
            json!({ "x1": 25, "y1": 5, "x2": 0, "y2": 5, "tensileCapacity": 1e6, "pullout": { "kind": "bond", "strength": 20 } }),
        ),
    );
    close(pullout_beyond(&env, 0.0), 20.0 * 15.0, 9);
    close(envelope_at(&env, 12.0), 40.0, 9);
    let tieback = build_envelope(
        &s,
        &reinf(
            json!({ "x1": 25, "y1": 5, "x2": 0, "y2": 5, "tensileCapacity": 1e6, "pullout": { "kind": "bond", "strength": 20, "bondedLength": 4 } }),
        ),
    );
    close(pullout_beyond(&tieback, 12.0), 80.0, 9);
}

#[test]
fn ponded_water_weighs_on_the_overburden() {
    let d = layered(
        &[[0.0, 10.0], [40.0, 10.0]],
        -10.0,
        &[("S", None, mc(0.0, 30.0, 20.0))],
        json!({ "waterTable": { "mode": "custom", "value": [[0, 12], [40, 12]], "followBoundary": false } }),
    );
    close(
        effective_vertical_stress(&build_slope(&def(d)).unwrap(), 20.0, 5.0),
        100.0 - 5.0 * WATER_UNIT_WEIGHT,
        6,
    );
}

#[test]
fn follows_changes_of_the_materials() {
    let mut s2 = envelope_slope();
    s2.set_reinforcements(&[reinf(with(&line(), json!({ "tensileCapacity": 1e6, "pullout": { "kind": "interface", "adhesion": 0, "frictionAngle": 20 } })))])
        .unwrap();
    let before = pullout_beyond(&s2.reinforcement_envelopes()[0], 6.0);
    // Half the unit weight: half the overburden and pullout.
    let light = s2.insert_material(material("Light", mc(0.0, 30.0, 10.0)));
    s2.assign_material([5.0, 5.0], light).unwrap();
    close(
        pullout_beyond(&s2.reinforcement_envelopes()[0], 6.0),
        before / 2.0,
        6,
    );
}

#[test]
fn rejects_invalid_input() {
    let mut s = envelope_slope();
    for change in [
        json!({ "tensileCapacity": -1 }),
        json!({ "spacing": 0 }),
        json!({ "pullout": { "kind": "bond", "strength": -2 } }),
        json!({ "pullout": { "kind": "interface", "adhesion": 0, "frictionAngle": 95 } }),
    ] {
        assert!(s
            .set_reinforcements(&[reinf(with(&line(), change))])
            .is_err());
    }
}

#[test]
fn a_water_table_entered_right_to_left_keeps_its_vertical_step() {
    let d = layered(
        &[[0.0, 5.0], [10.0, 5.0], [10.0, 10.0], [20.0, 10.0]],
        -5.0,
        &[("C", None, mc(10.0, 0.0, 18.0))],
        json!({ "waterTable": { "mode": "custom", "value": [[20, 8], [10, 8], [10, 5], [0, 5]], "followBoundary": false } }),
    );
    let slope = build_slope(&def(d)).unwrap();
    let w = slope.water_rl_xy().unwrap();
    let i = w.x.iter().position(|&x| x == 10.0).unwrap();
    assert_eq!(w.y[i], 5.0);
    assert_eq!(w.y[i + 1], 8.0);
}

// ── reinforcement-branches.test.ts ────────────────────────────────

const BOUNDARY: [[f64; 2]; 6] = [
    [0.0, -10.0],
    [0.0, 10.0],
    [10.0, 10.0],
    [25.0, 0.0],
    [40.0, 0.0],
    [40.0, -10.0],
];

fn slope_of(m: Value) -> Slope {
    let mut s = Slope::new();
    s.add_material(material("M", m));
    s.set_external_boundary(&BOUNDARY).unwrap();
    s
}

fn mc19() -> Value {
    json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 10, "frictionAngle": 30 })
}

fn nail() -> Value {
    json!({ "x1": 20, "y1": 3.33, "x2": 8, "y2": 0, "tensileCapacity": 150, "spacing": 1.5 })
}

#[test]
fn envelopes_within_0_t_continuous_along_the_element() {
    let s = slope_of(mc19());
    let kinds = [
        nail(),
        with(
            &nail(),
            json!({ "pullout": { "kind": "bond", "strength": 20 } }),
        ),
        with(
            &nail(),
            json!({ "pullout": { "kind": "bond", "strength": 40, "bondedLength": 5 }, "end1Capacity": 30 }),
        ),
        with(
            &nail(),
            json!({ "pullout": { "kind": "development", "length1": 2, "length2": 3 } }),
        ),
        with(
            &nail(),
            json!({ "pullout": { "kind": "development", "length1": 0, "length2": 0 } }),
        ),
        with(
            &nail(),
            json!({ "pullout": { "kind": "interface", "adhesion": 5, "frictionAngle": 25, "coverage": 0.8 } }),
        ),
    ];
    for k in kinds {
        let r = reinf(k);
        let env = build_envelope(&s, &r);
        let mut prev = envelope_at(&env, 0.0);
        for i in 0..=200 {
            let v = envelope_at(&env, (i as f64 / 200.0) * env.length);
            assert!(v >= 0.0);
            assert!(v <= r.tensile_capacity + 1e-9);
            assert!((v - prev).abs() < r.tensile_capacity * 0.2);
            prev = v;
        }
        assert!(pullout_beyond(&env, env.length + 1.0) >= 0.0);
    }
}

#[test]
fn bond_the_envelope_is_the_smaller_of_the_pullout_from_either_end() {
    let s = slope_of(mc19());
    let env = build_envelope(
        &s,
        &reinf(with(
            &nail(),
            json!({ "pullout": { "kind": "bond", "strength": 20 } }),
        )),
    );
    let l = env.length;
    for t in [0.1, 0.3, 0.5, 0.9] {
        close(
            envelope_at(&env, t * l),
            150f64.min(20.0 * t * l).min(20.0 * (1.0 - t) * l),
            9,
        );
    }
    let part = build_envelope(
        &s,
        &reinf(with(
            &nail(),
            json!({ "pullout": { "kind": "bond", "strength": 40, "bondedLength": 5 }, "end1Capacity": 30 }),
        )),
    );
    close(envelope_at(&part, 1.0), 30.0, 9);
    close(envelope_at(&part, -1.0), 30.0, 9);
}

#[test]
fn development_linear_over_each_length_anchored_is_t_everywhere() {
    let s = slope_of(mc19());
    let env = build_envelope(
        &s,
        &reinf(with(
            &nail(),
            json!({ "pullout": { "kind": "development", "length1": 2, "length2": 3 } }),
        )),
    );
    close(envelope_at(&env, 1.0), 75.0, 9);
    close(envelope_at(&env, env.length - 1.5), 75.0, 9);
    assert_eq!(envelope_at(&env, env.length / 2.0), 150.0);
    let anchored = build_envelope(&s, &reinf(nail()));
    assert_eq!(envelope_at(&anchored, 3.0), 150.0);
    assert_eq!(pullout_beyond(&anchored, 3.0), f64::INFINITY);
    let zero = build_envelope(
        &s,
        &reinf(with(
            &nail(),
            json!({ "pullout": { "kind": "development", "length1": 0, "length2": 0 } }),
        )),
    );
    assert_eq!(pullout_beyond(&zero, 1.0), f64::INFINITY);
}

#[test]
fn interface_friction_no_resistance_outside_the_soil_more_with_depth() {
    let s = slope_of(mc19());
    let out = build_envelope(
        &s,
        &reinf(
            json!({ "x1": 22, "y1": 8, "x2": 12, "y2": 4, "tensileCapacity": 1e6, "pullout": { "kind": "interface", "adhesion": 5, "frictionAngle": 25 } }),
        ),
    );
    assert_eq!(out.from_end1[1], 0.0);
    close(effective_vertical_stress(&s, 5.0, 5.0), 19.0 * 5.0, 1);
    assert_eq!(effective_vertical_stress(&s, 5.0, 12.0), 0.0);
    assert_eq!(effective_vertical_stress(&Slope::new(), 5.0, 5.0), 0.0);
}

#[test]
fn effective_stress_gamma_sat_below_the_water_line_ponded_water_on_the_column() {
    let mut sat = slope_of(
        json!({ "kind": "mohr-coulomb", "unitWeight": 18, "unitWeightSat": 20, "cohesion": 5, "frictionAngle": 30 }),
    );
    sat.set_water_table(&WaterTableInput::Height {
        height: 5.0,
        follow_boundary: Some(false),
    })
    .unwrap();
    close(
        effective_vertical_stress(&sat, 5.0, 2.0),
        5.0 * 18.0 + 3.0 * 20.0 - 3.0 * WATER_UNIT_WEIGHT,
        6,
    );
    close(
        effective_vertical_stress(&sat, 35.0, -2.0),
        2.0 * (20.0 - WATER_UNIT_WEIGHT),
        6,
    );
}

/// The slices of the circle (22, 18, 18.5) between its outermost crossings
/// with the ground: 30 of equal width, the bases chords of the arc.
fn arc_slices(s: &Slope) -> Vec<Slice> {
    let (cx, cy, r) = (22.0, 18.0, 18.5);
    let ints = s.get_circle_external_intersection(cx, cy, r).unwrap();
    let (x0, x1) = (ints[0][0], ints[ints.len() - 1][0]);
    let arc = |x: f64| cy - (r * r - (x - cx) * (x - cx)).max(0.0).sqrt();
    (0..30)
        .map(|i| {
            let xl = x0 + (x1 - x0) * i as f64 / 30.0;
            let xr = x0 + (x1 - x0) * (i + 1) as f64 / 30.0;
            let x = (xl + xr) / 2.0;
            Slice {
                x,
                x_left: xl,
                x_right: xr,
                y0_bottom: arc(xl),
                y1_bottom: arc(xr),
                dx: x - cx,
                ..Default::default()
            }
        })
        .collect()
}

fn forces_for(r: Value) -> Vec<ReinforcementForce> {
    let mut s = slope_of(mc19());
    s.set_reinforcements(&[reinf(r)]).unwrap();
    let mut slices = arc_slices(&s);
    let applied = apply_reinforcement(&s, &mut slices, 22.0, 18.0).unwrap();
    let on_slices: Vec<ReinforcementForce> = slices
        .iter()
        .flat_map(|q| q.reinforcement_forces.clone().unwrap_or_default())
        .collect();
    assert_eq!(applied, on_slices);
    on_slices
}

#[test]
fn axial_tangent_and_bisector_directions_the_bisector_halves_the_angle() {
    let axial = forces_for(with(&nail(), json!({ "direction": "axial" })))[0].clone();
    let tangent = forces_for(with(&nail(), json!({ "direction": "tangent" })))[0].clone();
    let bis = forces_for(with(&nail(), json!({ "direction": "bisector" })))[0].clone();
    for f in [&axial, &tangent, &bis] {
        close(f.fx.hypot(f.fy), f.force, 9);
    }
    let u = |f: &ReinforcementForce| [f.fx / f.force, f.fy / f.force];
    let (sx, sy) = (u(&axial)[0] + u(&tangent)[0], u(&axial)[1] + u(&tangent)[1]);
    let [bx, by] = u(&bis);
    close(bx * sy - by * sx, 0.0, 9);
    assert!(bx * sx + by * sy > 0.0);
    for f in [&axial, &tangent, &bis] {
        assert!(f.fx < 0.0);
    }
}

#[test]
fn a_passive_element_the_movement_would_push_carries_nothing() {
    // (issue #143: the rule is for passive elements; these were the default,
    // active, before)
    let passive = json!({ "application": "passive" });
    assert!(forces_for(with(
        &json!({ "x1": 20, "y1": 3.33, "x2": 34, "y2": -6, "tensileCapacity": 100 }),
        passive.clone()
    ))
    .is_empty());
    assert!(forces_for(with(
        &json!({ "x1": 35, "y1": -1, "x2": 38, "y2": -3, "tensileCapacity": 100 }),
        passive.clone()
    ))
    .is_empty());
    assert!(forces_for(with(
        &json!({ "x1": 20, "y1": 0, "x2": 20, "y2": 0, "tensileCapacity": 100 }),
        passive
    ))
    .is_empty());
    assert!(forces_for(with(
        &nail(),
        json!({ "tensileCapacity": 0, "application": "passive" })
    ))
    .is_empty());
}

#[test]
fn an_active_element_the_movement_would_push_carries_its_force_along_itself() {
    // Pointing down-slope out of the mass: pushed by the movement, yet a
    // prestressed anchor's force acts all the same (issue #143), along the
    // element towards its part in stable ground, here partly down-slope.
    for r in [
        json!({ "x1": 20, "y1": 3.33, "x2": 34, "y2": -6, "tensileCapacity": 100 }),
        json!({ "x1": 20, "y1": 3.33, "x2": 34, "y2": -6, "tensileCapacity": 100, "application": "active", "direction": "tangent" }),
    ] {
        let f = forces_for(r);
        assert_eq!(f.len(), 1);
        close(f[0].force, 100.0, 12);
        assert!(!f[0].passive);
        let (ux, uy) = (14.0 / 14.0f64.hypot(9.33), -9.33 / 14.0f64.hypot(9.33));
        close(f[0].fx, 100.0 * ux, 9);
        close(f[0].fy, 100.0 * uy, 9);
        assert!(f[0].fx > 0.0);
    }
    // Missing the surface, of no length or of no capacity: nothing, as before.
    assert!(
        forces_for(json!({ "x1": 35, "y1": -1, "x2": 38, "y2": -3, "tensileCapacity": 100 }))
            .is_empty()
    );
    assert!(
        forces_for(json!({ "x1": 20, "y1": 0, "x2": 20, "y2": 0, "tensileCapacity": 100 }))
            .is_empty()
    );
    assert!(forces_for(with(&nail(), json!({ "tensileCapacity": 0 }))).is_empty());
}

#[test]
fn a_passive_element_within_2_degrees_of_the_normal_carries_its_force() {
    let at = |deg: f64| {
        let t = deg * PI / 180.0;
        forces_for(
            json!({ "x1": 22.0 - 6.0 * t.sin(), "y1": -0.5 + 6.0 * t.cos(), "x2": 22.0 + 6.0 * t.sin(), "y2": -0.5 - 6.0 * t.cos(), "tensileCapacity": 100, "application": "passive" }),
        )
    };
    assert_eq!(at(0.0).len(), 1);
    assert_eq!(at(6.0).len(), 0);
}

#[test]
fn an_active_element_carries_its_force_whatever_its_angle_past_the_normal() {
    // The same elements, active (the default application): the force acts
    // at 6° past the vertical too.
    let at = |deg: f64| {
        let t = deg * PI / 180.0;
        forces_for(
            json!({ "x1": 22.0 - 6.0 * t.sin(), "y1": -0.5 + 6.0 * t.cos(), "x2": 22.0 + 6.0 * t.sin(), "y2": -0.5 - 6.0 * t.cos(), "tensileCapacity": 100 }),
        )
    };
    assert_eq!(at(0.0).len(), 1);
    assert_eq!(at(6.0).len(), 1);
    close(at(6.0)[0].force, 100.0, 12);
}

/// An element through the middle of the base of the slice at the circle's
/// lowest point, `deg` past the normal to that base on the pushed side
/// (the movement, +x along the base, would shorten it); returns the forces
/// and the base's unit tangent and the element's unit direction into the
/// stable ground.
fn pushed_by(deg: f64, extra: Value) -> (Vec<ReinforcementForce>, [f64; 2], [f64; 2]) {
    let s = slope_of(mc19());
    let slices = arc_slices(&s);
    let q = slices
        .iter()
        .find(|q| q.x_left <= 22.0 && 22.0 < q.x_right)
        .unwrap();
    let (bx, by) = (q.x_right - q.x_left, q.y1_bottom - q.y0_bottom);
    let bl = bx.hypot(by);
    let (tx, ty) = (bx / bl, by / bl);
    // Normal into the stable ground (below the base), tilted towards +t.
    let (nx, ny) = (ty, -tx);
    let d = deg * PI / 180.0;
    let (ux, uy) = (d.cos() * nx + d.sin() * tx, d.cos() * ny + d.sin() * ty);
    let (mx, my) = (q.x, (q.y0_bottom + q.y1_bottom) / 2.0);
    let r = with(
        &json!({ "x1": mx - 6.0 * ux, "y1": my - 6.0 * uy, "x2": mx + 6.0 * ux, "y2": my + 6.0 * uy, "tensileCapacity": 100 }),
        extra,
    );
    (forces_for(r), [tx, ty], [ux, uy])
}

#[test]
fn an_active_element_past_the_normal_carries_its_full_force_along_itself() {
    // Issue #143: 1°, 3°, 10° and 30° past the normal to the base, on the
    // pushed side: the full force, along the element, its component in the
    // direction of sliding sin(angle) of it.
    for deg in [1.0, 3.0, 10.0, 30.0] {
        for extra in [
            json!({}),
            json!({ "application": "active" }),
            json!({ "application": "active", "direction": "bisector" }),
        ] {
            let (f, [tx, ty], [ux, uy]) = pushed_by(deg, extra);
            assert_eq!(f.len(), 1, "{deg}°");
            close(f[0].force, 100.0, 12);
            close(f[0].fx, 100.0 * ux, 9);
            close(f[0].fy, 100.0 * uy, 9);
            close(
                (f[0].fx * tx + f[0].fy * ty) / 100.0,
                (deg * PI / 180.0).sin(),
                9,
            );
        }
    }
}

#[test]
fn a_passive_element_past_the_normal_is_dropped_beyond_2_degrees() {
    // Unchanged by issue #143: within 2° along itself, beyond it nothing.
    let (f, _, [ux, uy]) = pushed_by(1.0, json!({ "application": "passive" }));
    assert_eq!(f.len(), 1);
    close(f[0].fx, 100.0 * ux, 9);
    close(f[0].fy, 100.0 * uy, 9);
    assert!(f[0].passive);
    for deg in [3.0, 10.0, 30.0] {
        assert!(
            pushed_by(deg, json!({ "application": "passive" }))
                .0
                .is_empty(),
            "{deg}°"
        );
    }
}

#[test]
fn passive_elements_go_to_the_passive_loads_divided_by_the_spacing() {
    let mut s = slope_of(mc19());
    s.set_reinforcements(&[reinf(with(&nail(), json!({ "application": "passive" })))])
        .unwrap();
    let mut slices = arc_slices(&s);
    let f = apply_reinforcement(&s, &mut slices, 22.0, 18.0).unwrap();
    assert!(f[0].passive);
    close(f[0].force, 150.0 / 1.5, 9);
    assert!(slices.iter().any(|q| q.reinforcement_passive.is_some()));
    assert!(slices.iter().all(|q| q.reinforcement_active.is_none()));
}

fn pile_branches() -> Value {
    json!({ "x1": 20, "y1": 3.33, "x2": 20, "y2": -9, "diameter": 0.6, "spacing": 2 })
}

#[test]
fn ito_matsui_force_grows_with_depth_capped_by_shear_and_by_bending() {
    let s = slope_of(mc19());
    let p = pile(pile_branches());
    let profile = build_pile_profile(&s, &p).unwrap().unwrap();
    let shallow = pile_force(&s, &p, 20.0, 1.0, Some(&profile));
    let deep = pile_force(&s, &p, 20.0, -4.0, Some(&profile));
    assert_eq!(shallow.governs, PileGoverns::Soil);
    assert!(deep.per_pile > shallow.per_pile);
    close(deep.per_metre, deep.per_pile / 2.0, 12);
    let shear = pile_force(
        &s,
        &pile(with(&pile_branches(), json!({ "shearCapacity": 10 }))),
        20.0,
        -4.0,
        Some(&profile),
    );
    assert_eq!((shear.per_pile, shear.governs), (10.0, PileGoverns::Shear));
    let bending = pile_force(
        &s,
        &pile(with(&pile_branches(), json!({ "momentCapacity": 5 }))),
        20.0,
        -4.0,
        Some(&profile),
    );
    assert_eq!(bending.governs, PileGoverns::Bending);
    assert!(bending.per_pile < deep.per_pile);
    // Above the pile head: nothing.
    assert_eq!(
        pile_force_with_profile(
            &s,
            &pile(with(&pile_branches(), json!({ "y1": -2 }))),
            20.0,
            -1.0
        )
        .unwrap()
        .per_pile,
        0.0
    );
}

#[test]
fn design_strength_lowers_the_pressure_strong_rock_gives_none() {
    let p = pile(pile_branches());
    let s = slope_of(mc19());
    let mut f = slope_of(mc19());
    f.update_analysis_options(&opts(json!({ "partialFactors": { "cu": 1.4, "cohesion": 1.25, "tanPhi": 1.25, "variableLoad": 1 } }))).unwrap();
    let force = |s: &Slope, p: &Pile| pile_force_with_profile(s, p, 20.0, -4.0).unwrap();
    assert!(force(&f, &p).per_pile < force(&s, &p).per_pile);
    let clay_model = json!({ "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 30 });
    let mut clay = slope_of(clay_model.clone());
    clay.update_analysis_options(&opts(
        json!({ "partialFactors": { "cu": 1.4, "cohesion": 1, "tanPhi": 1, "variableLoad": 1 } }),
    ))
    .unwrap();
    assert!(force(&clay, &p).per_pile < force(&slope_of(clay_model), &p).per_pile);
    let rock = slope_of(json!({ "kind": "high-strength", "unitWeight": 25 }));
    assert_eq!(force(&rock, &p).per_pile, 0.0);
    assert!(
        build_pile_profile(&s, &pile(with(&pile_branches(), json!({ "force": 40 }))))
            .unwrap()
            .is_none()
    );
    assert!(build_pile_profile(
        &s,
        &pile(with(&pile_branches(), json!({ "x1": 60, "x2": 60 })))
    )
    .unwrap()
    .is_none());
    let given = force(&s, &pile(with(&pile_branches(), json!({ "force": 40 }))));
    assert_eq!(
        (given.per_pile, given.per_metre, given.governs),
        (40.0, 20.0, PileGoverns::Given)
    );
}

#[test]
fn pile_force_directions() {
    let p = pile_branches();
    let [ax, ay] = pile_force_direction(&pile(with(&p, json!({ "angle": 30 }))), 0.8, -0.6);
    close(ax, -(PI / 6.0).cos(), 12);
    close(ay, 0.5, 12);
    assert_eq!(
        pile_force_direction(
            &pile(with(&p, json!({ "direction": "tangent" }))),
            0.8,
            -0.6
        ),
        [-0.8, 0.6]
    );
    let [px, py] = pile_force_direction(
        &pile(with(&p, json!({ "direction": "perpendicular" }))),
        0.8,
        -0.6,
    );
    assert!(px * 0.8 + py * -0.6 < 0.0);
    assert!(py.abs() < 1e-12);
    // A pile of no length: falls back to the angle.
    close(
        pile_force_direction(
            &pile(with(
                &p,
                json!({ "x2": 20, "y2": 3.33, "direction": "perpendicular" }),
            )),
            1.0,
            0.0,
        )[0],
        -1.0,
        12,
    );
    // Movement perpendicular to the normal: the normal pointing to +x is flipped.
    assert!(
        pile_force_direction(
            &pile(with(&p, json!({ "direction": "perpendicular" }))),
            0.0,
            -1.0
        )[0] < 0.0
    );
}

#[test]
fn degenerate_elements_give_no_forces() {
    let mut s = slope_of(mc19());
    s.set_reinforcements(&[reinf(nail())]).unwrap();
    assert!(apply_reinforcement(&s, &mut [], 22.0, 18.0)
        .unwrap()
        .is_empty());
    s.set_reinforcements(&[]).unwrap();
    s.set_piles(&[
        pile(json!({ "x1": 20, "y1": 0, "x2": 20, "y2": 0, "force": 50 })),
        pile(json!({ "x1": 38, "y1": 0, "x2": 38, "y2": -8, "force": 50 })),
    ])
    .unwrap();
    let mut slices = arc_slices(&s);
    assert!(apply_reinforcement(&s, &mut slices, 22.0, 18.0)
        .unwrap()
        .is_empty());
    assert!(slices.iter().all(|q| q.reinforcement_forces.is_none()));
}

// ── pile.test.ts: Ito & Matsui pile force ─────────────────────────

const GROUND: [[f64; 2]; 4] = [[0.0, 10.0], [10.0, 10.0], [25.0, 0.0], [40.0, 0.0]];

fn piled(m: Value, extra: Value) -> Slope {
    build_slope(&def(layered(&GROUND, -10.0, &[("S", None, m)], extra))).unwrap()
}

fn long_pile() -> Pile {
    pile(json!({ "x1": 5, "y1": 10, "x2": 5, "y2": -10, "diameter": 0.8, "spacing": 2.4 }))
}

#[test]
fn integrates_p_z_down_to_the_slip_surface() {
    let slope = piled(mc(10.0, 20.0, 20.0), json!({}));
    let zf = 4.0;
    let [a1, a2] = ito_matsui_coefficients(1.6, 0.8, 20.0);
    let expected = 10.0 * a1 * zf + (20.0 * a2 * zf * zf) / 2.0;
    let f = pile_force_with_profile(&slope, &long_pile(), 5.0, 10.0 - zf).unwrap();
    close(f.per_pile, expected, 1);
    close(f.per_metre, expected / 2.4, 1);
    assert_eq!(f.governs, PileGoverns::Soil);
}

#[test]
fn uses_the_effective_overburden_below_the_water_table() {
    let mut m = mc(5.0, 25.0, 20.0);
    m["unitWeightSat"] = json!(20);
    let dry = piled(m.clone(), json!({}));
    let wet = piled(
        m,
        json!({ "waterTable": { "mode": "custom", "value": GROUND, "followBoundary": false } }),
    );
    let zf = 6.0;
    let [a1, a2] = ito_matsui_coefficients(1.6, 0.8, 25.0);
    let per_pile = |gamma: f64| 5.0 * a1 * zf + (gamma * a2 * zf * zf) / 2.0;
    let f_dry = pile_force_with_profile(&dry, &long_pile(), 5.0, 10.0 - zf)
        .unwrap()
        .per_pile;
    let f_wet = pile_force_with_profile(&wet, &long_pile(), 5.0, 10.0 - zf)
        .unwrap()
        .per_pile;
    close(f_dry, per_pile(20.0), 1);
    close(f_dry, 1053.0, 0);
    close(f_wet, per_pile(20.0 - WATER_UNIT_WEIGHT), 1);
    close(f_wet, 593.0, 0);
}

#[test]
fn keeps_the_total_overburden_for_an_undrained_soil_below_the_water_table() {
    let m = json!({ "kind": "undrained", "unitWeight": 18, "unitWeightSat": 20, "undrainedShearStrength": 30 });
    let wet = piled(
        m,
        json!({ "waterTable": { "mode": "custom", "value": GROUND, "followBoundary": false } }),
    );
    let zf = 6.0;
    let [a1, a2] = ito_matsui_coefficients(1.6, 0.8, 0.0);
    close(
        pile_force_with_profile(&wet, &long_pile(), 5.0, 10.0 - zf)
            .unwrap()
            .per_pile,
        30.0 * a1 * zf + (20.0 * a2 * zf * zf) / 2.0,
        1,
    );
}

#[test]
fn loads_the_pile_only_from_its_head_down_with_design_strength() {
    let mut slope = piled(mc(10.0, 20.0, 20.0), json!({}));
    let [a1, a2] = ito_matsui_coefficients(1.6, 0.8, 20.0);
    let buried =
        pile(json!({ "x1": 5, "y1": 8, "x2": 5, "y2": -10, "diameter": 0.8, "spacing": 2.4 }));
    let expected = 10.0 * a1 * 3.0 + (20.0 * a2 * (25.0 - 4.0)) / 2.0;
    close(
        pile_force_with_profile(&slope, &buried, 5.0, 5.0)
            .unwrap()
            .per_pile,
        expected,
        1,
    );
    let headed = Pile { y1: 10.0, ..buried };
    let full = pile_force_with_profile(&slope, &headed, 5.0, 5.0)
        .unwrap()
        .per_pile;
    slope.update_analysis_options(&opts(json!({ "partialFactors": { "cu": 1.5, "cohesion": 1.3, "tanPhi": 1.3, "variableLoad": 1.3 } }))).unwrap();
    assert!(
        pile_force_with_profile(&slope, &headed, 5.0, 5.0)
            .unwrap()
            .per_pile
            < full * 0.85
    );
}

#[test]
fn the_phi_0_solution_is_a_lower_bound() {
    let [a0, b0] = ito_matsui_coefficients(1.6, 0.8, 0.0);
    for phi in [1.0, 2.0, 5.0, 10.0] {
        let [a, b] = ito_matsui_coefficients(1.6, 0.8, phi);
        assert!(a >= a0);
        assert!(b >= b0);
    }
}

#[test]
fn is_limited_by_the_shear_and_bending_capacity() {
    let slope = piled(su(30.0, 18.0), json!({}));
    let base = json!({ "x1": 5, "y1": 10, "x2": 5, "y2": -10, "diameter": 0.6, "spacing": 2 });
    let force = |p: Value| pile_force_with_profile(&slope, &pile(p), 5.0, 6.0).unwrap();
    let soil = force(base.clone()).per_pile;
    let shear = force(with(&base, json!({ "shearCapacity": soil / 2.0 })));
    assert_eq!(
        (shear.per_pile, shear.governs),
        (soil / 2.0, PileGoverns::Shear)
    );
    let bent = force(with(&base, json!({ "momentCapacity": soil / 10.0 })));
    assert_eq!(bent.governs, PileGoverns::Bending);
    assert!(bent.per_pile > soil / 10.0 / 2.0);
    assert!(bent.per_pile < (soil / 10.0) * (3.0 / 4.0));
    close(
        force(with(&base, json!({ "force": 100, "momentCapacity": 40 }))).per_pile,
        30.0,
        9,
    );
}

#[test]
fn rejects_input_ito_and_matsui_cannot_use() {
    let mut slope = piled(mc(10.0, 20.0, 20.0), json!({}));
    let e = |s: &mut Slope, p: Value| s.set_piles(&[pile(p)]).unwrap_err().message;
    assert!(e(
        &mut slope,
        json!({ "x1": 5, "y1": 10, "x2": 6, "y2": -10, "diameter": 0.6, "spacing": 2 })
    )
    .contains("vertical"));
    assert!(e(
        &mut slope,
        json!({ "x1": 5, "y1": 10, "x2": 5, "y2": -10, "diameter": 0.6, "spacing": 0.5 })
    )
    .contains("spacing"));
    assert!(e(&mut slope, json!({ "x1": 5, "y1": 10, "x2": 5, "y2": -10 })).contains("diameter"));
}

#[test]
fn ito_matsui_pressure_in_the_drained_limit_of_lime_cement_columns() {
    let m = json!({
        "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 16, "suRefDepth": 0, "suRateOfChange": 0,
        "columnSu": 120, "areaRatio": 0.25, "columnCohesion": 36, "columnFrictionAngle": 30,
    });
    let slope = build_slope(&def(layered(&GROUND, -10.0, &[("KC", None, m)], json!({})))).unwrap();
    let [a1u, a2u] = ito_matsui_coefficients(1.6, 0.8, 0.0);
    assert_eq!(a2u, 0.8);
    let phi = (0.25 * (PI / 6.0).tan()).atan() * 180.0 / PI;
    let [a1, a2] = ito_matsui_coefficients(1.6, 0.8, phi);
    let pd = |z: f64| 21.0 * a1 + 16.0 * z * a2;
    let pu = |z: f64| 42.0 * a1u + 16.0 * z * a2u;
    for zf in [1.0, 4.0, 10.0, 18.0] {
        let force = pile_force_with_profile(&slope, &long_pile(), 5.0, 10.0 - zf)
            .unwrap()
            .per_pile;
        assert!(force <= 42.0 * a1u * zf + (16.0 * 0.8 * zf * zf) / 2.0 + 1e-6);
        let n = 20000;
        let expected: f64 = (0..n)
            .map(|k| {
                let z = ((k as f64 + 0.5) * zf) / n as f64;
                (pd(z).min(pu(z)) * zf) / n as f64
            })
            .sum();
        close(force, expected, 0);
    }
}

// ── layer-top-depth.test.ts: pile pressure below the clay top ─────

#[test]
fn pile_pressure_in_the_clay_uses_the_depth_below_the_clay_top() {
    let ground = [[0.0, 1.0], [20.0, 1.0], [32.0, 7.0], [60.0, 7.0]];
    let embankment = |clay: Value| {
        build_slope(&def(layered(
            &ground,
            -15.0,
            &[
                ("Fill", None, mc(0.0, 32.0, 19.0)),
                ("Clay", Some(0.0), clay),
            ],
            json!({}),
        )))
        .unwrap()
    };
    let sf_depth = |extra: Value| {
        with(
            &json!({ "kind": "s-f-depth", "unitWeight": 16, "suRef": 10, "depthRef": 0, "rate": 1.5 }),
            extra,
        )
    };
    let sf_datum =
        json!({ "kind": "s-f-datum", "unitWeight": 16, "suRef": 10, "yRef": 0, "rate": 1.5 });
    let p = pile(json!({ "x1": 45, "y1": 7, "x2": 45, "y2": -12, "diameter": 0.6, "spacing": 2 }));
    let force = |clay: Value| {
        pile_force_with_profile(&embankment(clay), &p, 45.0, -6.0)
            .unwrap()
            .per_pile
    };
    let layer_top = force(sf_depth(json!({ "depthReference": "layer-top" })));
    close(layer_top, force(sf_datum), 9);
    assert!(force(sf_depth(json!({}))) > layer_top);
}

// ── review-fixes.test.ts ──────────────────────────────────────────

#[test]
fn coverage_scales_the_interface_pullout_but_not_the_per_element_capacities() {
    let slope = build_slope(&def(json!({
        "coordinates": [[0, -10], [0, 0], [20, 0], [30, -10]],
        "materials": [{ "name": "S", "unitWeight": 20, "frictionAngle": 30, "cohesion": 0 }],
    })))
    .unwrap();
    let element = |coverage: f64| {
        reinf(json!({
            "x1": 2, "y1": -3, "x2": 12, "y2": -3, "tensileCapacity": 1e6, "spacing": 1.5, "end1Capacity": 40, "end2Capacity": 0,
            "pullout": { "kind": "interface", "adhesion": 0, "frictionAngle": 25, "coverage": coverage },
        }))
    };
    let full = build_envelope(&slope, &element(1.0));
    let strip = build_envelope(&slope, &element(0.2));
    assert_eq!(strip.tensile, full.tensile);
    assert_eq!(strip.end1, full.end1);
    let total = |e: &cslope_engine::model::reinforcement::ReinforcementEnvelope| {
        e.from_end1[e.from_end1.len() - 1]
    };
    close(total(&strip), 0.2 * total(&full), 9);
    close(
        total(&full),
        2.0 * 20.0 * 3.0 * (25.0 * PI / 180.0).tan() * 1.5 * 10.0,
        6,
    );
    close(envelope_at(&strip, 5.0), 0.5 * total(&strip), 6);
}

#[test]
fn pile_force_is_normal_to_an_inclined_pile_against_the_movement() {
    let p = json!({ "x1": 0, "y1": 0, "x2": 3, "y2": -4, "force": 10 });
    let (tx, ty) = ((PI / 6.0).cos(), -(PI / 6.0).sin());
    let [ux, uy] = pile_force_direction(
        &pile(with(&p, json!({ "direction": "perpendicular" }))),
        tx,
        ty,
    );
    close(ux * 3.0 + uy * -4.0, 0.0, 12);
    close(ux.hypot(uy), 1.0, 12);
    assert!(ux * tx + uy * ty < 0.0);
    assert_eq!(
        pile_force_direction(&pile(with(&p, json!({ "direction": "tangent" }))), tx, ty),
        [-tx, -ty]
    );
    assert_eq!(
        pile_force_direction(&pile(with(&p, json!({ "angle": 0 }))), tx, ty),
        [-1.0, 0.0]
    );
}

// ── staged-water.test.ts: the stress of the loads ─────────────────

#[test]
fn the_part_of_a_load_carried_by_excess_pore_pressure_below_the_water_does_not_count() {
    let ground = [[0.0, 10.0], [10.0, 10.0], [25.0, 0.0], [45.0, 0.0]];
    let clay = json!({ "kind": "shansep", "unitWeight": 18, "ratio": 0.25, "exponent": 0.8, "yieldFromEarlierStage": true });
    let water = json!({ "mode": "custom", "value": [[0, 4], [45, 4]] });
    let stage = |udls: Value| {
        build_slope(&def(layered(
            &ground,
            -10.0,
            &[("C", None, clay.clone())],
            json!({ "waterTable": water, "udls": udls }),
        )))
        .unwrap()
    };
    let with_load = stage(json!([{ "magnitude": 200, "x1": 0, "x2": 45 }]));
    let none = stage(json!([]));
    // the stress for reinforcement pullout does not take the loads
    assert_eq!(
        effective_vertical_stress(&with_load, 30.0, -5.0),
        effective_vertical_stress(&none, 30.0, -5.0)
    );
    close(
        effective_vertical_stress_with_loads(&with_load, 30.0, -5.0),
        effective_vertical_stress(&none, 30.0, -5.0) + 200.0,
        9,
    );
    let excess = stage(
        json!([{ "magnitude": 200, "x1": 0, "x2": 45, "excessPorePressure": [{ "material": "C", "ratio": 0.75 }] }]),
    );
    close(
        effective_vertical_stress_with_loads(&excess, 30.0, -5.0),
        effective_vertical_stress(&none, 30.0, -5.0) + 50.0,
        9,
    );
    // above the water the whole load counts
    close(
        effective_vertical_stress_with_loads(&excess, 5.0, 6.0),
        effective_vertical_stress(&none, 5.0, 6.0) + 200.0,
        9,
    );
}
