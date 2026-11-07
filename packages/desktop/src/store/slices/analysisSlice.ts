import { rememberErrorInput, rememberResultInput } from "../result-input";
import type {
  AnalysisOptions,
  AnalysisResult,
  RandomVariable,
  ReliabilityOptions,
  ReliabilityResult,
  SlopeDefinition,
} from "@cslope/engine";
import { findExpressionErrors } from "../expression-check";
import { DEFAULT_ANALYSIS_OPTIONS, engineModule } from "@cslope/engine";
import type { AnalysisResponse, WorkerMessage } from "../../worker/messages";
import type { SliceCreator } from "../helpers";
import { boundaryWarningsInStoreOrder, buildModelSpaceSlopeDTO, buildSlopeDTOFromModel, nextId, RUN_RESET } from "../helpers";
import type { AnalysisSlice, AppState, ModelEntry, RunAllStatus } from "../types";
import { DEFAULT_ANALYSIS_LIMITS } from "../defaults";
import { ANALYSIS_TIMEOUT_MS, FEM_TIMEOUT_MS } from "../../constants";
import { defaultCustomCircle } from "../../utils/custom-plane";
import { analysisErrorText } from "../../utils/analysis-error";
import {
  acquireWorkers,
  analysisThreads,
  coreCount,
  discardWorkers,
  releaseWorkers,
  threadsPerRun,
} from "../analysis-workers";

// ── Shared worker execution ────────────────────────────────────────

/** A cancellable handle to a running analysis worker. */
export interface AnalysisHandle {
  promise: Promise<AnalysisResult>;
  cancel: () => void;
}

/** Rejection reason used when a run is cancelled; never shown to the user. */
class AnalysisCancelledError extends Error {
  constructor() {
    super("Analysis canceled");
    this.name = "AnalysisCancelledError";
  }
}

/**
 * Time budget for one analysis. The base timeout covers the default
 * search size (1000 + 500 surfaces); larger searches get proportionally
 * more time instead of being killed after a fixed minute.
 */
function analysisTimeoutMs(options: AnalysisOptions): number {
  const surfaces = (options.iterations ?? 0) + (options.refinedIterations ?? 0);
  // Strength reduction by finite elements takes minutes on a refined mesh.
  // Newton on non-associated flow can take several times longer (srm.ts).
  const slow = options.fem?.flowRule === "non-associated" && options.fem.nonAssociatedSolver === "newton" ? 4 : 1;
  // The limit analysis bounds: 20 minutes for the associated ones and 5 for
  // Davis B's (summary.ts), with a margin for their last program's overrun.
  const bounds = options.fem?.limitAnalysis ? 6 * FEM_TIMEOUT_MS : 0;
  const fem = options.fem?.enabled ? slow * FEM_TIMEOUT_MS * (1 + (options.fem.refinementLevels ?? 0)) + bounds : 0;
  return ANALYSIS_TIMEOUT_MS * Math.max(1, surfaces / 1500) + fem;
}

/** What a run reports besides its progress fraction. */
export interface RunEvents {
  /** What the run is doing: the finite element analysis's stage and trials. */
  onStage?: (text: string) => void;
  /** The limit equilibrium result, while the finite element analysis goes on. */
  onPartial?: (result: AnalysisResult) => void;
}

/**
 * Run a single model analysis in a Web Worker, with `threads − 1`
 * evaluator workers for its trial surfaces (analysis-workers.ts).
 *
 * Returns a `{ promise, cancel }` handle.  The promise resolves with
 * the `AnalysisResult` on success, or rejects on error / timeout.
 * Calling `cancel()` terminates the workers early.
 */
