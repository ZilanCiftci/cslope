//! JavaScript semantics the engine depends on (not a port of an engine file).
//!
//! The TypeScript engine runs on V8 (Electron, Node). To give the same
//! numbers on every target (native, WebAssembly, Python), every `Math.*`,
//! `**`, number-to-string conversion and sort in the port goes through this
//! module, never through std's `f64` methods or platform libm (see
//! ARCHITECTURE.md §5 and clippy.toml).

pub mod array;
pub mod math;
pub mod num;
