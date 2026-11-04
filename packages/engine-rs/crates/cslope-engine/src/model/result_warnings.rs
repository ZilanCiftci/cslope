//! Port of packages/engine/src/model/result-warnings.ts
//!
//! Warnings on an analysed slope: input the regions do not use as drawn,
//! and conditions on the critical surface under which the factor of safety
//! of a method of slices is open to question.

use crate::error::Result;
use crate::js;
use crate::model::slope::{SearchPlane, Slope};
use crate::model::solvers::{janbu_correction_factor, solved_effective_normals};
use crate::model::surface_slide::{frictional_surface_slide, surface_slide_message};
use crate::types::analysis::{AnalysisMethod, AnalysisWarning, AnalysisWarningCode};
use crate::types::geometry::Slice;
use crate::types::material::Material;
use std::f64::consts::PI;

/// m_α below which a slice is reported. Whitman and Bailey (1967) found
/// that Bishop's method can give unrealistic normal forces, and a factor of
/// safety too high, where m_α = cos α (1 + tan α tan φ / F) on a slice is
/// less than about 0.2; Duncan and Wright (2014, ch. 6) recommend checking
/// m_α and treating such surfaces with caution. The same term is in the
/// normal force of every method here (Janbu, Morgenstern–Price).
pub const M_ALPHA_WARNING_LIMIT: f64 = 0.2;

/// N′ below −NEGATIVE_NORMAL_TOLERANCE × the largest |N′| of the surface
/// counts as negative (a slice with N′ = 0 within rounding is not).
const NEGATIVE_NORMAL_TOLERANCE: f64 = 1e-6;

const BISHOP_NON_CIRCULAR_MESSAGE: &str = "Bishop's simplified method is defined for circular surfaces (Bishop 1955); on a non-circular surface (also the part of a composite circle along a firm base) its factor of safety depends on the moment axis. Use Spencer or Morgenstern-Price for them.";

/// m_α of a slice at the factor of safety F (as the solvers form it).
fn m_alpha(s: &Slice, fos: f64) -> f64 {
    // A combined-method slice in equilibrium with its undrained strength has
    // tan φ = 0 in the equation that was solved.
    let tan_phi = if s.undrained_governs == Some(true) {
        0.0
    } else {
        js::math::tan(s.phi)
    };
    js::math::cos(s.alpha) + (js::math::sin(s.alpha) * tan_phi) / fos
}

/// Entry inclination (degrees) from which a Morgenstern–Price or Spencer
/// surface without complete equilibrium is put down to its steep entry.
pub const STEEP_ENTRY_LIMIT: f64 = 70.0;

/// Inclination of a surface at its entry (degrees, positive descending
/// into the slope): at the crack bottom when cut, on a circle from the
/// centre, on a polyline its first segment.
pub fn entry_inclination(p: &SearchPlane) -> f64 {
    if let Some(points) = p.points.as_ref().filter(|pts| pts.len() >= 2) {
        let [x0, y0] = points[0];
        let [x1, y1] = points[1];
        return (js::math::atan2(y0 - y1, x1 - x0) * 180.0) / PI;
    }
    let x = p.crack.unwrap_or(p.lc)[0];
    (js::math::asin(js::math::max(
        -1.0,
        js::math::min(1.0, (p.cx - x) / p.radius),
    )) * 180.0)
        / PI
}

