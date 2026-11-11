//! Port of packages/engine/src/model/mp-convergence.test.ts: the acceptance
//! criterion of the Morgenstern-Price solution. A converged solution has
//! positive Fm and Ff that agree within the tolerance, capped at 0.01 and at
//! 1 % of F (`MP_GAP_CAP` in solvers.rs).
#![allow(clippy::disallowed_methods)]

use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::analyse_morgenstern_price;
use cslope_engine::types::{Material, MaterialParams, Slice, SlopeDefinition};
use serde_json::json;

/// A synthetic model exercising most features (fill over clay, spatial
/// strengths, two water tables, a waternet, loads, reinforcement, piles)
/// and one circular surface on which Fm(λ) passes through zero: Fm is
/// about −0.0003 at λ from −0.18 to −0.1 and 0.15–0.57 at λ 0 and 0.1,
/// while Ff is 0.3–0.63. There is no complete-equilibrium solution. (On
/// a circle 0.1 m higher and to the left, with the arc as slice base, the
/// test |Fm − Ff| < tolerance accepted F = 0.092 with Fm = −0.003 and Ff
/// = 0.186 at tolerance 0.2, and a 1-ulp change of one slice weight or
/// base angle moved the accepted result anywhere between −4.2 and 13.9;
/// the circle was moved when the slice base became the chord, 2026-11-10,
/// and again by (0.02, −0.1) m for γw = 9.807, 2026-11-11.)
const DEFINITION: &str = r##"{"orientation": "rtl", "coordinates": [[40, -10], [40, 0], [25, 0], [15, 10], [0, 10], [0, -10]], "materials": [{"name": "Fill", "color": "#aaa", "depthRange": [0, 3], "waterTableId": "p2", "model": {"kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 2, "frictionAngle": 32, "cohesionRefDepth": 1}}, {"name": "Clay", "model": {"kind": "mohr-coulomb", "unitWeight": 17, "cohesion": 5, "frictionAngle": 25, "aboveWater": {"kind": "spatial-mohr-coulomb", "unitWeight": 18, "dataPoints": [[38, 5, 10, 30, 18], [2, 5, 12, 28, 18]], "interpolation": "nearest"}}}, {"name": "Spatial", "model": {"kind": "spatial-mohr-coulomb", "unitWeight": 18, "unitWeightSat": 20, "ru": 0.1, "dataPoints": [[35, -5, 10, 30, 18], [5, -5, 12, 28, 19]]}}, {"name": "Rock", "model": {"kind": "impenetrable", "unitWeight": 22}}], "waterTable": {"mode": "custom", "value": [[40, -1], [20, 2], [0, 8]], "followBoundary": false}, "waterTables": [{"id": "p2", "coordinates": [[40, -3], [0, 5]], "followBoundary": true}], "udls": [{"magnitude": 10, "x1": 4, "x2": 10, "direction": "normal", "excessPorePressure": [{"material": "Clay", "ratio": 0.4}, {"material": "Fill", "ratio": 0.5}]}, {"magnitude": 5, "x1": 2, "x2": 8}, {"magnitude": 0, "x1": 38, "x2": 39}], "lineLoads": [{"magnitude": 50, "x": 4.630000000000003, "angle": -20, "y": 11}, {"magnitude": 20, "x": 6.710000000000001, "angle": 0}, {"magnitude": 7, "x": 9.59}, {"magnitude": 0, "x": 8.870000000000001}], "rapidDrawdown": {"waterBefore": [[40, 5], [0, 9]]}, "waternet": {"headLines": [{"id": "h1", "points": [[0, 8], [40, 2]]}, {"id": "h2", "points": [[40, 0], [20, 1], [0, 3]]}], "referenceLines": [{"points": [[40, -4], [0, -2]], "topHeadLineId": "h1", "bottomHeadLineId": "h2"}, {"points": [[0, -8], [40, -8]], "bottomHeadLineId": "h2"}], "phreaticLineId": "h1"}, "reinforcements": [{"x1": 16, "y1": 9, "x2": 6, "y2": 4, "tensileCapacity": 100, "spacing": 2, "pullout": {"kind": "bond", "strength": 20, "bondedLength": 4}, "direction": "tangent", "application": "passive", "prestress": 10}, {"x1": 18, "y1": 8, "x2": 4, "y2": 2, "tensileCapacity": 80, "pullout": {"kind": "interface", "adhesion": 3, "frictionAngle": 20, "coverage": 0.8}, "end1Capacity": 5}, {"x1": 20, "y1": 6, "x2": 8, "y2": 0, "tensileCapacity": 60, "pullout": {"kind": "development", "length1": 2, "length2": 3}}, {"x1": 22, "y1": 4, "x2": 10, "y2": -2, "tensileCapacity": 40}, {"x1": 25.689999999999998, "y1": 2, "x2": 13.829999999999998, "y2": -1, "tensileCapacity": 50, "pullout": {"kind": "bond", "strength": 15}}], "piles": [{"x1": 9.629999999999999, "y1": 10, "x2": 9.629999999999999, "y2": -6, "diameter": 0.6, "spacing": 1.5, "angle": 10, "direction": "angle", "location": "slip-surface", "wall": false}, {"x1": 5.710000000000001, "y1": 10, "x2": 5.710000000000001, "y2": -4, "diameter": 0.5, "spacing": 1.2, "shearCapacity": 40, "momentCapacity": 30}, {"x1": 12.79, "y1": 11, "x2": 11.79, "y2": -3, "force": 25, "spacing": 2, "direction": "perpendicular"}, {"x1": 2.8699999999999974, "y1": 10, "x2": 2.8699999999999974, "y2": 0, "force": 15, "direction": "tangent", "application": "passive"}], "materialBoundaries": [{"coordinates": [[40, -3], [0, 3]], "materialName": ""}, {"coordinates": [[40, -6], [0, -6]], "materialName": "Spatial"}, {"coordinates": [[40, -8], [0, -8]], "materialName": "Rock"}], "topRegionMaterialName": "Fill", "regionAssignments": [{"point": [2, 9], "materialName": "Fill"}, {"point": [20, -1], "materialName": "Clay"}, {"point": [20, -7], "materialName": "Spatial"}, {"point": [20, -9], "materialName": "Rock"}], "analysisLimits": {"entryLeftX": 2.0900000000000034, "entryRightX": 13.870000000000001, "exitLeftX": 26.17, "exitRightX": 37.93}, "customSearchPlanes": [{"cx": 22, "cy": 22, "radius": 20}, {"cx": 22, "cy": 22, "radius": 25}, {"cx": -60, "cy": 100, "radius": 1}], "customSurfaces": [{"points": [[10, 10], [20, -2], [30, 0]], "axis": [19, 23]}, {"points": [[12, 10], [28, 0]]}, {"points": [[10, 12], [11, 11]]}], "customPlanesOnly": false}"##;
const PLANE: [f64; 5] = [
    9.986683704666925,
    31.53878106241597,
    27.73083599878623,
    19.874620556748372,
    20.338107822416568,
];

