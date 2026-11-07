//! The app's model (`ModelEntry`, packages/desktop/src/store/types.ts) as a
//! `models/<id>/model.json` of a `.cslp` file holds it: every documented
//! member typed (docs/file-format.md section 4.3), none unknown (a reader
//! refuses one with its path, a writer never writes one, section 2.1).
//!
//! The shape is the one the app holds after it opened the file
//! (`parseProjectData`, store/persistence.ts, ported in [`crate::normalize`])
//! and writes back: the members its normalizer always sets are required
//! here, the ones it sets only when the file had them are optional and
//! left out when absent. A model read and written again is therefore the
//! model the app would have written.

use crate::options::AnalysisOptions;
use cslope_engine::model::canonical::SlopeOrientation;
use cslope_engine::model::waternet::Waternet;
use cslope_engine::types::{MaterialModel, SlopeDefinition};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub type Point = [f64; 2];

/// One model of a project (`models/<id>/model.json` of a `.cslp` file).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub orientation: SlopeOrientation,
    pub project_info: ProjectInfo,
    pub coordinates: Vec<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinate_expressions: Option<Vec<CoordinateExpression>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Vec<ParameterDef>>,
    pub materials: Vec<MaterialRow>,
    pub material_boundaries: Vec<MaterialBoundaryRow>,
    pub region_materials: Vec<RegionAssignmentRow>,
    pub piezometric_line: PiezometricLineState,
    pub udls: Vec<UdlRow>,
    pub line_loads: Vec<LineLoadRow>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcements: Option<Vec<ReinforcementRow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub piles: Option<Vec<PileRow>>,
    /// The analysis options, complete (the app's defaults where the file
    /// had none).
    pub options: AnalysisOptions,
    pub analysis_limits: AnalysisLimitsState,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_view_offset: Option<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub edit_view_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_view_offset: Option<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_view_scale: Option<f64>,
    pub custom_search_planes: Vec<CustomSearchPlaneRow>,
    pub custom_planes_only: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_search_objects: Option<Vec<BlockSearchObjectRow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waternet: Option<Waternet>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub earlier_stage: Option<Box<SlopeDefinition>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub import_notes: Option<Vec<String>>,
    pub result_view_settings: ResultViewSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_offset: Option<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<AppMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub locks: Option<ModelLocks>,
}

/// The view a model was left in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppMode {
    Edit,
    Result,
}

/// The title block (`ProjectInfo`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectInfo {
    pub title: String,
    pub subtitle: String,
    pub client: String,
    pub project_number: String,
    pub revision: String,
    pub author: String,
    pub checker: String,
    pub date: String,
    pub description: String,
    pub canvas_width: f64,
    pub canvas_height: f64,
}

impl ProjectInfo {
    /// `createDefaultProjectInfo()`, with `today` (YYYY-MM-DD) as its date.
    pub fn default_for(today: &str) -> ProjectInfo {
        ProjectInfo {
            title: "New slope analysis".into(),
            subtitle: String::new(),
            client: String::new(),
            project_number: String::new(),
            revision: "0".into(),
            author: String::new(),
            checker: String::new(),
            date: today.to_owned(),
            description: String::new(),
            canvas_width: 1000.0,
            canvas_height: 1000.0,
        }
    }
}

/// The expressions of one point (`CoordinateExpression`).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CoordinateExpression {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<String>,
}

