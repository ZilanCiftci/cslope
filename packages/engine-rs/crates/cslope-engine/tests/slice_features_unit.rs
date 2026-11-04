//! Ports of packages/engine/src/model/ru.test.ts (pore pressure ratio),
//! spatial-unit-weight.test.ts (the γ of a spatial model's data points)
//! and suction-strength.test.ts (φb at the slice bases and in the factor of
//! safety; its finite element case waits for fem/model, Phase 5).
//! (water-table.test.ts is ported with the model core: model_core_slope.rs,
//! geometry_ops.rs.)
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::{analyse_bishop, analyse_slope};
use cslope_engine::types::{
    resolve_unit_weight, validate_material_model, Slice, WATER_UNIT_WEIGHT,
};
use model_core_support::{close, def, layered, mc, model};
use serde_json::{json, Value};
use solvers_support::run_verification;

fn with(m: Value, extra: Value) -> Value {
    let mut m = m;
    for (k, v) in extra.as_object().unwrap() {
        m[k] = v.clone();
    }
    m
}

// ── ru.test.ts ────────────────────────────────────────────────────

fn ru_run(model: Value, extra: Value) -> (Option<f64>, Slope) {
    let mut d = layered(
        &[[0.0, 10.0], [10.0, 10.0], [25.0, 0.0], [45.0, 0.0]],
        -10.0,
        &[("S", None, model)],
        extra,
    );
    d["customSearchPlanes"] = json!([{ "cx": 20, "cy": 20, "radius": 21 }]);
    d["customPlanesOnly"] = json!(true);
    run_verification(d, "Bishop", json!({ "slices": 30 }))
}

fn first_slices(s: &Slope) -> Vec<Slice> {
    s.search()[0].slices.clone().unwrap()
}

#[test]
fn ru_adds_ru_times_the_soil_weight_per_width_to_the_pore_pressure() {
    let (f_dry, dry) = ru_run(mc(5.0, 30.0, 19.0), json!({}));
    let dry = first_slices(&dry);
    let (f_wet, wet) = ru_run(with(mc(5.0, 30.0, 19.0), json!({ "ru": 0.3 })), json!({}));
    for (i, s) in first_slices(&wet).iter().enumerate() {
        close(s.u - dry[i].u, (0.3 * s.weight) / s.width, 9);
    }
    assert!(f_wet.unwrap() < f_dry.unwrap());
}

#[test]
fn ru_adds_to_the_pore_pressure_of_the_materials_water_line() {
    let water = json!({ "waterTable": { "mode": "custom", "value": [[0, 4], [45, 4]] } });
    let line = first_slices(&ru_run(mc(5.0, 30.0, 19.0), water.clone()).1);
    let both = first_slices(&ru_run(with(mc(5.0, 30.0, 19.0), json!({ "ru": 0.2 })), water).1);
    for (i, s) in both.iter().enumerate() {
        close(s.u - line[i].u, (0.2 * s.weight) / s.width, 9);
    }
}

#[test]
fn ru_follows_f_equal_m_minus_n_ru_for_a_cohesionless_slope() {
    let f = |ru: f64| {
        let m = if ru != 0.0 {
            with(mc(0.001, 35.0, 20.0), json!({ "ru": ru }))
        } else {
            mc(0.001, 35.0, 20.0)
        };
        ru_run(m, json!({})).0.unwrap()
    };
    let (f0, f1, f2) = (f(0.0), f(0.2), f(0.4));
    // equal steps in ru give (nearly) equal steps in F
    assert!(((f0 - f1) - (f1 - f2)).abs() / (f0 - f2) < 0.05);
}