export function executeModelAnalysis(
  model: ModelEntry,
  onProgress?: (progress: number) => void,
  threads = analysisThreads(),
  events?: RunEvents,
): AnalysisHandle {
  const { slope, options } = workerInputs(model);
  const boundaries = model.materialBoundaries ?? [];
  // the finite element analysis takes the model in its own coordinates
  const femSlope = options.fem?.enabled ? buildModelSpaceSlopeDTO(model) : undefined;
  const handle = runInWorker<AnalysisResult>(
    { type: "run-analysis", id: crypto.randomUUID(), slope, options, ...(femSlope ? { femSlope } : {}) },
    analysisTimeoutMs(options),
    onProgress,
    RUN_PROGRESS_MAX,
    threads,
    events && {
      ...events,
      onPartial: events.onPartial && ((r) => events.onPartial!(boundaryWarningsInStoreOrder(r, boundaries))),
    },
  );
  return {
    ...handle,
    promise: handle.promise.then((r) => boundaryWarningsInStoreOrder(r, boundaries)),
  };
}

/** A cancellable handle to a running probabilistic analysis. */
export interface ReliabilityHandle {
  promise: Promise<ReliabilityResult>;
  cancel: () => void;
}

/**
 * Probabilistic analysis of a model in a Web Worker. The variables refer
 * to the model's materials by index. A Taylor series with search runs
 * 1 + 2n analyses and a Monte Carlo run one search plus the samples, so
 * the time budget grows with them.
 */
export function executeReliability(
  model: ModelEntry,
  variables: RandomVariable[],
  reliability: Omit<ReliabilityOptions, "onProgress">,
  onProgress?: (progress: number) => void,
  threads = analysisThreads(),
): ReliabilityHandle {
  const { slope, options } = workerInputs(model);
  const runs =
    reliability.method === "taylor"
      ? (reliability.search ?? true) ? 1 + 2 * variables.length : 2
      : 1 + (reliability.samples ?? 1000) / 500;
  return runInWorker<ReliabilityResult>(
    { type: "run-reliability", id: crypto.randomUUID(), slope, options, variables, reliability },
    analysisTimeoutMs(options) * runs,
    onProgress,
    1, // reports real progress, up to done
    threads,
  );
}

function workerInputs(model: ModelEntry): { slope: SlopeDefinition; options: AnalysisOptions } {
  const problems = findExpressionErrors(model);
  if (problems.length > 0) {
    throw new Error(
      `Cannot run: ${problems.length} expression(s) cannot be evaluated — ${problems.join("; ")}`,
    );
  }
  const slope = buildSlopeDTOFromModel(model);
  const options: AnalysisOptions = model.options ?? {
    ...DEFAULT_ANALYSIS_OPTIONS,
    method: "Morgenstern-Price",
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
  };
  return { slope, options };
}

