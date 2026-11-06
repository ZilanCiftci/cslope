//! A summary of an analysis result that says what F is (issue #55): the
//! content of the app's result summary (packages/desktop/src/features/
//! export/analysisSummary.ts, the "Result" and "Partial factors" sections,
//! and utils/result-summary.ts), without its layout, for Python, the
//! command line and agents. The app keeps its own for now.
//!
//! F on characteristic values is a factor of safety; with partial factors
//! the strengths are design values and F is an over-design factor (1.0 or
//! more satisfies the design). The result itself does not say which: the
//! options do.

use crate::model::canonical::SlopeOrientation;
use crate::model::slope::AnalysisOptionsPatch;
use crate::types::analysis::{
    safety_class_gamma_d, AnalysisMethod, AnalysisResult, CustomPlaneKind, IntersliceFunctionType,
    PartialFactors, SlipSurfaceResult, SwedishFactorBasis,
};
use crate::types::json::OrOther;
use serde::Serialize;

/// What F is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, schemars::JsonSchema)]
pub enum FosLabel {
    /// On characteristic values.
    #[serde(rename = "factor of safety")]
    FactorOfSafety,
    /// On design values (partial factors applied).
    #[serde(rename = "over-design factor")]
    OverDesignFactor,
}

/// Which values the strengths and loads of the analysis were.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum ValueBasis {
    Characteristic,
    Design,
}

/// The partial factors of a run on design values.
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct PartialFactorsSummary {
    /// γcu on the undrained shear strength.
    pub cu: f64,
    /// γc′ on the effective cohesion.
    pub cohesion: f64,
    /// γφ′ on tan φ′.
    pub tan_phi: f64,
    /// γQ on the variable loads.
    pub variable_load: f64,
    /// How they were formed in Swedish practice, when they were.
    pub basis: Option<SwedishFactorBasis>,
    /// γd of the basis' safety class.
    pub gamma_d: Option<f64>,
    /// The factors in words, with the basis.
    pub text: String,
}

/// The critical surface: its shape and where it enters and leaves.
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CriticalSurfaceSummary {
    /// "circle", "composite" (a circle along the firm base) or "non-circular".
    pub shape: String,
    /// Centre of the circle (circle, composite) or the moment axis.
    pub center: [f64; 2],
    /// Radius of the circle (0 for a non-circular surface).
    pub radius: f64,
    /// Points of a non-circular surface.
    pub points: Option<usize>,
    /// Where the surface enters the ground (upslope).
    pub entry: [f64; 2],
    /// Where it leaves the ground (downslope).
    pub exit: [f64; 2],
    /// The surface in words, as the app's summary gives it.
    pub text: String,
    /// Entry and exit in words.
    pub entry_exit_text: String,
}

/// Both directions were analysed: the lower F is the result's.
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct BothDirectionsSummary {
    /// The direction of the result's F.
    pub sliding_direction: SlopeOrientation,
    /// F of the other direction (automatic search limits); None: no valid surface.
    pub other_direction_fos: Option<f64>,
    pub text: String,
}

/// A warning of the summary.
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct SummaryWarning {
    pub code: String,
    pub message: String,
}

/// A custom search plane of the run: its F, or why it has none.
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
pub struct CustomSurfaceSummary {
    pub name: String,
    pub fos: Option<f64>,
    pub text: String,
}

/// The summary of a result (see the module comment).
#[derive(Debug, Clone, PartialEq, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResultSummary {
    /// The minimum F; None when no surface gave one.
    pub fos: Option<f64>,
    /// "factor of safety" (characteristic values) or "over-design factor"
    /// (design values).
    pub fos_label: FosLabel,
    /// The label as the app shows it, e.g. "Over-design factor (design values)".
    pub fos_heading: String,
    /// F to three decimals, or "-".
    pub fos_text: String,
    pub value_basis: ValueBasis,
    /// The partial factors, when the values were design values.
    pub partial_factors: Option<PartialFactorsSummary>,
    /// The method as a reader would cite it.
    pub method: String,
    pub method_name: AnalysisMethod,
    pub critical_surface: Option<CriticalSurfaceSummary>,
    /// The direction of sliding, when the result gives it.
    pub sliding_direction: Option<SlopeOrientation>,
    /// Both directions analysed: the other one's F.
    pub both_directions: Option<BothDirectionsSummary>,
    /// Surfaces analysed.
    pub surfaces: usize,
    /// Of them with F below 1.0.
    pub surfaces_below_one: usize,
    /// e.g. "1388 (12 below 1.0)".
    pub surfaces_text: String,
    /// Trial surfaces without a solution (left out of the minimum).
    pub non_converged: usize,
    pub non_converged_text: Option<String>,
    /// Trial surfaces below the minimum slip area or depth (skipped).
    pub discarded_by_size: usize,
    pub custom_surfaces: Vec<CustomSurfaceSummary>,
    /// The warnings of the result, and of the critical surface's equilibrium.
    pub warnings: Vec<SummaryWarning>,
    /// The engine that ran the analysis (version + commit, as given).
    pub engine_build: String,
}

