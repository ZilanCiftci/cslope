//! Values across the boundary with serde-wasm-bindgen (ARCHITECTURE.md §3.1).
//!
//! Serialisation: maps become plain objects (`serialize_maps_as_objects`),
//! a `None` that is not skipped becomes `null` (`serialize_missing_as_null`):
//! the engine's serde types skip the optional fields TypeScript leaves out,
//! and a field that is kept as `None` is a TypeScript `T | null` (or `null`
//! in the JSON the engine ports), so `null` is its value.
//!
//! Deserialisation: `undefined` and missing fields are `None`, unknown fields
//! are ignored; numbers pass unchanged (`NaN`, ±`Infinity`).

use crate::errors::type_error;
use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::JsValue;

fn serializer() -> serde_wasm_bindgen::Serializer {
    serde_wasm_bindgen::Serializer::new()
        .serialize_missing_as_null(true)
        .serialize_maps_as_objects(true)
}

/// A Rust value as a JavaScript value.
pub fn to_js<T: Serialize + ?Sized>(value: &T) -> Result<JsValue, JsValue> {
    value
        .serialize(&serializer())
        .map_err(|e| type_error(&e.to_string()))
}

/// A JavaScript value as a Rust value; a value of the wrong shape is a
/// `TypeError` naming `what`.
pub fn from_js<T: DeserializeOwned>(value: JsValue, what: &str) -> Result<T, JsValue> {
    serde_wasm_bindgen::from_value(value).map_err(|e| type_error(&format!("{what}: {e}")))
}
