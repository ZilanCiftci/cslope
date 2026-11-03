//! The product API, one module per engine area. Each export names the
//! engine function it calls; the facade shim in
//! `packages/engine/src/facade/<path>.ts` gives it the TypeScript name and
//! argument shapes.

pub mod canonical;
pub mod geometry;
pub mod math;
pub mod types;
