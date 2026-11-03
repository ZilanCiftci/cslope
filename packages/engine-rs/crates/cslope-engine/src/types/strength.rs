//! Port of packages/engine/src/types/strength.ts
//!
//! Unified strength resolution for all material models.
//!
//! `resolve_strength` is the SINGLE dispatch point that maps a
//! `MaterialModel` + geometric context → effective c / φ for a slice.
//! Solvers and the slice builder never inspect the model kind directly;
//! they only consume the `ResolvedStrength` output.

use crate::error::{EngineError, Result};
use crate::js;
use crate::math::interpolation::{interpolate_idw, interpolate_nearest, SpatialDataPoint};
use crate::math::spline::{cubic_spline, eval_spline};
use crate::types::analysis::PartialFactors;
use crate::types::hoek_brown::{
    hoek_brown_of, instantaneous_at_normal_stress, CohesionFriction, HoekBrownParameters,
};
use crate::types::material_models::{
    is_combined_depth_model, suction_angle, AnisotropicFunctionModel, DepthReference,
    LimeCementColumnModel, MaterialModel, MohrCoulombModel, ShansepModel, ShearNormalModel,
    SpatialInterpolation, SpatialMohrCoulombModel, StrengthFromDatumModel, StrengthFromDepthModel,
    TableSpline, UndrainedModel,
};
use serde::{Deserialize, Serialize, Serializer};
use std::f64::consts::PI;
use std::sync::Arc;

// ── Result type ────────────────────────────────────────────────

/// Effective shear-strength parameters resolved for one slice.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedStrength {
    /// Effective cohesion for this slice (kPa).
    pub cohesion: f64,
    /// Effective friction angle for this slice (°).
    pub friction_angle: f64,
    /// Undrained cohesion for Combined-method FOS (kPa).
    pub cohesion_undrained: f64,
    /// Part of `cohesion` that is an undrained shear strength, so takes γcu
    /// when design values are formed; the rest is drained c′ (γc′). Set by
    /// lime-cement columns in their drained limit, whose cohesion
    /// (1 − a)·cu,soil + a·c′ mixes the two. Not set: 0.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cohesion_undrained_part: Option<f64>,
    /// Part of `cohesion` (kPa) that is strength from matric suction,
    /// min(suction, maxSuction)·tan φb (`UnsaturatedStrength`): drained, so
    /// it takes γc′ when design values are formed, also on a material
    /// entered with φ = 0. Not set: 0.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suction_strength: Option<f64>,
    /// When `true`, any slip surface passing through this material
    /// should be treated as infinitely stable (FOS → ∞) and excluded
    /// from the critical-surface search.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skip_surface: Option<bool>,
    /// When `true`, the slip surface is not permitted to enter this
    /// material. The slice builder should return no slice.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub impenetrable: Option<bool>,
    /// When `true`, the solver should use the Combined method:
    /// resistance = min(drained, undrained).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_combined: Option<bool>,
    /// A Hoek–Brown rock mass: c and φ are its instantaneous parameters at an
    /// estimate of the normal stress (the overburden), which the analyses
    /// update from the stress they find (types/hoek_brown.rs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hoek_brown: Option<HoekBrownParameters>,
    /// A shear-normal function: its tangent c, φ are updated like Hoek-Brown's.
    /// The model shared (TypeScript refers to it; PORTING.md, Decisions).
    #[serde(
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_shear_normal"
    )]
    pub shear_normal: Option<Arc<ShearNormalModel>>,
}

/// The shear-normal model with its `kind`, as TypeScript's object has it.
fn serialize_shear_normal<S: Serializer>(
    m: &Option<Arc<ShearNormalModel>>,
    s: S,
) -> std::result::Result<S::Ok, S::Error> {
    m.as_ref()
        .map(|m| MaterialModel::ShearNormal((**m).clone()))
        .serialize(s)
}

impl ResolvedStrength {
    fn plain(cohesion: f64, friction_angle: f64, cohesion_undrained: f64) -> Self {
        ResolvedStrength {
            cohesion,
            friction_angle,
            cohesion_undrained,
            ..Default::default()
        }
    }
}

// ── Context supplied by the slice builder ──────────────────────