#[test]
fn ru_gives_no_excess_pore_pressure_under_a_load_above_the_water() {
    // the water below every base: the pore pressure is rᵤ's alone
    let load = |excess: bool| {
        let mut u = json!({ "magnitude": 50, "x1": 0, "x2": 10 });
        if excess {
            u["excessPorePressure"] = json!([{ "material": "S", "ratio": 0.9 }]);
        }
        json!({ "waterTable": { "mode": "custom", "value": [[0, -5], [45, -5]] }, "udls": [u] })
    };
    let m = with(mc(5.0, 30.0, 19.0), json!({ "ru": 0.3 }));
    let (fd, drained) = ru_run(m.clone(), load(false));
    let (fl, loaded) = ru_run(m, load(true));
    let d = first_slices(&drained);
    for (i, s) in first_slices(&loaded).iter().enumerate() {
        assert!(s.u > 0.0);
        assert_eq!(s.u, d[i].u);
    }
    assert_eq!(fl, fd);
}

#[test]
fn ru_must_be_at_least_0_and_below_1() {
    let v =
        |ru: f64| validate_material_model(&model(with(mc(5.0, 30.0, 19.0), json!({ "ru": ru }))));
    assert_eq!(
        v(1.0),
        vec!["The pore pressure ratio rᵤ must be at least 0 and below 1.".to_string()]
    );
    assert_eq!(v(-0.1).len(), 1);
    assert_eq!(v(0.5).len(), 0);
}

// ── spatial-unit-weight.test.ts ───────────────────────────────────

const COORDS: [[f64; 2]; 6] = [
    [0.0, -15.0],
    [0.0, 0.0],
    [20.0, 0.0],
    [40.0, -10.0],
    [60.0, -10.0],
    [60.0, -15.0],
];

fn bishop_on_circle(d: Value) -> (f64, f64) {
    let (cx, cy, r) = (32.63, 17.7, 30.33);
    let slope = build_slope(&def(d)).unwrap();
    let pts = slope.get_circle_external_intersection(cx, cy, r).unwrap();
    let mut slices = get_slices(
        &slope,
        pts[0][0],
        pts[1][0],
        cx,
        cy,
        r,
        None,
        &mut SliceScratch::new(),
    )
    .unwrap();
    let weight = slices.iter().fold(0.0, |sum, s| sum + s.weight);
    (analyse_bishop(&slope, &mut slices, None).0.unwrap(), weight)
}

fn spatial(gamma: f64) -> Value {
    let points = [[0.0, 0.0], [60.0, -15.0]];
    let m = json!({
        "kind": "spatial-mohr-coulomb", "unitWeight": 25,
        "dataPoints": points.iter().map(|[x, y]| json!([x, y, 5, 30, gamma])).collect::<Vec<_>>(),
    });
    json!({ "coordinates": COORDS, "materials": [{ "name": "S", "unitWeight": 25, "frictionAngle": 30, "cohesion": 5, "model": m }] })
}

#[test]
fn spatial_uses_the_gamma_of_the_data_points_not_the_material_gamma() {
    let (mc_f, mc_w) = bishop_on_circle(json!({
        "coordinates": COORDS, "materials": [{ "name": "A", "unitWeight": 18, "frictionAngle": 30, "cohesion": 5 }],
    }));
    let (sp_f, sp_w) = bishop_on_circle(spatial(18.0));
    close(sp_w, mc_w, 6);
    close(sp_f, mc_f, 6);
}

#[test]
fn spatial_falls_back_to_the_material_gamma_when_the_data_points_give_none() {
    let m = model(spatial(0.0)["materials"][0]["model"].clone());
    assert_eq!(resolve_unit_weight(&m, 25.0, 30.0, -5.0), 25.0);
}

