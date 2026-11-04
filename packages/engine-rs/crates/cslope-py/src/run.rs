//! Running an analysis from Python: data in and out through pythonize, the
//! GIL released while the engine runs, progress and cancellation, and the
//! thread pool of the trial surfaces (ARCHITECTURE.md §4, §7).

use crate::errors::{AnalysisCancelled, IntoPyResult};
use cslope_engine::api::ctx::{
    CancelToken, EvalCtx, Evaluator, NativeClock, ProgressEvent, Rayon, RunCtx, SampleJob,
    SearchPhase, Serial, SliceRetention,
};
use cslope_engine::error::{ErrorKind, Result as EngineResult};
use cslope_engine::model::slope::{SearchPlane, Slope};
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use rayon::{ThreadPool, ThreadPoolBuilder};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::cell::RefCell;
use std::collections::HashMap;
use std::ops::ControlFlow;
use std::sync::{Arc, Mutex, OnceLock};

/// A Python value read as an engine type (the JSON shape of the TypeScript
/// engine: dicts with camelCase keys, lists, numbers, strings).
pub fn from_py<T: DeserializeOwned>(value: &Bound<'_, PyAny>, what: &str) -> PyResult<T> {
    pythonize::depythonize(value).map_err(|e| PyValueError::new_err(format!("Invalid {what}: {e}")))
}

/// An engine value as Python objects (dicts, lists, floats; NaN and the
/// infinities kept).
pub fn to_py<'py, T: Serialize>(py: Python<'py>, value: &T) -> PyResult<Bound<'py, PyAny>> {
    pythonize::pythonize(py, value)
        .map_err(|e| PyValueError::new_err(format!("Could not convert the result: {e}")))
}

/// Cancels a running analysis from another Python thread.
///
/// Pass it as ``cancel=`` to an analysis and call :meth:`cancel` from
/// another thread (the analysis runs without the GIL); the analysis then
/// raises :class:`cslope.AnalysisCancelled`.
#[pyclass(name = "CancelToken", module = "cslope", frozen)]
#[derive(Default)]
pub struct PyCancelToken(pub Arc<CancelToken>);

#[pymethods]
impl PyCancelToken {
    #[new]
    fn new() -> Self {
        Self::default()
    }

    /// Ask the analyses that hold this token to stop.
    fn cancel(&self) {
        self.0.cancel();
    }

    /// Whether :meth:`cancel` was called.
    #[getter]
    fn cancelled(&self) -> bool {
        self.0.is_cancelled()
    }

    fn __repr__(&self) -> String {
        format!("CancelToken(cancelled={})", self.cancelled_str())
    }
}

impl PyCancelToken {
    fn cancelled_str(&self) -> &'static str {
        if self.0.is_cancelled() {
            "True"
        } else {
            "False"
        }
    }
}

/// The evaluator of the trial surfaces for a `threads` argument.
pub enum Threads {
    /// One thread (`threads=1`).
    Serial,
    /// rayon's global pool: every core, or `RAYON_NUM_THREADS` (`threads=None`).
    Global,
    /// A pool of its own size (`threads=n`), kept for later runs.
    Pool(Arc<ThreadPool>),
}

/// The batches (and Monte Carlo samples) over a pool of its own.
struct PoolEvaluator(Arc<ThreadPool>);

impl Evaluator for PoolEvaluator {
    fn evaluate(
        &self,
        slope: &Slope,
        planes: &mut [SearchPlane],
        ctx: &EvalCtx,
    ) -> EngineResult<()> {
        self.0
            .install(|| Rayon::default().evaluate(slope, planes, ctx))
    }

    fn map_samples(&self, count: usize, job: &SampleJob) -> EngineResult<Vec<Option<f64>>> {
        self.0.install(|| Rayon::default().map_samples(count, job))
    }
}

fn pools() -> &'static Mutex<HashMap<usize, Arc<ThreadPool>>> {
    static POOLS: OnceLock<Mutex<HashMap<usize, Arc<ThreadPool>>>> = OnceLock::new();
    POOLS.get_or_init(|| Mutex::new(HashMap::new()))
}

impl Threads {
    pub fn from_arg(threads: Option<usize>) -> PyResult<Self> {
        match threads {
            None => Ok(Threads::Global),
            Some(0) => Err(PyValueError::new_err(
                "threads must be at least 1 (or None for every core).",
            )),
            Some(1) => Ok(Threads::Serial),
            Some(n) => {
                let mut pools = pools().lock().unwrap_or_else(|p| p.into_inner());
                if let Some(p) = pools.get(&n) {
                    return Ok(Threads::Pool(p.clone()));
                }
                let pool = ThreadPoolBuilder::new()
                    .num_threads(n)
                    .thread_name(|i| format!("cslope-{i}"))
                    .build()
                    .map_err(|e| {
                        PyValueError::new_err(format!("Could not start {n} threads: {e}"))
                    })?;
                let pool = Arc::new(pool);
                pools.insert(n, pool.clone());
                Ok(Threads::Pool(pool))
            }
        }
    }
}