/// Geometric context available at the time of slice creation.
#[derive(Debug, Clone, Copy, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrengthContext {
    /// Y-coordinate of the slice base (elevation).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y_bottom: f64,
    /// X-coordinate of the slice midpoint.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x: f64,
    /// Ground-surface Y at this x-coordinate.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub y_ground: f64,
    /// Y of the top of the base material's layer at this x: the highest point
    /// of the region of that material directly above the base (see
    /// `materialLayerTopAt`). Only needed by models measuring depth from the
    /// top of the layer (`needs_layer_top`); not set: the ground (`y_ground`).
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub y_layer_top: Option<f64>,
    /// Base inclination angle α (rad).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub alpha: f64,
    /// Matric suction ua − uw at the point (kPa, ≥ 0): the negative pore
    /// pressure above the material's water line, for materials with φb
    /// (`UnsaturatedStrength`). Not set: 0, no suction strength.
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub suction: Option<f64>,
    /// Effective vertical stress at the base (kPa), for SHANSEP: the slice's
    /// weight and loads per unit width less the pore pressure. Not set: the
    /// overburden γ·(ground − base) of the model's unit weight.
    #[serde(default, deserialize_with = "crate::types::json::opt_num")]
    pub effective_vertical_stress: Option<f64>,
}

// ── Resolver ───────────────────────────────────────────────────

/// Whether resolving `model` uses `StrengthContext::y_layer_top`, so callers
/// only search the layer top when it matters.
pub fn needs_layer_top(model: &MaterialModel) -> bool {
    matches!(model, MaterialModel::StrengthFromDepth(m) if m.depth_reference == Some(DepthReference::LayerTop))
}

/// Resolve effective shear-strength parameters for a single slice: c, φ
/// (and flags) for the solver, from the material model assigned to the
/// slice base and the geometric context from the slice builder.
pub fn resolve_strength(
    model: &MaterialModel,
    context: &StrengthContext,
) -> Result<ResolvedStrength> {
    let mut r = resolve_model_strength(model, context)?;
    let suction = context.suction.unwrap_or(0.0);
    if !(suction > 0.0) {
        return Ok(r);
    }
    let ss = suction_strength(model, suction);
    if !(ss > 0.0) {
        return Ok(r);
    }
    // like an apparent cohesion on the drained strength (for a combined
    // material its drained branch; the undrained Su is unchanged)
    r.cohesion += ss;
    r.suction_strength = Some(ss);
    Ok(r)
}

/// Strength from matric suction (kPa): min(suction, maxSuction)·tan φb for
/// a material with φb (`UnsaturatedStrength`), else 0.
pub fn suction_strength(model: &MaterialModel, suction: f64) -> f64 {
    let phi_b = suction_angle(model);
    if !(phi_b > 0.0) || !(suction > 0.0) {
        return 0.0;
    }
    let s = match model.base().max_suction {
        Some(cap) if cap.is_finite() && cap > 0.0 => js::math::min(suction, cap),
        _ => suction,
    };
    s * js::math::tan((phi_b * PI) / 180.0)
}

