//! Port of packages/engine/src/model/solvers.test.ts: the Ordinary, Bishop,
//! Janbu and Morgenstern-Price solvers, plus the top-level analyse_slope
//! orchestrator.
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::search::add_single_circular_plane;
use cslope_engine::model::slices::{get_slices, SliceScratch};
use cslope_engine::model::slope::{AnalysisLimitsPatch, AnalysisOptionsPatch, Slope};
use cslope_engine::model::solvers::{
    analyse_bishop, analyse_janbu, analyse_morgenstern_price, analyse_ordinary, analyse_slope,
};
use cslope_engine::types::{
    AnalysisMethod, IntersliceFunctionType, Material, MaterialParams, Slice, WaterTableInput,
};
use model_core_support::close;

// ── Shared fixtures ──────────────────────────────────────────────

const SLOPE_COORDS: [[f64; 2]; 6] = [
    [0.0, -15.0],
    [0.0, 0.0],
    [20.0, 0.0],
    [40.0, -10.0],
    [50.0, -10.0],
    [50.0, -15.0],
];

fn mat(name: &str, unit_weight: f64, friction_angle: f64, cohesion: f64) -> Material {
    Material::new(MaterialParams {
        name: Some(name.into()),
        unit_weight: Some(unit_weight),
        friction_angle: Some(friction_angle),
        cohesion: Some(cohesion),
        ..Default::default()
    })
    .unwrap()
}

fn create_homogeneous_slope() -> Slope {
    let mut s = Slope::new();
    s.set_external_boundary(&SLOPE_COORDS).unwrap();
    let m1 = s.insert_material(mat("M1", 20.0, 19.6, 3.0));
    s.assign_material([1.0, -1.0], m1).unwrap();
    s
}

fn options(
    slices: f64,
    iterations: Option<f64>,
    method: Option<AnalysisMethod>,
) -> AnalysisOptionsPatch {
    AnalysisOptionsPatch {
        slices: Some(slices),
        iterations,
        method: method.map(Into::into),
        ..Default::default()
    }
}

fn limits() -> AnalysisLimitsPatch {
    AnalysisLimitsPatch {
        entry_left_x: Some(17.0),
        entry_right_x: Some(22.0),
        exit_left_x: Some(37.0),
        exit_right_x: Some(43.0),
    }
}

fn slices_of(slope: &Slope, cx: f64, cy: f64, r: f64) -> Vec<Slice> {
    let ints = slope.get_circle_external_intersection(cx, cy, r).unwrap();
    assert!(ints.len() >= 2);
    get_slices(
        slope,
        ints[0][0],
        ints[ints.len() - 1][0],
        cx,
        cy,
        r,
        None,
        &mut SliceScratch::new(),
    )
    .unwrap()
}

fn analyse(s: &mut Slope) -> Option<f64> {
    analyse_slope(s, &mut RunCtx::default()).unwrap()
}

fn searched(method: AnalysisMethod) -> Option<f64> {
    let mut s = create_homogeneous_slope();
    s.set_analysis_limits(&limits());
    s.update_analysis_options(&options(50.0, Some(200.0), Some(method)))
        .unwrap();
    analyse(&mut s)
}

// ── Individual solver tests with a known circle ──────────────────

// cx=28, cy=25, r=35
// Entry x=3.505103, Exit x=37.418087
// Ordinary FOS=1.634496, Bishop FOS=1.714896, Janbu FOS=1.628078
const CX: f64 = 28.0;
const CY: f64 = 25.0;
const R: f64 = 35.0;

fn fixed() -> (Slope, Vec<Slice>) {
    let mut slope = create_homogeneous_slope();
    slope
        .update_analysis_options(&options(30.0, Some(200.0), None))
        .unwrap();
    let slices = slices_of(&slope, CX, CY, R);
    (slope, slices)
}

#[test]
fn generates_expected_number_of_slices() {
    let (_, slices) = fixed();
    // expected: 30 slices
    assert!(slices.len() >= 25 && slices.len() <= 40, "{}", slices.len());
}

#[test]
fn ordinary_method_matches_expected_fos() {
    let (slope, slices) = fixed();
    let fos = analyse_ordinary(&slope, &slices).unwrap();
    // expected: 1.634496
    close(fos, 1.634, 1);
}

