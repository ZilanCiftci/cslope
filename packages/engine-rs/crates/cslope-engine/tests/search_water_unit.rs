//! The analyses PORTING.md deferred to the solver phase from
//! search-review-c2.test.ts ("the minimum without refinement does not
//! change", the four re-entrant-corner tests; V050b and V051 are in
//! deferred_optimise_unit.rs) and material-water-table.test.ts
//! (all but the mirror, which is canonical's).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::{Slice, SlopeDefinition, WATER_UNIT_WEIGHT};
use model_core_support::{close, def};
use serde_json::{json, Value};
use solvers_support::run_verification;

fn canonical(d: Value) -> Slope {
    let d: SlopeDefinition = serde_json::from_value(d).unwrap();
    build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap()
}

fn options(s: &mut Slope, o: Value) {
    s.update_analysis_options(&serde_json::from_value::<AnalysisOptionsPatch>(o).unwrap())
        .unwrap();
}

fn analyse(s: &mut Slope) -> Option<f64> {
    analyse_slope(s, &mut RunCtx::default()).unwrap()
}

fn case_def(id: &str) -> Value {
    let cases: Vec<Value> = common::verification_cases();
    cases.into_iter().find(|c| c["id"] == id).unwrap()["definition"].clone()
}

// ── search-review-c2.test.ts ──────────────────────────────────────

#[test]
fn the_minimum_without_refinement_does_not_change_with_negligible_loads_behind_the_limits() {
    // V001 with 12 negligible strip loads behind the search limits (x = 0–66).
    let v001 = case_def("V001");
    let mut loaded = v001.clone();
    loaded["udls"] = Value::Array(
        (0..12)
            .map(|i| json!({ "magnitude": 1e-6, "x1": -29.0 + i as f64, "x2": -28.5 + i as f64 }))
            .collect(),
    );
    let fos = |d: Value| {
        let mut s = canonical(d);
        options(
            &mut s,
            json!({ "method": "Bishop", "slices": 50, "iterations": 1000, "refinedIterations": 0, "tolerance": 0.001 }),
        );
        analyse(&mut s).unwrap()
    };
    close(fos(loaded), fos(v001), 4);
}

/// Base at y = 5 for x > 50 and at y = 0 for x < 50: the corner (50, 5)
/// points into the model.
fn notch() -> Value {
    json!({
        "coordinates": [[0, 0], [0, 20], [20, 20], [40, 10], [80, 10], [80, 5], [50, 5], [50, 0]],
        "materials": [{ "name": "Clay", "model": { "kind": "undrained", "unitWeight": 18, "undrainedShearStrength": 30 } }],
        "materialBoundaries": [],
        "regionAssignments": [{ "point": [10, 10], "materialName": "Clay" }],
    })
}

fn notch_with(extra: Value) -> Value {
    let mut d = notch();
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    d
}

/// With composite surfaces off: they would follow the base instead.
fn notch_analyse(d: Value) -> Option<f64> {
    let mut s = canonical(d);
    options(
        &mut s,
        json!({ "method": "Bishop", "slices": 20, "tolerance": 0.001, "compositeSurfaces": false }),
    );
    analyse(&mut s)
}

#[test]
fn a_polyline_with_its_vertices_inside_but_a_segment_below_the_corner_is_no_surface() {
    // The segment (49, 1)–(62, 10) passes below the corner from x = 50 to 54.8.
    assert!(notch_analyse(notch_with(json!({
        "customSurfaces": [{ "points": [[15, 20], [35, 1], [49, 1], [62, 10]] }], "customPlanesOnly": true,
    })))
    .is_none());
}

#[test]
fn with_composite_surfaces_a_circle_below_the_corner_is_not_admissible_either() {
    // Following the base would rise 0.3 m vertically at x = 50, where the
    // base steps up towards the exit.
    let mut s = canonical(notch_with(
        json!({ "customSearchPlanes": [{ "cx": 37.5, "cy": 32, "radius": 30 }], "customPlanesOnly": true }),
    ));
    options(
        &mut s,
        json!({ "method": "Bishop", "slices": 20, "tolerance": 0.001 }),
    );
    assert!(analyse(&mut s).is_none());
}