fn resolve_model_strength(
    model: &MaterialModel,
    context: &StrengthContext,
) -> Result<ResolvedStrength> {
    Ok(match model {
        // ── Mohr-Coulomb (current default) ───────────────────────
        MaterialModel::MohrCoulomb(m) => resolve_mohr_coulomb(m, context),

        // ── Undrained (φ = 0, c = Su) ────────────────────────────
        MaterialModel::Undrained(m) => with_anisotropy(
            m.anisotropy.as_deref(),
            resolve_undrained(m, context),
            context,
        ),

        // ── High Strength ────────────────────────────────────────
        MaterialModel::HighStrength(_) => ResolvedStrength {
            skip_surface: Some(true),
            ..ResolvedStrength::plain(f64::INFINITY, 90.0, f64::INFINITY)
        },

        // ── Impenetrable (Bedrock) ───────────────────────────────
        MaterialModel::Impenetrable(_) => ResolvedStrength {
            impenetrable: Some(true),
            ..ResolvedStrength::plain(0.0, 0.0, 0.0)
        },

        // ── Spatial Mohr-Coulomb ─────────────────────────────────
        MaterialModel::SpatialMohrCoulomb(m) => resolve_spatial_mohr_coulomb(m, context),

        // ── Anisotropic Function ─────────────────────────────────
        MaterialModel::AnisotropicFunction(m) => resolve_anisotropic(m, context),

        // ── S = f(depth) ─────────────────────────────────────────
        MaterialModel::StrengthFromDepth(m) => with_anisotropy(
            m.anisotropy.as_deref(),
            resolve_strength_from_depth(model, m, context),
            context,
        ),

        MaterialModel::LimeCementColumns(m) => resolve_lime_cement_columns(m, context),

        // ── S = f(datum) ─────────────────────────────────────────
        MaterialModel::StrengthFromDatum(m) => with_anisotropy(
            m.anisotropy.as_deref(),
            resolve_strength_from_datum(m, context),
            context,
        ),

        MaterialModel::ShearNormal(m) => {
            // first estimate of the normal stress: the overburden, as Hoek-Brown
            let depth = js::math::max(0.0, context.y_ground - context.y_bottom);
            let sn = m.base.unit_weight * depth * js::math::pow(js::math::cos(context.alpha), 2.0);
            let t = shear_normal_at(&m.points, m.spline.as_ref(), sn);
            ResolvedStrength {
                shear_normal: Some(Arc::new(m.clone())),
                ..ResolvedStrength::plain(t.cohesion, t.friction_angle, t.cohesion)
            }
        }

        MaterialModel::Shansep(m) => with_anisotropy(
            m.anisotropy.as_deref(),
            resolve_shansep(m, context),
            context,
        ),

        // ── Generalised Hoek–Brown ───────────────────────────────
        MaterialModel::HoekBrown(m) => {
            // first estimate of the normal stress on the base: the overburden
            // γ·depth·cos²α (no pore pressure); the analyses refine it
            let hb = hoek_brown_of(m);
            let depth = js::math::max(0.0, context.y_ground - context.y_bottom);
            let sn = m.base.unit_weight * depth * js::math::pow(js::math::cos(context.alpha), 2.0);
            let inst = instantaneous_at_normal_stress(&hb, sn);
            ResolvedStrength {
                hoek_brown: Some(hb),
                ..ResolvedStrength::plain(inst.cohesion, inst.friction_angle, inst.cohesion)
            }
        }

        MaterialModel::Unknown(m) => {
            return Err(EngineError::new(format!(
                "Unknown material model kind: {}",
                m.kind
            )));
        }
    })
}

// ── Per-model resolvers ────────────────────────────────────────

fn resolve_mohr_coulomb(model: &MohrCoulombModel, context: &StrengthContext) -> ResolvedStrength {
    let ref_depth = model.cohesion_ref_depth.unwrap_or(0.0);
    let rate_of_change = model.cohesion_rate_of_change.unwrap_or(0.0);
    let base_cohesion = model.cohesion + (ref_depth - context.y_bottom) * rate_of_change;

    let c_factor = model.c_factor.unwrap_or(0.0);
    let cohesion = non_negative(if c_factor != 0.0 {
        base_cohesion * c_factor
    } else {
        base_cohesion
    });

    // Undrained cohesion (used by Combined method)
    let cohesion_undrained = non_negative(
        model.cohesion_undrained.unwrap_or(model.cohesion)
            + (ref_depth - context.y_bottom) * rate_of_change,
    );

    ResolvedStrength {
        is_combined: Some(c_factor != 0.0),
        ..ResolvedStrength::plain(cohesion, model.friction_angle, cohesion_undrained)
    }
}

fn resolve_lime_cement_columns(
    model: &LimeCementColumnModel,
    context: &StrengthContext,
) -> ResolvedStrength {
    let rate = model.su_rate_of_change.unwrap_or(0.0);
    let soil = apply_cutoff(
        non_negative(model.soil_su + (model.su_ref_depth.unwrap_or(0.0) - context.y_bottom) * rate),
        rate,
        model.su_max,
    );
    let a = js::math::min(1.0, js::math::max(0.0, model.area_ratio));
    let undrained = a * model.column_su + (1.0 - a) * soil;
    let (Some(column_cohesion), Some(column_friction_angle)) =
        (model.column_cohesion, model.column_friction_angle)
    else {
        return ResolvedStrength::plain(undrained, 0.0, undrained);
    };
    // min over the column part: a·min(c′ + σ′ tan φ′, cu,col) + (1 − a)·cu,soil
    // = min((1 − a)·cu,soil + a·c′ + σ′·a·tan φ′, undrained): a combined
    // material with these drained parameters.
    let tan_phi = a * js::math::tan((column_friction_angle * PI) / 180.0);
    ResolvedStrength {
        cohesion: (1.0 - a) * soil + a * column_cohesion,
        // The soil between the columns stays undrained: it takes γcu, the
        // columns' c′ γc′ (design_strength).
        cohesion_undrained_part: Some((1.0 - a) * soil),
        friction_angle: (js::math::atan(tan_phi) * 180.0) / PI,
        cohesion_undrained: undrained,
        is_combined: Some(true),
        ..Default::default()
    }
}

