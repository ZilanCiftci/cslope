//! `cslope.Slope`: a built slope that keeps its trial surfaces, for
//! scripting below the one-call `analyse` (ARCHITECTURE.md §4).

use crate::errors::IntoPyResult;
use crate::run::{from_py, run, to_py, PyCancelToken, RunArgs};
use cslope_engine::api::ctx::SliceRetention;
use cslope_engine::api::run_analysis::{analysis_result, display_points};
use cslope_engine::fem::analysis::{analyze_fem, FemAnalysisOptions};
use cslope_engine::model::build_slope::build_slope;
use cslope_engine::model::canonical::{
    map_analysis_result_to_model_space, resolve_orientation, to_canonical_slope_definition,
    SlopeOrientation,
};
use cslope_engine::model::slope::{AnalysisOptionsPatch, SearchPlane, Slope};
use cslope_engine::model::solvers::analyse_slope;
use cslope_engine::types::SlopeDefinition;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};

/// A slope built from a definition, analysed in place.
///
/// The definition is the one :func:`cslope.analyse` takes; it is turned to
/// its canonical orientation (sliding towards +x) first, and the slope works
/// in that orientation: :attr:`search` and :meth:`fem` are in canonical
/// coordinates (mirrored for a model that slides to the left, see
/// :attr:`orientation`), :meth:`result` in the model's own.
#[pyclass(name = "Slope", module = "cslope", subclass)]
pub struct PySlope {
    slope: Slope,
    canonical: SlopeDefinition,
    options: AnalysisOptionsPatch,
    min_fos: Option<f64>,
    analysed: bool,
}

fn plane_to_py<'py>(py: Python<'py>, p: &SearchPlane) -> PyResult<Bound<'py, PyDict>> {
    let d = PyDict::new(py);
    d.set_item("cx", p.cx)?;
    d.set_item("cy", p.cy)?;
    d.set_item("radius", p.radius)?;
    d.set_item("fos", p.fos)?;
    d.set_item("entryPoint", p.crack.unwrap_or(p.lc).to_vec())?;
    d.set_item("exitPoint", p.rc.to_vec())?;
    d.set_item("converged", p.converged)?;
    if let Some(c) = p.closest_pair {
        d.set_item("closestPair", c)?;
    }
    if let Some(g) = p.equilibrium_gap {
        d.set_item("equilibriumGap", g)?;
    }
    if let Some(points) = display_points(p) {
        let pts: Vec<Vec<f64>> = points.iter().map(|q| q.to_vec()).collect();
        d.set_item("points", pts)?;
    }
    if p.composite.is_some() {
        d.set_item("composite", true)?;
    }
    if p.below_min_size == Some(true) {
        d.set_item("belowMinSize", true)?;
    }
    Ok(d)
}

#[pymethods]
impl PySlope {
    #[new]
    fn new(definition: &Bound<'_, PyAny>) -> PyResult<Self> {
        let def: SlopeDefinition = from_py(definition, "slope definition")?;
        let canonical = to_canonical_slope_definition(&def, None).py()?;
        let slope = build_slope(&canonical).py()?;
        Ok(PySlope {
            slope,
            canonical,
            options: AnalysisOptionsPatch::default(),
            min_fos: None,
            analysed: false,
        })
    }

    /// Set analysis options (a partial ``AnalysisOptions`` dict, e.g.
    /// ``{"method": "Bishop", "slices": 50}``); earlier options are kept.
    fn update_analysis_options(&mut self, options: &Bound<'_, PyAny>) -> PyResult<()> {
        let patch: AnalysisOptionsPatch = from_py(options, "analysis options")?;
        self.slope.update_analysis_options(&patch).py()?;
        self.options = self.options.merged(&patch);
        self.analysed = false;
        Ok(())
    }

