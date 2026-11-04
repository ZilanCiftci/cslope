//! Ports of packages/engine/src/model/solvers-guards.test.ts (surfaces that
//! would slide the other way, through rock, too small), crack-angle.test.ts
//! (a tension crack at a limiting base inclination), seismic.test.ts
//! (pseudostatic load, inclined line loads) and normal-load.test.ts
//! (distributed loads normal to the ground; its SGI 3D case is in
//! deferred_optimise_unit.rs).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slices::{find_angle_crack_x, get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::{
    analyse_bishop, analyse_janbu, analyse_morgenstern_price, analyse_ordinary, analyse_slope,
    slice_driving_moment, slice_vertical_load,
};
use cslope_engine::types::{
    default_analysis_options, AnalysisMethod, Slice, SlopeDefinition, WATER_UNIT_WEIGHT,
};
use model_core_support::{close, def, layered, mc};
use serde_json::{json, Value};
use solvers_support::run_verification;
use std::f64::consts::PI;

fn patch(v: Value) -> AnalysisOptionsPatch {
    serde_json::from_value(v).expect("analysis options")
}

fn analyse(s: &mut Slope) -> Option<f64> {
    analyse_slope(s, &mut RunCtx::default()).unwrap()
}

/// buildSlope(toCanonicalSlopeDefinition(def)), then
/// `{ ...DEFAULT_ANALYSIS_OPTIONS, ...options }`, then analyseSlope.
fn run_default(d: Value, options: Value) -> (Option<f64>, Slope) {
    let d: SlopeDefinition = serde_json::from_value(d).unwrap();
    let mut s = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    s.update_analysis_options(&AnalysisOptionsPatch::from(&default_analysis_options()))
        .unwrap();
    s.update_analysis_options(&patch(options)).unwrap();
    let f = analyse(&mut s);
    (f, s)
}

// ── solvers-guards.test.ts ────────────────────────────────────────

const LTR: [[f64; 2]; 6] = [
    [0.0, -10.0],
    [0.0, 10.0],
    [10.0, 10.0],
    [25.0, 0.0],
    [40.0, 0.0],
    [40.0, -10.0],
];

fn rtl() -> Vec<[f64; 2]> {
    LTR.iter().map(|&[x, y]| [40.0 - x, y]).collect()
}

fn soil() -> Value {
    json!({ "name": "S", "unitWeight": 19, "cohesion": 10, "frictionAngle": 25 })
}

fn slices_of(d: Value, cx: f64, cy: f64, r: f64) -> (Slope, Vec<Slice>) {
    let mut slope = build_slope(&def(d)).unwrap();
    slope
        .update_analysis_options(&patch(json!({ "slices": 30 })))
        .unwrap();
    let ints = slope.get_circle_external_intersection(cx, cy, r).unwrap();
    let sl = get_slices(
        &slope,
        ints[0][0],
        ints[ints.len() - 1][0],
        cx,
        cy,
        r,
        None,
        &mut SliceScratch::new(),
    )
    .unwrap();
    (slope, sl)
}

#[test]
fn a_surface_that_cannot_slide_in_the_analysed_direction_has_no_fos_by_any_method() {
    // A right-to-left slope analysed as if it slid to +x.
    let (slope, slices) = slices_of(
        json!({ "orientation": "ltr", "coordinates": rtl(), "materials": [soil()] }),
        18.0,
        18.0,
        18.5,
    );
    assert!(slices.len() > 5);
    assert_eq!(analyse_ordinary(&slope, &slices), None);
    assert_eq!(
        analyse_bishop(&slope, &mut slices.clone(), None),
        (None, None, None, true)
    );
    assert_eq!(
        analyse_janbu(&slope, &mut slices.clone(), None),
        (None, None, None, true)
    );
    assert_eq!(
        analyse_morgenstern_price(&slope, &mut slices.clone())
            .unwrap()
            .fos,
        None
    );
    let total = slices.iter().fold(0.0, |s, q| s + slice_driving_moment(q));
    assert!(total < 0.0);
}

#[test]
fn the_search_skips_a_surface_that_cannot_slide() {
    let mut s = build_slope(&def(json!({
        "orientation": "ltr", "coordinates": rtl(), "materials": [soil()],
        "customSearchPlanes": [{ "cx": 18, "cy": 18, "radius": 18.5 }], "customPlanesOnly": true,
    })))
    .unwrap();
    for method in ["Bishop", "Janbu", "Morgenstern-Price"] {
        s.update_analysis_options(&patch(json!({ "method": method })))
            .unwrap();
        assert_eq!(analyse(&mut s), None, "{method}");
    }
}