fn resolve_undrained(model: &UndrainedModel, context: &StrengthContext) -> ResolvedStrength {
    let ref_depth = model.su_ref_depth.unwrap_or(0.0);
    let rate = model.su_rate_of_change.unwrap_or(0.0);
    let su = apply_cutoff(
        non_negative(model.undrained_shear_strength + (ref_depth - context.y_bottom) * rate),
        rate,
        model.su_max,
    );

    ResolvedStrength::plain(su, 0.0, su)
}

/// Design shear strength at one point (see `design_strength`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignStrength {
    /// Cohesion of the drained (or only) branch (kPa).
    pub cohesion: f64,
    /// tan φ of the drained (or only) branch.
    pub tan_phi: f64,
    /// Undrained strength, the other branch of a combined material (kPa).
    pub cohesion_undrained: f64,
    /// The only strength is undrained (total stress, φ = 0): Su,
    /// S = f(depth/datum), undrained lime-cement columns and any model
    /// entered with φ = 0, the common way to give undrained clay as
    /// Mohr-Coulomb.
    pub undrained: bool,
}

/// Design strength: each characteristic parameter divided by its own
/// partial factor, as EN 1997-1 (2004) 2.4.6.2 and Annex A set them per
/// parameter: γcu on undrained shear strength, γc′ on effective cohesion,
/// γφ′ on tan φ′. A strength summed from parts of both kinds factors each
/// part on its own: lime-cement columns in their drained limit,
/// (1 − a)·cu,soil + a·c′col, give (1 − a)·cu,soil/γcu + a·c′col/γc′ (the
/// composite strength of soil and columns in the Swedish guidance on deep
/// mixing, SGF Report 2:2000 and TK Geo 13, with the Eurocode factor of
/// each part). The undrained branch of a combined material takes γcu.
/// Strength from matric suction (φb) is drained and takes γc′ like c′,
/// also on a Mohr-Coulomb material entered with φ = 0.
/// Without factors (and for high-strength and bedrock) the characteristic
/// values are returned.
///
/// The one place design strength is formed: the slices, the Rankine crack
/// depth and the Ito & Matsui pile pressure all use it. `st` is read for
/// cohesion, friction angle, undrained cohesion, `is_combined`,
/// `cohesion_undrained_part` and `suction_strength` only.
pub fn design_strength(
    kind: Option<&str>,
    st: &ResolvedStrength,
    f: Option<&PartialFactors>,
) -> DesignStrength {
    let combined = st.is_combined.unwrap_or(false);
    let undrained = kind == Some("undrained")
        || (kind == Some("s-f-depth") && !combined)
        || kind == Some("s-f-datum")
        || kind == Some("shansep")
        || (st.friction_angle == 0.0
            && !combined
            && kind != Some("shear-normal")
            && kind != Some("hoek-brown"));
    let tan_phi = if undrained {
        0.0
    } else {
        js::math::tan((st.friction_angle * PI) / 180.0)
    };
    let f = match f {
        Some(f) if kind != Some("high-strength") && kind != Some("impenetrable") => f,
        _ => {
            return DesignStrength {
                cohesion: st.cohesion,
                tan_phi,
                cohesion_undrained: st.cohesion_undrained,
                undrained,
            }
        }
    };
    let cohesion_undrained = st.cohesion_undrained / f.cu;
    if undrained {
        // a Mohr-Coulomb material with φ = 0 and φb: its suction strength is drained (γc′)
        let ss = js::math::min(st.cohesion, st.suction_strength.unwrap_or(0.0));
        return DesignStrength {
            cohesion: (st.cohesion - ss) / f.cu + ss / f.cohesion,
            tan_phi,
            cohesion_undrained,
            undrained,
        };
    }
    let part = js::math::min(st.cohesion, st.cohesion_undrained_part.unwrap_or(0.0));
    DesignStrength {
        cohesion: part / f.cu + (st.cohesion - part) / f.cohesion,
        tan_phi: tan_phi / f.tan_phi,
        cohesion_undrained,
        undrained,
    }
}

