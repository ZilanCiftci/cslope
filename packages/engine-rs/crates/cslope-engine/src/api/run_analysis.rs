//! Port of packages/engine/src/api/run-analysis.ts
//!
//! The product path of a limit equilibrium analysis: a definition and the
//! analysis options in, the `AnalysisResult` the app shows out.
//!
//! - `run_analysis` builds the slope, runs the search and assembles the
//!   result: the critical surface and its slices, every valid surface, the
//!   critical moments, the counts and warnings, and the 3D factor after
//!   SGI's guidance on request; with `bothDirections` the opposite sliding
//!   direction too, reporting the lower factor. The result is in model
//!   coordinates (the definition is the canonical one).
//!
//! The searches' surfaces are evaluated by the context's evaluator and
//! progress is reported as the searches report it (TypeScript's
//! `runAnalysisAsync` with a pool of evaluators gives the same result as
//! `runAnalysis`; here the evaluator plays the pool's part). `elapsedMs` is
//! read from the context's clock. Finite elements are not part of it.

use crate::api::ctx::RunCtx;
use crate::error::{ErrorKind, Result};
use crate::js;
use crate::model::build_slope::build_slope;
use crate::model::canonical::{
    map_analysis_result_to_model_space, opposite_direction_definition, resolve_orientation,
    SlopeOrientation,
};
use crate::model::result_warnings::{analysis_warnings, steep_entry_message};
use crate::model::sgi3d::sgi3d_factor_of_safety;
use crate::model::slope::{AnalysisOptionsPatch, SearchPlane, Slope};
use crate::model::solvers::{
    analyse_slope, slice_driving_moment, slice_vertical_load, solved_effective_normals,
};
use crate::types::analysis::{
    AnalysisResult, Crack, CustomPlaneRef, CustomSurfaceResult, SliceData, SlipSurfaceResult,
    SurfaceRejection,
};
use crate::types::geometry::Slice;
use crate::types::sgi3d::Sgi3dOptions;
use crate::types::SlopeDefinition;

fn compute_critical_pushing_moment(slices: Option<&[Slice]>) -> Option<f64> {
    let slices = slices.filter(|s| !s.is_empty())?;
    let mut pushing = 0.0;
    for s in slices {
        pushing += slice_driving_moment(s);
        // Active reinforcement is on the driving side (passive is part of the
        // resistance, which is reported as pushing × FOS).
        if let Some(a) = s.reinforcement_active {
            pushing += a[0] * s.dx + a[2];
        }
    }
    if pushing.is_finite() && pushing > 0.0 {
        Some(pushing)
    } else {
        None
    }
}

fn compute_critical_slip_volume(slices: Option<&[Slice]>) -> Option<f64> {
    let slices = slices.filter(|s| !s.is_empty())?;
    let mut volume = 0.0;
    for s in slices {
        volume += s.area;
    }
    if volume.is_finite() && volume > 0.0 {
        Some(volume)
    } else {
        None
    }
}

/// The slope of a definition with the analysis options, as an analysis builds it.
fn analysis_slope(def: &SlopeDefinition, options: &AnalysisOptionsPatch) -> Result<Slope> {
    let mut slope = build_slope(def)?;
    slope.update_analysis_options(options)?;
    Ok(slope)
}

/// Analysis of a canonical definition with the options, the result in
/// model coordinates (both directions when `options.bothDirections`, unless
/// only custom surfaces are analysed). `elapsedMs` is the time of the whole
/// run by the context's clock.
pub fn run_analysis(
    def: &SlopeDefinition,
    options: &AnalysisOptionsPatch,
    ctx: &mut RunCtx,
) -> Result<AnalysisResult> {
    let start = ctx.clock.now_ms();
    let both = options.both_directions == Some(true) && def.custom_planes_only != Some(true);
    let mut result = if both {
        analyse_both_directions(def, options, ctx)?
    } else {
        map_analysis_result_to_model_space(&analyse(def, options, ctx)?, def)
    };
    result.elapsed_ms = ctx.clock.now_ms() - start;
    Ok(result)
}

