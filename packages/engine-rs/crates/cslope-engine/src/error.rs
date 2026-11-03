//! The engine's error type: the kind and message of the TypeScript error it
//! ports (`Error`, `RangeError`) plus cancellation.

use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// TypeScript `Error`.
    Error,
    /// TypeScript `RangeError` (`Material`, `getYAtXStrict`, …); tests check
    /// the kind.
    Range,
    /// The analysis was cancelled through a `CancelToken`.
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EngineError {
    pub kind: ErrorKind,
    pub message: String,
}

impl EngineError {
    /// `throw new Error(message)`.
    pub fn new(message: impl Into<String>) -> Self {
        EngineError {
            kind: ErrorKind::Error,
            message: message.into(),
        }
    }

    /// `throw new RangeError(message)`.
    pub fn range(message: impl Into<String>) -> Self {
        EngineError {
            kind: ErrorKind::Range,
            message: message.into(),
        }
    }

    pub fn cancelled() -> Self {
        EngineError {
            kind: ErrorKind::Cancelled,
            message: "The analysis was cancelled.".into(),
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for EngineError {}

pub type Result<T> = std::result::Result<T, EngineError>;
