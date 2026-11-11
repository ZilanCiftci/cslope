//! The analyses PORTING.md deferred to the solver phase from
//! review-fixes.test.ts: the interslice data points of a right-to-left model
//! (FOS), the Morgenstern-Price λ iteration, the slices of the extended
//! water line, the pile force direction (FOS), and the Morgenstern-Price
//! closest pair. The V002 non-circular search, the Monte Carlo case and the
//! strength cutoff with reliability are in deferred_optimise_unit.rs.
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::reinforcement::pile_force_direction;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::Slope;
use cslope_engine::types::{Material, MaterialParams, Pile, SlopeDefinition, WaterTableInput};
use model_core_support::close;
use serde_json::{json, Value};
use solvers_support::run_verification;

fn case(id: &str) -> Value {
    let cases: Vec<Value> = common::verification_cases();
    cases.into_iter().find(|c| c["id"] == id).unwrap()
}

fn with(m: &Value, extra: Value) -> Value {
    let mut m = m.clone();
    for (k, v) in extra.as_object().unwrap() {
        m[k] = v.clone();
    }
    m
}

fn canonical_json(d: &Value) -> Value {
    let d: SlopeDefinition = serde_json::from_value(d.clone()).unwrap();
    serde_json::to_value(to_canonical_slope_definition(&d, None).unwrap()).unwrap()
}

#[test]
fn interslice_data_points_of_a_right_to_left_model_are_given_with_x_0_at_the_left_end() {
    // V018 (Prandtl mechanism) slides right to left. An asymmetric f(x)
    // must give the same FOS as on the explicitly mirrored left-to-right
    // model with the mirrored function.
    let vp25 = case("V018")["definition"].clone();
    let points = json!([[0, 0], [0.3, 1], [1, 0.2]]);
    let mirrored = json!([[1, 0], [0.7, 1], [0, 0.2]]);
    let o = |p: &Value| json!({ "intersliceFunction": "data-point-specified", "intersliceDataPoints": p });
    let rtl = run_verification(vp25.clone(), "Morgenstern-Price", o(&points))
        .0
        .unwrap();
    let ltr_def = with(&canonical_json(&vp25), json!({ "orientation": "ltr" }));
    let ltr = run_verification(ltr_def.clone(), "Morgenstern-Price", o(&mirrored))
        .0
        .unwrap();
    close(rtl, ltr, 6);
    // Unmirrored the asymmetric function gives a clearly different FOS.
    let wrong = run_verification(ltr_def, "Morgenstern-Price", o(&points))
        .0
        .unwrap();
    assert!((wrong - rtl).abs() > 0.005);
}

#[test]
fn the_lambda_iteration_does_not_take_an_unconverged_force_solution_for_the_intersection() {
    // Non-circular surface the optimisation reached on V002 (canonical
    // coordinates). Fm(λ) and Ff(λ) run parallel; beyond λ ≈ −0.95 the force
    // iteration no longer converges and its value dropped onto Fm, which was
    // taken for the Spencer solution (0.326 against Bishop 0.447).
    let surface = json!([
        [39.28, 35],
        [43.44, 30.84],
        [47.43, 26.74],
        [49.63, 24.77],
        [51.83, 22.84],
        [54.03, 20.89],
        [56.23, 18.93],
        [58.43, 17.2],
        [60.63, 15.64],
        [62.83, 14.4],
        [65.03, 13.58],
        [67.23, 13.13],
        [69.43, 13.11],
        [71.62, 13.52],
        [73.82, 14.36],
        [75.36, 15.02],
        [76.9, 15.73]
    ]);
    let d = with(
        &canonical_json(&case("V002")["definition"]),
        json!({ "orientation": "ltr", "customSurfaces": [{ "points": surface }], "customPlanesOnly": true }),
    );
    let spencer = run_verification(
        d.clone(),
        "Morgenstern-Price",
        json!({ "intersliceFunction": "constant", "slices": 25 }),
    )
    .0
    .unwrap();
    let bishop = run_verification(d, "Bishop", json!({ "slices": 25 }))
        .0
        .unwrap();
    close(bishop, 0.4465, 3);
    assert!(spencer > 0.4);
}

