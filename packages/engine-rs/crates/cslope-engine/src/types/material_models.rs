//! Port of packages/engine/src/types/material-models.ts
//!
//! Discriminated-union material model types.
//!
//! Each model variant carries only the parameters relevant to its
//! constitutive behaviour. The `kind` field acts as the discriminant
//! (`MaterialModel` is a serde enum tagged on `kind`).
//!
//! Adding a new model requires:
//!   1. Define a new struct here with a flattened `MaterialModelBase`.
//!   2. Add it to the `MaterialModel` enum (and its `Deserialize`).
//!   3. Handle the kind in `resolve_strength()` (strength.rs).
//!
//! Required numbers deserialize a missing value as NaN (TypeScript's
//! `undefined`, which validation rejects as not finite), and `null` too;
//! an unknown `kind` deserializes as `MaterialModel::Unknown`, which
//! validation and `resolve_strength` report as TypeScript does.

use serde::{Deserialize, Deserializer, Serialize};

// ── Base ───────────────────────────────────────────────────────

/// Fields shared by every material model.
///
/// `phi_b` and `max_suction` (`UnsaturatedStrength`) are kept here for every
/// kind, as a JavaScript object keeps them on any model: validation reports
/// them on a model that does not take them, and `suction_angle` ignores
/// them there.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialModelBase {
    /// Material unit weight in kN/m³.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub unit_weight: f64,
    /// Saturated unit weight (kN/m³) for the soil below the material's water
    /// line. Not set: `unit_weight` throughout.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub unit_weight_sat: Option<f64>,
    /// B̄ (B-bar): the excess pore pressure at a slice base in this material
    /// is B̄ times the vertical stress of the fill above it (the materials
    /// with `b_bar_load`), added to the pore pressure of its water line: the
    /// short-term pore pressure of a soft foundation under a new fill
    /// (Skempton 1954; Bishop 1954). Not set: none.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub b_bar: Option<f64>,
    /// The weight of this material (a fill) raises the pore pressure of materials with `b_bar` below it.
    /// (`if (model.bBarLoad)`: any value by its truthiness.)
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    pub b_bar_load: Option<bool>,
    /// Pore pressure ratio rᵤ = u / σv (Bishop & Morgenstern 1960): the pore
    /// pressure at a slice base in this material is rᵤ times the weight of
    /// the soil above it per unit width, added to the pore pressure of its
    /// water line (if any). Not set: none.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub ru: Option<f64>,
    /// The strength of the material above its water line (the phreatic
    /// level), when it differs from the strength below it (for example drained
    /// above and undrained below). It also applies everywhere when the
    /// material has no water line. Its unit weight is this model's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub above_water: Option<Box<MaterialModel>>,
    /// `UnsaturatedStrength.phiB`: angle φb (°) of the strength increase with
    /// matric suction, 0 ≤ φb < 90. Not set or 0: no suction strength.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub phi_b: Option<f64>,
    /// `UnsaturatedStrength.maxSuction`: largest matric suction (kPa) taken
    /// into account, > 0. Not set: no limit.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub max_suction: Option<f64>,
}

impl MaterialModelBase {
    /// A base with only the unit weight.
    pub fn new(unit_weight: f64) -> Self {
        MaterialModelBase {
            unit_weight,
            unit_weight_sat: None,
            b_bar: None,
            b_bar_load: None,
            ru: None,
            above_water: None,
            phi_b: None,
            max_suction: None,
        }
    }
}

/// Whether a model kind takes `UnsaturatedStrength` (S = f(depth) only in a combined analysis).
pub fn supports_suction_strength(kind: &str) -> bool {
    kind == "mohr-coulomb" || kind == "anisotropic-function" || kind == "s-f-depth"
}

/// φb (°) a model uses: its `phiB` where the model takes suction strength
/// (an S = f(depth) material only in a combined analysis) and φb > 0, else 0.
pub fn suction_angle(model: &MaterialModel) -> f64 {
    if !supports_suction_strength(model.kind()) {
        return 0.0;
    }
    if model.kind() == "s-f-depth" && !is_combined_depth_model(model) {
        return 0.0;
    }
    match model.base().phi_b {
        Some(phi_b) if phi_b.is_finite() && phi_b > 0.0 && phi_b < 90.0 => phi_b,
        _ => 0.0,
    }
}

// ── Model variants ─────────────────────────────────────────────

