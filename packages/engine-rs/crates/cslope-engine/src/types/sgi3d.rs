//! Port of packages/engine/src/types/sgi3d.ts
//!
//! 3D effects of a temporary slope after SGI's guidance (see model/sgi3d.ts).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Sgi3dOptions {
    /// Length of the critical stretch L (m), the stage of the excavation open at a time.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub length: f64,
    /// F_2D,överstark,min of the adjacent stretches (eq. 2-4). Not set:
    /// infinitely overstrong adjacent stability (eq. 2-3).
    #[serde(
        rename = "overstrongF2D",
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub overstrong_f2d: Option<f64>,
    /// Materials not counted in the end faces, by name (besides friction soil).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude_materials: Option<Vec<String>>,
    /// Size of the integration cells (m), at least: coarser to keep a large model to about 400 000 cells. Default 0.05.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cell_size: Option<f64>,
}

/// One analysed surface with its 3D factor, its circle in model space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Sgi3dSurface {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cx: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cy: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub radius: f64,
    /// F_2D of the surface.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub f2d: f64,
    /// Driving moment M_E (kNm per metre).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub driving_moment: f64,
    /// Area of cohesive soil in the end face counted (m²).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub end_face_area: f64,
    /// ∫ c_u r dA over that area (kNm per end face).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub end_face_moment: f64,
    /// F_P, plane end faces (eq. 2-2).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub fp: f64,
    /// F_3D (eq. 2-3 or 2-4).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub f3d: f64,
}

/// Eq. 2-3 (infinitely overstrong adjacent stability) or 2-4 (finite).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
pub enum Sgi3dEquation {
    #[serde(rename = "2-3")]
    Eq2_3,
    #[serde(rename = "2-4")]
    Eq2_4,
}

/// The options a 3D result was computed with (`Sgi3dResult.options`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Sgi3dResultOptions {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub length: f64,
    #[serde(
        rename = "overstrongF2D",
        default,
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub overstrong_f2d: Option<f64>,
    pub exclude_materials: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Sgi3dResult {
    /// The smallest F_3D over the analysed circular surfaces.
    #[serde(deserialize_with = "crate::types::json::num")]
    pub factor_of_safety: f64,
    /// F_2D,krit,min: the smallest F_2D of the analysis (non-circular surfaces included).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub f2d_critical: f64,
    /// The surface of the smallest F_3D.
    pub critical: Sgi3dSurface,
    /// Eq. 2-3 (infinitely overstrong adjacent stability) or 2-4 (finite).
    pub equation: Sgi3dEquation,
    pub options: Sgi3dResultOptions,
    pub warnings: Vec<String>,
}

/// The analysis option: 3D effects after the 2D analysis (AnalysisOptions.sgi3d).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Sgi3dSettings {
    pub enabled: bool,
    /// Length of the critical stretch L (m) (`Sgi3dOptions.length`).
    #[serde(deserialize_with = "crate::types::json::num")]
    pub length: f64,
    /// Size of the integration cells (m) (`Sgi3dOptions.cellSize`).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cell_size: Option<f64>,
    /// F_2D,överstark,min (eq. 2-4); null: infinitely overstrong (eq. 2-3).
    #[serde(
        rename = "overstrongF2D",
        default,
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub overstrong_f2d: Option<f64>,
    /// Materials not counted in the end faces, by name.
    pub exclude_materials: Vec<String>,
}
