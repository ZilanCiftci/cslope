//! Ported unit tests of model/canonical.ts: canonical.test.ts and
//! canonical-build.test.ts, the cases that test canonical.ts directly. The
//! cases that build or analyse a slope (buildSlope, analyseSlope) are
//! ported with those modules.

use cslope_engine::model::canonical::*;
use cslope_engine::types::*;
use serde_json::{json, Value};

fn def(v: Value) -> SlopeDefinition {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
}

fn result(v: Value) -> AnalysisResult {
    serde_json::from_value(v.clone()).unwrap_or_else(|e| panic!("{e}: {v}"))
}

#[test]
fn infers_orientation_from_the_crest_side() {
    assert_eq!(
        infer_orientation_from_coordinates(&[[0.0, 0.0], [0.0, 10.0], [10.0, 5.0], [10.0, 0.0]]),
        SlopeOrientation::Ltr
    );
    assert_eq!(
        infer_orientation_from_coordinates(&[[0.0, 0.0], [0.0, 5.0], [10.0, 10.0], [10.0, 0.0]]),
        SlopeOrientation::Rtl
    );
}

#[test]
fn mirrors_an_rtl_definition() {
    let slope = def(json!({
        "orientation": "rtl",
        "coordinates": [[0, 0], [0, 5], [10, 10], [10, 0]],
        "materials": [{ "name": "M1", "unitWeight": 20, "frictionAngle": 30, "cohesion": 5 }],
        "analysisLimits": { "entryLeftX": 7, "entryRightX": 9, "exitLeftX": 1, "exitRightX": 3 },
        "lineLoads": [{ "magnitude": 50, "x": 8 }],
        "udls": [{ "magnitude": 10, "x1": 6, "x2": 9 }],
    }));
    let c = to_canonical_slope_definition(&slope, None).unwrap();
    assert_eq!(c.orientation, Some(SlopeOrientation::Rtl));
    assert_eq!(c.coordinates[2][0], 0.0);
    let l = c.analysis_limits.unwrap();
    assert_eq!((l.entry_left_x, l.entry_right_x), (1.0, 3.0));
    assert_eq!(c.line_loads.unwrap()[0].x, 2.0);
    assert_eq!(
        serde_json::to_value(&c.udls.unwrap()[0]).unwrap(),
        json!({ "magnitude": 10.0, "x1": 1.0, "x2": 4.0 })
    );
}

fn slice_json() -> Value {
    json!({ "x": 4, "xLeft": 3, "xRight": 5, "width": 2, "yTop": 10, "yBottom": 5, "height": 5, "area": 10, "alpha": 0.3,
        "baseLength": 2.1, "weight": 100, "cohesion": 5, "frictionAngle": 30, "normalForce": 0, "shearForce": 10.5, "porePressure": 0,
        "baseMaterial": { "name": "M1", "color": "", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 5, "frictionAngle": 35 } } })
}

#[test]
fn maps_results_back_to_rtl_space() {
    let canonical = def(json!({
        "orientation": "rtl",
        "coordinates": [[0, 0], [0, 10], [10, 5], [10, 0]],
        "materials": [{ "name": "M1", "unitWeight": 20, "frictionAngle": 30, "cohesion": 5 }],
    }));
    let r = result(json!({
        "minFOS": 1.2, "maxFOS": 1.8, "method": "Bishop", "elapsedMs": 100,
        "criticalSurface": { "cx": 3, "cy": 2, "radius": 6, "fos": 1.2, "entryPoint": [2, 9], "exitPoint": [8, 4], "crack": { "x": 2, "top": 10, "bottom": 9 } },
        "allSurfaces": [{ "cx": 3, "cy": 2, "radius": 6, "fos": 1.2, "entryPoint": [2, 9], "exitPoint": [8, 4] }],
        "criticalSlices": [slice_json()],
    }));
    let mapped = map_analysis_result_to_model_space(&r, &canonical);
    let cs = mapped.critical_surface.unwrap();
    assert_eq!(cs.cx, mirror_x(3.0, 0.0, 10.0));
    assert_eq!(cs.entry_point, [8.0, 9.0]);
    assert_eq!(cs.exit_point, [2.0, 4.0]);
    assert_eq!(
        cs.crack,
        Some(Crack {
            x: 8.0,
            top: 10.0,
            bottom: 9.0
        })
    );
    assert!(mapped.critical_slices[0].x_left < mapped.critical_slices[0].x_right);
}

