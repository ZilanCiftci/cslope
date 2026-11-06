//! The testing build's dispatcher (feature `testing`, ARCHITECTURE.md §3.3):
//! `__test_call(name, args)` runs an internal engine function that the
//! TypeScript tests import but the product API does not export.
//!
//! `name` is `"<TypeScript module path>::<TypeScript name>"`, for example
//! `"fem/model::buildFeModel"`; `args` is the argument list as a JavaScript
//! array, every parameter present (the facade passes `undefined` for an
//! omitted optional one). Handles of engine objects appear in `args` as
//! `{ $slope: h }`. The internal functions that only the Rust tests test
//! have no entry here (issue #51): only the finite element model and its
//! strength reduction, which the facade's FE tests use, are dispatched
//! ([`crate::api::fem_testing`]).

use crate::errors::js_error;
use wasm_bindgen::prelude::*;

/// Runs the internal function `name` on `args` (see the module docs).
#[wasm_bindgen]
pub fn __test_call(name: &str, a: JsValue) -> Result<JsValue, JsValue> {
    if name.starts_with("fem/") {
        return crate::api::fem_testing::call(name, a);
    }
    Err(js_error(&format!(
        "__test_call: no internal function \"{name}\" in the testing build"
    )))
}

/// The names `__test_call` dispatches.
#[wasm_bindgen]
pub fn __test_functions() -> Vec<String> {
    crate::api::fem_testing::FEM_TEST_FUNCTIONS
        .iter()
        .map(|s| s.to_string())
        .collect()
}
