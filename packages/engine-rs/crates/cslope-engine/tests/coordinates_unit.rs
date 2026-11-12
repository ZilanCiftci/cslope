//! The analyses PORTING.md deferred to the solver phase from
//! model-coordinates.test.ts, point-limits.test.ts,
//! real-world-coordinates.test.ts and slope-api.test.ts ("result queries
//! throw before an analysis and answer after it", with an analysis).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::{get_domain_x, mirror_x, to_canonical_slope_definition};
use cslope_engine::model::search::add_single_circular_plane;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::{analyse_bishop, analyse_slope};
use cslope_engine::types::{default_analysis_options, Material, MaterialParams, SlopeDefinition};
use model_core_support::{close, def};
use serde_json::{json, Value};
use solvers_support::run_verification;

// ── model-coordinates.test.ts ─────────────────────────────────────

/// A 1:2 clay slope with a strip load on its crest, facing right (ltr) or,
/// mirrored about x = 10, left (rtl): the same slope in both model spaces.
fn slope_def(rtl: bool) -> Value {
    let m = |x: f64| if rtl { 20.0 - x } else { x };
    let mut pts: Vec<Value> = [
        [0.0, -6.0],
        [0.0, 0.0],
        [6.0, 0.0],
        [14.0, -4.0],
        [20.0, -4.0],
        [20.0, -6.0],
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
        "materials": [{ "name": "clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 20 } }],
        "regionAssignments": [{ "point": [10, -5], "materialName": "clay" }],
        "udls": [{ "magnitude": 15, "x1": m(1.0).min(m(5.0)), "x2": m(1.0).max(m(5.0)) }],
    })
}

fn run_default(d: &Value) -> (Slope, f64) {
    let dd: SlopeDefinition = serde_json::from_value(d.clone()).unwrap();
    let mut s = build_slope(&to_canonical_slope_definition(&dd, None).unwrap()).unwrap();
    s.update_analysis_options(&AnalysisOptionsPatch::from(&default_analysis_options()))
        .unwrap();
    s.update_analysis_options(
        &serde_json::from_value(json!({ "method": "Morgenstern-Price", "slices": 30, "iterations": 400, "refinedIterations": 200 }))
            .unwrap(),
    )
    .unwrap();
    let f = analyse_slope(&mut s, &mut RunCtx::default())
        .unwrap()
        .unwrap();
    (s, f)
}

#[test]
fn gives_a_searched_surface_back_as_a_custom_one_in_model_space() {
    for rtl in [false, true] {
        let d = slope_def(rtl);
        let (s, f) = run_default(&d);
        let mut solved: Vec<_> = s
            .search()
            .iter()
            .filter(|p| p.fos.is_some())
            .cloned()
            .collect();
        cslope_engine::model::solvers::sort_by_fos(&mut solved);
        let crit = &solved[0];
        let (cx, cy, radius) = s.to_model_circle(crit).unwrap();
        // in model space the circle's centre lies over the slope as drawn
        assert!(if rtl { cx > 10.0 } else { cx < 10.0 });
        let mut again = d.clone();
        again["customSearchPlanes"] = json!([{ "cx": cx, "cy": cy, "radius": radius }]);
        again["customPlanesOnly"] = json!(true);
        close(run_default(&again).1, f, 6);
        // about the middle of the model's extent, as the canonical definition was mirrored
        let dd: SlopeDefinition = serde_json::from_value(d).unwrap();
        let [lo, hi] = get_domain_x(&dd.coordinates);
        close(
            s.to_model_x(crit.cx).unwrap(),
            if rtl {
                mirror_x(crit.cx, lo, hi)
            } else {
                crit.cx
            },
            12,
        );
        // a non-circular surface is not passed off as a circle
        let poly = cslope_engine::model::slope::SearchPlane {
            points: Some(vec![[0.0, 0.0], [1.0, -1.0]]),
            ..crit.clone()
        };
        assert!(s
            .to_model_circle(&poly)
            .unwrap_err()
            .message
            .contains("non-circular"));
    }
}

// ── point-limits.test.ts ──────────────────────────────────────────

/// A 4:5 slope, c′ = 15 kPa, φ′ = 30°, with the exit range given as the toe
/// point (as the format of another program gives it).
fn point_slope(limits: Option<Value>) -> Value {
    let mut d = json!({
        "orientation": "ltr",
        "coordinates": [[8.5, 20], [22.5, 20], [30.5, 10], [40, 10], [40, 5], [8.5, 5]],
        "materials": [{ "name": "S", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 15, "frictionAngle": 30 } }],
    });
    if let Some(l) = limits {
        d["analysisLimits"] = l;
    }
    d
}

