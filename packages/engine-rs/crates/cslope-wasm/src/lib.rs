//! WebAssembly API of the cSlope engine (not a port: ARCHITECTURE.md §3).
//!
//! The TypeScript facade in `packages/engine/src/facade` calls these
//! exports; nothing else should. Conventions:
//!
//! - Export names are the Rust function names (snake_case); the facade gives
//!   them their TypeScript names and argument shapes.
//! - Numbers and number lists cross as `f64` and `&[f64]` (a plain JS array
//!   or a `Float64Array`); every other value crosses with serde-wasm-bindgen
//!   ([`convert::to_js`], [`convert::from_js`]): API types keep their
//!   TypeScript JSON shape, `NaN` and the infinities pass unchanged.
//! - Errors keep the engine's message and kind: `RangeError` for
//!   `ErrorKind::Range`, `Error` otherwise ([`errors`]).
//! - Stateful objects live in a handle registry ([`registry`]); the facade
//!   holds the `u32` handle.
//! - Feature `testing` adds `__test_call(name, args)` for internal functions
//!   the TypeScript unit tests import ([`testing`]).

// The port keeps TypeScript's argument lists (many numbers).
#![allow(clippy::too_many_arguments)]

pub mod api;
pub mod clock;
pub mod convert;
pub mod errors;
pub mod panic;
pub mod registry;
#[cfg(feature = "testing")]
pub mod testing;
#[cfg(feature = "testing")]
pub mod testing_le;

use wasm_bindgen::prelude::*;

/// Runs once when the module is instantiated (`initSync` / `init`).
#[wasm_bindgen(start)]
pub fn start() {
    panic::install_hook();
}

/// The crate version and whether this is the testing build, for the
/// facade's sanity check and BUILD-INFO.
#[wasm_bindgen]
pub fn engine_build() -> String {
    format!(
        "cslope-wasm {}{}",
        env!("CARGO_PKG_VERSION"),
        if cfg!(feature = "testing") {
            " (testing)"
        } else {
            ""
        }
    )
}
