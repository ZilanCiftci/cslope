//! The analyses PORTING.md deferred to the solver phase from
//! composite.test.ts (composite circles: the five analyses and "keeps the
//! floor up to date"), search-branches.test.ts ("planes through an entry and
//! an exit point") and search-tangent.test.ts ("does not get worse with more
//! iterations", "an impenetrable layer gives the circle tangent to it", both
//! "below the minimum slip size").
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::composite::floor_y_at;
use cslope_engine::model::geometry_ops::Side;
use cslope_engine::model::search::add_single_entry_exit_plane;
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::{Material, MaterialParams, SlopeDefinition};
use model_core_support::{close, material};
use serde_json::{json, Value};
use solvers_support::run_verification;

fn with(m: Value, extra: Value) -> Value {
    let mut m = m;
    for (k, v) in extra.as_object().unwrap() {
        m[k] = v.clone();
    }
    m
}

fn clay() -> Value {
    json!({ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 30 } })
}

fn rock() -> Value {
    json!({ "name": "Rock", "model": { "kind": "impenetrable", "unitWeight": 24 } })
}

const GROUND: [[f64; 2]; 4] = [[0.0, 20.0], [20.0, 20.0], [40.0, 10.0], [70.0, 10.0]];

fn coords() -> Value {
    let mut c = vec![json!([0, 0])];
    c.extend(GROUND.iter().map(|p| json!(p)));
    c.push(json!([70, 0]));
    Value::Array(c)
}

fn circle(d: &Value, cx: f64, cy: f64, radius: f64, extra: Value) -> (Option<f64>, Slope) {
    let mut d = d.clone();
    d["customSearchPlanes"] = json!([{ "cx": cx, "cy": cy, "radius": radius }]);
    d["customPlanesOnly"] = json!(true);
    run_verification(d, "Bishop", with(json!({ "slices": 40 }), extra))
}

