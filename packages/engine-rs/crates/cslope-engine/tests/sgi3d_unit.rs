//! The 3D factor after SGI's guidance (model/sgi3d.rs): sgi3d.test.ts
//! ported. (The differential tests against the TypeScript engine's fixtures were removed with it at the cutover, PORTING.md.)
#![allow(clippy::disallowed_methods)]

mod common;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::sgi3d::sgi3d_factor_of_safety;
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::sgi3d::{Sgi3dEquation, Sgi3dOptions};
use cslope_engine::types::SlopeDefinition;
use serde_json::{json, Value};
use std::f64::consts::PI;

const GAMMA: f64 = 18.0;
const CU_CRUST: f64 = 25.0;
const CU_CLAY: f64 = 15.0;
const Q: f64 = 20.0;

fn ground(x: f64) -> f64 {
    if x <= 6.0 {
        0.0
    } else if x >= 14.0 {
        -4.0
    } else {
        -(x - 6.0) / 2.0
    }
}

/// A 1:2 cut in clay (crust over clay) with a strip load behind its crest.
fn cut(rtl: bool) -> Value {
    let m = |x: f64| if rtl { 20.0 - x } else { x };
    let mut pts: Vec<Value> = [
        [0.0, -12.0],
        [0.0, 0.0],
        [6.0, 0.0],
        [14.0, -4.0],
        [20.0, -4.0],
        [20.0, -12.0],
    ]
    .iter()
    .map(|&[x, y]| json!([m(x), y]))
    .collect();
    if rtl {
        pts.reverse();
    }
    json!({
        "orientation": if rtl { "rtl" } else { "ltr" },
        "coordinates": pts,
        "materials": [
            { "name": "crust", "model": { "kind": "undrained", "unitWeight": GAMMA, "undrainedShearStrength": CU_CRUST } },
            { "name": "clay", "model": { "kind": "undrained", "unitWeight": GAMMA, "undrainedShearStrength": CU_CLAY } },
        ],
        "materialBoundaries": [{ "coordinates": [[m(-0.05), -1], [m(8.05), -1]], "materialName": "" }],
        "regionAssignments": [{ "point": [m(3.0), -0.5], "materialName": "crust" }, { "point": [m(10.0), -8], "materialName": "clay" }],
        "udls": [{ "magnitude": Q, "x1": m(1.0).min(m(5.0)), "x2": m(1.0).max(m(5.0)) }],
    })
}

fn test_options() -> Value {
    json!({ "method": "Morgenstern-Price", "slices": 30, "iterations": 300, "refinedIterations": 150 })
}

fn built(def: &Value, options: &Value) -> Slope {
    let d: SlopeDefinition = serde_json::from_value(def.clone()).unwrap();
    let mut s = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    let p: AnalysisOptionsPatch = serde_json::from_value(options.clone()).unwrap();
    s.update_analysis_options(&p).unwrap();
    s
}

fn analysed(def: &Value) -> Slope {
    let mut s = built(def, &test_options());
    analyse_slope(&mut s, &mut RunCtx::default()).unwrap();
    s
}

fn o(length: f64) -> Sgi3dOptions {
    Sgi3dOptions {
        length,
        overstrong_f2d: None,
        exclude_materials: None,
        cell_size: None,
    }
}

/// Polar quadrature over the circle's part below the ground (model space, ltr).
fn by_quadrature(cx: f64, cy: f64, r: f64, with_crust: bool) -> (f64, f64, f64) {
    let (mut area, mut mc, mut me) = (0.0, 0.0, 0.0);
    let (nr, nt) = (600, 1800);
    for i in 0..nr {
        let rr = ((i as f64 + 0.5) / nr as f64) * r;
        for j in 0..nt {
            let t = ((j as f64 + 0.5) / nt as f64) * 2.0 * PI;
            let x = cx + rr * t.cos();
            let y = cy + rr * t.sin();
            if !(0.0..=20.0).contains(&x) || y >= ground(x) || y < -12.0 {
                continue;
            }
            let da = rr * (r / nr as f64) * ((2.0 * PI) / nt as f64);
            me += GAMMA * (x - cx) * da;
            let crust = y > -1.0 && x < 8.0;
            if crust && !with_crust {
                continue;
            }
            area += da;
            mc += (if crust { CU_CRUST } else { CU_CLAY }) * rr * da;
        }
    }
    // the load on 1 ≤ x ≤ 5 where the circle passes below the ground
    for k in 0..4000 {
        let x = 1.0 + ((k as f64 + 0.5) / 4000.0) * 4.0;
        let dx = x - cx;
        if dx * dx < r * r && cy - (r * r - dx * dx).sqrt() < 0.0 {
            me += Q * (4.0 / 4000.0) * dx;
        }
    }
    (area, mc, me.abs())
}

fn close(a: f64, b: f64, digits: i32) -> bool {
    (a - b).abs() < 10f64.powi(-digits) / 2.0
}

#[test]
fn integrates_the_end_faces_and_the_driving_moment_and_applies_2_2_and_2_3() {
    let s = analysed(&cut(false));
    let r = sgi3d_factor_of_safety(
        &s,
        &Sgi3dOptions {
            cell_size: Some(0.025),
            ..o(10.0)
        },
    )
    .unwrap()
    .unwrap();
    let c = &r.critical;
    let (area, mc, me) = by_quadrature(c.cx, c.cy, c.radius, true);
    assert!(close(c.end_face_area / area, 1.0, 2));
    assert!(close(c.end_face_moment / mc, 1.0, 2));
    assert!(close(c.driving_moment / me, 1.0, 2));
    assert!(close(
        c.fp,
        c.f2d + (2.0 * c.end_face_moment) / (10.0 * c.driving_moment),
        12
    ));
    assert!(close(r.factor_of_safety, c.f2d + 0.75 * (c.fp - c.f2d), 12));
    assert!(r.factor_of_safety > r.f2d_critical);
    assert_eq!(r.equation, Sgi3dEquation::Eq2_3);
}

