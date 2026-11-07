//! Project files (`.cslp`) from Python: the reader and writer of the crate
//! cslope-project (feature `native`), wrapped by `cslope.project`
//! (python/cslope/project.py). The project crosses as one JSON document
//! (`Project::to_document`) with the attachments' bytes and the thumbnail
//! apart, as `bytes`.

use crate::run::{from_py, to_py};
use cslope_project::archive::{read_project, save_atomically, write_project, Writer};
use cslope_project::project::{EngineInfo, Project, ProjectReadOptions, SavedResult};
use cslope_project::{input_hash, read_model, ModelEntry, ReadOptions};
use pyo3::exceptions::{PyOSError, PyValueError};
use pyo3::prelude::*;
use pyo3::types::{PyBytes, PyDict};
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn invalid(e: impl std::fmt::Display) -> PyErr {
    PyValueError::new_err(e.to_string())
}

/// A model dict as the crate reads it: strictly (an unknown member is an
/// error naming its path).
fn model_of(model: &Bound<'_, PyAny>) -> PyResult<ModelEntry> {
    let value: Value = from_py(model, "model")?;
    let today = cslope_project::normalize::today();
    read_model(
        &value,
        &ReadOptions {
            strict: true,
            today: &today,
        },
    )
    .map_err(|e| invalid(e.0))
}

/// What `project_read` gives: the document, the attachments' bytes by id
/// and the thumbnail.
type ReadParts<'py> = (
    Bound<'py, PyAny>,
    Bound<'py, PyDict>,
    Option<Bound<'py, PyBytes>>,
);

/// Open a `.cslp` file: ``(document, {asset id: bytes}, thumbnail or
/// None)``. Refuses a file of an earlier layout or schema version (the app
/// migrates it), of a newer one, and unknown members, with a message.
#[pyfunction]
pub fn project_read<'py>(py: Python<'py>, path: std::path::PathBuf) -> PyResult<ReadParts<'py>> {
    let bytes = std::fs::read(&path)
        .map_err(|e| PyOSError::new_err(format!("Cannot read {}: {e}", path.display())))?;
    let project = py
        .detach(|| read_project(bytes, &ProjectReadOptions::default()))
        .map_err(invalid)?;
    let assets = PyDict::new(py);
    for a in &project.assets {
        assets.set_item(&a.id, PyBytes::new(py, &a.data))?;
    }
    let thumbnail = project.thumbnail.as_ref().map(|t| PyBytes::new(py, t));
    Ok((to_py(py, &project.to_document())?, assets, thumbnail))
}

/// Write a project (`project_read`'s three parts, edited) to `path`,
/// atomically, after the save policy: a model whose input changed since
/// its result keeps no result, and then the thumbnail goes too. Returns
/// ``{"manifest", "droppedResults", "droppedThumbnail"}``.
#[pyfunction]
#[pyo3(signature = (document, assets, thumbnail, path, app_version, generator))]
pub fn project_write<'py>(
    py: Python<'py>,
    document: &Bound<'py, PyAny>,
    assets: &Bound<'py, PyDict>,
    thumbnail: Option<Vec<u8>>,
    path: std::path::PathBuf,
    app_version: String,
    generator: String,
) -> PyResult<Bound<'py, PyAny>> {
    let doc: Value = from_py(document, "project")?;
    let mut data = BTreeMap::new();
    for (k, v) in assets.iter() {
        data.insert(k.extract::<String>()?, v.extract::<Vec<u8>>()?);
    }
    let report = py.detach(|| -> Result<_, String> {
        let mut project = Project::from_document(&doc, data, thumbnail)?;
        let writer = Writer {
            app_version,
            generator,
            modified: None,
        };
        let (bytes, report) = write_project(&mut project, &writer)?;
        save_atomically(&path, &bytes)?;
        Ok(json!({
            "manifest": project.manifest,
            "droppedResults": report.dropped_results,
            "droppedThumbnail": report.dropped_thumbnail,
        }))
    });
    to_py(py, &report.map_err(invalid)?)
}

/// The input hash of a model (a ``model.json`` dict as `project_read`
/// gives it): the SHA-256 of its analysis input, as the app computes it.
#[pyfunction]
pub fn input_hash_of(model: &Bound<'_, PyAny>) -> PyResult<String> {
    input_hash(&model_of(model)?).map_err(invalid)
}

/// The ``result.json`` of a run of `model`: ``result`` (the engine's
/// result in model coordinates) or ``error`` (a message), stamped with the
/// model's input hash and the engine.
#[pyfunction]
#[pyo3(signature = (model, result=None, error=None))]
pub fn saved_result<'py>(
    py: Python<'py>,
    model: &Bound<'py, PyAny>,
    result: Option<&Bound<'py, PyAny>>,
    error: Option<String>,
) -> PyResult<Bound<'py, PyAny>> {
    let model = model_of(model)?;
    let engine = EngineInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        source_hash: String::new(),
    };
    let saved = match (result, error) {
        (Some(r), None) => SavedResult::done(&model, from_py(r, "result")?, engine),
        (None, Some(message)) => SavedResult::error(&model, message, engine),
        _ => return Err(invalid("Give either a result or an error.")),
    }
    .map_err(invalid)?;
    to_py(py, &saved)
}