fn on_circle(mut d: Value) -> Value {
    d["customSearchPlanes"] = json!([{ "cx": 22, "cy": 18, "radius": 18.5 }]);
    d["customPlanesOnly"] = json!(true);
    d
}

fn rock_layered(model: Value) -> Value {
    json!({
        "coordinates": LTR,
        "materials": [soil(), { "name": "R", "unitWeight": 24, "cohesion": 0, "frictionAngle": 0, "model": model }],
        "materialBoundaries": [{ "coordinates": [[0, 1], [40, 1]], "materialName": "R" }],
        "regionAssignments": [{ "point": [1, 5], "materialName": "S" }, { "point": [1, -5], "materialName": "R" }],
    })
}

#[test]
fn through_strong_rock_or_bedrock_without_composite_surfaces_no_fos() {
    for kind in ["high-strength", "impenetrable"] {
        let mut s = build_slope(&def(on_circle(rock_layered(
            json!({ "kind": kind, "unitWeight": 24 }),
        ))))
        .unwrap();
        s.update_analysis_options(&patch(json!({ "compositeSurfaces": false })))
            .unwrap();
        assert_eq!(analyse(&mut s), None, "{kind}");
        assert_eq!(s.search()[0].converged, Some(true));
    }
    // with them (the default) neither: the rock (top at y = 1) reaches the
    // ground at the toe (y = 0), so the surface would run along it to the
    // surface
    let mut s = build_slope(&def(on_circle(rock_layered(
        json!({ "kind": "impenetrable", "unitWeight": 24 }),
    ))))
    .unwrap();
    assert_eq!(analyse(&mut s), None);
}

#[test]
fn shallower_than_the_minimum_depth_or_smaller_than_the_minimum_area_no_fos() {
    let mut s = build_slope(&def(on_circle(
        json!({ "coordinates": LTR, "materials": [soil()] }),
    )))
    .unwrap();
    assert!(analyse(&mut s).is_some());
    s.update_analysis_options(&patch(json!({ "minSlipDepth": 50 })))
        .unwrap();
    assert_eq!(analyse(&mut s), None);
    s.update_analysis_options(&patch(json!({ "minSlipDepth": 0, "minSlipArea": 1e6 })))
        .unwrap();
    assert_eq!(analyse(&mut s), None);
}

#[test]
fn vertical_load_of_a_slice_includes_free_water_and_surface_loads() {
    let s = Slice {
        weight: 10.0,
        udl: 2.0,
        ll: 3.0,
        water_load: Some(4.0),
        ..Default::default()
    };
    assert_eq!(slice_vertical_load(&s), 19.0);
    let s = Slice {
        water_load: None,
        ..s
    };
    assert_eq!(slice_vertical_load(&s), 15.0);
}

// ── crack-angle.test.ts ───────────────────────────────────────────

const CX: f64 = 14.0;
const CY: f64 = 18.0;
const R: f64 = 15.0;

fn crack_def() -> Value {
    json!({
        "orientation": "ltr",
        "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
        "materials": [{ "name": "soil", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 8, "frictionAngle": 28 } }],
        "regionAssignments": [{ "point": [15, 2], "materialName": "soil" }],
        "customSearchPlanes": [{ "cx": CX, "cy": CY, "radius": R }],
        "customPlanesOnly": true,
    })
}

fn crack_run(o: Value) -> (f64, cslope_engine::model::slope::SearchPlane) {
    let mut options = json!({ "method": "Morgenstern-Price", "slices": 40 });
    for (k, v) in o.as_object().unwrap() {
        options[k] = v.clone();
    }
    let (f, s) = run_default(crack_def(), options);
    (f.unwrap(), s.search()[0].clone())
}

fn circle_y(x: f64) -> f64 {
    CY - (R * R - (x - CX) * (x - CX)).sqrt()
}

#[test]
fn finds_where_a_circles_base_flattens_to_the_angle() {
    // on a circle the base is inclined at α where x = cx − R sin α
    for a in [45.0, 60.0, 70.0] {
        let x =
            find_angle_crack_x(CX - R + 1e-6, CX + R - 1e-6, circle_y, (a * PI) / 180.0).unwrap();
        close(x, CX - R * ((a * PI) / 180.0).sin(), 4);
    }
    // no steeper than the angle at the entry: no crack
    assert_eq!(
        find_angle_crack_x(CX, CX + 5.0, circle_y, PI / 4.0),
        Some(CX)
    );
}

