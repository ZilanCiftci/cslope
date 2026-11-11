//! The unit weight of water γw as a model setting (the `waterUnitWeight`
//! analysis option): absent it is `WATER_UNIT_WEIGHT` (9.807); a model's
//! own value scales the pore pressure, the free water, the water in a
//! tension crack, the waternet, the effective stress of reinforcement and
//! the finite element pore pressure; a value that is not a positive number
//! is rejected.
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;

use cslope_engine::fem::model::{build_fe_model, FeModelOptions};
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::reinforcement::effective_vertical_stress;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::waternet::{waternet_pore_pressure, HeadLine, Waternet};
use cslope_engine::types::validate_definition::{validate, Severity};
use cslope_engine::types::{default_analysis_options, Slice, SlopeDefinition, WATER_UNIT_WEIGHT};
use model_core_support::close;
use serde_json::{json, Value};

fn slope_of(d: Value) -> Slope {
    let d: SlopeDefinition = serde_json::from_value(d).unwrap();
    build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap()
}

/// Built as given (no canonical transform), so that y is the model's.
fn raw_slope(d: Value) -> Slope {
    build_slope(&serde_json::from_value::<SlopeDefinition>(d).unwrap()).unwrap()
}

fn with_gw(s: &mut Slope, gw: f64) {
    s.update_analysis_options(&AnalysisOptionsPatch {
        water_unit_weight: Some(gw),
        ..Default::default()
    })
    .unwrap();
}

/// Two layers, a water line at y = −2 and a pond 2 m deep at the toe.
fn base() -> Value {
    json!({
        "coordinates": [[0, -20], [0, 0], [20, 0], [40, -10], [60, -10], [60, -20]],
        "materials": [
            { "name": "Upper", "unitWeight": 18, "frictionAngle": 28, "cohesion": 5 },
            { "name": "Lower", "unitWeight": 20, "frictionAngle": 32, "cohesion": 2 },
        ],
        "materialBoundaries": [{ "coordinates": [[0, -6], [60, -6]] }],
        "regionAssignments": [{ "point": [5, -2], "materialName": "Upper" }, { "point": [5, -15], "materialName": "Lower" }],
        "waterTable": { "mode": "custom", "value": [[0, -2], [60, -2]] },
    })
}

fn slices(s: &Slope) -> Vec<Slice> {
    let (cx, cy, r) = (30.0, 12.0, 30.0);
    let pts = s.get_circle_external_intersection(cx, cy, r).unwrap();
    get_slices(
        s,
        pts[0][0],
        pts[1][0],
        cx,
        cy,
        r,
        None,
        &mut SliceScratch::new(),
    )
    .unwrap()
}

#[test]
fn absent_it_is_9_807() {
    assert_eq!(WATER_UNIT_WEIGHT, 9.807);
    assert_eq!(default_analysis_options().water_unit_weight, None);
    assert_eq!(Slope::new().water_unit_weight(), 9.807);
    let mut s = raw_slope(base());
    s.update_analysis_options(&AnalysisOptionsPatch::default())
        .unwrap();
    assert_eq!(s.water_unit_weight(), 9.807);
    // the pore pressure of a slice is γw·h with the default (where the
    // line is below the ground: the line is clipped to the ground beyond)
    let behind: Vec<Slice> = slices(&s)
        .into_iter()
        .filter(|sl| sl.x_right <= 20.0)
        .collect();
    assert!(!behind.is_empty());
    for sl in behind {
        close(sl.u, (-2.0 - sl.y_bottom).max(0.0) * 9.807, 9);
    }
}

#[test]
fn a_models_value_scales_the_pore_pressure_of_each_slice() {
    let mut s = raw_slope(base());
    with_gw(&mut s, 10.0);
    assert_eq!(s.water_unit_weight(), 10.0);
    let wet: Vec<Slice> = slices(&s)
        .into_iter()
        .filter(|sl| sl.x_right <= 20.0 && sl.y_bottom < -2.0)
        .collect();
    assert!(!wet.is_empty());
    for sl in &wet {
        // U = γw·h on the slice base
        close(sl.u, (-2.0 - sl.y_bottom) * 10.0, 9);
    }
}

#[test]
fn a_models_value_scales_the_free_water_on_the_ground() {
    let mut d = base();
    d["waterTable"] =
        json!({ "mode": "custom", "value": [[0, -8], [60, -8]], "followBoundary": false });
    let load = |gw: Option<f64>| -> f64 {
        let mut s = slope_of(d.clone());
        if let Some(gw) = gw {
            with_gw(&mut s, gw);
        }
        slices(&s)
            .iter()
            .map(|sl| sl.water_load.unwrap_or(0.0))
            .sum()
    };
    let (d0, d10) = (load(None), load(Some(10.0)));
    assert!(d0 > 0.0);
    close(d10 / d0, 10.0 / 9.807, 12);
}