#[test]
fn extends_a_line_given_before_the_external_boundary_to_the_model_edges_slices_beyond_have_pore_pressure(
) {
    let mut slope = Slope::new();
    slope.add_material(
        Material::new(MaterialParams {
            name: Some("M".into()),
            unit_weight: Some(20.0),
            friction_angle: Some(30.0),
            cohesion: Some(5.0),
            ..Default::default()
        })
        .unwrap(),
    );
    // Short line, entered before the boundary (nothing to extend it to yet).
    slope
        .set_water_table(&WaterTableInput::Custom {
            coordinates: vec![[15.0, -3.0], [25.0, -3.0]],
            follow_boundary: Some(false),
        })
        .unwrap();
    slope
        .set_water_table_by_id("own", &[[15.0, -4.0], [25.0, -4.0]], false)
        .unwrap();
    slope
        .set_external_boundary(&[
            [0.0, -20.0],
            [0.0, 0.0],
            [20.0, 0.0],
            [40.0, -10.0],
            [60.0, -10.0],
            [60.0, -20.0],
        ])
        .unwrap();
    let w = slope.water_rl_xy().unwrap();
    assert_eq!(
        (w.x.clone(), w.y.clone()),
        (vec![0.0, 15.0, 25.0, 60.0], vec![-3.0; 4])
    );
    // Slices beyond the ends of the given line have pore pressure.
    let slices = get_slices(
        &slope,
        5.0,
        50.0,
        30.0,
        30.0,
        25.0f64.hypot(30.0),
        None,
        &mut SliceScratch::new(),
    )
    .unwrap();
    let beyond: Vec<_> = slices
        .iter()
        .filter(|s| s.x > 30.0 && s.y_bottom < -3.0)
        .collect();
    assert!(!beyond.is_empty());
    assert!(beyond.iter().all(|s| s.u > 0.0));
}

// ── pile force direction ──────────────────────────────────────────

/// The V095c input as it was when the commercial cross-check was made.
fn pile_run(extra: Value) -> cslope_engine::error::Result<f64> {
    let c = case("V095c");
    let pile = with(
        &json!({ "x1": 9, "y1": 4, "x2": 9, "y2": -2, "spacing": 1, "diameter": 0.3, "shearCapacity": 10.7, "momentCapacity": 1000000 }),
        extra,
    );
    let d = with(
        &c["definition"],
        json!({ "piles": [pile], "customSearchPlanes": [{ "cx": 2.674, "cy": 7.573, "radius": 8.031 }], "customPlanesOnly": true }),
    );
    let def: SlopeDefinition = serde_json::from_value(d).unwrap();
    let canonical = to_canonical_slope_definition(&def, None)?;
    let mut slope = cslope_engine::model::build_slope::build_slope(&canonical)?;
    // (the fixture's options are merged with the check's method: Bishop here, as TypeScript's run)
    let mut own = c["checks"][0]["options"].clone();
    own.as_object_mut().unwrap().remove("method");
    let o = solvers_support::verification_options("Bishop", own);
    slope.update_analysis_options(&serde_json::from_value(o).unwrap())?;
    let f = cslope_engine::model::solvers::analyse_slope(
        &mut slope,
        &mut cslope_engine::api::ctx::RunCtx::default(),
    )?;
    Ok(f.unwrap())
}

#[test]
fn a_pile_keeps_the_given_angle_when_no_direction_is_set() {
    close(
        pile_run(json!({})).unwrap(),
        pile_run(json!({ "direction": "angle" })).unwrap(),
        9,
    );
    assert!(
        (pile_run(json!({ "angle": 10 })).unwrap() - pile_run(json!({})).unwrap()).abs() >= 0.0005
    );
}

