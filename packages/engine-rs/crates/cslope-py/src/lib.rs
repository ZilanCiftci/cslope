//! Python binding of the cSlope engine: the extension module
//! `cslope._native`, wrapped by the `cslope` package (python/cslope).
//! ARCHITECTURE.md §4 describes the API.
//!
//! Data goes in as the JSON shapes of the TypeScript engine (dicts with
//! camelCase keys) and comes out the same way, through pythonize. Analyses
//! run with the GIL released; see `run.rs` for progress, cancellation and
//! threads.

mod errors;
mod run;
mod slope;

use crate::errors::IntoPyResult;
use crate::run::{from_py, run, to_py, PyCancelToken, RunArgs};
use cslope_engine::api::run_analysis::run_analysis;
use cslope_engine::fem::summary::{run_fem_summary, run_fem_summary_with_bounds};
use cslope_engine::model::canonical::to_canonical_slope_definition;
use cslope_engine::model::reliability::{
    analyse_reliability, reliability_surface_to_model_space, RandomVariable, ReliabilityOptions,
};
use cslope_engine::model::slope::AnalysisOptionsPatch;
use cslope_engine::types::{FemAnalysisSettings, MaterialModel, SlopeDefinition};
use pyo3::prelude::*;

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

/// Limit equilibrium analysis of a slope: the result the app shows
/// (``AnalysisResult``), in the model's coordinates.
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
    let def = canonical(definition)?;
    let mut o = self::options(options)?;
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
    Ok(())
}
