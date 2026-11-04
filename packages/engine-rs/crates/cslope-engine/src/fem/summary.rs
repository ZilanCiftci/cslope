//! Port of packages/engine/src/fem/summary.ts.
//!
//! The finite element analysis as the app runs it: from a slope definition
//! and the analysis settings to a summary in model coordinates, as plain
//! arrays that pass through a worker message and a project file.
//!
//! Rust notes: the bounds' solver (Clarabel) is linked in, so TypeScript's
//! `solvers` loader and its "could not be loaded" warning have no
//! counterpart; `onTrial` is the run's progress; time is the run's clock.

use crate::api::ctx::RunCtx;
use crate::error::{ErrorKind, Result};
use crate::fem::analysis::{analyze_fem, FemAdaptiveOptions, FemAnalysisOptions};
use crate::fem::bound_adapt::{adaptive_bounds, AdaptiveBoundsOptions};
use crate::fem::initial_stress::InitialStressOptions;
use crate::fem::limit_common::StrengthRule;
use crate::fem::lower_bound::LowerBoundOptions;
use crate::fem::model::{FeMaterialParameters, FeModelOptions, PorePressureSource, SizeField};
use crate::fem::srm::{SrmConvergence, SrmOptions, SrmTrial, TrialSolver};
use crate::js;
use crate::model::build_slope::build_slope;
use crate::model::canonical::{
    get_domain_x, resolve_orientation, to_canonical_slope_definition, SlopeOrientation,
};
use crate::model::slope::Slope;
use crate::types::{
    FemAnalysisSettings, FemBounds, FemConvergence, FemCurvePoint, FemDavisBounds, FemLevel,
    FemPileForces, FemPorePressure, FemResultSummary, FlowRule, InitialStress, NonAssociatedSolver,
    SlopeDefinition,
};
use std::collections::BTreeMap;
use std::sync::Arc;

/// Coordinates and displacements are rounded to this many significant digits for the summary.
const DIGITS: usize = 7;
fn round(v: f64) -> f64 {
    js::num::round_to_precision(v, DIGITS)
}

/// Coarsening of the bounds' mesh against the strength reduction's final mesh (implementation choice: about 600 elements on V055).
const BOUND_COARSENING: f64 = 2.0;
/// Time limit per program of the bounds in the app (s).
const BOUND_TIME_LIMIT: f64 = 120.0;
/// Time limit of each bound's search in the app (s).
const BOUND_SEARCH_TIME_LIMIT: f64 = 480.0;
/// Time budget of the bounds with their refinement on the bound gap in the app (s), within the app's 30 minutes for the bounds.
const BOUND_REFINEMENT_TIME_LIMIT: f64 = 1200.0;
/// Time budget of the Davis B bounds in the app (s): with the associated ones within the app's 30 minutes.
const DAVIS_REFINEMENT_TIME_LIMIT: f64 = 300.0;

/// The finite element analysis of a definition as the app runs it (`runFemSummary`).
pub fn run_fem_summary(
    definition: &SlopeDefinition,
    settings: &FemAnalysisSettings,
    ctx: &mut RunCtx,
) -> Result<FemResultSummary> {
    Ok(fem_analysis(definition, settings, ctx)?.0)
}