fn mp() -> Value {
    json!({ "intersliceFunction": "half-sine" })
}

#[test]
fn a_point_range_finds_the_circles_exiting_at_the_toe_corner() {
    let free = run_verification(point_slope(None), "Morgenstern-Price", mp())
        .0
        .unwrap();
    let (fos, s) = run_verification(
        point_slope(Some(
            json!({ "entryLeftX": 17, "entryRightX": 21.5, "exitLeftX": 30.5, "exitRightX": 30.5 }),
        )),
        "Morgenstern-Price",
        mp(),
    );
    let fos = fos.unwrap();
    close(fos, 1.2535, 2);
    assert!((fos / free - 1.0).abs() < 0.002);
    // As given; only the search widens it.
    assert_eq!(s.limits(), [17.0, 21.5, 30.5, 30.5]);
    let crit = s.search().iter().find(|p| p.fos.is_some()).unwrap();
    assert!((crit.rc[0] - 30.5).abs() < 1e-3);
}

#[test]
fn a_range_that_starts_at_the_corner_reaches_it() {
    let (fos, s) = run_verification(
        point_slope(Some(
            json!({ "entryLeftX": 17, "entryRightX": 21.5, "exitLeftX": 30.5, "exitRightX": 35 }),
        )),
        "Morgenstern-Price",
        mp(),
    );
    close(fos.unwrap(), 1.2535, 2);
    assert_eq!(s.limits(), [17.0, 21.5, 30.5, 35.0]);
    let w = 1e-5 * 31.5;
    assert_eq!(s.search_limits(), [17.0, 21.5, 30.5 - w, 35.0]);
}

// ── An exit given as a single x on a vertical face (issue 141) ────

/// Ground with steps, sliding towards the right (or, mirrored about
/// x = 20, the same model sliding to the left): a crest at y = 15, a 10 m
/// vertical face at x = 20, a floor at y = 5. With `rise`, a second,
/// rising face of 3 m at x = 30 beyond the floor.
fn wall_def(rtl: bool, rise: bool, limits: Value) -> Value {
    let m = |x: f64| if rtl { 40.0 - x } else { x };
    let pts: &[[f64; 2]] = if rise {
        &[
            [0.0, 0.0],
            [0.0, 15.0],
            [20.0, 15.0],
            [20.0, 5.0],
            [30.0, 5.0],
            [30.0, 8.0],
            [40.0, 8.0],
            [40.0, 0.0],
        ]
    } else {
        &[
            [0.0, 0.0],
            [0.0, 15.0],
            [20.0, 15.0],
            [20.0, 5.0],
            [40.0, 5.0],
            [40.0, 0.0],
        ]
    };
    let mut pts: Vec<Value> = pts.iter().map(|&[x, y]| json!([m(x), y])).collect();
    if rtl {
        pts.reverse();
    }
    let mut limits = limits;
    if rtl {
        let f = |k: &str| limits[k].as_f64().unwrap();
        let (el, er, xl, xr) = (
            f("entryLeftX"),
            f("entryRightX"),
            f("exitLeftX"),
            f("exitRightX"),
        );
        limits = json!({ "entryLeftX": m(er), "entryRightX": m(el), "exitLeftX": m(xr), "exitRightX": m(xl) });
    }
    json!({
        "orientation": if rtl { "rtl" } else { "ltr" },
        "coordinates": pts,
        "materials": [{ "name": "S", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30 } }],
        "analysisLimits": limits,
    })
}

fn constant() -> Value {
    json!({ "intersliceFunction": "constant" })
}

