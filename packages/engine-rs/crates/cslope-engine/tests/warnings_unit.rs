//! Ports of packages/engine/src/model/result-warnings.test.ts,
//! surface-slide.test.ts and shallow-surface-warning.test.ts ("is flagged
//! for Bishop after the non-circular optimisation" is in
//! deferred_optimise_unit.rs).
#![allow(clippy::disallowed_methods)]

mod common;
mod model_core_support;
mod solvers_support;

use cslope_engine::api::ctx::RunCtx;
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::geometry_ops::polygonize_regions_detailed;
use cslope_engine::model::result_warnings::{
    analysis_warnings, entry_inclination, shallow_cohesionless_message, M_ALPHA_WARNING_LIMIT,
};
use cslope_engine::model::slope::{AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::model::solvers::{analyse_slope, solved_effective_normals};
use cslope_engine::model::surface_slide::{frictional_surface_slide, surface_slide_message};
use cslope_engine::types::{
    default_analysis_options, AnalysisWarning, AnalysisWarningCode, Slice, SlopeDefinition,
};
use model_core_support::{close, def};
use serde_json::{json, Value};
use solvers_support::run_verification;

fn mc(unit_weight: f64, cohesion: f64, friction_angle: f64) -> Value {
    json!({ "kind": "mohr-coulomb", "unitWeight": unit_weight, "cohesion": cohesion, "frictionAngle": friction_angle })
}

fn warnings(s: &Slope, normals: Option<&[f64]>) -> Vec<AnalysisWarning> {
    analysis_warnings(s, normals).unwrap()
}

fn codes(s: &Slope) -> Vec<AnalysisWarningCode> {
    warnings(s, None).into_iter().map(|w| w.code).collect()
}

// ── boundary end snapping ─────────────────────────────────────────

fn split(lines: &[Vec<[f64; 2]>]) -> cslope_engine::model::geometry_ops::RegionFacesResult {
    let ring = [
        [0.0, -10.0],
        [0.0, 10.0],
        [10.0, 10.0],
        [30.0, 0.0],
        [40.0, 0.0],
        [40.0, -10.0],
    ];
    let px: Vec<f64> = ring.iter().map(|p| p[0]).collect();
    let py: Vec<f64> = ring.iter().map(|p| p[1]).collect();
    polygonize_regions_detailed(&px, &py, lines).unwrap()
}

#[test]
fn puts_an_end_short_of_another_boundary_on_it() {
    // A layer across the slope and a vertical boundary stopping 2 cm above
    // it (tolerance 1e-3 × 40 m = 4 cm): three regions.
    let r = split(&[
        vec![[0.0, -3.0], [40.0, -5.0]],
        vec![[20.0, -4.0 + 0.02], [20.0, 5.0]],
    ]);
    assert!(r.dangling_boundaries.is_empty());
    assert_eq!(r.faces.len(), 3);
}

#[test]
fn closes_a_lens_drawn_with_a_small_gap() {
    let r = split(&[vec![
        [10.0, -2.0],
        [20.0, -6.0],
        [30.0, -2.0],
        [10.01, -2.0],
    ]]);
    assert!(r.dangling_boundaries.is_empty());
    assert_eq!(r.faces.len(), 2);
}

#[test]
fn reports_an_end_farther_away_than_the_tolerance_and_only_that_line() {
    let r = split(&[
        vec![[0.0, -3.0], [40.0, -5.0]],
        vec![[20.0, -4.0 + 0.5], [20.0, 5.0]],
    ]);
    assert_eq!(r.dangling_boundaries, vec![1]);
    assert_eq!(r.faces.len(), 2);
}

#[test]
fn does_not_report_a_boundary_that_runs_past_the_outline() {
    let r = split(&[vec![[-1.0, 2.0], [41.0, -3.0]]]);
    assert!(r.dangling_boundaries.is_empty());
    assert_eq!(r.faces.len(), 2);
}

// ── analysisWarnings on the critical surface ──────────────────────

const DEG: f64 = std::f64::consts::PI / 180.0;

/// A slope with analysed surfaces (TypeScript's stub: Bishop, no Janbu
/// correction, no dangling boundaries).
fn stub(planes: Vec<SearchPlane>) -> Slope {
    let mut s = Slope::new();
    s.update_analysis_options(&AnalysisOptionsPatch {
        method: Some(cslope_engine::types::AnalysisMethod::Bishop.into()),
        janbu_correction: Some(false),
        ..Default::default()
    })
    .unwrap();
    s.set_search_results(planes);
    s
}

fn plane(fos: Option<f64>, slices: Vec<Slice>) -> SearchPlane {
    SearchPlane {
        fos,
        slices: Some(slices),
        ..Default::default()
    }
}

fn slice(alpha_deg: f64, phi_deg: f64) -> Slice {
    Slice {
        alpha: alpha_deg * DEG,
        phi: phi_deg * DEG,
        ..Default::default()
    }
}

#[test]
fn counts_slices_with_negative_n_and_ignores_zero_within_rounding() {
    let slices = [0.0, 10.0, 20.0, 30.0].map(|a| slice(a, 30.0)).to_vec();
    let w = warnings(
        &stub(vec![plane(Some(1.5), slices)]),
        Some(&[-5.0, -1e-9, 40.0, 100.0]),
    );
    assert_eq!(
        w,
        vec![AnalysisWarning {
            code: AnalysisWarningCode::NegativeEffectiveNormal,
            message: "1 slice of the critical surface has negative effective normal force (N′ < 0) at the base.".into(),
            count: Some(1),
            boundary_index: None,
        }]
    );
}

#[test]
fn counts_slices_with_m_alpha_below_0_2() {
    // m_α = cos α + sin α tan φ / F, F = 1: at α = −50°, φ = 40°:
    // 0.643 − 0.766 × 0.839 = 0.000; at α = −40°: 0.226.
    let slices = [-50.0, -45.0, -40.0, 0.0, 30.0]
        .map(|a| slice(a, 40.0))
        .to_vec();
    let w = warnings(&stub(vec![plane(Some(1.0), slices)]), Some(&[1.0; 5]));
    assert_eq!(M_ALPHA_WARNING_LIMIT, 0.2);
    assert_eq!(
        w,
        vec![AnalysisWarning {
            code: AnalysisWarningCode::LowMAlpha,
            message: "2 slices of the critical surface have m_α below 0.2 (steep base); the factor of safety may be unreliable.".into(),
            count: Some(2),
            boundary_index: None,
        }]
    );
}

#[test]
fn uses_tan_phi_0_for_a_slice_where_the_undrained_strength_governs() {
    let s = Slice {
        undrained_governs: Some(true),
        ..slice(-50.0, 40.0)
    };
    assert!(warnings(&stub(vec![plane(Some(1.0), vec![s])]), Some(&[1.0])).is_empty());
}

#[test]
fn checks_only_the_critical_first_analysed_surface() {
    let s = stub(vec![
        plane(None, vec![slice(-50.0, 40.0)]),
        plane(Some(1.2), vec![slice(0.0, 30.0)]),
    ]);
    assert!(warnings(&s, Some(&[10.0])).is_empty());
}

#[test]
fn solves_n_itself_when_none_are_given() {
    // Strong over weak, the critical surface has tension at the base of
    // the slice below the crest (cohesive crust without a tension crack).
    let mut slope = build_slope(&def(json!({
        "coordinates": [[0, -10], [0, 10], [10, 10], [30, 0], [40, 0], [40, -10]],
        "materials": [{ "name": "Strong", "model": mc(18.0, 15.0, 30.0) }, { "name": "Weak", "model": mc(18.0, 2.0, 8.0) }],
        "materialBoundaries": [{ "coordinates": [[0, 3], [40, -1]], "materialName": "Weak" }],
        "regionAssignments": [{ "point": [1, 9], "materialName": "Strong" }, { "point": [1, -5], "materialName": "Weak" }],
    })))
    .unwrap();
    slope
        .update_analysis_options(
            &serde_json::from_value(
                json!({ "method": "Bishop", "iterations": 300, "refinedIterations": 100 }),
            )
            .unwrap(),
        )
        .unwrap();
    analyse_slope(&mut slope, &mut RunCtx::default()).unwrap();
    let crit = slope
        .search()
        .iter()
        .find(|p| p.fos.is_some())
        .unwrap()
        .clone();
    let normals = solved_effective_normals(
        &slope,
        &mut crit.slices.clone().unwrap(),
        crit.fos.unwrap(),
        crit.lff_array.as_deref(),
    )
    .unwrap();
    let negative = normals.iter().filter(|&&n| n < 0.0).count();
    assert!(negative > 0);
    let w = warnings(&slope, None)
        .into_iter()
        .find(|x| x.code == AnalysisWarningCode::NegativeEffectiveNormal)
        .unwrap();
    assert_eq!(w.count, Some(negative));
}

// ── Bishop on a non-circular surface ──────────────────────────────

/// V046: Fredlund and Krahn's (1977) composite surface along a weak seam.
fn v046() -> Value {
    let cases: Vec<Value> = common::verification_cases();
    cases.into_iter().find(|c| c["id"] == "V046a").unwrap()["definition"].clone()
}

/// The default axis (defaultAxisPoint), the published circle's centre and
/// other points above the sliding mass.
const AXES: [Option<[f64; 2]>; 6] = [
    None,
    Some([120.0, 90.0]),
    Some([100.0, 110.0]),
    Some([140.0, 100.0]),
    Some([110.0, 70.0]),
    Some([90.0, 120.0]),
];

fn with_axis(axis: Option<[f64; 2]>) -> Value {
    let mut d = v046();
    let points = d["customSurfaces"][0]["points"].clone();
    d["customSurfaces"] = match axis {
        Some(a) => json!([{ "points": points, "axis": a }]),
        None => json!([{ "points": points }]),
    };
    d
}

fn has_bishop_warning(s: &Slope) -> bool {
    codes(s).contains(&AnalysisWarningCode::BishopNonCircular)
}

#[test]
fn morgenstern_price_and_spencer_do_not_depend_on_the_moment_axis() {
    // Both satisfy moment and force equilibrium, so the factor is the same
    // about any point (Fredlund and Krahn 1977). Tight tolerance: the
    // invariance holds to the solver's convergence.
    for f in ["half-sine", "constant"] {
        let fos: Vec<f64> = AXES
            .iter()
            .map(|&a| {
                run_verification(
                    with_axis(a),
                    "Morgenstern-Price",
                    json!({ "intersliceFunction": f, "tolerance": 1e-5 }),
                )
                .0
                .unwrap()
            })
            .collect();
        let (lo, hi) = fos
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), &x| {
                (l.min(x), h.max(x))
            });
        assert!(hi - lo < 1e-4, "{f}: {fos:?}");
    }
}