fn options(v: serde_json::Value) -> AnalysisOptionsPatch {
    serde_json::from_value(v).unwrap()
}

/// The slices with one slice's weight, or base angle, moved by about 1 ulp.
fn perturbations(slices: &[Slice]) -> Vec<Vec<Slice>> {
    let mut out = Vec::new();
    for i in 0..slices.len() {
        let mut w = slices.to_vec();
        w[i].weight *= 1.0 + f64::EPSILON;
        let mut a = slices.to_vec();
        a[i].alpha += a[i].alpha.abs() * f64::EPSILON;
        out.push(w);
        out.push(a);
    }
    out
}

#[test]
fn accepts_no_pair_with_fm_le_0_or_a_gap_above_the_capped_tolerance_also_after_1_ulp_changes() {
    let def: SlopeDefinition = serde_json::from_str(DEFINITION).unwrap();
    for tolerance in [0.2, 0.1, 0.001] {
        let mut slope = build_slope(&def).unwrap();
        slope
            .update_analysis_options(&options(json!({
                "slices": 25, "iterations": 300, "refinedIterations": 0,
                "tolerance": tolerance, "intersliceFunction": "constant",
            })))
            .unwrap();
        let [x0, x1, cx, cy, r] = PLANE;
        let slices = get_slices(&slope, x0, x1, cx, cy, r, None, &mut SliceScratch::new()).unwrap();
        assert_eq!(slices.len(), 26);
        let mut runs = vec![slices.clone()];
        runs.extend(perturbations(&slices));
        for mut s in runs {
            let out = analyse_morgenstern_price(&slope, &mut s).unwrap();
            assert!(!out.converged, "tolerance {tolerance}: {out:?}");
            assert_ne!(
                out.closest_pair,
                Some(true),
                "tolerance {tolerance}: {out:?}"
            );
            // The walk passed the pair with Fm <= 0 that used to be accepted.
            assert!(out.lff_array.unwrap().iter().any(|e| e[1] <= 0.0));
        }
    }
}

#[test]
fn at_a_loose_tolerance_a_solution_still_agrees_with_the_tight_one_within_1_percent_of_f() {
    let mut slope = Slope::new();
    slope
        .set_external_boundary(&[
            [0.0, -15.0],
            [0.0, 0.0],
            [20.0, 0.0],
            [40.0, -10.0],
            [50.0, -10.0],
            [50.0, -15.0],
        ])
        .unwrap();
    let m1 = slope.insert_material(
        Material::new(MaterialParams {
            name: Some("M1".into()),
            unit_weight: Some(20.0),
            friction_angle: Some(19.6),
            cohesion: Some(3.0),
            ..Default::default()
        })
        .unwrap(),
    );
    slope.assign_material([1.0, -1.0], m1).unwrap();
    let ints = slope
        .get_circle_external_intersection(28.0, 25.0, 35.0)
        .unwrap();
    let mut run = |tolerance: f64| {
        slope
            .update_analysis_options(&options(
                json!({ "slices": 30, "iterations": 200, "tolerance": tolerance }),
            ))
            .unwrap();
        let mut slices = get_slices(
            &slope,
            ints[0][0],
            ints[ints.len() - 1][0],
            28.0,
            25.0,
            35.0,
            None,
            &mut SliceScratch::new(),
        )
        .unwrap();
        analyse_morgenstern_price(&slope, &mut slices).unwrap()
    };
    let exact = run(1e-9).fos.unwrap();
    for tolerance in [0.1, 0.05, 0.01, 0.001] {
        let out = run(tolerance);
        assert!(out.converged);
        let fos = out.fos.unwrap();
        assert!(
            (fos - exact).abs() < 0.01 * exact,
            "tolerance {tolerance}: {fos} vs {exact}"
        );
        // The accepted pair: both factors positive, the gap within the cap.
        let met = out
            .lff_array
            .unwrap()
            .iter()
            .any(|e| e[1] > 0.0 && e[2] > 0.0 && e[3] < tolerance.min(0.01 * e[1].max(e[2])));
        assert!(met);
    }
}