#[test]
fn nor_is_a_circle_passing_below_the_corner_between_the_samples_along_it() {
    // Below the corner from x = 50 to about 50.7, 0.3 m deep.
    assert!(notch_analyse(notch_with(json!({ "customSearchPlanes": [{ "cx": 37.5, "cy": 32, "radius": 30 }], "customPlanesOnly": true }))).is_none());
}

#[test]
fn a_surface_with_a_slice_base_outside_the_model_has_no_slices() {
    let mut s = canonical(notch());
    options(&mut s, json!({ "slices": 20, "compositeSurfaces": false }));
    let lc = 37.5 - (30.0f64 * 30.0 - 12.0 * 12.0).sqrt();
    let rc = 37.5 + (30.0f64 * 30.0 - 22.0 * 22.0).sqrt();
    assert!(
        get_slices(&s, lc, rc, 37.5, 32.0, 30.0, None, &mut SliceScratch::new())
            .unwrap()
            .is_empty()
    );
}

// ── material-water-table.test.ts ──────────────────────────────────

fn base() -> Value {
    json!({
        "coordinates": [[0, -20], [0, 0], [20, 0], [40, -10], [60, -10], [60, -20]],
        "materials": [
            { "name": "Upper", "unitWeight": 18, "frictionAngle": 28, "cohesion": 5 },
            { "name": "Lower", "unitWeight": 20, "frictionAngle": 32, "cohesion": 2 },
        ],
        "materialBoundaries": [{ "coordinates": [[0, -6], [60, -6]], "materialName": "" }],
        "regionAssignments": [{ "point": [5, -2], "materialName": "Upper" }, { "point": [5, -15], "materialName": "Lower" }],
        "waterTable": { "mode": "custom", "value": [[0, -2], [60, -2]] },
    })
}

fn per_material() -> Value {
    let mut d = base();
    d["materials"][0]["waterTableId"] = json!("high");
    d["materials"][1]["waterTableId"] = json!("low");
    d["waterTables"] = json!([
        { "id": "high", "coordinates": [[0, -2], [60, -2]] },
        { "id": "low", "coordinates": [[0, -14], [60, -14]] },
    ]);
    d
}

