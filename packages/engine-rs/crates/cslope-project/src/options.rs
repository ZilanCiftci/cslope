//! The app's analysis options as a model holds them after the project was
//! opened (`AnalysisOptions` of packages/engine, as `normalizeAnalysisOptions`
//! in store/persistence.ts fills them): the app's defaults with every saved
//! field checked and clamped. The 17 members the app always sets are
//! required; the 12 it sets only when the file had a valid value are
//! optional. The input hash (docs/file-format.md section 5) is over these
//! options as they are, so their set of members must be the app's.

use cslope_engine::types::{FemAnalysisSettings, PartialFactors, Sgi3dSettings};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalysisOptions {
    pub slices: f64,
    pub iterations: f64,
    pub refined_iterations: f64,
    pub min_failure_dist: f64,
    pub tolerance: f64,
    pub max_iterations: f64,
    /// "Bishop", "Janbu" or "Morgenstern-Price".
    pub method: String,
    pub janbu_correction: bool,
    /// "constant", "half-sine", "clipped-sine", "trapezoidal" or
    /// "data-point-specified".
    pub interslice_function: String,
    pub interslice_data_points: Vec<[f64; 2]>,
    /// "vertical" or "phreatic-correction".
    pub pore_pressure_head: String,
    pub tension_crack_depth: f64,
    pub tension_crack_water: f64,
    pub non_circular_optimization: bool,
    pub min_slip_depth: f64,
    pub min_slip_area: f64,
    pub composite_surfaces: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub partial_factors: Option<PartialFactors>,
    /// Written only as `true`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub both_directions: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composite_base: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tension_crack_auto: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seismic_horizontal: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seismic_vertical: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tension_crack_angle: Option<f64>,
    /// "block"; absent: circular.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_method: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_active_angle: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub block_passive_angle: Option<[f64; 2]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fem: Option<FemAnalysisSettings>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sgi3d: Option<Sgi3dSettings>,
}

impl AnalysisOptions {
    /// `APP_DEFAULT_ANALYSIS_OPTIONS`: the options of a new model.
    pub fn app_default() -> AnalysisOptions {
        AnalysisOptions {
            slices: 30.0,
            iterations: 1000.0,
            refined_iterations: 500.0,
            min_failure_dist: 0.0,
            tolerance: 0.001,
            max_iterations: 15.0,
            method: "Morgenstern-Price".into(),
            janbu_correction: false,
            interslice_function: "half-sine".into(),
            interslice_data_points: Vec::new(),
            pore_pressure_head: "vertical".into(),
            tension_crack_depth: 0.0,
            tension_crack_water: 0.0,
            non_circular_optimization: false,
            min_slip_depth: 0.0,
            min_slip_area: 0.0,
            composite_surfaces: true,
            partial_factors: None,
            both_directions: None,
            composite_base: None,
            tension_crack_auto: None,
            seismic_horizontal: None,
            seismic_vertical: None,
            tension_crack_angle: None,
            search_method: None,
            block_active_angle: None,
            block_passive_angle: None,
            fem: None,
            sgi3d: None,
        }
    }

    /// The options as a JSON object (the engine's `AnalysisOptions` shape).
    pub fn to_map(&self) -> Map<String, Value> {
        match serde_json::to_value(self).expect("options are JSON") {
            Value::Object(o) => o,
            _ => unreachable!("options are an object"),
        }
    }

    /// Typed options from their JSON object, as the app's normalizer
    /// writes it (every member known).
    pub fn from_map(map: Map<String, Value>) -> Result<AnalysisOptions, String> {
        crate::model::from_json_typed("The analysis options", Value::Object(map))
    }
}

/// `APP_DEFAULT_ANALYSIS_OPTIONS` as a JSON object.
pub fn app_default_options() -> Map<String, Value> {
    AnalysisOptions::app_default().to_map()
}
