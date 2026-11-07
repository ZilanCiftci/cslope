//! The `.cslp` ZIP container (docs/file-format.md section 1): writing the
//! entries of [`Project::entries`] as the app lays them out (the JSON
//! entries deflated, the attachments and the thumbnail stored, one time
//! stamp), in memory (feature `write`, which the WebAssembly build takes);
//! reading with the reader's limits and saving to a file atomically
//! (feature `native`).
//!
//! The bytes are not the app's: the app deflates with the browser's
//! `CompressionStream` and stamps local time; this deflates with miniz_oxide
//! and stamps the manifest's `modified` in UTC. The entries' content is the
//! same. The same project and time give the same bytes.

use crate::convert::{definition_to_model, DefinitionModelInfo};
use crate::hash::{definition_input_json, sha256_hex};
use crate::model::MATERIAL_COLORS;
use crate::project::{iso_parts, EngineInfo, Project, SaveReport, SavedResult};
use cslope_engine::js::math as jmath;
use cslope_engine::types::{SlopeDefinition, WaterTableMode, WaterTableValue};
use serde_json::Value;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

#[cfg(feature = "native")]
pub use read::{
    read_project, save_atomically, MAX_ASSET_BYTES, MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_FILE_BYTES,
    MAX_JSON_BYTES,
};

#[cfg(feature = "native")]
mod read;

/// Who writes a file, for the manifest.
#[derive(Debug, Clone)]
pub struct Writer {
    /// The manifest's `appVersion`.
    pub app_version: String,
    /// The manifest's `generator`.
    pub generator: String,
    /// When the file is saved (ISO 8601; default now).
    pub modified: Option<String>,
}

/// The project as a `.cslp` archive, after the save policy (which it
/// applies to `project`).
pub fn write_project(
    project: &mut Project,
    writer: &Writer,
) -> Result<(Vec<u8>, SaveReport), String> {
    let report = project.apply_save_policy()?;
    let modified = writer
        .modified
        .clone()
        .unwrap_or_else(crate::project::now_iso);
    let manifest = project.manifest_for_save(&modified, &writer.app_version, &writer.generator);
    let entries = project.entries(&manifest)?;
    let stamp = iso_parts(&modified)
        .and_then(|(y, mo, d, h, mi, s)| {
            DateTime::from_date_and_time(y.max(1980), mo, d, h, mi, s).ok()
        })
        .unwrap_or_default();
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, data, deflate) in entries {
        let options = SimpleFileOptions::default()
            .compression_method(if deflate {
                CompressionMethod::Deflated
            } else {
                CompressionMethod::Stored
            })
            .last_modified_time(stamp)
            .large_file(false);
        zip.start_file(name.as_str(), options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&data).map_err(|e| e.to_string())?;
    }
    let bytes = zip.finish().map_err(|e| e.to_string())?.into_inner();
    project.manifest = manifest;
    Ok((bytes, report))
}

/// What [`project_from_definition`] makes a project of, besides the
/// definition.
#[derive(Debug, Clone, Default)]
pub struct DefinitionProject {
    /// The model's id and name, and its analysis options over the app's
    /// defaults (those the result was computed with).
    pub info: DefinitionModelInfo,
    /// The model's date (YYYY-MM-DD, its `projectInfo.date`); default the
    /// date of the writer's `modified`.
    pub date: Option<String>,
    /// The result of an analysis of the definition with the options (the
    /// engine's `AnalysisResult` in the definition's coordinates), or none
    /// (no analysis, or one of other input: the caller leaves out a result
    /// that is out of date).
    pub result: Option<Value>,
    /// The engine that computed the result.
    pub engine: EngineInfo,
}

/// A `.cslp` project of one model made from an engine definition (the
/// app's `modelFromDefinition`, [`definition_to_model`]), with the result
/// of its last analysis, written in memory as [`write_project`] writes it.
///
/// The result is stamped with the input hash of what it was computed for
/// (the definition and the model's options, docs/file-format.md section
/// 5), and the save policy keeps it only when that is the model's own
/// input, so that the app opens the project with the result current. A
/// model that would not read back as the definition (and so would not
/// give that result in the app) is saved without the result; the report
/// names it then.
pub fn project_from_definition(
    definition: &SlopeDefinition,
    project: &DefinitionProject,
    writer: &Writer,
) -> Result<(Vec<u8>, SaveReport), String> {
    let definition = &as_the_app_holds_it(definition);
    let model = definition_to_model(definition, &project.info).map_err(|e| e.0)?;
    let date = project
        .date
        .clone()
        .or_else(|| {
            writer
                .modified
                .as_ref()
                .and_then(|m| m.get(..10))
                .map(str::to_owned)
        })
        .unwrap_or_else(|| model.project_info.date.clone());
    // the model as the app reads it back from its model.json
    let mut json = model.to_json();
    json["projectInfo"]["date"] = Value::String(date.clone());
    let model = crate::normalize::read_model(
        &json,
        &crate::normalize::ReadOptions {
            strict: false,
            today: &date,
        },
    )
    .map_err(|e| e.0)?;
    let result = match &project.result {
        None => None,
        Some(r) => {
            let mut saved = SavedResult::done(&model, r.clone(), project.engine.clone())?;
            saved.input_hash =
                sha256_hex(definition_input_json(definition, &model.options)?.as_bytes());
            Some(saved)
        }
    };
    write_project(&mut Project::of_model(model, result), writer)
}

/// The definition as the app's model holds it, for the same analysis:
/// each material without a colour with the colour the model gives it
/// (colours do not change the analysis, but they are in the input hash),
/// the water's free water as the model writes it, and a level water table
/// (mode "height" or "depth", which the model does not have) as the line
/// it stands for. The engine draws a level across
/// the outline, from its least to its greatest x, at the height (or at
/// the depth below the outline's top), so the line gives the same pore
/// pressures (`Slope::set_water_table`).
pub fn as_the_app_holds_it(definition: &SlopeDefinition) -> SlopeDefinition {
    let mut def = definition.clone();
    for (i, m) in def.materials.iter_mut().enumerate() {
        if m.color.is_none() {
            m.color = Some(MATERIAL_COLORS[i % MATERIAL_COLORS.len()].into());
        }
    }
    if let Some(w) = &mut def.water_table {
        // (the model writes each line's `followBoundary`, the inverse of
        // `freeWater`, D-24; the other lines' default follows the main
        // line's free water)
        let main_free = w.free_water;
        for e in def.water_tables.iter_mut().flatten() {
            e.follow_boundary = Some(e.follows_boundary(main_free));
            e.free_water = None;
        }
        w.follow_boundary = Some(w.follows_boundary().unwrap_or(true));
        w.free_water = None;
        if let WaterTableValue::Level(v) = w.value {
            let xs: Vec<f64> = def.coordinates.iter().map(|c| c[0]).collect();
            let ys: Vec<f64> = def.coordinates.iter().map(|c| c[1]).collect();
            let level = match w.mode {
                WaterTableMode::Height => Some(v),
                WaterTableMode::Depth => Some(jmath::max_of(&ys) - v),
                _ => None,
            };
            if let (Some(h), false) = (level, xs.is_empty()) {
                w.mode = WaterTableMode::Custom;
                w.value =
                    WaterTableValue::Points(vec![[jmath::min_of(&xs), h], [jmath::max_of(&xs), h]]);
            }
        }
    }
    def
}
