//! Run-level additions that are not ports (ARCHITECTURE.md §2.1): the run
//! context and the product path of an analysis (`run_analysis`, the port
//! of packages/engine/src/api/run-analysis.ts).

pub mod ctx;
pub mod run_analysis;
pub mod summary;
