//! Ported unit tests of model/optimize.ts (optimize.test.ts) and
//! model/block-search.ts (block-search.test.ts), plus the parallel
//! determinism of both: serial and rayon evaluation give the same planes
//! bit for bit (the engine side of parallel-search.test.ts).
#![allow(clippy::disallowed_methods)]

mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::{
    opposite_direction_definition, to_canonical_slope_definition,
};
use cslope_engine::model::optimize::{optimise_non_circular, OptimiseOptions};
use cslope_engine::model::search::add_single_circular_plane;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisLimitsPatch, AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::model::solvers::{analyse_bishop, analyse_slope};
use cslope_engine::model::surface::is_admissible_polyline;
use cslope_engine::types::material::{Material, MaterialParams};
use cslope_engine::types::SlopeDefinition;
use serde_json::{json, Value};
use std::cell::RefCell;

fn patch(v: Value) -> AnalysisOptionsPatch {
    serde_json::from_value(v).unwrap()
}

// ── optimize.test.ts ──────────────────────────────────────────────

fn model() -> Slope {
    let mut s = Slope::new();
    s.add_material(
        Material::new(MaterialParams {
            name: Some("S".into()),
            unit_weight: Some(19.0),
            cohesion: Some(8.0),
            friction_angle: Some(28.0),
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
    s.update_analysis_options(&patch(
        json!({ "slices": 25, "tolerance": 1e-6, "maxIterations": 50 }),
    ))
    .unwrap();
    s
}

fn bishop(s: &Slope, p: &SearchPlane) -> Option<f64> {
    let mut sl = get_slices(
        s,
        p.lc[0],
        p.rc[0],
        p.cx,
        p.cy,
        p.radius,
        p.points.as_deref(),
        &mut SliceScratch::new(),
    )
    .unwrap();
    if sl.is_empty() {
        return None;
    }
    analyse_bishop(s, &mut sl, None).0
}

fn seeds(s: &mut Slope) -> Vec<SearchPlane> {
    for [cx, cy, r] in [[22.0, 18.0, 18.5], [20.0, 22.0, 21.0], [24.0, 15.0, 16.0]] {
        add_single_circular_plane(s, cx, cy, r).unwrap();
    }
    let mut planes = s.individual_planes().to_vec();
    for p in planes.iter_mut() {
        p.fos = bishop(s, p);
    }
    planes
}

#[test]
fn candidates_respect_limits_distance_depth_and_budget_results_beat_their_seeds() {
    let mut s = model();
    s.set_analysis_limits(&AnalysisLimitsPatch {
        entry_left_x: Some(2.0),
        entry_right_x: Some(9.0),
        exit_left_x: Some(22.0),
        exit_right_x: Some(36.0),
    });
    s.update_analysis_options(&patch(json!({ "minFailureDist": 15, "minSlipDepth": 1.5 })))
        .unwrap();
    let start = seeds(&mut s);
    let seen: RefCell<Vec<SearchPlane>> = RefCell::new(Vec::new());
    let out = optimise_non_circular(
        &s,
        &start,
        |sl, planes| {
            for p in planes.iter_mut() {
                p.fos = bishop(sl, p);
                seen.borrow_mut().push(p.clone());
            }
            Ok(())
        },
        OptimiseOptions {
            budget_per_seed: Some(120.0),
        },
    )
    .unwrap();
    let seen = seen.into_inner();
    assert!(!out.is_empty());
    // The budget of each seed, and twice that for the best surface's
    // further optimisation.
    assert!(seen.len() <= 120 * (start.len() + 2));
    let [el, er, xl, xr] = s.limits();
    for p in &seen[3..] {
        let pts = p.points.as_ref().unwrap();
        assert!(pts[pts.len() - 1][0] - pts[0][0] > 15.0);
        assert!(is_admissible_polyline(&s, pts, 1.0));
        let mut depth: f64 = 0.0;
        for &[x, y] in pts {
            depth = depth.max(s.get_external_y_intersection(x).unwrap() - y);
        }
        assert!(depth >= 1.5);
    }
    let best_seed = start
        .iter()
        .map(|p| p.fos.unwrap())
        .fold(f64::INFINITY, f64::min);
    for p in &out {
        let pts = p.points.as_ref().unwrap();
        assert!(pts[0][0] >= el - 1e-9 && pts[0][0] <= er + 1e-9);
        assert!(p.rc[0] >= xl - 1e-9 && p.rc[0] <= xr + 1e-9);
    }
    // The best optimised surface is at most the polyline of the best seed
    // circle (which is within 1 % of the circle itself).
    let best = out
        .iter()
        .map(|p| p.fos.unwrap())
        .fold(f64::INFINITY, f64::min);
    assert!(best < best_seed * 1.01);
}

#[test]
fn no_seeds_polylines_and_invalid_surfaces_are_skipped() {
    let mut s = model();
    let start = seeds(&mut s);
    let evaluate = |sl: &Slope, planes: &mut [SearchPlane]| {
        for p in planes.iter_mut() {
            p.fos = bishop(sl, p);
        }
        Ok(())
    };
    let polylines: Vec<SearchPlane> = start
        .iter()
        .map(|p| SearchPlane {
            points: Some(vec![p.lc, p.rc]),
            ..p.clone()
        })
        .collect();
    assert!(
        optimise_non_circular(&s, &polylines, evaluate, OptimiseOptions::default())
            .unwrap()
            .is_empty()
    );
    let unsolved: Vec<SearchPlane> = start
        .iter()
        .map(|p| SearchPlane {
            fos: None,
            ..p.clone()
        })
        .collect();
    assert!(
        optimise_non_circular(&s, &unsolved, evaluate, OptimiseOptions::default())
            .unwrap()
            .is_empty()
    );
    let failing = |_: &Slope, planes: &mut [SearchPlane]| {
        for p in planes.iter_mut() {
            p.fos = None;
        }
        Ok(())
    };
    assert!(
        optimise_non_circular(&s, &start, failing, OptimiseOptions::default())
            .unwrap()
            .is_empty()
    );
}

#[test]
fn a_budget_of_one_evaluation_returns_the_seeds_polyline() {
    let mut s = model();
    let start = seeds(&mut s);
    let seen: RefCell<Vec<SearchPlane>> = RefCell::new(Vec::new());
    let out = optimise_non_circular(
        &s,
        &start[..1],
        |sl, planes| {
            for p in planes.iter_mut() {
                p.fos = bishop(sl, p);
                seen.borrow_mut().push(p.clone());
            }
            Ok(())
        },
        OptimiseOptions {
            budget_per_seed: Some(1.0),
        },
    )
    .unwrap();
    let seen = seen.into_inner();
    assert_eq!(out.len(), 1);
    assert_eq!(seen.len(), 1);
    assert_eq!(out[0].fos, seen[0].fos);
}

// ── block-search.test.ts ──────────────────────────────────────────

fn mc(name: &str, c: f64, phi: f64) -> Value {
    json!({ "name": name, "model": { "kind": "mohr-coulomb", "unitWeight": 18.84, "cohesion": c, "frictionAngle": phi } })
}

/// ACADS problem 3(a) (Giam & Donald 1989), as V050b, sliding to the left.
fn acads3a() -> Value {
    json!({
        "coordinates": [[20, 20], [20, 27.75], [43, 27.75], [67.5, 40], [84, 40], [84, 20]],
        "materials": [mc("Soil 1", 28.5, 20.0), mc("Weak layer", 0.0, 10.0), mc("Soil 1 below", 28.5, 20.0)],
        "materialBoundaries": [
            { "coordinates": [[19, 27], [85, 27]], "materialName": "" },
            { "coordinates": [[19, 26.5], [85, 26.5]], "materialName": "" },
        ],
        "regionAssignments": [
            { "point": [20.64, 27.05], "materialName": "Soil 1" },
            { "point": [20.64, 26.75], "materialName": "Weak layer" },
            { "point": [20.64, 23.25], "materialName": "Soil 1 below" },
        ],
        "orientation": "rtl",
        "waterTable": { "mode": "custom", "value": [[20, 26.5], [84, 26.5]] },
    })
}

fn layer_lines() -> Value {
    json!([{ "points": [[25, 26.75], [50, 26.75]] }, { "points": [[50, 26.75], [80, 26.75]] }])
}

fn with(def: Value, extra: Value) -> Value {
    let mut d = def;
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    d
}

struct Run {
    fos: Option<f64>,
    slope: Slope,
}

impl Run {
    fn valid(&self) -> Vec<&SearchPlane> {
        self.slope
            .search()
            .iter()
            .filter(|p| p.fos.is_some())
            .collect()
    }
}

fn run(def: Value, options: Value) -> cslope_engine::error::Result<Run> {
    run_with(def, options, &mut RunCtx::default())
}

fn run_with(def: Value, options: Value, ctx: &mut RunCtx) -> cslope_engine::error::Result<Run> {
    let def: SlopeDefinition = serde_json::from_value(def).unwrap();
    let canonical = to_canonical_slope_definition(&def, None)?;
    let mut slope = build_slope(&canonical)?;
    let spencer = json!({
        "method": "Morgenstern-Price", "intersliceFunction": "constant", "slices": 40,
        "tolerance": 0.001, "iterations": 500, "refinedIterations": 300, "searchMethod": "block",
    });
    slope.update_analysis_options(&patch(with(spencer, options)))?;
    let fos = analyse_slope(&mut slope, ctx)?;
    Ok(Run { fos, slope })
}

/// Inclination (°) of a segment from the horizontal.
fn inclination(a: [f64; 2], b: [f64; 2]) -> f64 {
    ((b[1] - a[1]).abs().atan2((b[0] - a[0]).abs()) * 180.0) / std::f64::consts::PI
}

fn close(a: f64, b: f64, digits: i32) -> bool {
    (a - b).abs() < 10f64.powi(-digits) / 2.0
}

#[test]
fn block_finds_the_sliding_along_a_weak_layer_that_the_circles_miss() {
    let r = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({}),
    )
    .unwrap();
    let fos = r.fos.unwrap();
    // Below the best circle (≈ 1.51), within reach of the ACADS range.
    assert!(fos < 1.35 && fos > 1.2, "{fos}");
    let valid = r.valid();
    assert!(valid.len() > 400);
    // Every surface: entry, one base point on each line, exit.
    for p in valid.iter().take(50) {
        let pts = p.points.as_ref().unwrap();
        assert_eq!(pts.len(), 4);
        assert!(close(pts[1][1], 26.75, 9));
        assert!(close(pts[2][1], 26.75, 9));
    }
}

#[test]
fn block_uses_the_rankine_angles_by_default() {
    let r = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({}),
    )
    .unwrap();
    // In canonical coordinates the entry is on the left; the soil above
    // the layer has φ = 20°, so 55° and 35°.
    for p in r.valid().iter().take(50) {
        let pts = p.points.as_ref().unwrap();
        assert!(close(inclination(pts[0], pts[1]), 55.0, 6));
        assert!(close(inclination(pts[2], pts[3]), 35.0, 6));
    }
}

#[test]
fn block_draws_the_end_segments_within_the_given_angle_ranges() {
    let r = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({ "blockActiveAngle": [40, 70], "blockPassiveAngle": [15, 40] }),
    )
    .unwrap();
    assert!(r.fos.is_some());
    for p in r.valid() {
        let pts = p.points.as_ref().unwrap();
        let a = inclination(pts[0], pts[1]);
        let b = inclination(pts[2], pts[3]);
        assert!((40.0 - 1e-9..=70.0 + 1e-9).contains(&a));
        assert!((15.0 - 1e-9..=40.0 + 1e-9).contains(&b));
    }
}