#[test]
fn bishop_depends_on_the_moment_axis_and_is_flagged() {
    // λ = 0 leaves horizontal force equilibrium unsatisfied, so the moment
    // factor moves with the axis (1.363 to 1.406 here).
    let runs: Vec<(Option<f64>, Slope)> = AXES
        .iter()
        .map(|&a| run_verification(with_axis(a), "Bishop", json!({})))
        .collect();
    let fos: Vec<f64> = runs.iter().map(|r| r.0.unwrap()).collect();
    let (lo, hi) = fos
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), &x| {
            (l.min(x), h.max(x))
        });
    assert!(hi - lo > 0.02);
    for (_, slope) in &runs {
        let w: Vec<AnalysisWarning> = warnings(slope, None)
            .into_iter()
            .filter(|x| x.code == AnalysisWarningCode::BishopNonCircular)
            .collect();
        assert_eq!(w.len(), 1);
        assert!(w[0].message.contains("depends on the moment axis"));
    }
}

#[test]
fn bishop_warning_not_given_for_morgenstern_price_on_the_polyline() {
    assert!(!has_bishop_warning(
        &run_verification(with_axis(None), "Morgenstern-Price", json!({})).1
    ));
}

#[test]
fn bishop_warning_not_given_for_bishop_on_a_circle() {
    let mut d = v046();
    d.as_object_mut().unwrap().remove("customSurfaces");
    d["customPlanesOnly"] = json!(false);
    // (circles only: a composite circle along the base is flagged too)
    let (_, slope) = run_verification(
        d,
        "Bishop",
        json!({ "iterations": 200, "refinedIterations": 0, "compositeSurfaces": false }),
    );
    assert!(slope
        .search()
        .iter()
        .find(|p| p.fos.is_some())
        .unwrap()
        .points
        .is_none());
    assert!(!has_bishop_warning(&slope));
}

