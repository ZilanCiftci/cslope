//! The app's model (`ModelEntry`, packages/desktop/src/store/types.ts): the
//! fields the analysis reads, typed; everything else of a model (the paper,
//! the project block, the views, expressions, labels) is kept as it is in
//! `extra`, so that a model read and written again loses nothing.
//!
//! Field names and optionality follow the TypeScript types. A field the
//! app's types require may still be missing from a hand-made file; where
//! the conversion (`store/helpers.ts`) has a default for it (`?? []`,
//! `?? DEFAULT_PIEZO_LINE`), it is optional here too.

use cslope_engine::model::canonical::SlopeOrientation;
use cslope_engine::model::waternet::Waternet;
use cslope_engine::types::{MaterialModel, SlopeDefinition};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub type Point = [f64; 2];

/// One model of a project (`models/<id>/model.json` of a `.cslp` file).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Absent: "ltr".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub orientation: Option<SlopeOrientation>,
    #[serde(default)]
    pub coordinates: Vec<Point>,
    #[serde(default)]
    pub materials: Vec<MaterialRow>,
    #[serde(default)]
    pub material_boundaries: Vec<MaterialBoundaryRow>,
    #[serde(default)]
    pub region_materials: Vec<RegionAssignmentRow>,
    /// Absent: `DEFAULT_PIEZO_LINE` (no lines).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub piezometric_line: Option<PiezometricLineState>,
    #[serde(default)]
    pub udls: Vec<UdlRow>,
    #[serde(default)]
    pub line_loads: Vec<LineLoadRow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcements: Option<Vec<ReinforcementRow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub piles: Option<Vec<PileRow>>,
    #[serde(default)]
    pub custom_search_planes: Vec<CustomSearchPlaneRow>,
    /// Absent: false.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_planes_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_search_objects: Option<Vec<BlockSearchObjectRow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waternet: Option<Waternet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub earlier_stage: Option<Box<SlopeDefinition>>,
    /// The analysis options (`AnalysisOptions`), as the app holds them: the
    /// run takes them as they are. Absent: the app's defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Map<String, Value>>,
    /// Absent: `DEFAULT_ANALYSIS_LIMITS` (enabled).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub analysis_limits: Option<AnalysisLimitsState>,
    /// The rest of the model, as it is.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialRow {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_range: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<MaterialModel>,
    /// `modelExpressions` and anything else, as it is.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaterialBoundaryRow {
    pub id: String,
    pub coordinates: Vec<Point>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionAssignmentRow {
    pub point: Point,
    pub material_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiezoLine {
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub color: String,
    pub coordinates: Vec<Point>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RapidDrawdownState {
    pub water_before: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiezometricLineState {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub lines: Vec<PiezoLine>,
    /// Written as `null` when there is none, as the app writes it.
    #[serde(default)]
    pub active_line_id: Option<String>,
    /// The line of each material, by material id.
    #[serde(default)]
    pub material_assignment: BTreeMap<String, String>,
    /// Absent: true (a file of schema version 3; older files are migrated
    /// by the app, see `cslope export`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_water: Option<bool>,
    /// Absent: the first line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_line_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rapid_drawdown: Option<RapidDrawdownState>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Default for PiezometricLineState {
    /// `DEFAULT_PIEZO_LINE`.
    fn default() -> Self {
        PiezometricLineState {
            enabled: false,
            lines: Vec::new(),
            active_line_id: None,
            material_assignment: BTreeMap::new(),
            free_water: None,
            main_line_id: None,
            rapid_drawdown: None,
            extra: Map::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdlExcessPorePressureRow {
    pub material_id: String,
    pub ratio: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UdlRow {
    pub id: String,
    pub magnitude: f64,
    pub x1: f64,
    pub x2: f64,
    /// "vertical" or "normal"; absent: vertical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excess_pore_pressure: Option<Vec<UdlExcessPorePressureRow>>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineLoadRow {
    pub id: String,
    pub magnitude: f64,
    pub x: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A reinforcement element (`ReinforcementRow`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReinforcementRow {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// "anchor", "tieback", "nail" or "geosynthetic" (names the element in
    /// the app; the analysis takes the fields).
    #[serde(rename = "type")]
    pub kind: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub tensile_capacity: f64,
    pub spacing: f64,
    /// "none", "bond", "interface" or "development".
    pub pullout: String,
    pub bond_strength: f64,
    pub bonded_length: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prestress: Option<f64>,
    pub adhesion: f64,
    pub interface_friction: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub development_length1: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub development_length2: Option<f64>,
    pub end1_capacity: f64,
    pub end2_capacity: f64,
    /// "axial", "tangent" or "bisector".
    pub direction: String,
    /// "active" or "passive".
    pub application: String,
}

/// A pile row or sheet pile wall (`PileRow`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PileRow {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// "pile" or "sheet-pile".
    #[serde(rename = "type")]
    pub kind: String,
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    /// "force" or "ito-matsui".
    pub mode: String,
    pub force: f64,
    pub diameter: f64,
    pub spacing: f64,
    pub shear_capacity: f64,
    pub moment_capacity: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bending_stiffness: Option<f64>,
    pub angle: f64,
    /// "tangent", "perpendicular" or "angle"; absent: by the angle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    /// "active" or "passive".
    pub application: String,
    /// "centroid" or "slip-surface"; absent: the default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}

/// A custom search plane: a circle, or with `points` a polyline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSearchPlaneRow {
    pub id: String,
    #[serde(default)]
    pub cx: f64,
    #[serde(default)]
    pub cy: f64,
    #[serde(default)]
    pub radius: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Point>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockSearchObjectRow {
    pub id: String,
    #[serde(default)]
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisLimitsState {
    pub enabled: bool,
    pub entry_left_x: f64,
    pub entry_right_x: f64,
    pub exit_left_x: f64,
    pub exit_right_x: f64,
}

/// `DEFAULT_ANALYSIS_LIMITS`.
pub const DEFAULT_ANALYSIS_LIMITS: AnalysisLimitsState = AnalysisLimitsState {
    enabled: true,
    entry_left_x: 4.0,
    entry_right_x: 8.0,
    exit_left_x: 12.5,
    exit_right_x: 15.0,
};

/// The colors of materials without one (`MATERIAL_COLORS`).
pub const MATERIAL_COLORS: [&str; 6] = [
    "#d4a373", "#a8c686", "#b5838d", "#6d6875", "#e5989b", "#ffb4a2",
];

/// The colors of piezometric lines (`PIEZO_COLORS`).
pub const PIEZO_COLORS: [&str; 6] = [
    "#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899",
];

impl ModelEntry {
    /// The model as JSON (the app's shape).
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).expect("a model is JSON")
    }

    /// A model from JSON (a `model.json`), with the path of what cannot be
    /// read in the message.
    pub fn from_json(value: Value) -> Result<ModelEntry, String> {
        serde_path_to_error::deserialize(value).map_err(|e| {
            let path = e.path().to_string();
            if path == "." {
                format!("The model cannot be read: {}", e.inner())
            } else {
                format!("The model cannot be read at {path}: {}", e.inner())
            }
        })
    }
}