/// Analyse the model's own direction and the opposite one and report the
/// lower FOS, with the direction it slides in.
fn analyse_both_directions(
    def: &SlopeDefinition,
    options: &AnalysisOptionsPatch,
    ctx: &mut RunCtx,
) -> Result<AnalysisResult> {
    let opposite_def = opposite_direction_definition(def)?;
    // A failure in the model's own direction (its limits, its geometry) is
    // the user's error to see; only the opposite run may come up empty.
    let own_result = map_analysis_result_to_model_space(&analyse(def, options, ctx)?, def);
    let opposite = match analyse(&opposite_def, options, ctx) {
        Ok(r) => Some(map_analysis_result_to_model_space(&r, &opposite_def)),
        // (a cancelled run is not an empty direction)
        Err(e) if e.kind == ErrorKind::Cancelled => return Err(e),
        Err(_) => None,
    };
    Ok(governing_direction(def, own_result, opposite))
}

/// The lower FOS of the two directions, with the direction it slides in.
fn governing_direction(
    def: &SlopeDefinition,
    own_result: AnalysisResult,
    opposite: Option<AnalysisResult>,
) -> AnalysisResult {
    let own = resolve_orientation(def.orientation, &def.coordinates);
    let own_governs = match &opposite {
        None => true,
        Some(o) => own_result.min_fos <= o.min_fos,
    };
    // The custom search planes are analysed in the model's own direction
    // (the opposite definition has none): their results stay.
    let custom_surfaces = own_result.custom_surfaces.clone();
    let (governing, other) = if own_governs {
        (own_result, opposite)
    } else {
        (opposite.expect("the opposite governs"), Some(own_result))
    };
    AnalysisResult {
        sliding_direction: Some(if own_governs {
            own
        } else if own == SlopeOrientation::Ltr {
            SlopeOrientation::Rtl
        } else {
            SlopeOrientation::Ltr
        }),
        other_direction_min_fos: Some(other.map(|o| o.min_fos)),
        custom_surfaces,
        ..governing
    }
}

/// Points of a non-circular surface as drawn: from the crack bottom (when
/// cracked) to the exit.
pub fn display_points(p: &SearchPlane) -> Option<Vec<[f64; 2]>> {
    // a composite circle as analysed (from its crack, along the floor)
    if let Some(c) = &p.composite {
        return Some(c.clone());
    }
    let points = p.points.as_ref()?;
    let Some(crack) = p.crack else {
        return Some(points.clone());
    };
    let mut out = vec![crack];
    out.extend(points.iter().filter(|q| q[0] > crack[0] + 1e-9).copied());
    Some(out)
}

/// One analysis of a canonical definition (result in canonical space).
fn analyse(
    def: &SlopeDefinition,
    options: &AnalysisOptionsPatch,
    ctx: &mut RunCtx,
) -> Result<AnalysisResult> {
    let start = ctx.clock.now_ms();
    let mut slope = analysis_slope(def, options)?;
    let min_fos = analyse_slope(&mut slope, ctx)?;
    let elapsed = ctx.clock.now_ms() - start;
    analysis_result(&mut slope, min_fos, options, elapsed)
}

/// A surface of the result (the fields every surface has).
fn surface_result(p: &SearchPlane) -> SlipSurfaceResult {
    SlipSurfaceResult {
        cx: p.cx,
        cy: p.cy,
        radius: p.radius,
        fos: p.fos.unwrap_or(f64::NAN),
        entry_point: p.crack.unwrap_or(p.lc),
        exit_point: p.rc,
        converged: p.converged,
        closest_pair: p.closest_pair,
        lff_array: p.lff_array.clone(),
        equilibrium_gap: p.equilibrium_gap,
        points: display_points(p),
        composite: p.composite.as_ref().map(|_| true),
        reinforcement_forces: None,
        crack: None,
        custom_plane: p.custom_plane,
    }
}