#[test]
fn cuts_the_surface_off_at_the_crack_and_records_it() {
    let (f_none, _) = crack_run(json!({}));
    let (f, plane) = crack_run(json!({ "tensionCrackAngle": 45 }));
    let xc = CX - R * (PI / 4.0).sin();
    close(plane.crack.unwrap()[0], xc, 4);
    assert!((f - f_none).abs() >= 0.0005, "{f} vs {f_none}");
}

#[test]
fn equals_a_crack_of_the_same_depth_at_the_same_place() {
    let xc = CX - R * ((50.0 * PI) / 180.0).sin();
    let ground = 10.0; // the crest is level there
    let by_angle = crack_run(json!({ "tensionCrackAngle": 50 })).0;
    let by_depth = crack_run(json!({ "tensionCrackDepth": ground - circle_y(xc) })).0;
    close(by_angle, by_depth, 5);
    // and with water in the crack
    close(
        crack_run(json!({ "tensionCrackAngle": 50, "tensionCrackWater": 1 })).0,
        crack_run(json!({ "tensionCrackDepth": ground - circle_y(xc), "tensionCrackWater": 1 })).0,
        5,
    );
}

#[test]
fn leaves_a_surface_no_steeper_than_the_angle_unchanged_and_the_deeper_crack_governs() {
    close(
        crack_run(json!({ "tensionCrackAngle": 89 })).0,
        crack_run(json!({})).0,
        10,
    );
    let xc = CX - R * ((50.0 * PI) / 180.0).sin();
    let shallow = crack_run(json!({ "tensionCrackAngle": 50, "tensionCrackDepth": 0.5 })).1;
    close(shallow.crack.unwrap()[0], xc, 4);
    let deep = crack_run(
        json!({ "tensionCrackAngle": 50, "tensionCrackDepth": 10.0 - circle_y(xc) + 1.0 }),
    )
    .1;
    assert!(deep.crack.unwrap()[0] > xc + 0.1);
}

#[test]
fn rejects_an_angle_outside_0_to_90() {
    let d: SlopeDefinition = serde_json::from_value(crack_def()).unwrap();
    let mut s = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    for a in [90.0, -1.0] {
        let e = s
            .update_analysis_options(&patch(json!({ "tensionCrackAngle": a })))
            .unwrap_err();
        assert!(e.message.contains("tensionCrackAngle"), "{}", e.message);
    }
}

// ── seismic.test.ts ───────────────────────────────────────────────

fn seismic_def() -> Value {
    layered(
        &[[0.0, 10.0], [10.0, 10.0], [25.0, 0.0], [45.0, 0.0]],
        -10.0,
        &[("S", None, mc(5.0, 30.0, 19.0))],
        json!({ "customSearchPlanes": [{ "cx": 20, "cy": 20, "radius": 21 }], "customPlanesOnly": true }),
    )
}

fn seismic_run(opts: Value) -> (Option<f64>, Slope) {
    let mut o = json!({ "slices": 30 });
    for (k, v) in opts.as_object().unwrap() {
        o[k] = v.clone();
    }
    run_verification(seismic_def(), "Morgenstern-Price", o)
}

#[test]
fn kh_w_in_the_sliding_direction_at_the_centre_of_gravity_kv_w_on_the_slice() {
    let still = seismic_run(json!({})).1.search()[0].slices.clone().unwrap();
    let shaken = seismic_run(json!({ "seismicHorizontal": 0.1, "seismicVertical": 0.05 }))
        .1
        .search()[0]
        .slices
        .clone()
        .unwrap();
    for (i, s) in shaken.iter().enumerate() {
        let w = still[i].weight;
        close(
            s.h_force.unwrap() - still[i].h_force.unwrap_or(0.0),
            0.1 * w,
            9,
        );
        close(s.udl - still[i].udl, 0.05 * w, 9);
        // the centre of gravity lies between the base and the top
        let yc = s.y_centroid.unwrap();
        assert!(yc > s.y_bottom - 1e-9 && yc < s.y_top + 1e-9);
        close(
            s.extra_moment.unwrap() - still[i].extra_moment.unwrap_or(0.0),
            0.1 * w * (20.0 - yc),
            6,
        );
    }
}