#[test]
fn block_keeps_base_points_inside_windows() {
    let window = |x0: f64, x1: f64| json!({ "points": [[x0, 26.55], [x1, 26.55], [x1, 26.95], [x0, 26.95]] });
    let r = run(
        with(
            acads3a(),
            json!({ "blockSearchObjects": [window(25.0, 50.0), window(50.0, 80.0)] }),
        ),
        json!({}),
    )
    .unwrap();
    assert!(r.fos.is_some());
    for p in r.valid() {
        let pts = p.points.as_ref().unwrap();
        for &[x, y] in &pts[1..pts.len() - 1] {
            assert!((26.55 - 1e-9..=26.95 + 1e-9).contains(&y));
            // Canonical coordinates are mirrored about the model's x range (20–84).
            assert!((25.0 - 1e-9..=80.0 + 1e-9).contains(&(104.0 - x)));
        }
    }
}

#[test]
fn block_is_repeatable() {
    let a = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({}),
    )
    .unwrap();
    let b = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({}),
    )
    .unwrap();
    assert_eq!(a.fos, b.fos);
    assert_eq!(a.valid().len(), b.valid().len());
}

#[test]
fn block_gives_the_same_surface_and_fos_mirrored() {
    let rtl = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({}),
    )
    .unwrap();
    let mirror = |pts: &Value| -> Value {
        Value::Array(
            pts.as_array()
                .unwrap()
                .iter()
                .map(|p| json!([104.0 - p[0].as_f64().unwrap(), p[1]]))
                .collect(),
        )
    };
    let a = acads3a();
    let ltr_def = with(
        a.clone(),
        json!({
            "orientation": "ltr",
            "coordinates": mirror(&a["coordinates"]),
            "materialBoundaries": a["materialBoundaries"].as_array().unwrap().iter()
                .map(|b| json!({ "coordinates": mirror(&b["coordinates"]), "materialName": b["materialName"] })).collect::<Vec<_>>(),
            "regionAssignments": a["regionAssignments"].as_array().unwrap().iter()
                .map(|r| json!({ "point": [104.0 - r["point"][0].as_f64().unwrap(), r["point"][1]], "materialName": r["materialName"] })).collect::<Vec<_>>(),
            "blockSearchObjects": layer_lines().as_array().unwrap().iter()
                .map(|o| json!({ "points": mirror(&o["points"]) })).collect::<Vec<_>>(),
        }),
    );
    let ltr = run(ltr_def, json!({})).unwrap();
    assert!(close(ltr.fos.unwrap(), rtl.fos.unwrap(), 9));
}

