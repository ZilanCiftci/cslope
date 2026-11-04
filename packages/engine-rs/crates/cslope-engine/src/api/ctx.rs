//! The run context of an analysis (ARCHITECTURE.md §2.2, §7; not a port):
//! progress, cancellation, the injected clock, the evaluator of the trial
//! surfaces and how many slices are kept.
//!
//! Evaluating a batch of surfaces is pure per surface given `&Slope`
//! (`solvers::evaluate_plane`), so an evaluator may split a batch in any way:
//! `Serial` evaluates the planes in order, `Rayon` (feature `rayon`) over a
//! thread pool, each plane written in place by index. The result is the same
//! bit for bit; on an error, the error of the lowest-index failing plane is
//! returned, the one the serial loop would have met first.

use crate::error::{EngineError, Result};
use crate::model::slope::{SearchPlane, Slope};
use crate::model::solvers::{evaluate_planes_ctx, EvalScratch, MpSolver};
use std::ops::ControlFlow;
use std::sync::atomic::{AtomicBool, Ordering};

/// Which slices an analysis keeps on its planes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SliceRetention {
    /// Every evaluated plane keeps its slices (TypeScript's `analyseSlope`;
    /// the facade and the tests read them).
    #[default]
    All,
    /// Only the critical plane keeps its slices (restored at the end by
    /// evaluating it again, which gives the same slices): the product path,
    /// which needs far less memory. The results are the same.
    Critical,
}

/// The part of a search a batch belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchPhase {
    /// The first pass (the generated and the custom surfaces).
    First,
    /// Surfaces refined around the best of the first pass.
    Refined,
    /// The local search with shrinking steps.
    Local,
    /// The block search.
    Block,
    /// The non-circular optimisation.
    Optimise,
}

/// Progress of a run.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ProgressEvent {
    /// Surfaces evaluated so far, of about `total_hint` (0: unknown).
    Search {
        done: usize,
        total_hint: usize,
        phase: SearchPhase,
    },
    /// Progress of a reliability analysis, 0–1 (TypeScript's `onProgress`).
    Reliability(f64),
    /// A trial of the finite element strength reduction (TypeScript's `onTrial`).
    FemTrial(crate::fem::srm::SrmTrial),
    /// The bounds of one level of the adaptive limit analysis (TypeScript's `onLevel`).
    Bounds(crate::fem::bound_adapt::AdaptiveBoundsLevel),
}

/// Cancels a running analysis from another thread (native and Python; the
/// app terminates its worker instead).
#[derive(Debug, Default)]
pub struct CancelToken(AtomicBool);

impl CancelToken {
    pub fn new() -> Self {
        CancelToken(AtomicBool::new(false))
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Relaxed);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }
}

/// The time source of time limits (FE); never read directly by the engine.
pub trait Clock: Sync {
    fn now_ms(&self) -> f64;
}

/// A clock that stands still (tests and fixtures).
#[derive(Debug, Clone, Copy, Default)]
pub struct FixedClock(pub f64);

impl Clock for FixedClock {
    fn now_ms(&self) -> f64 {
        self.0
    }
}

/// The native monotonic clock (not on wasm32, where `Instant` panics).
#[cfg(not(target_arch = "wasm32"))]
#[derive(Debug, Clone, Copy)]
pub struct NativeClock(std::time::Instant);

#[cfg(not(target_arch = "wasm32"))]
impl NativeClock {
    pub fn new() -> Self {
        NativeClock(std::time::Instant::now())
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Default for NativeClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(not(target_arch = "wasm32"))]
impl Clock for NativeClock {
    fn now_ms(&self) -> f64 {
        self.0.elapsed().as_secs_f64() * 1000.0
    }
}

/// What every evaluator of one run shares: the Morgenstern-Price solver of
/// the run (a process-wide setting, read once at its start).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EvalCtx {
    pub mp_solver: MpSolver,
}

/// A job of `Evaluator::map_samples`: the result of item `index`, with the
/// thread's own state (None at its first job; a job typically keeps a copy
/// of a slope there).
pub type SampleJob<'a> = dyn Fn(&mut Option<Slope>, usize) -> Result<Option<f64>> + Sync + 'a;

/// Evaluates a batch of planes in place, as `solvers::evaluate_planes` does.
pub trait Evaluator: Sync {
    fn evaluate(&self, slope: &Slope, planes: &mut [SearchPlane], ctx: &EvalCtx) -> Result<()>;

