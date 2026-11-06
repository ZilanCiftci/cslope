//! cSlope projects: the app's model of a `.cslp` file and its conversion to
//! and from the engine's slope definition (issue #57, part 1).
//!
//! - [`model`]: the app's `ModelEntry`, the fields the analysis reads typed
//!   and the rest kept as it is;
//! - [`convert`]: [`model_to_definition`] (the app's
//!   `buildModelSpaceSlopeDTO`) and [`definition_to_model`]
//!   (`modelFromDefinition`), held to the app's own results by
//!   tests/golden.rs.
//!
//! The archive itself (reading and writing `.cslp` files) is part 2; the
//! Python package reads it with the standard library (`cslope.project`).

pub mod convert;
pub mod digest;
pub mod model;
pub mod normalize;
pub mod regions;

pub use convert::{
    app_default_options, definition_to_model, model_to_definition, ConvertError,
    DefinitionModelInfo,
};
pub use model::ModelEntry;
pub use normalize::{normalize_for_run, normalize_model_json};
pub use regions::assign_unassigned_regions;

/// The definition of a model as saved in a project, as JSON (the shape the
/// engine reads), with the model first read as the app opens it
/// ([`normalize_for_run`]).
pub fn model_to_definition_json(model: &serde_json::Value) -> Result<serde_json::Value, String> {
    let model = normalize_for_run(model).map_err(|e| e.0)?;
    serde_json::to_value(model_to_definition(&model)).map_err(|e| e.to_string())
}