#[test]
fn a_single_exit_x_on_a_vertical_face_exits_at_its_foot() {
    let limits = json!({ "entryLeftX": 11, "entryRightX": 16, "exitLeftX": 20, "exitRightX": 20 });
    let foot = [20.0, 5.0 + 1e-5 * 40.0];
    for rtl in [false, true] {
        let (fos, s) = run_verification(
            wall_def(rtl, false, limits.clone()),
            "Morgenstern-Price",
            constant(),
        );
        let fos = fos.unwrap();
        // In canonical space either way: the face at x = 20 descends to the right.
        assert_eq!(s.exit_face_point(), Some(foot));
        assert_eq!(s.search_limits(), [11.0, 16.0, 20.0, 20.0]);
        assert_eq!(s.exit_ground_point(20.0).unwrap(), foot);
        assert!(!s.search().is_empty());
        // Every trial surface ends at the foot of the face (before the rule
        // they ended at mid-face, (20, 10), and the search gave F = 0.698).
        for p in s.search() {
            assert!(
                (p.rc[0] - foot[0]).abs() < 1e-9 && (p.rc[1] - foot[1]).abs() < 1e-9,
                "exit {:?}",
                p.rc
            );
        }
        if rtl {
            continue;
        }
        // The critical circle ends there: the same arc, from its entry to
        // the foot, as a polyline with the circle's centre as its axis gives
        // the same F.
        let mut solved: Vec<_> = s
            .search()
            .iter()
            .filter(|p| p.fos.is_some())
            .cloned()
            .collect();
        cslope_engine::model::solvers::sort_by_fos(&mut solved);
        let crit = &solved[0];
        assert_eq!(fos, crit.fos.unwrap());
        let points: Vec<Value> = match &crit.points {
            Some(pts) => pts.iter().map(|p| json!(p)).collect(),
            None => {
                let a0 = (crit.lc[1] - crit.cy).atan2(crit.lc[0] - crit.cx);
                let a1 = (crit.rc[1] - crit.cy).atan2(crit.rc[0] - crit.cx);
                (0..=400)
                    .map(|i| {
                        let a = a0 + (a1 - a0) * i as f64 / 400.0;
                        json!([
                            crit.cx + crit.radius * a.cos(),
                            crit.cy + crit.radius * a.sin()
                        ])
                    })
                    .collect()
            }
        };
        let mut again = wall_def(false, false, limits.clone());
        again["customSurfaces"] = json!([{ "points": points, "axis": [crit.cx, crit.cy] }]);
        again["customPlanesOnly"] = json!(true);
        let (f_poly, _) = run_verification(again, "Morgenstern-Price", constant());
        assert!(
            (f_poly.unwrap() / fos - 1.0).abs() < 1e-4,
            "{fos} vs {f_poly:?}"
        );
    }
}

#[test]
fn a_rising_face_an_exit_range_and_a_sloping_toe_are_as_before() {
    // A single exit x on a face that rises in the sliding direction: the
    // corner rule as before (the range starts just below the corner).
    let w = 1e-5 * 40.0;
    let (fos, s) = run_verification(
        wall_def(
            false,
            true,
            json!({ "entryLeftX": 11, "entryRightX": 16, "exitLeftX": 30, "exitRightX": 30 }),
        ),
        "Morgenstern-Price",
        constant(),
    );
    // (the factors of safety of the first two are those before the rule, to
    // the bit)
    close(fos.unwrap(), 1.150_043_595_810_847, 12);
    assert_eq!(s.exit_face_point(), None);
    assert_eq!(s.search_limits(), [11.0, 16.0, 30.0 - w, 30.0]);
    // An exit range across the face: the ground at each x, as before.
    let (fos, s) = run_verification(
        wall_def(
            false,
            false,
            json!({ "entryLeftX": 11, "entryRightX": 16, "exitLeftX": 18, "exitRightX": 30 }),
        ),
        "Morgenstern-Price",
        constant(),
    );
    close(fos.unwrap(), 0.392_698_221_225_512, 12);
    assert_eq!(s.exit_face_point(), None);
    assert_eq!(s.search_limits(), [11.0, 16.0, 18.0, 30.0]);
    assert_eq!(s.exit_ground_point(20.0).unwrap(), [20.0, 10.0]);
    // A single exit x at the toe of a sloping face (no vertical face). Since
    // issue #157 its circles go through the two ends of the widened limit
    // only (1.251587687149846 with 16 exit points between them).
    let (fos, s) = run_verification(
        point_slope(Some(
            json!({ "entryLeftX": 17, "entryRightX": 21.5, "exitLeftX": 30.5, "exitRightX": 30.5 }),
        )),
        "Morgenstern-Price",
        mp(),
    );
    close(fos.unwrap(), 1.251_608_205_846_085, 12);
    assert_eq!(s.exit_face_point(), None);
    // The model's own end face is no exit face.
    let end = json!({ "entryLeftX": 11, "entryRightX": 16, "exitLeftX": 40, "exitRightX": 40 });
    let d = def(wall_def(false, false, end));
    let s = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    assert_eq!(s.exit_face_point(), None);
}

// ── real-world-coordinates.test.ts ────────────────────────────────