function runInWorker<T>(
  request: WorkerMessage,
  timeoutMs: number,
  onProgress?: (progress: number) => void,
  progressMax = RUN_PROGRESS_MAX,
  threads = 1,
  events?: RunEvents,
): { promise: Promise<T>; cancel: () => void } {
  // The analysis worker and its evaluators (each connected to it by its own
  // channel) come from the idle workers, which have the engine loaded and
  // compiled, and go back after a completed run (analysis-workers.ts).
  const workers = acquireWorkers(threads);
  let worker: Worker | null = workers[0];
  let evaluators = workers.slice(1);
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let rejectPromise: ((reason: Error) => void) | null = null;

  /**
   * Ends the run: keeps the workers of a completed run for the next, and
   * stops those of a cancelled, failed or timed-out one.
   */
  const stop = (completed = false) => {
    settled = true;
    const all = worker ? [worker, ...evaluators] : evaluators;
    if (completed) releaseWorkers(all);
    else discardWorkers(all);
    worker = null;
    evaluators = [];
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  // Cancelling rejects the promise so that anything awaiting it (Run All)
  // can finish instead of hanging forever.
  const cancel = () => {
    if (settled) return;
    stop();
    rejectPromise?.(new AnalysisCancelledError());
  };

  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    timeout = setTimeout(() => {
      if (settled) return;
      stop();
      reject(
        new Error(
          `Analysis timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        ),
      );
    }, timeoutMs);

    worker!.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      if (settled) return;
      const msg = event.data;
      if (msg.type === "analysis-complete" || msg.type === "reliability-complete") {
        stop(true);
        resolve(msg.result as T);
      } else if (msg.type === "analysis-progress") {
        onProgress?.(Math.min(progressMax, Math.max(0, msg.progress)));
        if (msg.stage) events?.onStage?.(msg.stage);
      } else if (msg.type === "analysis-partial") {
        events?.onPartial?.(msg.result);
      } else if (msg.type === "analysis-error") {
        stop();
        reject(new Error(msg.error));
      }
    };

    worker!.onerror = (err) => {
      if (settled) return;
      stop();
      reject(new Error(err.message || "The analysis worker failed to start."));
    };

    // every worker gets the compiled engine with its request (it starts
    // the engine on the first; an idle worker reused has it already)
    const engine = engineModule();
    if (evaluators.length === 0) {
      worker!.postMessage({ ...request, engine });
      return;
    }
    const ports = evaluators.map((evaluator) => {
      const channel = new MessageChannel();
      evaluator.onerror = worker!.onerror;
      evaluator.postMessage({ type: "serve-evaluator", port: channel.port1, engine } satisfies WorkerMessage, [channel.port1]);
      return channel.port2;
    });
    worker!.postMessage({ ...request, evaluators: ports, engine }, ports);
  });

  return { promise, cancel };
}

/** Model-shaped snapshot of the active model's analysis inputs. */
export function snapshotFromState(state: AppState): ModelEntry {
  return {
    id: state.activeModelId,
    name: "",
    orientation: state.orientation,
    coordinates: state.coordinates,
    coordinateExpressions: state.coordinateExpressions,
    parameters: state.parameters,
    materials: state.materials,
    materialBoundaries: state.materialBoundaries,
    regionMaterials: state.regionMaterials,
    piezometricLine: state.piezometricLine,
    udls: state.udls,
    lineLoads: state.lineLoads,
    reinforcements: state.reinforcements,
    piles: state.piles,
    customSearchPlanes: state.customSearchPlanes,
    customPlanesOnly: state.customPlanesOnly,
    blockSearchObjects: state.blockSearchObjects,
    waternet: state.waternet,
    earlierStage: state.earlierStage,
    options: state.options,
    analysisLimits: state.analysisLimits,
  };
}

/**
 * Key identifying exactly what the engine is asked to compute.  A result
 * is only accepted if the model still produces the same key when the run
 * finishes.
 */
function analysisInputKey(model: ModelEntry): string {
  return JSON.stringify({
    slope: buildSlopeDTOFromModel(model),
    options: model.options,
  });
}

// ── Single-run state ───────────────────────────────────────────────

/** Handle for the currently running single-model analysis. */
let activeHandle: AnalysisHandle | null = null;
/** Model the single run belongs to (the user may switch away meanwhile). */
let activeRunModelId: string | null = null;
let activeProgressInterval: ReturnType<typeof setInterval> | null = null;

// ── Run-all state ──────────────────────────────────────────────────

/** Bumped to abandon an in-flight Run All (cancel, new/open project). */
let batchGeneration = 0;
const batchHandles = new Set<AnalysisHandle>();

/**
 * Cancel every running analysis (single and Run All) without touching
 * store state. Used when the whole project is replaced.
 */
export function abortAllAnalyses(): void {
  activeHandle?.cancel();
  activeHandle = null;
  activeRunModelId = null;
  stopProgressInterval();
  batchGeneration += 1;
  for (const handle of batchHandles) handle.cancel();
  batchHandles.clear();
}

/** Stop the single run of a model that is being deleted. */
export function cancelRunForModel(modelId: string): void {
  if (activeHandle && activeRunModelId === modelId) {
    activeHandle.cancel();
    activeHandle = null;
    activeRunModelId = null;
    stopProgressInterval();
  }
}

const RUN_PROGRESS_MAX = 0.95;

function stopProgressInterval() {
  if (activeProgressInterval) {
    clearInterval(activeProgressInterval);
    activeProgressInterval = null;
  }
}

export const createAnalysisSlice: SliceCreator<AnalysisSlice> = (set, get) => ({
  analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
  customSearchPlanes: [],
  customPlanesOnly: false,
  blockSearchObjects: [],
  options: {
    ...DEFAULT_ANALYSIS_OPTIONS,
    method: "Morgenstern-Price",
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
  },
  iterations: 1000,
  refinedIterations: 500,
  runState: "idle",
  progress: 0,
  result: null,
  errorMessage: null,
  runAll: null,
  runStage: null,
  runStartedAt: null,

  invalidateAnalysis: () => {
    // A run for the model being edited would finish with a result for the
    // old inputs, so stop it.  Runs for other models are left alone.
    if (activeHandle && activeRunModelId === get().activeModelId) {
      activeHandle.cancel();
      activeHandle = null;
      activeRunModelId = null;
      stopProgressInterval();
    }
    // Also the stored entry: a Run All finishing later (or switching away
    // and back) would otherwise bring the old result back.
    set((s) => ({
      ...RUN_RESET,
      models: s.models.map((m) =>
        m.id === s.activeModelId ? { ...m, ...RUN_RESET } : m,
      ),
    }));
  },

  setAnalysisLimits: (limits) => {
    set((s) => {
      const analysisLimits = { ...s.analysisLimits, ...limits };
      return {
        analysisLimits,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, analysisLimits } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  addCustomSearchPlane: (kind = "circle") => {
    set((s) => {
      const plane =
        kind === "polyline"
          ? { id: nextId("csp"), cx: 0, cy: 0, radius: 0, points: [] }
          : { id: nextId("csp"), ...defaultCustomCircle(s.coordinates, s.orientation) };
      const customSearchPlanes = [...s.customSearchPlanes, plane];
      return {
        customSearchPlanes,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, customSearchPlanes } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  updateCustomSearchPlane: (id, patch) => {
    set((s) => {
      const customSearchPlanes = s.customSearchPlanes.map((p) =>
        p.id === id ? { ...p, ...patch } : p,
      );
      return {
        customSearchPlanes,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, customSearchPlanes } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  removeCustomSearchPlane: (id) => {
    set((s) => {
      const customSearchPlanes = s.customSearchPlanes.filter(
        (p) => p.id !== id,
      );
      return {
        customSearchPlanes,
        selectedCustomPlaneId:
          s.selectedCustomPlaneId === id ? null : s.selectedCustomPlaneId,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, customSearchPlanes } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  updateCustomPlanePoint: (id, pointIndex, point) => {
    const plane = get().customSearchPlanes.find((p) => p.id === id);
    if (!plane?.points || pointIndex < 0 || pointIndex >= plane.points.length) return;
    const points = plane.points.map((p, i) => (i === pointIndex ? point : p));
    get().updateCustomSearchPlane(id, { points });
  },

  insertCustomPlanePointAt: (id, pointIndex, point) => {
    const plane = get().customSearchPlanes.find((p) => p.id === id);
    if (!plane?.points) return;
    const at = Math.max(0, Math.min(plane.points.length, pointIndex));
    const points = [...plane.points.slice(0, at), point, ...plane.points.slice(at)];
    get().updateCustomSearchPlane(id, { points });
  },

  removeCustomPlanePoint: (id, pointIndex) => {
    const plane = get().customSearchPlanes.find((p) => p.id === id);
    // A surface needs two points.
    if (!plane?.points || plane.points.length <= 2) return;
    if (pointIndex < 0 || pointIndex >= plane.points.length) return;
    const points = plane.points.filter((_, i) => i !== pointIndex);
    get().updateCustomSearchPlane(id, { points });
  },

  selectedCustomPlaneId: null,
  // The picked plane is the canvas selection's.
  setSelectedCustomPlane: (id) => {
    const sel = get().canvasSelection;
    if (id !== null) get().selectCanvasObject({ type: "customPlane", id });
    else if (sel?.object.type === "customPlane") get().clearCanvasSelection();
    else set({ selectedCustomPlaneId: null });
  },

  setCustomPlanesOnly: (value) => {
    set((s) => ({
      customPlanesOnly: value,
      models: s.models.map((m) =>
        m.id === s.activeModelId ? { ...m, customPlanesOnly: value } : m,
      ),
    }));
    get().invalidateAnalysis();
  },

  addBlockSearchObject: () => {
    set((s) => {
      const blockSearchObjects = [...s.blockSearchObjects, { id: nextId("bso"), points: [] }];
      return {
        blockSearchObjects,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, blockSearchObjects } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  updateBlockSearchObject: (id, points) => {
    set((s) => {
      const blockSearchObjects = s.blockSearchObjects.map((o) =>
        o.id === id ? { ...o, points } : o,
      );
      return {
        blockSearchObjects,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, blockSearchObjects } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  removeBlockSearchObject: (id) => {
    set((s) => {
      const blockSearchObjects = s.blockSearchObjects.filter((o) => o.id !== id);
      return {
        blockSearchObjects,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, blockSearchObjects } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  setOptions: (opts: Partial<AnalysisOptions>) => {
    set((s) => {
      const options = { ...s.options, ...opts };
      return {
        options,
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, options } : m,
        ),
      };
    });
    get().invalidateAnalysis();
  },

  runAnalysis: () => {
    // Cancel any previously running analysis.  If it belonged to another
    // model, that model must not stay "running" forever.
    if (activeHandle) {
      activeHandle.cancel();
      activeHandle = null;
      const previousModelId = activeRunModelId;
      if (previousModelId && previousModelId !== get().activeModelId) {
        set((s) => ({
          models: s.models.map((m) =>
            m.id === previousModelId ? { ...m, ...RUN_RESET } : m,
          ),
        }));
      }
      activeRunModelId = null;
    }
    stopProgressInterval();

    const state = get();
    const runModelId = state.activeModelId;

    // Build a model snapshot from the current flat state for the shared
    // execution path.  This ensures "Run" and "Run All" go through the
    // exact same DTO-building and worker-spawning code.
    const modelSnapshot = snapshotFromState(state);
    // (building the input can fail, e.g. on imported data; report it)
    let inputKey: string;
    try {
      inputKey = analysisInputKey(modelSnapshot);
    } catch (err) {
      set({ runState: "error", progress: 0, result: null, errorMessage: analysisErrorText(err) });
      return;
    }

    set((s) => ({
      runState: "running",
      progress: 0.02,
      result: null,
      errorMessage: null,
      // (the summary of an ended Run All goes; a running one stays)
      ...(s.runAll && !s.runAll.running ? { runAll: null } : {}),
      runStage: null,
      runStartedAt: Date.now(),
    }));

    // Fake progress interval for UI responsiveness
    activeProgressInterval = setInterval(() => {
      const current = get();
      if (current.runState !== "running") {
        stopProgressInterval();
        return;
      }
      const next = Math.min(
        RUN_PROGRESS_MAX,
        current.progress +
          Math.max(0.004, (RUN_PROGRESS_MAX - current.progress) * 0.08),
      );
      if (next > current.progress) {
        set({ progress: next });
      }
    }, 120);

    let handle: AnalysisHandle;
    /** This run is still the one going on, for the model shown. */
    const current = () => activeHandle === handle && get().activeModelId === runModelId && get().runState === "running";
    try {
      handle = executeModelAnalysis(
        modelSnapshot,
        (p) => {
          if (get().activeModelId !== runModelId) return;
          set((s) => ({ progress: Math.max(s.progress, p) }));
        },
        undefined,
        {
          onStage: (text) => {
            if (current()) set({ runStage: text });
          },
          // The limit equilibrium result while the finite elements run (the
          // model's entry gets the whole result when the run is done).
          onPartial: (partial) => {
            if (current() && analysisInputKey(snapshotFromState(get())) === inputKey) set({ result: partial });
          },
        },
      );
    } catch (err) {
      stopProgressInterval();
      const errorMessage = analysisErrorText(err);
      rememberErrorInput(runModelId, errorMessage, modelSnapshot);
      set({
        runState: "error",
        progress: 0,
        errorMessage,
      });
      activeHandle = null;
      activeRunModelId = null;
      return;
    }
    activeHandle = handle;
    activeRunModelId = runModelId;

    /**
     * Store the outcome on the model the run was started for.  The flat
     * (displayed) state is only touched while that model is active, and
     * the outcome is dropped if the model's inputs changed meanwhile.
     */
    const finish = (
      outcome: Pick<ModelEntry, "runState" | "result" | "errorMessage">,
    ) => {
      if (activeHandle !== handle) return; // superseded or cancelled
      activeHandle = null;
      activeRunModelId = null;
      stopProgressInterval();
      set({ runStage: null, runStartedAt: null });

      const s = get();
      if (s.activeModelId === runModelId) {
        if (analysisInputKey(snapshotFromState(s)) !== inputKey) {
          set({ ...RUN_RESET });
          return;
        }
        const progress = outcome.runState === "done" ? 1 : 0;
        // The model's entry as well: the explorer reads it, and a Run All
        // that finishes later restores the displayed state from it.
        set({
          ...outcome,
          progress,
          models: s.models.map((m) => (m.id === runModelId ? { ...m, ...outcome, progress } : m)),
        });
        return;
      }
      const entry = s.models.find((m) => m.id === runModelId);
      if (!entry) return;
      const stale = analysisInputKey(entry) !== inputKey;
      set({
        models: s.models.map((m) =>
          m.id === runModelId
            ? stale
              ? { ...m, ...RUN_RESET }
              : {
                  ...m,
                  ...outcome,
                  progress: outcome.runState === "done" ? 1 : 0,
                }
            : m,
        ),
      });
    };

    handle.promise
      .then((result) => {
        // (the input it was computed for: the project saves its hash)
        rememberResultInput(result, modelSnapshot);
        finish({ runState: "done", result, errorMessage: null });
      })
      .catch((err) => {
        if (err instanceof AnalysisCancelledError) return;
        const errorMessage = analysisErrorText(err);
        rememberErrorInput(runModelId, errorMessage, modelSnapshot);
        finish({
          runState: "error",
          result: null,
          errorMessage,
        });
      });
  },

  cancelAnalysis: () => {
    abortAllAnalyses();
    set((s) => ({
      runState: "idle",
      progress: 0,
      errorMessage: null,
      runAll: null,
      // (a run's limit equilibrium result shown while its finite elements ran goes with it)
      result: s.runState === "running" ? null : s.result,
      runStage: null,
      runStartedAt: null,
      models: s.models.map((m) =>
        m.runState === "running" ? { ...m, runState: "idle", progress: 0, result: null } : m,
      ),
    }));
  },

  reset: () =>
    set({
      runState: "idle",
      progress: 0,
      result: null,
      errorMessage: null,
    }),

  resetAllAnalyses: () => {
    const s = get();
    const resetState = {
      runState: "idle" as const,
      progress: 0,
      result: null,
      errorMessage: null,
    };
    set({
      ...resetState,
      mode: "edit",
      ...(s.runAll?.running ? {} : { runAll: null }),
      models: s.models.map((m) => ({
        ...m,
        ...resetState,
        mode: "edit",
      })),
    });
  },

  runAllAnalyses: async () => {
    const baseState = get();
    baseState.saveCurrentModel();
    // The queue: the list's order, top to bottom, so that the user sees the
    // models run (a heavy model low in the list may end the batch a little
    // later than if it had been started first).
    const models = get().models;
    // A new batch replaces a running one: stop its workers.
    for (const handle of batchHandles) handle.cancel();
    batchHandles.clear();
    batchGeneration += 1;
    const generation = batchGeneration;
    const isCurrentBatch = () => generation === batchGeneration;

    if (models.length === 0) {
      set({ runState: "idle", progress: 0, result: null, errorMessage: null, runAll: null });
      return;
    }

    const progressByModel = new Map<string, number>(
      models.map((model) => [model.id, 0]),
    );
    /** The models being analysed now, whose progress the ticks show. */
    const running = new Set<string>();
    /** Of them, those whose worker reported progress since the last tick. */
    const reported = new Set<string>();

    /** The batch's progress: the mean of the models'. */
    const batchProgress = () => {
      let total = 0;
      for (const p of progressByModel.values()) total += p;
      return Math.max(0, Math.min(1, total / models.length));
    };
    /** Models finished (analysed, failed or dropped), and those failed. */
    let finished = 0;
    let failed = 0;
    /** The batch for the status bar. */
    /** When the batch started, for its total run time in the summary. */
    const batchStart = performance.now();
    const batchStatus = (running = true): RunAllStatus => ({
      total: models.length,
      finished,
      failed,
      progress: running ? batchProgress() : 1,
      running,
      ...(running ? {} : { elapsedMs: performance.now() - batchStart }),
    });
    /** A model's analysis ended (the caller shows it with batchStatus()). */
    const finishModel = (modelId: string, outcome: "done" | "failed") => {
      progressByModel.set(modelId, 1);
      finished += 1;
      if (outcome === "failed") failed += 1;
    };

    /**
     * Every 120 ms: advances the simulated progress of the running models
     * (those whose engine reported none meanwhile, up to RUN_PROGRESS_MAX)
     * and shows the running models' progress and the batch's, in one
     * store update for all of them. A model's progress never goes back.
     */
    const tick = () => {
      if (!isCurrentBatch()) {
        clearInterval(ticks);
        return;
      }
      for (const id of running) {
        const current = progressByModel.get(id) ?? 0;
        if (reported.has(id)) continue;
        const next = Math.min(
          RUN_PROGRESS_MAX,
          current + Math.max(0.006, (RUN_PROGRESS_MAX - current) * 0.06),
        );
        if (next > current) progressByModel.set(id, next);
      }
      reported.clear();
      const s = get();
      let updated: ModelEntry[] | null = null;
      s.models.forEach((m, i) => {
        if (!running.has(m.id)) return;
        const p = progressByModel.get(m.id) ?? 0;
        if (p <= (m.progress ?? 0)) return;
        updated ??= s.models.slice();
        updated[i] = { ...m, progress: p };
      });
      const progress = batchProgress();
      if (updated) set({ progress, runAll: batchStatus(), models: updated });
      else if (progress !== s.progress || progress !== s.runAll?.progress) {
        set({ progress, runAll: batchStatus() });
      }
    };
    const ticks = setInterval(tick, 120);

    // Track active model status in UI while running batch.
    set({ runState: "running", progress: 0, errorMessage: null, runAll: batchStatus() });

    const runModel = async (model: ModelEntry) => {
      if (!isCurrentBatch()) return;
      const freshModel = get().models.find((m) => m.id === model.id);
      if (!freshModel) {
        // (deleted meanwhile)
        finishModel(model.id, "done");
        set({ progress: batchProgress(), runAll: batchStatus() });
        return;
      }
      const inputKey = analysisInputKey(freshModel);

      /** Inputs of this model now (flat state when it is the active one). */
      const currentKey = (): string | null => {
        const s = get();
        if (s.activeModelId === freshModel.id) {
          return analysisInputKey(snapshotFromState(s));
        }
        const entry = s.models.find((m) => m.id === freshModel.id);
        return entry ? analysisInputKey(entry) : null;
      };

      progressByModel.set(freshModel.id, 0.08);

      set((s) => ({
        progress: batchProgress(),
        runAll: batchStatus(),
        models: s.models.map((m) =>
          m.id === freshModel.id
            ? {
                ...m,
                runState: "running",
                progress: 0,
                result: null,
                errorMessage: null,
              }
            : m,
        ),
        ...(freshModel.id === s.activeModelId
          ? {
              runState: "running",
              result: null,
              errorMessage: null,
            }
          : {}),
      }));

      let handle: AnalysisHandle;
      try {
        handle = executeModelAnalysis(freshModel, (p) => {
          // (shown by the next tick, with the other models')
          progressByModel.set(
            freshModel.id,
            Math.max(progressByModel.get(freshModel.id) ?? 0, p),
          );
          reported.add(freshModel.id);
        }, threads);
      } catch (err) {
        finishModel(freshModel.id, "failed");
        const errorMessage = analysisErrorText(err);
        rememberErrorInput(freshModel.id, errorMessage, freshModel);
        set((s) => ({
          progress: batchProgress(),
          runAll: batchStatus(),
          models: s.models.map((m) =>
            m.id === freshModel.id
              ? { ...m, runState: "error", errorMessage }
              : m,
          ),
          ...(freshModel.id === s.activeModelId
            ? { runState: "error", errorMessage }
            : {}),
        }));
        return;
      }

      batchHandles.add(handle);
      running.add(freshModel.id);
      try {
        const result = await handle.promise;
        rememberResultInput(result, freshModel);
        running.delete(freshModel.id);
        if (!isCurrentBatch()) return;
        finishModel(freshModel.id, "done");
        if (currentKey() !== inputKey) {
          // The model was edited while it was being analysed.
          set((s) => ({
            progress: batchProgress(),
            runAll: batchStatus(),
            models: s.models.map((m) =>
              m.id === freshModel.id ? { ...m, ...RUN_RESET } : m,
            ),
          }));
          return;
        }
        set((s) => ({
          progress: batchProgress(),
          runAll: batchStatus(),
          models: s.models.map((m) =>
            m.id === freshModel.id
              ? { ...m, runState: "done", progress: 1, result }
              : m,
          ),
          ...(freshModel.id === s.activeModelId
            ? {
                runState: "done",
                result,
                errorMessage: null,
              }
            : {}),
        }));
      } catch (err) {
        running.delete(freshModel.id);
        if (!isCurrentBatch()) return;
        if (err instanceof AnalysisCancelledError) {
          finishModel(freshModel.id, "done");
          set({ progress: batchProgress(), runAll: batchStatus() });
          return;
        }
        finishModel(freshModel.id, "failed");
        const errorMessage = analysisErrorText(err);
        rememberErrorInput(freshModel.id, errorMessage, freshModel);
        set((s) => ({
          progress: batchProgress(),
          runAll: batchStatus(),
          models: s.models.map((m) =>
            m.id === freshModel.id
              ? { ...m, runState: "error", errorMessage }
              : m,
          ),
          ...(freshModel.id === s.activeModelId
            ? { runState: "error", errorMessage }
            : {}),
        }));
      } finally {
        batchHandles.delete(handle);
      }
    };

    // A model per core at once; the cores left over go to the models'
    // own evaluators (one model alone gets them all).
    const concurrency = Math.max(1, Math.min(models.length, coreCount()));
    const threads = threadsPerRun(concurrency);
    let cursor = 0;

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (cursor < models.length && isCurrentBatch()) {
          const model = models[cursor++];
          await runModel(model);
        }
      }),
    );

    clearInterval(ticks);
    if (!isCurrentBatch()) return;
    // The batch's summary, until the next run or reset.
    set({ runAll: batchStatus(false) });

    const currentActiveId = get().activeModelId;
    // A single run started on the active model meanwhile owns its display.
    if (activeRunModelId === currentActiveId) return;
    const refreshedActive = get().models.find((m) => m.id === currentActiveId);
    if (refreshedActive) {
      set({
        runState: refreshedActive.runState ?? "idle",
        progress: 1,
        result: refreshedActive.result ?? null,
        errorMessage: refreshedActive.errorMessage ?? null,
      });
    } else {
      set({ runState: "idle", progress: 1 });
    }
  },
});