/// The drawdown (R) envelope of a soil that does not drain during rapid
/// drawdown: the total-stress envelope of isotropically consolidated
/// undrained tests (cR, φR), for the three-stage drawdown analysis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawdownEnvelope {
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub cohesion: f64,
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub friction_angle: f64,
}

/// Standard Mohr-Coulomb effective-stress model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MohrCoulombModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// Effective cohesion c (kPa).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub cohesion: f64,
    /// Friction angle φ (°).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub friction_angle: f64,
    /// The drawdown (R) envelope: with a rapid drawdown analysis
    /// (SlopeDefinition.rapidDrawdown) the soil does not drain and takes the
    /// undrained strength of the three-stage procedure (model/drawdown.ts).
    /// Not set: free-draining, its drained strength throughout.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drawdown_strength: Option<DrawdownEnvelope>,
    /// Reference ELEVATION y (m, despite the name) where c = `cohesion`:
    /// c = cohesion + (cohesionRefDepth − y_base) × cohesionRateOfChange.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cohesion_ref_depth: Option<f64>,
    /// Rate of cohesion increase per metre below the reference elevation (kPa/m).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cohesion_rate_of_change: Option<f64>,
    /// Undrained cohesion Su (kPa). Used by Combined method.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cohesion_undrained: Option<f64>,
    /// Combined-method c-factor: the drained c′ is `cohesion` × cFactor.
    /// 0 = not combined, so cFactor = 0 cannot give a combined material
    /// with c′ = 0; that takes `cohesion` = 0, any other cFactor and
    /// `cohesionUndrained` set.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub c_factor: Option<f64>,
}

/// Undrained strength model (φ = 0).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UndrainedModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// `UndrainedAnisotropy.anisotropy`: Su is multiplied by a factor that
    /// depends on the slice base inclination α, given as [[α°, factor], …]
    /// and interpolated linearly (constant beyond the ends), as
    /// `anisotropic-function`'s modifier: α is positive where the base dips
    /// down in the direction of sliding (the active zone near the crest),
    /// negative where it rises (the passive zone at the toe). For example
    /// [[-45, 0.82], [0, 1], [60, 1.5]] for passive 0.82, direct 1.0 and active
    /// 1.5 relative to the direct shear strength. Analyses without a slip
    /// surface base (finite elements, limit analysis, the strength profiles)
    /// take the factor at α = 0. Not set or empty: isotropic.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub anisotropy: Option<Vec<[f64; 2]>>,
    /// Undrained shear strength Su (kPa).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub undrained_shear_strength: f64,
    /// Rate of Su increase per metre below `suRefDepth` (kPa/m).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_rate_of_change: Option<f64>,
    /// Reference ELEVATION y (m, despite the name) where Su = `undrainedShearStrength`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_ref_depth: Option<f64>,
    /// Strength cutoff (kPa), as commercial programs offer it.
    /// With `suRateOfChange` ≥ 0 (Su constant or increasing with depth) it is a
    /// MAXIMUM: Su = min(Su, suMax). With a negative rate (Su decreasing with
    /// depth) it is a MINIMUM: Su = max(Su, suMax). Not set: no cutoff.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_max: Option<f64>,
}

/// High-strength material (e.g. concrete retaining wall).
///
/// Strength is treated as infinite — any slip surface passing through
/// this material is considered very stable and effectively skipped.
/// Only `unitWeight` is used (for overburden calculation).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HighStrengthModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
}

/// Impenetrable material (bedrock).
///
/// The slip surface cannot enter this region. Any slice whose base
/// falls inside this material causes the surface to be rejected.
/// `unitWeight` is still needed for overburden on layers below.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImpenetrableModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
}

/// Interpolation method of a spatial Mohr-Coulomb model. Another value
/// (a string or of another type) is kept as it is (TypeScript falls back to
/// inverse distance weighting).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SpatialInterpolation {
    #[serde(rename = "nearest")]
    Nearest,
    #[serde(rename = "linear")]
    Linear,
    #[serde(rename = "idw")]
    Idw,
    #[serde(untagged)]
    Other(serde_json::Value),
}