/// The result of each custom search plane of the definition, in its order
/// (circles, then polylines): the planes analysed (marked by build_slope),
/// with their surface or why the evaluation left them without a factor, and
/// those that gave no surface to analyse. None without custom planes.
pub fn custom_surface_results(slope: &Slope) -> Option<Vec<CustomSurfaceResult>> {
    let mut entries: Vec<(CustomPlaneRef, CustomSurfaceResult)> = Vec::new();
    for p in slope.search() {
        let Some(custom) = p.custom_plane else {
            continue;
        };
        let (surface, reason) = if p.fos.is_some() {
            (Some(surface_result(p)), None)
        } else {
            let why = p.rejection.unwrap_or(SurfaceRejection::NotConverged);
            (None, Some(why.message().to_string()))
        };
        // The plane's own custom plane, then any identical ones given again
        // (each with the same surface, marked as itself).
        for alias in std::iter::once(custom).chain(p.custom_aliases.iter().copied()) {
            entries.push((
                alias,
                CustomSurfaceResult {
                    kind: alias.kind,
                    index: alias.index,
                    surface: surface.clone().map(|s| SlipSurfaceResult {
                        custom_plane: Some(alias),
                        ..s
                    }),
                    reason: reason.clone(),
                },
            ));
        }
    }
    for &(custom, why) in slope.custom_plane_rejections() {
        entries.push((
            custom,
            CustomSurfaceResult {
                kind: custom.kind,
                index: custom.index,
                surface: None,
                reason: Some(why.message().to_string()),
            },
        ));
    }
    if entries.is_empty() {
        return None;
    }
    entries.sort_by_key(|e| e.0);
    Some(entries.into_iter().map(|(_, e)| e).collect())
}

/// `custom_surface_results` as a sentence for an error message: the custom
/// surfaces without a factor and why. Empty without any.
fn custom_surfaces_message(slope: &Slope) -> String {
    let Some(customs) = custom_surface_results(slope) else {
        return String::new();
    };
    customs
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            c.reason
                .as_ref()
                .map(|why| format!(" Custom surface {}: {}.", i + 1, why))
        })
        .collect()
}