#[test]
fn spatial_interpolates_gamma_between_data_points() {
    let m = json!({
        "kind": "spatial-mohr-coulomb", "unitWeight": 20,
        "dataPoints": [[0, 0, 5, 30, 16], [10, 0, 5, 30, 20]], "interpolation": "idw",
    });
    close(
        resolve_unit_weight(&model(m.clone()), 20.0, 5.0, 0.0),
        18.0,
        9,
    );
    assert_eq!(resolve_unit_weight(&model(m.clone()), 20.0, 0.0, 0.0), 16.0);
    assert_eq!(
        resolve_unit_weight(
            &model(with(m, json!({ "interpolation": "nearest" }))),
            20.0,
            9.0,
            0.0
        ),
        20.0
    );
    assert_eq!(
        resolve_unit_weight(
            &model(
                json!({ "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 1, "frictionAngle": 30 })
            ),
            20.0,
            5.0,
            0.0
        ),
        20.0
    );
}

// ── suction-strength.test.ts ──────────────────────────────────────

fn tan(deg: f64) -> f64 {
    (deg * std::f64::consts::PI / 180.0).tan()
}

/// A 10 m high slope with a water line 15 m below the crest (below the toe).
fn suction_def(m: Value, water: Option<Value>) -> Value {
    let mut d = json!({
        "coordinates": [[0, -25], [0, 0], [20, 0], [40, -10], [60, -10], [60, -25]],
        "materials": [{ "name": "Soil", "model": with(json!({ "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 5, "frictionAngle": 28 }), m) }],
    });
    if let Some(w) = water {
        d["waterTable"] = json!({ "mode": "custom", "value": w });
    }
    d
}

fn low_water() -> Option<Value> {
    Some(json!([[0, -15], [60, -15]]))
}

const CIRCLE: (f64, f64, f64) = (32.0, 14.0, 25.0);

fn suction_slices(slope: &Slope) -> Vec<Slice> {
    let (cx, cy, r) = CIRCLE;
    let pts = slope.get_circle_external_intersection(cx, cy, r).unwrap();
    get_slices(
        slope,
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

fn slices_of(d: Value) -> Vec<Slice> {
    suction_slices(&build_slope(&def(d)).unwrap())
}

fn fos_on_circle(d: Value) -> f64 {
    let (cx, cy, r) = CIRCLE;
    let mut d = d;
    d["customSearchPlanes"] = json!([{ "cx": cx, "cy": cy, "radius": r }]);
    d["customPlanesOnly"] = json!(true);
    let mut slope = build_slope(&def(d)).unwrap();
    slope
        .update_analysis_options(
            &serde_json::from_value(json!({ "method": "Morgenstern-Price" })).unwrap(),
        )
        .unwrap();
    analyse_slope(&mut slope, &mut RunCtx::default())
        .unwrap()
        .unwrap()
}

#[test]
fn suction_is_gamma_w_times_the_height_above_the_line_with_u_0_there() {
    let slices = slices_of(suction_def(json!({ "phiB": 15 }), low_water()));
    assert!(slices.len() > 10);
    for s in &slices {
        assert_eq!(s.u, 0.0);
        let suction = WATER_UNIT_WEIGHT * (s.y_bottom + 15.0);
        close(s.suction.unwrap(), suction, 9);
        close(s.suction_strength.unwrap(), suction * tan(15.0), 9);
        close(s.cohesion, 5.0 + suction * tan(15.0), 9);
    }
}

#[test]
fn suction_is_capped_by_the_maximum_suction() {
    for s in slices_of(suction_def(
        json!({ "phiB": 15, "maxSuction": 40 }),
        low_water(),
    )) {
        close(
            s.suction_strength.unwrap(),
            (40.0f64).min(WATER_UNIT_WEIGHT * (s.y_bottom + 15.0)) * tan(15.0),
            9,
        );
    }
}

#[test]
fn suction_applies_above_the_line_only_below_it_the_pore_pressure_is_as_before() {
    let high = Some(json!([[0, -6], [60, -6]]));
    let with_phi_b = slices_of(suction_def(json!({ "phiB": 20 }), high.clone()));
    let without = slices_of(suction_def(json!({}), high));
    assert_eq!(with_phi_b.len(), without.len());
    let (mut above, mut below) = (0, 0);
    for (i, s) in with_phi_b.iter().enumerate() {
        assert_eq!(s.u, without[i].u);
        if s.y_bottom > -6.0 {
            above += 1;
            close(
                s.cohesion,
                5.0 + WATER_UNIT_WEIGHT * (s.y_bottom + 6.0) * tan(20.0),
                9,
            );
        } else {
            below += 1;
            assert!(s.suction.is_none());
            assert_eq!(s.cohesion, without[i].cohesion);
        }
    }
    assert!(above > 0 && below > 0);
}

#[test]
fn suction_takes_the_head_factor_of_the_phreatic_correction() {
    let mut slope = build_slope(&def(suction_def(
        json!({ "phiB": 15 }),
        Some(json!([[0, -12], [60, -18]])),
    )))
    .unwrap();
    slope
        .update_analysis_options(
            &serde_json::from_value(json!({ "porePressureHead": "phreatic-correction" })).unwrap(),
        )
        .unwrap();
    let cos2 = (6.0f64 / 60.0).atan().cos().powi(2);
    for s in suction_slices(&slope) {
        let yw = -12.0 - (6.0 * s.x) / 60.0;
        close(
            s.suction.unwrap(),
            WATER_UNIT_WEIGHT * (s.y_bottom - yw) * cos2,
            9,
        );
    }
}

#[test]
fn suction_needs_a_water_line() {
    for s in slices_of(suction_def(json!({ "phiB": 15 }), None)) {
        assert!(s.suction.is_none());
        assert_eq!(s.cohesion, 5.0);
    }
}

#[test]
fn suction_takes_gamma_c_with_partial_factors() {
    let mut slope = build_slope(&def(suction_def(json!({ "phiB": 15 }), low_water()))).unwrap();
    slope
        .update_analysis_options(&AnalysisOptionsPatch {
            partial_factors: Some(Some(
                serde_json::from_value(
                    json!({ "cu": 1.5, "cohesion": 1.3, "tanPhi": 1.3, "variableLoad": 1.3 }),
                )
                .unwrap(),
            )),
            ..Default::default()
        })
        .unwrap();
    for s in suction_slices(&slope) {
        let ss = WATER_UNIT_WEIGHT * (s.y_bottom + 15.0) * tan(15.0);
        close(s.cohesion, (5.0 + ss) / 1.3, 9);
        close(s.suction_strength.unwrap(), ss / 1.3, 9);
    }
}

#[test]
fn factor_unchanged_with_phi_b_0() {
    let f = fos_on_circle(suction_def(json!({}), low_water()));
    assert_eq!(
        fos_on_circle(suction_def(json!({ "phiB": 0 }), low_water())),
        f
    );
    assert_eq!(
        fos_on_circle(suction_def(
            json!({ "phiB": 0, "maxSuction": 10 }),
            low_water()
        )),
        f
    );
}

#[test]
fn factor_rises_with_phi_b_above_the_water_line_less_with_a_cap() {
    let f0 = fos_on_circle(suction_def(json!({}), low_water()));
    let f10 = fos_on_circle(suction_def(json!({ "phiB": 10 }), low_water()));
    let f20 = fos_on_circle(suction_def(json!({ "phiB": 20 }), low_water()));
    let capped = fos_on_circle(suction_def(
        json!({ "phiB": 20, "maxSuction": 30 }),
        low_water(),
    ));
    assert!(f10 > f0 * 1.05);
    assert!(f20 > f10);
    assert!(capped > f0 && capped < f20);
}

#[test]
fn factor_rises_with_phi_b_for_the_critical_surface_of_a_search() {
    let search = |phi_b: Option<f64>| {
        let m = match phi_b {
            Some(p) => json!({ "phiB": p }),
            None => json!({}),
        };
        let mut slope = build_slope(&def(suction_def(m, low_water()))).unwrap();
        let f = analyse_slope(&mut slope, &mut RunCtx::default())
            .unwrap()
            .unwrap();
        (f, slope.search()[0].slices.clone().unwrap_or_default())
    };
    let (without, _) = search(None);
    let (with_f, slices) = search(Some(15.0));
    // the critical surface lies above the line (15 m below the crest)
    assert!(!slices.is_empty());
    for s in &slices {
        assert!(s.y_bottom > -15.0);
    }
    assert!(with_f > without * 1.05);
}