/// Spatial Mohr-Coulomb — c, φ vary as functions of (x, y).
///
/// The user supplies a set of data points with known c, φ, γ values.
/// At analysis time, the effective parameters are interpolated from
/// the nearest data points.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialMohrCoulombModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// Data points: [x, y, c (kPa), φ (°), γ (kN/m³)].
    #[serde(deserialize_with = "crate::types::json::tuples", default)]
    pub data_points: Vec<[f64; 5]>,
    /// Interpolation method (default: "idw", inverse distance weighting with
    /// power 2). "linear" is inverse distance weighting with power 1, not a
    /// linear (triangulated) interpolation.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interpolation: Option<SpatialInterpolation>,
}

/// Anisotropic function model.
///
/// Base c and φ are multiplied by a modifier that is a function of the
/// slice base inclination angle α. The modifier function is supplied
/// as an array of (α_deg, factor) pairs and linearly interpolated.
/// The factor scales φ in degrees, not tan φ: 0.8 on φ = 30° gives
/// 24.0°, where 0.8·tan 30° would give 24.8°.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnisotropicFunctionModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// Base effective cohesion c (kPa).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub cohesion: f64,
    /// Base friction angle φ (°).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub friction_angle: f64,
    /// Modifier vs base inclination: [[α_deg, factor], …].
    ///
    /// α is measured relative to the sliding direction, not geometrically:
    /// positive where the slice base dips down in the direction of sliding
    /// (the back scarp), negative where it rises (the toe). The same
    /// function therefore applies unchanged to left- and right-facing slopes.
    #[serde(deserialize_with = "crate::types::json::tuples", default)]
    pub modifier_function: Vec<[f64; 2]>,
}

/// Where the depth of an `s-f-depth` material is measured from. Another
/// string is kept as it is, for validation to report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DepthReference {
    #[serde(rename = "ground")]
    Ground,
    #[serde(rename = "layer-top")]
    LayerTop,
    #[serde(untagged)]
    Other(String),
}

/// Strength as a function of depth.
///
/// φ = 0; Su = suRef + (depth − depthRef) × rate,
/// where depth = yTop − yBottom at the slice base centre, yTop being the
/// ground surface or the top of the material layer (see `depthReference`).
///
/// Combined (with `drainedCohesion` and `drainedFrictionAngle`): the
/// strength is the lesser of the undrained Su and the drained
/// c′ + σ′·tan φ′, with c′ = drainedCohesion + (depth − depthRef) ×
/// drainedCohesionRate at the same depth, as Swedish practice analyses
/// clay ("kombinerad analys") and commercial programs offer it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrengthFromDepthModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// `UndrainedAnisotropy.anisotropy` (see `UndrainedModel::anisotropy`).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub anisotropy: Option<Vec<[f64; 2]>>,
    /// Reference undrained shear strength Su (kPa).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub su_ref: f64,
    /// Reference depth (m) below the depth reference.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub depth_ref: f64,
    /// Rate of change of Su with depth (kPa/m); positive: Su increases downwards.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub rate: f64,
    /// What the depth is measured from:
    /// - "ground": the ground surface above the slice base;
    /// - "layer-top": the top of the region of this material directly above
    ///   the slice base (as commercial programs offer it); for the uppermost layer this is the ground.
    ///
    /// Not set: "ground" (models saved before the option existed).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_reference: Option<DepthReference>,
    /// Strength cutoff (kPa), as commercial programs offer it.
    /// With `rate` ≥ 0 (Su constant or increasing with depth) it is a MAXIMUM:
    /// Su = min(Su, suMax). With a negative rate (Su decreasing with depth) it
    /// is a MINIMUM: Su = max(Su, suMax). Not set: no cutoff.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_max: Option<f64>,
    /// Drained effective cohesion c′ (kPa) at the reference depth, for a
    /// combined analysis. Set together with `drainedFrictionAngle`; either
    /// not set: undrained only.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub drained_cohesion: Option<f64>,
    /// Change of c′ per metre of depth (kPa/m), with the same depth as Su. Not set: 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub drained_cohesion_rate: Option<f64>,
    /// Drained friction angle φ′ (°) for a combined analysis (see `drainedCohesion`).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub drained_friction_angle: Option<f64>,
}

/// Whether an S = f(depth) model has a drained branch (a combined analysis).
pub fn is_combined_depth_model(model: &MaterialModel) -> bool {
    match model {
        MaterialModel::StrengthFromDepth(m) => {
            m.drained_cohesion.is_some() && m.drained_friction_angle.is_some()
        }
        _ => false,
    }
}

