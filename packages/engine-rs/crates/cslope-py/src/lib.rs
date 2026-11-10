//! Python binding of the cSlope engine: the extension module
//! `cslope._native`, wrapped by the `cslope` package (python/cslope).
//! ARCHITECTURE.md §4 describes the API.
//!
//! Data goes in as the JSON shapes of the TypeScript engine (dicts with
//! camelCase keys) and comes out the same way, through pythonize. Analyses
//! run with the GIL released; see `run.rs` for progress, cancellation and
//! threads.

mod errors;
mod project;
mod run;
mod slope;

use crate::errors::IntoPyResult;
use crate::run::{from_py, run, to_py, PyCancelToken, RunArgs};
use cslope_engine::api::run_analysis::run_analysis;
use cslope_engine::api::summary::summarize_result;
use cslope_engine::fem::summary::{run_fem_summary, run_fem_summary_with_bounds};
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::reliability::{
    analyse_reliability, reliability_surface_to_model_space, RandomVariable, ReliabilityOptions,
};
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::types::schema::{SCHEMA_NAMES, SCHEMA_VERSION};
use cslope_engine::types::{
    public_default_options, validate_definition, AnalysisResult, FemAnalysisSettings,
    MaterialModel, SlopeDefinition, SwedishFactorBasis,
};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

fn definition(value: &Bound<'_, PyAny>) -> PyResult<SlopeDefinition> {
    from_py(value, "slope definition")
}

fn canonical(value: &Bound<'_, PyAny>) -> PyResult<SlopeDefinition> {
    to_canonical_slope_definition(&definition(value)?, None).py()
}

fn options(value: Option<&Bound<'_, PyAny>>) -> PyResult<AnalysisOptionsPatch> {
    match value {
        Some(v) if !v.is_none() => from_py(v, "analysis options"),
        _ => Ok(AnalysisOptionsPatch::default()),
    }
}

/// An analysis document (`{"format": "cslope-analysis", "formatVersion":
/// 1, "definition", "options"}`) as its definition and options; another
/// value as itself and no options.
fn split_document<'py>(
    value: &Bound<'py, PyAny>,
) -> PyResult<(Bound<'py, PyAny>, Option<Bound<'py, PyAny>>)> {
    if let Ok(d) = value.cast::<PyDict>() {
        if !d.contains("coordinates")? && (d.contains("format")? || d.contains("definition")?) {
            let Some(def) = d.get_item("definition")? else {
                return Err(PyValueError::new_err(
                    "Invalid analysis document: it has no \"definition\".",
                ));
            };
            let opts = d.get_item("options")?.filter(|o| !o.is_none());
            return Ok((def, opts));
        }
    }
    Ok((value.clone(), None))
}

/// The options of a run from Python (D-23): the public defaults (the
/// app's: Morgenstern-Price, 30 slices, 1000 + 500 trial surfaces,
/// composite surfaces), then the document's options, then `options`.
fn public_options(
    document: Option<&Bound<'_, PyAny>>,
    given: Option<&Bound<'_, PyAny>>,
) -> PyResult<AnalysisOptionsPatch> {
    Ok(public_default_options()
        .merged(&options(document)?)
        .merged(&options(given)?))
}

/// Limit equilibrium analysis of a slope: the result the app shows
/// (``AnalysisResult``), in the model's coordinates. ``definition`` is a
/// definition or an analysis document; the options are the public defaults
/// (D-23), the document's options and ``options``, in that order.
#[pyfunction]
#[pyo3(signature = (definition, options=None, *, both_directions=false, progress=None, threads=None, cancel=None))]
fn analyse<'py>(
    py: Python<'py>,
    definition: &Bound<'py, PyAny>,
    options: Option<&Bound<'py, PyAny>>,
    both_directions: bool,
    progress: Option<Py<PyAny>>,
    threads: Option<usize>,
    cancel: Option<&Bound<'py, PyCancelToken>>,
) -> PyResult<Bound<'py, PyAny>> {
    let (definition, doc_options) = split_document(definition)?;
    let def = canonical(&definition)?;
    let mut o = public_options(doc_options.as_ref(), options)?;
    if both_directions {
        o.both_directions = Some(true);
    }
    let args = RunArgs::new(progress, cancel, threads)?;
    let result = run(py, args, |ctx| run_analysis(&def, &o, ctx))?;
    to_py(py, &result)
}

