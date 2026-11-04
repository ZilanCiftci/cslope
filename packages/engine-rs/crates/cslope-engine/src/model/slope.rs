//! Port of packages/engine/src/model/slope.ts
//!
//! Core Slope model for slope stability analysis.
//!
//! Ownership follows ARCHITECTURE.md §1: the slope owns a material table
//! (`materials`, indexed by `MaterialId`); geometries, water-table
//! assignments and slices refer to materials by id. TypeScript's `_materials`
//! (the materials registered with `addMaterial` / `assignMaterial`, whose
//! first is the default of `setExternalBoundary`) is the list `registered`.
//! The lazy caches (`compositeFloor`, `pileProfiles`, `reinforcementEnvelopes`,
//! and the per-slope WeakMap caches of surface.ts and search.ts) are
//! `OnceLock`s replaced by `reset_results`; the pure memoisation caches of
//! `getExternalYIntersection` / `getWaterYIntersection` are dropped.

use crate::error::{EngineError, Result};
use crate::js;
use crate::math::circle::get_circle_line_intersections;
use crate::math::interpolation::get_y_at_x;
use crate::math::polygon::is_point_in_polygon;
use crate::model::canonical::{get_domain_x, mirror_x};
use crate::model::composite::{composite_floor, CompositeFloor};
use crate::model::geometry_ops::{
    clip_line_to_surface, create_geometry_with_material, get_surface_line, keyhole_ring,
    polygonize_regions_detailed, split_polygon_by_polyline_detailed, Polyline,
};
use crate::model::reinforcement::{
    build_envelope, build_pile_profile, PileProfile, ReinforcementEnvelope,
};
use crate::model::search::MaterialInterface;
use crate::model::surface::BelowGround;
use crate::model::waternet::Waternet;
use crate::types::analysis::{
    default_analysis_options, AnalysisMethod, AnalysisOptions, CustomPlaneRef, FemAnalysisSettings,
    IntersliceFunctionType, PartialFactors, PorePressureHead, SearchMethod, SurfaceRejection,
    WaterTableInput,
};
use crate::types::constants::{ITERATIONS_RANGE, REFINED_ITERATIONS_RANGE, SLICES_RANGE};
use crate::types::geometry::{GeometryWithMaterial, Slice};
use crate::types::json::OrOther;
use crate::types::loads::{LineLoad, Udl};
use crate::types::material::{Material, MaterialId, MaterialParams};
use crate::types::material_models::MaterialModel;
use crate::types::reinforcement::{Pile, PileForceDirection, Reinforcement, ReinforcementPullout};
use crate::types::sgi3d::Sgi3dSettings;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, OnceLock};

/// A point `[x, y]`.
pub type Pt = [f64; 2];

// ── Types used internally ─────────────────────────────────────────

/// A candidate failure surface for analysis.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SearchPlane {
    /// Entry (left) intersection point [x, y].
    pub lc: Pt,
    /// Exit (right) intersection point [x, y].
    pub rc: Pt,
    /// Circle centre x.
    pub cx: f64,
    /// Circle centre y.
    pub cy: f64,
    /// Circle radius.
    pub radius: f64,
    /// Factor of safety (set after analysis).
    pub fos: Option<f64>,
    /// Slices for this surface (set after analysis).
    pub slices: Option<Vec<Slice>>,
    /// A circle given directly (addSingleCircularPlane), not checked against
    /// the model's boundary when added: evaluatePlanes rejects it when it
    /// leaves the model where it is no composite surface. (`unchecked?: true`)
    pub unchecked: Option<bool>,
    /// Lambda-FS-FForce array for Morgenstern-Price.
    pub lff_array: Option<Vec<[f64; 4]>>,
    /// Whether the solver converged for this surface (for Morgenstern-Price:
    /// a crossing Fm = Ff; false for a closest pair, see `closest_pair`).
    pub converged: Option<bool>,
    /// Morgenstern-Price: the moment and force factors never met and the
    /// closest pair was accepted (gap in `equilibrium_gap`). The factor meets
    /// moment equilibrium and force equilibrium only within the gap; the
    /// surface is not converged but keeps its factor.
    pub closest_pair: Option<bool>,
    /// Morgenstern-Price: |Fm − Ff| of a solution accepted as the closest
    /// pair because the curves never crossed (no complete-equilibrium
    /// solution exists on the surface). Absent when they crossed.
    pub equilibrium_gap: Option<f64>,
    /// A candidate of the non-circular optimisation.
    pub optimised: Option<bool>,
    /// Non-circular surface: polyline from entry to exit (x increasing).
    /// (cx, cy) is then the axis point for moment equilibrium and `radius`
    /// is 0.
    pub points: Option<Vec<Pt>>,
    /// Bottom of the tension crack [x, y] on the arc, where the surface was
    /// cut off; the sliding mass starts here instead of at `lc`.
    pub crack: Option<Pt>,
    /// A composite circle (model/composite.rs): the surface as analysed, from
    /// the entry (or crack) to the exit, following the floor where the circle
    /// went below it. Absent for a plain circle.
    pub composite: Option<Vec<Pt>>,
    /// Generated tangent to this material interface (search.rs).
    pub tangent_to: Option<usize>,
    /// Not analysed: shallower than the minimum slip depth or smaller than
    /// the minimum slip area.
    pub below_min_size: Option<bool>,
    /// The custom search plane of the definition this plane was added for
    /// (build_slope.rs); carried through the analysis to the result.
    pub custom_plane: Option<CustomPlaneRef>,
    /// Why the evaluation left the plane without a factor (evaluate_plane).
    pub rejection: Option<SurfaceRejection>,
}

/// `Partial<AnalysisOptions>`: the options given to `update_analysis_options`.
/// A field typed `T | null` in TypeScript is `Option<Option<T>>` (`Some(None)`
/// is `null`).
///
/// JSON is read as `updateAnalysisOptions` reads it (absent is
/// `undefined`, `None` here): a number that is `null` or of another type is
/// NaN (the finiteness checks give TypeScript's message); a string option
/// TypeScript checks against its values keeps another value (`OrOther`) for
/// that check; a flag is its truthiness (`null` is false); see the
/// deserializers of the other fields.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisOptionsPatch {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub slices: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub iterations: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub refined_iterations: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub min_failure_dist: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub tolerance: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub max_iterations: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub method: Option<OrOther<AnalysisMethod>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    pub janbu_correction: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub interslice_function: Option<OrOther<IntersliceFunctionType>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub interslice_data_points: Option<IntersliceDataPointsPatch>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub pore_pressure_head: Option<OrOther<PorePressureHead>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub tension_crack_depth: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub tension_crack_water: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    pub tension_crack_auto: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub tension_crack_angle: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    pub composite_surfaces: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    pub composite_base: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub seismic_horizontal: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub seismic_vertical: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "partial_factors_patch"
    )]
    pub partial_factors: Option<Option<PartialFactors>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    pub both_directions: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    pub non_circular_optimization: Option<bool>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub search_method: Option<OrOther<SearchMethod>>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub block_active_angle: Option<AngleRangePatch>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present"
    )]
    pub block_passive_angle: Option<AngleRangePatch>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::present_num"
    )]
    pub min_slip_depth: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "nullable_num_patch"
    )]
    pub min_slip_area: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem: Option<FemAnalysisSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sgi3d: Option<Sgi3dSettings>,
}

/// `intersliceDataPoints` of a patch as `updateAnalysisOptions` reads it:
/// the points it keeps (`Array.isArray(p) && p.length >= 2 &&
/// isFinite(p[0]) && isFinite(p[1])`), or a value that is not a list, on
/// which `.filter` throws TypeScript's TypeError. The kept points are
/// [x, f]: further values of a point (`[0, 0.5, 9]`) are left out, as every
/// use reads x and f only. The global `isFinite` converts (`"0.5"`, `null`,
/// `true` pass), but the interslice function (`dataPointSpecified`) keeps
/// only numbers (`Number.isFinite`): such a value is NaN here, and the
/// point is dropped as the analysis drops it. (TypeScript's getter shows
/// the point as given, and on a mirrored model `1 - x` would turn such an
/// x into a number: a corner the port does not follow.)
#[derive(Debug, Clone, PartialEq)]
pub enum IntersliceDataPointsPatch {
    Points(Vec<[f64; 2]>),
    NotAList(serde_json::Value),
}

impl From<Vec<[f64; 2]>> for IntersliceDataPointsPatch {
    fn from(points: Vec<[f64; 2]>) -> Self {
        IntersliceDataPointsPatch::Points(points)
    }
}

impl<'de> Deserialize<'de> for IntersliceDataPointsPatch {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        use crate::types::json::{js_array, js_global_is_finite, js_number};
        // a value the filter keeps that is not a number is NaN here
        let num = |v: &serde_json::Value| js_number(Some(v)).unwrap_or(f64::NAN);
        let v = crate::types::json::JsJson::deserialize(d)?.0;
        let Some(list) = js_array(Some(&v)) else {
            return Ok(IntersliceDataPointsPatch::NotAList(v));
        };
        Ok(IntersliceDataPointsPatch::Points(
            list.iter()
                .filter_map(|p| {
                    let p = js_array(Some(p)).filter(|p| p.len() >= 2)?;
                    (js_global_is_finite(Some(&p[0])) && js_global_is_finite(Some(&p[1])))
                        .then(|| [num(&p[0]), num(&p[1])])
                })
                .collect(),
        ))
    }
}

impl Serialize for IntersliceDataPointsPatch {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            IntersliceDataPointsPatch::Points(p) => p.serialize(s),
            IntersliceDataPointsPatch::NotAList(v) => v.serialize(s),
        }
    }
}