/// Strength as a function of datum (absolute elevation y).
///
/// φ = 0; Su = suRef + (yRef − y) × rate,
/// where y is the elevation of the slice base: a positive rate increases
/// Su with depth below the datum, as in commercial programs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrengthFromDatumModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// `UndrainedAnisotropy.anisotropy` (see `UndrainedModel::anisotropy`).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub anisotropy: Option<Vec<[f64; 2]>>,
    /// Reference undrained shear strength Su (kPa).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub su_ref: f64,
    /// Reference elevation y (m).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub y_ref: f64,
    /// Increase of Su per metre below yRef (kPa/m).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub rate: f64,
    /// Strength cutoff (kPa), as commercial programs offer it.
    /// With `rate` ≥ 0 (Su constant or increasing below the datum) it is a
    /// MAXIMUM: Su = min(Su, suMax). With a negative rate (Su decreasing
    /// downwards) it is a MINIMUM: Su = max(Su, suMax). Not set: no cutoff.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_max: Option<f64>,
}

/// Clay improved with lime-cement columns (KC-pelare): the shear strength of
/// the improved block is the area-weighted mean of the columns and the soil
/// between them, τ = a·τcol + (1 − a)·cu,soil. Undrained by default; with a
/// drained column strength (c′, φ′) the column part is limited to
/// c′ + σ′·tan φ′ ≤ cu,col (combined analysis), as in Swedish practice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimeCementColumnModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// Undrained shear strength of the soil between the columns (kPa) at the reference level.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub soil_su: f64,
    /// Reference level (elevation, m) of soilSu. Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_ref_depth: Option<f64>,
    /// Increase of soilSu per metre below the reference level (kPa/m). Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_rate_of_change: Option<f64>,
    /// Cutoff (kPa) of the soil strength between the columns (soilSu with its
    /// depth variation; the columns are not affected). With `suRateOfChange`
    /// ≥ 0 it is a MAXIMUM: cu,soil = min(cu,soil, suMax); with a negative
    /// rate a MINIMUM: cu,soil = max(cu,soil, suMax). Not set: no cutoff.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_max: Option<f64>,
    /// Undrained shear strength of the columns (kPa).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub column_su: f64,
    /// Area ratio a = column area / improved area, 0–1.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub area_ratio: f64,
    /// Drained cohesion of the columns c′ (kPa); with columnFrictionAngle.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub column_cohesion: Option<f64>,
    /// Drained friction angle of the columns φ′ (°); with columnCohesion.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub column_friction_angle: Option<f64>,
}

/// Generalised Hoek–Brown rock mass (Hoek, Carranza-Torres & Corkum 2002):
/// σ1′ = σ3′ + σci (mb σ3′/σci + s)^a from the intact rock's σci and mi,
/// the Geological Strength Index and the disturbance factor D. The analyses
/// use its instantaneous Mohr–Coulomb parameters at the normal stress on the
/// slip surface (types/hoek_brown.rs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoekBrownModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// Uniaxial compressive strength of the intact rock σci (kPa).
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub ucs: f64,
    /// Geological Strength Index, 0–100.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub gsi: f64,
    /// Intact rock constant mi.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub mi: f64,
    /// Disturbance factor D, 0–1. Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub disturbance: Option<f64>,
    /// The criterion's own parameters, given directly (for example the
    /// original criterion, a = 0.5): with `mb` and `s` set they are used
    /// instead of those from GSI, mi and D (`a` not set: 0.5).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub mb: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub s: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub a: Option<f64>,
}