// ── steep entry without complete equilibrium ──────────────────────

/// φ = 0 slope with a vertical upper face: the circle enters at about 82°
/// and Spencer finds no λ where moment and force equilibrium meet.
fn steep_def() -> Value {
    json!({
        "orientation": "ltr",
        "coordinates": [[0, -10.1434], [0, 12.3984], [13.0087, 12.3984], [38.2674, 0], [52.0491, 0], [52.0491, -10.1434]],
        "materials": [{ "name": "Upper", "model": mc(20.8894, 17.2195, 0.0) }],
        "customSearchPlanes": [{ "cx": 27.1581, "cy": 14.9465, "radius": 19.4513 }],
        "customPlanesOnly": true,
    })
}

fn find(s: &Slope, code: AnalysisWarningCode) -> Option<AnalysisWarning> {
    warnings(s, None).into_iter().find(|x| x.code == code)
}

#[test]
fn names_the_steep_entry_and_the_crack_angle_when_no_surface_solves() {
    let (fos, slope) = run_verification(
        steep_def(),
        "Morgenstern-Price",
        json!({ "intersliceFunction": "constant" }),
    );
    assert_eq!(fos, None);
    close(entry_inclination(&slope.search()[0]), 82.4, 0);
    let w = find(&slope, AnalysisWarningCode::SteepEntryNoEquilibrium).unwrap();
    assert!(
        w.message.contains("enters the slope at 82°"),
        "{}",
        w.message
    );
    assert!(w.message.contains("Crack at base angle"));
}