#[test]
fn block_analyses_a_single_surface_through_fixed_points_as_the_same_custom_surface() {
    let block = run(
        with(acads3a(), json!({ "blockSearchObjects": [{ "points": [[40, 26.75]] }, { "points": [[60, 26.75]] }] })),
        json!({}),
    )
    .unwrap();
    let valid = block.valid();
    assert_eq!(valid.len(), 1);
    let surface: Vec<Value> = valid[0]
        .points
        .as_ref()
        .unwrap()
        .iter()
        .map(|&[x, y]| json!([104.0 - x, y]))
        .collect();
    let custom = run(
        with(
            acads3a(),
            json!({ "customSurfaces": [{ "points": surface }], "customPlanesOnly": true }),
        ),
        json!({ "searchMethod": "circular" }),
    )
    .unwrap();
    assert!(close(custom.fos.unwrap(), block.fos.unwrap(), 6));
}

#[test]
fn block_keeps_entry_and_exit_within_the_search_limits() {
    let r = run(
        with(
            acads3a(),
            json!({
                "blockSearchObjects": layer_lines(),
                "analysisLimits": { "entryLeftX": 72, "entryRightX": 80, "exitLeftX": 40, "exitRightX": 46 },
            }),
        ),
        json!({ "blockActiveAngle": [35, 80], "blockPassiveAngle": [5, 60] }),
    )
    .unwrap();
    let valid = r.valid();
    assert!(!valid.is_empty());
    for p in valid {
        // Canonical: entry on the left, mirrored from the model's crest side.
        assert!((72.0 - 1e-9..=80.0 + 1e-9).contains(&(104.0 - p.lc[0])));
        assert!((40.0 - 1e-9..=46.0 + 1e-9).contains(&(104.0 - p.rc[0])));
    }
}

