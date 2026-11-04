//! Port of packages/engine/src/model/steps.ts
//!
//! A search written as steps: TypeScript's generator, which yields each
//! batch of trial surfaces it needs evaluated and reads their factors of
//! safety when it resumes, is a resumable state machine here (`PlaneSteps`).
//! The surfaces of one batch are independent of each other, so a driver may
//! evaluate them in any order or at once; the search itself, and so its
//! result, does not change with the driver.
//!
//! - `run_steps` evaluates each batch with the run's `Evaluator`
//!   (api/ctx.rs: serially, or split over threads with the `rayon`
//!   feature), TypeScript's `runStepsSync` / `runStepsAsync`.
//! - `run_steps_sync` evaluates each batch with a closure.
//! - `InParallel` runs independent searches in lockstep and evaluates their
//!   batches together (the seeds of the non-circular optimisation).

use crate::api::ctx::{EvalCtx, ProgressEvent, RunCtx, SearchPhase, SliceRetention};
use crate::error::Result;
use crate::model::slope::{SearchPlane, Slope};
use crate::model::solvers::get_morgenstern_price_solver;

/// What a search does when resumed: yield a batch to evaluate, or end.
#[derive(Debug, Clone, PartialEq)]
pub enum Step<T> {
    /// `batch()` holds planes to evaluate in place before the next `resume`
    /// (TypeScript's `yield batch`; an empty batch is skipped).
    Batch(SearchPhase),
    /// The search's result (the generator's return value).
    Done(T),
}

/// Steps of a search with result `Output` (TypeScript's `PlaneSteps<T>`).
pub trait PlaneSteps {
    type Output;
    /// Runs the search to its next batch or its end. The first call starts
    /// it; each later call follows the evaluation of the batch.
    fn resume(&mut self, slope: &Slope) -> Result<Step<Self::Output>>;
    /// The batch of the last `Step::Batch`, evaluated in place by the driver.
    fn batch(&mut self) -> &mut Vec<SearchPlane>;
}

/// Steps as a trait object (the seams between searches: `yield*`).
pub type BoxedSteps<T> = Box<dyn PlaneSteps<Output = T>>;

impl<T> PlaneSteps for BoxedSteps<T> {
    type Output = T;
    fn resume(&mut self, slope: &Slope) -> Result<Step<T>> {
        (**self).resume(slope)
    }
    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        (**self).batch()
    }
}

/// Runs the steps, evaluating each batch with `evaluate` (TypeScript's
/// `runStepsSync`).
pub fn run_steps_sync<S: PlaneSteps + ?Sized>(
    steps: &mut S,
    slope: &Slope,
    mut evaluate: impl FnMut(&Slope, &mut [SearchPlane]) -> Result<()>,
) -> Result<S::Output> {
    loop {
        match steps.resume(slope)? {
            Step::Done(v) => return Ok(v),
            Step::Batch(_) => {
                let batch = steps.batch();
                if !batch.is_empty() {
                    evaluate(slope, batch)?;
                }
            }
        }
    }
}

/// Surfaces evaluated between two progress reports (count-based, so that
/// progress never depends on time; ARCHITECTURE.md §3.4).
pub const PROGRESS_EVERY: usize = 256;

/// Runs the steps with the run's evaluator: each batch is evaluated in
/// place (in chunks of `PROGRESS_EVERY` when progress is reported or the
/// run can be cancelled, which does not change any result), progress is
/// reported and cancellation checked between chunks, and with
/// `SliceRetention::Critical` the slices of the evaluated planes are
/// dropped (the critical surface's are restored by the caller,
/// `restore_critical_slices`). `total_hint`: the expected number of
/// surfaces, for progress.
pub fn run_steps<S: PlaneSteps + ?Sized>(
    steps: &mut S,
    slope: &Slope,
    ctx: &mut RunCtx,
) -> Result<S::Output> {
    run_steps_with_hint(steps, slope, ctx, 0)
}