#[test]
fn solves_with_the_steep_part_cut_off_without_the_warning() {
    let (fos, slope) = run_verification(
        steep_def(),
        "Morgenstern-Price",
        json!({ "intersliceFunction": "constant", "tensionCrackAngle": 70 }),
    );
    let bishop = run_verification(steep_def(), "Bishop", json!({ "tensionCrackAngle": 70 }))
        .0
        .unwrap();
    // φ = 0: moment equilibrium alone fixes F, the same for every method.
    close(fos.unwrap(), bishop, 3);
    assert!(find(&slope, AnalysisWarningCode::SteepEntryNoEquilibrium).is_none());
}

#[test]
fn bishop_names_the_tension_at_the_steep_entry_instead() {
    let (fos, slope) = run_verification(steep_def(), "Bishop", json!({}));
    assert!(!codes(&slope).contains(&AnalysisWarningCode::SteepEntryNoEquilibrium));
    let w = find(&slope, AnalysisWarningCode::SteepEntryTension).unwrap();
    assert!(w.message.contains("enters the slope at 82°"));
    assert!(w.message.contains("tension"));
    assert!(w.message.contains("Crack at base angle"));
    assert!(w.count.unwrap() > 0);
    // Without the slices that hold by tension the factor is lower here.
    let (cut, cut_slope) =
        run_verification(steep_def(), "Bishop", json!({ "tensionCrackAngle": 70 }));
    assert!(cut.unwrap() < fos.unwrap());
    assert!(!codes(&cut_slope).contains(&AnalysisWarningCode::SteepEntryTension));
}