/// `partialFactors` of a patch: a value that is not truthy (`null`) is
/// `Some(None)`; an object of factors is them; any other truthy value
/// (another type, a factor missing) is factors of NaN, which the positivity
/// check rejects with TypeScript's message.
fn partial_factors_patch<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<Option<PartialFactors>>, D::Error> {
    let v = crate::types::json::JsJson::deserialize(d)?.0;
    if !crate::types::json::js_truthy(Some(&v)) {
        return Ok(Some(None));
    }
    Ok(Some(Some(serde_json::from_value(v).unwrap_or(
        PartialFactors {
            cu: f64::NAN,
            cohesion: f64::NAN,
            tan_phi: f64::NAN,
            variable_load: f64::NAN,
            basis: None,
        },
    ))))
}

/// `blockActiveAngle` / `blockPassiveAngle` of a patch, as
/// `updateAnalysisOptions` reads it: `null` (no range), or TypeScript's
/// `const [lo, hi] = r`: the first two values of a list or a string
/// (missing ones and values that are not numbers are NaN, which the range
/// check rejects), and TypeScript's TypeError "r is not iterable" on any
/// other value.
#[derive(Debug, Clone, PartialEq)]
pub enum AngleRangePatch {
    Null,
    Range([f64; 2]),
    NotIterable(serde_json::Value),
}

impl From<Option<[f64; 2]>> for AngleRangePatch {
    fn from(r: Option<[f64; 2]>) -> Self {
        match r {
            None => AngleRangePatch::Null,
            Some(r) => AngleRangePatch::Range(r),
        }
    }
}

impl<'de> Deserialize<'de> for AngleRangePatch {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        use crate::types::json::js_number;
        let v = crate::types::json::JsJson::deserialize(d)?.0;
        Ok(match &v {
            serde_json::Value::Null => AngleRangePatch::Null,
            // (a number, NaN and ±Infinity included, is not iterable)
            serde_json::Value::String(_) if js_number(Some(&v)).is_none() => {
                AngleRangePatch::Range([f64::NAN, f64::NAN])
            }
            serde_json::Value::Array(a) => {
                let at = |i: usize| js_number(a.get(i)).unwrap_or(f64::NAN);
                AngleRangePatch::Range([at(0), at(1)])
            }
            _ => AngleRangePatch::NotIterable(v),
        })
    }
}

impl Serialize for AngleRangePatch {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        match self {
            AngleRangePatch::Null => s.serialize_none(),
            AngleRangePatch::Range(r) => r.serialize(s),
            AngleRangePatch::NotIterable(v) => v.serialize(s),
        }
    }
}

/// `minSlipArea` of a patch: `null` is `Some(None)`, a number itself, any
/// other value NaN (rejected by its check as in TypeScript).
fn nullable_num_patch<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<Option<f64>>, D::Error> {
    let v = crate::types::json::JsJson::deserialize(d)?.0;
    if v.is_null() {
        return Ok(Some(None));
    }
    Ok(Some(Some(
        crate::types::json::js_number(Some(&v)).unwrap_or(f64::NAN),
    )))
}

impl AnalysisOptionsPatch {
    /// `{ ...self, ...other }` (a field `other` gives replaces this one's).
    pub fn merged(&self, other: &AnalysisOptionsPatch) -> AnalysisOptionsPatch {
        macro_rules! pick {
            ($($f:ident),*) => {
                AnalysisOptionsPatch { $($f: other.$f.clone().or_else(|| self.$f.clone())),* }
            };
        }
        pick!(
            slices,
            iterations,
            refined_iterations,
            min_failure_dist,
            tolerance,
            max_iterations,
            method,
            janbu_correction,
            interslice_function,
            interslice_data_points,
            pore_pressure_head,
            tension_crack_depth,
            tension_crack_water,
            tension_crack_auto,
            tension_crack_angle,
            composite_surfaces,
            composite_base,
            seismic_horizontal,
            seismic_vertical,
            partial_factors,
            both_directions,
            non_circular_optimization,
            search_method,
            block_active_angle,
            block_passive_angle,
            min_slip_depth,
            min_slip_area,
            fem,
            sgi3d
        )
    }
}

impl From<&AnalysisOptions> for AnalysisOptionsPatch {
    /// Every field of full options (an `AnalysisOptions` passed where
    /// TypeScript takes `Partial<AnalysisOptions>`).
    fn from(o: &AnalysisOptions) -> Self {
        AnalysisOptionsPatch {
            slices: Some(o.slices),
            iterations: Some(o.iterations),
            refined_iterations: Some(o.refined_iterations),
            min_failure_dist: Some(o.min_failure_dist),
            tolerance: Some(o.tolerance),
            max_iterations: Some(o.max_iterations),
            method: Some(o.method.into()),
            janbu_correction: o.janbu_correction,
            interslice_function: o.interslice_function.map(Into::into),
            interslice_data_points: o.interslice_data_points.clone().map(Into::into),
            pore_pressure_head: o.pore_pressure_head.map(Into::into),
            tension_crack_depth: o.tension_crack_depth,
            tension_crack_water: o.tension_crack_water,
            tension_crack_auto: o.tension_crack_auto,
            tension_crack_angle: o.tension_crack_angle,
            composite_surfaces: o.composite_surfaces,
            composite_base: o.composite_base,
            seismic_horizontal: o.seismic_horizontal,
            seismic_vertical: o.seismic_vertical,
            partial_factors: o.partial_factors.clone(),
            both_directions: o.both_directions,
            non_circular_optimization: o.non_circular_optimization,
            search_method: o.search_method.map(Into::into),
            block_active_angle: o.block_active_angle.map(Into::into),
            block_passive_angle: o.block_passive_angle.map(Into::into),
            min_slip_depth: o.min_slip_depth,
            min_slip_area: o.min_slip_area,
            fem: o.fem.clone(),
            sgi3d: o.sgi3d.clone(),
        }
    }
}

/// `Partial<AnalysisLimits>` for `set_analysis_limits`.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisLimitsPatch {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub entry_left_x: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub entry_right_x: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub exit_left_x: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub exit_right_x: Option<f64>,
}

impl From<&crate::types::analysis::AnalysisLimits> for AnalysisLimitsPatch {
    fn from(l: &crate::types::analysis::AnalysisLimits) -> Self {
        AnalysisLimitsPatch {
            entry_left_x: Some(l.entry_left_x),
            entry_right_x: Some(l.entry_right_x),
            exit_left_x: Some(l.exit_left_x),
            exit_right_x: Some(l.exit_right_x),
        }
    }
}

/// A water line as given, with its clipping rule.
#[derive(Debug, Clone, PartialEq)]
struct WaterLineInput {
    wx: Vec<f64>,
    wy: Vec<f64>,
    follow_boundary: bool,
}

/// A water line needs two finite points (it is then continued
/// horizontally beyond its ends; two points at one x make a vertical
/// step). With fewer, slices in a material assigned to it would silently
/// get no pore pressure; commercial programs likewise give no FOS where a water
/// table does not span the slip surface.
fn check_water_line(coordinates: &[Pt]) -> Result<()> {
    let finite = coordinates
        .iter()
        .filter(|c| c[0].is_finite() && c[1].is_finite())
        .count();
    if finite != coordinates.len() {
        return Err(EngineError::new(
            "Water table points must be finite numbers.",
        ));
    }
    // Two points at one x (a vertical step) are a valid line: it is
    // extended horizontally to the model edges from both ends.
    if finite < 2 {
        return Err(EngineError::new("A water table needs at least two points."));
    }
    Ok(())
}

/// Smallest useful inner iteration limit for the FOS solvers.
const MIN_MAX_ITERATIONS: f64 = 6.0;

/// The message of `assign_material` with an id that is not in the table
/// (TypeScript: an object that is not a `Material`).
const NOT_A_MATERIAL: &str = "assignMaterial only accepts instances of the Material class";