/// Finite element analysis of a slope as the app runs it (strength
/// reduction and, with ``bounds=True`` and ``limitAnalysis`` in the
/// settings, the bounds of limit analysis): ``FemResultSummary``.
#[pyfunction]
#[pyo3(signature = (definition, settings, *, bounds=false, progress=None, cancel=None))]
fn fem_summary<'py>(
    py: Python<'py>,
    definition: &Bound<'py, PyAny>,
    settings: &Bound<'py, PyAny>,
    bounds: bool,
    progress: Option<Py<PyAny>>,
    cancel: Option<&Bound<'py, PyCancelToken>>,
) -> PyResult<Bound<'py, PyAny>> {
    // (the summary turns the definition to its canonical orientation itself)
    let def = self::definition(definition)?;
    let s: FemAnalysisSettings = from_py(settings, "finite element settings")?;
    // FE trials run one after another (ARCHITECTURE.md §7.1)
    let args = RunArgs::new(progress, cancel, Some(1))?;
    let result = run(py, args, |ctx| {
        if bounds {
            run_fem_summary_with_bounds(&def, &s, ctx)
        } else {
            run_fem_summary(&def, &s, ctx)
        }
    })?;
    to_py(py, &result)
}

/// Reliability analysis (Taylor series or Monte Carlo) of a slope:
/// ``ReliabilityResult``, its critical surface in the model's coordinates.
#[pyfunction]
#[pyo3(signature = (definition, options, variables, reliability, *, progress=None, threads=None, cancel=None))]
#[allow(clippy::too_many_arguments)]
fn reliability<'py>(
    py: Python<'py>,
    definition: &Bound<'py, PyAny>,
    options: Option<&Bound<'py, PyAny>>,
    variables: &Bound<'py, PyAny>,
    reliability: &Bound<'py, PyAny>,
    progress: Option<Py<PyAny>>,
    threads: Option<usize>,
    cancel: Option<&Bound<'py, PyCancelToken>>,
) -> PyResult<Bound<'py, PyAny>> {
    let def = canonical(definition)?;
    let o = self::options(options)?;
    let vars: Vec<RandomVariable> = from_py(variables, "random variables")?;
    let ro: ReliabilityOptions = from_py(reliability, "reliability options")?;
    let args = RunArgs::new(progress, cancel, threads)?;
    let mut result = run(py, args, |ctx| {
        analyse_reliability(&def, &o, &vars, &ro, ctx)
    })?;
    result.surface = reliability_surface_to_model_space(&result.surface, &def);
    to_py(py, &result)
}

/// The definition in canonical orientation (sliding towards +x), every
/// material by its model.
#[pyfunction]
fn to_canonical<'py>(
    py: Python<'py>,
    definition: &Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    to_py(py, &canonical(definition)?)
}

/// The errors of a material model (empty: valid).
#[pyfunction]
fn validate_material_model(model: &Bound<'_, PyAny>) -> PyResult<Vec<String>> {
    let m: MaterialModel = from_py(model, "material model")?;
    cslope_engine::types::validation::try_validate_material_model(&m).py()
}

/// The issues of an analysis document, or of a definition and its options
/// (``validate_definition``): a list of ``{"path", "code", "message",
/// "severity"}``, empty when valid.
#[pyfunction]
#[pyo3(signature = (doc_or_definition, options=None))]
fn validate<'py>(
    py: Python<'py>,
    doc_or_definition: &Bound<'py, PyAny>,
    options: Option<&Bound<'py, PyAny>>,
) -> PyResult<Bound<'py, PyAny>> {
    let v: serde_json::Value = from_py(doc_or_definition, "definition")?;
    let o: Option<serde_json::Value> = match options {
        Some(o) if !o.is_none() => Some(from_py(o, "analysis options")?),
        _ => None,
    };
    to_py(py, &validate_definition::validate(&v, o.as_ref()))
}

/// What a result means (``summarize_result``): F and whether it is a
/// factor of safety or an over-design factor, the method, the critical
/// surface, the warnings. ``options``: those of the run, over the public
/// defaults as ``analyse`` takes them.
#[pyfunction]
#[pyo3(signature = (result, options=None))]
fn summarize<'py>(
    py: Python<'py>,
    result: &Bound<'py, PyAny>,
    options: Option<&Bound<'py, PyAny>>,
) -> PyResult<Bound<'py, PyAny>> {
    let r: AnalysisResult = from_py(result, "analysis result")?;
    // options or an analysis document (its options; one without a
    // definition is an error, as for `analyse`)
    let o = match options.filter(|o| !o.is_none()) {
        Some(o) if is_document(o) => public_options(split_document(o)?.1.as_ref(), None)?,
        given => public_options(None, given)?,
    };
    to_py(py, &summarize_result(&r, &o, env!("CSLOPE_ENGINE_BUILD")))
}

