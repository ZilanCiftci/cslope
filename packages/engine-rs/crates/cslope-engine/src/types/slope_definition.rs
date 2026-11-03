//! Port of packages/engine/src/types/slope-definition.ts
//!
//! Serialized slope definition DTO.
//!
//! This is the data-transfer shape used to pass a slope model between
//! the UI, the Web Worker, and the engine.

use crate::error::{EngineError, Result};
use crate::model::canonical::SlopeOrientation;
use crate::model::waternet::Waternet;
use crate::types::analysis::AnalysisLimits;
use crate::types::loads::{UdlDirection, UdlExcessPorePressure};
use crate::types::material_models::{MaterialModel, MaterialModelBase, MohrCoulombModel};
use crate::types::reinforcement::{Pile, Reinforcement};
use serde::{Deserialize, Serialize};

/// A material of a slope definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlopeMaterialDefinition {
    pub name: String,
    /// The material: unit weight and strength. The only source of them; see
    /// `material_model_of` for definitions written before models existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<MaterialModel>,
    /// Deprecated: older definitions without `model` gave a Mohr-Coulomb
    /// material in these flat fields. Read only when `model` is absent.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub unit_weight: Option<f64>,
    /// Deprecated: see `unit_weight`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub friction_angle: Option<f64>,
    /// Deprecated: see `unit_weight`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cohesion: Option<f64>,
    /// Deprecated: see `unit_weight`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cohesion_ref_depth: Option<f64>,
    /// Deprecated: see `unit_weight`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cohesion_rate_of_change: Option<f64>,
    /// Deprecated: see `unit_weight`.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub cohesion_undrained: Option<f64>,
    /// Depth range [top, bottom] in m for this material.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_range: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Id of an entry in `water_tables` that governs pore pressure in this
    /// material. When absent (or unknown) the default `water_table` is used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub water_table_id: Option<String>,
}

impl SlopeMaterialDefinition {
    /// A material with a name and a model only.
    pub fn new(name: impl Into<String>, model: MaterialModel) -> Self {
        SlopeMaterialDefinition {
            name: name.into(),
            model: Some(model),
            unit_weight: None,
            friction_angle: None,
            cohesion: None,
            cohesion_ref_depth: None,
            cohesion_rate_of_change: None,
            cohesion_undrained: None,
            depth_range: None,
            color: None,
            water_table_id: None,
        }
    }
}

/// The model of a definition's material: its `model`, or for an older
/// definition a Mohr-Coulomb model from the flat fields.
pub fn material_model_of(m: &SlopeMaterialDefinition) -> Result<MaterialModel> {
    if let Some(model) = &m.model {
        return Ok(model.clone());
    }
    // Older definitions gave all three; a missing one is an error, not 0.
    let (Some(unit_weight), Some(cohesion), Some(friction_angle)) =
        (m.unit_weight, m.cohesion, m.friction_angle)
    else {
        return Err(EngineError::new(format!(
            "Material \"{}\" has no model.",
            m.name
        )));
    };
    Ok(MaterialModel::MohrCoulomb(MohrCoulombModel {
        base: MaterialModelBase::new(unit_weight),
        cohesion,
        friction_angle,
        drawdown_strength: None,
        cohesion_ref_depth: m.cohesion_ref_depth,
        cohesion_rate_of_change: m.cohesion_rate_of_change,
        cohesion_undrained: m.cohesion_undrained,
        c_factor: None,
    }))
}

/// A definition's material with its model and without the flat fields
/// (the flat fields of older definitions; their `materialType` is not
/// read here at all).
pub fn with_material_model(m: &SlopeMaterialDefinition) -> Result<SlopeMaterialDefinition> {
    let model = material_model_of(m)?;
    Ok(SlopeMaterialDefinition {
        model: Some(model),
        unit_weight: None,
        friction_angle: None,
        cohesion: None,
        cohesion_ref_depth: None,
        cohesion_rate_of_change: None,
        cohesion_undrained: None,
        ..m.clone()
    })
}

/// Water table mode (`SlopeDefinition.waterTable.mode`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WaterTableMode {
    Height,
    Depth,
    Custom,
}

/// `SlopeDefinition.waterTable.value`: a level (height or depth) or the
/// points of a custom line.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WaterTableValue {
    Level(f64),
    Points(Vec<[f64; 2]>),
}

/// Water table definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterTableDefinition {
    pub mode: WaterTableMode,
    pub value: WaterTableValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_boundary: Option<bool>,
}

/// An additional water table (piezometric line) that materials can refer
/// to with `water_table_id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaterTableEntry {
    pub id: String,
    pub coordinates: Vec<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub follow_boundary: Option<bool>,
}

/// A UDL of a definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdlDefinition {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub magnitude: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x1: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x2: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<UdlDirection>,
    /// Excess pore pressure under the load per material (UdlParams.excessPorePressure).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excess_pore_pressure: Option<Vec<UdlExcessPorePressure>>,
}

/// A line load of a definition; `angle`: inclination from the downward
/// vertical (°), positive towards +x; `y`: the elevation of the load point
/// (a point on a wall face; default the ground at x).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineLoadDefinition {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub magnitude: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub x: f64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub angle: Option<f64>,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::opt_num"
    )]
    pub y: Option<f64>,
}