/// SHANSEP (Ladd & Foott 1974): the undrained strength from the effective
/// vertical stress at the slice base and the stress history,
/// Su = σ′v · S · OCR^m, with OCR constant or a function of elevation; or
/// Su as a function of σ′v. σ′v is the slice's weight and surface loads per
/// unit width less the pore pressure at its base (the overburden on the
/// base in the analysis's pore pressures), as commercial programs take it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShansepModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// `UndrainedAnisotropy.anisotropy` (see `UndrainedModel::anisotropy`).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub anisotropy: Option<Vec<[f64; 2]>>,
    /// S, the Su/σ′v ratio of the normally consolidated soil.
    #[serde(
        deserialize_with = "crate::types::json::num",
        default = "crate::types::json::nan"
    )]
    pub ratio: f64,
    /// The exponent m. Default 0.8.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub exponent: Option<f64>,
    /// OCR, constant. Default 1.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub ocr: Option<f64>,
    /// Pre-overburden pressure POP (kPa): OCR = (σ′v + POP)/σ′v at the base.
    /// Replaces `ocr` and `ocrByElevation`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub pop: Option<f64>,
    /// Yield (preconsolidation) stress σ′y (kPa): OCR = σ′y/σ′v at the base, at least 1. Replaces `ocr` and `ocrByElevation`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub yield_stress: Option<f64>,
    /// With an earlier stage (SlopeDefinition.earlierStage): the yield stress
    /// is the effective vertical stress of the earlier stage at the base, with
    /// its distributed loads over the base taken straight down (no spreading
    /// with depth), plus `pop` (the stress history the soil kept from it),
    /// OCR = σ′y/σ′v, at least 1.
    /// (`yieldFromEarlierStage === true`: any other value is false.)
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "strictly_true"
    )]
    pub yield_from_earlier_stage: Option<bool>,
    /// OCR against elevation, [[y, OCR], …], interpolated linearly (constant beyond the ends); replaces `ocr`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub ocr_by_elevation: Option<Vec<[f64; 2]>>,
    /// Su against σ′v, [[σ′v, Su], …], interpolated linearly (constant beyond the ends); replaces S, m and OCR.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_tuples"
    )]
    pub su_by_stress: Option<Vec<[f64; 2]>>,
    /// Lower limit of Su (kPa). Default 0.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub su_min: Option<f64>,
    /// Cubic splines through `ocrByElevation` / `suByStress` instead of straight lines; constant beyond the ends as with straight lines.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "truthy_spline"
    )]
    pub spline: Option<TableSpline>,
}

/// A curved strength envelope given as points of the shear strength against
/// the effective normal stress, τ = f(σ′n), interpolated linearly between
/// them or with a spline (the end segment extended beyond the ends): each
/// slice base takes the tangent c and φ of the segment at its normal
/// stress, which the analysis updates from the stress it finds, as for
/// Hoek-Brown.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShearNormalModel {
    #[serde(flatten)]
    pub base: MaterialModelBase,
    /// [[σ′n (kPa), τ (kPa)], …], σ′n increasing, τ ≥ 0.
    #[serde(deserialize_with = "crate::types::json::tuples", default)]
    pub points: Vec<[f64; 2]>,
    /// A cubic spline through the points instead of straight lines (see `TableSpline`).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "truthy_spline"
    )]
    pub spline: Option<TableSpline>,
}

/// A cubic spline through a table's points: natural (zero curvature) at an
/// end without a slope, clamped to the slope given; a straight line with
/// the end slope beyond the ends (math/spline.rs).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableSpline {
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub start_slope: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub end_slope: Option<f64>,
}

/// `deserialize_with` for `spline`: TypeScript's `if (model.spline)` and
/// `model.spline.startSlope ?? null`: a value that is not truthy is none, a
/// truthy one a spline with its end slopes where it has them as numbers
/// (any other value converted with `ToNumber`).
fn truthy_spline<'de, D: Deserializer<'de>>(d: D) -> Result<Option<TableSpline>, D::Error> {
    use crate::types::json::{js_to_number, js_truthy};
    let v = crate::types::json::JsJson::deserialize(d)?.0;
    if !js_truthy(Some(&v)) {
        return Ok(None);
    }
    let end = |k: &str| {
        v.get(k)
            .filter(|e| !e.is_null())
            .map(|e| js_to_number(Some(e)))
    };
    Ok(Some(TableSpline {
        start_slope: end("startSlope"),
        end_slope: end("endSlope"),
    }))
}

/// A model the engine cannot read as one of its kinds: an unknown `kind`,
/// or a known kind whose JSON TypeScript would read but validation rejects
/// (a value of another type, a point with the wrong number of values,
/// `null` where a number belongs, …). It keeps the JSON as it came (`raw`)
/// for `validate_material_model` to report with TypeScript's messages (the
/// checks of validation.ts on the JSON, read with JavaScript's rules) and
/// for `resolve_strength` to refuse. `kind` is `String(model.kind)`, `base`
/// what could be read of the shared fields (the unit weight as a number).
#[derive(Debug, Clone, PartialEq)]
pub struct UnknownModel {
    pub kind: String,
    pub base: MaterialModelBase,
    /// The JSON as it came (non-finite numbers as `JsJson` encodes them);
    /// `None` for a model made in Rust, serialized from `kind` and `base`.
    pub raw: Option<Box<serde_json::Value>>,
}

