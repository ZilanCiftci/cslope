//! The custom search planes of a definition in the analysis result: each
//! surface analysed for one is marked with its place in the definition
//! (`SlipSurfaceResult.custom_plane`), and `AnalysisResult.custom_surfaces`
//! lists every custom plane with its surface or the reason it has no factor
//! of safety. The marking changes no factor.
#![allow(clippy::disallowed_methods)]

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::api::run_analysis::run_analysis;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::map_analysis_result_to_model_space;
use cslope_engine::model::slope::{AnalysisOptionsPatch, SearchPlane};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::{
    AnalysisMethod, AnalysisResult, CustomPlaneKind, CustomPlaneRef, CustomSurfaceResult,
    SlopeDefinition,
};
use serde_json::{json, Value};

fn def(v: Value) -> SlopeDefinition {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
}

/// A crest at y = 0 (x 0–20), a 2:1 slope to the toe at (40, −10), the base at −15.
const COORDS: [[f64; 2]; 6] = [
    [0.0, -15.0],
    [0.0, 0.0],
    [20.0, 0.0],
    [40.0, -10.0],
    [50.0, -10.0],
    [50.0, -15.0],
];

fn definition(custom: Value) -> SlopeDefinition {
    let mut v = json!({
        "coordinates": COORDS,
        "materials": [{ "name": "M1", "unitWeight": 20, "frictionAngle": 19.6, "cohesion": 3 }],
        "analysisLimits": { "entryLeftX": 17, "entryRightX": 22, "exitLeftX": 37, "exitRightX": 43 },
    });
    for (k, val) in custom.as_object().unwrap() {
        v[k] = val.clone();
    }
    def(v)
}

fn options() -> AnalysisOptionsPatch {
    AnalysisOptionsPatch {
        slices: Some(20.0),
        iterations: Some(200.0),
        refined_iterations: Some(0.0),
        method: Some(AnalysisMethod::Bishop.into()),
        ..Default::default()
    }
}

fn run(d: &SlopeDefinition, o: &AnalysisOptionsPatch) -> AnalysisResult {
    run_analysis(d, o, &mut RunCtx::default()).unwrap()
}

/// Circles: one through the slope, one far above the ground; polylines:
/// one through the soil, one outside the model.
fn all_kinds() -> Value {
    json!({
        "customSearchPlanes": [{ "cx": 28, "cy": 25, "radius": 35 }, { "cx": 25, "cy": 60, "radius": 5 }],
        "customSurfaces": [{ "points": [[12, -3], [24, -8], [34, -8]] }, { "points": [[-5, 5], [-2, 6]] }],
    })
}

fn custom(kind: CustomPlaneKind, index: usize) -> CustomPlaneRef {
    CustomPlaneRef { kind, index }
}

#[test]
fn lists_every_custom_plane_in_the_definitions_order_with_its_surface_or_reason() {
    let mut d = definition(all_kinds());
    d.custom_planes_only = Some(true);
    let r = run(&d, &options());
    let customs = r.custom_surfaces.as_ref().expect("custom surfaces");
    let refs: Vec<CustomPlaneRef> = customs.iter().map(|c| custom(c.kind, c.index)).collect();
    assert_eq!(
        refs,
        vec![
            custom(CustomPlaneKind::Circle, 0),
            custom(CustomPlaneKind::Circle, 1),
            custom(CustomPlaneKind::Polyline, 0),
            custom(CustomPlaneKind::Polyline, 1),
        ]
    );
    let circle = customs[0].surface.as_ref().expect("the circle's surface");
    assert_eq!((circle.cx, circle.cy, circle.radius), (28.0, 25.0, 35.0));
    assert!(circle.fos > 0.0);
    assert_eq!(
        circle.custom_plane,
        Some(custom(CustomPlaneKind::Circle, 0))
    );
    assert_eq!(customs[0].reason, None);
    assert_eq!(customs[1].surface, None);
    assert_eq!(
        customs[1].reason.as_deref(),
        Some("the circle does not cut the ground twice")
    );
    let polyline = customs[2]
        .surface
        .as_ref()
        .unwrap_or_else(|| panic!("the polyline's surface: {:?}", customs[2].reason));
    assert!(polyline.points.is_some());
    assert_eq!(
        polyline.custom_plane,
        Some(custom(CustomPlaneKind::Polyline, 0))
    );
    assert_eq!(
        customs[3].reason.as_deref(),
        Some("the polyline does not pass through the soil or leaves the model")
    );
    // The analysed ones are in allSurfaces, marked; the critical one is one of them.
    assert_eq!(r.all_surfaces.len(), 2);
    assert!(r.all_surfaces.iter().all(|s| s.custom_plane.is_some()));
    assert!(r.critical_surface.unwrap().custom_plane.is_some());
    assert_eq!(serde_json::to_value(&customs[1]).unwrap()["kind"], "circle");
    assert_eq!(
        serde_json::to_value(&customs[2]).unwrap()["kind"],
        "polyline"
    );
}