fn is_document(v: &Bound<'_, PyAny>) -> bool {
    v.cast::<PyDict>().is_ok_and(|d| {
        !d.contains("coordinates").unwrap_or(false)
            && (d.contains("format").unwrap_or(false) || d.contains("definition").unwrap_or(false))
    })
}

/// Swedish partial factors from the safety class and the conversion
/// factors (``swedish_partial_factors``): the ``partialFactors`` dict of the
/// options, with its ``basis``.
#[pyfunction]
fn swedish_partial_factors<'py>(
    py: Python<'py>,
    safety_class: u8,
    eta_cu: f64,
    eta_drained: f64,
    variable_load_base: f64,
) -> PyResult<Bound<'py, PyAny>> {
    let f = cslope_engine::types::swedish_partial_factors(&SwedishFactorBasis {
        safety_class,
        eta_cu,
        eta_drained,
        variable_load_base,
    })
    .py()?;
    to_py(py, &f)
}

/// The JSON schemas (packages/engine/schema, written by tools/schema.ts),
/// built into the package.
const SCHEMA_FILES: [(&str, &str); 10] = [
    (
        "analysis-document",
        include_str!("../../../../engine/schema/analysis-document.json"),
    ),
    (
        "slope-definition",
        include_str!("../../../../engine/schema/slope-definition.json"),
    ),
    (
        "analysis-options",
        include_str!("../../../../engine/schema/analysis-options.json"),
    ),
    (
        "analysis-result",
        include_str!("../../../../engine/schema/analysis-result.json"),
    ),
    (
        "material-model",
        include_str!("../../../../engine/schema/material-model.json"),
    ),
    (
        "fem-analysis-settings",
        include_str!("../../../../engine/schema/fem-analysis-settings.json"),
    ),
    (
        "reliability-options",
        include_str!("../../../../engine/schema/reliability-options.json"),
    ),
    (
        "random-variables",
        include_str!("../../../../engine/schema/random-variables.json"),
    ),
    (
        "result-summary",
        include_str!("../../../../engine/schema/result-summary.json"),
    ),
    (
        "validation-issues",
        include_str!("../../../../engine/schema/validation-issues.json"),
    ),
];

/// The JSON schema of ``name`` (``SCHEMA_NAMES``).
#[pyfunction]
#[pyo3(signature = (name="analysis-document"))]
fn schema<'py>(py: Python<'py>, name: &str) -> PyResult<Bound<'py, PyAny>> {
    match SCHEMA_FILES.iter().find(|(n, _)| *n == name) {
        Some((_, text)) => {
            let v: serde_json::Value = serde_json::from_str(text)
                .map_err(|e| PyValueError::new_err(format!("Schema \"{name}\": {e}")))?;
            to_py(py, &v)
        }
        None => Err(PyValueError::new_err(format!(
            "No schema \"{name}\": one of {}.",
            SCHEMA_NAMES.join(", ")
        ))),
    }
}

/// The public default options (D-23), a new dict.
#[pyfunction]
fn default_options<'py>(py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
    to_py(py, &public_default_options())
}

/// The engine's definition of an app model (a ``model.json`` of a
/// ``.cslp`` file, as a dict), in the model's own orientation: the app's
/// conversion (``buildModelSpaceSlopeDTO``), ported to Rust in the crate
/// cslope-project. With ``normalize`` (the default) the model is first read
/// as the app reads it when it opens the project (``normalize_model``), so
/// that the definition is the one the app runs; without it, the model is
/// taken as it is, which must then be the shape the app writes (every
/// member known, the ones it always writes present).
#[pyfunction]
#[pyo3(signature = (model, *, normalize=true))]
fn model_to_definition<'py>(
    py: Python<'py>,
    model: &Bound<'py, PyAny>,
    normalize: bool,
) -> PyResult<Bound<'py, PyAny>> {
    let value: serde_json::Value = from_py(model, "model")?;
    let model = if normalize {
        cslope_project::normalize_for_run(&value).map_err(|e| PyValueError::new_err(e.0))?
    } else {
        cslope_project::ModelEntry::from_json(value).map_err(PyValueError::new_err)?
    };
    to_py(py, &cslope_project::model_to_definition(&model))
}

/// A model as the app reads it when it opens the project (a project of the
/// current schema version): the fields that reach the analysis, filled,
/// clamped and checked as the app does, and its complete ``options``.
#[pyfunction]
fn normalize_model<'py>(py: Python<'py>, model: &Bound<'py, PyAny>) -> PyResult<Bound<'py, PyAny>> {
    let value: serde_json::Value = from_py(model, "model")?;
    let out =
        cslope_project::normalize_model_json(&value).map_err(|e| PyValueError::new_err(e.0))?;
    to_py(py, &out)
}

