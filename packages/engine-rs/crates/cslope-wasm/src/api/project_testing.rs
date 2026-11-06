//! The conversion between the app's model and the engine's definition
//! (crate cslope-project, issue #57), in the testing build only until the
//! app switches to it: dispatched by `__test_call` for names starting
//! `project::` (see `testing.rs`). The values cross as JSON.

use crate::convert::{from_js, to_js};
use crate::errors::js_error;
use cslope_engine::types::SlopeDefinition;
use cslope_project::{definition_to_model, model_to_definition, DefinitionModelInfo, ModelEntry};
use serde_json::Value;
use wasm_bindgen::JsValue;

/// Every name [`call`] dispatches.
pub const PROJECT_TEST_FUNCTIONS: &[&str] =
    &["project::modelToDefinition", "project::definitionToModel"];

/// `project::modelToDefinition(model)`: `buildModelSpaceSlopeDTO`;
/// `project::definitionToModel(definition, { id, name, options? })`:
/// `modelFromDefinition` without the project block and the paper.
pub fn call(name: &str, a: JsValue) -> Result<JsValue, JsValue> {
    let args: Vec<Value> = from_js(a, "arguments")?;
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    match name {
        "project::modelToDefinition" => {
            let model = ModelEntry::from_json(arg(0)).map_err(|e| js_error(&e))?;
            to_js(&model_to_definition(&model))
        }
        "project::definitionToModel" => {
            let def: SlopeDefinition = serde_json::from_value(arg(0))
                .map_err(|e| js_error(&format!("definition: {e}")))?;
            let info = arg(1);
            let info = DefinitionModelInfo {
                id: info["id"].as_str().unwrap_or_default().to_owned(),
                name: info["name"].as_str().unwrap_or_default().to_owned(),
                options: info.get("options").and_then(Value::as_object).cloned(),
            };
            let model = definition_to_model(&def, &info).map_err(|e| js_error(&e.0))?;
            to_js(&model.to_json())
        }
        _ => Err(js_error(&format!(
            "__test_call: no internal function \"{name}\" in the testing build"
        ))),
    }
}