/// Unit weight at a point (kN/m³).
///
/// Only the spatial Mohr-Coulomb model varies γ: it is interpolated from
/// the data points that give a positive γ, the same way as c and φ.
/// Every other model (and a spatial model without γ data) uses
/// `fallback`, the material's own unit weight.
pub fn resolve_unit_weight(model: &MaterialModel, fallback: f64, x: f64, y: f64) -> f64 {
    let MaterialModel::SpatialMohrCoulomb(model) = model else {
        return fallback;
    };
    let points: Vec<SpatialDataPoint> = model
        .data_points
        .iter()
        .filter(|p| p[4].is_finite() && p[4] > 0.0)
        .map(|p| SpatialDataPoint {
            x: p[0],
            y: p[1],
            values: vec![p[4]],
        })
        .collect();
    if points.is_empty() {
        return fallback;
    }
    let result = match model.interpolation {
        Some(SpatialInterpolation::Nearest) => interpolate_nearest(&points, x, y),
        Some(SpatialInterpolation::Linear) => interpolate_idw(&points, x, y, 1.0, 1e-10),
        _ => interpolate_idw(&points, x, y, 2.0, 1e-10),
    };
    result[0]
}

fn resolve_spatial_mohr_coulomb(
    model: &SpatialMohrCoulombModel,
    context: &StrengthContext,
) -> ResolvedStrength {
    if model.data_points.is_empty() {
        return ResolvedStrength::plain(0.0, 0.0, 0.0);
    }

    // Convert tuples to SpatialDataPoint format: values = [c, φ]
    let points: Vec<SpatialDataPoint> = model
        .data_points
        .iter()
        .map(|p| SpatialDataPoint {
            x: p[0],
            y: p[1],
            values: vec![p[2], p[3]],
        })
        .collect();

    let result = match &model.interpolation {
        Some(SpatialInterpolation::Nearest) => {
            interpolate_nearest(&points, context.x, context.y_bottom)
        }
        // Both "idw" and "linear" use IDW; linear is treated as IDW(p=1).
        Some(SpatialInterpolation::Linear) => {
            interpolate_idw(&points, context.x, context.y_bottom, 1.0, 1e-10)
        }
        // "idw", not set, and (the exhaustiveness fallback) any other string
        _ => interpolate_idw(&points, context.x, context.y_bottom, 2.0, 1e-10),
    };

    let (c, phi) = (result[0], result[1]);
    ResolvedStrength::plain(
        non_negative(c),
        physical_friction_angle(phi),
        non_negative(c),
    )
}

/// An undrained model's anisotropy (`anisotropy`, see material_models.rs):
/// its Su, which is the cohesion with φ = 0, times the factor at the base
/// inclination α. A cutoff applies to Su before the factor, as the factor
/// describes the direction of shearing, not the soil at the base.
fn with_anisotropy(
    anisotropy: Option<&[[f64; 2]]>,
    r: ResolvedStrength,
    context: &StrengthContext,
) -> ResolvedStrength {
    let Some(anisotropy) = anisotropy.filter(|a| !a.is_empty()) else {
        return r;
    };
    let f = interpolate_modifier(anisotropy, (context.alpha * 180.0) / PI);
    // a combined material: the anisotropy belongs to Su, not to the drained c′
    if r.is_combined == Some(true) {
        return ResolvedStrength {
            cohesion_undrained: non_negative(r.cohesion_undrained * f),
            ..r
        };
    }
    ResolvedStrength {
        cohesion: non_negative(r.cohesion * f),
        cohesion_undrained: non_negative(r.cohesion_undrained * f),
        ..r
    }
}

fn resolve_anisotropic(
    model: &AnisotropicFunctionModel,
    context: &StrengthContext,
) -> ResolvedStrength {
    let alpha_deg = (context.alpha * 180.0) / PI;
    let factor = interpolate_modifier(&model.modifier_function, alpha_deg);

    ResolvedStrength::plain(
        non_negative(model.cohesion * factor),
        physical_friction_angle(model.friction_angle * factor),
        non_negative(model.cohesion * factor),
    )
}