#[test]
fn the_same_for_the_slope_facing_left_its_circle_in_model_space() {
    let a = sgi3d_factor_of_safety(&analysed(&cut(false)), &o(10.0))
        .unwrap()
        .unwrap();
    let b = sgi3d_factor_of_safety(&analysed(&cut(true)), &o(10.0))
        .unwrap()
        .unwrap();
    assert!(close(b.factor_of_safety, a.factor_of_safety, 6));
    assert!(close(b.critical.cx, 20.0 - a.critical.cx, 6));
}

#[test]
fn overstrong_stability_excluded_materials_and_a_shorter_stretch() {
    let s = analysed(&cut(false));
    let inf = sgi3d_factor_of_safety(&s, &o(10.0)).unwrap().unwrap();
    // k = 1 − F2D,krit,min / F2D,överstark,min = 0.5: half the 3D gain on each surface
    let fin = sgi3d_factor_of_safety(
        &s,
        &Sgi3dOptions {
            overstrong_f2d: Some(2.0 * inf.f2d_critical),
            ..o(10.0)
        },
    )
    .unwrap()
    .unwrap();
    assert_eq!(fin.equation, Sgi3dEquation::Eq2_4);
    assert!(fin.factor_of_safety < inf.factor_of_safety);
    let fc = &fin.critical;
    assert!(close(
        fin.factor_of_safety,
        fc.f2d + 0.5 * 0.75 * (fc.fp - fc.f2d),
        12
    ));
    // an overstrong stretch no stronger than the critical one: no 3D effect
    let none = sgi3d_factor_of_safety(
        &s,
        &Sgi3dOptions {
            overstrong_f2d: Some(inf.f2d_critical),
            ..o(10.0)
        },
    )
    .unwrap()
    .unwrap();
    assert!(close(none.factor_of_safety, inf.f2d_critical, 12));
    let no_crust = sgi3d_factor_of_safety(
        &s,
        &Sgi3dOptions {
            exclude_materials: Some(vec!["crust".into()]),
            cell_size: Some(0.025),
            ..o(10.0)
        },
    )
    .unwrap()
    .unwrap();
    assert!(no_crust.factor_of_safety < inf.factor_of_safety);
    let c = &no_crust.critical;
    let (_, mc, _) = by_quadrature(c.cx, c.cy, c.radius, false);
    assert!(close(c.end_face_moment / mc, 1.0, 2));
    assert!(
        sgi3d_factor_of_safety(&s, &o(5.0))
            .unwrap()
            .unwrap()
            .factor_of_safety
            > inf.factor_of_safety
    );
}

#[test]
fn takes_the_sliding_mass_between_entry_and_exit() {
    // a trench with a steep far side: this circle leaves the ground at the trench bottom (x ≈ 9.98)
    // and runs below the far slope again for 10.08 < x < 10.44
    let g = |x: f64| {
        if x <= 6.0 {
            0.0
        } else if x <= 8.0 {
            -(x - 6.0) * 1.5
        } else if x <= 10.0 {
            -3.0
        } else if x <= 11.0 {
            -3.0 + (x - 10.0) * 3.0
        } else {
            0.0
        }
    };
    let def = json!({
        "orientation": "ltr",
        "coordinates": [[-20, -14], [-20, 0], [6, 0], [8, -3], [10, -3], [11, 0], [20, 0], [20, -14]],
        "materials": [{ "name": "clay", "model": { "kind": "undrained", "unitWeight": GAMMA, "undrainedShearStrength": CU_CLAY } }],
        "regionAssignments": [{ "point": [0, -10], "materialName": "clay" }],
        "udls": [],
        "customSearchPlanes": [{ "cx": 0.6, "cy": 1.0, "radius": 10.2 }],
        "customPlanesOnly": true,
    });
    let s = analysed(&def);
    let plane = s.search().iter().find(|p| p.fos.is_some()).unwrap();
    assert!(plane.rc[0] < 10.05);
    let r = sgi3d_factor_of_safety(
        &s,
        &Sgi3dOptions {
            cell_size: Some(0.025),
            ..o(10.0)
        },
    )
    .unwrap()
    .unwrap();
    let mut area = 0.0;
    let (rr0, nr, nt) = (10.2, 600, 1800);
    for i in 0..nr {
        let rr = ((i as f64 + 0.5) / nr as f64) * rr0;
        for j in 0..nt {
            let t = ((j as f64 + 0.5) / nt as f64) * 2.0 * PI;
            let x = 0.6 + rr * t.cos();
            let y = 1.0 + rr * t.sin();
            if x < plane.lc[0] || x > plane.rc[0] || y >= g(x) {
                continue;
            }
            area += rr * (rr0 / nr as f64) * ((2.0 * PI) / nt as f64);
        }
    }
    assert!(close(r.critical.end_face_area / area, 1.0, 2));
}

#[test]
fn rejects_a_bad_length_or_overstrong_f2d() {
    let s = analysed(&cut(false));
    assert!(sgi3d_factor_of_safety(&s, &o(0.0))
        .unwrap_err()
        .message
        .contains("length"));
    assert!(sgi3d_factor_of_safety(
        &s,
        &Sgi3dOptions {
            overstrong_f2d: Some(-1.0),
            ..o(10.0)
        }
    )
    .unwrap_err()
    .message
    .contains("overstrong"));
}