#[test]
fn names_the_steep_entry_for_janbu_and_a_converged_morgenstern_price_too() {
    let mut cphi = steep_def();
    cphi["materials"] = json!([{ "name": "U", "model": mc(20.0, 15.0, 25.0) }]);
    for (method, o) in [
        ("Janbu", json!({})),
        (
            "Morgenstern-Price",
            json!({ "intersliceFunction": "half-sine" }),
        ),
    ] {
        let (fos, slope) = run_verification(cphi.clone(), method, o);
        assert!(fos.is_some());
        assert!(
            codes(&slope).contains(&AnalysisWarningCode::SteepEntryTension),
            "{method}"
        );
    }
}

// ── surface-slide.test.ts ─────────────────────────────────────────

/// A 2:1 slope 10 m high (β = 26.57°).
fn slide_slope(c: f64, phi: f64, extra: Value) -> Slope {
    let mut d = json!({
        "coordinates": [[0, 0], [0, 15], [10, 15], [30, 5], [45, 5], [45, 0]],
        "materials": [{ "name": "Fill", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": c, "frictionAngle": phi } }],
        "materialBoundaries": [],
        "regionAssignments": [{ "point": [1, 1], "materialName": "Fill" }],
    });
    for (k, v) in extra.as_object().unwrap() {
        d[k] = v.clone();
    }
    let d: SlopeDefinition = serde_json::from_value(d).unwrap();
    build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap()
}

fn slide(s: &Slope) -> Option<cslope_engine::model::surface_slide::SurfaceSlide> {
    frictional_surface_slide(s, false).unwrap()
}

#[test]
fn gives_tan_phi_over_tan_beta_on_the_face_of_a_cohesionless_slope() {
    let s = slide(&slide_slope(0.0, 30.0, json!({}))).unwrap();
    close(
        s.factor_of_safety,
        (std::f64::consts::PI / 6.0).tan() * 2.0,
        6,
    );
    close(
        s.inclination,
        0.5f64.atan() * 180.0 / std::f64::consts::PI,
        6,
    );
    assert_eq!([s.x1, s.y1, s.x2, s.y2], [10.0, 15.0, 30.0, 5.0]);
}

#[test]
fn reports_a_right_to_left_models_face_in_its_own_coordinates() {
    let d: SlopeDefinition = serde_json::from_value(json!({
        "coordinates": [[0, 0], [0, 5], [15, 5], [35, 15], [45, 15], [45, 0]],
        "materials": [{ "name": "Fill", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 0, "frictionAngle": 30 } }],
        "materialBoundaries": [],
        "regionAssignments": [{ "point": [1, 1], "materialName": "Fill" }],
        "orientation": "rtl",
    }))
    .unwrap();
    let s =
        slide(&build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap()).unwrap();
    let r9 = |v: f64| (v * 1e9).round() / 1e9;
    assert_eq!(
        [r9(s.x1), r9(s.y1), r9(s.x2), r9(s.y2)],
        [35.0, 15.0, 15.0, 5.0]
    );
    close(s.factor_of_safety, 1.1547, 4);
}

#[test]
fn skips_near_vertical_steps() {
    let d: SlopeDefinition = serde_json::from_value(json!({
        "coordinates": [[0, 0], [0, 15], [10, 15], [10.001, 5], [45, 5], [45, 0]],
        "materials": [{ "name": "Fill", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 0, "frictionAngle": 30 } }],
        "materialBoundaries": [],
        "regionAssignments": [{ "point": [1, 1], "materialName": "Fill" }],
    }))
    .unwrap();
    assert!(
        slide(&build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap()).is_none()
    );
}

#[test]
fn ignores_a_face_with_cohesion() {
    assert!(slide(&slide_slope(5.0, 30.0, json!({}))).is_none());
}