/// Morgenstern–Price or Spencer found no complete equilibrium (no solution,
/// or only the closest pair) on surfaces whose entry is steeper than
/// STEEP_ENTRY_LIMIT: the cohesion along a nearly vertical base can only
/// hold the slice with tension at its base (a negative normal force), and
/// the moment and force factors then need not meet. A tension crack at a
/// limiting base inclination cuts that part off. None when this does not
/// apply (another method, a crack angle already set, no steep entry).
///
/// `planes` are the surfaces concerned: the critical one when it is a
/// closest pair, or those without a factor when no surface has one.
pub fn steep_entry_message(slope: &Slope, planes: &[&SearchPlane]) -> Option<String> {
    if slope.method() != AnalysisMethod::MorgensternPrice || slope.tension_crack_angle() > 0.0 {
        return None;
    }
    let steep: Vec<f64> = planes
        .iter()
        .map(|p| entry_inclination(p))
        .filter(|&a| a >= STEEP_ENTRY_LIMIT)
        .collect();
    if steep.is_empty() {
        return None;
    }
    let angle = js::num::to_fixed(js::math::max_of(&steep), 0);
    let what = if planes.len() == 1 {
        format!("the surface enters the slope at {angle}°")
    } else {
        format!(
            "{} of the surfaces enter the slope at up to {angle}°",
            steep.len()
        )
    };
    Some(format!(
        "Moment and force equilibrium do not meet where {what}: cohesion along a nearly vertical base can only hold it with tension at the base. A tension crack cutting off the steep part (Options › Crack at base angle, for example 60–70°) usually gives a solution."
    ))
}

/// The critical surface enters steeper than STEEP_ENTRY_LIMIT and slices on
/// its descending (entry) part have N′ < 0 or a low m_α: every method then
/// relies on tension at the base there, and Bishop and Janbu still give a
/// factor (on a φ = 0 slope with a vertical upper face 0.460 with Bishop,
/// against 0.426 with the steep part cut off at 70°; with c′ = 15 kPa and
/// φ′ = 25° 2.211 against 2.227). None when it does not apply.
pub fn steep_entry_tension_message(slope: &Slope, plane: &SearchPlane, n: usize) -> Option<String> {
    if slope.tension_crack_angle() > 0.0 || n == 0 {
        return None;
    }
    let angle = entry_inclination(plane);
    if angle < STEEP_ENTRY_LIMIT {
        return None;
    }
    let slices = if n == 1 {
        "a slice".to_string()
    } else {
        format!("{n} slices")
    };
    Some(format!(
        "The surface enters the slope at {}° and {slices} on its steep part rely on tension at the base (N′ < 0 or a low m_α), which soil cannot take; the factor of safety is then unreliable (higher or lower than with the steep part cut off). A tension crack cutting off the steep part (Options › Crack at base angle, for example 60–70°) removes it.",
        js::num::to_fixed(angle, 0)
    ))
}

fn slices_text(n: usize, verb: [&str; 2]) -> String {
    format!(
        "{n} {} of the critical surface {}",
        if n == 1 { "slice" } else { "slices" },
        if n == 1 { verb[0] } else { verb[1] }
    )
}

/// Warning text for a dangling boundary, numbered from 1 as the user knows it.
pub fn dangling_boundary_message(n: usize) -> String {
    format!(
        "Material boundary {n} ends inside a region and does not split it; check its end points."
    )
}