fn resolve_strength_from_depth(
    whole: &MaterialModel,
    model: &StrengthFromDepthModel,
    context: &StrengthContext,
) -> ResolvedStrength {
    let y_top = if model.depth_reference == Some(DepthReference::LayerTop) {
        context.y_layer_top.unwrap_or(context.y_ground)
    } else {
        context.y_ground
    };
    let depth = y_top - context.y_bottom;
    let su = apply_cutoff(
        non_negative(model.su_ref + (depth - model.depth_ref) * model.rate),
        model.rate,
        model.su_max,
    );

    if is_combined_depth_model(whole) {
        // combined: drained c′ + σ′ tan φ′ limited by Su (the slices take the lesser)
        let c = non_negative(
            model.drained_cohesion.unwrap_or(0.0)
                + (depth - model.depth_ref) * model.drained_cohesion_rate.unwrap_or(0.0),
        );
        return ResolvedStrength {
            is_combined: Some(true),
            ..ResolvedStrength::plain(
                c,
                physical_friction_angle(model.drained_friction_angle.unwrap_or(0.0)),
                su,
            )
        };
    }

    ResolvedStrength::plain(su, 0.0, su)
}

fn resolve_strength_from_datum(
    model: &StrengthFromDatumModel,
    context: &StrengthContext,
) -> ResolvedStrength {
    let su = apply_cutoff(
        non_negative(model.su_ref + (model.y_ref - context.y_bottom) * model.rate),
        model.rate,
        model.su_max,
    );

    ResolvedStrength::plain(su, 0.0, su)
}

/// Tangent c (kPa) and φ (°) of a shear-normal function at σ′n: of the
/// segment holding σ′n (the first or last beyond the ends), so that
/// c + σ′n·tan φ is the strength there. Where the tangent's intercept would
/// be negative (a convex part), the secant through the origin (c = 0,
/// tan φ = τ/σ′n); where the curve falls, its value as c with φ = 0.
pub fn shear_normal_at(
    points: &[[f64; 2]],
    spline: Option<&TableSpline>,
    sn: f64,
) -> CohesionFriction {
    let n = points.len();
    if n == 0 {
        return CohesionFriction {
            cohesion: 0.0,
            friction_angle: 0.0,
        };
    }
    if n == 1 {
        return CohesionFriction {
            cohesion: js::math::max(0.0, points[0][1]),
            friction_angle: 0.0,
        };
    }
    let (mut tau, slope);
    if let Some(spline) = spline {
        let v = eval_spline(
            &cubic_spline(points, [spline.start_slope, spline.end_slope]),
            sn,
        );
        tau = v.value;
        slope = v.slope;
    } else {
        let mut k = 1;
        while k < n - 1 && points[k][0] < sn {
            k += 1;
        }
        let [x0, y0] = points[k - 1];
        let [x1, y1] = points[k];
        slope = if x1 > x0 { (y1 - y0) / (x1 - x0) } else { 0.0 };
        tau = y0 + (sn - x0) * slope;
    }
    tau = js::math::max(0.0, tau);
    let deg = |t: f64| (js::math::atan(t) * 180.0) / PI;
    if !(slope > 0.0) {
        return CohesionFriction {
            cohesion: tau,
            friction_angle: 0.0,
        };
    }
    let c = tau - sn * slope;
    if c >= 0.0 {
        return CohesionFriction {
            cohesion: c,
            friction_angle: deg(slope),
        };
    }
    if sn > 0.0 {
        CohesionFriction {
            cohesion: 0.0,
            friction_angle: deg(tau / sn),
        }
    } else {
        CohesionFriction {
            cohesion: tau,
            friction_angle: 0.0,
        }
    }
}