#[test]
fn block_optimises_the_best_block_surfaces_on_request() {
    let plain = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({}),
    )
    .unwrap();
    let optimised = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        json!({ "nonCircularOptimization": true }),
    )
    .unwrap();
    assert!(optimised.fos.unwrap() < plain.fos.unwrap());
    // Optimised surfaces are no duplicates of the block surfaces (TypeScript
    // compares by identity; a seed returned unchanged would be the same
    // surface twice, with the same points and factor).
    let search = optimised.slope.search();
    let mut keys: Vec<String> = search
        .iter()
        .map(|p| format!("{:?}|{:?}|{:?}|{}", p.points, p.fos, p.optimised, p.cx))
        .collect();
    keys.sort();
    keys.dedup();
    assert_eq!(keys.len(), search.len());
}

#[test]
fn block_keeps_the_objects_for_the_opposite_direction() {
    let def: SlopeDefinition = serde_json::from_value(with(
        acads3a(),
        json!({ "blockSearchObjects": layer_lines() }),
    ))
    .unwrap();
    let canonical = to_canonical_slope_definition(&def, None).unwrap();
    let opposite = opposite_direction_definition(&canonical).unwrap();
    assert_eq!(opposite.block_search_objects.unwrap().len(), 2);
}

#[test]
fn block_needs_search_objects_and_valid_angle_ranges() {
    let msg = |r: cslope_engine::error::Result<Run>| r.err().expect("an error").message;
    assert!(msg(run(acads3a(), json!({}))).contains("at least one search object"));
    let lines = with(acads3a(), json!({ "blockSearchObjects": layer_lines() }));
    assert!(
        msg(run(lines.clone(), json!({ "blockActiveAngle": [60, 40] })))
            .contains("blockActiveAngle")
    );
    assert!(msg(run(lines, json!({ "blockPassiveAngle": [0, 40] }))).contains("blockPassiveAngle"));
    assert!(msg(run(
        with(
            acads3a(),
            json!({ "blockSearchObjects": [{ "points": [[30, 26], [40, 26], [50, 26]] }] })
        ),
        json!({})
    ))
    .contains("no area"));
    assert!(msg(run(
        with(
            acads3a(),
            json!({ "blockSearchObjects": [{ "points": [[30, 26], [30, 26]] }] })
        ),
        json!({})
    ))
    .contains("coincide"));
}