#[test]
fn checks_a_face_above_the_water_table_only() {
    // the water table along the face: the factor depends on the flow
    assert!(slide(&slide_slope(0.0, 30.0, json!({ "waterTable": { "mode": "custom", "value": [[0, 15], [10, 15], [30, 5], [45, 5]] } }))).is_none());
    // below the toe: the face is dry
    close(
        slide(&slide_slope(
            0.0,
            30.0,
            json!({ "waterTable": { "mode": "custom", "value": [[0, 3], [45, 3]] } }),
        ))
        .unwrap()
        .factor_of_safety,
        1.1547,
        4,
    );
    // level water over the ground: clipped to it, as seepage out of the face
    assert!(slide(&slide_slope(
        0.0,
        30.0,
        json!({ "waterTable": { "mode": "custom", "value": [[0, 20], [45, 20]] } })
    ))
    .is_none());
}

#[test]
fn skips_a_face_that_reinforcement_reaches() {
    let s = slide_slope(
        0.0,
        30.0,
        json!({ "reinforcements": [{ "x1": 20, "y1": 10, "x2": 5, "y2": 10, "tensileCapacity": 100 }] }),
    );
    assert!(slide(&s).is_none());
}

#[test]
fn is_a_warning_of_the_limit_equilibrium_analysis_when_below_the_critical_surfaces_factor() {
    // a deep circle in a 2:1 slope with c′ = 0: its factor is above the face's tan φ′/tan β
    let circle = json!({ "customSearchPlanes": [{ "cx": 25, "cy": 30, "radius": 25 }], "customPlanesOnly": true });
    let mut s = slide_slope(0.0, 30.0, circle.clone());
    let f = analyse_slope(&mut s, &mut RunCtx::default())
        .unwrap()
        .unwrap();
    assert!(f > 1.1548);
    let w = find(&s, AnalysisWarningCode::FrictionalSurfaceSlide).unwrap();
    assert!(
        w.message.contains("F = tan φ′/tan β = 1.155"),
        "{}",
        w.message
    );
    // with cohesion there is none
    let mut t = slide_slope(10.0, 30.0, circle);
    analyse_slope(&mut t, &mut RunCtx::default()).unwrap();
    assert!(find(&t, AnalysisWarningCode::FrictionalSurfaceSlide).is_none());
}

#[test]
fn names_the_friction_angle_on_characteristic_values_without_design() {
    let s = slide(&slide_slope(0.0, 30.0, json!({}))).unwrap();
    assert!(!s.design);
    let m = surface_slide_message(&s, 1.3);
    assert!(
        m.contains("in Fill (c′ = 0, φ′ = 30.0°) is inclined at 26.6°"),
        "{m}"
    );
    assert!(!m.contains("design"), "{m}");
}

#[test]
fn names_the_design_friction_angle_when_partial_factors_apply() {
    let mut slope = slide_slope(0.0, 30.0, json!({}));
    let o: AnalysisOptionsPatch = serde_json::from_value(
        json!({ "partialFactors": { "cu": 1.5, "cohesion": 1.25, "tanPhi": 1.25, "variableLoad": 1 } }),
    )
    .unwrap();
    slope.update_analysis_options(&o).unwrap();
    let s = slide(&slope).unwrap();
    assert!(s.design);
    // tan φ′d = tan 30° / 1.25
    let m = surface_slide_message(&s, 1.3);
    assert!(
        m.contains("in Fill (c′ = 0, design φ′ = 24.8°) is inclined at 26.6°"),
        "{m}"
    );
    assert!(m.contains("F = tan φ′/tan β = 0.924"), "{m}");
}

// ── shallow-surface-warning.test.ts ───────────────────────────────

