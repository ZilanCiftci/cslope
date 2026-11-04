//! The analyses PORTING.md deferred to the solver phase from
//! reinforcement.test.ts (reinforcement on a rigid block, large active
//! loads), reinforcement-branches.test.ts ("forces on the slices" and
//! "degenerate elements", repeated here with get_slices) and pile.test.ts
//! ("raises the FOS and resists in either orientation", the FOS of
//! lime-cement columns).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::model::reinforcement::apply_reinforcement;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::types::{Pile, Reinforcement, ReinforcementForce};
use model_core_support::{close, layered, material, mc, su};
use serde_json::{json, Value};
use solvers_support::run_verification;

fn with(m: &Value, extra: Value) -> Value {
    let mut m = m.clone();
    for (k, v) in extra.as_object().unwrap() {
        m[k] = v.clone();
    }
    m
}

// ── Reinforcement on a rigid block ────────────────────────────────

// Homogeneous 10 m slope on Baker's 49.6° plane from the toe (V006): a
// rigid block, so every method gives the closed-form block solution.
const W: f64 = 600.0; // kN/m: 30 m² × 20 kN/m³

fn psi() -> f64 {
    10.0f64.atan2(8.5)
}

fn cl() -> f64 {
    30.0 * 8.5f64.hypot(10.0)
}

fn tan30() -> f64 {
    (30.0 * std::f64::consts::PI / 180.0).tan()
}

fn block(reinforcements: Value) -> Value {
    layered(
        &[[-5.0, 0.0], [0.0, 0.0], [2.5, 10.0], [20.0, 10.0]],
        -5.0,
        &[("Soil", None, mc(30.0, 30.0, 20.0))],
        json!({
            "orientation": "rtl",
            "customSurfaces": [{ "points": [[0, 0], [8.5, 10]] }],
            "customPlanesOnly": true,
            "reinforcements": reinforcements,
        }),
    )
}

/// Horizontal anchor at mid-height, crossing the plane, 100 kN/m.
fn anchor(extra: Value) -> Value {
    with(
        &json!({ "x1": 1.25, "y1": 5, "x2": 15, "y2": 5, "tensileCapacity": 100 }),
        extra,
    )
}