#[test]
fn block_leaves_the_circular_search_unchanged_when_not_selected() {
    let o = json!({ "searchMethod": "circular", "iterations": 500, "refinedIterations": 0 });
    let with_objects = run(
        with(acads3a(), json!({ "blockSearchObjects": layer_lines() })),
        o.clone(),
    )
    .unwrap();
    let without = run(acads3a(), o).unwrap();
    assert_eq!(with_objects.fos, without.fos);
}

// ── parallel determinism (parallel-search.test.ts, engine side) ───

#[cfg(feature = "rayon")]
#[test]
fn serial_and_rayon_give_the_same_optimised_and_block_searches_bit_for_bit() {
    use cslope_engine::api::ctx::Rayon;
    let same = |a: &Run, b: &Run| {
        assert_eq!(a.fos.map(f64::to_bits), b.fos.map(f64::to_bits));
        assert_eq!(a.slope.search().len(), b.slope.search().len());
        for (p, q) in a.slope.search().iter().zip(b.slope.search()) {
            assert_eq!(p.fos.map(f64::to_bits), q.fos.map(f64::to_bits));
            assert_eq!(p.points, q.points);
            assert_eq!(p.lff_array, q.lff_array);
        }
    };
    let rayon = Rayon::default();
    for options in [json!({}), json!({ "nonCircularOptimization": true })] {
        let def = with(acads3a(), json!({ "blockSearchObjects": layer_lines() }));
        let serial = run(def.clone(), options.clone()).unwrap();
        let parallel = run_with(def, options, &mut RunCtx::with_evaluator(&rayon)).unwrap();
        same(&serial, &parallel);
    }
    // the non-circular optimisation of circles (V050b-like ACADS model, circular search)
    let o = json!({ "searchMethod": "circular", "iterations": 300, "refinedIterations": 200, "nonCircularOptimization": true });
    let serial = run(acads3a(), o.clone()).unwrap();
    let parallel = run_with(acads3a(), o, &mut RunCtx::with_evaluator(&rayon)).unwrap();
    assert!(serial
        .slope
        .search()
        .iter()
        .any(|p| p.optimised == Some(true)));
    same(&serial, &parallel);
}