#[test]
fn lowers_the_factor_of_safety_with_kh_and_an_upward_kv_lowers_it_further() {
    let f0 = seismic_run(json!({})).0.unwrap();
    let f1 = seismic_run(json!({ "seismicHorizontal": 0.1 })).0.unwrap();
    let f2 = seismic_run(json!({ "seismicHorizontal": 0.1, "seismicVertical": -0.05 }))
        .0
        .unwrap();
    assert!(f1 < f0);
    assert!(f2 < f1);
    let d: SlopeDefinition = serde_json::from_value(seismic_def()).unwrap();
    let mut s = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    let e = s
        .update_analysis_options(&patch(json!({ "seismicHorizontal": 2 })))
        .unwrap_err();
    assert!(e.message.contains("seismicHorizontal"), "{}", e.message);
}

#[test]
fn the_centre_of_gravity_of_a_rectangle_like_slice_is_at_mid_height() {
    // flat ground: the slice centroids at the middle of each column
    let flat = layered(
        &[[0.0, 10.0], [40.0, 10.0]],
        -10.0,
        &[("S", None, mc(5.0, 30.0, 19.0))],
        json!({ "customSurfaces": [{ "points": [[5, 10], [10, 4], [30, 4], [35, 10]] }], "customPlanesOnly": true }),
    );
    let (_, s) = run_verification(
        flat,
        "Morgenstern-Price",
        json!({ "slices": 20, "seismicHorizontal": 0.1 }),
    );
    for q in s.search()[0].slices.as_ref().unwrap() {
        if q.y0_bottom != 4.0 || q.y1_bottom != 4.0 {
            continue;
        }
        close(q.y_centroid.unwrap(), 7.0, 9);
    }
}

fn line_load_run(ll: Value, rtl: bool) -> (Option<f64>, Slope) {
    let mut d = layered(
        &[[0.0, 10.0], [10.0, 10.0], [25.0, 0.0], [45.0, 0.0]],
        -10.0,
        &[("S", None, mc(5.0, 30.0, 19.0))],
        json!({ "customSearchPlanes": [{ "cx": 20, "cy": 20, "radius": 21 }], "customPlanesOnly": true }),
    );
    d["lineLoads"] = ll;
    if rtl {
        d["orientation"] = json!("rtl");
    }
    run_verification(d, "Morgenstern-Price", json!({ "slices": 30 }))
}

#[test]
fn an_inclined_line_load_splits_into_its_vertical_part_and_a_horizontal_force() {
    let vertical = line_load_run(json!([{ "magnitude": 50, "x": 6 }]), false).1;
    let inclined = line_load_run(
        json!([{ "magnitude": 100, "x": 6, "angle": 60, "y": 9 }]),
        false,
    )
    .1;
    let at = |s: &Slope| {
        s.search()[0]
            .slices
            .as_ref()
            .unwrap()
            .iter()
            .find(|q| q.x_left <= 6.0 && q.x_right > 6.0)
            .unwrap()
            .clone()
    };
    close(at(&inclined).ll, at(&vertical).ll, 9); // 100 cos 60°
    close(at(&inclined).h_force.unwrap(), 100.0 * (PI / 3.0).sin(), 9);
    close(
        at(&inclined).extra_moment.unwrap(),
        100.0 * (PI / 3.0).sin() * (20.0 - 9.0),
        9,
    );
}

#[test]
fn an_inclined_line_load_towards_the_sliding_direction_lowers_f_against_raises_it_mirrored_alike() {
    let f0 = line_load_run(json!([{ "magnitude": 100, "x": 6 }]), false)
        .0
        .unwrap();
    let towards = line_load_run(json!([{ "magnitude": 100, "x": 6, "angle": 30 }]), false)
        .0
        .unwrap();
    let against = line_load_run(json!([{ "magnitude": 100, "x": 6, "angle": -30 }]), false)
        .0
        .unwrap();
    assert!(towards < f0);
    assert!(against > f0);
    // mirrored model: the geometry and the load mirrored give the same factor
    let m = |x: f64| 45.0 - x;
    let mirrored = layered(
        &[[0.0, 0.0], [20.0, 0.0], [35.0, 10.0], [45.0, 10.0]],
        -10.0,
        &[("S", None, mc(5.0, 30.0, 19.0))],
        json!({
            "orientation": "rtl",
            "lineLoads": [{ "magnitude": 100, "x": m(6.0), "angle": -30 }],
            "customSearchPlanes": [{ "cx": m(20.0), "cy": 20, "radius": 21 }],
            "customPlanesOnly": true,
        }),
    );
    let f = run_verification(mirrored, "Morgenstern-Price", json!({ "slices": 30 }))
        .0
        .unwrap();
    close(f, towards, 9);
}

// ── normal-load.test.ts ───────────────────────────────────────────

fn ground_at(x: f64) -> f64 {
    if x <= 10.0 {
        10.0
    } else if x >= 20.0 {
        5.0
    } else {
        10.0 - (x - 10.0) / 2.0
    }
}