    /// The results of `count` independent jobs, in order (the Monte Carlo
    /// samples, ARCHITECTURE.md §7.1). On an error, the error of the
    /// lowest-index failing job. Serial by default.
    fn map_samples(&self, count: usize, job: &SampleJob) -> Result<Vec<Option<f64>>> {
        let mut state: Option<Slope> = None;
        (0..count).map(|i| job(&mut state, i)).collect()
    }
}

/// The planes one after the other (the default; WebAssembly).
#[derive(Debug, Clone, Copy, Default)]
pub struct Serial;

impl Evaluator for Serial {
    fn evaluate(&self, slope: &Slope, planes: &mut [SearchPlane], ctx: &EvalCtx) -> Result<()> {
        let mut scratch = EvalScratch::new();
        evaluate_planes_ctx(slope, planes, ctx, &mut scratch)
    }
}

/// The planes over rayon's thread pool, each thread with its own scratch;
/// batches smaller than `min_batch` are evaluated serially.
#[cfg(feature = "rayon")]
#[derive(Debug, Clone, Copy)]
pub struct Rayon {
    pub min_batch: usize,
}

#[cfg(feature = "rayon")]
impl Default for Rayon {
    fn default() -> Self {
        Rayon { min_batch: 32 }
    }
}

#[cfg(feature = "rayon")]
impl Evaluator for Rayon {
    fn evaluate(&self, slope: &Slope, planes: &mut [SearchPlane], ctx: &EvalCtx) -> Result<()> {
        use rayon::prelude::*;
        if planes.len() < self.min_batch {
            return Serial.evaluate(slope, planes, ctx);
        }
        let results: Vec<Result<()>> = planes
            .par_iter_mut()
            .with_min_len(8)
            .map_init(EvalScratch::new, |scratch, plane| {
                crate::model::solvers::evaluate_plane(slope, plane, ctx.mp_solver, scratch)
            })
            .collect();
        // the error of the lowest-index failing plane
        results.into_iter().collect()
    }

    fn map_samples(&self, count: usize, job: &SampleJob) -> Result<Vec<Option<f64>>> {
        use rayon::prelude::*;
        if count < self.min_batch {
            let mut state: Option<Slope> = None;
            return (0..count).map(|i| job(&mut state, i)).collect();
        }
        let results: Vec<Result<Option<f64>>> = (0..count)
            .into_par_iter()
            .with_min_len(4)
            .map_init(|| None, |state, i| job(state, i))
            .collect();
        // the error of the lowest-index failing job
        results.into_iter().collect()
    }
}

/// A progress callback: `Break` cancels the run.
pub type ProgressFn<'a> = dyn FnMut(ProgressEvent) -> ControlFlow<()> + 'a;

static SERIAL: Serial = Serial;
static STILL: FixedClock = FixedClock(0.0);

/// The context of one run (ARCHITECTURE.md §2.2).
pub struct RunCtx<'a> {
    pub progress: Option<&'a mut ProgressFn<'a>>,
    pub cancel: Option<&'a CancelToken>,
    pub clock: &'a dyn Clock,
    pub evaluator: &'a dyn Evaluator,
    pub retention: SliceRetention,
}

impl Default for RunCtx<'_> {
    /// Serial evaluation, every slice kept, a clock that stands still, no
    /// progress and no cancellation: TypeScript's `analyseSlope`.
    fn default() -> Self {
        RunCtx {
            progress: None,
            cancel: None,
            clock: &STILL,
            evaluator: &SERIAL,
            retention: SliceRetention::All,
        }
    }
}

impl<'a> RunCtx<'a> {
    /// The default context with another evaluator.
    pub fn with_evaluator(evaluator: &'a dyn Evaluator) -> Self {
        RunCtx {
            evaluator,
            ..RunCtx::default()
        }
    }

    /// Fails with `EngineError::cancelled()` once the run was cancelled.
    pub fn check_cancelled(&self) -> Result<()> {
        match self.cancel {
            Some(c) if c.is_cancelled() => Err(EngineError::cancelled()),
            _ => Ok(()),
        }
    }

    /// Reports progress; a callback that breaks cancels the run.
    pub fn report(&mut self, event: ProgressEvent) -> Result<()> {
        if let Some(p) = self.progress.as_mut() {
            if p(event).is_break() {
                return Err(EngineError::cancelled());
            }
        }
        Ok(())
    }
}