// ── Slope ─────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct Slope {
    // ── Material / geometry state ─────────────────────────────────
    /// The material table: `MaterialId` indexes it.
    materials: Vec<Material>,
    /// TypeScript's `_materials`: the registered materials in order.
    registered: Vec<MaterialId>,
    material_geometries: Vec<GeometryWithMaterial>,
    external_boundary_px: Vec<f64>,
    external_boundary_py: Vec<f64>,
    external_length: f64,

    // ── Surface line ──────────────────────────────────────────────
    surface_line: Option<Polyline>,

    // ── Water table ───────────────────────────────────────────────
    water_rl: bool,
    water_rl_xy: Option<Polyline>,
    /// Additional water tables by id (Map insertion order). Materials
    /// assigned to one of these use it for pore pressure instead of the
    /// default water table.
    extra_water_lines: Vec<(String, Option<Polyline>)>,
    material_water_table: Vec<(MaterialId, Option<String>)>,
    /// Water lines as given (before extension to the model edges and
    /// clipping), so that they are built again for a new external boundary:
    /// a line must always span the whole model, or slices beyond its ends
    /// would silently get no pore pressure.
    water_input: Option<WaterLineInput>,
    extra_water_inputs: Vec<(String, WaterLineInput)>,

    // ── Loads ─────────────────────────────────────────────────────
    udls: Vec<Udl>,
    lls: Vec<LineLoad>,
    reinforcements: Vec<Reinforcement>,
    reinforcement_envelopes: OnceLock<Vec<ReinforcementEnvelope>>,
    piles: Vec<Pile>,
    pile_profiles: OnceLock<Result<Vec<Option<PileProfile>>>>,

    // ── Analysis options ──────────────────────────────────────────
    slices: f64,
    iterations: f64,
    refined_iterations: f64,
    min_failure_distance: f64,
    tolerance: f64,
    max_iterations: f64,
    method: AnalysisMethod,
    janbu_correction: bool,
    interslice_function: IntersliceFunctionType,
    pore_pressure_head: PorePressureHead,
    tension_crack_depth: f64,
    tension_crack_water: f64,
    tension_crack_auto: bool,
    tension_crack_angle: f64,
    composite_surfaces: bool,
    composite_base: bool,
    drawdown_before: Option<Box<Slope>>,
    waternet: Option<Waternet>,
    earlier_stage: Option<Box<Slope>>,
    /// The analysis options given so far (for the model before drawdown).
    options_given: AnalysisOptionsPatch,
    seismic_horizontal: f64,
    seismic_vertical: f64,
    composite_floor: OnceLock<Option<CompositeFloor>>,
    partial_factors: Option<PartialFactors>,
    non_circular_optimization: bool,
    search_method: SearchMethod,
    block_active_angle: Option<[f64; 2]>,
    block_passive_angle: Option<[f64; 2]>,
    /// Block search objects: one point, a line (two) or a window (three or more).
    block_search_objects: Vec<Vec<Pt>>,
    min_slip_depth: f64,
    /// Smallest sliding mass analysed (m²); 0: no limit (the default).
    min_slip_area: f64,
    interslice_data_points: Vec<Pt>,
    /// The model was mirrored into canonical (left-to-right) coordinates, so
    /// model-space analysis options such as the interslice data points must be
    /// mirrored as well.
    mirrored: bool,
    /// The model's x extent, [xMin, xMax], from the external boundary (toModelX).
    domain_x: Option<[f64; 2]>,

    // ── Analysis limits ───────────────────────────────────────────
    limits: [f64; 4],

    // ── Search planes ─────────────────────────────────────────────
    search: Vec<SearchPlane>,
    individual_planes: Vec<SearchPlane>,
    /// Custom search planes of the definition that were not added (no
    /// surface through the soil), with the reason, for the result.
    custom_plane_rejections: Vec<(CustomPlaneRef, SurfaceRejection)>,
    custom_planes_only: bool,
    fixed_slices: Option<Vec<f64>>,
    split_failure_count: u32,
    dangling_boundaries: Vec<usize>,

    // ── Per-slope caches of surface.ts and search.ts (WeakMaps there) ──
    pub(crate) below_ground: OnceLock<BelowGround>,
    pub(crate) material_interfaces: OnceLock<Vec<MaterialInterface>>,

    /// Bumped on every mutation (facade caches key on it).
    version: u64,
}

impl Default for Slope {
    fn default() -> Self {
        Slope::new()
    }
}