impl UnknownModel {
    /// Whether this is a model of a known kind that could not be read.
    pub fn is_malformed(&self) -> bool {
        MATERIAL_MODEL_KINDS.contains(&self.kind.as_str())
    }
}

impl Serialize for UnknownModel {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        #[derive(Serialize)]
        struct Out<'a> {
            kind: &'a str,
            #[serde(flatten)]
            base: &'a MaterialModelBase,
        }
        match &self.raw {
            Some(raw) => raw.serialize(s),
            None => Out {
                kind: &self.kind,
                base: &self.base,
            }
            .serialize(s),
        }
    }
}

// ── Union ──────────────────────────────────────────────────────

/// Discriminated union of all supported material models.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind")]
pub enum MaterialModel {
    #[serde(rename = "mohr-coulomb")]
    MohrCoulomb(MohrCoulombModel),
    #[serde(rename = "undrained")]
    Undrained(UndrainedModel),
    #[serde(rename = "high-strength")]
    HighStrength(HighStrengthModel),
    #[serde(rename = "impenetrable")]
    Impenetrable(ImpenetrableModel),
    #[serde(rename = "spatial-mohr-coulomb")]
    SpatialMohrCoulomb(SpatialMohrCoulombModel),
    #[serde(rename = "anisotropic-function")]
    AnisotropicFunction(AnisotropicFunctionModel),
    #[serde(rename = "s-f-depth")]
    StrengthFromDepth(StrengthFromDepthModel),
    #[serde(rename = "s-f-datum")]
    StrengthFromDatum(StrengthFromDatumModel),
    #[serde(rename = "lime-cement-columns")]
    LimeCementColumns(LimeCementColumnModel),
    #[serde(rename = "hoek-brown")]
    HoekBrown(HoekBrownModel),
    #[serde(rename = "shansep")]
    Shansep(ShansepModel),
    #[serde(rename = "shear-normal")]
    ShearNormal(ShearNormalModel),
    /// Serialized as it came, with its own `kind`.
    #[serde(untagged)]
    Unknown(UnknownModel),
}

impl<'de> Deserialize<'de> for MaterialModel {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(MaterialModel::from_json(
            crate::types::json::JsJson::deserialize(d)?.0,
        ))
    }
}

/// Whether a JSON value holds a `null` anywhere (a `null` number reads as
/// NaN and serializes back as `null`, but TypeScript compares `null` as 0).
fn has_null(v: &serde_json::Value) -> bool {
    match v {
        serde_json::Value::Null => true,
        serde_json::Value::Array(a) => a.iter().any(has_null),
        serde_json::Value::Object(o) => o.values().any(has_null),
        _ => false,
    }
}

/// `deserialize_with` for a flag TypeScript compares with `=== true`.
fn strictly_true<'de, D: Deserializer<'de>>(d: D) -> Result<Option<bool>, D::Error> {
    let v = crate::types::json::JsJson::deserialize(d)?.0;
    Ok(Some(v == serde_json::Value::Bool(true)))
}

/// Whether two JSON values are the same, numbers by value (`18` and `18.0`).
fn same_json(a: &serde_json::Value, b: &serde_json::Value) -> bool {
    use serde_json::Value;
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same_json(x, y))
        }
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        (x, y) => x == y,
    }
}

/// The value with the `null` fields of its objects left out (TypeScript's
/// `?? default` and truthiness read them as absent).
fn without_null_fields(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Object(o) => serde_json::Value::Object(
            o.iter()
                .filter(|(_, v)| !v.is_null())
                .map(|(k, v)| (k.clone(), without_null_fields(v)))
                .collect(),
        ),
        other => other.clone(),
    }
}