// Spencer returns the moment FOS where it meets the force FOS within the
// solver tolerance (0.005).
fn methods() -> [(&'static str, Value, i32); 2] {
    [
        ("Janbu", json!({}), 3),
        (
            "Morgenstern-Price",
            json!({ "intersliceFunction": "constant" }),
            2,
        ),
    ]
}

fn fos(d: Value, method: &str, o: Value) -> f64 {
    run_verification(d, method, o).0.unwrap()
}

#[test]
fn active_axial_force_closed_form() {
    let t = 100.0;
    let exact = (cl() + (W * psi().cos() + t * psi().sin()) * tan30())
        / (W * psi().sin() - t * psi().cos());
    for (m, o, digits) in methods() {
        close(fos(block(json!([anchor(json!({}))])), m, o), exact, digits);
    }
}

#[test]
fn passive_force_is_divided_by_f() {
    // F·(W sin ψ) − T cos ψ = cL + W cos ψ tan φ + (T/F) sin ψ tan φ
    let t = 100.0;
    let a = W * psi().sin();
    let b = -(t * psi().cos() + cl() + W * psi().cos() * tan30());
    let c = -t * psi().sin() * tan30();
    let exact = (-b + (b * b - 4.0 * a * c).sqrt()) / (2.0 * a);
    for (m, o, digits) in methods() {
        close(
            fos(
                block(json!([anchor(json!({ "application": "passive" }))])),
                m,
                o,
            ),
            exact,
            digits,
        );
    }
}

#[test]
fn tangent_force_acts_along_the_slip_surface() {
    let exact = (cl() + W * psi().cos() * tan30()) / (W * psi().sin() - 100.0);
    for (m, o, digits) in methods() {
        close(
            fos(
                block(json!([anchor(json!({ "direction": "tangent" }))])),
                m,
                o,
            ),
            exact,
            digits,
        );
    }
}

#[test]
fn a_passive_force_larger_than_the_driving_moment_at_f_1_still_gives_r_plus_t_over_d() {
    // Tangent, passive: F·W sin ψ − T = cL + W cos ψ tan φ.
    let t = 1500.0;
    let exact = (cl() + W * psi().cos() * tan30() + t) / (W * psi().sin());
    for (m, o, digits) in methods() {
        let d = block(json!([anchor(
            json!({ "tensileCapacity": t, "direction": "tangent", "application": "passive" })
        )]));
        close(fos(d, m, o), exact, digits);
    }
}

#[test]
fn spacing_divides_the_capacity_an_element_that_misses_the_surface_does_nothing() {
    let plain = fos(block(json!([])), "Janbu", json!({}));
    let per2 = fos(
        block(json!([anchor(
            json!({ "tensileCapacity": 200, "spacing": 2 })
        )])),
        "Janbu",
        json!({}),
    );
    close(
        per2,
        fos(block(json!([anchor(json!({}))])), "Janbu", json!({})),
        6,
    );
    // Entirely inside the sliding mass.
    close(
        fos(
            block(json!([anchor(json!({ "x2": 3 }))])),
            "Janbu",
            json!({}),
        ),
        plain,
        6,
    );
}

#[test]
fn the_movement_pulls_the_element_out_of_stable_ground_never_pushes_it() {
    // The same anchor drawn the other way round acts the same.
    let a = fos(block(json!([anchor(json!({}))])), "Janbu", json!({}));
    let b = fos(
        block(json!([{ "x1": 15, "y1": 5, "x2": 1.25, "y2": 5, "tensileCapacity": 100 }])),
        "Janbu",
        json!({}),
    );
    close(b, a, 6);
}

#[test]
fn gives_the_same_fos_mirrored() {
    let d = block(json!([anchor(json!({ "application": "passive" }))]));
    let mirror = |x: f64| 20.0 - x - 5.0;
    let mut m = d.clone();
    m["orientation"] = json!("ltr");
    let mut coords: Vec<Value> = d["coordinates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| json!([mirror(p[0].as_f64().unwrap()), p[1]]))
        .collect();
    coords.reverse();
    m["coordinates"] = Value::Array(coords);
    m["regionAssignments"] = Value::Array(
        d["regionAssignments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                with(
                    r,
                    json!({ "point": [mirror(r["point"][0].as_f64().unwrap()), r["point"][1]] }),
                )
            })
            .collect(),
    );
    m["customSurfaces"] = json!([{ "points": [[mirror(8.5), 10], [mirror(0.0), 0]] }]);
    m["reinforcements"] = Value::Array(
        d["reinforcements"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| with(r, json!({ "x1": mirror(r["x1"].as_f64().unwrap()), "x2": mirror(r["x2"].as_f64().unwrap()) })))
            .collect(),
    );
    for (meth, o, _) in methods() {
        close(fos(m.clone(), meth, o.clone()), fos(d.clone(), meth, o), 6);
    }
}

// ── Large active loads ────────────────────────────────────────────

/// 10 m vertical cut on a 60° plane with a 500 kN/m horizontal anchor:
/// high up, the Ordinary start value is so low that the driving side
/// vanished in the first iteration and the surface was dropped.
fn wall(y: f64) -> Value {
    layered(
        &[[-5.0, 0.0], [0.0, 0.0], [0.0, 10.0], [20.0, 10.0]],
        -5.0,
        &[("S", None, mc(0.0, 30.0, 20.0))],
        json!({
            "orientation": "rtl",
            "customSurfaces": [{ "points": [[0, 0], [10.0 / (std::f64::consts::PI / 3.0).tan(), 10]] }],
            "customPlanesOnly": true,
            "reinforcements": [{ "x1": 0, "y1": y, "x2": 15, "y2": y, "tensileCapacity": 500, "application": "active" }],
        }),
    )
}

#[test]
fn force_methods_converge_from_a_low_start_value_whatever_the_anchor_height() {
    let high = run_verification(wall(9.0), "Janbu", json!({})).0.unwrap();
    let low = run_verification(wall(10.0 / 3.0), "Janbu", json!({}))
        .0
        .unwrap();
    close(high, low, 2);
    close(
        fos(
            wall(9.0),
            "Morgenstern-Price",
            json!({ "intersliceFunction": "constant" }),
        ),
        high,
        1,
    );
}