fn deep_slices(d: Value) -> (Slope, Vec<Slice>) {
    let slope = build_slope(&def(d)).unwrap();
    let (cx, cy, r) = (30.0, 12.0, 30.0);
    let pts = slope.get_circle_external_intersection(cx, cy, r).unwrap();
    let sl = get_slices(
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
    (slope, sl)
}

#[test]
fn uses_the_base_materials_own_water_line_for_pore_pressure() {
    let (slope, slices) = deep_slices(per_material());
    let name = |s: &Slice| slope.material(s.base_material.unwrap()).name.clone();
    let lower: Vec<&Slice> = slices.iter().filter(|s| name(s) == "Lower").collect();
    let upper: Vec<&Slice> = slices.iter().filter(|s| name(s) == "Upper").collect();
    assert!(!lower.is_empty() && !upper.is_empty());
    for s in lower {
        close(s.u, (-14.0 - s.y_bottom).max(0.0) * WATER_UNIT_WEIGHT, 9);
    }
    for s in upper {
        close(s.u, (-2.0 - s.y_bottom).max(0.0) * WATER_UNIT_WEIGHT, 9);
    }
}

#[test]
fn gives_a_higher_fos_when_the_lower_material_has_a_lower_water_line() {
    let mut single = build_slope(&def(base())).unwrap();
    let mut per = build_slope(&def(per_material())).unwrap();
    options(&mut single, json!({ "iterations": 1000 }));
    options(&mut per, json!({ "iterations": 1000 }));
    assert!(analyse(&mut per).unwrap() > analyse(&mut single).unwrap());
}

#[test]
fn is_unchanged_when_materials_are_not_assigned_to_a_line() {
    let mut unassigned = base();
    unassigned["waterTables"] = per_material()["waterTables"].clone();
    let a: Vec<f64> = deep_slices(base()).1.iter().map(|s| s.u).collect();
    let b: Vec<f64> = deep_slices(unassigned).1.iter().map(|s| s.u).collect();
    assert_eq!(b, a);
}

/// V041a (D&W fig. 6.27): submerged slope, pool 30 ft above the crest.
fn soil() -> Value {
    json!({ "name": "Soil", "model": { "kind": "mohr-coulomb", "unitWeight": 20.10719, "cohesion": 4.78803, "frictionAngle": 20 } })
}

fn dry() -> Value {
    json!({
        "materials": [soil()],
        "coordinates": [[0, 0], [0, 4.572], [9.144, 4.572], [32.004, 13.716], [42.672, 13.716], [42.672, 0]],
        "materialBoundaries": [],
        "regionAssignments": [{ "point": [37.338, 13.216], "materialName": "Soil" }],
    })
}

const POOL: [[f64; 2]; 2] = [[0.0, 22.86], [42.672, 22.86]];
const LOW: [[f64; 2]; 2] = [[0.0, -1.0], [42.672, -1.0]];

fn own(extra: Value) -> Value {
    let mut d = dry();
    let mut m = soil();
    m["waterTableId"] = json!("p");
    d["materials"] = json!([m]);
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    d
}

fn pool_fos(d: Value) -> Option<f64> {
    run_verification(
        d,
        "Bishop",
        json!({ "porePressureHead": "vertical", "slices": 40 }),
    )
    .0
}

#[test]
fn gives_the_pool_as_the_materials_line_the_fos_of_the_pool_as_the_main_line() {
    let mut d = dry();
    d["waterTable"] = json!({ "mode": "custom", "value": POOL, "followBoundary": false });
    let main = pool_fos(d).unwrap();
    // 1.597 with the arc base of a circle; the chord (2026-11-10).
    close(main, 1.5988, 3);
    close(
        pool_fos(own(
            json!({ "waterTables": [{ "id": "p", "coordinates": POOL, "followBoundary": false }] }),
        ))
        .unwrap(),
        main,
        6,
    );
    close(
        pool_fos(own(json!({
            "waterTable": { "mode": "custom", "value": LOW, "followBoundary": false },
            "waterTables": [{ "id": "p", "coordinates": POOL, "followBoundary": false }],
        })))
        .unwrap(),
        main,
        6,
    );
}

#[test]
fn puts_no_pool_weight_on_a_material_whose_own_line_is_below_the_ground() {
    // The main line ponds but the soil's own line is below the slip
    // surface: no pore pressure and no water load, as dry.
    let d = pool_fos(dry()).unwrap();
    close(d, 1.337, 3);
    close(
        pool_fos(own(json!({
            "waterTable": { "mode": "custom", "value": POOL, "followBoundary": false },
            "waterTables": [{ "id": "p", "coordinates": LOW, "followBoundary": false }],
        })))
        .unwrap(),
        d,
        6,
    );
}

#[test]
fn loads_only_the_slices_whose_surface_material_has_the_ponding_line() {
    // Lower (the ground from x = 32 on) ponds 2 m at the toe from its own
    // line; Upper takes the main line, below the ground.
    let mut d = base();
    d["materials"][1]["waterTableId"] = json!("toe");
    d["waterTable"] =
        json!({ "mode": "custom", "value": [[0, -12], [60, -12]], "followBoundary": false });
    d["waterTables"] =
        json!([{ "id": "toe", "coordinates": [[0, -8], [60, -8]], "followBoundary": false }]);
    let (_, slices) = deep_slices(d);
    let wet: Vec<&Slice> = slices.iter().filter(|s| s.x_left >= 36.0 - 1e-9).collect();
    assert!(!wet.is_empty());
    for s in wet {
        let depth = (-8.0 - s.y0_top + (-8.0 - s.y1_top)) / 2.0;
        close(
            s.water_load.unwrap(),
            WATER_UNIT_WEIGHT * (s.x_right - s.x_left) * depth,
            9,
        );
    }
    for s in slices.iter().filter(|s| s.x_right <= 36.0 + 1e-9) {
        assert_eq!(s.water_load.unwrap_or(0.0), 0.0);
    }
}