/// Warnings for an analysed slope (after analyse_slope):
///
/// - "dangling-boundary": a material boundary with an end inside a region
///   (off the outline and every other boundary after snapping) does not
///   split it, so the layer it was meant to bound is not in the model.
/// - "negative-effective-normal": slices of the critical surface with
///   N′ < 0 at the base. Tension at the base is not physical for soil; it
///   usually means a tension crack is missing near the crest (Duncan and
///   Wright 2014, ch. 6 and 14).
/// - "low-m-alpha": slices of the critical surface with m_α below
///   M_ALPHA_WARNING_LIMIT (Whitman and Bailey 1967).
/// - "bishop-non-circular": Bishop's simplified method on a non-circular
///   critical surface (a custom polyline or the non-circular optimisation).
///   Bishop (1955) derived the method for a circle, on which the base
///   normal forces pass through the centre. On a polyline the moment
///   equation is taken about an axis point and the normal forces have
///   moment arms (Fredlund and Krahn 1977); with no interslice shear,
///   horizontal force equilibrium is not satisfied, so the factor depends
///   on the axis. Spencer (1967) and Morgenstern and Price (1965) satisfy
///   both and do not.
/// - "frictional-surface-slide": a face of the ground surface in soil with
///   c′ = 0, dipping in the analysed direction within the search limits,
///   whose infinite-slope factor tan φ′/tan β is below the critical
///   surface's (surface_slide.rs); the search does not reach such thin slides.
/// - "shallow-cohesionless-surface": the critical surface is a shallow
///   slide, its base on average less than shallow_depth_limit (1 m, or a
///   tenth of the ground relief around it when larger) below the ground,
///   with at least half its base in cohesionless soil (c′ = 0, φ′ > 0, no
///   undrained strength of a combined analysis): in a loose fill, a road
///   bank's edge or a thin cohesionless layer the search finds such a slide
///   before any deeper mechanism. Its factor may be the one sought; when the
///   stability of the slope as a whole is, a minimum slip depth, slip
///   area or entry–exit distance (Options › Search) analyses the deeper
///   surfaces. Not with "frictional-surface-slide", which already names the
///   face.
/// - "steep-entry-no-equilibrium": Morgenstern–Price or Spencer found no
///   complete equilibrium on a surface entering steeper than
///   STEEP_ENTRY_LIMIT (steep_entry_message): the critical surface is a
///   closest pair, or no surface has a factor at all.
/// - "steep-entry-tension": the critical surface enters steeper than
///   STEEP_ENTRY_LIMIT and slices on its entry side rely on tension
///   (N′ < 0 or low m_α), with any method (steep_entry_tension_message).
///
/// Only the critical surface is checked (all surfaces when none solved).
/// `effective_normals` are its base N′ when the caller already has them
/// (solved_effective_normals); otherwise they are solved here, on a copy of
/// its slices: TypeScript's solve also rewrites `undrainedGoverns` on the
/// slope's own slices, which m_α below then reads; here the copy's flags
/// are read and the slope is left as it was.
pub fn analysis_warnings(
    slope: &Slope,
    effective_normals: Option<&[f64]>,
) -> Result<Vec<AnalysisWarning>> {
    let mut warnings: Vec<AnalysisWarning> = Vec::new();
    let warn = |code, message: String| AnalysisWarning {
        code,
        message,
        count: None,
        boundary_index: None,
    };
    for &i in slope.dangling_boundaries() {
        warnings.push(AnalysisWarning {
            boundary_index: Some(i),
            ..warn(
                AnalysisWarningCode::DanglingBoundary,
                dangling_boundary_message(i + 1),
            )
        });
    }

    let crit = slope.search().iter().find(|p| p.fos.is_some());
    if let Some(crit) = crit {
        if slope.method() == AnalysisMethod::Bishop
            && (crit.points.is_some() || crit.composite.is_some())
        {
            warnings.push(warn(
                AnalysisWarningCode::BishopNonCircular,
                BISHOP_NON_CIRCULAR_MESSAGE.to_string(),
            ));
        }
    }
    let slide = match crit {
        Some(_) => frictional_surface_slide(slope, true)?,
        None => None,
    };
    let surface_slide = match (&slide, crit.and_then(|c| c.fos)) {
        (Some(s), Some(f)) => s.factor_of_safety < f,
        _ => false,
    };
    if surface_slide {
        let (s, f) = (
            slide.as_ref().expect("checked"),
            crit.and_then(|c| c.fos).expect("checked"),
        );
        warnings.push(warn(
            AnalysisWarningCode::FrictionalSurfaceSlide,
            surface_slide_message(s, f),
        ));
    }
    if let Some(crit) = crit {
        if let (Some(fos), false, Some(slices)) = (crit.fos, surface_slide, crit.slices.as_deref())
        {
            if !slices.is_empty() {
                if let Some(shallow) = shallow_cohesionless_message(
                    slices,
                    slope.materials(),
                    fos,
                    local_relief(slope, slices),
                ) {
                    warnings.push(warn(
                        AnalysisWarningCode::ShallowCohesionlessSurface,
                        shallow,
                    ));
                }
            }
        }
    }
    let steep_entry = match crit {
        Some(crit) => {
            if crit.closest_pair == Some(true) {
                steep_entry_message(slope, &[crit])
            } else {
                None
            }
        }
        None => {
            let planes: Vec<&SearchPlane> = slope
                .search()
                .iter()
                .filter(|p| {
                    p.fos.is_none() && p.converged == Some(false) && p.below_min_size != Some(true)
                })
                .collect();
            steep_entry_message(slope, &planes)
        }
    };
    if let Some(m) = &steep_entry {
        warnings.push(warn(
            AnalysisWarningCode::SteepEntryNoEquilibrium,
            m.clone(),
        ));
    }
    let Some(crit) = crit else {
        return Ok(warnings);
    };
    let Some(crit_slices) = crit.slices.as_deref().filter(|s| !s.is_empty()) else {
        return Ok(warnings);
    };
    let fos = crit.fos.expect("the critical plane has a factor");

    // (solved on a copy: see the documentation above)
    let mut solved_copy: Option<Vec<Slice>> = None;
    let normals: Option<Vec<f64>> = match effective_normals {
        Some(n) => Some(n.to_vec()),
        None => {
            let mut copy = crit_slices.to_vec();
            let n = solved_effective_normals(slope, &mut copy, fos, crit.lff_array.as_deref());
            solved_copy = Some(copy);
            n
        }
    };
    let slices: &[Slice] = solved_copy.as_deref().unwrap_or(crit_slices);
    // Slices on the entry side (base descending into the slope) that rely
    // on tension at the base: N′ < 0 or a low m_α.
    let mut entry_tension = vec![false; slices.len().max(normals.as_ref().map_or(0, |n| n.len()))];
    if let Some(normals) = normals.as_ref().filter(|n| !n.is_empty()) {
        let scale = js::math::max_of(&normals.iter().map(|n| n.abs()).collect::<Vec<f64>>());
        let negative = normals
            .iter()
            .filter(|&&n| n < -NEGATIVE_NORMAL_TOLERANCE * scale)
            .count();
        for (i, &n) in normals.iter().enumerate() {
            if n < -NEGATIVE_NORMAL_TOLERANCE * scale
                && slices.get(i).is_some_and(|s| s.alpha > 0.0)
            {
                entry_tension[i] = true;
            }
        }
        if negative > 0 {
            warnings.push(AnalysisWarning {
                count: Some(negative),
                ..warn(
                    AnalysisWarningCode::NegativeEffectiveNormal,
                    format!(
                        "{} negative effective normal force (N′ < 0) at the base.",
                        slices_text(negative, ["has", "have"])
                    ),
                )
            });
        }
    }

    // The factor the slices were solved at: Janbu's corrected factor is
    // f₀ times the one in the equations.
    let solved_fos = if slope.method() == AnalysisMethod::Janbu && slope.janbu_correction() {
        fos / janbu_correction_factor(slices)
    } else {
        fos
    };
    let low_m_alpha = slices
        .iter()
        .filter(|s| m_alpha(s, solved_fos) < M_ALPHA_WARNING_LIMIT)
        .count();
    for (i, s) in slices.iter().enumerate() {
        if s.alpha > 0.0 && m_alpha(s, solved_fos) < M_ALPHA_WARNING_LIMIT {
            entry_tension[i] = true;
        }
    }
    if low_m_alpha > 0 {
        warnings.push(AnalysisWarning {
            count: Some(low_m_alpha),
            ..warn(
                AnalysisWarningCode::LowMAlpha,
                format!(
                    "{} m_α below {} (steep base); the factor of safety may be unreliable.",
                    slices_text(low_m_alpha, ["has", "have"]),
                    js::num::to_string(M_ALPHA_WARNING_LIMIT)
                ),
            )
        });
    }
    // Not with the Morgenstern–Price warning, which already names the entry.
    let entry_count = entry_tension.iter().filter(|&&t| t).count();
    let tension = if steep_entry.is_some() {
        None
    } else {
        steep_entry_tension_message(slope, crit, entry_count)
    };
    if let Some(t) = tension {
        warnings.push(AnalysisWarning {
            count: Some(entry_count),
            ..warn(AnalysisWarningCode::SteepEntryTension, t)
        });
    }
    Ok(warnings)
}

