//! Engine errors as JavaScript errors (ARCHITECTURE.md §2.3): the message
//! unchanged, `RangeError` for `ErrorKind::Range`, `Error` otherwise
//! (cancellation included: the app terminates the worker instead).

use cslope_engine::error::{EngineError, ErrorKind};
use wasm_bindgen::JsValue;

/// A JavaScript error object for an engine error.
pub fn to_js_error(e: &EngineError) -> JsValue {
    match e.kind {
        ErrorKind::Range => js_sys::RangeError::new(&e.message).into(),
        ErrorKind::Error | ErrorKind::Cancelled => js_sys::Error::new(&e.message).into(),
    }
}

/// `throw new Error(message)` for errors of the boundary itself (a value of
/// the wrong shape, a stale handle).
pub fn js_error(message: &str) -> JsValue {
    js_sys::Error::new(message).into()
}

/// `throw new TypeError(message)`: an argument JavaScript would also reject
/// with a TypeError (wrong shape for serde).
pub fn type_error(message: &str) -> JsValue {
    js_sys::TypeError::new(message).into()
}

/// The result of an engine call, its error mapped.
pub trait IntoJsResult<T> {
    fn js(self) -> Result<T, JsValue>;
}

impl<T> IntoJsResult<T> for Result<T, EngineError> {
    fn js(self) -> Result<T, JsValue> {
        self.map_err(|e| to_js_error(&e))
    }
}