/// SHANSEP undrained strength at the base (see ShansepModel), from the
/// context's `y_bottom`, `y_ground` and `effective_vertical_stress`.
pub fn shansep_su(
    model: &ShansepModel,
    y_bottom: f64,
    y_ground: f64,
    effective_vertical_stress: Option<f64>,
) -> f64 {
    let sv = js::math::max(
        0.0,
        effective_vertical_stress
            .unwrap_or(model.base.unit_weight * js::math::max(0.0, y_ground - y_bottom)),
    );
    // a table: straight lines or a spline, constant beyond the ends
    let table = |pts: &[[f64; 2]], x: f64| -> f64 {
        match &model.spline {
            Some(spline) if pts.len() >= 2 => {
                let t = js::math::min(js::math::max(x, pts[0][0]), pts[pts.len() - 1][0]);
                eval_spline(
                    &cubic_spline(pts, [spline.start_slope, spline.end_slope]),
                    t,
                )
                .value
            }
            _ => interpolate_function(pts, x),
        }
    };
    let su = match &model.su_by_stress {
        Some(su_by_stress) if !su_by_stress.is_empty() => table(su_by_stress, sv),
        _ => {
            let ocr = if let (Some(pop), true) = (model.pop, sv > 0.0) {
                (sv + pop) / sv
            } else if let (Some(yield_stress), true) = (model.yield_stress, sv > 0.0) {
                js::math::max(1.0, yield_stress / sv)
            } else {
                match &model.ocr_by_elevation {
                    Some(ocr_by_elevation) if !ocr_by_elevation.is_empty() => {
                        table(ocr_by_elevation, y_bottom)
                    }
                    _ => model.ocr.unwrap_or(1.0),
                }
            };
            sv * model.ratio * js::math::pow(js::math::max(ocr, 0.0), model.exponent.unwrap_or(0.8))
        }
    };
    js::math::max(non_negative(su), model.su_min.unwrap_or(0.0))
}

fn resolve_shansep(model: &ShansepModel, context: &StrengthContext) -> ResolvedStrength {
    let su = shansep_su(
        model,
        context.y_bottom,
        context.y_ground,
        context.effective_vertical_stress,
    );
    ResolvedStrength::plain(su, 0.0, su)
}

// ── Helpers ────────────────────────────────────────────────────

/// Linearly varying strength can extrapolate below zero far from its
/// reference level; negative shear strength is not physical and would
/// produce a meaningless (near-zero) factor of safety.
fn non_negative(value: f64) -> f64 {
    if value > 0.0 {
        value
    } else {
        0.0
    }
}

/// Strength cutoff (an upper or lower limit on Su). Every rate here is
/// positive where strength increases with depth; then (and for a constant
/// strength) the cutoff is a maximum, for a negative rate a minimum. A cutoff
/// that is not a positive number (rejected by validation) is ignored.
fn apply_cutoff(su: f64, rate: f64, su_max: Option<f64>) -> f64 {
    match su_max {
        Some(su_max) if su_max.is_finite() && su_max > 0.0 => {
            if rate < 0.0 {
                js::math::max(su, su_max)
            } else {
                js::math::min(su, su_max)
            }
        }
        _ => su,
    }
}

/// Highest friction angle used (tan φ must stay finite and positive).
const MAX_FRICTION_ANGLE: f64 = 89.9;

/// A modifier or interpolation can produce φ ≥ 90°, where tan φ becomes
/// huge or negative and the FOS meaningless; keep φ in [0°, 89.9°].
fn physical_friction_angle(phi: f64) -> f64 {
    if !(phi > 0.0) {
        return 0.0;
    }
    js::math::min(phi, MAX_FRICTION_ANGLE)
}

/// Linearly interpolate a 1-D function defined by sorted (x, y) pairs.
/// Clamps to the nearest endpoint outside the data range.
pub fn interpolate_function(points: &[[f64; 2]], x: f64) -> f64 {
    if points.is_empty() {
        return 0.0;
    }
    if points.len() == 1 {
        return points[0][1];
    }

    // Sorted by x: the points as given when they are (the usual case, no
    // copy for every slice), else a sorted copy
    let ordered = points.windows(2).all(|w| w[0][0] <= w[1][0]);
    let sorted_copy;
    let sorted: &[[f64; 2]] = if ordered {
        points
    } else {
        let mut copy = points.to_vec();
        js::array::sort_by(&mut copy, |a, b| a[0] - b[0]);
        sorted_copy = copy;
        &sorted_copy
    };

    if x <= sorted[0][0] {
        return sorted[0][1];
    }
    if x >= sorted[sorted.len() - 1][0] {
        return sorted[sorted.len() - 1][1];
    }

    for i in 0..sorted.len() - 1 {
        let [x0, y0] = sorted[i];
        let [x1, y1] = sorted[i + 1];
        if x >= x0 && x <= x1 {
            let t = (x - x0) / (x1 - x0);
            return y0 + t * (y1 - y0);
        }
    }

    sorted[sorted.len() - 1][1]
}

/// Interpolate the anisotropic modifier from (α_deg, factor) pairs.
fn interpolate_modifier(modifier_function: &[[f64; 2]], alpha_deg: f64) -> f64 {
    if modifier_function.is_empty() {
        return 1.0;
    }
    interpolate_function(modifier_function, alpha_deg)
}