/// The depth a critical surface's base must on average stay within to count
/// as shallow (m): 1 m, or a tenth of the ground relief around the surface
/// when larger.
pub fn shallow_depth_limit(local_relief: f64) -> f64 {
    js::math::max(1.0, 0.1 * local_relief)
}

/// The ground relief around a surface: the range of the ground's height
/// over the surface's span and as far again on each side.
fn local_relief(slope: &Slope, slices: &[Slice]) -> f64 {
    let Some(g) = slope.surface_line_xy() else {
        return 0.0;
    };
    if slices.is_empty() {
        return 0.0;
    }
    let a = slices[0].x_left;
    let b = slices[slices.len() - 1].x_right;
    let w = b - a;
    let mut lo = f64::INFINITY;
    let mut hi = f64::NEG_INFINITY;
    for i in 0..g.x.len() {
        if g.x[i] < a - w || g.x[i] > b + w {
            continue;
        }
        lo = js::math::min(lo, g.y[i]);
        hi = js::math::max(hi, g.y[i]);
    }
    for s in slices {
        lo = js::math::min(lo, s.y_top);
        hi = js::math::max(hi, s.y_top);
    }
    if hi > lo {
        hi - lo
    } else {
        0.0
    }
}

/// A slice base in cohesionless soil: c′ = 0 with friction, and no undrained
/// strength of a combined analysis.
fn cohesionless(s: &Slice) -> bool {
    s.cohesion <= 0.0 && s.friction_angle > 0.0 && !(s.cohesion_undrained > 0.0)
}

