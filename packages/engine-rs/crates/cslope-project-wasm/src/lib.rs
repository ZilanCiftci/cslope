//! The `.cslp` writer in WebAssembly (issue #107): the browser page's
//! "Download .cslp". A module of its own, loaded on demand, so that the
//! engine (cslope-wasm) stays within its size budget.
//!
//! [`project_from_definition`] makes the app's model of a definition
//! (`cslope_project::definition_to_model`) and writes a project of it, with
//! the result of its last analysis, as the app and the Python package
//! write one (`cslope_project::archive`). The values cross as JSON text
//! (`JSON.stringify`, as the app writes its files: a non-finite number is
//! `null`).

use cslope_engine::types::SlopeDefinition;
use cslope_project::archive::{project_from_definition as write, DefinitionProject, Writer};
use cslope_project::project::EngineInfo;
use cslope_project::DefinitionModelInfo;
use serde::Deserialize;
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;

/// What [`project_from_definition`] takes besides the definition and the
/// result (`ProjectFromDefinitionOptions` in packages/engine).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectArgs {
    /// The model's id (a folder name; default "model-1").
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    /// The analysis options over the app's defaults, those the result was
    /// computed with.
    #[serde(default)]
    pub options: Option<Map<String, Value>>,
    /// The model's date, YYYY-MM-DD (default the date of `modified`).
    #[serde(default)]
    pub date: Option<String>,
    /// When the file is saved, ISO 8601 (`Date.toISOString()`).
    pub modified: String,
    pub app_version: String,
    pub generator: String,
    /// The engine that computed the result.
    #[serde(default)]
    pub engine: Option<EngineInfo>,
}

/// The project's bytes and whether the result is in it.
pub struct ProjectFile {
    pub bytes: Vec<u8>,
    pub result_saved: bool,
}

/// [`project_from_definition`] on Rust values.
pub fn write_project(
    definition: &SlopeDefinition,
    result: Option<Value>,
    args: ProjectArgs,
) -> Result<ProjectFile, String> {
    let had_result = result.is_some();
    let project = DefinitionProject {
        info: DefinitionModelInfo {
            id: args.id.unwrap_or_else(|| "model-1".into()),
            name: args.name,
            options: args.options,
        },
        date: args.date,
        result,
        engine: args.engine.unwrap_or_default(),
    };
    let writer = Writer {
        app_version: args.app_version,
        generator: args.generator,
        modified: Some(args.modified),
    };
    let (bytes, report) = write(definition, &project, &writer)?;
    Ok(ProjectFile {
        bytes,
        result_saved: had_result && report.dropped_results.is_empty(),
    })
}

fn parse<T: serde::de::DeserializeOwned>(json: &str, what: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|e| format!("{what}: {e}"))
}

/// The `.cslp` project of a definition (JSON, in model coordinates) and
/// the result of its last analysis (JSON, or `null`: none; a result of
/// other input must not be given), with `args` (JSON: `{ id?, name,
/// options?, date?, modified, appVersion, generator, engine? }`). Returns
/// `{ bytes: Uint8Array, resultSaved: boolean }`: the result is left out
/// when the model would not read back as the definition. Throws an `Error`
/// with the reason when the definition cannot be made a model.
#[wasm_bindgen]
pub fn project_from_definition(
    definition: &str,
    result: &str,
    args: &str,
) -> Result<JsValue, JsValue> {
    let file = (|| {
        let definition: SlopeDefinition = parse(definition, "slope definition")?;
        let result: Option<Value> = parse(result, "analysis result")?;
        write_project(&definition, result, parse(args, "project")?)
    })()
    .map_err(|e| JsValue::from(js_sys::Error::new(&e)))?;
    let out = js_sys::Object::new();
    js_sys::Reflect::set(
        &out,
        &"bytes".into(),
        &js_sys::Uint8Array::from(&file.bytes[..]).into(),
    )?;
    js_sys::Reflect::set(&out, &"resultSaved".into(), &file.result_saved.into())?;
    Ok(out.into())
}

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console, js_name = error)]
    fn console_error(message: &str);
}

/// Runs once when the module is instantiated: a panic (which aborts: the
/// instance traps) first writes its message to `console.error`.
#[wasm_bindgen(start)]
pub fn start() {
    #[cfg(target_arch = "wasm32")]
    std::panic::set_hook(Box::new(|info| {
        console_error(&format!("cSlope project writer panicked: {info}"));
    }));
}