impl MaterialModel {
    /// A model from its JSON (non-finite numbers as `JsJson` encodes them),
    /// never failing. JSON of a known kind in the engine's own shape (it
    /// serializes back to the same JSON) is that kind. Other JSON (fields of
    /// another kind, which validation.ts also checks, `null`, values of
    /// another type, non-finite numbers) is validated as TypeScript validates
    /// it (`validate_material_model_json`): if valid, it is read as
    /// TypeScript reads it (`null` fields as absent, the flags by
    /// truthiness, other fields dropped); otherwise it is kept as it came
    /// (`UnknownModel`), as is a model of an unknown kind, for validation to
    /// report.
    pub fn from_json(value: serde_json::Value) -> MaterialModel {
        // the engine's shape: the model reads back as the same JSON (no
        // field of another kind, no `null`, no value of another type)
        if !has_null(&value) {
            if let Some(m) = Self::typed(&value) {
                if serde_json::to_value(&m).is_ok_and(|back| same_json(&back, &value)) {
                    return m;
                }
            }
        }
        if crate::types::validation::validate_material_model_json(&value)
            .is_ok_and(|e| e.is_empty())
        {
            if let Some(m) = Self::typed(&without_null_fields(&value)) {
                return m;
            }
        }
        let kind = match &value {
            serde_json::Value::Object(o) => crate::types::json::js_to_string(o.get("kind")),
            _ => "undefined".to_string(),
        };
        let base = serde_json::from_value::<MaterialModelBase>(value.clone())
            .ok()
            .filter(|b| !b.above_water.as_deref().is_some_and(MaterialModel::is_raw))
            .unwrap_or_else(|| {
                MaterialModelBase::new(crate::types::json::js_to_number(value.get("unitWeight")))
            });
        MaterialModel::Unknown(UnknownModel {
            kind,
            base,
            raw: Some(Box::new(value)),
        })
    }

    /// The model of a known kind in the engine's shape, if `value` is one
    /// (and its `aboveWater` too).
    fn typed(value: &serde_json::Value) -> Option<MaterialModel> {
        let kind = value.get("kind")?.as_str()?;
        if !MATERIAL_MODEL_KINDS.contains(&kind) {
            return None;
        }
        let mut value = value.clone();
        value.as_object_mut()?.remove("kind");
        fn v<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Option<T> {
            serde_json::from_value(value).ok()
        }
        let m = match kind {
            "mohr-coulomb" => MaterialModel::MohrCoulomb(v(value)?),
            "undrained" => MaterialModel::Undrained(v(value)?),
            "high-strength" => MaterialModel::HighStrength(v(value)?),
            "impenetrable" => MaterialModel::Impenetrable(v(value)?),
            "spatial-mohr-coulomb" => MaterialModel::SpatialMohrCoulomb(v(value)?),
            "anisotropic-function" => MaterialModel::AnisotropicFunction(v(value)?),
            "s-f-depth" => MaterialModel::StrengthFromDepth(v(value)?),
            "s-f-datum" => MaterialModel::StrengthFromDatum(v(value)?),
            "lime-cement-columns" => MaterialModel::LimeCementColumns(v(value)?),
            "hoek-brown" => MaterialModel::HoekBrown(v(value)?),
            "shansep" => MaterialModel::Shansep(v(value)?),
            "shear-normal" => MaterialModel::ShearNormal(v(value)?),
            _ => return None,
        };
        // a nested model kept as JSON makes this one JSON too (validation
        // reads the nesting there)
        if m.above_water().is_some_and(MaterialModel::is_raw) {
            return None;
        }
        Some(m)
    }

    /// Whether the model is kept as the JSON it came as (`UnknownModel.raw`).
    pub fn is_raw(&self) -> bool {
        matches!(
            self,
            MaterialModel::Unknown(UnknownModel { raw: Some(_), .. })
        )
    }
}

/// All valid `kind` strings, in the order of the TypeScript union.
pub const MATERIAL_MODEL_KINDS: [&str; 12] = [
    "mohr-coulomb",
    "undrained",
    "high-strength",
    "impenetrable",
    "spatial-mohr-coulomb",
    "anisotropic-function",
    "s-f-depth",
    "s-f-datum",
    "lime-cement-columns",
    "hoek-brown",
    "shansep",
    "shear-normal",
];

/// Human-readable labels for each model kind (UI display).
pub const MATERIAL_MODEL_LABELS: [(&str, &str); 12] = [
    ("mohr-coulomb", "Mohr-Coulomb"),
    ("undrained", "Undrained"),
    ("high-strength", "High Strength"),
    ("impenetrable", "Impenetrable (Bedrock)"),
    ("spatial-mohr-coulomb", "Spatial Mohr-Coulomb"),
    ("anisotropic-function", "Anisotropic Function"),
    ("s-f-depth", "S = f(depth)"),
    ("s-f-datum", "S = f(datum)"),
    ("lime-cement-columns", "Lime-cement columns"),
    ("hoek-brown", "Generalised Hoek-Brown"),
    ("shansep", "SHANSEP"),
    ("shear-normal", "Shear-normal function"),
];

