//! The input hash of a model's result (docs/file-format.md section 5,
//! `analysisInputHash` in packages/desktop/src/features/project/input-hash.ts):
//! the SHA-256, as 64 lowercase hex digits, of the canonical JSON of
//! `{ "definition": <the engine's definition of the model in canonical
//! orientation, as the app sends it to the engine>, "options": <the
//! model's options as saved> }`. Nothing else of the model (its name,
//! views, annotations, result settings) is in it. A result whose hash is
//! not the model's was computed for other input. The model is taken as it
//! reads back from its `model.json` (as the app takes it).

use crate::canonical::canonical_json;
use crate::convert::model_to_definition;
use crate::model::ModelEntry;
use cslope_engine::model::canonical::to_canonical_slope_definition;
use serde_json::json;
use sha2::{Digest, Sha256};

/// The text that is hashed: the model's analysis input as canonical JSON
/// (`analysisInputJson`), or why the definition cannot be turned to its
/// canonical orientation.
pub fn analysis_input_json(model: &ModelEntry) -> Result<String, String> {
    // the model as it reads back from its model.json (as the app hashes it)
    let model = &crate::normalize::read_model(
        &model.to_json(),
        &crate::normalize::ReadOptions {
            strict: false,
            today: &model.project_info.date,
        },
    )
    .map_err(|e| e.0)?;
    let definition =
        to_canonical_slope_definition(&model_to_definition(model), None).map_err(|e| e.message)?;
    let definition = serde_json::to_value(definition).map_err(|e| e.to_string())?;
    Ok(canonical_json(&json!({
        "definition": definition,
        "options": model.options.to_map(),
    })))
}

/// SHA-256 of bytes as 64 lowercase hex digits.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// The model's input hash (`analysisInputHash`).
pub fn input_hash(model: &ModelEntry) -> Result<String, String> {
    Ok(sha256_hex(analysis_input_json(model)?.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_of_abc() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
