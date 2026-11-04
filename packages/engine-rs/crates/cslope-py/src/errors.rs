//! The engine's errors as Python exceptions (ARCHITECTURE.md §2.3):
//! `EngineError::range` is a `ValueError`, TypeScript's own `TypeError` a
//! `TypeError`, a cancelled run `cslope.AnalysisCancelled` and everything
//! else `cslope.EngineError` (a `RuntimeError`). The message is the engine's,
//! unchanged.

use cslope_engine::error::{EngineError as Error, ErrorKind};
use pyo3::create_exception;
use pyo3::exceptions::{PyRuntimeError, PyTypeError, PyValueError};
use pyo3::prelude::*;

create_exception!(
    cslope,
    EngineError,
    PyRuntimeError,
    "An error reported by the engine (an invalid model, no valid slip surface, ...)."
);
create_exception!(
    cslope,
    AnalysisCancelled,
    EngineError,
    "The analysis was cancelled: a progress callback returned False, or a CancelToken was cancelled."
);

/// The Python exception of an engine error.
pub fn to_py(e: Error) -> PyErr {
    match e.kind {
        ErrorKind::Range => PyValueError::new_err(e.message),
        ErrorKind::Type => PyTypeError::new_err(e.message),
        ErrorKind::Cancelled => AnalysisCancelled::new_err(e.message),
        ErrorKind::Error => EngineError::new_err(e.message),
    }
}

/// `.py()?` on an engine result.
pub trait IntoPyResult<T> {
    fn py(self) -> PyResult<T>;
}

impl<T> IntoPyResult<T> for Result<T, Error> {
    fn py(self) -> PyResult<T> {
        self.map_err(to_py)
    }
}