/// The finite element analysis and, when the settings ask for them
/// (`limit_analysis`), the lower and upper bounds of limit analysis, starting
/// on a mesh graded as the strength reduction's final mesh, BOUND_COARSENING
/// times coarser (the programs grow fast with the elements), and refined
/// where the gap between the bounds lies (bound_adapt.rs) within
/// BOUND_REFINEMENT_TIME_LIMIT; the upper bound's search starts at the
/// strength reduction factor. A failure of the bounds leaves the strength
/// reduction's result, with the reason in the bounds' warnings.
pub fn run_fem_summary_with_bounds(
    definition: &SlopeDefinition,
    settings: &FemAnalysisSettings,
    ctx: &mut RunCtx,
) -> Result<FemResultSummary> {
    let (summary, slope, size_field) = fem_analysis(definition, settings, ctx)?;
    if settings.limit_analysis != Some(true) {
        return Ok(summary);
    }
    let t0 = ctx.clock.now_ms();
    let sf = Arc::new(SizeField::Scaled {
        inner: size_field,
        factor: BOUND_COARSENING,
    });
    let common = LowerBoundOptions {
        model: FeModelOptions {
            size_field: Some(sf),
            pore_pressure: Some(pore_pressure(settings)),
            ..Default::default()
        },
        tension_cutoff: Some(settings.tension_cutoff),
        f_tolerance: Some(0.005),
        time_limit: Some(BOUND_TIME_LIMIT),
        total_time_limit: Some(BOUND_SEARCH_TIME_LIMIT),
        ..Default::default()
    };
    let mut warnings: Vec<String> = Vec::new();
    let mut bounds = FemBounds {
        lower: None,
        upper: None,
        elements: 0,
        refinements: Some(0),
        elapsed_ms: 0.0,
        warnings: Vec::new(),
        davis: None,
    };
    let mut assoc_options = common.clone();
    assoc_options.start_f = Some(if summary.factor_of_safety > 0.0 {
        summary.factor_of_safety
    } else {
        1.0
    });
    let assoc = AdaptiveBoundsOptions {
        bounds: assoc_options,
        refinement_time_limit: Some(BOUND_REFINEMENT_TIME_LIMIT),
        ..Default::default()
    };
    match adaptive_bounds(&slope, &assoc, ctx) {
        Err(e) if e.kind == ErrorKind::Cancelled => return Err(e),
        Err(e) => warnings.push(format!("Limit analysis: {}", e.message)),
        Ok(r) => {
            warnings.extend(r.warnings);
            if r.upper.is_finite() {
                bounds.upper = Some(r.upper);
            }
            if r.lower.is_finite() {
                bounds.lower = Some(r.lower);
            }
            bounds.elements = r.levels.last().map_or(0, |l| l.elements);
            bounds.refinements = Some(r.levels.len().saturating_sub(1));
        }
    }
    // The same with Davis B's reduced strength for the dilation angle (below
    // the associated bounds), started below the associated lower bound; with
    // associated flow they are the associated bounds. Each bound's search gets
    // half the time, so the lower bound is not left without.
    if settings.flow_rule != FlowRule::Associated {
        let assoc_f = bounds
            .lower
            .or(bounds.upper)
            .unwrap_or(if summary.factor_of_safety > 0.0 {
                summary.factor_of_safety
            } else {
                1.0
            });
        let mut o = common.clone();
        o.model.material_parameters = Some(BTreeMap::from([(
            "*".to_string(),
            FeMaterialParameters {
                dilation_angle: Some(settings.dilation_angle),
                ..Default::default()
            },
        )]));
        o.strength_rule = Some(StrengthRule::DavisB);
        o.start_f = Some(0.8 * assoc_f);
        o.total_time_limit = Some(DAVIS_REFINEMENT_TIME_LIMIT / 2.0);
        let davis = AdaptiveBoundsOptions {
            bounds: o,
            refinement_time_limit: Some(DAVIS_REFINEMENT_TIME_LIMIT),
            ..Default::default()
        };
        match adaptive_bounds(&slope, &davis, ctx) {
            Err(e) if e.kind == ErrorKind::Cancelled => return Err(e),
            Err(e) => warnings.push(format!("Limit analysis, Davis B: {}", e.message)),
            Ok(d) => {
                warnings.extend(d.warnings.iter().map(|w| format!("Davis B: {w}")));
                bounds.davis = Some(FemDavisBounds {
                    lower: if d.lower.is_finite() {
                        Some(d.lower)
                    } else {
                        None
                    },
                    upper: if d.upper.is_finite() {
                        Some(d.upper)
                    } else {
                        None
                    },
                });
            }
        }
    }
    bounds.warnings = warnings;
    bounds.elapsed_ms = ctx.clock.now_ms() - t0;
    Ok(FemResultSummary {
        bounds: Some(bounds),
        ..summary
    })
}

fn pore_pressure(settings: &FemAnalysisSettings) -> PorePressureSource {
    match settings.pore_pressure {
        Some(FemPorePressure::Seepage) => PorePressureSource::Seepage,
        _ => PorePressureSource::WaterTable,
    }
}