// ── reinforcement-branches.test.ts: forces on the slices ──────────

const BOUNDARY: [[f64; 2]; 6] = [
    [0.0, -10.0],
    [0.0, 10.0],
    [10.0, 10.0],
    [25.0, 0.0],
    [40.0, 0.0],
    [40.0, -10.0],
];

fn slope_of() -> Slope {
    let mut s = Slope::new();
    s.add_material(material(
        "M",
        json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 10, "frictionAngle": 30 }),
    ));
    s.set_external_boundary(&BOUNDARY).unwrap();
    s
}

fn nail() -> Value {
    json!({ "x1": 20, "y1": 3.33, "x2": 8, "y2": 0, "tensileCapacity": 150, "spacing": 1.5 })
}

fn reinf(v: Value) -> Reinforcement {
    serde_json::from_value(v).unwrap()
}

fn slices_on_circle(s: &mut Slope, n: f64) -> Vec<cslope_engine::types::Slice> {
    s.update_analysis_options(&AnalysisOptionsPatch {
        slices: Some(n),
        ..Default::default()
    })
    .unwrap();
    let ints = s
        .get_circle_external_intersection(22.0, 18.0, 18.5)
        .unwrap();
    get_slices(
        s,
        ints[0][0],
        ints[ints.len() - 1][0],
        22.0,
        18.0,
        18.5,
        None,
        &mut SliceScratch::new(),
    )
    .unwrap()
}

fn forces_for(r: Value) -> Vec<ReinforcementForce> {
    let mut s = slope_of();
    s.set_reinforcements(&[reinf(r)]).unwrap();
    slices_on_circle(&mut s, 30.0)
        .iter()
        .flat_map(|q| q.reinforcement_forces.clone().unwrap_or_default())
        .collect()
}

#[test]
fn axial_tangent_and_bisector_directions_on_the_slices() {
    let axial = forces_for(with(&nail(), json!({ "direction": "axial" })))[0].clone();
    let tangent = forces_for(with(&nail(), json!({ "direction": "tangent" })))[0].clone();
    let bis = forces_for(with(&nail(), json!({ "direction": "bisector" })))[0].clone();
    for f in [&axial, &tangent, &bis] {
        close(f.fx.hypot(f.fy), f.force, 9);
    }
    // Along the sum of the two unit vectors.
    let u = |f: &ReinforcementForce| [f.fx / f.force, f.fy / f.force];
    let (sx, sy) = (u(&axial)[0] + u(&tangent)[0], u(&axial)[1] + u(&tangent)[1]);
    let [bx, by] = u(&bis);
    close(bx * sy - by * sx, 0.0, 9);
    assert!(bx * sx + by * sy > 0.0);
    // All pull back against the sliding direction (+x).
    for f in [&axial, &tangent, &bis] {
        assert!(f.fx < 0.0);
    }
}

#[test]
fn an_element_the_movement_would_push_misses_the_surface_or_has_no_length_carries_nothing() {
    // Pointing down-slope out of the mass: compressed by the movement.
    assert!(forces_for(
        json!({ "x1": 20, "y1": 3.33, "x2": 34, "y2": -6, "tensileCapacity": 100 })
    )
    .is_empty());
    assert!(
        forces_for(json!({ "x1": 35, "y1": -1, "x2": 38, "y2": -3, "tensileCapacity": 100 }))
            .is_empty()
    );
    assert!(
        forces_for(json!({ "x1": 20, "y1": 0, "x2": 20, "y2": 0, "tensileCapacity": 100 }))
            .is_empty()
    );
    // Zero capacity.
    assert!(forces_for(with(&nail(), json!({ "tensileCapacity": 0 }))).is_empty());
}

#[test]
fn an_element_within_2_degrees_of_the_normal_to_the_base_carries_its_force() {
    // the circle's lowest point is (22, −0.5), its base level there
    let at = |deg: f64| {
        let t = deg * std::f64::consts::PI / 180.0;
        // through the lowest point, tilted deg from the vertical: the lower end towards +x
        forces_for(json!({
            "x1": 22.0 - 6.0 * t.sin(), "y1": -0.5 + 6.0 * t.cos(),
            "x2": 22.0 + 6.0 * t.sin(), "y2": -0.5 - 6.0 * t.cos(), "tensileCapacity": 100,
        }))
    };
    assert_eq!(at(0.0).len(), 1);
    // (the slice base there is within about 1° of level)
    assert!(at(6.0).is_empty());
}

