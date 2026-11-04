//! The product API, one module per engine area. Each export names the
//! engine function it calls; the facade shim in
//! `packages/engine/src/facade/<path>.ts` gives it the TypeScript name and
//! argument shapes.

pub mod analysis;
pub mod canonical;
pub mod fem;
#[cfg(feature = "testing")]
pub mod fem_testing;
pub mod geometry;
pub mod math;
pub mod model;
pub mod slope;
pub mod types;
pub mod wire;
