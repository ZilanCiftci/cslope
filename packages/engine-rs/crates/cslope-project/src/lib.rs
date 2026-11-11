//! cSlope projects: the app's model of a `.cslp` file and its conversion to
//! and from the engine's slope definition (issue #57, part 1).
//!
//! - [`model`]: the app's `ModelEntry`, every member typed;
//!   [`normalize`]: the app's reading of a saved model (lenient as the app,
//!   or strict: unknown members refused);
//! - [`convert`]: [`model_to_definition`] (the app's
//!   `buildModelSpaceSlopeDTO`) and [`definition_to_model`]
//!   (`modelFromDefinition`), held to the app's own results by
//!   tests/golden.rs;
//! - [`canonical`] and [`hash`]: the app's canonical JSON and a result's
//!   input hash (issue #58);
//! - [`project`]: a whole project and its JSON entries, with the save
//!   policy; `archive`: the `.cslp` ZIP container (feature `write`: the
//!   writer, in memory, also in WebAssembly; `native`: the reader and the
//!   atomic save to a file).

pub mod canonical;
pub mod convert;
pub mod digest;
pub mod hash;
pub mod model;
pub mod normalize;
pub mod options;
pub mod project;
pub mod regions;

#[cfg(feature = "write")]
pub mod archive;

pub use convert::{definition_to_model, model_to_definition, ConvertError, DefinitionModelInfo};
pub use hash::{analysis_input_json, input_hash};
pub use model::ModelEntry;
pub use normalize::{normalize_for_run, normalize_model_json, read_model, ReadOptions};
pub use options::{app_default_options, AnalysisOptions};
pub use regions::{assign_unassigned_regions, region_index, region_indices};
