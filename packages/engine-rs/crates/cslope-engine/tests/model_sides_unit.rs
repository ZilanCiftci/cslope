//! The sides of the model are cuts, not ground: a slip surface enters and
//! leaves through the ground line, never through a side. A side that is
//! vertical but for a drawing or rounding error (a model rotated by
//! 0.006°, its left side leaning out by 0.8 mm over 8 m) put its bottom
//! corner at the model's extreme x and the whole side in the ground line,
//! and the search took circles leaving the model through the side at its
//! bottom corner (in the opposite direction of `bothDirections`, with
//! automatic limits, where they were critical).
#![allow(clippy::disallowed_methods)]

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::api::run_analysis::run_analysis;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::geometry_ops::get_surface_line;
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::types::{AnalysisMethod, SlipSurfaceResult, SlopeDefinition};
use serde_json::json;

/// Level ground at y = 0 from the left side (x = −20) to a berm and a
/// channel down to y = −2.5, level ground again to the right side (x = 15);
/// the base at y = −8.
const COORDS: [[f64; 2]; 12] = [
    [-20.0, -8.0],
    [-20.0, 0.0],
    [-10.0, 0.0],
    [-9.7, 0.3],
    [-4.7, 0.3],
    [-4.4, 0.0],
    [-3.4, 0.0],
    [-1.0, -2.5],
    [1.0, -2.5],
    [3.4, 0.0],
    [15.0, 0.0],
    [15.0, -8.0],
];

/// The model turned clockwise by `angle` (rad) about the origin: the left
/// side leans out, its bottom corner the leftmost vertex.
fn rotated(angle: f64) -> Vec<[f64; 2]> {
    let (s, c) = angle.sin_cos();
    COORDS
        .iter()
        .map(|&[x, y]| [x * c + y * s, -x * s + y * c])
        .collect()
}

fn definition(coordinates: &[[f64; 2]], orientation: &str) -> SlopeDefinition {
    serde_json::from_value(json!({
        "orientation": orientation,
        "coordinates": coordinates,
        "materials": [{ "name": "Clay", "unitWeight": 17, "frictionAngle": 0, "cohesion": 12 }],
    }))
    .unwrap()
}

fn options(both: bool) -> AnalysisOptionsPatch {
    AnalysisOptionsPatch {
        slices: Some(30.0),
        iterations: Some(1000.0),
        refined_iterations: Some(500.0),
        method: Some(AnalysisMethod::MorgensternPrice.into()),
        min_slip_depth: Some(0.5),
        both_directions: Some(both),
        ..Default::default()
    }
}

/// An end point of the surface more than 1 cm below the top of the left
/// side, i.e. on the side.
fn through_the_left_side(s: &SlipSurfaceResult) -> bool {
    [s.entry_point, s.exit_point]
        .iter()
        .any(|&[x, y]| x < -19.99 && y < -0.01)
}

#[test]
fn the_ground_line_starts_at_the_top_of_a_nearly_vertical_side() {
    let model = rotated(1e-4);
    let px: Vec<f64> = model.iter().map(|p| p[0]).collect();
    let py: Vec<f64> = model.iter().map(|p| p[1]).collect();
    let s = get_surface_line(&px, &py).unwrap();
    assert_eq!([s.x[0], s.y[0]], model[1]);
    assert_eq!([s.x[s.x.len() - 1], s.y[s.y.len() - 1]], model[10]);
    assert_eq!(s.x.len(), 10);
    // The other way round (the polygon clockwise), with a vertex part way
    // up the side, and the right side leaning out too.
    let s = get_surface_line(
        &[0.0, 0.0005, 0.001, 10.0, 10.0005],
        &[0.0, -3.0, -8.0, -8.0, 0.0],
    )
    .unwrap();
    assert_eq!((s.x, s.y), (vec![0.0, 10.0005], vec![0.0, 0.0]));
    let s = get_surface_line(&[0.0, 10.0, 10.001, 0.0], &[0.0, 0.0, -8.0, -8.0]).unwrap();
    assert_eq!((s.x, s.y), (vec![0.0, 10.0], vec![0.0, 0.0]));
    // A side that is not nearly vertical (1:5) stays ground, as an
    // embankment's slope reaching the base does.
    let s = get_surface_line(&[-1.6, 0.0, 10.0, 10.0], &[-8.0, 0.0, 0.0, -8.0]).unwrap();
    assert_eq!((s.x, s.y), (vec![-1.6, 0.0, 10.0], vec![-8.0, 0.0, 0.0]));
    // Leaning in: the top is the extreme vertex already.
    let s = get_surface_line(&[0.001, 0.0, 10.0, 10.0], &[-8.0, 0.0, 0.0, -8.0]).unwrap();
    assert_eq!((s.x, s.y), (vec![0.0, 10.0], vec![0.0, 0.0]));
}

#[test]
fn the_automatic_limits_end_at_the_top_of_the_sides() {
    let model = rotated(1e-4);
    let slope = build_slope(&definition(&model, "ltr")).unwrap();
    let [l, r] = [model[1][0], model[10][0]];
    assert_eq!(slope.limits(), [l, r, l, r]);
}

#[test]
fn no_surface_leaves_through_a_side_in_either_direction() {
    let model = rotated(1e-4);
    for orientation in ["ltr", "rtl"] {
        let d = definition(&model, orientation);
        for both in [false, true] {
            let r = run_analysis(&d, &options(both), &mut RunCtx::default()).unwrap();
            let critical = r.critical_surface.as_ref().unwrap();
            assert!(
                !through_the_left_side(critical),
                "{orientation}, both {both}: the critical surface {:?} → {:?} (F {}) leaves through the left side",
                critical.entry_point,
                critical.exit_point,
                r.min_fos
            );
            let through = r
                .all_surfaces
                .iter()
                .filter(|s| through_the_left_side(s))
                .count();
            assert_eq!(
                through,
                0,
                "{orientation}, both {both}: {through} of {} surfaces leave through the left side",
                r.all_surfaces.len()
            );
        }
    }
}

#[test]
fn a_slightly_rotated_model_gives_the_factor_of_the_level_one() {
    for both in [false, true] {
        let level = run_analysis(
            &definition(&COORDS, "ltr"),
            &options(both),
            &mut RunCtx::default(),
        )
        .unwrap();
        let turned = run_analysis(
            &definition(&rotated(1e-4), "ltr"),
            &options(both),
            &mut RunCtx::default(),
        )
        .unwrap();
        assert!(
            (level.min_fos - turned.min_fos).abs() < 0.01 * level.min_fos,
            "both {both}: {} against {}",
            turned.min_fos,
            level.min_fos
        );
    }
}