impl Slope {
    pub fn new() -> Slope {
        let d = default_analysis_options();
        Slope {
            materials: Vec::new(),
            registered: Vec::new(),
            material_geometries: Vec::new(),
            external_boundary_px: Vec::new(),
            external_boundary_py: Vec::new(),
            external_length: 0.0,
            surface_line: None,
            water_rl: false,
            water_rl_xy: None,
            extra_water_lines: Vec::new(),
            material_water_table: Vec::new(),
            water_input: None,
            extra_water_inputs: Vec::new(),
            udls: Vec::new(),
            lls: Vec::new(),
            reinforcements: Vec::new(),
            reinforcement_envelopes: OnceLock::new(),
            piles: Vec::new(),
            pile_profiles: OnceLock::new(),
            slices: d.slices,
            iterations: d.iterations,
            refined_iterations: d.refined_iterations,
            min_failure_distance: d.min_failure_dist,
            tolerance: d.tolerance,
            max_iterations: d.max_iterations,
            method: d.method,
            janbu_correction: d.janbu_correction.unwrap_or(false),
            interslice_function: d
                .interslice_function
                .unwrap_or(IntersliceFunctionType::HalfSine),
            pore_pressure_head: d.pore_pressure_head.unwrap_or(PorePressureHead::Vertical),
            tension_crack_depth: d.tension_crack_depth.unwrap_or(0.0),
            tension_crack_water: d.tension_crack_water.unwrap_or(0.0),
            tension_crack_auto: d.tension_crack_auto.unwrap_or(false),
            tension_crack_angle: d.tension_crack_angle.unwrap_or(0.0),
            composite_surfaces: d.composite_surfaces.unwrap_or(true),
            composite_base: d.composite_base.unwrap_or(false),
            drawdown_before: None,
            waternet: None,
            earlier_stage: None,
            options_given: AnalysisOptionsPatch::default(),
            seismic_horizontal: d.seismic_horizontal.unwrap_or(0.0),
            seismic_vertical: d.seismic_vertical.unwrap_or(0.0),
            composite_floor: OnceLock::new(),
            partial_factors: None,
            non_circular_optimization: false,
            search_method: SearchMethod::Circular,
            block_active_angle: None,
            block_passive_angle: None,
            block_search_objects: Vec::new(),
            min_slip_depth: 0.0,
            min_slip_area: 0.0,
            interslice_data_points: d.interslice_data_points.unwrap_or_default(),
            mirrored: false,
            domain_x: None,
            limits: [0.0; 4],
            search: Vec::new(),
            individual_planes: Vec::new(),
            custom_plane_rejections: Vec::new(),
            custom_planes_only: false,
            fixed_slices: None,
            split_failure_count: 0,
            dangling_boundaries: Vec::new(),
            below_ground: OnceLock::new(),
            material_interfaces: OnceLock::new(),
            version: 0,
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Materials (the table behind MaterialId)
    // ────────────────────────────────────────────────────────────────

    /// The material table (`MaterialId` indexes it).
    pub fn materials(&self) -> &[Material] {
        &self.materials
    }

    /// The material of an id of this slope.
    pub fn material(&self, id: MaterialId) -> &Material {
        &self.materials[id.0 as usize]
    }

    /// Puts a material into the table without registering it (an object
    /// TypeScript would pass around without `addMaterial`); the id refers
    /// to it from then on. A material with an `external_key` already in the
    /// table gets that entry's id (the same JavaScript object).
    pub fn insert_material(&mut self, material: Material) -> MaterialId {
        if let Some(key) = material.external_key {
            if let Some(i) = self
                .materials
                .iter()
                .position(|m| m.external_key == Some(key))
            {
                return MaterialId(i as u32);
            }
        }
        self.materials.push(material);
        MaterialId((self.materials.len() - 1) as u32)
    }

    /// The model of a material was changed (Monte Carlo samples): the table
    /// entry gets the new model and what depends on it is dropped
    /// (TypeScript writes `material.model` and calls `materialsChanged`).
    pub fn set_material_model(&mut self, id: MaterialId, model: Arc<MaterialModel>) {
        self.materials[id.0 as usize].model = model;
        self.reset_results();
    }

    /// Gives a table entry the facade's key of the JavaScript object that
    /// stands for it (a material made by the engine, handed to JavaScript),
    /// so that the object passed back is this entry again. Not a port.
    pub fn set_material_external_key(&mut self, id: MaterialId, key: u32) {
        self.materials[id.0 as usize].external_key = Some(key);
    }

    fn register(&mut self, id: MaterialId) {
        if !self.registered.contains(&id) {
            self.registered.push(id);
        }
    }

    // ────────────────────────────────────────────────────────────────
    // Public getters (read-only access to internal state)
    // ────────────────────────────────────────────────────────────────

    pub fn material_geometries(&self) -> &[GeometryWithMaterial] {
        &self.material_geometries
    }

    pub fn surface_line_xy(&self) -> Option<&Polyline> {
        self.surface_line.as_ref()
    }

    /// Vertices of the external boundary polygon (x, y).
    pub fn external_boundary_xy(&self) -> (&[f64], &[f64]) {
        (&self.external_boundary_px, &self.external_boundary_py)
    }

    pub fn water_rl_xy(&self) -> Option<&Polyline> {
        self.water_rl_xy.as_ref()
    }

    pub fn has_water_table(&self) -> bool {
        self.water_rl
    }

    /// True when at least one material uses its own water table.
    pub fn has_material_water_tables(&self) -> bool {
        !self.material_water_table.is_empty()
    }

    fn extra_water_line(&self, id: &str) -> Option<&Option<Polyline>> {
        self.extra_water_lines
            .iter()
            .find(|(k, _)| k == id)
            .map(|(_, v)| v)
    }

    /// Water lines that can govern pore pressure (the default line and any
    /// line assigned to a material), used as slice break points.
    pub fn all_water_lines(&self) -> Vec<&Polyline> {
        let mut lines: Vec<&Polyline> = Vec::new();
        if self.water_rl {
            if let Some(w) = &self.water_rl_xy {
                lines.push(w);
            }
        }
        let mut ids: Vec<&str> = Vec::new();
        // (an id of `null` names no line)
        for id in self
            .material_water_table
            .iter()
            .filter_map(|(_, id)| id.as_deref())
        {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
        for id in ids {
            if let Some(Some(line)) = self.extra_water_line(id) {
                lines.push(line);
            }
        }
        lines
    }

    /// Water line that governs pore pressure at the base of a slice in the
    /// given material: the material's own water table when it has one,
    /// otherwise the default water table. None means no pore pressure.
    pub fn get_water_line_for_material(&self, material: Option<MaterialId>) -> Option<&Polyline> {
        let id = material.and_then(|m| {
            self.material_water_table
                .iter()
                .find(|(k, _)| *k == m)
                .and_then(|(_, v)| v.as_deref())
        });
        if let Some(id) = id {
            if let Some(line) = self.extra_water_line(id) {
                return line.as_ref();
            }
        }
        if self.water_rl {
            self.water_rl_xy.as_ref()
        } else {
            None
        }
    }

    pub fn udls(&self) -> &[Udl] {
        &self.udls
    }

    pub fn reinforcements(&self) -> &[Reinforcement] {
        &self.reinforcements
    }

    pub fn piles(&self) -> &[Pile] {
        &self.piles
    }

    /// Ito & Matsui pressure profiles of the piles (built on first use).
    pub fn pile_profiles(&self) -> Result<&[Option<PileProfile>]> {
        self.pile_profiles
            .get_or_init(|| {
                self.piles
                    .iter()
                    .map(|p| build_pile_profile(self, p))
                    .collect()
            })
            .as_ref()
            .map(|v| v.as_slice())
            .map_err(|e| e.clone())
    }

    /// Capacity envelopes of the reinforcement (built on first use).
    pub fn reinforcement_envelopes(&self) -> &[ReinforcementEnvelope] {
        self.reinforcement_envelopes.get_or_init(|| {
            self.reinforcements
                .iter()
                .map(|r| build_envelope(self, r))
                .collect()
        })
    }

    pub fn line_loads(&self) -> &[LineLoad] {
        &self.lls
    }

    pub fn slice_count(&self) -> f64 {
        self.slices
    }

    pub fn iterations(&self) -> f64 {
        self.iterations
    }

    pub fn tolerance(&self) -> f64 {
        self.tolerance
    }

    pub fn refined_iterations(&self) -> f64 {
        self.refined_iterations
    }

    pub fn max_iterations(&self) -> f64 {
        self.max_iterations
    }

    pub fn method(&self) -> AnalysisMethod {
        self.method
    }

    pub fn limits(&self) -> [f64; 4] {
        self.limits
    }

    /// The limits the search uses. The upslope end of the exit range, when it
    /// is a corner of the ground (the toe), is moved upslope by 1e-5 of the
    /// model's width: a circle exactly through the corner only touches it and
    /// runs on in the soil, so a range starting at the toe, or being the toe
    /// alone (as files from other programs give an exit at the toe), held no
    /// circle exiting at it; the ones just above it on the face do. On two
    /// public examples: 1.2514 against the file's 1.2535 (1.331 before), and
    /// 1.1625 against 1.178 (1.238 before; 1.1773 on the file's own circle).
    /// Ranges are in canonical (left-to-right) space; an entry range given as
    /// a point on a corner is widened to both sides. Other ends are as given
    /// (moving them as well moved the search's start on V005's plane face).
    pub fn search_limits(&self) -> [f64; 4] {
        let [entry_left_x, entry_right_x, exit_left_x, exit_right_x] = self.limits;
        let Some(surf) = &self.surface_line else {
            return self.limits;
        };
        let xs = &surf.x;
        if xs.len() < 2 {
            return self.limits;
        }
        let x0 = js::math::min_of(xs);
        let x1 = js::math::max_of(xs);
        let w = 1e-5 * (x1 - x0);
        let tol = 1e-9 * (x1 - x0);
        let at_corner = |x: f64| x > x0 && x < x1 && xs.iter().any(|&v| (v - x).abs() <= tol);
        let entry_point = entry_right_x - entry_left_x <= tol && at_corner(entry_left_x);
        [
            if entry_point {
                js::math::max(x0, entry_left_x - w)
            } else {
                entry_left_x
            },
            if entry_point {
                js::math::min(x1, entry_right_x + w)
            } else {
                entry_right_x
            },
            if at_corner(exit_left_x) {
                js::math::max(x0, exit_left_x - w)
            } else {
                exit_left_x
            },
            exit_right_x,
        ]
    }

    pub fn min_failure_distance(&self) -> f64 {
        self.min_failure_distance
    }

    pub fn fixed_slices(&self) -> Option<&[f64]> {
        self.fixed_slices.as_deref()
    }

    /// The analysed surfaces, in canonical (left-to-right) space: for a
    /// mirrored model (a right-to-left slope) every x is mirrored, x′ = xMin +
    /// xMax − x, from the model space in which the definition and its custom
    /// surfaces are given. `to_model_x` and `to_model_circle` take them back;
    /// `analyse` with `map_analysis_result_to_model_space` gives whole results
    /// in model space.
    pub fn search(&self) -> &[SearchPlane] {
        &self.search
    }

    /// The custom surfaces analysed, in canonical space (see `search`).
    pub fn individual_planes(&self) -> &[SearchPlane] {
        &self.individual_planes
    }

    /// The custom search planes of the definition that were not added, with
    /// the reason (`add_custom_plane_rejection`).
    pub fn custom_plane_rejections(&self) -> &[(CustomPlaneRef, SurfaceRejection)] {
        &self.custom_plane_rejections
    }

    /// Records a custom search plane of the definition that gave no surface
    /// to analyse (build_slope.rs), for the result.
    pub fn add_custom_plane_rejection(&mut self, plane: CustomPlaneRef, why: SurfaceRejection) {
        self.custom_plane_rejections.push((plane, why));
    }

    /// Marks the last individual plane as the custom search plane it was
    /// added for (build_slope.rs).
    pub fn mark_last_individual_plane(&mut self, plane: CustomPlaneRef) {
        if let Some(last) = self.individual_planes.last_mut() {
            last.custom_plane = Some(plane);
        }
    }

    pub fn custom_planes_only(&self) -> bool {
        self.custom_planes_only
    }

    /// `slope.customPlanesOnly = value` (no reset, as in TypeScript).
    pub fn set_custom_planes_only(&mut self, value: bool) {
        self.custom_planes_only = value;
        self.version += 1;
    }

    pub fn janbu_correction(&self) -> bool {
        self.janbu_correction
    }

    pub fn pore_pressure_head(&self) -> PorePressureHead {
        self.pore_pressure_head
    }

    pub fn tension_crack_depth(&self) -> f64 {
        self.tension_crack_depth
    }

    pub fn tension_crack_water(&self) -> f64 {
        self.tension_crack_water
    }

    /// Limiting base inclination of a tension crack (°; 0: none).
    pub fn tension_crack_angle(&self) -> f64 {
        self.tension_crack_angle
    }

    /// Whether circles follow the top of impenetrable material (composite surfaces).
    pub fn composite_surfaces(&self) -> bool {
        self.composite_surfaces
    }

    /// An earlier stage (SlopeDefinition.earlierStage); None: none.
    pub fn earlier_stage(&self) -> Option<&Slope> {
        self.earlier_stage.as_deref()
    }

    /// Takes ownership of the earlier stage (TypeScript shares the object;
    /// ARCHITECTURE.md §1.3).
    pub fn set_earlier_stage(&mut self, s: Option<Slope>) {
        self.earlier_stage = s.map(Box::new);
        self.reset_results();
    }

    /// Pore pressure from head lines and reference lines (model/waternet.rs); None: the water lines.
    pub fn waternet(&self) -> Option<&Waternet> {
        self.waternet.as_ref()
    }

    pub fn set_waternet(&mut self, wn: Option<Waternet>) {
        self.waternet = wn;
        self.reset_results();
    }

    /// Rapid drawdown: the model with the water before drawdown
    /// (model/drawdown.ts); None without a drawdown analysis.
    pub fn drawdown_before(&self) -> Option<&Slope> {
        self.drawdown_before.as_deref()
    }

    /// Set the model before drawdown (build_slope.rs); it takes this slope's
    /// analysis options from now on.
    pub fn set_drawdown_before(&mut self, before: Option<Slope>) -> Result<()> {
        self.drawdown_before = before.map(Box::new);
        self.version += 1;
        let given = AnalysisOptionsPatch {
            seismic_horizontal: Some(0.0),
            seismic_vertical: Some(0.0),
            ..self.options_given.clone()
        };
        if let Some(b) = self.drawdown_before.as_deref_mut() {
            b.update_analysis_options(&given)?;
        }
        Ok(())
    }

    /// Pseudostatic horizontal seismic coefficient kh (toward the sliding direction).
    pub fn seismic_horizontal(&self) -> f64 {
        self.seismic_horizontal
    }

    /// Pseudostatic vertical seismic coefficient kv (positive downward).
    pub fn seismic_vertical(&self) -> f64 {
        self.seismic_vertical
    }

    /// Whether composite circles also follow the bare base of the model.
    pub fn composite_base(&self) -> bool {
        self.composite_base
    }

    /// The floor composite circles follow (model/composite.rs), for the current geometry.
    pub fn composite_floor(&self) -> Option<&CompositeFloor> {
        self.composite_floor
            .get_or_init(|| {
                composite_floor(
                    &self.external_boundary_px,
                    &self.external_boundary_py,
                    &self.material_geometries,
                    &self.materials,
                    self.composite_base,
                )
            })
            .as_ref()
    }

    pub fn tension_crack_auto(&self) -> bool {
        self.tension_crack_auto
    }

    pub fn partial_factors(&self) -> Option<&PartialFactors> {
        self.partial_factors.as_ref()
    }

    pub fn non_circular_optimization(&self) -> bool {
        self.non_circular_optimization
    }

    pub fn search_method(&self) -> SearchMethod {
        self.search_method
    }

    pub fn block_active_angle(&self) -> Option<[f64; 2]> {
        self.block_active_angle
    }

    pub fn block_passive_angle(&self) -> Option<[f64; 2]> {
        self.block_passive_angle
    }

    pub fn block_search_objects(&self) -> &[Vec<Pt>] {
        &self.block_search_objects
    }

    /// Set the block search objects. Each is one point (a fixed point), two
    /// (a line) or three or more (a window, a polygon), with finite
    /// coordinates; a window needs an area.
    pub fn set_block_search_objects(&mut self, objects: &[Vec<Pt>]) -> Result<()> {
        let mut checked: Vec<Vec<Pt>> = Vec::with_capacity(objects.len());
        for (i, points) in objects.iter().enumerate() {
            if points.is_empty() || !points.iter().all(|p| p[0].is_finite() && p[1].is_finite()) {
                return Err(EngineError::new(format!(
                    "Block search object {} needs at least one point with finite coordinates.",
                    i + 1
                )));
            }
            if points.len() == 2 && points[0][0] == points[1][0] && points[0][1] == points[1][1] {
                return Err(EngineError::new(format!(
                    "Block search object {}: the two ends of the line coincide.",
                    i + 1
                )));
            }
            if points.len() >= 3 {
                let mut area = 0.0;
                let mut j = points.len() - 1;
                for k in 0..points.len() {
                    area += points[j][0] * points[k][1] - points[k][0] * points[j][1];
                    j = k;
                }
                if !(area.abs() > 1e-12) {
                    return Err(EngineError::new(format!(
                        "Block search object {}: the window has no area.",
                        i + 1
                    )));
                }
            }
            checked.push(points.clone());
        }
        self.block_search_objects = checked;
        self.reset_results();
        Ok(())
    }

    /// Smallest sliding mass that is analysed (m², cross-section area per
    /// metre): the set value, by default 0 (no limit). An earlier automatic
    /// default (1 % of the squared ground relief) had no basis in the
    /// literature and could hide a real local failure (a low cut at the toe
    /// of a high slope); `null` from older projects now also means 0. The
    /// surfaces a set limit leaves out are counted and reported
    /// (AnalysisResult.discardedBySize).
    pub fn min_slip_area(&self) -> f64 {
        self.min_slip_area
    }

    /// Height difference of the ground surface (model height if not set).
    pub fn ground_relief(&self) -> f64 {
        match &self.surface_line {
            Some(s) if !s.y.is_empty() => js::math::max_of(&s.y) - js::math::min_of(&s.y),
            _ => self.model_height(),
        }
    }

    /// Cross-section area of the model (inside the external boundary).
    pub fn model_area(&self) -> f64 {
        let px = &self.external_boundary_px;
        let py = &self.external_boundary_py;
        let mut a = 0.0;
        for i in 0..px.len() {
            let j = (i + 1) % px.len();
            a += px[i] * py[j] - px[j] * py[i];
        }
        a.abs() / 2.0
    }

    /// Height of the model (extent of the external boundary in y).
    pub fn model_height(&self) -> f64 {
        let ys = &self.external_boundary_py;
        if ys.is_empty() {
            0.0
        } else {
            js::math::max_of(ys) - js::math::min_of(ys)
        }
    }

    pub fn min_slip_depth(&self) -> f64 {
        self.min_slip_depth
    }

    pub fn interslice_function(&self) -> IntersliceFunctionType {
        self.interslice_function
    }

    /// Interslice function points in canonical coordinates. The user enters
    /// them with x = 0 at the LEFT end of the slip surface in model space,
    /// whatever the sliding direction (as is usual), so for a mirrored
    /// (right-to-left) model they are mirrored here: x → 1 − x.
    pub fn interslice_data_points(&self) -> Vec<Pt> {
        if !self.mirrored {
            return self.interslice_data_points.clone();
        }
        self.interslice_data_points
            .iter()
            .map(|&[x, f]| [1.0 - x, f])
            .rev()
            .collect()
    }

    /// True when the model was mirrored from a right-to-left model space.
    pub fn mirrored(&self) -> bool {
        self.mirrored
    }

    /// An x of the analysis (canonical space: the surfaces in `search`, their
    /// slices and points) in model space, where the definition and its custom
    /// surfaces are given: unchanged unless the model was mirrored, then
    /// mirrored about the middle of the model's extent, as
    /// to_canonical_slope_definition mirrored it (the slope must have been
    /// built from that canonical definition, as `analyse` does). Mirroring is
    /// its own inverse, so the same maps a model-space x into the analysis.
    pub fn to_model_x(&self, x: f64) -> Result<f64> {
        if !self.mirrored {
            return Ok(x);
        }
        let Some([x0, x1]) = self.domain_x else {
            return Err(EngineError::new(
                "toModelX: the slope has no external boundary",
            ));
        };
        Ok(mirror_x(x, x0, x1))
    }

    /// A circular surface of the analysis in model space, the form of
    /// `customSearchPlanes`: analysing it as a custom surface gives the same
    /// surface again. Not for non-circular surfaces (with `points`), whose
    /// cx, cy and radius are only their moment axis. Returns (cx, cy, radius).
    pub fn to_model_circle(&self, plane: &SearchPlane) -> Result<(f64, f64, f64)> {
        if plane.points.is_some() {
            return Err(EngineError::new(
                "toModelCircle: a non-circular surface is not a circle",
            ));
        }
        Ok((self.to_model_x(plane.cx)?, plane.cy, plane.radius))
    }

    /// Mark the model as mirrored from model space (a canonical definition of
    /// a right-to-left slope, see to_canonical_slope_definition).
    pub fn set_mirrored(&mut self, mirrored: bool) {
        self.mirrored = mirrored;
        self.reset_results();
    }

    pub fn split_failure_count(&self) -> u32 {
        self.split_failure_count
    }

    pub fn split_failed(&self) -> bool {
        self.split_failure_count > 0
    }

    /// Indices of the material boundaries (as given to set_material_boundaries)
    /// with an end inside a region, off the outline and every other boundary
    /// even after snapping: they do not split that region.
    pub fn dangling_boundaries(&self) -> &[usize] {
        &self.dangling_boundaries
    }

    /// Bumped on every mutation; equal versions mean equal state.
    pub fn version(&self) -> u64 {
        self.version
    }

    // ────────────────────────────────────────────────────────────────
    // Mutable setters for the solver (used by search/solver code)
    // ────────────────────────────────────────────────────────────────

    pub fn set_search_results(&mut self, planes: Vec<SearchPlane>) {
        self.search = planes;
        self.version += 1;
    }

    /// The analysed planes, to change in place (run_analysis writes the
    /// flags the critical surface's normal forces solve, as TypeScript's
    /// solve does on the slope's own slices).
    pub fn search_mut(&mut self) -> &mut [SearchPlane] {
        &mut self.search
    }

    pub fn set_search_planes(&mut self, planes: Vec<SearchPlane>) {
        self.search = planes;
        self.version += 1;
    }

    pub fn add_individual_planes(&mut self, planes: Vec<SearchPlane>) {
        self.individual_planes.extend(planes);
        self.reset_results();
    }

    // ────────────────────────────────────────────────────────────────
    // Model setup methods
    // ────────────────────────────────────────────────────────────────

    /// Register a material so it is available as the default when
    /// `set_external_boundary` is called. Must be called *before*
    /// `set_external_boundary` to have effect. Returns its id.
    pub fn add_material(&mut self, material: Material) -> MaterialId {
        let id = self.insert_material(material);
        self.register(id);
        self.version += 1;
        id
    }

    /// `addMaterial` of a material already in the table (by its id).
    pub fn register_material(&mut self, id: MaterialId) {
        self.register(id);
        self.version += 1;
    }

    /// Set the external boundary polygon for the slope model.
    ///
    /// `coordinates`: the boundary. Should form a closed polygon with the
    /// last point equal to the first (it is closed if not).
    pub fn set_external_boundary(&mut self, coordinates: &[Pt]) -> Result<()> {
        if coordinates.len() < 3 {
            return Err(EngineError::new("Coordinates must have at least 3 points"));
        }

        let mut px: Vec<f64> = coordinates.iter().map(|c| c[0]).collect();
        let mut py: Vec<f64> = coordinates.iter().map(|c| c[1]).collect();

        // Ensure closed
        if (px[0] - px[px.len() - 1]).abs() > 1e-12 || (py[0] - py[py.len() - 1]).abs() > 1e-12 {
            px.push(px[0]);
            py.push(py[0]);
        }

        self.external_boundary_px = px.clone();
        self.external_boundary_py = py.clone();
        // the extent canonical.rs mirrors about (toModelX)
        self.domain_x = Some(get_domain_x(coordinates));

        // Create initial material geometry with first material (or a default)
        let material = match self.registered.first() {
            Some(&id) => id,
            None => self.insert_material(
                Material::new(MaterialParams::default()).expect("the default material is valid"),
            ),
        };
        self.material_geometries = vec![create_geometry_with_material(&px, &py, material, true)];

        // Extract surface line
        let surface = get_surface_line(&px, &py)?;

        // Compute external length
        let surf_x_min = js::math::min_of(&surface.x);
        let surf_x_max = js::math::max_of(&surface.x);
        self.surface_line = Some(surface);
        self.external_length = surf_x_max - surf_x_min;

        // Water lines given before the boundary are extended to its edges now.
        if let Some(input) = self.water_input.clone() {
            self.water_rl_xy =
                self.build_water_line(&input.wx, &input.wy, input.follow_boundary)?;
            self.water_rl = self.water_rl_xy.is_some();
        }
        for (id, input) in self.extra_water_inputs.clone() {
            let line = self.build_water_line(&input.wx, &input.wy, input.follow_boundary)?;
            self.set_extra_water_line(id, line);
        }

        // Update min failure distance
        self.update_analysis_options(&AnalysisOptionsPatch {
            min_failure_dist: Some(0.0),
            ..Default::default()
        })?;

        // Reset limits to search entire slope
        self.remove_analysis_limits()?;

        // Reset results
        self.split_failure_count = 0;
        self.dangling_boundaries = Vec::new();
        self.reset_results();
        Ok(())
    }

    fn set_extra_water_line(&mut self, id: String, line: Option<Polyline>) {
        match self.extra_water_lines.iter_mut().find(|(k, _)| *k == id) {
            Some(entry) => entry.1 = line,
            None => self.extra_water_lines.push((id, line)),
        }
    }

    /// Replace the material geometry by the slope cut by all boundary
    /// polylines at once (see polygonize_regions); every face starts with the
    /// first material and is assigned later by point.
    pub fn set_material_boundaries(&mut self, lines: &[Vec<Pt>]) -> Result<()> {
        let Some(first) = self.material_geometries.first() else {
            return Err(EngineError::new(
                "External boundary must be set before boundaries",
            ));
        };
        let material = first.material;
        let split = polygonize_regions_detailed(
            &self.external_boundary_px,
            &self.external_boundary_py,
            lines,
        )?;
        // An unsplit slope would be analysed as the first material throughout:
        // a wrong result, not a degraded one.
        if split.failed {
            self.split_failure_count += 1;
            self.version += 1;
            return Err(EngineError::new(
                "The material boundaries could not be split into regions. Check boundaries that touch or nearly touch the outline or each other.",
            ));
        }
        self.dangling_boundaries = split.dangling_boundaries;
        self.material_geometries = split
            .faces
            .iter()
            .map(|face| {
                let ring = keyhole_ring(&face.outer, &face.holes);
                let xs: Vec<f64> = ring.iter().map(|c| c[0]).collect();
                let ys: Vec<f64> = ring.iter().map(|c| c[1]).collect();
                create_geometry_with_material(&xs, &ys, material, true)
            })
            .collect();
        self.reset_results(); // σ′v, pile pressures and results depend on the materials
        Ok(())
    }

    /// Split by a boundary polyline; returns true when any piece was split.
    pub fn set_material_boundary(&mut self, coordinates: &[Pt]) -> Result<bool> {
        if coordinates.len() < 2 {
            return Err(EngineError::new(
                "Material boundary needs at least 2 coordinate points",
            ));
        }

        let lx: Vec<f64> = coordinates.iter().map(|c| c[0]).collect();
        let ly: Vec<f64> = coordinates.iter().map(|c| c[1]).collect();

        let mut new_geometries: Vec<GeometryWithMaterial> = Vec::new();
        let mut changed = false;
        for mg in &self.material_geometries {
            let split = split_polygon_by_polyline_detailed(&mg.px, &mg.py, &lx, &ly)?;
            if split.split_failed {
                self.split_failure_count += 1;
            }
            if split.pieces.len() > 1 {
                changed = true;
            }
            for piece in &split.pieces {
                new_geometries.push(create_geometry_with_material(
                    &piece.px,
                    &piece.py,
                    mg.material,
                    true,
                ));
            }
        }
        self.material_geometries = new_geometries;
        self.reset_results(); // σ′v, pile pressures and results depend on the materials
        Ok(changed)
    }

    /// Assign a material to the region containing the given coordinate.
    ///
    /// `material`: an id of this slope's table (`add_material`,
    /// `insert_material`); another id is TypeScript's non-`Material` object.
    pub fn assign_material(&mut self, coord: Pt, material: MaterialId) -> Result<()> {
        if material.0 as usize >= self.materials.len() {
            return Err(EngineError::new(NOT_A_MATERIAL));
        }
        self.register(material);
        self.version += 1;

        for i in 0..self.material_geometries.len() {
            let mg = &self.material_geometries[i];
            if is_point_in_polygon(coord[0], coord[1], &mg.px, &mg.py) {
                self.material_geometries[i].material = material;
                self.reset_results(); // σ′v, pile pressures and results depend on the materials
                return Ok(());
            }
        }
        Ok(())
    }

    /// Set the water table for the model.
    ///
    /// Supports three modes:
    /// - `Height`: horizontal water table at a given elevation.
    /// - `Depth`: water table at a depth below the surface maximum.
    /// - `Custom`: arbitrary water table profile (array of [x, y]).
    pub fn set_water_table(&mut self, options: &WaterTableInput) -> Result<()> {
        let (follow_boundary, water_height, water_coords) = match options {
            WaterTableInput::Depth {
                depth,
                follow_boundary,
            } => {
                if self.external_boundary_py.is_empty() {
                    return Err(EngineError::new(
                        "External boundary must be set before using depth parameter",
                    ));
                }
                let max_y = js::math::max_of(&self.external_boundary_py);
                (follow_boundary.unwrap_or(true), Some(max_y - depth), None)
            }
            WaterTableInput::Height {
                height,
                follow_boundary,
            } => (follow_boundary.unwrap_or(true), Some(*height), None),
            WaterTableInput::Custom {
                coordinates,
                follow_boundary,
            } => (follow_boundary.unwrap_or(true), None, Some(coordinates)),
        };

        let mut w: Option<(Vec<f64>, Vec<f64>)> = None;
        if let Some(h) = water_height {
            if self.external_boundary_px.is_empty() {
                return Err(EngineError::new(
                    "External boundary must be set before setting water table",
                ));
            }
            let min_x = js::math::min_of(&self.external_boundary_px);
            let max_x = js::math::max_of(&self.external_boundary_px);
            w = Some((vec![min_x, max_x], vec![h, h]));
        } else if let Some(coords) = water_coords {
            check_water_line(coords)?;
            w = Some((
                coords.iter().map(|c| c[0]).collect(),
                coords.iter().map(|c| c[1]).collect(),
            ));
        }

        // Built first: a line that cannot be built leaves no input behind.
        let line = match &w {
            Some((wx, wy)) => self.build_water_line(wx, wy, follow_boundary)?,
            None => None,
        };
        self.water_input = w.map(|(wx, wy)| WaterLineInput {
            wx,
            wy,
            follow_boundary,
        });
        self.water_rl_xy = line;
        self.water_rl = self.water_rl_xy.is_some();

        self.reset_results();
        Ok(())
    }

    /// Add (or replace) an additional water table that materials can be
    /// assigned to with `assign_material_water_table` (TypeScript's default
    /// `followBoundary` is true).
    pub fn set_water_table_by_id(
        &mut self,
        id: &str,
        coordinates: &[Pt],
        follow_boundary: bool,
    ) -> Result<()> {
        check_water_line(coordinates)?;
        let wx: Vec<f64> = coordinates.iter().map(|c| c[0]).collect();
        let wy: Vec<f64> = coordinates.iter().map(|c| c[1]).collect();
        let line = self.build_water_line(&wx, &wy, follow_boundary)?;
        let input = WaterLineInput {
            wx,
            wy,
            follow_boundary,
        };
        match self.extra_water_inputs.iter_mut().find(|(k, _)| k == id) {
            Some(entry) => entry.1 = input,
            None => self.extra_water_inputs.push((id.to_string(), input)),
        }
        self.set_extra_water_line(id.to_string(), line);
        self.reset_results();
        Ok(())
    }

    /// Make a material use the water table added with the given id.
    /// `id` `None` is TypeScript's `null` (a definition's `waterTableId:
    /// null`): the material counts as having its own water table
    /// (`has_material_water_tables`) but uses the default line.
    pub fn assign_material_water_table<'a>(
        &mut self,
        material: MaterialId,
        id: impl Into<Option<&'a str>>,
    ) {
        let id = id.into().map(str::to_string);
        match self
            .material_water_table
            .iter_mut()
            .find(|(m, _)| *m == material)
        {
            Some(entry) => entry.1 = id,
            None => self.material_water_table.push((material, id)),
        }
        self.reset_results();
    }

    /// Water line used for pore pressure. With `follow_boundary` it never
    /// rises above the ground surface (no ponding).
    fn build_water_line(
        &self,
        wx: &[f64],
        wy: &[f64],
        follow_boundary: bool,
    ) -> Result<Option<Polyline>> {
        if wx.len() < 2 {
            return Ok(None);
        }
        let mut wx = wx.to_vec();
        let mut wy = wy.to_vec();
        // A line entered right to left (e.g. mirrored for a right-to-left
        // model) is reversed first: the sort below is stable, so the points of
        // a vertical step keep their order along the line.
        if wx[0] > wx[wx.len() - 1] {
            wx.reverse();
            wy.reverse();
        }
        // Beyond its end points a piezometric line continues horizontally to
        // the model edges (as is common practice); previously slices past
        // the ends of a short line got no pore pressure at all.
        if self.external_boundary_px.len() >= 3 {
            let mut order: Vec<usize> = (0..wx.len()).collect();
            js::array::sort_by(&mut order, |&a, &b| wx[a] - wx[b]);
            let mut xs: Vec<f64> = order.iter().map(|&i| wx[i]).collect();
            let mut ys: Vec<f64> = order.iter().map(|&i| wy[i]).collect();
            let x_min = js::math::min_of(&self.external_boundary_px);
            let x_max = js::math::max_of(&self.external_boundary_px);
            if xs[0] > x_min {
                xs.insert(0, x_min);
                ys.insert(0, ys[0]);
            }
            if xs[xs.len() - 1] < x_max {
                xs.push(x_max);
                ys.push(ys[ys.len() - 1]);
            }
            wx = xs;
            wy = ys;
        }
        if !follow_boundary {
            return Ok(Some(Polyline { x: wx, y: wy }));
        }
        let Some(surf) = &self.surface_line else {
            return Err(EngineError::new(
                "External boundary must be set before setting water table",
            ));
        };
        Ok(clip_line_to_surface(&wx, &wy, &surf.x, &surf.y))
    }

    /// Remove the water table from the model.
    pub fn remove_water_table(&mut self) {
        self.water_rl = false;
        self.water_rl_xy = None;
        self.water_input = None;
        self.extra_water_inputs.clear();
        self.extra_water_lines.clear();
        self.material_water_table.clear();
        self.reset_results();
    }

    /// Add uniformly distributed loads (UDL); those of magnitude 0 are left out.
    pub fn set_udls(&mut self, udls: Vec<Udl>) {
        for udl in udls {
            if udl.magnitude > 0.0 {
                self.udls.push(udl);
            }
        }
        self.reset_results();
    }

    /// Remove all UDLs.
    pub fn remove_udls(&mut self) {
        self.udls = Vec::new();
        self.reset_results();
    }

    /// Set the line loads (replacing any); those of magnitude 0 are left out.
    pub fn set_line_loads(&mut self, line_loads: Vec<LineLoad>) {
        self.lls = line_loads
            .into_iter()
            .filter(|ll| ll.magnitude > 0.0)
            .collect();
        self.reset_results();
    }

    /// Set the reinforcement (anchors, tiebacks, nails, geosynthetics).
    pub fn set_reinforcements(&mut self, reinforcements: &[Reinforcement]) -> Result<()> {
        let bad = |v: Option<f64>| matches!(v, Some(v) if !(v.is_finite() && v >= 0.0));
        for r in reinforcements {
            let nums = [r.x1, r.y1, r.x2, r.y2, r.tensile_capacity];
            if !nums.iter().all(|v| v.is_finite()) {
                return Err(EngineError::new(
                    "Reinforcement needs finite end points and tensile capacity.",
                ));
            }
            if r.tensile_capacity < 0.0 || bad(r.end1_capacity) || bad(r.end2_capacity) {
                return Err(EngineError::new("Reinforcement capacities must be ≥ 0."));
            }
            if let Some(s) = r.spacing {
                if !(s.is_finite() && s > 0.0) {
                    return Err(EngineError::new("Reinforcement spacing must be > 0."));
                }
            }
            match &r.pullout {
                Some(ReinforcementPullout::Bond {
                    strength,
                    bonded_length,
                }) if !(strength.is_finite() && *strength >= 0.0) || bad(*bonded_length) => {
                    return Err(EngineError::new(
                        "Reinforcement bond strength and bonded length must be ≥ 0.",
                    ));
                }
                Some(ReinforcementPullout::Development { length1, length2 })
                    if bad(Some(*length1)) || bad(Some(*length2)) =>
                {
                    return Err(EngineError::new(
                        "Reinforcement development lengths must be ≥ 0.",
                    ));
                }
                Some(ReinforcementPullout::Interface {
                    adhesion,
                    friction_angle,
                    coverage,
                }) if !(adhesion.is_finite()
                    && *adhesion >= 0.0
                    && friction_angle.is_finite()
                    && *friction_angle >= 0.0
                    && *friction_angle < 90.0)
                    || matches!(coverage, Some(c) if !(c.is_finite() && *c > 0.0)) =>
                {
                    return Err(EngineError::new(
                        "Reinforcement adhesion must be ≥ 0, interface friction angle 0–90° and coverage > 0.",
                    ));
                }
                _ => {}
            }
        }
        // All kept (zero length or capacity carries nothing), so that a force's
        // index is the element's position in the input.
        self.reinforcements = reinforcements.to_vec();
        self.reinforcement_envelopes = OnceLock::new();
        self.reset_results();
        Ok(())
    }

    /// Set the pile rows and sheet pile walls.
    pub fn set_piles(&mut self, piles: &[Pile]) -> Result<()> {
        let bad = |v: Option<f64>, positive: bool| matches!(v, Some(v) if !(v.is_finite() && (if positive { v > 0.0 } else { v >= 0.0 })));
        for p in piles {
            if ![p.x1, p.y1, p.x2, p.y2].iter().all(|v| v.is_finite()) {
                return Err(EngineError::new(
                    "A pile needs finite head and tip coordinates.",
                ));
            }
            if bad(p.force, false)
                || bad(p.shear_capacity, false)
                || bad(p.moment_capacity, false)
                || bad(p.spacing, true)
                || bad(p.diameter, true)
            {
                return Err(EngineError::new(
                    "Pile force and capacities must be ≥ 0, spacing and diameter > 0.",
                ));
            }
            if bad(p.bending_stiffness, true) || bad(p.axial_stiffness, true) {
                return Err(EngineError::new(
                    "Pile bending and axial stiffness must be > 0.",
                ));
            }
            if let Some(a) = p.angle {
                if !(a.is_finite() && a.abs() < 90.0) {
                    return Err(EngineError::new(
                        "Pile force angle must be between −90° and 90°.",
                    ));
                }
            }
            if matches!(p.direction, Some(PileForceDirection::Other(_))) {
                return Err(EngineError::new(
                    "Pile force direction must be 'angle', 'tangent' or 'perpendicular'.",
                ));
            }
            if p.force.is_none() {
                let Some(diameter) = p.diameter else {
                    return Err(EngineError::new(
                        "A pile needs a shear force, or a diameter for Ito & Matsui.",
                    ));
                };
                if (p.x2 - p.x1).abs() > 1e-6 {
                    return Err(EngineError::new(
                        "Ito & Matsui needs a vertical pile; give the shear force of an inclined pile.",
                    ));
                }
                if !(p.spacing.unwrap_or(1.0) > diameter) {
                    return Err(EngineError::new(
                        "Ito & Matsui needs a spacing larger than the pile diameter (soil between the piles).",
                    ));
                }
            }
        }
        self.piles = piles.to_vec();
        self.reset_results();
        Ok(())
    }

    /// Remove all line loads.
    pub fn remove_line_loads(&mut self) {
        self.lls = Vec::new();
        self.reset_results();
    }

    /// Update analysis options. (TypeScript's checks of an unknown `method`,
    /// `porePressureHead`, `searchMethod` and `intersliceFunction` are made
    /// by deserialization here: they are enums.)
    pub fn update_analysis_options(&mut self, opts: &AnalysisOptionsPatch) -> Result<()> {
        self.options_given = self.options_given.merged(opts);
        self.version += 1;
        // (the state before drawdown is static: no seismic load)
        if let Some(b) = self.drawdown_before.as_deref_mut() {
            b.update_analysis_options(&AnalysisOptionsPatch {
                seismic_horizontal: Some(0.0),
                seismic_vertical: Some(0.0),
                ..opts.clone()
            })?;
        }
        // A NaN count or tolerance passed the clamps below unchanged and gave a
        // different analysis (or none) without an error.
        for (key, v) in [
            ("slices", opts.slices),
            ("iterations", opts.iterations),
            ("refinedIterations", opts.refined_iterations),
            ("maxIterations", opts.max_iterations),
            ("tolerance", opts.tolerance),
            ("minFailureDist", opts.min_failure_dist),
        ] {
            if matches!(v, Some(v) if !v.is_finite()) {
                return Err(EngineError::new(format!(
                    "Analysis option {key} must be a finite number."
                )));
            }
        }
        if matches!(opts.tolerance, Some(t) if !(t > 0.0)) {
            return Err(EngineError::new(
                "Analysis option tolerance must be positive.",
            ));
        }
        if let Some(m) = &opts.method {
            let OrOther::Known(m) = m else {
                return Err(EngineError::new(
                    "Method must be one of 'Bishop', 'Janbu', or 'Morgenstern-Price'",
                ));
            };
            self.method = *m;
        }
        if let Some(s) = opts.slices {
            self.slices = js::math::max(
                SLICES_RANGE.min,
                js::math::min(SLICES_RANGE.max, js::math::round(s)),
            );
        }
        if let Some(it) = opts.iterations {
            self.iterations = js::math::max(
                ITERATIONS_RANGE.min,
                js::math::min(ITERATIONS_RANGE.max, it),
            );
        }
        if let Some(it) = opts.refined_iterations {
            self.refined_iterations = js::math::max(
                REFINED_ITERATIONS_RANGE.min,
                js::math::min(REFINED_ITERATIONS_RANGE.max, it),
            );
        }
        if let Some(d) = opts.min_failure_dist {
            self.min_failure_distance = js::math::min(d, self.external_length * 0.9);
        }
        if let Some(t) = opts.tolerance {
            self.tolerance = t;
        }
        if let Some(m) = opts.max_iterations {
            // The solvers require more than 3 inner iterations before accepting
            // convergence; fewer would discard every surface.
            self.max_iterations = js::math::max(MIN_MAX_ITERATIONS, m);
        }
        if let Some(j) = opts.janbu_correction {
            self.janbu_correction = j;
        }
        if let Some(h) = &opts.pore_pressure_head {
            let OrOther::Known(h) = h else {
                return Err(EngineError::new(
                    "porePressureHead must be 'phreatic-correction' or 'vertical'",
                ));
            };
            self.pore_pressure_head = *h;
        }
        if let Some(d) = opts.tension_crack_depth {
            if !d.is_finite() || d < 0.0 {
                return Err(EngineError::new("tensionCrackDepth must be a number ≥ 0"));
            }
            self.tension_crack_depth = d;
        }
        if let Some(a) = opts.tension_crack_auto {
            self.tension_crack_auto = a;
        }
        if let Some(c) = opts.composite_surfaces {
            self.composite_surfaces = c;
        }
        if let Some(c) = opts.composite_base {
            self.composite_base = c;
            // (TypeScript's cache is keyed on compositeBase, so a later error
            // in these options cannot leave a stale floor)
            self.composite_floor = OnceLock::new();
        }
        for (k, v) in [
            ("seismicHorizontal", opts.seismic_horizontal),
            ("seismicVertical", opts.seismic_vertical),
        ] {
            let Some(v) = v else { continue };
            if !v.is_finite() || v.abs() > 1.0 {
                return Err(EngineError::new(format!(
                    "{k} must be a number between −1 and 1"
                )));
            }
            if k == "seismicHorizontal" {
                self.seismic_horizontal = v;
            } else {
                self.seismic_vertical = v;
            }
        }
        if let Some(a) = opts.tension_crack_angle {
            if !a.is_finite() || a < 0.0 || a >= 90.0 {
                return Err(EngineError::new(
                    "tensionCrackAngle must be ≥ 0 and less than 90°",
                ));
            }
            self.tension_crack_angle = a;
        }
        if let Some(w) = opts.tension_crack_water {
            if !w.is_finite() || w < 0.0 || w > 1.0 {
                return Err(EngineError::new(
                    "tensionCrackWater must be between 0 and 1",
                ));
            }
            self.tension_crack_water = w;
        }
        if let Some(n) = opts.non_circular_optimization {
            self.non_circular_optimization = n;
        }
        if let Some(s) = &opts.search_method {
            let OrOther::Known(s) = s else {
                return Err(EngineError::new(
                    "searchMethod must be 'circular' or 'block'",
                ));
            };
            self.search_method = *s;
        }
        let angle_range = |name: &str, r: &AngleRangePatch| -> Result<Option<[f64; 2]>> {
            let [lo, hi] = match r {
                AngleRangePatch::Null => return Ok(None),
                AngleRangePatch::Range(r) => *r,
                AngleRangePatch::NotIterable(_) => {
                    return Err(EngineError::type_error("r is not iterable"))
                }
            };
            if !(lo.is_finite() && hi.is_finite() && lo > 0.0 && hi < 90.0 && lo <= hi) {
                return Err(EngineError::new(format!(
                    "{name} must be a range [min, max] with 0° < min ≤ max < 90°"
                )));
            }
            Ok(Some([lo, hi]))
        };
        if let Some(r) = &opts.block_active_angle {
            self.block_active_angle = angle_range("blockActiveAngle", r)?;
        }
        if let Some(r) = &opts.block_passive_angle {
            self.block_passive_angle = angle_range("blockPassiveAngle", r)?;
        }
        if let Some(d) = opts.min_slip_depth {
            if !d.is_finite() || d < 0.0 {
                return Err(EngineError::new("minSlipDepth must be a number ≥ 0"));
            }
            self.min_slip_depth = d;
        }
        if let Some(a) = opts.min_slip_area {
            // null (older projects: automatic) is no limit, as 0.
            let a = a.unwrap_or(0.0);
            if !a.is_finite() || a < 0.0 {
                return Err(EngineError::new("minSlipArea must be a number ≥ 0 or null"));
            }
            self.min_slip_area = a;
        }
        if let Some(f) = &opts.partial_factors {
            if let Some(f) = f {
                if ![f.cu, f.cohesion, f.tan_phi, f.variable_load]
                    .iter()
                    .all(|&v| v.is_finite() && v > 0.0)
                {
                    return Err(EngineError::new("Partial factors must be positive numbers"));
                }
            }
            self.partial_factors = f.clone();
        }
        if let Some(f) = &opts.interslice_function {
            let OrOther::Known(f) = f else {
                return Err(EngineError::new(
                    "intersliceFunction must be one of 'constant', 'half-sine', 'clipped-sine', 'trapezoidal', or 'data-point-specified'",
                ));
            };
            self.interslice_function = *f;
        }
        match &opts.interslice_data_points {
            None => {}
            Some(IntersliceDataPointsPatch::Points(points)) => {
                self.interslice_data_points = points
                    .iter()
                    .filter(|p| p[0].is_finite() && p[1].is_finite())
                    .copied()
                    .collect();
            }
            // `opts.intersliceDataPoints.filter(…)` on a value that is not a list
            Some(IntersliceDataPointsPatch::NotAList(v)) => {
                return Err(EngineError::type_error(match v {
                    serde_json::Value::Null => {
                        "Cannot read properties of null (reading 'filter')".to_string()
                    }
                    _ => "opts.intersliceDataPoints.filter is not a function".to_string(),
                }));
            }
        }
        self.reset_results();
        Ok(())
    }

    /// Set analysis limits for the search area.
    pub fn set_analysis_limits(&mut self, limits: &AnalysisLimitsPatch) {
        let entry_left_provided = limits.entry_left_x.is_some();
        let entry_right_provided = limits.entry_right_x.is_some();
        let exit_left_provided = limits.exit_left_x.is_some();
        let exit_right_provided = limits.exit_right_x.is_some();

        let mut entry_left_x = limits.entry_left_x.unwrap_or(self.limits[0]);
        let mut entry_right_x = limits.entry_right_x.unwrap_or(self.limits[1]);
        let mut exit_left_x = limits.exit_left_x.unwrap_or(self.limits[2]);
        let mut exit_right_x = limits.exit_right_x.unwrap_or(self.limits[3]);

        // If only one bound of a pair was provided, set the other to match
        if entry_left_provided && !entry_right_provided {
            entry_right_x = entry_left_x;
        }
        if exit_left_provided && !exit_right_provided {
            exit_right_x = exit_left_x;
        }

        // Ensure correct order
        if entry_left_x > entry_right_x {
            std::mem::swap(&mut entry_left_x, &mut entry_right_x);
        }
        if exit_left_x > exit_right_x {
            std::mem::swap(&mut exit_left_x, &mut exit_right_x);
        }

        self.limits = [entry_left_x, entry_right_x, exit_left_x, exit_right_x];
        self.reset_results();
    }

    /// Reset analysis limits to search the entire slope.
    pub fn remove_analysis_limits(&mut self) -> Result<()> {
        let Some(surf) = &self.surface_line else {
            return Err(EngineError::new("Surface line is not defined"));
        };
        let min_x = js::math::min_of(&surf.x);
        let max_x = js::math::max_of(&surf.x);
        self.set_analysis_limits(&AnalysisLimitsPatch {
            entry_left_x: Some(min_x),
            entry_right_x: Some(max_x),
            exit_left_x: Some(min_x),
            exit_right_x: Some(max_x),
        });
        self.reset_results();
        Ok(())
    }

    /// Specify fixed x-coordinates for slice boundaries.
    pub fn add_fixed_slices(&mut self, x: &[f64]) {
        self.fixed_slices = Some(x.to_vec());
        self.reset_results();
    }

    /// Clear all manually added individual failure surfaces.
    pub fn remove_individual_planes(&mut self) {
        self.individual_planes = Vec::new();
        self.custom_plane_rejections = Vec::new();
        self.reset_results();
    }

    // ────────────────────────────────────────────────────────────────
    // Query methods
    // ────────────────────────────────────────────────────────────────

    /// Get the y-coordinate of the slope surface at a given x.
    pub fn get_external_y_intersection(&self, x: f64) -> Result<f64> {
        let Some(surf) = &self.surface_line else {
            return Err(EngineError::new("Surface line coordinates are not defined"));
        };
        Ok(get_y_at_x(&surf.x, &surf.y, x))
    }

    /// Check whether a point lies inside the external boundary polygon.
    pub fn is_inside_external_boundary(&self, x: f64, y: f64) -> bool {
        if self.external_boundary_px.len() < 3 || self.external_boundary_py.len() < 3 {
            return false;
        }
        is_point_in_polygon(x, y, &self.external_boundary_px, &self.external_boundary_py)
    }

    /// Get the y-coordinate of the water table at a given x.
    pub fn get_water_y_intersection(&self, x: f64) -> Result<f64> {
        let Some(w) = &self.water_rl_xy else {
            return Err(EngineError::new("Water table coordinates are not defined"));
        };
        Ok(get_y_at_x(&w.x, &w.y, x))
    }

    /// Get intersection points of a circle with the external boundary surface.
    /// Returns sorted by x-coordinate.
    pub fn get_circle_external_intersection(
        &self,
        cx: f64,
        cy: f64,
        radius: f64,
    ) -> Result<Vec<Pt>> {
        let Some(surf) = &self.surface_line else {
            return Err(EngineError::new("Surface line is not defined"));
        };
        let mut intersections = get_circle_line_intersections(cx, cy, radius, &surf.x, &surf.y);
        // Sort by x-coordinate. A circle through a surface vertex is found on
        // both adjacent segments; drop the duplicate or the plane's entry and
        // exit collapse into one point and the plane is discarded.
        js::array::sort_by(&mut intersections, |a, b| a[0] - b[0]);
        // (in place; each point is compared with the one before it in the
        // sorted list, kept or not, as TypeScript's filter does)
        let mut kept = 0;
        let mut previous: Option<Pt> = None;
        for i in 0..intersections.len() {
            let p = intersections[i];
            if previous.is_none_or(|q| (p[0] - q[0]).abs() > 1e-9 || (p[1] - q[1]).abs() > 1e-9) {
                intersections[kept] = p;
                kept += 1;
            }
            previous = Some(p);
        }
        intersections.truncate(kept);
        Ok(intersections)
    }

    /// Get the minimum factor of safety from the analysis results.
    pub fn get_min_fos(&self) -> Result<f64> {
        self.search
            .iter()
            .find_map(|p| p.fos)
            .ok_or_else(|| EngineError::new("No analysis results available"))
    }

    /// Get the maximum factor of safety from the analysis results.
    pub fn get_max_fos(&self) -> Result<f64> {
        self.search
            .iter()
            .rev()
            .find_map(|p| p.fos)
            .ok_or_else(|| EngineError::new("No analysis results available"))
    }

    /// Get the critical failure surface circle properties (cx, cy, radius).
    pub fn get_min_fos_circle(&self) -> Result<(f64, f64, f64)> {
        let Some(s) = self.search.first() else {
            return Err(EngineError::new("No analysis results available"));
        };
        Ok((s.cx, s.cy, s.radius))
    }

    /// Get the entry and exit points of the critical failure surface.
    pub fn get_min_fos_end_points(&self) -> Result<(Pt, Pt)> {
        let Some(s) = self.search.first() else {
            return Err(EngineError::new("No analysis results available"));
        };
        Ok((s.lc, s.rc))
    }

    // ────────────────────────────────────────────────────────────────
    // Internal
    // ────────────────────────────────────────────────────────────────

    /// Material models were changed in place (e.g. Monte Carlo samples): drop
    /// what depends on them. (See also `set_material_model`.)
    pub fn materials_changed(&mut self) {
        self.reset_results();
    }

    fn reset_results(&mut self) {
        self.search = Vec::new();
        // materials can change in place (assignMaterial): the floor with them
        self.composite_floor = OnceLock::new();
        // Pullout from the overburden and the pile pressures depend on geometry,
        // materials, water and the partial factors.
        self.reinforcement_envelopes = OnceLock::new();
        self.pile_profiles = OnceLock::new();
        // The geometry caches of surface.rs and search.rs (WeakMaps keyed on
        // the geometry there): every change of the geometry or its materials
        // comes through here.
        self.below_ground = OnceLock::new();
        self.material_interfaces = OnceLock::new();
        self.version += 1;
    }
}

impl std::fmt::Display for Slope {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Slope")
    }
}