/// undrained clay, a 1:2 slope from y = 10 (x ≤ 10) down to y = 5 (x ≥ 20)
fn normal_base(extra: Value) -> Value {
    let mut d = json!({
        "orientation": "ltr",
        "coordinates": [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
        "materials": [{ "name": "clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 20 } }],
        "regionAssignments": [{ "point": [15, 2], "materialName": "clay" }],
        "customSearchPlanes": [{ "cx": 14, "cy": 16, "radius": 12 }],
        "customPlanesOnly": true,
    });
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    d
}

fn normal_fos(d: Value, method: AnalysisMethod) -> f64 {
    run_default(d, json!({ "method": method.as_str(), "slices": 60 }))
        .0
        .unwrap()
}

/// Water to level h as distributed loads γw·(h − ground) in strips of width dx.
fn pond(h: f64, from: f64, to: f64, dx: f64, direction: &str) -> Value {
    let mut out = Vec::new();
    let mut x = from;
    while x < to - 1e-9 {
        let d = h - ground_at(x + dx / 2.0);
        if d > 0.0 {
            out.push(json!({ "magnitude": WATER_UNIT_WEIGHT * d, "x1": x, "x2": (to).min(x + dx), "direction": direction }));
        }
        x += dx;
    }
    Value::Array(out)
}

#[test]
fn a_normal_load_is_a_vertical_load_on_level_ground() {
    let mp = AnalysisMethod::MorgensternPrice;
    close(
        normal_fos(
            normal_base(
                json!({ "udls": [{ "magnitude": 30, "x1": 2, "x2": 8, "direction": "normal" }] }),
            ),
            mp,
        ),
        normal_fos(
            normal_base(json!({ "udls": [{ "magnitude": 30, "x1": 2, "x2": 8 }] })),
            mp,
        ),
        10,
    );
}

#[test]
fn a_normal_load_carries_the_thrust_of_water_against_the_slope_as_free_water() {
    let water = json!({ "waterTable": { "mode": "custom", "value": [[0, 8], [30, 8]], "followBoundary": false } });
    let mp = AnalysisMethod::MorgensternPrice;
    // water to y = 8 over the lower slope and the toe
    let free = normal_fos(normal_base(water.clone()), mp);
    let normal = normal_fos(
        normal_base(json!({ "udls": pond(8.0, 14.0, 30.0, 0.05, "normal") })),
        mp,
    );
    let vertical = normal_fos(
        normal_base(json!({ "udls": pond(8.0, 14.0, 30.0, 0.05, "vertical") })),
        mp,
    );
    // within 0.1 % (the strips, and the vertical part at the slice centre)
    assert!((normal / free - 1.0).abs() < 1e-3);
    // the thrust into the slope resists: without it the factor is lower
    assert!(vertical < normal - 0.01);
    // the same with Bishop
    let nb = normal_fos(
        normal_base(json!({ "udls": pond(8.0, 14.0, 30.0, 0.05, "normal") })),
        AnalysisMethod::Bishop,
    );
    let fb = normal_fos(normal_base(water), AnalysisMethod::Bishop);
    assert!((nb / fb - 1.0).abs() < 1e-3);
}

#[test]
fn a_normal_load_acts_into_the_ground_on_a_slope_facing_the_other_way() {
    let d = normal_base(json!({ "udls": pond(8.0, 14.0, 30.0, 0.05, "normal") }));
    let m = |p: &Value| json!([30.0 - p[0].as_f64().unwrap(), p[1]]);
    let mut r = d.clone();
    r["orientation"] = json!("rtl");
    r["coordinates"] = Value::Array(d["coordinates"].as_array().unwrap().iter().map(m).collect());
    r["regionAssignments"] =
        json!([{ "point": m(&d["regionAssignments"][0]["point"]), "materialName": "clay" }]);
    r["customSearchPlanes"] = json!([{ "cx": 16, "cy": 16, "radius": 12 }]);
    r["udls"] = Value::Array(
        d["udls"]
            .as_array()
            .unwrap()
            .iter()
            .map(|u| {
                let mut u = u.clone();
                let (x1, x2) = (u["x1"].as_f64().unwrap(), u["x2"].as_f64().unwrap());
                u["x1"] = json!(30.0 - x2);
                u["x2"] = json!(30.0 - x1);
                u
            })
            .collect(),
    );
    let mp = AnalysisMethod::MorgensternPrice;
    close(normal_fos(r, mp), normal_fos(d, mp), 8);
}