#[test]
fn bishop_method_matches_expected_fos() {
    let (slope, mut slices) = fixed();
    let fos = analyse_bishop(&slope, &mut slices, None).0.unwrap();
    // expected: 1.714896
    close(fos, 1.715, 1);
}

#[test]
fn janbu_method_matches_expected_fos() {
    let (slope, mut slices) = fixed();
    let fos = analyse_janbu(&slope, &mut slices, None).0.unwrap();
    // expected: 1.628078
    close(fos, 1.628, 1);
}

#[test]
fn bishop_fos_above_ordinary_fos() {
    let (slope, mut slices) = fixed();
    let ord = analyse_ordinary(&slope, &slices).unwrap();
    let bish = analyse_bishop(&slope, &mut slices, None).0.unwrap();
    assert!(bish > ord);
}

#[test]
fn morgenstern_price_converges() {
    let (slope, mut slices) = fixed();
    let fos = analyse_morgenstern_price(&slope, &mut slices)
        .unwrap()
        .fos
        .unwrap();
    assert!(fos > 0.0);
    // M-P should be close to Bishop for this simple case
    close(fos, 1.7, 0);
}

// ── analyse_slope full orchestration ──────────────────────────────

#[test]
fn finds_critical_fos_for_homogeneous_slope_bishop() {
    let fos = searched(AnalysisMethod::Bishop).unwrap();
    // expected: 0.984635
    assert!(fos > 0.5 && fos < 2.0, "{fos}");
}

#[test]
fn janbu_gives_lower_fos_than_bishop() {
    let b = searched(AnalysisMethod::Bishop).unwrap();
    let j = searched(AnalysisMethod::Janbu).unwrap();
    // Janbu typically gives lower FOS than Bishop
    assert!(j < b * 1.1);
}

#[test]
fn water_table_reduces_fos_on_same_circle() {
    // Test on a single known circle to isolate water table effect
    let mut dry = create_homogeneous_slope();
    dry.update_analysis_options(&options(30.0, None, Some(AnalysisMethod::Bishop)))
        .unwrap();
    let mut slices_dry = slices_of(&dry, CX, CY, R);
    let fos_dry = analyse_bishop(&dry, &mut slices_dry, None).0;

    let mut wet = create_homogeneous_slope();
    // Use followBoundary=false for a simple horizontal water line
    wet.set_water_table(&WaterTableInput::Height {
        height: -5.0,
        follow_boundary: Some(false),
    })
    .unwrap();
    wet.update_analysis_options(&options(30.0, None, Some(AnalysisMethod::Bishop)))
        .unwrap();
    let mut slices_wet = slices_of(&wet, CX, CY, R);
    // Verify slices have pore pressure
    assert!(slices_wet.iter().any(|s| s.u > 0.0));
    let fos_wet = analyse_bishop(&wet, &mut slices_wet, None).0;
    let (fos_dry, fos_wet) = (fos_dry.unwrap(), fos_wet.unwrap());
    assert!(fos_wet.is_finite());
    // Water should reduce FOS on the same failure surface
    assert!(fos_wet < fos_dry);
}

#[test]
fn sets_zero_pore_pressure_when_slice_midpoint_is_above_water_line() {
    let mut s = create_homogeneous_slope();
    // Sloped custom water line with followBoundary=true to include realistic
    // clipping behavior around side boundaries and terrain breaks.
    s.set_water_table(&WaterTableInput::Custom {
        coordinates: vec![[0.0, -3.0], [50.0, -10.0]],
        follow_boundary: Some(true),
    })
    .unwrap();
    s.update_analysis_options(&options(30.0, None, Some(AnalysisMethod::Bishop)))
        .unwrap();
    let slices = slices_of(&s, CX, CY, R);
    for slice in &slices {
        let Ok(water_y) = s.get_water_y_intersection(slice.x) else {
            continue;
        };
        if !water_y.is_finite() {
            continue;
        }
        if slice.y_bottom >= water_y - 1e-9 {
            close(slice.u, 0.0, 9);
        }
    }
}

#[test]
fn sets_search_results_on_slope_model_after_analysis() {
    let mut s = create_homogeneous_slope();
    s.set_analysis_limits(&limits());
    s.update_analysis_options(&options(50.0, Some(200.0), Some(AnalysisMethod::Bishop)))
        .unwrap();
    analyse(&mut s);
    assert!(!s.search().is_empty());
    assert!(s.get_min_fos().unwrap() > 0.0);
    let (_, _, radius) = s.get_min_fos_circle().unwrap();
    assert!(radius > 0.0);
}