/// clay on rock at y = 4 (the model base at y = 0)
fn on_rock() -> Value {
    json!({
        "coordinates": coords(),
        "materials": [clay(), rock()],
        "materialBoundaries": [{ "coordinates": [[-1, 4], [71, 4]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }, { "point": [1, 2], "materialName": "Rock" }],
    })
}

fn canonical(d: Value) -> Slope {
    let d: SlopeDefinition = serde_json::from_value(d).unwrap();
    build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap()
}

fn min_composite_y(s: &Slope) -> f64 {
    s.search()[0]
        .composite
        .as_ref()
        .unwrap()
        .iter()
        .fold(f64::INFINITY, |m, p| m.min(p[1]))
}

#[test]
fn follows_the_rock_where_the_circle_goes_below_it() {
    let (fos, slope) = circle(&on_rock(), 32.0, 22.0, 21.0, json!({}));
    assert!(fos.is_some());
    close(min_composite_y(&slope), 4.0, 9);
    // the slices along the rock: straight, level, in the clay
    let p = &slope.search()[0];
    let flat: Vec<_> = p
        .slices
        .as_ref()
        .unwrap()
        .iter()
        .filter(|s| s.circular != Some(true))
        .collect();
    assert!(flat.len() > 2);
    for sl in flat {
        close(sl.y0_bottom, 4.0, 9);
        assert_eq!(slope.material(sl.base_material.unwrap()).name, "Clay");
    }
    assert!(circle(
        &on_rock(),
        32.0,
        22.0,
        21.0,
        json!({ "compositeSurfaces": false })
    )
    .0
    .is_none());
}

#[test]
fn does_not_follow_a_lens_of_rock_with_soil_below_it() {
    // a lens of rock at y 6–7, x 28–34, above the circle's lowest part (y 4)
    let lens = json!({
        "coordinates": coords(),
        "materials": [clay(), rock()],
        "materialBoundaries": [{ "coordinates": [[28, 6], [34, 6], [34, 7], [28, 7], [28, 6]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }, { "point": [31, 6.5], "materialName": "Rock" }],
    });
    let (fos, slope) = circle(&lens, 32.0, 26.0, 22.0, json!({}));
    assert!(fos.is_some());
    assert!(slope.search()[0].composite.is_none());
    close(
        fos.unwrap(),
        circle(
            &lens,
            32.0,
            26.0,
            22.0,
            json!({ "compositeSurfaces": false }),
        )
        .0
        .unwrap(),
        12,
    );
}

#[test]
fn is_not_analysed_where_the_floor_reaches_the_ground() {
    // the rock rises to the ground at the toe, x 50–70
    let outcrop = json!({
        "coordinates": [[0, 0], [0, 20], [20, 20], [40, 10], [50, 10], [70, 10], [70, 0]],
        "materials": [clay(), rock()],
        "materialBoundaries": [{ "coordinates": [[-1, 4], [44, 4], [50, 10]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }, { "point": [60, 5], "materialName": "Rock" }],
    });
    assert!(circle(&outcrop, 40.0, 30.0, 27.0, json!({})).0.is_none());
}

#[test]
fn follows_the_bare_base_of_the_model_only_with_composite_base() {
    let on_base = json!({ "coordinates": coords(), "materials": [clay()], "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }] });
    // lowest point y = -1, below the base
    assert!(circle(&on_base, 32.0, 22.0, 23.0, json!({})).0.is_none());
    let (fos, along) = circle(&on_base, 32.0, 22.0, 23.0, json!({ "compositeBase": true }));
    assert!(fos.is_some());
    close(min_composite_y(&along), 0.0, 9);
    // rock on part of the base: a circle through the bare base beside it is still not analysed
    let mut part = on_base;
    part["materials"] = json!([clay(), rock()]);
    part["materialBoundaries"] =
        json!([{ "coordinates": [[50, 0], [50, 4], [71, 4]], "materialName": "" }]);
    part["regionAssignments"] = json!([{ "point": [1, 15], "materialName": "Clay" }, { "point": [60, 2], "materialName": "Rock" }]);
    assert!(circle(&part, 32.0, 22.0, 23.0, json!({})).0.is_none());
    assert!(
        circle(&part, 32.0, 22.0, 23.0, json!({ "compositeBase": true }))
            .0
            .is_some()
    );
}

#[test]
fn analyses_the_circle_the_search_finds_tangent_to_the_bare_base() {
    // rock on the base far from the slope; the circle dips 0.9 µm below the
    // base, within the search's tolerance: a circle, not one through the base
    let h = 5.0;
    let mk = |m: Value| {
        let name = m["name"].clone();
        json!({
            "coordinates": [[0, 0], [0, h], [2.0 * h, h], [4.0 * h, h / 2.0], [7.0 * h, h / 2.0], [7.0 * h, 0]],
            "materials": [{ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 10 } }, m],
            "materialBoundaries": [{ "coordinates": [[6.0 * h, 0], [6.0 * h, 0.1 * h], [7.0 * h + 1.0, 0.1 * h]], "materialName": "" }],
            "regionAssignments": [{ "point": [1, h * 0.9], "materialName": "Clay" }, { "point": [6.5 * h, 0.05 * h], "materialName": name }],
        })
    };
    let sand = json!({ "name": "Sand", "model": { "kind": "mohr-coulomb", "unitWeight": 24, "cohesion": 50, "frictionAngle": 40 } });
    let fos = |m: Value| circle(&mk(m), 14.97, 9.78 - 9e-7, 9.78, json!({ "slices": 30 })).0;
    assert!(fos(rock()).is_some());
    close(fos(rock()).unwrap(), fos(sand).unwrap(), 9);
}

#[test]
fn keeps_the_floor_up_to_date_when_a_region_becomes_rock() {
    let mut d = on_rock();
    d["materials"] = json!([clay(), { "name": "Sand", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 0, "frictionAngle": 35 } }]);
    d["regionAssignments"] = json!([{ "point": [1, 15], "materialName": "Clay" }, { "point": [1, 2], "materialName": "Sand" }]);
    let mut s = canonical(d);
    // no rock on the base: nothing to follow (the bare base is followed only with compositeBase)
    assert!(s.composite_floor().is_none());
    s.update_analysis_options(
        &serde_json::from_value(json!({ "method": "Bishop", "compositeBase": true })).unwrap(),
    )
    .unwrap();
    close(
        floor_y_at(s.composite_floor().unwrap(), 30.0, Side::Left),
        0.0,
        9,
    );
    s.update_analysis_options(&serde_json::from_value(json!({ "compositeBase": false })).unwrap())
        .unwrap();
    analyse_slope(&mut s, &mut RunCtx::default()).unwrap();
    let r = s.insert_material(material(
        "Rock",
        json!({ "kind": "impenetrable", "unitWeight": 24 }),
    ));
    s.assign_material([1.0, 2.0], r).unwrap();
    close(
        floor_y_at(s.composite_floor().unwrap(), 30.0, Side::Left),
        4.0,
        9,
    );
}

// ── search-branches.test.ts ───────────────────────────────────────

#[test]
fn planes_through_an_entry_and_an_exit_point() {
    let mut t = Slope::new();
    t.add_material(
        Material::new(MaterialParams {
            name: Some("S".into()),
            unit_weight: Some(19.0),
            cohesion: Some(8.0),
            friction_angle: Some(28.0),
            ..Default::default()
        })
        .unwrap(),
    );
    t.set_external_boundary(&[
        [0.0, -10.0],
        [0.0, 10.0],
        [10.0, 10.0],
        [25.0, 0.0],
        [40.0, 0.0],
        [40.0, -10.0],
    ])
    .unwrap();
    add_single_entry_exit_plane(&mut t, 5.0, 30.0, 4.0).unwrap();
    assert!(!t.individual_planes().is_empty());
    t.set_custom_planes_only(true);
    assert!(
        analyse_slope(&mut t, &mut RunCtx::default())
            .unwrap()
            .unwrap()
            > 0.0
    );
}

// ── search-tangent.test.ts ────────────────────────────────────────

fn undrained(name: &str, su: f64) -> Value {
    json!({ "name": name, "model": { "kind": "undrained", "unitWeight": 19, "undrainedShearStrength": su } })
}

/// 2:1 slope, H = 10 m, Su 30 kPa over Su 45 kPa from the toe level down.
fn two_basins() -> Value {
    json!({
        "coordinates": [[0, 0], [0, 20], [20, 20], [40, 10], [80, 10], [80, 0]],
        "materials": [undrained("Slope", 30.0), undrained("Found", 45.0)],
        "materialBoundaries": [{ "coordinates": [[-1, 10], [81, 10]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Slope" }, { "point": [1, 5], "materialName": "Found" }],
    })
}

fn run(d: Value, options: Value) -> (f64, Slope) {
    let mut slope = canonical(d);
    slope
        .update_analysis_options(
            &serde_json::from_value::<AnalysisOptionsPatch>(with(
                json!({ "method": "Bishop", "slices": 40, "tolerance": 0.001 }),
                options,
            ))
            .unwrap(),
        )
        .unwrap();
    let f = analyse_slope(&mut slope, &mut RunCtx::default())
        .unwrap()
        .unwrap();
    (f, slope)
}

/// Minimum by brute force (search-tangent.test.ts).
const BRUTE_FORCE_FOS: f64 = 1.2776;

#[test]
fn does_not_get_worse_with_more_iterations_and_finds_the_brute_force_minimum() {
    let coarse = run(
        two_basins(),
        json!({ "iterations": 1000, "refinedIterations": 1000 }),
    )
    .0;
    let fine = run(
        two_basins(),
        json!({ "iterations": 4000, "refinedIterations": 2000 }),
    )
    .0;
    assert!(fine <= coarse + 1e-9);
    assert!((coarse / BRUTE_FORCE_FOS - 1.0).abs() < 0.005);
    assert!((fine / BRUTE_FORCE_FOS - 1.0).abs() < 0.005);
}

#[test]
fn an_impenetrable_layer_gives_the_circle_tangent_to_it_as_the_model_base_does() {
    let clay = undrained("Clay", 30.0);
    let mut ground = vec![json!([0, 4])];
    ground.extend(GROUND.iter().map(|p| json!(p)));
    ground.push(json!([70, 4]));
    let with_base = json!({
        "coordinates": ground, "materials": [clay], "materialBoundaries": [],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }],
    });
    let with_rock = json!({
        "coordinates": coords(),
        "materials": [clay, { "name": "Rock", "model": { "kind": "impenetrable", "unitWeight": 22 } }],
        "materialBoundaries": [{ "coordinates": [[-1, 4], [71, 4]], "materialName": "" }],
        "regionAssignments": [{ "point": [1, 15], "materialName": "Clay" }, { "point": [1, 2], "materialName": "Rock" }],
    });
    // circles only: with composite surfaces both follow the floor at y = 4
    let options = json!({ "iterations": 1000, "refinedIterations": 0, "slices": 50, "compositeSurfaces": false });
    let base = run(with_base.clone(), options.clone()).0;
    let rock = run(with_rock.clone(), options).0;
    assert!((rock / base - 1.0).abs() < 1e-3);
    let composite = json!({ "iterations": 1000, "refinedIterations": 0, "slices": 50 });
    let base_c = run(with_base, composite.clone()).0;
    let rock_c = run(with_rock, composite).0;
    assert!((rock_c / base_c - 1.0).abs() < 1e-2);
    assert!(base_c <= base * (1.0 + 1e-9));
}

/// A 40 m high 3:1 slope with a 1.5 m vertical cut at its toe: a minimum
/// area of 17 m² (the former automatic one) leaves out the surfaces through
/// the cut.
fn below_min_count(options: Value) -> usize {
    let cut = json!({
        "coordinates": [[0, 0], [0, 50], [20, 50], [140, 10], [160, 10], [160, 8.5], [200, 8.5], [200, 0]],
        "materials": [{ "name": "S", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 5, "frictionAngle": 30 } }],
        "materialBoundaries": [],
        "regionAssignments": [{ "point": [1, 1], "materialName": "S" }],
    });
    run(
        cut,
        with(
            json!({ "iterations": 1000, "refinedIterations": 0, "slices": 30 }),
            options,
        ),
    )
    .1
    .search()
    .iter()
    .filter(|p| p.below_min_size == Some(true))
    .count()
}

#[test]
fn surfaces_below_the_minimum_area_are_counted() {
    assert!(below_min_count(json!({ "minSlipArea": 17 })) > 0);
    // no limit by default
    assert_eq!(below_min_count(json!({})), 0);
}

#[test]
fn surfaces_below_the_minimum_slip_depth_are_counted_too() {
    assert!(below_min_count(json!({ "minSlipArea": 0, "minSlipDepth": 2 })) > 0);
}