#[test]
fn mirrors_spatial_strength_above_the_water_too() {
    let spatial = json!({ "kind": "spatial-mohr-coulomb", "unitWeight": 18, "dataPoints": [[2, 5, 10, 30, 18], [8, 5, 12, 28, 18]] });
    let d = def(json!({
        "coordinates": [[0, 0], [0, 5], [10, 10], [10, 0]], "orientation": "rtl",
        "materials": [{ "name": "A", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30, "aboveWater": spatial } }],
    }));
    let c = to_canonical_slope_definition(&d, None).unwrap();
    let Some(MaterialModel::SpatialMohrCoulomb(above)) =
        c.materials[0].model.as_ref().unwrap().above_water()
    else {
        panic!()
    };
    assert_eq!(
        above.data_points.iter().map(|p| p[0]).collect::<Vec<_>>(),
        vec![8.0, 2.0]
    );
    let plain = def(json!({
        "coordinates": [[0, 0], [0, 5], [10, 10], [10, 0]], "orientation": "rtl",
        "materials": [{ "name": "A", "model": { "kind": "mohr-coulomb", "unitWeight": 18, "cohesion": 5, "frictionAngle": 30 } }],
    }));
    assert_eq!(
        to_canonical_slope_definition(&plain, None)
            .unwrap()
            .materials[0]
            .model,
        plain.materials[0].model
    );
}

#[test]
fn opposite_direction_drops_limits() {
    let ridge = def(json!({
        "orientation": "ltr",
        "coordinates": [[0, -10], [0, 0], [20, 0], [30, 10], [40, 10], [60, 0], [80, 0], [80, -10]],
        "materials": [{ "name": "S", "unitWeight": 19, "frictionAngle": 25, "cohesion": 8 }],
        "analysisLimits": { "entryLeftX": 30, "entryRightX": 40, "exitLeftX": 60, "exitRightX": 80 },
    }));
    let opposite =
        opposite_direction_definition(&to_canonical_slope_definition(&ridge, None).unwrap())
            .unwrap();
    assert_eq!(opposite.orientation, Some(SlopeOrientation::Rtl));
    assert_eq!(opposite.analysis_limits, None);
}

// ── canonical-build.test.ts ──

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

#[test]
fn orientation_edge_cases() {
    assert_eq!(
        infer_orientation_from_coordinates(&[[0.0, 0.0]]),
        SlopeOrientation::Ltr
    );
    assert_eq!(
        infer_orientation_from_coordinates(&[[0.0, 0.0], [10.0, 0.0], [10.0, -5.0], [0.0, -5.0]]),
        SlopeOrientation::Ltr
    );
    assert_eq!(
        infer_orientation_from_coordinates(&rtl()),
        SlopeOrientation::Rtl
    );
    assert_eq!(
        resolve_orientation(Some(SlopeOrientation::Rtl), &LTR),
        SlopeOrientation::Rtl
    );
    assert_eq!(resolve_orientation(None, &rtl()), SlopeOrientation::Rtl);
}

#[test]
fn mirrored_limits_keep_left_before_right() {
    let l = AnalysisLimits {
        entry_left_x: 30.0,
        entry_right_x: 35.0,
        exit_left_x: 5.0,
        exit_right_x: 12.0,
    };
    assert_eq!(
        mirror_limits(&l, 0.0, 40.0),
        AnalysisLimits {
            entry_left_x: 5.0,
            entry_right_x: 10.0,
            exit_left_x: 28.0,
            exit_right_x: 35.0
        }
    );
}

#[test]
fn ltr_definition_is_returned_with_its_orientation() {
    let d = def(json!({ "coordinates": LTR, "materials": [soil()] }));
    let c = to_canonical_slope_definition(&d, None).unwrap();
    assert_eq!(c.coordinates, LTR.to_vec());
    assert_eq!(c.orientation, Some(SlopeOrientation::Ltr));
}

