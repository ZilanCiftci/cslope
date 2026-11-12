//! Ported unit tests of model/search.ts (plane generation), model/surface.ts
//! and model/composite.ts: search-branches.test.ts, search-tangent.test.ts,
//! search-review-c2.test.ts, surface-props.test.ts and composite.test.ts,
//! without the parts that evaluate surfaces (deferred to the solver phase,
//! PORTING.md).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::composite::{composite_floor, floor_y_at};
use cslope_engine::model::geometry_ops::Side;
use cslope_engine::model::search::{
    add_single_circular_plane, add_single_entry_exit_plane, entry_exit_planes,
    generate_local_planes, generate_refined_planes, is_plane_within_external_boundary, plane_keys,
    set_entry_exit_planes,
};
use cslope_engine::model::slope::{AnalysisLimitsPatch, AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::model::surface::{
    circle_to_polyline, default_axis_point, fit_polyline_to_ground, is_admissible_polyline,
    polyline_y_at,
};
use cslope_engine::types::{LineLoad, LineLoadParams, Udl, UdlParams};
use model_core_support::{close, def, material, rng, slope_with, uniform};
use serde_json::{json, Value};
use std::collections::HashSet;

type Pt = [f64; 2];

fn opts(v: Value) -> AnalysisOptionsPatch {
    serde_json::from_value(v).unwrap()
}

fn canonical(d: Value) -> Slope {
    build_slope(&to_canonical_slope_definition(&def(d), None).unwrap()).unwrap()
}

const BOUNDARY: [Pt; 6] = [
    [0.0, -10.0],
    [0.0, 10.0],
    [10.0, 10.0],
    [25.0, 0.0],
    [40.0, 0.0],
    [40.0, -10.0],
];

// ── search-branches.test.ts ───────────────────────────────────────

fn model(coords: &[Pt]) -> Slope {
    slope_with(coords, "S", 19.0, 8.0, 28.0)
}

#[test]
fn generated_planes_property_within_the_limits_longer_than_the_minimum_distance_arc_inside() {
    let mut r = rng(2024);
    for i in 0..8 {
        // property-helpers.ts randomShape / shapeCoordinates
        let h = uniform(&mut r, 5.0, 15.0);
        let run = h * uniform(&mut r, 1.0, 3.0);
        let crest = uniform(&mut r, 8.0, 15.0);
        let toe = uniform(&mut r, 8.0, 15.0);
        let depth = uniform(&mut r, 0.6, 1.2) * h;
        let x_toe = crest + run;
        let x_end = x_toe + toe;
        let coords = [
            [0.0, -depth],
            [0.0, h],
            [crest, h],
            [x_toe, 0.0],
            [x_end, 0.0],
            [x_end, -depth],
        ];
        let mut s = model(&coords);
        let e0 = uniform(&mut r, 0.0, crest * 0.7);
        let x0 = uniform(&mut r, crest + run * 0.6, x_end * 0.9);
        s.set_analysis_limits(&AnalysisLimitsPatch {
            entry_left_x: Some(e0),
            entry_right_x: Some(e0 + crest * 0.3),
            exit_left_x: Some(x0),
            exit_right_x: Some(x_end.min(x0 + 5.0)),
        });
        let mfd = uniform(&mut r, 0.0, 10.0);
        s.update_analysis_options(&opts(json!({ "iterations": 300, "minFailureDist": mfd })))
            .unwrap();
        set_entry_exit_planes(&mut s).unwrap();
        assert!(!s.search().is_empty(), "case {i}");
        let [el, er, xl, xr] = s.search_limits();
        for p in s.search() {
            assert!(p.lc[0] >= el - 1e-9 && p.lc[0] <= er + 1e-9);
            assert!(p.rc[0] >= xl - 1e-9 && p.rc[0] <= xr + 1e-9);
            assert!(p.rc[0] - p.lc[0] > s.min_failure_distance());
            close((p.lc[0] - p.cx).hypot(p.lc[1] - p.cy), p.radius, 6);
            close(p.lc[1], s.get_external_y_intersection(p.lc[0]).unwrap(), 6);
            for t in [0.1, 0.3, 0.5, 0.7, 0.9] {
                let x = p.lc[0] + t * (p.rc[0] - p.lc[0]);
                let y = p.cy
                    - (p.radius * p.radius - (x - p.cx) * (x - p.cx))
                        .max(0.0)
                        .sqrt();
                assert!(
                    s.is_inside_external_boundary(x, y + 1e-6),
                    "case {i} arc at t = {t}"
                );
            }
            if p.cx > p.lc[0] && p.cx < p.rc[0] {
                assert!(
                    s.is_inside_external_boundary(p.cx, p.cy - p.radius + 1e-6),
                    "case {i} lowest point"
                );
            }
        }
    }
}

#[test]
fn many_loads_still_leave_at_least_two_entry_points() {
    let mut s = model(&BOUNDARY);
    s.set_udls(
        (0..30)
            .map(|k| {
                Udl::new(UdlParams {
                    magnitude: 5.0,
                    x1: k as f64 * 0.3,
                    x2: k as f64 * 0.3 + 0.2,
                    ..Default::default()
                })
            })
            .collect(),
    );
    s.set_line_loads(
        (0..10)
            .map(|k| {
                LineLoad::new(LineLoadParams {
                    magnitude: 5.0,
                    x: 1.0 + k as f64 * 0.5,
                    ..Default::default()
                })
            })
            .collect(),
    );
    s.update_analysis_options(&opts(json!({ "iterations": 100 })))
        .unwrap();
    set_entry_exit_planes(&mut s).unwrap();
    assert!(!s.search().is_empty());
}

/// "planes through an entry and an exit point" without the analysis.
#[test]
fn planes_through_an_entry_and_an_exit_point() {
    let mut t = model(&BOUNDARY);
    add_single_entry_exit_plane(&mut t, 5.0, 30.0, 4.0).unwrap();
    assert!(!t.individual_planes().is_empty());
}

#[test]
fn a_circle_that_misses_the_ground_or_leaves_the_model_is_not_added() {
    let mut s = model(&BOUNDARY);
    let before = s.individual_planes().len();
    add_single_circular_plane(&mut s, 20.0, 60.0, 5.0).unwrap();
    // Through the base of the model.
    add_single_circular_plane(&mut s, 22.0, 12.0, 30.0).unwrap();
    assert_eq!(s.individual_planes().len(), before);
}

#[test]
fn a_circle_dipping_a_hair_below_the_model_base_between_the_samples_leaves_the_model() {
    let mut t = model(&BOUNDARY);
    let (cx, radius) = (21.6, 21.0);
    add_single_circular_plane(&mut t, cx, -10.005 + radius, radius).unwrap();
    add_single_circular_plane(&mut t, cx, -9.9 + radius, radius).unwrap();
    assert_eq!(t.individual_planes().len(), 2);
    assert!(!is_plane_within_external_boundary(
        &t,
        &t.individual_planes()[0],
        false
    ));
    assert!(is_plane_within_external_boundary(
        &t,
        &t.individual_planes()[1],
        false
    ));
    t.update_analysis_options(&opts(json!({ "compositeBase": true })))
        .unwrap();
    assert!(is_plane_within_external_boundary(
        &t,
        &t.individual_planes()[0],
        false
    ));
}

#[test]
fn refined_and_local_planes_nothing_without_a_budget_or_valid_seeds() {
    let s = model(&BOUNDARY);
    assert!(generate_refined_planes(&s, &[], 10.0).unwrap().is_empty());
    let p = SearchPlane {
        lc: [5.0, 10.0],
        rc: [30.0, 0.0],
        cx: 20.0,
        cy: 20.0,
        radius: 18.0,
        ..Default::default()
    };
    assert!(generate_refined_planes(&s, std::slice::from_ref(&p), 10.0)
        .unwrap()
        .is_empty());
    let valid = SearchPlane {
        fos: Some(1.2),
        ..p
    };
    assert!(
        generate_refined_planes(&s, std::slice::from_ref(&valid), 0.0)
            .unwrap()
            .is_empty()
    );
    let mut keys = plane_keys(std::slice::from_ref(&valid));
    assert!(
        generate_local_planes(&s, std::slice::from_ref(&valid), 0.0, 1.0, &mut keys, 4)
            .unwrap()
            .is_empty()
    );
    assert!(generate_refined_planes(&s, &[valid], 15.0).unwrap().len() <= 15);
}

// ── search-tangent.test.ts ────────────────────────────────────────

fn two_basins() -> Value {
    let undrained = |name: &str, su: f64| json!({ "name": name, "model": { "kind": "undrained", "unitWeight": 19, "undrainedShearStrength": su } });
    json!({
        "coordinates": [[0, 0], [0, 20], [20, 20], [40, 10], [80, 10], [80, 0]],
        "materials": [undrained("Slope", 30.0), undrained("Found", 45.0)],
        "materialBoundaries": [{ "coordinates": [[-1, 10], [81, 10]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Slope" }, { "point": [1, 5], "materialName": "Found" }],
    })
}

#[test]
fn the_grid_has_circles_tangent_to_the_interface_from_above() {
    let mut slope = canonical(two_basins());
    slope
        .update_analysis_options(&opts(json!({ "iterations": 1000 })))
        .unwrap();
    set_entry_exit_planes(&mut slope).unwrap();
    let tangent: Vec<&SearchPlane> = slope
        .search()
        .iter()
        .filter(|p| p.tangent_to.is_some())
        .collect();
    assert!(tangent.len() > 5);
    for p in tangent {
        let gap = (p.cx.clamp(0.0, 40.0) - p.cx).hypot(10.0 - p.cy) - p.radius;
        assert!(gap >= -1e-6, "{gap}");
        assert!(gap < 1e-3, "{gap}");
    }
}

#[test]
fn the_local_search_also_starts_from_the_best_circle_of_a_second_basin() {
    let mut slope = canonical(two_basins());
    slope
        .update_analysis_options(&opts(json!({ "iterations": 1000 })))
        .unwrap();
    set_entry_exit_planes(&mut slope).unwrap();
    let low = |p: &SearchPlane| p.cy - p.radius;
    let deep: Vec<SearchPlane> = slope
        .search()
        .iter()
        .filter(|p| low(p) < 5.0)
        .take(6)
        .cloned()
        .collect();
    let toe = slope
        .search()
        .iter()
        .find(|p| p.tangent_to.is_some() && p.rc[0] <= 40.0)
        .unwrap()
        .clone();
    let mut planes: Vec<SearchPlane> = deep
        .iter()
        .enumerate()
        .map(|(i, p)| SearchPlane {
            fos: Some(1.0 + i as f64 * 1e-4),
            ..p.clone()
        })
        .collect();
    planes.push(SearchPlane {
        fos: Some(1.005),
        ..toe.clone()
    });
    let near_toe = |local: &[SearchPlane]| {
        local.iter().any(|p| {
            (p.lc[0] - toe.lc[0]).abs() < 2.0 && (p.rc[0] - toe.rc[0]).abs() < 2.0 && low(p) > 9.0
        })
    };
    let local =
        generate_local_planes(&slope, &planes, 10000.0, 1.0, &mut plane_keys(&planes), 4).unwrap();
    assert!(near_toe(&local));
    // A basin far above the best gets no seed.
    let mut far = planes[..planes.len() - 1].to_vec();
    far.push(SearchPlane {
        fos: Some(1.5),
        ..toe.clone()
    });
    let local =
        generate_local_planes(&slope, &far, 10000.0, 1.0, &mut plane_keys(&far), 4).unwrap();
    assert!(!near_toe(&local));
}

// ── search-review-c2.test.ts ──────────────────────────────────────

// ── surface-props.test.ts ─────────────────────────────────────────

fn surface_model(boundary: &[Pt]) -> Slope {
    slope_with(boundary, "S", 19.0, 5.0, 30.0)
}

fn ground(s: &Slope, x: f64) -> f64 {
    s.get_external_y_intersection(x).unwrap()
}

#[test]
fn fit_polyline_property_starts_and_ends_on_the_ground_lies_below_it_follows_the_input() {
    let s = surface_model(&BOUNDARY);
    let mut r = rng(12);
    let mut fitted = 0;
    for i in 0..150 {
        let n = 2 + (r() * 4.0).floor() as usize;
        let mut xs: Vec<f64> = (0..n).map(|_| uniform(&mut r, -5.0, 45.0)).collect();
        cslope_engine::js::array::sort_by(&mut xs, |a, b| a - b);
        let shaped = i % 2 == 0;
        let pts: Vec<Pt> = xs
            .iter()
            .enumerate()
            .map(|(k, &x)| {
                let g = ground(&s, x.clamp(0.0, 40.0));
                if !shaped {
                    return [x, uniform(&mut r, -9.0, 12.0)];
                }
                let end = k == 0 || k == n - 1;
                [
                    x,
                    if end {
                        g + uniform(&mut r, -1.0, 2.0)
                    } else {
                        (-9f64).max(g - uniform(&mut r, 1.0, 6.0))
                    },
                ]
            })
            .collect();
        let Some(out) = fit_polyline_to_ground(&s, &pts) else {
            continue;
        };
        fitted += 1;
        let (a, b) = (out[0], out[out.len() - 1]);
        assert!((a[1] - ground(&s, a[0])).abs() < 1e-6, "case {i} entry");
        assert!((b[1] - ground(&s, b[0])).abs() < 1e-6, "case {i} exit");
        for p in &out[1..out.len() - 1] {
            assert!(p[1] < ground(&s, p[0]) + 1e-9, "case {i}");
        }
        for k in 1..out.len() {
            assert!(out[k][0] > out[k - 1][0]);
        }
        for t in [0.25, 0.5, 0.75] {
            let x = a[0] + t * (b[0] - a[0]);
            if x > xs[0] && x < xs[n - 1] {
                close(polyline_y_at(&out, x), polyline_y_at(&pts, x), 9);
            }
        }
    }
    assert!(fitted > 20);
}

#[test]
fn extends_end_segments_that_stop_below_the_ground() {
    let s = surface_model(&BOUNDARY);
    let out = fit_polyline_to_ground(&s, &[[12.0, 4.0], [18.0, 0.0], [24.0, 0.5]]).unwrap();
    assert!(out[0][0] < 12.0);
    let last = out[out.len() - 1];
    assert!(last[0] > 24.0);
    close(last[1], ground(&s, last[0]), 6);
}

#[test]
fn fit_rejects_degenerate_input() {
    let s = surface_model(&BOUNDARY);
    assert!(fit_polyline_to_ground(&s, &[[5.0, 0.0]]).is_none());
    assert!(fit_polyline_to_ground(&s, &[[5.0, 0.0], [5.0, -1.0], [30.0, -2.0]]).is_none());
    assert!(fit_polyline_to_ground(&s, &[[5.0, f64::NAN], [30.0, -2.0]]).is_none());
    assert!(fit_polyline_to_ground(&s, &[[0.0, 20.0], [40.0, 20.0]]).is_none());
    assert!(fit_polyline_to_ground(&s, &[[5.0, -8.0], [30.0, -9.0]]).is_none());
    assert!(fit_polyline_to_ground(&Slope::new(), &[[5.0, 0.0], [30.0, -2.0]]).is_none());
    assert!(fit_polyline_to_ground(
        &s,
        &[[2.0, 14.0], [f64::NAN, 0.0], [17.0, -2.0], [38.0, 6.0]]
    )
    .is_some());
}

#[test]
fn fit_rejects_a_polyline_that_comes_in_through_the_side_of_the_model() {
    let s = surface_model(&BOUNDARY);
    assert!(fit_polyline_to_ground(
        &s,
        &[[-2.94, -5.26], [-1.17, 6.62], [25.37, 9.91], [30.82, 4.38]]
    )
    .is_none());
    assert!(
        fit_polyline_to_ground(&s, &[[2.0, 12.0], [20.0, -2.0], [41.0, -3.0], [43.0, -8.0]])
            .is_none()
    );
}

#[test]
fn a_surface_starting_on_the_foot_of_a_vertical_face_enters_there() {
    let wall = surface_model(&[
        [0.0, -10.0],
        [0.0, 10.0],
        [10.0, 10.0],
        [10.0, 4.0],
        [25.0, 0.0],
        [40.0, 0.0],
        [40.0, -10.0],
    ]);
    let out = fit_polyline_to_ground(&wall, &[[10.0, 4.0], [20.0, -2.0], [35.0, 2.0]]).unwrap();
    assert_eq!(out[0], [10.0, 4.0]);
}

#[test]
fn is_admissible_polyline_cases() {
    let s = surface_model(&BOUNDARY);
    assert!(is_admissible_polyline(
        &s,
        &[[5.0, 10.0], [15.0, 2.0], [25.0, -2.0], [33.0, 0.0]],
        1.0
    ));
    assert!(!is_admissible_polyline(
        &s,
        &[[5.0, 10.0], [15.0, 6.0], [20.0, -2.0], [33.0, 0.0]],
        1.0
    ));
    assert!(!is_admissible_polyline(
        &s,
        &[[5.0, 10.0], [15.0, 2.0], [15.0, -2.0], [33.0, 0.0]],
        1.0
    ));
    assert!(!is_admissible_polyline(
        &s,
        &[[5.0, 10.0], [15.0, 9.5], [33.0, 0.0]],
        f64::INFINITY
    ));
    assert!(!is_admissible_polyline(
        &s,
        &[[5.0, 10.0], [15.0, -12.0], [33.0, 0.0]],
        f64::INFINITY
    ));
    assert!(!is_admissible_polyline(
        &s,
        &[[5.0, 10.0], [15.0, f64::NAN], [33.0, 0.0]],
        1.0
    ));
    assert!(!is_admissible_polyline(&s, &[[5.0, 10.0]], 1.0));
    assert!(!is_admissible_polyline(
        &Slope::new(),
        &[[5.0, 10.0], [33.0, 0.0]],
        1.0
    ));
}

#[test]
fn surface_helpers() {
    assert!(polyline_y_at(&[[0.0, 0.0], [1.0, 1.0]], 2.0).is_nan());
    assert!(polyline_y_at(&[[0.0, 0.0]], 0.0).is_nan());
    assert_eq!(
        polyline_y_at(&[[0.0, 0.0], [1.0, 1.0], [1.0, 3.0], [2.0, 3.0]], 1.0),
        1.0
    );
    assert_eq!(polyline_y_at(&[[0.0, 0.0], [1.0, 1.0]], 1.0), 1.0);
    let pts = circle_to_polyline(20.0, 20.0, 18.0, [8.0, 6.58], [32.0, 6.58], 7);
    assert_eq!(pts.len(), 7);
    for [x, y] in &pts[1..6] {
        close((x - 20.0).hypot(y - 20.0), 18.0, 9);
    }
    let curved = default_axis_point(&[[0.0, 0.0], [5.0, -3.0], [10.0, 0.0]]);
    close(
        curved[0].hypot(curved[1]),
        (curved[0] - 5.0).hypot(curved[1] + 3.0),
        9,
    );
    let straight = default_axis_point(&[[0.0, 10.0], [10.0, 0.0]]);
    close(straight[0], 15.0, 9);
    close(straight[1], 15.0, 9);
    assert!(default_axis_point(&[[0.0, 0.0], [0.5, -20.0], [10.0, 0.0]])[1] > 0.0);
}

// ── composite.test.ts (the floor; the analyses are deferred) ──────

fn clay() -> Value {
    json!({ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 30 } })
}

fn rock() -> Value {
    json!({ "name": "Rock", "model": { "kind": "impenetrable", "unitWeight": 24 } })
}

fn on_rock(rock_material: Value, rock_name: &str) -> Value {
    json!({
        "coordinates": [[0, 0], [0, 20], [20, 20], [40, 10], [70, 10], [70, 0]],
        "materials": [clay(), rock_material],
        "materialBoundaries": [{ "coordinates": [[-1, 4], [71, 4]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }, { "point": [1, 2], "materialName": rock_name }],
    })
}

#[test]
fn the_floor_is_the_base_of_the_model_and_the_rock_stacked_on_it() {
    let s = canonical(on_rock(rock(), "Rock"));
    let (bx, by) = s.external_boundary_xy();
    let f = composite_floor(bx, by, s.material_geometries(), s.materials(), true).unwrap();
    for x in [1.0, 30.0, 69.0] {
        close(floor_y_at(&f, x, Side::Left), 4.0, 9);
    }
}

#[test]
fn keeps_the_floor_up_to_date_when_a_region_becomes_rock() {
    let sand = json!({ "name": "Sand", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 0, "frictionAngle": 35 } });
    let mut s = canonical(on_rock(sand, "Sand"));
    // no rock on the base: nothing to follow (the bare base only with compositeBase)
    assert!(s.composite_floor().is_none());
    s.update_analysis_options(&opts(json!({ "method": "Bishop", "compositeBase": true })))
        .unwrap();
    close(
        floor_y_at(s.composite_floor().unwrap(), 30.0, Side::Left),
        0.0,
        9,
    );
    s.update_analysis_options(&opts(json!({ "compositeBase": false })))
        .unwrap();
    // (TypeScript analyses the slope here, filling the cache; deferred)
    assert!(s.composite_floor().is_none());
    let rock_id = s.insert_material(material(
        "Rock",
        json!({ "kind": "impenetrable", "unitWeight": 24 }),
    ));
    s.assign_material([1.0, 2.0], rock_id).unwrap();
    close(
        floor_y_at(s.composite_floor().unwrap(), 30.0, Side::Left),
        4.0,
        9,
    );
}

#[test]
fn the_floor_follows_the_bare_base_only_with_composite_base() {
    let on_base = json!({
        "coordinates": [[0, 0], [0, 20], [20, 20], [40, 10], [70, 10], [70, 0]],
        "materials": [clay()],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }],
    });
    let s = canonical(on_base.clone());
    assert!(s.composite_floor().is_none());
    // rock on part of the base: the bare part beside it is listed as bare
    let mut part = on_base;
    part["materials"] = json!([clay(), rock()]);
    part["materialBoundaries"] =
        json!([{ "coordinates": [[50, 0], [50, 4], [71, 4]], "materialName": "" }]);
    part["regionAssignments"] = json!([{ "point": [1, 15], "materialName": "Clay" }, { "point": [60, 2], "materialName": "Rock" }]);
    let s = canonical(part);
    let f = s.composite_floor().unwrap();
    assert_eq!(f.bare, vec![[0.0, 50.0]]);
    close(floor_y_at(f, 60.0, Side::Left), 4.0, 9);
    // a vertical step: from the left the base, from the right the rock
    close(floor_y_at(f, 50.0, Side::Left), 0.0, 9);
    close(floor_y_at(f, 50.0, Side::Right), 4.0, 9);
}

/// The keys of a plane list are unique (dedup in the generators).
#[test]
fn refined_planes_have_unique_keys_and_respect_the_budget() {
    let mut s = canonical(two_basins());
    s.update_analysis_options(&opts(json!({ "iterations": 1000 })))
        .unwrap();
    set_entry_exit_planes(&mut s).unwrap();
    let ranked: Vec<SearchPlane> = s
        .search()
        .iter()
        .enumerate()
        .map(|(i, p)| SearchPlane {
            fos: Some(1.0 + (i % 37) as f64 / 37.0),
            ..p.clone()
        })
        .collect();
    let refined = generate_refined_planes(&s, &ranked, 200.0).unwrap();
    assert!(refined.len() <= 200 && !refined.is_empty());
    let keys = plane_keys(&ranked);
    let mut seen = HashSet::new();
    for p in &refined {
        let k = cslope_engine::model::search::plane_key(p);
        assert!(!keys.contains(&k));
        assert!(seen.insert(k));
    }
}

// ── A side of the search given as a point (issue #157) ────────────

/// The first pass on BOUNDARY (crest y = 10 to x = 10, toe at x = 25,
/// floor y = 0 to x = 40) at 1 000 iterations.
fn first_pass(limits: [f64; 4]) -> (Slope, Vec<SearchPlane>) {
    let mut s = model(&BOUNDARY);
    s.set_analysis_limits(&AnalysisLimitsPatch {
        entry_left_x: Some(limits[0]),
        entry_right_x: Some(limits[1]),
        exit_left_x: Some(limits[2]),
        exit_right_x: Some(limits[3]),
    });
    s.update_analysis_options(&opts(json!({ "iterations": 1000 })))
        .unwrap();
    let planes = entry_exit_planes(&s).unwrap();
    (s, planes)
}

/// The distinct values, to within 1e-7.
fn distinct(xs: impl Iterator<Item = f64>) -> Vec<f64> {
    let mut v: Vec<f64> = xs.collect();
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    v.dedup_by(|a, b| (*a - *b).abs() < 1e-7);
    v
}

#[test]
fn a_side_given_as_a_point_has_one_point_in_the_first_pass() {
    // An exit at one x on the floor: one exit point, and no circle twice
    // (before, all 16 exit points of the grid lay there).
    let (_, planes) = first_pass([1.0, 8.0, 32.0, 32.0]);
    assert!(!planes.is_empty());
    let exits = distinct(planes.iter().map(|p| p.rc[0]));
    assert_eq!(exits.len(), 1);
    close(exits[0], 32.0, 7);
    assert!(distinct(planes.iter().map(|p| p.lc[0])).len() > 1);
    assert_eq!(plane_keys(&planes).len(), planes.len());
    assert!(planes.len() <= 14 * 5, "{}", planes.len());
    // An entry at one x on the crest.
    let (_, planes) = first_pass([5.0, 5.0, 26.0, 38.0]);
    assert!(!planes.is_empty());
    let entries = distinct(planes.iter().map(|p| p.lc[0]));
    assert_eq!(entries.len(), 1);
    close(entries[0], 5.0, 7);
    assert!(distinct(planes.iter().map(|p| p.rc[0])).len() > 1);
    assert_eq!(plane_keys(&planes).len(), planes.len());
    assert!(planes.len() <= 16 * 5, "{}", planes.len());
}

/// A seed of the local search whose exit lies on the exit limit, as a
/// crossing with the ground computed a few ulps outside it: its circles
/// with the exit unmoved are tried, as for a seed exactly on the limit.
/// (Before, they were dropped; at the toe, where the circles through the
/// moved exits all left the limits, the level was empty and ended the local
/// search: issue #160, step 0.)
#[test]
fn the_local_search_keeps_the_exit_of_a_seed_on_the_limit() {
    let w = 1e-5 * 40.0;
    let (s, planes) = first_pass([1.0, 8.0, 25.0, 30.0]);
    let limit = s.search_limits()[2];
    assert_eq!(limit, 25.0 - w);
    let on_limit = |p: &SearchPlane| (p.rc[0] - limit).abs() < 1e-7;
    let base = planes
        .iter()
        .find(|p| on_limit(p) && p.lc[0] > 4.0)
        .expect("a first-pass circle exiting at the limit")
        .clone();
    for rc_x in [limit, limit - 1e-12] {
        let seed = SearchPlane {
            rc: [rc_x, base.rc[1]],
            fos: Some(1.0),
            ..base.clone()
        };
        let seeds = vec![seed];
        let local =
            generate_local_planes(&s, &seeds, 1000.0, 1.0, &mut plane_keys(&seeds), 4).unwrap();
        // The entry and the sagitta move with the exit kept: 3 × 3 − 1
        // circles, all with the seed's exit.
        let kept = local.iter().filter(|p| on_limit(p)).count();
        assert!(kept >= 8, "rc {rc_x}: {kept} of {}", local.len());
    }
}

#[test]
fn a_point_on_a_corner_is_the_two_ends_of_its_widened_limit() {
    let w = 1e-5 * 40.0;
    // The exit at the toe: the search limit runs from just above the toe
    // to the toe, and its circles go through those two ends only (before,
    // through 16 exit points spread over the 0.4 mm).
    let (s, planes) = first_pass([1.0, 8.0, 25.0, 25.0]);
    assert_eq!(s.search_limits(), [1.0, 8.0, 25.0 - w, 25.0]);
    assert!(!planes.is_empty());
    for x in distinct(planes.iter().map(|p| p.rc[0])) {
        assert!(
            (x - (25.0 - w)).abs() < 1e-7 || (x - 25.0).abs() < 1e-7,
            "exit {x}"
        );
    }
    // An entry on the crest's corner, widened to both sides.
    let (s, planes) = first_pass([10.0, 10.0, 26.0, 38.0]);
    assert_eq!(s.search_limits(), [10.0 - w, 10.0 + w, 26.0, 38.0]);
    assert!(!planes.is_empty());
    for x in distinct(planes.iter().map(|p| p.lc[0])) {
        assert!(
            (x - (10.0 - w)).abs() < 1e-7 || (x - (10.0 + w)).abs() < 1e-7,
            "entry {x}"
        );
    }
}
