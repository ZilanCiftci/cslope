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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SlopeMaterialDefinition {
    pub name: String,
    /// The material: unit weight and strength. The only source of them; see
    /// `material_model_of` for definitions written before models existed.
    /// (`if (m.model)`: a value that is not truthy, `null` included, is none.)
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "truthy_model"
    )]
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
    /// `Some(None)` is `null`: TypeScript assigns it (`waterTableId !==
    /// undefined`), so the material counts as having its own water table
    /// while it uses the default one.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullable"
    )]
    pub water_table_id: Option<Option<String>>,
}

/// `deserialize_with` for `SlopeMaterialDefinition.model`: TypeScript's
/// `materialModelOf` takes it when it is truthy.
fn truthy_model<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> std::result::Result<Option<MaterialModel>, D::Error> {
    let v = crate::types::json::JsJson::deserialize(d)?.0;
    Ok(crate::types::json::js_truthy(Some(&v)).then(|| MaterialModel::from_json(v)))
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

/// Water table mode (`SlopeDefinition.waterTable.mode`). Another value
/// (`null` and a missing mode included: `Missing`) is kept, and the water
/// table is then left out, as `buildSlope` leaves it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum WaterTableMode {
    Height,
    Depth,
    Custom,
    #[schemars(skip)]
    #[serde(untagged)]
    Other(serde_json::Value),
}

impl WaterTableMode {
    /// A mode that is not given.
    fn missing() -> Self {
        WaterTableMode::Other(serde_json::Value::Null)
    }

    fn is_missing(&self) -> bool {
        *self == WaterTableMode::Other(serde_json::Value::Null)
    }
}

/// `SlopeDefinition.waterTable.value`: a level (height or depth) or the
/// points of a custom line. Another value (`null`, a string, a list that is
/// not of points, a missing value) is kept, and the water table is then
/// left out, as `buildSlope` leaves it where the value does not fit the
/// mode.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(untagged)]
pub enum WaterTableValue {
    Level(f64),
    Points(Vec<[f64; 2]>),
    #[schemars(skip)]
    Other(serde_json::Value),
}

impl WaterTableValue {
    /// A value that is not given.
    fn missing() -> Self {
        WaterTableValue::Other(serde_json::Value::Null)
    }

    fn is_missing(&self) -> bool {
        *self == WaterTableValue::Other(serde_json::Value::Null)
    }
}

/// Water table definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WaterTableDefinition {
    #[serde(
        default = "WaterTableMode::missing",
        skip_serializing_if = "WaterTableMode::is_missing"
    )]
    pub mode: WaterTableMode,
    #[serde(
        default = "WaterTableValue::missing",
        skip_serializing_if = "WaterTableValue::is_missing"
    )]
    pub value: WaterTableValue,
    /// Deprecated (D-24): the inverse of `free_water`, under a name that
    /// reads the wrong way round (true: no free water). `setWaterTable`'s
    /// `followBoundary ?? true`: `null` is the default (true), another value
    /// its truthiness. Read only when `free_water` is absent.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullish_truthy"
    )]
    #[schemars(
        description = "Deprecated: use freeWater (followBoundary = !freeWater). true: the line is clipped to the ground (no free water).",
        extend("deprecated" = true)
    )]
    pub follow_boundary: Option<bool>,
    /// Whether water above the ground surface is free water: its weight acts
    /// on the ground (true), or the line is clipped to the ground (false,
    /// the default). Takes precedence over `follow_boundary` (D-24).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullish_truthy"
    )]
    #[schemars(
        description = "Whether water above the ground surface is free water whose weight acts on the ground (true), or the line is clipped to the ground (false, the default)."
    )]
    pub free_water: Option<bool>,
}

impl WaterTableDefinition {
    /// The engine's `followBoundary` of this water table: `!free_water`
    /// when given, else `follow_boundary` (None: the default, true).
    pub fn follows_boundary(&self) -> Option<bool> {
        match self.free_water {
            Some(free) => Some(!free),
            None => self.follow_boundary,
        }
    }
}

/// An additional water table (piezometric line) that materials can refer
/// to with `water_table_id`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct WaterTableEntry {
    pub id: String,
    pub coordinates: Vec<[f64; 2]>,
    /// Deprecated (D-24): the inverse of `free_water`.
    /// `setWaterTableById`'s default parameter `followBoundary = true`
    /// applies only when it is absent: `null` is false (no clipping), another
    /// value its truthiness. Read only when `free_water` is absent.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::truthy"
    )]
    #[schemars(
        description = "Deprecated: use freeWater (followBoundary = !freeWater). true: the line is clipped to the ground (no free water).",
        extend("deprecated" = true)
    )]
    pub follow_boundary: Option<bool>,
    /// Whether water above the ground surface is free water (true) or the
    /// line is clipped to the ground (false, the default). Takes precedence
    /// over `follow_boundary` (D-24).
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "crate::types::json::nullish_truthy"
    )]
    #[schemars(
        description = "Whether water above the ground surface is free water whose weight acts on the ground (true), or the line is clipped to the ground (false, the default)."
    )]
    pub free_water: Option<bool>,
}

impl WaterTableEntry {
    /// The engine's `followBoundary` of this line: `!free_water` when
    /// given, else `follow_boundary`, else true.
    pub fn follows_boundary(&self) -> bool {
        match self.free_water {
            Some(free) => !free,
            None => self.follow_boundary.unwrap_or(true),
        }
    }
}

/// A UDL of a definition.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
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
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RapidDrawdown {
    pub water_before: Vec<[f64; 2]>,
}

/// A material boundary polyline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MaterialBoundary {
    pub coordinates: Vec<[f64; 2]>,
    /// Deprecated (D-24): a material for the region below the boundary's
    /// midpoint, used only when the definition has no `region_assignments`
    /// (older definitions). Absent is "" (none); give the materials of the
    /// regions with `region_assignments`.
    #[serde(default)]
    #[schemars(
        description = "Deprecated: assign the materials of the regions with regionAssignments. Used only without regionAssignments (the region below the boundary's midpoint).",
        extend("deprecated" = true)
    )]
    pub material_name: String,
}

/// A point-based region material assignment.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RegionAssignment {
    pub point: [f64; 2],
    pub material_name: String,
}

/// A user-specified circular search plane.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct CustomSearchPlane {
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cx: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub cy: f64,
    #[serde(deserialize_with = "crate::types::json::num")]
    pub radius: f64,
}

/// A user-specified non-circular surface.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct CustomSurface {
    pub points: Vec<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub axis: Option<[f64; 2]>,
}

/// A block search object: one point, a line or a window.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
pub struct BlockSearchObject {
    pub points: Vec<[f64; 2]>,
}

/// Slope definition sent from the UI to the engine / worker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "A slope model: the outline (coordinates), the materials and their regions (materialBoundaries, regionAssignments), water, loads, structures and the search limits. Coordinates in metres, y up; the model slides towards +x unless orientation is \"rtl\"."
)]
pub struct SlopeDefinition {
    /// Model orientation used for canonical mirroring.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation: Option<SlopeOrientation>,
    /// Boundary coordinates [[x,y], ...].
    pub coordinates: Vec<[f64; 2]>,
    /// Material assignments. Absent reads as none, which `build_slope`
    /// rejects with TypeScript's message (TypeScript's `!def.materials`).
    #[serde(default)]
    #[schemars(extend("x-required" = true))]
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
