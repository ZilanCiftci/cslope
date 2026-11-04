//! Values across the boundary with serde-wasm-bindgen (ARCHITECTURE.md §3.1).
//!
//! Serialisation: maps become plain objects (`serialize_maps_as_objects`),
//! a `None` that is not skipped becomes `null` (`serialize_missing_as_null`):
//! the engine's serde types skip the optional fields TypeScript leaves out,
//! and a field that is kept as `None` is a TypeScript `T | null` (or `null`
//! in the JSON the engine ports), so `null` is its value.
//!
//! Deserialisation: missing fields and fields whose value is `undefined` are
//! absent (`without_undefined`: serde-wasm-bindgen reads `undefined` as
//! `null`, and the engine reads `null` as TypeScript does, which differs from
//! `undefined`: `{ slices: null }` is an error, `{ slices: undefined }` is
//! no option); unknown fields are ignored; numbers pass unchanged (`NaN`,
//! ±`Infinity`).

use crate::errors::type_error;
use js_sys::{Array, ArrayBuffer, Object, Reflect};
use serde::de::DeserializeOwned;
use serde::Serialize;
use wasm_bindgen::{JsCast, JsValue};

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
    serde_wasm_bindgen::from_value(without_undefined(&value))
        .map_err(|e| type_error(&format!("{what}: {e}")))
}

/// Whether `v` is a plain object (`{…}`, or one without a prototype): the
/// values whose own fields are the data. Class instances (getters on the
/// prototype), typed arrays and other objects are left as they are.
fn is_plain_object(v: &JsValue) -> bool {
    if !v.is_object() || Array::is_array(v) || ArrayBuffer::is_view(v) {
        return false;
    }
    let proto = Object::get_prototype_of(v);
    proto.is_null() || proto == Object::get_prototype_of(&Object::new())
}

/// `value` with the fields whose value is `undefined` left out, in plain
/// objects at any depth (also inside lists). Copy on write: a value without
/// such a field is returned as it is, the caller's objects are never
/// changed.
pub fn without_undefined(value: &JsValue) -> JsValue {
    stripped(value).unwrap_or_else(|| value.clone())
}

/// The copy of `value` without its `undefined` fields, or `None` if it has
/// none.
fn stripped(value: &JsValue) -> Option<JsValue> {
    if Array::is_array(value) {
        let array: &Array = value.unchecked_ref();
        let mut copy: Option<Array> = None;
        for (i, item) in array.iter().enumerate() {
            if let Some(s) = stripped(&item) {
                copy.get_or_insert_with(|| array.slice(0, array.length()))
                    .set(i as u32, s);
            }
        }
        return copy.map(JsValue::from);
    }
    if !is_plain_object(value) {
        return None;
    }
    let mut changed = false;
    let mut fields: Vec<(JsValue, JsValue)> = Vec::new();
    for e in Object::entries(value.unchecked_ref()).iter() {
        let pair: Array = e.unchecked_into();
        let v = pair.get(1);
        if v.is_undefined() {
            changed = true;
            continue;
        }
        let v = match stripped(&v) {
            Some(s) => {
                changed = true;
                s
            }
            None => v,
        };
        fields.push((pair.get(0), v));
    }
    if !changed {
        return None;
    }
    let out = Object::new();
    for (k, v) in fields {
        // (a new plain object's own field: setting it cannot fail)
        let _ = Reflect::set(&out, &k, &v);
    }
    Some(out.into())
}