#[test]
fn a_models_value_scales_the_water_in_a_tension_crack() {
    let crack = |gw: f64| -> f64 {
        let mut s = slope_of(base());
        s.update_analysis_options(&AnalysisOptionsPatch {
            tension_crack_depth: Some(2.0),
            tension_crack_water: Some(1.0),
            water_unit_weight: Some(gw),
            ..Default::default()
        })
        .unwrap();
        let sl = slices(&s);
        sl[0].h_force.unwrap_or(0.0)
    };
    let (a, b) = (crack(9.807), crack(19.614));
    close(a, 0.5 * 9.807 * 4.0, 9);
    close(b, 2.0 * a, 9);
}

#[test]
fn a_models_value_scales_the_waternet_and_the_effective_stress() {
    let wn = Waternet::new(
        vec![HeadLine {
            id: "h".into(),
            points: vec![[0.0, 10.0], [30.0, 10.0]],
        }],
        Vec::new(),
        Some("h".into()),
    );
    close(
        waternet_pore_pressure(&wn, 10.0, 4.0, 9.807),
        6.0 * 9.807,
        12,
    );
    close(waternet_pore_pressure(&wn, 10.0, 4.0, 10.0), 60.0, 12);

    // σ'v = σv − u below the water line (y = −2) of the upper soil
    let mut s = slope_of(base());
    let dry = 18.0 * 4.0;
    close(
        effective_vertical_stress(&s, 5.0, -4.0),
        dry - 2.0 * 9.807,
        9,
    );
    with_gw(&mut s, 10.0);
    close(effective_vertical_stress(&s, 5.0, -4.0), dry - 20.0, 9);
}

#[test]
fn a_models_value_scales_the_finite_element_pore_pressure() {
    let d = json!({
        "coordinates": [[0, 0], [0, 10], [30, 10], [30, 0]],
        "materials": [{ "name": "Soil", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 10, "frictionAngle": 30 } }],
        "waterTable": { "mode": "custom", "value": [[0, 6], [30, 6]], "followBoundary": false },
    });
    let o = FeModelOptions {
        element_size: Some(1.5),
        ..Default::default()
    };
    let mut s = slope_of(d);
    let m0 = build_fe_model(&s, &o).unwrap();
    with_gw(&mut s, 10.0);
    let m1 = build_fe_model(&s, &o).unwrap();
    let mut wet = 0;
    for i in 0..m0.gp_u.len() {
        close(m0.gp_u[i], (6.0 - m0.gp_y[i]).max(0.0) * 9.807, 9);
        close(m1.gp_u[i], (6.0 - m1.gp_y[i]).max(0.0) * 10.0, 9);
        if m1.gp_u[i] > 0.0 {
            wet += 1;
        }
    }
    assert!(wet > 0);
}

#[test]
fn an_earlier_stage_takes_the_models_value() {
    let mut d = base();
    d["earlierStage"] = base();
    let mut s = slope_of(d);
    assert_eq!(s.earlier_stage().unwrap().water_unit_weight(), 9.807);
    with_gw(&mut s, 9.82);
    assert_eq!(s.earlier_stage().unwrap().water_unit_weight(), 9.82);
}

#[test]
fn rapid_drawdown_before_takes_the_models_value() {
    let mut d = base();
    d["rapidDrawdown"] = json!({ "waterBefore": [[0, 0], [60, 0]] });
    let mut s = slope_of(d);
    with_gw(&mut s, 9.82);
    assert_eq!(s.drawdown_before().unwrap().water_unit_weight(), 9.82);
}

#[test]
fn a_value_that_is_not_a_positive_number_is_rejected() {
    for bad in [0.0, -9.807, f64::NAN, f64::INFINITY] {
        let mut s = slope_of(base());
        let e = s
            .update_analysis_options(&AnalysisOptionsPatch {
                water_unit_weight: Some(bad),
                ..Default::default()
            })
            .unwrap_err();
        assert!(e.message.contains("waterUnitWeight"), "{}", e.message);
        assert_eq!(s.water_unit_weight(), 9.807);
    }
    // read from JSON: a value that is not a number is an error too
    let mut s = slope_of(base());
    let patch: AnalysisOptionsPatch =
        serde_json::from_value(json!({ "waterUnitWeight": "x" })).unwrap();
    assert!(s.update_analysis_options(&patch).is_err());
}

#[test]
fn validation_warns_outside_9_to_11_and_reports_an_invalid_value() {
    let def = base();
    let codes = |o: Value| -> Vec<(String, String, Severity)> {
        validate(&def, Some(&o))
            .into_iter()
            .map(|i| (i.path, i.code, i.severity))
            .collect()
    };
    let none = codes(json!({ "waterUnitWeight": 9.82 }));
    assert!(
        none.iter()
            .all(|(_, c, _)| c != "unusual-water-unit-weight"),
        "{none:?}"
    );
    let warned = codes(json!({ "waterUnitWeight": 98.07 }));
    assert!(warned.contains(&(
        "/options/waterUnitWeight".into(),
        "unusual-water-unit-weight".into(),
        Severity::Warning
    )));
    let bad = codes(json!({ "waterUnitWeight": 0 }));
    assert!(
        bad.iter()
            .any(|(_, c, s)| c == "engine-error" && *s == Severity::Error),
        "{bad:?}"
    );
}