/// The definition with an explicit assignment for each region that has
/// none: the material the engine gives it implicitly (for ``cslope
/// export``, issue #85; ``cslope_project::assign_unassigned_regions``).
#[pyfunction]
fn assign_unassigned_regions<'py>(
    py: Python<'py>,
    definition: &Bound<'py, PyAny>,
) -> PyResult<Bound<'py, PyAny>> {
    let mut def = self::definition(definition)?;
    cslope_project::assign_unassigned_regions(&mut def);
    to_py(py, &def)
}

/// An app model (a ``model.json`` dict) from an engine definition, in
/// model coordinates: the app's ``modelFromDefinition``, ported to Rust in
/// the crate cslope-project. ``options`` are analysis options over the
/// app's defaults. Without ``projectInfo`` and ``resultViewSettings``,
/// which ``normalize_model`` fills as the app does when it opens a model.
#[pyfunction]
#[pyo3(signature = (definition, *, id, name, options=None))]
fn definition_to_model<'py>(
    py: Python<'py>,
    definition: &Bound<'py, PyAny>,
    id: String,
    name: String,
    options: Option<&Bound<'py, PyAny>>,
) -> PyResult<Bound<'py, PyAny>> {
    let def = self::definition(definition)?;
    let options = match options {
        Some(o) if !o.is_none() => Some(from_py(o, "analysis options")?),
        _ => None,
    };
    let info = cslope_project::DefinitionModelInfo { id, name, options };
    let model =
        cslope_project::definition_to_model(&def, &info).map_err(|e| PyValueError::new_err(e.0))?;
    to_py(py, &model.to_json())
}

/// For each of ``points``, the index of the region of ``definition`` that
/// holds it (the outline cut by the boundaries, as the validation splits
/// it, split once), or None.
#[pyfunction]
fn region_indices(
    definition: &Bound<'_, PyAny>,
    points: Vec<[f64; 2]>,
) -> PyResult<Vec<Option<usize>>> {
    Ok(cslope_project::region_indices(
        &self::definition(definition)?,
        &points,
    ))
}

#[pymodule]
#[pyo3(name = "_native")]
fn native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    let py = m.py();
    m.add("__version__", env!("CARGO_PKG_VERSION"))?;
    m.add("ENGINE_BUILD", env!("CSLOPE_ENGINE_BUILD"))?;
    m.add("EngineError", py.get_type::<errors::EngineError>())?;
    m.add(
        "AnalysisCancelled",
        py.get_type::<errors::AnalysisCancelled>(),
    )?;
    m.add_class::<PyCancelToken>()?;
    m.add_class::<slope::PySlope>()?;
    m.add_function(wrap_pyfunction!(analyse, m)?)?;
    m.add_function(wrap_pyfunction!(fem_summary, m)?)?;
    m.add_function(wrap_pyfunction!(reliability, m)?)?;
    m.add_function(wrap_pyfunction!(to_canonical, m)?)?;
    m.add_function(wrap_pyfunction!(validate_material_model, m)?)?;
    m.add("SCHEMA_VERSION", SCHEMA_VERSION)?;
    m.add("SCHEMA_NAMES", SCHEMA_NAMES.to_vec())?;
    m.add_function(wrap_pyfunction!(validate, m)?)?;
    m.add_function(wrap_pyfunction!(summarize, m)?)?;
    m.add_function(wrap_pyfunction!(swedish_partial_factors, m)?)?;
    m.add_function(wrap_pyfunction!(schema, m)?)?;
    m.add_function(wrap_pyfunction!(default_options, m)?)?;
    m.add_function(wrap_pyfunction!(model_to_definition, m)?)?;
    m.add_function(wrap_pyfunction!(normalize_model, m)?)?;
    m.add_function(wrap_pyfunction!(assign_unassigned_regions, m)?)?;
    m.add_function(wrap_pyfunction!(definition_to_model, m)?)?;
    m.add_function(wrap_pyfunction!(region_indices, m)?)?;
    m.add_function(wrap_pyfunction!(project::project_read, m)?)?;
    m.add_function(wrap_pyfunction!(project::project_write, m)?)?;
    m.add_function(wrap_pyfunction!(project::input_hash_of, m)?)?;
    m.add_function(wrap_pyfunction!(project::saved_result, m)?)?;
    m.add(
        "PROJECT_FORMAT_VERSION",
        cslope_project::project::FORMAT_VERSION,
    )?;
    m.add(
        "PROJECT_SCHEMA_VERSION",
        cslope_project::project::PROJECT_SCHEMA_VERSION,
    )?;
    Ok(())
}