#[test]
fn a_pile_acts_along_the_slip_surface_with_direction_tangent() {
    // A commercial program on cSlope's V095c input, pile passive and tangential,
    // the force at the slip surface: 1.1989. cSlope gives 1.1994 since the
    // slice base of a circle is the chord (2026-11-10), 0.04 % above it.
    close(
        pile_run(
            json!({ "application": "passive", "direction": "tangent", "location": "slip-surface" }),
        )
        .unwrap(),
        1.1994,
        3,
    );
}

#[test]
fn a_pile_force_is_horizontal_perpendicular_to_a_vertical_pile() {
    close(
        pile_run(json!({ "direction": "perpendicular" })).unwrap(),
        pile_run(json!({})).unwrap(),
        9,
    );
    close(
        pile_run(json!({ "direction": "perpendicular", "application": "passive" })).unwrap(),
        pile_run(json!({ "application": "passive" })).unwrap(),
        9,
    );
}

#[test]
fn a_pile_force_is_normal_to_an_inclined_pile_against_the_movement() {
    let pile = |extra: Value| -> Pile {
        serde_json::from_value(with(
            &json!({ "x1": 0, "y1": 0, "x2": 3, "y2": -4, "force": 10 }),
            extra,
        ))
        .unwrap()
    };
    // Movement down the slip surface at 30°, towards +x.
    let (tx, ty) = (
        (std::f64::consts::PI / 6.0).cos(),
        -(std::f64::consts::PI / 6.0).sin(),
    );
    let [ux, uy] = pile_force_direction(&pile(json!({ "direction": "perpendicular" })), tx, ty);
    close(ux * 3.0 + uy * -4.0, 0.0, 12);
    close(ux.hypot(uy), 1.0, 12);
    assert!(ux * tx + uy * ty < 0.0);
    assert_eq!(
        pile_force_direction(&pile(json!({ "direction": "tangent" })), tx, ty),
        [-tx, -ty]
    );
    assert_eq!(
        pile_force_direction(&pile(json!({ "angle": 0 })), tx, ty),
        [-1.0, 0.0]
    );
}

#[test]
fn a_pile_rejects_an_unknown_direction() {
    let e = pile_run(json!({ "direction": "sideways" })).unwrap_err();
    assert!(e.message.contains("direction"), "{}", e.message);
}

// ── Morgenstern-Price closest pair ────────────────────────────────

fn mp_check(id: &str) -> (Option<f64>, Slope, f64) {
    let c = case(id);
    let k = c["checks"]
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["method"] == "Morgenstern-Price")
        .unwrap()
        .clone();
    let (f, s) = run_verification(
        c["definition"].clone(),
        "Morgenstern-Price",
        k["options"].clone(),
    );
    (f, s, k["published"].as_f64().unwrap())
}

#[test]
fn reports_the_critical_surface_of_v027_as_not_converged_with_its_gap() {
    // V027 (φ = 0 circle): Fm hardly depends on λ and Ff never reaches it,
    // so no λ gives Fm = Ff. The closest pair is kept for its moment-
    // equilibrium factor but must not be reported as converged.
    let (fos, slope, published) = mp_check("V027");
    let fos = fos.unwrap();
    assert!((fos - published).abs() < 0.015);
    let crit = slope.search().iter().find(|p| p.fos.is_some()).unwrap();
    assert_eq!(crit.fos, Some(fos));
    assert_eq!(crit.converged, Some(false));
    assert_eq!(crit.closest_pair, Some(true));
    let gap = crit.equilibrium_gap.unwrap();
    assert!(gap > slope.tolerance() && gap <= 0.02);
    // A crossing still reports converged without a gap.
    let (_, s1, _) = mp_check("V001");
    let c1 = s1.search().iter().find(|p| p.fos.is_some()).unwrap();
    assert_eq!(c1.converged, Some(true));
    assert_eq!(c1.closest_pair, None);
    assert_eq!(c1.equilibrium_gap, None);
}
