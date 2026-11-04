//! The app's finite element summary of a slope that faces left: the mesh,
//! the plastic zone and the displacements lie in the model as drawn (the
//! analysis runs on the slope mirrored to slide to the right).

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::fem::summary::run_fem_summary;
use cslope_engine::js::math as jsm;
use cslope_engine::types::{FemAnalysisSettings, FemResultSummary, SlopeDefinition};
use serde_json::{json, Value};
use std::collections::HashMap;

const W: f64 = 80.0;

/// Ground of the left-facing slope (toe at x = 17, crest at x = 57) at x.
fn ground_left(x: f64) -> f64 {
    if x <= 17.0 {
        15.0
    } else if x >= 57.0 {
        35.0
    } else {
        15.0 + (x - 17.0) * 0.5
    }
}

fn definition(left_facing: bool, orientation: Option<&str>) -> SlopeDefinition {
    let left = [
        [0.0, 0.0],
        [0.0, 15.0],
        [17.0, 15.0],
        [57.0, 35.0],
        [W, 35.0],
        [W, 0.0],
    ];
    let coordinates: Vec<[f64; 2]> = if left_facing {
        left.to_vec()
    } else {
        left.iter().map(|p| [W - p[0], p[1]]).collect()
    };
    let mut def: Value = json!({
        "coordinates": coordinates,
        "materials": [{ "name": "Soil", "model": { "kind": "mohr-coulomb", "unitWeight": 19, "cohesion": 8, "frictionAngle": 25 } }],
        "waterTable": { "mode": "none" },
    });
    if let Some(o) = orientation {
        def["orientation"] = json!(o);
    }
    serde_json::from_value(def).expect("definition")
}

fn settings() -> FemAnalysisSettings {
    let mut s = cslope_engine::types::default_fem_settings();
    s.enabled = true;
    s.element_size = Some(4.0);
    s.refinement_levels = 0.0;
    s.limit_analysis = Some(false);
    s
}

fn run(def: &SlopeDefinition) -> FemResultSummary {
    run_fem_summary(def, &settings(), &mut RunCtx::default()).expect("finite element summary")
}

/// Centroid of the elements with at least half the largest strain increment.
fn plastic_centroid(r: &FemResultSummary) -> [f64; 2] {
    let field = r.shear_increment.as_ref().unwrap_or(&r.plastic_shear);
    let max = field.iter().cloned().fold(0.0, jsm::max);
    let (mut sx, mut sy, mut n) = (0.0, 0.0, 0.0);
    for (e, &v) in field.iter().enumerate() {
        if v < 0.5 * max {
            continue;
        }
        for k in 0..3 {
            sx += r.x[r.triangles[3 * e + k]];
            sy += r.y[r.triangles[3 * e + k]];
        }
        n += 3.0;
    }
    [sx / n, sy / n]
}

#[test]
fn a_left_facing_slope_gives_its_mesh_and_plastic_zone_where_it_is_drawn() {
    for orientation in [Some("rtl"), None] {
        let left = run(&definition(true, orientation));
        let right = run(&definition(false, orientation.map(|_| "ltr")));
        assert!((left.factor_of_safety - right.factor_of_safety).abs() < 1e-9);
        // every node in the soil, under the left-facing ground
        for (i, (&x, &y)) in left.x.iter().zip(&left.y).enumerate() {
            assert!((-1e-4..=W + 1e-4).contains(&x), "node {i} at x = {x}");
            assert!(
                y <= ground_left(x) + 1e-4,
                "node {i} at ({x}, {y}) above the ground"
            );
        }
        // the same mesh mirrored: x' = W − x, the x displacement negated and
        // each element's strain the same (nodes and elements matched by
        // position, whatever their numbering)
        assert_eq!(left.x.len(), right.x.len());
        assert_eq!(left.triangles.len(), right.triangles.len());
        let key = |x: f64, y: f64| (jsm::round(x * 1e3) as i64, jsm::round(y * 1e3) as i64);
        let right_nodes: HashMap<(i64, i64), usize> = (0..right.x.len())
            .map(|j| (key(W - right.x[j], right.y[j]), j))
            .collect();
        let du = |a: f64, b: f64| (a - b).abs() <= 1e-6 * (1.0 + jsm::max(a.abs(), b.abs()));
        for i in 0..left.x.len() {
            let j = right_nodes[&key(left.x[i], left.y[i])];
            assert!(du(left.displacement[2 * i], -right.displacement[2 * j]));
            assert!(du(
                left.displacement[2 * i + 1],
                right.displacement[2 * j + 1]
            ));
        }
        let centroid = |r: &FemResultSummary, e: usize, mirror: bool| {
            let t = &r.triangles[3 * e..3 * e + 3];
            let x = (r.x[t[0]] + r.x[t[1]] + r.x[t[2]]) / 3.0;
            let y = (r.y[t[0]] + r.y[t[1]] + r.y[t[2]]) / 3.0;
            key(if mirror { W - x } else { x }, y)
        };
        let right_elements: HashMap<(i64, i64), usize> = (0..right.plastic_shear.len())
            .map(|e| (centroid(&right, e, true), e))
            .collect();
        for e in 0..left.plastic_shear.len() {
            let f = right_elements[&centroid(&left, e, false)];
            assert!(du(left.plastic_shear[e], right.plastic_shear[f]));
        }
        // the plastic zone under the slope face, between the toe and the crest
        let [cx, cy] = plastic_centroid(&left);
        assert!(cx > 10.0 && cx < 64.0, "plastic zone centred at x = {cx}");
        assert!(
            cy < ground_left(cx),
            "plastic zone centred above the ground at ({cx}, {cy})"
        );
    }
}