/// A parameter of the model's expressions (`ParameterDef`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ParameterDef {
    pub id: String,
    pub name: String,
    pub expression: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialRow {
    pub id: String,
    pub name: String,
    pub color: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub depth_range: Option<[f64; 2]>,
    pub model: MaterialModel,
    /// Expression strings of the numeric fields of the model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model_expressions: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MaterialBoundaryRow {
    pub id: String,
    pub coordinates: Vec<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinate_expressions: Option<Vec<CoordinateExpression>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionAssignmentRow {
    pub point: Point,
    pub material_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiezoLine {
    pub id: String,
    /// (Required in the app's types; a hand-made line without one is kept
    /// without one, as the app keeps it.)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    pub coordinates: Vec<Point>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinate_expressions: Option<Vec<CoordinateExpression>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RapidDrawdownState {
    pub water_before: Vec<Point>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiezometricLineState {
    pub enabled: bool,
    pub lines: Vec<PiezoLine>,
    /// Written as `null` when there is none, as the app writes it.
    pub active_line_id: Option<String>,
    /// The line of each material, by material id.
    pub material_assignment: BTreeMap<String, String>,
    /// Absent: true (a file of schema version 3; older files are migrated
    /// by the app).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub free_water: Option<bool>,
    /// Absent: the first line.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub main_line_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rapid_drawdown: Option<RapidDrawdownState>,
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UdlExcessPorePressureRow {
    pub material_id: String,
    pub ratio: f64,
}

/// The expressions of a distributed load's fields.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UdlExpressions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnitude: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x1: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x2: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UdlRow {
    pub id: String,
    pub magnitude: f64,
    pub x1: f64,
    pub x2: f64,
    /// "normal"; absent: vertical.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub excess_pore_pressure: Option<Vec<UdlExcessPorePressureRow>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expressions: Option<UdlExpressions>,
}

/// The expressions of a line load's fields.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LineLoadExpressions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub magnitude: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LineLoadRow {
    pub id: String,
    pub magnitude: f64,
    pub x: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub angle: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expressions: Option<LineLoadExpressions>,
}

/// A reinforcement element (`ReinforcementRow`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CustomSearchPlaneRow {
    pub id: String,
    pub cx: f64,
    pub cy: f64,
    pub radius: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Point>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BlockSearchObjectRow {
    pub id: String,
    pub points: Vec<Point>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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

/// Objects locked against editing on the canvas (`ModelLocks`): only the
/// members that are set are written (`true`, or a list with ids).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelLocks {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exterior: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub boundaries: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub water_lines: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loads: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reinforcement: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_limits: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_surfaces: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backgrounds: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from_import: Option<bool>,
}

/// The result sheet (`ResultViewSettings`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultViewSettings {
    /// "critical", "all" or "filter".
    pub surface_display: String,
    pub fos_filter_max: f64,
    pub show_slices: bool,
    pub show_fos_label: bool,
    pub show_centre_marker: bool,
    pub show_grid: bool,
    pub show_soil_color: bool,
    /// Written only as `false`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_fem_plastic_zone: Option<bool>,
    /// Written only as `true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_fem_mesh: Option<bool>,
    /// Written only as `true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_custom_surfaces: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_spacing: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid_line_spacing: Option<f64>,
    /// A whole number, 0 to 20.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub minor_ticks: Option<f64>,
    pub annotations: Vec<Annotation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_order: Option<Vec<String>>,
    pub paper_frame: PaperFrameSettings,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view_lock: Option<ViewLock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf_summary_pages: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdf_title_line: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layer_styles: Option<ResultLayerStyles>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PaperFrameSettings {
    /// "A4", "A3", "A2", "A1" or "A0".
    pub paper_size: String,
    pub landscape: bool,
    pub show_frame: bool,
    pub zoom: f64,
    pub offset_x: f64,
    pub offset_y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ViewLock {
    pub bottom_left: Point,
    pub top_right: Point,
}

/// An annotation of the result sheet: a paper annotation (`type` "text",
/// "material-table", "color-bar" or "plot", anchored at `x`, `y` as
/// fractions of the paper) or a reference annotation (`type` "reference",
/// `shape` "polyline" or "circle", in model coordinates). One struct with
/// the members of both, as the app's `Annotation` union; the normalizer
/// checks which members a kind may have.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Annotation {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub table_columns: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot_axis_x: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plot_axis_y: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_max: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheme: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheme_from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheme_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scheme_mid: Option<String>,
    // reference annotations
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub show_in_edit: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub points: Option<Vec<Point>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cx: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cy: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub clip: Option<String>,
}

/// The styles of the display layers (`ResultLayerStyles`): each member an
/// override, absent where the layer is drawn as always.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ResultLayerStyles {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soil_color: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem_mesh: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem_plastic_zone: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surfaces: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom_surfaces: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub critical_surface: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slices: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub center: Option<LayerStyle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fos_label: Option<LayerStyle>,
}

/// The style of one display layer: the fields a layer may have (the
/// normalizer keeps those of its layer).
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LayerStyle {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub decimals: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius_lines: Option<bool>,
}

/// The colors of materials without one (`MATERIAL_COLORS`).
pub const MATERIAL_COLORS: [&str; 6] = [
    "#d4a373", "#a8c686", "#b5838d", "#6d6875", "#e5989b", "#ffb4a2",
];

/// The colors of piezometric lines (`PIEZO_COLORS`).
pub const PIEZO_COLORS: [&str; 6] = [
    "#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899",
];

/// `DEFAULT_RESULT_VIEW_SETTINGS`.
pub fn default_result_view_settings() -> ResultViewSettings {
    ResultViewSettings {
        surface_display: "critical".into(),
        fos_filter_max: 1.5,
        show_slices: true,
        show_fos_label: true,
        show_centre_marker: true,
        show_grid: true,
        show_soil_color: true,
        show_fem_plastic_zone: None,
        show_fem_mesh: None,
        show_custom_surfaces: None,
        grid_spacing: None,
        grid_line_spacing: None,
        minor_ticks: None,
        annotations: vec![
            Annotation {
                id: "anno-8d2aabaf-31cb-43b5-b9a5-980aa7354464".into(),
                kind: "text".into(),
                x: Some(0.11),
                y: Some(0.08),
                text: Some("#Title".into()),
                font_size: Some(24.0),
                ..Annotation::default()
            },
            Annotation {
                id: "anno-89ddb1d9-0f29-4483-849a-bf5c09ea5076".into(),
                kind: "text".into(),
                x: Some(0.11),
                y: Some(0.13),
                text: Some("#Subtitle".into()),
                font_size: Some(14.0),
                ..Annotation::default()
            },
            Annotation {
                id: "anno-default-material-table".into(),
                kind: "material-table".into(),
                x: Some(0.94),
                y: Some(0.06),
                anchor: Some("top-right".into()),
                font_size: Some(8.0),
                table_columns: Some(
                    ["model", "unitWeight", "cohesion", "frictionAngle"]
                        .iter()
                        .map(|s| s.to_string())
                        .collect(),
                ),
                ..Annotation::default()
            },
        ],
        layer_order: None,
        paper_frame: PaperFrameSettings {
            paper_size: "A4".into(),
            landscape: true,
            show_frame: true,
            zoom: 1.0,
            offset_x: 0.0,
            offset_y: 0.0,
        },
        view_lock: Some(ViewLock {
            bottom_left: [-1.0, -1.0],
            top_right: [26.0, 18.09090909090909],
        }),
        pdf_summary_pages: None,
        pdf_title_line: None,
        layer_styles: None,
    }
}

/// The path of a deserialization error: "" for the root.
fn error_path(e: &serde_path_to_error::Error<serde_json::Error>) -> String {
    let path = e.path().to_string();
    if path == "." {
        String::new()
    } else {
        path
    }
}

/// A typed value from JSON, with the path of what cannot be read in the
/// message ("<what> cannot be read at <path>: <why>").
pub(crate) fn from_json_typed<T: serde::de::DeserializeOwned>(
    what: &str,
    value: Value,
) -> Result<T, String> {
    serde_path_to_error::deserialize(value).map_err(|e| {
        let path = error_path(&e);
        if path.is_empty() {
            format!("{what} cannot be read: {}", e.inner())
        } else {
            format!("{what} cannot be read at {path}: {}", e.inner())
        }
    })
}

impl ModelEntry {
    /// The model as JSON (the app's shape).
    pub fn to_json(&self) -> Value {
        serde_json::to_value(self).expect("a model is JSON")
    }

    /// A model from the JSON of a `model.json`, which must hold the shape
    /// the app writes (every member known, the required ones present), with
    /// the path of what cannot be read in the message. A file as saved is
    /// read with [`crate::normalize::read_model`], which fills, clamps and
    /// drops members as the app does before this.
    pub fn from_json(value: Value) -> Result<ModelEntry, String> {
        from_json_typed("The model", value)
    }
}