#[test]
fn custom_planes_beside_a_search_keep_their_factor_and_marking() {
    let alone = run(
        &SlopeDefinition {
            custom_planes_only: Some(true),
            ..definition(json!({ "customSearchPlanes": [{ "cx": 28, "cy": 25, "radius": 35 }] }))
        },
        &options(),
    );
    let with_search = run(
        &definition(json!({ "customSearchPlanes": [{ "cx": 28, "cy": 25, "radius": 35 }] })),
        &options(),
    );
    let c = &with_search.custom_surfaces.as_ref().unwrap()[0];
    let s = c.surface.as_ref().unwrap();
    assert_eq!(s.fos, alone.min_fos);
    assert!(with_search.all_surfaces.len() > 1);
    // Only the custom plane is marked.
    let marked: Vec<&_> = with_search
        .all_surfaces
        .iter()
        .filter(|s| s.custom_plane.is_some())
        .collect();
    assert_eq!(marked.len(), 1);
    assert_eq!(marked[0].fos, alone.min_fos);
    // None without custom planes.
    let plain = run(&definition(json!({})), &options());
    assert_eq!(plain.custom_surfaces, None);
}

#[test]
fn a_custom_plane_the_evaluation_rejects_says_why() {
    // A shallow circle under the crest, with a minimum slip depth it fails.
    let d = definition(json!({ "customSearchPlanes": [{ "cx": 10, "cy": 3, "radius": 4 }] }));
    let r = run(
        &d,
        &AnalysisOptionsPatch {
            min_slip_depth: Some(3.0),
            ..options()
        },
    );
    let c = &r.custom_surfaces.as_ref().unwrap()[0];
    assert_eq!(c.surface, None);
    assert_eq!(
        c.reason.as_deref(),
        Some("shallower than the minimum slip depth")
    );
    assert!(r.all_surfaces.iter().all(|s| s.custom_plane.is_none()));
}

#[test]
fn no_valid_surface_names_the_custom_planes_reasons() {
    let d = definition(json!({
        "customSearchPlanes": [{ "cx": 25, "cy": 60, "radius": 5 }],
        "customPlanesOnly": true,
    }));
    let e = run_analysis(&d, &options(), &mut RunCtx::default()).unwrap_err();
    assert!(
        e.message.starts_with("No valid slip surface was found."),
        "{}",
        e.message
    );
    assert!(
        e.message
            .ends_with(" Custom surface 1: the circle does not cut the ground twice."),
        "{}",
        e.message
    );
}

#[test]
fn both_directions_keep_the_custom_surfaces_of_the_own_direction() {
    let d = definition(json!({ "customSearchPlanes": [{ "cx": 28, "cy": 25, "radius": 35 }] }));
    let r = run(
        &d,
        &AnalysisOptionsPatch {
            both_directions: Some(true),
            ..options()
        },
    );
    assert!(r.sliding_direction.is_some());
    let customs = r.custom_surfaces.as_ref().expect("custom surfaces");
    assert_eq!(customs.len(), 1);
    assert_eq!(customs[0].surface.as_ref().unwrap().cx, 28.0);
}