#[test]
fn opposite_of_an_rtl_model() {
    let d = def(json!({
        "orientation": "rtl", "coordinates": rtl(), "materials": [soil()],
        "analysisLimits": { "entryLeftX": 30, "entryRightX": 35, "exitLeftX": 5, "exitRightX": 12 },
        "customSearchPlanes": [{ "cx": 18, "cy": 18, "radius": 18.5 }], "customPlanesOnly": true,
    }));
    let opp =
        opposite_direction_definition(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    assert_eq!(opp.orientation, Some(SlopeOrientation::Ltr));
    assert_eq!(opp.analysis_limits, None);
    assert_eq!(opp.custom_search_planes, None);
    assert_eq!(opp.custom_planes_only, Some(false));
    assert_eq!(opp.coordinates, rtl());
}

fn polyline_result() -> Value {
    json!({
        "minFOS": 1.2, "maxFOS": 2,
        "criticalSurface": { "cx": 10, "cy": 20, "radius": 0, "fos": 1.2, "entryPoint": [5, 10], "exitPoint": [30, 0],
            "points": [[5, 10], [15, 2], [30, 0]],
            "reinforcementForces": [{ "index": 0, "x": 12, "y": 4, "fx": 30, "fy": 5, "force": 30.4, "passive": false }] },
        "allSurfaces": [{ "cx": 10, "cy": 20, "radius": 0, "fos": 1.2, "entryPoint": [5, 10], "exitPoint": [30, 0], "points": [[5, 10], [30, 0]] }],
        "criticalSlices": [], "method": "Bishop", "elapsedMs": 1,
    })
}

#[test]
fn mirrors_polylines_and_reinforcement_forces() {
    let c = def(json!({ "orientation": "rtl", "coordinates": LTR, "materials": [soil()] }));
    let m = map_analysis_result_to_model_space(&result(polyline_result()), &c);
    let cs = m.critical_surface.unwrap();
    assert_eq!(
        cs.points.unwrap(),
        vec![[35.0, 10.0], [25.0, 2.0], [10.0, 0.0]]
    );
    let f = &cs.reinforcement_forces.unwrap()[0];
    assert_eq!((f.x, f.fx, f.fy), (28.0, -30.0, 5.0));
    assert_eq!(
        m.all_surfaces[0].points.clone().unwrap(),
        vec![[35.0, 10.0], [10.0, 0.0]]
    );
}

#[test]
fn without_critical_surface_or_polylines() {
    let c = def(json!({ "orientation": "rtl", "coordinates": LTR, "materials": [soil()] }));
    let mut bare = polyline_result();
    bare["criticalSurface"] = Value::Null;
    bare["allSurfaces"][0]
        .as_object_mut()
        .unwrap()
        .remove("points");
    let m = map_analysis_result_to_model_space(&result(bare), &c);
    assert!(m.critical_surface.is_none());
    assert!(m.all_surfaces[0].points.is_none());
    let mut without = polyline_result();
    let cs = without["criticalSurface"].as_object_mut().unwrap();
    cs.remove("points");
    cs.remove("reinforcementForces");
    let n = map_analysis_result_to_model_space(&result(without), &c);
    let cs = n.critical_surface.unwrap();
    assert!(cs.points.is_none() && cs.reinforcement_forces.is_none());
}

#[test]
fn mirrors_a_finite_element_result_with_the_rest() {
    let c = def(json!({ "orientation": "rtl", "coordinates": LTR, "materials": [soil()] }));
    let mut r = polyline_result();
    r["fem"] = json!({
        "factorOfSafety": 1.3, "failedF": 1.31, "flowRule": "davis-b", "levels": [{ "elements": 1, "fos": 1.3 }],
        "warnings": [], "elapsedMs": 10,
        "x": [5, 15, 5], "y": [0, 0, 4], "triangles": [0, 1, 2],
        "plasticShear": [0.01], "shearIncrement": [0.02], "displacement": [0.1, -0.2, 0.3, -0.4, 0.5, -0.6],
    });
    let fem = map_analysis_result_to_model_space(&result(r), &c)
        .fem
        .unwrap();
    let [x_min, x_max] = get_domain_x(&c.coordinates);
    let s = x_min + x_max;
    assert_eq!(fem.x, vec![s - 5.0, s - 15.0, s - 5.0]);
    assert_eq!(fem.y, vec![0.0, 0.0, 4.0]);
    assert_eq!(fem.displacement, vec![-0.1, -0.2, -0.3, -0.4, -0.5, -0.6]);
    // still counter-clockwise
    assert_eq!(fem.triangles, vec![0, 2, 1]);
    let t = &fem.triangles;
    let area = (fem.x[t[1]] - fem.x[t[0]]) * (fem.y[t[2]] - fem.y[t[0]])
        - (fem.y[t[1]] - fem.y[t[0]]) * (fem.x[t[2]] - fem.x[t[0]]);
    assert!(area > 0.0);
    assert_eq!(fem.plastic_shear, vec![0.01]);
    assert_eq!(fem.shear_increment, Some(vec![0.02]));
    assert_eq!(fem.factor_of_safety, 1.3);
}