/// The warning text when the critical surface, of these slices, is a
/// shallow slide mostly in cohesionless soil (see analysis_warnings), else
/// None. Its depth is the base's mean depth below the ground, weighted by
/// base length, so that a long thin surface counts with a deeper part.
/// (`materials`: the slope's table, for the base material's name.)
pub fn shallow_cohesionless_message(
    slices: &[Slice],
    materials: &[Material],
    fos: f64,
    relief: f64,
) -> Option<String> {
    let mut base = 0.0;
    let mut loose = 0.0;
    let mut mean = 0.0;
    let mut deepest = 0.0;
    let mut name: Option<&str> = None;
    for s in slices {
        let d = s.y_top - s.y_bottom;
        base += s.base_length;
        mean += d * s.base_length;
        deepest = js::math::max(deepest, d);
        if cohesionless(s) {
            loose += s.base_length;
            if name.is_none() {
                name = s
                    .base_material
                    .map(|id| materials[id.0 as usize].name.as_str());
            }
        }
    }
    if !(base > 0.0) {
        return None;
    }
    mean /= base;
    if mean >= shallow_depth_limit(relief) || loose < 0.5 * base {
        return None;
    }
    Some(format!(
        "The critical surface (F = {}) is a shallow slide, on average {} m and at most {} m below the ground, with {} % of its base in cohesionless soil{}. If the stability of the slope as a whole is sought, set a minimum slip depth, slip area or entry–exit distance (Options › Search) to analyse the deeper surfaces.",
        js::num::to_fixed(fos, 3),
        js::num::to_fixed(mean, 2),
        js::num::to_fixed(deepest, 2),
        js::num::to_string(js::math::round((100.0 * loose) / base)),
        match name {
            Some(n) => format!(" ({n})"),
            None => String::new(),
        }
    ))
}