/// The label of a model kind (`MATERIAL_MODEL_LABELS[kind]`).
pub fn material_model_label(kind: &str) -> Option<&'static str> {
    MATERIAL_MODEL_LABELS
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, l)| *l)
}

/// Whether a model kind takes `UndrainedAnisotropy.anisotropy`.
pub fn supports_anisotropy(kind: &str) -> bool {
    kind == "undrained" || kind == "s-f-depth" || kind == "s-f-datum" || kind == "shansep"
}

impl MaterialModel {
    /// The `kind` string.
    pub fn kind(&self) -> &str {
        match self {
            MaterialModel::MohrCoulomb(_) => "mohr-coulomb",
            MaterialModel::Undrained(_) => "undrained",
            MaterialModel::HighStrength(_) => "high-strength",
            MaterialModel::Impenetrable(_) => "impenetrable",
            MaterialModel::SpatialMohrCoulomb(_) => "spatial-mohr-coulomb",
            MaterialModel::AnisotropicFunction(_) => "anisotropic-function",
            MaterialModel::StrengthFromDepth(_) => "s-f-depth",
            MaterialModel::StrengthFromDatum(_) => "s-f-datum",
            MaterialModel::LimeCementColumns(_) => "lime-cement-columns",
            MaterialModel::HoekBrown(_) => "hoek-brown",
            MaterialModel::Shansep(_) => "shansep",
            MaterialModel::ShearNormal(_) => "shear-normal",
            MaterialModel::Unknown(m) => &m.kind,
        }
    }

    /// The fields shared by every model.
    pub fn base(&self) -> &MaterialModelBase {
        match self {
            MaterialModel::MohrCoulomb(m) => &m.base,
            MaterialModel::Undrained(m) => &m.base,
            MaterialModel::HighStrength(m) => &m.base,
            MaterialModel::Impenetrable(m) => &m.base,
            MaterialModel::SpatialMohrCoulomb(m) => &m.base,
            MaterialModel::AnisotropicFunction(m) => &m.base,
            MaterialModel::StrengthFromDepth(m) => &m.base,
            MaterialModel::StrengthFromDatum(m) => &m.base,
            MaterialModel::LimeCementColumns(m) => &m.base,
            MaterialModel::HoekBrown(m) => &m.base,
            MaterialModel::Shansep(m) => &m.base,
            MaterialModel::ShearNormal(m) => &m.base,
            MaterialModel::Unknown(m) => &m.base,
        }
    }

    /// The fields shared by every model, mutable.
    pub fn base_mut(&mut self) -> &mut MaterialModelBase {
        match self {
            MaterialModel::MohrCoulomb(m) => &mut m.base,
            MaterialModel::Undrained(m) => &mut m.base,
            MaterialModel::HighStrength(m) => &mut m.base,
            MaterialModel::Impenetrable(m) => &mut m.base,
            MaterialModel::SpatialMohrCoulomb(m) => &mut m.base,
            MaterialModel::AnisotropicFunction(m) => &mut m.base,
            MaterialModel::StrengthFromDepth(m) => &mut m.base,
            MaterialModel::StrengthFromDatum(m) => &mut m.base,
            MaterialModel::LimeCementColumns(m) => &mut m.base,
            MaterialModel::HoekBrown(m) => &mut m.base,
            MaterialModel::Shansep(m) => &mut m.base,
            MaterialModel::ShearNormal(m) => &mut m.base,
            MaterialModel::Unknown(m) => &mut m.base,
        }
    }

    /// Unit weight (kN/m³).
    pub fn unit_weight(&self) -> f64 {
        self.base().unit_weight
    }

    /// `aboveWater`: the strength above the water line, if any.
    pub fn above_water(&self) -> Option<&MaterialModel> {
        self.base().above_water.as_deref()
    }

    /// `UndrainedAnisotropy.anisotropy` of the kinds that take it.
    pub fn anisotropy(&self) -> Option<&Vec<[f64; 2]>> {
        match self {
            MaterialModel::Undrained(m) => m.anisotropy.as_ref(),
            MaterialModel::StrengthFromDepth(m) => m.anisotropy.as_ref(),
            MaterialModel::StrengthFromDatum(m) => m.anisotropy.as_ref(),
            MaterialModel::Shansep(m) => m.anisotropy.as_ref(),
            _ => None,
        }
    }
}