/// The analysis options of the settings (`femAnalysis`).
pub fn fem_analysis_options(settings: &FemAnalysisSettings) -> FemAnalysisOptions {
    FemAnalysisOptions {
        model: FeModelOptions {
            material_parameters: Some(BTreeMap::from([(
                "*".to_string(),
                FeMaterialParameters {
                    youngs_modulus: Some(settings.youngs_modulus),
                    poissons_ratio: Some(settings.poissons_ratio),
                    dilation_angle: Some(settings.dilation_angle),
                    ..Default::default()
                },
            )])),
            element_size: settings.element_size,
            pore_pressure: Some(pore_pressure(settings)),
            ..Default::default()
        },
        srm: SrmOptions {
            flow_rule: Some(settings.flow_rule),
            tension_cutoff: Some(settings.tension_cutoff),
            solver: if settings.flow_rule == FlowRule::NonAssociated
                && settings.non_associated_solver == Some(NonAssociatedSolver::Newton)
            {
                Some(TrialSolver::Newton)
            } else {
                None
            },
            convergence: if settings.convergence == Some(FemConvergence::Equilibrium) {
                Some(SrmConvergence::Equilibrium)
            } else {
                None
            },
            ..Default::default()
        },
        initial: InitialStressOptions {
            initial_stress: if settings.initial_stress == Some(InitialStress::K0) {
                Some(InitialStress::K0)
            } else {
                None
            },
            k0: settings.k0.flatten(),
            original_ground_level: settings.original_ground_level.flatten(),
            material_stages: settings.material_stages.clone(),
        },
        adaptive: if settings.refinement_levels > 0.0
            && settings.flow_rule != FlowRule::NonAssociated
        {
            Some(FemAdaptiveOptions {
                levels: Some(js::math::min(
                    3.0,
                    js::math::round(settings.refinement_levels),
                )),
                tolerance: Some(0.01),
                ..Default::default()
            })
        } else {
            None
        },
    }
}

/// The analysis on the canonical slope, its summary in model coordinates,
/// the slope and the final mesh's size field.
fn fem_analysis(
    definition: &SlopeDefinition,
    settings: &FemAnalysisSettings,
    ctx: &mut RunCtx,
) -> Result<(FemResultSummary, Slope, Arc<SizeField>)> {
    let t0 = ctx.clock.now_ms();
    let slope = build_slope(&to_canonical_slope_definition(definition, None)?)?;
    let r = analyze_fem(&slope, &fem_analysis_options(settings), ctx)?;
    // The analysis runs on the slope as it slides to the right; mirror back.
    let rtl = resolve_orientation(definition.orientation, &definition.coordinates)
        == SlopeOrientation::Rtl;
    let [x_min, x_max] = get_domain_x(&definition.coordinates);
    let x: Vec<f64> = r
        .mesh
        .x
        .iter()
        .map(|&v| round(if rtl { x_min + x_max - v } else { v }))
        .collect();
    let y: Vec<f64> = r.mesh.y.iter().map(|&v| round(v)).collect();
    let displacement: Vec<f64> = r
        .displacement
        .iter()
        .enumerate()
        .map(|(i, &v)| round(if rtl && i % 2 == 0 { -v } else { v }))
        .collect();
    let mut triangles = r.mesh.triangles.clone();
    if rtl {
        // keep the elements counter-clockwise after mirroring
        let mut e = 0;
        while e < triangles.len() {
            triangles.swap(e + 1, e + 2);
            e += 3;
        }
    }
    let summary = FemResultSummary {
        factor_of_safety: r.factor_of_safety,
        failed_f: r.failed_f,
        flow_rule: settings.flow_rule,
        levels: r
            .levels
            .iter()
            .map(|l| FemLevel {
                elements: l.elements,
                fos: l.factor_of_safety,
            })
            .collect(),
        warnings: r.warnings.clone(),
        elapsed_ms: ctx.clock.now_ms() - t0,
        x,
        y,
        triangles,
        plastic_shear: r.plastic_shear_strain.iter().map(|&v| round(v)).collect(),
        shear_increment: Some(r.shear_strain_increment.iter().map(|&v| round(v)).collect()),
        displacement,
        curve: Some(force_displacement_curve(&r.trials)),
        piles: if r.piles.is_empty() {
            None
        } else {
            Some(
                r.piles
                    .iter()
                    .map(|p| FemPileForces {
                        pile: p.pile,
                        max_axial_force: round(p.max_axial_force),
                        max_shear_force: round(p.max_shear_force),
                        max_moment: round(p.max_moment),
                    })
                    .collect(),
            )
        },
        bounds: None,
    };
    Ok((summary, slope, r.size_field))
}

/// Largest displacement of the converged trials by increasing F, one point
/// per F (its first trial). Displacements depend on the load path, so only
/// trials that rose from a converged state are taken, as in the
/// displacement-jump test of srm.rs.
fn force_displacement_curve(trials: &[SrmTrial]) -> Vec<FemCurvePoint> {
    let mut sorted: Vec<SrmTrial> = trials
        .iter()
        .filter(|t| t.converged && t.start_f > 0.0)
        .copied()
        .collect();
    js::array::sort_by(&mut sorted, |a, b| a.f - b.f);
    sorted
        .iter()
        .enumerate()
        .filter(|(k, t)| *k == 0 || t.f > sorted[k - 1].f)
        .map(|(_, t)| FemCurvePoint {
            f: round(t.f),
            displacement: round(t.max_displacement),
        })
        .collect()
}