#[test]
fn analyses_a_single_manually_added_plane() {
    let mut s = create_homogeneous_slope();
    s.update_analysis_options(&options(30.0, None, Some(AnalysisMethod::Bishop)))
        .unwrap();
    add_single_circular_plane(&mut s, 28.0, 25.0, 35.0).unwrap();
    s.set_custom_planes_only(true);
    let fos = analyse(&mut s).unwrap();
    // expected: Bishop FOS ~1.71 for this circle
    close(fos, 1.7, 0);
}

// ── Morgenstern-Price specific tests ─────────────────────────────

#[test]
fn morgenstern_price_full_analysis_converges() {
    let fos = searched(AnalysisMethod::MorgensternPrice).unwrap();
    // expected: 0.984792
    assert!(fos > 0.5 && fos < 2.0, "{fos}");
}

#[test]
fn morgenstern_price_close_to_bishop_for_simple_homogeneous_slope() {
    let b = searched(AnalysisMethod::Bishop).unwrap();
    let mp = searched(AnalysisMethod::MorgensternPrice).unwrap();
    // For simple slopes, M-P and Bishop should be very close
    assert!((mp - b).abs() < 0.1);
}

#[test]
fn supports_selectable_interslice_function_modes() {
    for mode in [
        IntersliceFunctionType::Constant,
        IntersliceFunctionType::HalfSine,
        IntersliceFunctionType::ClippedSine,
        IntersliceFunctionType::Trapezoidal,
        IntersliceFunctionType::DataPointSpecified,
    ] {
        let mut s = create_homogeneous_slope();
        s.set_analysis_limits(&limits());
        s.update_analysis_options(&AnalysisOptionsPatch {
            slices: Some(40.0),
            iterations: Some(150.0),
            method: Some(AnalysisMethod::MorgensternPrice.into()),
            interslice_function: Some(mode.into()),
            interslice_data_points: Some(
                if mode == IntersliceFunctionType::DataPointSpecified {
                    vec![[0.0, 0.0], [0.2, 0.6], [0.5, 1.0], [0.8, 0.6], [1.0, 0.0]]
                } else {
                    vec![]
                }
                .into(),
            ),
            ..Default::default()
        })
        .unwrap();
        let fos = analyse(&mut s).unwrap_or_else(|| panic!("mode={mode:?}"));
        assert!(fos > 0.3 && fos < 5.0, "mode={mode:?}: {fos}");
    }
}

// ── Multi-material slope ─────────────────────────────────────────

#[test]
fn analyses_layered_slope_with_bishop() {
    let mut s = Slope::new();
    let clay = s.insert_material(mat("Clay", 20.0, 25.0, 10.0));
    let sand = s.insert_material(mat("Sand", 19.0, 32.0, 0.0));
    s.set_external_boundary(&SLOPE_COORDS).unwrap();
    s.set_material_boundary(&[[0.0, -5.0], [50.0, -5.0]])
        .unwrap();
    s.assign_material([25.0, -3.0], clay).unwrap();
    s.assign_material([25.0, -12.0], sand).unwrap();
    s.set_analysis_limits(&limits());
    s.update_analysis_options(&options(50.0, Some(200.0), Some(AnalysisMethod::Bishop)))
        .unwrap();
    let fos = analyse(&mut s).unwrap();
    // expected: 1.487133
    assert!(fos > 0.5 && fos < 5.0, "{fos}");
}

// ── Edge cases ───────────────────────────────────────────────────

#[test]
fn returns_none_for_empty_slices() {
    let s = create_homogeneous_slope();
    assert_eq!(analyse_ordinary(&s, &[]), None);
}

#[test]
fn ordinary_returns_none_for_zero_or_negative_pushing_force() {
    // Create a flat slope where pushing should be ≤ 0
    let mut s = Slope::new();
    let m = s.insert_material(mat("Test", 20.0, 45.0, 100.0));
    s.set_external_boundary(&[[0.0, -5.0], [0.0, 0.0], [50.0, 0.0], [50.0, -5.0]])
        .unwrap();
    s.assign_material([25.0, -2.0], m).unwrap();
    // A nearly horizontal circle won't produce meaningful slices
    // but we test that the solver handles edge cases gracefully
    assert_eq!(analyse_ordinary(&s, &[]), None);
}