/// A road bank of cohesionless fill (45° edges) on clay beside a 1:2 cut:
/// the search finds a thin slide in the bank's edge before the cut's slip
/// surface.
fn bank_run(min_failure_dist: f64) -> (f64, Slope) {
    let d: SlopeDefinition = serde_json::from_value(json!({
        "orientation": "ltr",
        "coordinates": [[0, -10], [0, 0], [2, 0], [2.4, 0.4], [6.6, 0.4], [7, 0], [8, 0], [12, -2], [20, -2], [20, -10]],
        "materials": [
            { "name": "fill", "model": { "kind": "mohr-coulomb", "unitWeight": 20, "cohesion": 0, "frictionAngle": 32 } },
            { "name": "clay", "model": { "kind": "undrained", "unitWeight": 17, "undrainedShearStrength": 18 } },
        ],
        "materialBoundaries": [{ "coordinates": [[1.95, 0], [7.05, 0]], "materialName": "" }],
        "regionAssignments": [{ "point": [4, 0.2], "materialName": "fill" }, { "point": [10, -6], "materialName": "clay" }],
        "udls": [{ "magnitude": 15, "x1": 2.4, "x2": 6.6 }],
    }))
    .unwrap();
    let mut s = build_slope(&to_canonical_slope_definition(&d, None).unwrap()).unwrap();
    s.update_analysis_options(&AnalysisOptionsPatch::from(&default_analysis_options()))
        .unwrap();
    s.update_analysis_options(
        &serde_json::from_value(json!({
            "method": "Morgenstern-Price", "slices": 30, "iterations": 600, "refinedIterations": 300,
            "minFailureDist": min_failure_dist, "minSlipArea": 0,
        }))
        .unwrap(),
    )
    .unwrap();
    let f = analyse_slope(&mut s, &mut RunCtx::default())
        .unwrap()
        .unwrap();
    (f, s)
}

#[test]
fn a_thin_slide_in_a_cohesionless_banks_edge_is_named_and_not_once_a_minimum_distance_skips_it() {
    let (thin_f, thin) = bank_run(0.0);
    let w = find(&thin, AnalysisWarningCode::ShallowCohesionlessSurface).unwrap();
    assert!(w.message.contains("shallow slide"), "{}", w.message);
    assert!(
        w.message.contains("cohesionless soil (fill)"),
        "{}",
        w.message
    );
    let (deep_f, deep) = bank_run(2.0);
    assert!(deep_f > thin_f);
    assert!(find(&deep, AnalysisWarningCode::ShallowCohesionlessSurface).is_none());
}

fn shallow_slice(h: f64, c: f64, phi: f64, cu: f64) -> Slice {
    Slice {
        y_top: h,
        y_bottom: 0.0,
        base_length: 1.0,
        cohesion: c,
        cohesion_undrained: cu,
        friction_angle: phi,
        base_material: None,
        ..Default::default()
    }
}

#[test]
fn needs_both_a_shallow_surface_and_most_of_its_base_in_cohesionless_soil() {
    let m = |slices: &[Slice], relief: f64| shallow_cohesionless_message(slices, &[], 0.7, relief);
    let s = |h: f64, c: f64, phi: f64| shallow_slice(h, c, phi, 0.0);
    assert!(m(&[s(0.5, 0.0, 30.0), s(0.6, 0.0, 30.0)], 3.0)
        .unwrap()
        .contains("on average 0.55 m and at most 0.60 m"));
    assert!(m(&[s(1.5, 0.0, 30.0)], 3.0).is_none()); // deeper than 1 m
    assert!(m(&[s(1.5, 0.0, 30.0)], 20.0).unwrap().contains("shallow")); // a tenth of a 20 m relief: 2 m
                                                                         // a long thin surface with one deeper slice: by its mean depth
    let mut long = vec![s(0.3, 0.0, 30.0); 9];
    long.push(s(1.2, 0.0, 30.0));
    assert!(m(&long, 3.0).unwrap().contains("at most 1.20 m"));
    assert!(m(&[s(0.5, 10.0, 0.0), s(0.5, 0.0, 30.0)], 3.0)
        .unwrap()
        .contains("50 %"));
    assert!(m(
        &[s(0.5, 10.0, 0.0), s(0.5, 10.0, 0.0), s(0.5, 0.0, 30.0)],
        3.0
    )
    .is_none());
    // combined clay (c′ = 0 with an undrained strength) is not cohesionless
    assert!(m(
        &[
            shallow_slice(0.5, 0.0, 30.0, 15.0),
            shallow_slice(0.5, 0.0, 30.0, 15.0)
        ],
        3.0
    )
    .is_none());
}