/// `fmt` of analysisSummary.ts: up to four decimals, no trailing zeros.
fn fmt(v: f64) -> String {
    if !v.is_finite() {
        return "-".into();
    }
    if v.abs() < 1e-12 {
        return "0".into();
    }
    let fixed: f64 = crate::js::num::to_fixed(v, 4).parse().unwrap_or(v);
    crate::js::num::to_string(fixed)
}

/// `fmtM`: a computed length or coordinate, to 0.01 m.
fn fmt_m(v: f64) -> String {
    if !v.is_finite() {
        return "-".into();
    }
    let fixed: f64 = crate::js::num::to_fixed(v, 2).parse().unwrap_or(v);
    crate::js::num::to_string(fixed)
}

fn fixed3(v: f64) -> String {
    crate::js::num::to_fixed(v, 3)
}

/// `methodText`: the method as a reader would cite it.
pub fn method_text(
    method: AnalysisMethod,
    janbu_correction: bool,
    interslice: IntersliceFunctionType,
) -> String {
    match method {
        AnalysisMethod::Bishop => "Bishop simplified (moment equilibrium)".into(),
        AnalysisMethod::Janbu if janbu_correction => {
            "Janbu simplified (force equilibrium), with correction factor f0".into()
        }
        AnalysisMethod::Janbu => {
            "Janbu simplified (force equilibrium), without correction factor".into()
        }
        AnalysisMethod::MorgensternPrice => {
            let f = match interslice {
                IntersliceFunctionType::Constant => "constant (Spencer)",
                IntersliceFunctionType::HalfSine => "half-sine",
                IntersliceFunctionType::ClippedSine => "clipped sine",
                IntersliceFunctionType::Trapezoidal => "trapezoidal",
                IntersliceFunctionType::DataPointSpecified => "specified by data points",
            };
            format!("Morgenstern-Price (complete equilibrium), interslice function {f}")
        }
    }
}

fn partial_factors_summary(pf: &PartialFactors) -> PartialFactorsSummary {
    let gamma_d = pf
        .basis
        .as_ref()
        .and_then(|b| safety_class_gamma_d(b.safety_class));
    let mut text = format!(
        "γcu = {} (undrained strength), γc' = {} (effective cohesion), γφ' = {} (on tan φ'), γQ = {} (variable loads)",
        fmt(pf.cu),
        fmt(pf.cohesion),
        fmt(pf.tan_phi),
        fmt(pf.variable_load)
    );
    if let Some(b) = &pf.basis {
        text.push_str(&format!(
            "; basis (Swedish practice): safety class {} (γd = {}), γcu = 1.5/η with η = {}, γc' = γφ' = 1.3/η with η = {}, γQ = {}·γd = {}",
            b.safety_class,
            gamma_d.map(fmt).unwrap_or_else(|| "-".into()),
            fmt(b.eta_cu),
            fmt(b.eta_drained),
            fmt(b.variable_load_base),
            fmt(pf.variable_load)
        ));
    }
    PartialFactorsSummary {
        cu: pf.cu,
        cohesion: pf.cohesion,
        tan_phi: pf.tan_phi,
        variable_load: pf.variable_load,
        basis: pf.basis.clone(),
        gamma_d,
        text,
    }
}

fn surface_summary(cs: &SlipSurfaceResult) -> CriticalSurfaceSummary {
    let (shape, text) = if cs.composite == Some(true) {
        (
            "composite",
            format!(
                "composite circle, center ({}, {}) m, radius {} m, along the firm base where it reaches it",
                fmt_m(cs.cx),
                fmt_m(cs.cy),
                fmt_m(cs.radius)
            ),
        )
    } else if let Some(p) = &cs.points {
        ("non-circular", format!("non-circular, {} points", p.len()))
    } else {
        (
            "circle",
            format!(
                "circle, center ({}, {}) m, radius {} m",
                fmt_m(cs.cx),
                fmt_m(cs.cy),
                fmt_m(cs.radius)
            ),
        )
    };
    CriticalSurfaceSummary {
        shape: shape.into(),
        center: [cs.cx, cs.cy],
        radius: cs.radius,
        points: cs.points.as_ref().map(Vec::len),
        entry: cs.entry_point,
        exit: cs.exit_point,
        text,
        entry_exit_text: format!(
            "({}, {}) / ({}, {}) m",
            fmt_m(cs.entry_point[0]),
            fmt_m(cs.entry_point[1]),
            fmt_m(cs.exit_point[0]),
            fmt_m(cs.exit_point[1])
        ),
    }
}

fn direction_text(d: SlopeOrientation) -> &'static str {
    match d {
        SlopeOrientation::Ltr => "towards +x (right)",
        SlopeOrientation::Rtl => "towards -x (left)",
    }
}