/// The result of an analysed slope (canonical space). The slope is changed
/// only as TypeScript changes it: the flags of the critical slices that the
/// solve of their normal forces writes. `elapsed_ms`: the analysis's time.
pub fn analysis_result(
    slope: &mut Slope,
    min_fos: Option<f64>,
    options: &AnalysisOptionsPatch,
    elapsed_ms: f64,
) -> Result<AnalysisResult> {
    let Some(ci) = slope.search().iter().position(|s| s.fos.is_some()) else {
        // Reporting FOS 0.000 here would read as a collapsed slope.
        let candidates: Vec<&SearchPlane> = slope
            .search()
            .iter()
            .filter(|p| {
                p.fos.is_none() && p.converged == Some(false) && p.below_min_size != Some(true)
            })
            .collect();
        let steep = steep_entry_message(slope, &candidates);
        return Err(crate::error::EngineError::new(format!(
            "No valid slip surface was found. {}{}",
            steep.unwrap_or_else(|| {
                "Check the search limits, the geometry and the material strengths.".to_string()
            }),
            custom_surfaces_message(slope)
        )));
    };

    let crit = &slope.search()[ci];
    let crit_fos = crit.fos.expect("a valid surface");
    let mut critical_surface = SlipSurfaceResult {
        reinforcement_forces: crit.slices.as_ref().map(|slices| {
            slices
                .iter()
                .flat_map(|s| s.reinforcement_forces.iter().flatten().cloned())
                .collect()
        }),
        // The crack the slices start at: its face runs from the ground at
        // the first slice's left side down to the surface.
        crack: match (crit.crack, crit.slices.as_ref().and_then(|s| s.first())) {
            (Some(c), Some(first)) => Some(Crack {
                x: c[0],
                top: first.y0_top,
                bottom: c[1],
            }),
            _ => None,
        },
        ..surface_result(crit)
    };
    critical_surface.fos = crit_fos;
    let crit_lff = crit.lff_array.clone();

    // Convert slices for critical surface
    let mut critical_slices: Vec<SliceData> = Vec::new();
    let mut solved_normals: Option<Vec<f64>> = None;
    if slope.search()[ci].slices.is_some() {
        // The method's own base normal forces at the critical FOS (the
        // ordinary-method estimate (W + Q)·cos α − u·l did not add up to the
        // FOS of Bishop, Janbu or Morgenstern–Price). The solve writes the
        // slices' flags, on the slope's own slices as in TypeScript.
        let mut slices = slope.search_mut()[ci].slices.take().expect("checked");
        solved_normals =
            solved_effective_normals(slope, &mut slices, crit_fos, crit_lff.as_deref());
        for (i, s) in slices.iter().enumerate() {
            let surface_load = slice_vertical_load(s) - s.weight;
            let base_material = slope
                .material(s.base_material.expect("a slice's base material"))
                .clone();
            let normal_force = match &solved_normals {
                Some(n) => n[i],
                None => (s.weight + surface_load) * js::math::cos(s.alpha) - s.u * s.base_length,
            };
            // As the app's slice table and plots show it (SliceData.shear_force).
            let shear_force = s.cohesion * s.base_length
                + js::math::max(normal_force, 0.0)
                    * js::math::tan(s.friction_angle * std::f64::consts::PI / 180.0);
            critical_slices.push(SliceData {
                x: s.x,
                x_left: s.x_left,
                x_right: s.x_right,
                width: s.width,
                y_top: s.y_top,
                y_bottom: s.y_bottom,
                height: s.height,
                area: s.area,
                alpha: s.alpha,
                base_length: s.base_length,
                weight: s.weight,
                surface_load: Some(surface_load),
                cohesion: s.cohesion,
                friction_angle: s.friction_angle,
                normal_force,
                shear_force,
                // negative above the line in a material with φb (the suction)
                pore_pressure: s.u - s.suction.unwrap_or(0.0),
                base_material,
            });
        }
        slope.search_mut()[ci].slices = Some(slices);
    }

    // All surfaces for visualization (sorted by FOS ascending)
    let all_surfaces: Vec<SlipSurfaceResult> = slope
        .search()
        .iter()
        .filter(|p| p.fos.is_some())
        .map(surface_result)
        .collect();
    let custom_surfaces = custom_surface_results(slope);

    // Moments about a circle's centre; on a non-circular surface they
    // depend on the axis point and the solved normal forces, so none are
    // reported.
    let crit = &slope.search()[ci];
    let critical_pushing_moment = if crit.points.is_some() || crit.composite.is_some() {
        None
    } else {
        compute_critical_pushing_moment(crit.slices.as_deref())
    };
    let critical_slip_volume = compute_critical_slip_volume(crit.slices.as_deref());
    let critical_resisting_moment = critical_pushing_moment.map(|m| m * critical_surface.fos);

    // Surfaces left without a factor; a Morgenstern-Price closest pair is
    // not converged either but keeps its factor (and is flagged by its gap).
    let non_converged_surfaces = slope
        .search()
        .iter()
        .filter(|p| p.converged == Some(false) && p.fos.is_none())
        .count();
    let discarded_by_size = slope
        .search()
        .iter()
        .filter(|p| p.below_min_size == Some(true))
        .count();

    let normals_for_warnings: Option<Vec<f64>> = solved_normals.or_else(|| {
        if critical_slices.is_empty() {
            None
        } else {
            Some(critical_slices.iter().map(|s| s.normal_force).collect())
        }
    });
    let method = slope.method();
    let mut result = AnalysisResult {
        min_fos: min_fos.unwrap_or(0.0),
        max_fos: slope.get_max_fos()?,
        critical_surface: Some(critical_surface),
        all_surfaces,
        critical_slices,
        method,
        critical_lff_array: if method == crate::types::analysis::AnalysisMethod::MorgensternPrice {
            crit_lff
        } else {
            None
        },
        critical_pushing_moment,
        critical_resisting_moment,
        critical_slip_volume,
        elapsed_ms,
        non_converged_surfaces: Some(non_converged_surfaces),
        split_failure_count: Some(slope.split_failure_count() as usize),
        discarded_by_size: Some(discarded_by_size),
        // Checked on the base normal forces reported in the slice table.
        warnings: Some(analysis_warnings(slope, normals_for_warnings.as_deref())?),
        sliding_direction: None,
        other_direction_min_fos: None,
        fem: None,
        sgi3d: None,
        sgi3d_error: None,
        fem_error: None,
        custom_surfaces,
        partial_factors: slope.partial_factors().cloned(),
    };

    // 3D effects after SGI's guidance, over this analysis's circular surfaces
    // (its circle in model space). A failure keeps the 2D result.
    if let Some(g) = options.sgi3d.as_ref().filter(|g| g.enabled) {
        let r = sgi3d_factor_of_safety(
            slope,
            &Sgi3dOptions {
                length: g.length,
                overstrong_f2d: g.overstrong_f2d,
                exclude_materials: Some(g.exclude_materials.clone()),
                cell_size: g.cell_size,
            },
        );
        match r {
            Ok(Some(r)) => result.sgi3d = Some(r),
            Ok(None) => {
                result.sgi3d_error = Some(
                    "No circular slip surface with a factor of safety (the 3D effects apply to circular surfaces)."
                        .to_string(),
                );
            }
            Err(e) => result.sgi3d_error = Some(e.message),
        }
    }

    Ok(result)
}