/// Rapid drawdown (three-stage, model/drawdown.ts): the water table before
/// drawdown, for all materials.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RapidDrawdown {
    pub water_before: Vec<[f64; 2]>,
}

/// A material boundary polyline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialBoundary {
    pub coordinates: Vec<[f64; 2]>,
    pub material_name: String,
}

/// A point-based region material assignment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionAssignment {
    pub point: [f64; 2],
    pub material_name: String,
}

/// A user-specified circular search plane.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CustomSearchPlane {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cx: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cy: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub radius: f64,
}

/// A user-specified non-circular surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CustomSurface {
    pub points: Vec<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<[f64; 2]>,
}

/// A block search object: one point, a line or a window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlockSearchObject {
    pub points: Vec<[f64; 2]>,
}

/// Slope definition sent from the UI to the engine / worker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlopeDefinition {
    /// Model orientation used for canonical mirroring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation: Option<SlopeOrientation>,
    /// Boundary coordinates [[x,y], ...].
    pub coordinates: Vec<[f64; 2]>,
    /// Material assignments.
    pub materials: Vec<SlopeMaterialDefinition>,
    /// Water table definition (optional).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub water_table: Option<WaterTableDefinition>,
    /// Additional water tables (piezometric lines) that materials can refer
    /// to with `waterTableId`. Same clipping rule as `waterTable`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub water_tables: Option<Vec<WaterTableEntry>>,
    /// UDL loads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub udls: Option<Vec<UdlDefinition>>,
    /// Line loads; `angle`: inclination from the downward vertical (°),
    /// positive towards +x; `y`: the elevation of the load point (a point on a
    /// wall face; default the ground at x).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_loads: Option<Vec<LineLoadDefinition>>,
    /// Rapid drawdown (three-stage, model/drawdown.ts): the water table before
    /// drawdown, for all materials (the model's own water is the state after
    /// it). The materials with a drawdown envelope do not drain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rapid_drawdown: Option<RapidDrawdown>,
    /// An earlier stage of the same section (its geometry, water and loads),
    /// whose effective vertical stresses give the yield stress of SHANSEP
    /// materials with `yieldFromEarlierStage` (multi-stage analyses). Its x
    /// range must be the model's. (TypeScript's type leaves out its own
    /// `earlierStage`.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub earlier_stage: Option<Box<SlopeDefinition>>,
    /// Pore pressure from head lines and reference lines (model/waternet.rs),
    /// for all materials instead of their water lines (which still give the
    /// phreatic level for unit weights, free water and `aboveWater`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waternet: Option<Waternet>,
    /// Reinforcement: anchors, tiebacks, soil nails, geosynthetics.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcements: Option<Vec<Reinforcement>>,
    /// Pile rows and sheet pile walls (shear).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub piles: Option<Vec<Pile>>,
    /// Material boundary polylines that divide the slope into layers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub material_boundaries: Option<Vec<MaterialBoundary>>,
    /// Material name for the top region (above all boundaries).
    /// Only needed when it differs from the first (default) material.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_region_material_name: Option<String>,
    /// Point-based region material assignments.
    /// Each entry maps a representative point to a material name.
    /// The engine assigns the material to whichever region contains the point.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region_assignments: Option<Vec<RegionAssignment>>,
    /// Search area limits for entry/exit ranges.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis_limits: Option<AnalysisLimits>,
    /// User-specified circular search planes (cx, cy, radius), in model space
    /// (the coordinates of this definition, also for a right-to-left slope).
    /// `analyse` with `map_analysis_result_to_model_space` returns results in
    /// model space; a Slope's own surfaces (`Slope.search`) are in canonical
    /// space, taken back with `Slope.toModelX` / `Slope.toModelCircle`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_search_planes: Option<Vec<CustomSearchPlane>>,
    /// User-specified non-circular surfaces: polylines through the soil. They
    /// are fitted to the ground (end segments extended to it) and analysed
    /// with moments about a default axis point, or about `axis` when given
    /// (the circle centre an optimised surface was derived from).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_surfaces: Option<Vec<CustomSurface>>,
    /// When true, only the custom surfaces are analysed (no search).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_planes_only: Option<bool>,
    /// Block search objects (analysis option `searchMethod: "block"`): each
    /// block surface passes through one point of every object. One point is
    /// a fixed point, two points a line, three or more a window (polygon).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_search_objects: Option<Vec<BlockSearchObject>>,
}

impl SlopeDefinition {
    /// A definition with coordinates and materials only.
    pub fn new(coordinates: Vec<[f64; 2]>, materials: Vec<SlopeMaterialDefinition>) -> Self {
        SlopeDefinition {
            orientation: None,
            coordinates,
            materials,
            water_table: None,
            water_tables: None,
            udls: None,
            line_loads: None,
            rapid_drawdown: None,
            earlier_stage: None,
            waternet: None,
            reinforcements: None,
            piles: None,
            material_boundaries: None,
            top_region_material_name: None,
            region_assignments: None,
            analysis_limits: None,
            custom_search_planes: None,
            custom_surfaces: None,
            custom_planes_only: None,
            block_search_objects: None,
        }
    }
}