fn phase_name(p: SearchPhase) -> &'static str {
    match p {
        SearchPhase::First => "first",
        SearchPhase::Refined => "refined",
        SearchPhase::Local => "local",
        SearchPhase::Block => "block",
        SearchPhase::Optimise => "optimise",
    }
}

/// A progress event as the dict a callback receives.
fn event_to_py<'py>(py: Python<'py>, event: &ProgressEvent) -> PyResult<Bound<'py, PyDict>> {
    let d = PyDict::new(py);
    match event {
        ProgressEvent::Search {
            done,
            total_hint,
            phase,
        } => {
            d.set_item("kind", "search")?;
            d.set_item("done", done)?;
            d.set_item("totalHint", total_hint)?;
            d.set_item("phase", phase_name(*phase))?;
        }
        ProgressEvent::Reliability(p) => {
            d.set_item("kind", "reliability")?;
            d.set_item("progress", p)?;
        }
        ProgressEvent::FemTrial(t) => {
            d.set_item("kind", "femTrial")?;
            d.set_item("trial", to_py(py, t)?)?;
        }
        ProgressEvent::Bounds(l) => {
            d.set_item("kind", "bounds")?;
            d.set_item("level", to_py(py, l)?)?;
        }
    }
    Ok(d)
}

/// How a run is driven from Python.
pub struct RunArgs {
    pub progress: Option<Py<PyAny>>,
    pub cancel: Option<Arc<CancelToken>>,
    pub threads: Threads,
    pub retention: SliceRetention,
}

impl RunArgs {
    pub fn new(
        progress: Option<Py<PyAny>>,
        cancel: Option<&Bound<'_, PyCancelToken>>,
        threads: Option<usize>,
    ) -> PyResult<Self> {
        Ok(RunArgs {
            progress,
            cancel: cancel.map(|c| c.get().0.clone()),
            threads: Threads::from_arg(threads)?,
            retention: SliceRetention::Critical,
        })
    }
}

/// Runs `f` with the GIL released and a run context of `args`.
///
/// Every progress event takes the GIL briefly: it checks for signals (a
/// `KeyboardInterrupt` cancels the run and is raised again) and calls the
/// callback, if any, with the event as a dict; a callback that returns
/// `False` cancels the run (`AnalysisCancelled`), one that raises cancels it
/// and its exception is raised again.
pub fn run<T, F>(py: Python<'_>, args: RunArgs, f: F) -> PyResult<T>
where
    T: Send,
    F: for<'c> FnOnce(&mut RunCtx<'c>) -> EngineResult<T> + Send,
{
    let RunArgs {
        progress,
        cancel,
        threads,
        retention,
    } = args;
    let (outcome, pending) = py.detach(move || {
        let token = cancel.unwrap_or_default();
        let clock = NativeClock::new();
        let pending: RefCell<Option<PyErr>> = RefCell::new(None);
        let mut hook = |event: ProgressEvent| -> ControlFlow<()> {
            Python::attach(|py| {
                if let Err(e) = py.check_signals() {
                    token.cancel();
                    *pending.borrow_mut() = Some(e);
                    return ControlFlow::Break(());
                }
                let Some(cb) = progress.as_ref() else {
                    return ControlFlow::Continue(());
                };
                let called = event_to_py(py, &event).and_then(|ev| cb.call1(py, (ev,)));
                match called {
                    // (only False cancels: None, the usual return, does not)
                    Ok(v) if matches!(v.extract::<bool>(py), Ok(false)) => ControlFlow::Break(()),
                    Ok(_) => ControlFlow::Continue(()),
                    Err(e) => {
                        *pending.borrow_mut() = Some(e);
                        ControlFlow::Break(())
                    }
                }
            })
        };
        let serial = Serial;
        let global = Rayon::default();
        let pooled;
        let evaluator: &dyn Evaluator = match &threads {
            Threads::Serial => &serial,
            Threads::Global => &global,
            Threads::Pool(p) => {
                pooled = PoolEvaluator(p.clone());
                &pooled
            }
        };
        let outcome = {
            let mut ctx = RunCtx {
                progress: Some(&mut hook),
                cancel: Some(&*token),
                clock: &clock,
                evaluator,
                retention,
            };
            f(&mut ctx)
        };
        (outcome, pending.into_inner())
    });
    match outcome {
        Ok(v) => Ok(v),
        // (a run that stopped for a callback's exception or a signal raises it)
        Err(e) => match pending {
            Some(p) => Err(p),
            None if e.kind == ErrorKind::Cancelled => Err(AnalysisCancelled::new_err(e.message)),
            None => Err(e).py(),
        },
    }
}