#[test]
fn a_search_plane_equal_to_a_custom_plane_stands_for_it() {
    let d = definition(json!({ "customSearchPlanes": [{ "cx": 28, "cy": 25, "radius": 35 }] }));
    let mut slope = build_slope(&d).unwrap();
    slope.update_analysis_options(&options()).unwrap();
    let custom_plane = slope.individual_planes()[0].clone();
    assert!(custom_plane.custom_plane.is_some());
    // The same circle as a plane of the search, unmarked.
    slope.set_search_planes(vec![SearchPlane {
        custom_plane: None,
        unchecked: None,
        ..custom_plane.clone()
    }]);
    analyse_slope(&mut slope, &mut RunCtx::default()).unwrap();
    let same: Vec<&SearchPlane> = slope
        .search()
        .iter()
        .filter(|p| (p.cx, p.cy, p.radius) == (28.0, 25.0, 35.0))
        .collect();
    assert_eq!(same.len(), 1);
    assert_eq!(same[0].custom_plane, custom_plane.custom_plane);
    assert!(same[0].fos.is_some());
}

#[test]
fn identical_custom_planes_each_keep_their_entry() {
    let circle = json!({ "cx": 28, "cy": 25, "radius": 35 });
    let mut d = definition(json!({ "customSearchPlanes": [circle, circle] }));
    d.custom_planes_only = Some(true);
    let r = run(&d, &options());
    let customs = r.custom_surfaces.as_ref().expect("custom surfaces");
    let refs: Vec<CustomPlaneRef> = customs.iter().map(|c| custom(c.kind, c.index)).collect();
    assert_eq!(
        refs,
        vec![
            custom(CustomPlaneKind::Circle, 0),
            custom(CustomPlaneKind::Circle, 1)
        ]
    );
    let a = customs[0].surface.as_ref().expect("first surface");
    let b = customs[1].surface.as_ref().expect("second surface");
    assert_eq!(a.fos, b.fos);
    assert_eq!(a.fos, r.min_fos);
    assert_eq!(a.custom_plane, Some(custom(CustomPlaneKind::Circle, 0)));
    assert_eq!(b.custom_plane, Some(custom(CustomPlaneKind::Circle, 1)));
    // Analysed once.
    assert_eq!(r.all_surfaces.len(), 1);
}

#[test]
fn mirrored_results_mirror_the_custom_surfaces() {
    let canonical = def(json!({
        "orientation": "rtl",
        "coordinates": [[0, 0], [0, 10], [10, 5], [40, 5], [40, 0]],
        "materials": [{ "name": "M1", "unitWeight": 20, "frictionAngle": 30, "cohesion": 5 }],
    }));
    let surface = json!({ "cx": 10, "cy": 20, "radius": 15, "fos": 1.2, "entryPoint": [5, 10], "exitPoint": [30, 5],
        "customPlane": { "kind": "circle", "index": 0 } });
    let r: AnalysisResult = serde_json::from_value(json!({
        "minFOS": 1.2, "maxFOS": 2, "criticalSurface": surface, "allSurfaces": [surface],
        "criticalSlices": [], "method": "Bishop", "elapsedMs": 1,
        "customSurfaces": [
            { "kind": "circle", "index": 0, "surface": surface },
            { "kind": "polyline", "index": 0, "reason": "why" },
        ],
    }))
    .unwrap();
    let m = map_analysis_result_to_model_space(&r, &canonical);
    let customs: &Vec<CustomSurfaceResult> = m.custom_surfaces.as_ref().unwrap();
    let s = customs[0].surface.as_ref().unwrap();
    assert_eq!(s.cx, 30.0);
    assert_eq!(s.entry_point, [35.0, 10.0]);
    assert_eq!(s.custom_plane, Some(custom(CustomPlaneKind::Circle, 0)));
    assert_eq!(customs[1].reason.as_deref(), Some("why"));
    assert_eq!(
        m.all_surfaces[0].custom_plane,
        Some(custom(CustomPlaneKind::Circle, 0))
    );
    // The JSON of the result reads back and writes the same.
    let v = serde_json::to_value(&m).unwrap();
    assert_eq!(
        v["customSurfaces"][1],
        json!({ "kind": "polyline", "index": 0, "reason": "why" })
    );
    assert_eq!(
        v["allSurfaces"][0]["customPlane"],
        json!({ "kind": "circle", "index": 0 })
    );
}