/// The summary of `result`, run with `options` (the options the analysis
/// was given, merged with the defaults it ran with), by `engine_build`.
/// Whether F is on design values comes from the result
/// (`AnalysisResult.partial_factors`); the options only for a result
/// that does not record it.
pub fn summarize_result(
    result: &AnalysisResult,
    options: &AnalysisOptionsPatch,
    engine_build: &str,
) -> ResultSummary {
    // (the result says which factors it applied; a result of an earlier
    // version does not, and the options tell)
    let pf = result
        .partial_factors
        .clone()
        .or_else(|| options.partial_factors.clone().flatten());
    let fos = result.min_fos.is_finite().then_some(result.min_fos);
    let (fos_label, fos_heading, value_basis) = match &pf {
        Some(_) => (
            FosLabel::OverDesignFactor,
            "Over-design factor (design values)",
            ValueBasis::Design,
        ),
        None => (
            FosLabel::FactorOfSafety,
            "Minimum factor of safety",
            ValueBasis::Characteristic,
        ),
    };
    let interslice = match &options.interslice_function {
        Some(OrOther::Known(f)) => *f,
        _ => IntersliceFunctionType::HalfSine,
    };
    let method = method_text(
        result.method,
        options.janbu_correction.unwrap_or(false),
        interslice,
    );

    let mut warnings = Vec::new();
    let cs = result.critical_surface.as_ref();
    if let Some(cs) = cs {
        if cs.closest_pair == Some(true) || cs.equilibrium_gap.is_some() {
            warnings.push(SummaryWarning {
                code: "no-complete-equilibrium".into(),
                message: match cs.equilibrium_gap {
                    Some(gap) => format!(
                        "No complete equilibrium: force equilibrium met within {} (closest λ)",
                        fixed3(gap)
                    ),
                    None => {
                        "No complete equilibrium: moment and force factors never met (closest λ)"
                            .into()
                    }
                },
            });
        } else if cs.converged == Some(false) {
            warnings.push(SummaryWarning {
                code: "critical-not-converged".into(),
                message: "The critical surface did not converge within the iteration limit".into(),
            });
        }
    }
    for w in result.warnings.iter().flatten() {
        let code = serde_json::to_value(w.code)
            .ok()
            .and_then(|v| v.as_str().map(String::from))
            .unwrap_or_default();
        warnings.push(SummaryWarning {
            code,
            message: w.message.clone(),
        });
    }
    if let Some(e) = &result.sgi3d_error {
        warnings.push(SummaryWarning {
            code: "sgi3d-not-computed".into(),
            message: format!("3D effects not computed: {e}"),
        });
    }

    let both_directions = result.sliding_direction.map(|d| BothDirectionsSummary {
        sliding_direction: d,
        other_direction_fos: result.other_direction_min_fos.flatten(),
        text: match result.other_direction_min_fos.flatten() {
            None => "other direction: no valid surface".into(),
            Some(f) => format!(
                "sliding {}; other direction {} (automatic search limits)",
                direction_text(d),
                fixed3(f)
            ),
        },
    });

    let n = result.all_surfaces.len();
    let below = result.all_surfaces.iter().filter(|s| s.fos < 1.0).count();
    let non_converged = result.non_converged_surfaces.unwrap_or(0);
    let custom_surfaces = result
        .custom_surfaces
        .iter()
        .flatten()
        .enumerate()
        .map(|(i, c)| {
            let geometry = match (&c.surface, c.kind) {
                (Some(s), CustomPlaneKind::Circle) => format!(
                    "circle, center ({}, {}) m, radius {} m",
                    fixed2(s.cx),
                    fixed2(s.cy),
                    fixed2(s.radius)
                ),
                (Some(s), _) if s.points.is_some() => format!(
                    "non-circular, {} points",
                    s.points.as_ref().map(Vec::len).unwrap_or(0)
                ),
                (_, CustomPlaneKind::Circle) => "circle".into(),
                _ => "non-circular".into(),
            };
            CustomSurfaceSummary {
                name: format!("Custom surface {}", i + 1),
                fos: c.surface.as_ref().map(|s| s.fos),
                text: match &c.surface {
                    Some(s) => format!("F = {} ({geometry})", fixed3(s.fos)),
                    None => format!(
                        "no solution: {}",
                        c.reason.as_deref().unwrap_or("no factor of safety")
                    ),
                },
            }
        })
        .collect();

    ResultSummary {
        fos,
        fos_label,
        fos_heading: fos_heading.into(),
        fos_text: fos.map(fixed3).unwrap_or_else(|| "-".into()),
        value_basis,
        partial_factors: pf.as_ref().map(partial_factors_summary),
        method,
        method_name: result.method,
        critical_surface: cs.map(surface_summary),
        sliding_direction: result.sliding_direction,
        both_directions,
        surfaces: n,
        surfaces_below_one: below,
        surfaces_text: if below > 0 {
            format!("{n} ({below} below 1.0)")
        } else {
            format!("{n}")
        },
        non_converged,
        non_converged_text: (non_converged > 0).then(|| {
            if non_converged == 1 {
                "1 surface was discarded because it did not reach equilibrium".into()
            } else {
                format!(
                    "{non_converged} surfaces were discarded because they did not reach equilibrium"
                )
            }
        }),
        discarded_by_size: result.discarded_by_size.unwrap_or(0),
        custom_surfaces,
        warnings,
        engine_build: engine_build.into(),
    }
}

fn fixed2(v: f64) -> String {
    crate::js::num::to_fixed(v, 2)
}