/// `run_steps` with the expected number of surfaces for progress events.
pub fn run_steps_with_hint<S: PlaneSteps + ?Sized>(
    steps: &mut S,
    slope: &Slope,
    ctx: &mut RunCtx,
    total_hint: usize,
) -> Result<S::Output> {
    // (TypeScript's parallel evaluators are sent the solver of the coordinator)
    let eval_ctx = EvalCtx {
        mp_solver: get_morgenstern_price_solver(),
    };
    let mut done = 0;
    loop {
        ctx.check_cancelled()?;
        match steps.resume(slope)? {
            Step::Done(v) => return Ok(v),
            Step::Batch(phase) => {
                let batch = steps.batch();
                if batch.is_empty() {
                    continue;
                }
                let chunk = if ctx.progress.is_some() || ctx.cancel.is_some() {
                    PROGRESS_EVERY
                } else {
                    batch.len()
                };
                for part in batch.chunks_mut(chunk) {
                    ctx.check_cancelled()?;
                    ctx.evaluator.evaluate(slope, part, &eval_ctx)?;
                    done += part.len();
                    ctx.report(ProgressEvent::Search {
                        done,
                        total_hint,
                        phase,
                    })?;
                }
                if ctx.retention == SliceRetention::Critical {
                    for p in batch.iter_mut() {
                        p.slices = None;
                    }
                }
            }
        }
    }
}

/// Independent searches in lockstep: the batches each yields at one step
/// are evaluated together, and the results come back in the order of the
/// searches. A search must not read the surfaces of another.
pub struct InParallel<T> {
    searches: Vec<BoxedSteps<T>>,
    results: Vec<Option<T>>,
    /// The searches whose batches are in `batch`, with their sizes.
    waiting: Vec<(usize, usize)>,
    batch: Vec<SearchPlane>,
    started: bool,
}

impl<T> InParallel<T> {
    pub fn new(searches: Vec<BoxedSteps<T>>) -> Self {
        let n = searches.len();
        InParallel {
            searches,
            results: (0..n).map(|_| None).collect(),
            waiting: Vec::new(),
            batch: Vec::new(),
            started: false,
        }
    }

    /// Runs search `index` to its next batch or its end (TypeScript's
    /// `advance`); returns the phase of a batch.
    fn advance(&mut self, index: usize, slope: &Slope) -> Result<Option<SearchPhase>> {
        match self.searches[index].resume(slope)? {
            Step::Done(v) => {
                self.results[index] = Some(v);
                Ok(None)
            }
            Step::Batch(phase) => {
                let n = self.searches[index].batch().len();
                self.waiting.push((index, n));
                Ok(Some(phase))
            }
        }
    }
}

impl<T> PlaneSteps for InParallel<T> {
    type Output = Vec<T>;

    fn batch(&mut self) -> &mut Vec<SearchPlane> {
        &mut self.batch
    }

    fn resume(&mut self, slope: &Slope) -> Result<Step<Vec<T>>> {
        let mut phase: Option<SearchPhase> = None;
        if !self.started {
            self.started = true;
            for i in 0..self.searches.len() {
                let p = self.advance(i, slope)?;
                phase = phase.or(p);
            }
        } else {
            // The evaluated planes go back to their searches, in order.
            let step = std::mem::take(&mut self.waiting);
            let mut planes = std::mem::take(&mut self.batch).into_iter();
            for &(index, n) in &step {
                let own = self.searches[index].batch();
                own.clear();
                own.extend(planes.by_ref().take(n));
            }
            for &(index, _) in &step {
                let p = self.advance(index, slope)?;
                phase = phase.or(p);
            }
        }
        if self.waiting.is_empty() {
            let results = std::mem::take(&mut self.results)
                .into_iter()
                .map(|r| r.expect("every search has ended"))
                .collect();
            return Ok(Step::Done(results));
        }
        // step.flatMap((s) => s.batch)
        for &(index, _) in &self.waiting {
            let own = std::mem::take(self.searches[index].batch());
            self.batch.extend(own);
        }
        Ok(Step::Batch(phase.unwrap_or(SearchPhase::Optimise)))
    }
}
