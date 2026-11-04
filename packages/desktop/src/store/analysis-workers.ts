/**
 * Analysis workers and how many threads an analysis uses.
 *
 * An analysis runs in its own worker (the coordinator). With more than one
 * thread it gets evaluator workers as well: the coordinator runs the
 * search and sends batches of trial surfaces to them over MessagePorts,
 * evaluating a share itself (engine src/parallel). The result is the same
 * with any number of threads.
 *
 * Runs that go on at the same time (Run All, the sensitivity panel) share
 * the cores: each gets its part of them (threadsPerRun).
 *
 * The workers of a completed run are kept idle for the next run (any of
 * them can coordinate or evaluate: the same script): a new worker loads
 * the engine and runs it unoptimised at first, which costs as much as a
 * short search. So a Run All of twenty models on four cores runs on four
 * workers, not twenty.
 */

/** Threads of one analysis at most (the coordinator and seven evaluators). */
export const MAX_ANALYSIS_THREADS = 8;
/** A worker left idle this long after a run is stopped. */
export const WORKER_IDLE_MS = 60_000;
/** Setting (localStorage) for the threads of one analysis, e.g. "1" for sequential runs. */
export const ANALYSIS_THREADS_KEY = "cslope.analysisThreads";

let threadsOverride: number | null = null;

/** Sets the threads of one analysis (tests, scripts); null returns to the setting or the default. */
export function setAnalysisThreads(threads: number | null): void {
  threadsOverride = threads;
}

/** Logical cores of the computer (4 when unknown). */
export function coreCount(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 0;
  return cores && cores > 0 ? cores : 4;
}

function configuredThreads(): number | null {
  if (threadsOverride != null) return threadsOverride;
  try {
    const stored = globalThis.localStorage?.getItem(ANALYSIS_THREADS_KEY);
    if (stored) return Number(stored);
  } catch {
    // no storage (a worker, a locked-down profile)
  }
  const env = import.meta.env?.VITE_CSLOPE_ANALYSIS_THREADS as string | undefined;
  return env ? Number(env) : null;
}

/**
 * Threads of one analysis that has the computer to itself: the setting, or
 * one per core (the coordinator and an evaluator per further core), at
 * most MAX_ANALYSIS_THREADS.
 */
export function analysisThreads(): number {
  const configured = configuredThreads();
  const threads = configured != null && Number.isFinite(configured) ? Math.round(configured) : coreCount();
  return Math.max(1, Math.min(MAX_ANALYSIS_THREADS, threads));
}

/** Threads of each of `concurrent` analyses that run at the same time. */
export function threadsPerRun(concurrent: number): number {
  return Math.max(1, Math.floor(analysisThreads() / Math.max(1, concurrent)));
}

/** A new analysis worker (coordinator or evaluator: the same script). */
export function createAnalysisWorker(): Worker {
  return new Worker(new URL("../worker/analysis.worker.ts", import.meta.url), { type: "module" });
}

/** Workers kept after a run, for the next one (they have the engine loaded). */
const idle: Worker[] = [];
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/** `count` analysis workers, idle ones first. */
export function acquireWorkers(count: number): Worker[] {
  const workers = idle.splice(0, count);
  while (workers.length < count) workers.push(createAnalysisWorker());
  if (idle.length === 0 && idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  return workers;
}

/** Workers of a run that ended normally: kept idle for WORKER_IDLE_MS. */
export function releaseWorkers(workers: Worker[]): void {
  for (const w of workers) {
    w.onerror = null;
    w.onmessage = null;
    if (idle.length < MAX_ANALYSIS_THREADS) idle.push(w);
    else w.terminate();
  }
  if (idle.length === 0) return;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(stopIdleWorkers, WORKER_IDLE_MS);
}

/** Workers of a cancelled, failed or timed-out run: stopped at once. */
export function discardWorkers(workers: Worker[]): void {
  for (const w of workers) w.terminate();
}

/** Stops the idle workers. */
export function stopIdleWorkers(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  for (const w of idle.splice(0)) w.terminate();
}

/** Idle workers (tests). */
export function idleWorkerCount(): number {
  return idle.length;
}