fn world_model(dx: f64, dy: f64) -> Value {
    let p = |x: f64, y: f64| json!([x + dx, y + dy]);
    json!({
        "coordinates": [p(0.0, -10.0), p(0.0, 10.943), p(9.551, 10.943), p(36.013, 0.0), p(49.384, 0.0), p(49.384, -10.0)],
        "materials": [
            { "name": "Upper", "unitWeight": 17.71, "cohesion": 7.727, "frictionAngle": 15.166 },
            { "name": "Lower", "unitWeight": 19.391, "cohesion": 11.379, "frictionAngle": 20.484 },
        ],
        "materialBoundaries": [{ "coordinates": [p(0.0, -0.58), p(49.384, -1.0)], "materialName": "Lower" }],
        "regionAssignments": [{ "point": p(0.5, 5.0), "materialName": "Upper" }, { "point": p(0.5, -5.0), "materialName": "Lower" }],
        "customSearchPlanes": [{ "cx": 25.735 + dx, "cy": 13.281 + dy, "radius": 17.886 }],
        "customPlanesOnly": true,
    })
}

fn world_slices(d: Value) -> (Slope, Vec<cslope_engine::types::Slice>) {
    let mut slope = build_slope(&def(d)).unwrap();
    slope
        .update_analysis_options(
            &serde_json::from_value(
                json!({ "slices": 40, "tolerance": 1e-9, "maxIterations": 100 }),
            )
            .unwrap(),
        )
        .unwrap();
    let p = slope.individual_planes()[0].clone();
    let sl = get_slices(
        &slope,
        p.lc[0],
        p.rc[0],
        p.cx,
        p.cy,
        p.radius,
        None,
        &mut SliceScratch::new(),
    )
    .unwrap();
    (slope, sl)
}

#[test]
fn finds_the_base_material_of_a_thin_slice_at_the_toe_in_real_world_coordinates() {
    // With global coordinates, clipping the material regions by the slice
    // base lost ~1e-6 m in the constant term x·y, more than the lift used to
    // find the base material, and the slice got the lower layer's strength.
    let (ls, mut local) = world_slices(world_model(0.0, 0.0));
    let (ws, mut world) = world_slices(world_model(6439598.0, 1881.0));
    assert_eq!(world.len(), local.len());
    let name = |s: &Slope, q: &cslope_engine::types::Slice| {
        s.material(q.base_material.unwrap()).name.clone()
    };
    for (i, q) in local.iter().enumerate() {
        assert_eq!(name(&ws, &world[i]), name(&ls, q), "slice {i}");
        close(world[i].weight, q.weight, 5);
    }
    assert_eq!(name(&ls, &local[local.len() - 1]), "Upper");
    let f_local = analyse_bishop(&ls, &mut local, None).0.unwrap();
    let f_world = analyse_bishop(&ws, &mut world, None).0.unwrap();
    close(f_world, f_local, 7);
}

// ── slope-api.test.ts: result queries ─────────────────────────────

#[test]
fn result_queries_throw_before_an_analysis_and_answer_after_it() {
    let mut s = Slope::new();
    s.add_material(
        Material::new(MaterialParams {
            name: Some("S".into()),
            unit_weight: Some(19.0),
            cohesion: Some(10.0),
            friction_angle: Some(25.0),
            ..Default::default()
        })
        .unwrap(),
    );
    s.set_external_boundary(&[
        [0.0, -10.0],
        [0.0, 10.0],
        [10.0, 10.0],
        [25.0, 0.0],
        [40.0, 0.0],
        [40.0, -10.0],
    ])
    .unwrap();
    for e in [s.get_min_fos().err(), s.get_max_fos().err()] {
        assert!(e.unwrap().message.contains("No analysis results"));
    }
    assert!(s
        .get_min_fos_circle()
        .unwrap_err()
        .message
        .contains("No analysis results"));
    assert!(s
        .get_min_fos_end_points()
        .unwrap_err()
        .message
        .contains("No analysis results"));
    add_single_circular_plane(&mut s, 20.0, 20.0, 18.0).unwrap();
    add_single_circular_plane(&mut s, 22.0, 16.0, 17.0).unwrap();
    s.set_custom_planes_only(true);
    assert!(s.custom_planes_only());
    s.update_analysis_options(&AnalysisOptionsPatch {
        slices: Some(20.0),
        ..Default::default()
    })
    .unwrap();
    let f = analyse_slope(&mut s, &mut RunCtx::default())
        .unwrap()
        .unwrap();
    assert_eq!(s.get_min_fos().unwrap(), f);
    assert!(s.get_max_fos().unwrap() >= f);
    assert!(s.get_min_fos_circle().unwrap().2 > 0.0);
    let (entry, exit) = s.get_min_fos_end_points().unwrap();
    assert!(entry[0] < exit[0]);
    // Changing the model drops the results.
    s.materials_changed();
    assert!(s
        .get_min_fos()
        .unwrap_err()
        .message
        .contains("No analysis results"));
    s.remove_individual_planes();
    assert!(s.individual_planes().is_empty());
}
