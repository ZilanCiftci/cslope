//! cSlope slope stability engine.
//!
//! A port of the TypeScript engine in `packages/engine/src`. The module tree
//! mirrors the TypeScript one (`types`, `math`, `model`, `fem`); each Rust
//! file names the TypeScript file it ports. See `packages/engine-rs/PORTING.md`.

// The port keeps TypeScript's NaN-aware comparisons such as `!(x > 0)` and
// `x >= a && x <= b` as they are.
#![allow(clippy::neg_cmp_op_on_partial_ord, clippy::manual_range_contains)]

pub mod error;
pub mod fem;
pub mod js;
pub mod math;
pub mod model;
pub mod types;