    /// The options given so far (a partial ``AnalysisOptions`` dict).
    #[getter]
    fn analysis_options<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        to_py(py, &self.options)
    }

    /// "ltr" or "rtl": the direction the model slides in (the slope itself
    /// is always analysed sliding towards +x).
    #[getter]
    fn orientation(&self) -> &'static str {
        match resolve_orientation(self.canonical.orientation, &self.canonical.coordinates) {
            SlopeOrientation::Ltr => "ltr",
            SlopeOrientation::Rtl => "rtl",
        }
    }

    /// The canonical definition the slope was built from.
    #[getter]
    fn definition<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        to_py(py, &self.canonical)
    }

    /// Run the search; returns the minimum factor of safety (None when no
    /// surface has one). Every trial surface is kept in :attr:`search`.
    #[pyo3(signature = (*, progress=None, threads=None, cancel=None))]
    fn analyse(
        &mut self,
        py: Python<'_>,
        progress: Option<Py<PyAny>>,
        threads: Option<usize>,
        cancel: Option<&Bound<'_, PyCancelToken>>,
    ) -> PyResult<Option<f64>> {
        let mut args = RunArgs::new(progress, cancel, threads)?;
        args.retention = SliceRetention::All;
        self.analysed = false;
        let slope = &mut self.slope;
        let fos = run(py, args, |ctx| analyse_slope(slope, ctx))?;
        self.min_fos = fos;
        self.analysed = true;
        Ok(fos)
    }

    /// The minimum factor of safety of the last :meth:`analyse`.
    #[getter]
    fn min_fos(&self) -> Option<f64> {
        self.min_fos
    }

    /// The trial surfaces of the last :meth:`analyse`, lowest factor of
    /// safety first (canonical coordinates): dicts with ``cx``, ``cy``,
    /// ``radius``, ``fos``, ``entryPoint``, ``exitPoint``, ``converged`` and,
    /// for a non-circular or composite surface, ``points``.
    #[getter]
    fn search<'py>(&self, py: Python<'py>) -> PyResult<Bound<'py, PyList>> {
        let items = self
            .slope
            .search()
            .iter()
            .map(|p| plane_to_py(py, p))
            .collect::<PyResult<Vec<_>>>()?;
        PyList::new(py, items)
    }

    /// The result of the last :meth:`analyse` as :func:`cslope.analyse`
    /// gives it (critical surface, its slices, all surfaces, warnings), in
    /// the model's coordinates.
    fn result<'py>(&mut self, py: Python<'py>) -> PyResult<Bound<'py, PyAny>> {
        if !self.analysed {
            return Err(crate::errors::EngineError::new_err(
                "The slope has not been analysed: call analyse() first.",
            ));
        }
        let r = analysis_result(&mut self.slope, self.min_fos, &self.options, 0.0).py()?;
        to_py(py, &map_analysis_result_to_model_space(&r, &self.canonical))
    }

    /// Finite element strength reduction of the slope (``analyzeFem``):
    /// ``options`` is a ``FemAnalysisOptions`` dict (element size, flow
    /// rule, material parameters, adaptive refinement, ...). Returns the
    /// result as a dict (canonical coordinates); progress events are the
    /// trials.
    #[pyo3(signature = (options=None, *, progress=None, cancel=None))]
    fn _fem<'py>(
        &self,
        py: Python<'py>,
        options: Option<&Bound<'py, PyAny>>,
        progress: Option<Py<PyAny>>,
        cancel: Option<&Bound<'py, PyCancelToken>>,
    ) -> PyResult<Bound<'py, PyAny>> {
        let o: FemAnalysisOptions = match options {
            Some(o) if !o.is_none() => from_py(o, "finite element options")?,
            _ => FemAnalysisOptions::default(),
        };
        let args = RunArgs::new(progress, cancel, Some(1))?;
        let slope = &self.slope;
        let r = run(py, args, |ctx| analyze_fem(slope, &o, ctx))?;
        to_py(py, &r)
    }

    fn __repr__(&self) -> String {
        match (self.analysed, self.min_fos) {
            (true, Some(f)) => {
                format!("Slope(min_fos={f}, surfaces={})", self.slope.search().len())
            }
            (true, None) => "Slope(min_fos=None)".to_string(),
            _ => "Slope(not analysed)".to_string(),
        }
    }
}