#[test]
fn passive_elements_go_to_the_passive_loads_divided_by_the_spacing() {
    let f = forces_for(with(&nail(), json!({ "application": "passive" })))[0].clone();
    assert!(f.passive);
    close(f.force, 150.0 / 1.5, 9);
}

#[test]
fn degenerate_elements_no_slices_a_pile_of_no_length_and_a_pile_beside_the_surface() {
    let mut s = slope_of();
    s.set_reinforcements(&[reinf(nail())]).unwrap();
    assert!(apply_reinforcement(&s, &mut [], 22.0, 18.0)
        .unwrap()
        .is_empty());
    s.set_reinforcements(&[]).unwrap();
    let piles: Vec<Pile> = serde_json::from_value(json!([
        { "x1": 20, "y1": 0, "x2": 20, "y2": 0, "force": 50 },
        { "x1": 38, "y1": 0, "x2": 38, "y2": -8, "force": 50 },
    ]))
    .unwrap();
    s.set_piles(&piles).unwrap();
    let slices = slices_on_circle(&mut s, 20.0);
    assert!(slices.iter().all(|q| q.reinforcement_forces.is_none()));
}

// ── pile.test.ts ──────────────────────────────────────────────────

const GROUND: [[f64; 2]; 4] = [[0.0, 10.0], [10.0, 10.0], [25.0, 0.0], [40.0, 0.0]];

#[test]
fn a_pile_raises_the_fos_and_resists_in_either_orientation() {
    let d = layered(
        &GROUND,
        -10.0,
        &[("S", None, mc(10.0, 20.0, 20.0))],
        json!({ "customSearchPlanes": [{ "cx": 22, "cy": 22, "radius": 22 }], "customPlanesOnly": true }),
    );
    let plain = fos(d.clone(), "Bishop", json!({}));
    let piled = fos(
        with(
            &d,
            json!({ "piles": [{ "x1": 15, "y1": 10, "x2": 15, "y2": -10, "force": 50 }] }),
        ),
        "Bishop",
        json!({}),
    );
    assert!(piled > plain * 1.05);
    // The mirror image gives the same.
    let m = |x: f64| 40.0 - x;
    let mut coords: Vec<Value> = d["coordinates"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| json!([m(p[0].as_f64().unwrap()), p[1]]))
        .collect();
    coords.reverse();
    let mirrored = with(
        &d,
        json!({
            "coordinates": coords,
            "regionAssignments": d["regionAssignments"].as_array().unwrap().iter()
                .map(|r| with(r, json!({ "point": [m(r["point"][0].as_f64().unwrap()), r["point"][1]] })))
                .collect::<Vec<_>>(),
            "customSearchPlanes": [{ "cx": m(22.0), "cy": 22, "radius": 22 }],
            "piles": [{ "x1": m(15.0), "y1": 10, "x2": m(15.0), "y2": -10, "force": 50 }],
        }),
    );
    close(fos(mirrored, "Bishop", json!({})), piled, 6);
}

#[test]
fn undrained_lime_cement_columns_give_the_fos_of_an_undrained_clay_of_that_strength() {
    let kc = json!({
        "kind": "lime-cement-columns", "unitWeight": 16, "soilSu": 10, "suRefDepth": 0, "suRateOfChange": 0,
        "columnSu": 120, "areaRatio": 0.25,
    });
    let geom = [[0.0, 0.0], [10.0, 0.0], [16.0, -4.0], [26.0, -4.0]];
    let surface = json!({ "customSearchPlanes": [{ "cx": 13, "cy": 6, "radius": 11 }], "customPlanesOnly": true });
    let a = fos(
        layered(&geom, -12.0, &[("KC", None, kc)], surface.clone()),
        "Bishop",
        json!({}),
    );
    let b = fos(
        layered(
            &geom,
            -12.0,
            &[("Su", None, su(0.25 * 120.0 + 0.75 * 10.0, 16.0))],
            surface,
        ),
        "Bishop",
        json!({}),
    );
    close(a, b, 6);
}
