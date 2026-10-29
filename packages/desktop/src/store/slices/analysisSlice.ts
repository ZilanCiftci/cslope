import type {
  AnalysisOptions,
  AnalysisResult,
  RandomVariable,
  ReliabilityOptions,
  ReliabilityResult,
  SlopeDefinition,
} from "@cslope/engine";
import { findExpressionErrors } from "../expression-check";
import { DEFAULT_ANALYSIS_OPTIONS } from "@cslope/engine";
import type { AnalysisResponse, WorkerMessage } from "../../worker/messages";
import type { SliceCreator } from "../helpers";
import { boundaryWarningsInStoreOrder, buildSlopeDTOFromModel, nextId, RUN_RESET } from "../helpers";
import type { AnalysisSlice, AppState, ModelEntry } from "../types";
import { DEFAULT_ANALYSIS_LIMITS } from "../defaults";
import { ANALYSIS_TIMEOUT_MS, FEM_TIMEOUT_MS } from "../../constants";
import { defaultCustomCircle } from "../../utils/custom-plane";

// ── Shared worker execution ────────────────────────────────────────

/** A cancellable handle to a running analysis worker. */
export interface AnalysisHandle {
  promise: Promise<AnalysisResult>;
  cancel: () => void;
}

/** Rejection reason used when a run is cancelled; never shown to the user. */
class AnalysisCancelledError extends Error {
  constructor() {
    super("Analysis cancelled");
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
  // The limit analysis bounds: linear programs of up to two minutes each (summary.ts).
  const bounds = options.fem?.limitAnalysis ? 5 * FEM_TIMEOUT_MS : 0;
  const fem = options.fem?.enabled ? slow * FEM_TIMEOUT_MS * (1 + (options.fem.refinementLevels ?? 0)) + bounds : 0;
  return ANALYSIS_TIMEOUT_MS * Math.max(1, surfaces / 1500) + fem;
}

/**
 * Spawn a Web Worker to run a single model analysis.
 *
 * Returns a `{ promise, cancel }` handle.  The promise resolves with
 * the `AnalysisResult` on success, or rejects on error / timeout.
 * Calling `cancel()` terminates the worker early.
 */
export function executeModelAnalysis(
  model: ModelEntry,
  onProgress?: (progress: number) => void,
): AnalysisHandle {
  const { slope, options } = workerInputs(model);
  const handle = runInWorker<AnalysisResult>(
    { type: "run-analysis", id: crypto.randomUUID(), slope, options },
    analysisTimeoutMs(options),
    onProgress,
  );
  const boundaries = model.materialBoundaries ?? [];
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
): { promise: Promise<T>; cancel: () => void } {
  let worker: Worker | null = new Worker(
    new URL("../../worker/analysis.worker.ts", import.meta.url),
    { type: "module" },
  );
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let rejectPromise: ((reason: Error) => void) | null = null;

  const stop = () => {
    settled = true;
    worker?.terminate();
    worker = null;
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
        stop();
        resolve(msg.result as T);
      } else if (msg.type === "analysis-progress") {
        onProgress?.(Math.min(progressMax, Math.max(0, msg.progress)));
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

    worker!.postMessage(request);
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
        models: s.models.map((m) =>
          m.id === s.activeModelId ? { ...m, customSearchPlanes } : m,
        ),
      };
    });
    get().invalidateAnalysis();
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
    const inputKey = analysisInputKey(modelSnapshot);

    set({
      runState: "running",
      progress: 0.02,
      result: null,
      errorMessage: null,
    });

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
    try {
      handle = executeModelAnalysis(modelSnapshot, (p) => {
        if (get().activeModelId !== runModelId) return;
        set((s) => ({ progress: Math.max(s.progress, p) }));
      });
    } catch (err) {
      stopProgressInterval();
      set({
        runState: "error",
        progress: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
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
        finish({ runState: "done", result, errorMessage: null });
      })
      .catch((err) => {
        if (err instanceof AnalysisCancelledError) return;
        finish({
          runState: "error",
          result: null,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
  },

  cancelAnalysis: () => {
    abortAllAnalyses();
    set((s) => ({
      runState: "idle",
      progress: 0,
      errorMessage: null,
      models: s.models.map((m) =>
        m.runState === "running" ? { ...m, runState: "idle", progress: 0 } : m,
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
    const models = get().models.slice();
    // A new batch replaces a running one: stop its workers.
    for (const handle of batchHandles) handle.cancel();
    batchHandles.clear();
    batchGeneration += 1;
    const generation = batchGeneration;
    const isCurrentBatch = () => generation === batchGeneration;

    if (models.length === 0) {
      set({ runState: "idle", progress: 0, result: null, errorMessage: null });
      return;
    }

    const progressByModel = new Map<string, number>(
      models.map((model) => [model.id, 0]),
    );
    const modelProgressIntervals = new Map<
      string,
      ReturnType<typeof setInterval>
    >();

    const stopModelProgressInterval = (modelId: string) => {
      const interval = modelProgressIntervals.get(modelId);
      if (!interval) return;
      clearInterval(interval);
      modelProgressIntervals.delete(modelId);
    };

    const startModelProgressInterval = (modelId: string) => {
      stopModelProgressInterval(modelId);
      const interval = setInterval(() => {
        const current = progressByModel.get(modelId) ?? 0;
        const next = Math.min(
          RUN_PROGRESS_MAX,
          current + Math.max(0.006, (RUN_PROGRESS_MAX - current) * 0.06),
        );
        if (next > current) {
          progressByModel.set(modelId, next);
          updateBatchProgress();
        }
      }, 120);
      modelProgressIntervals.set(modelId, interval);
    };

    const updateBatchProgress = () => {
      const totalProgress = models.reduce(
        (sum, model) => sum + (progressByModel.get(model.id) ?? 0),
        0,
      );
      set({
        progress: Math.max(0, Math.min(1, totalProgress / models.length)),
      });
    };

    // Track active model status in UI while running batch.
    set({ runState: "running", progress: 0, errorMessage: null });

    const runModel = async (model: ModelEntry) => {
      if (!isCurrentBatch()) return;
      const freshModel = get().models.find((m) => m.id === model.id);
      if (!freshModel) return;
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
      updateBatchProgress();
      startModelProgressInterval(freshModel.id);

      set((s) => ({
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
          progressByModel.set(
            freshModel.id,
            Math.max(progressByModel.get(freshModel.id) ?? 0, p),
          );
          updateBatchProgress();
          set((s) => ({
            models: s.models.map((m) =>
              m.id === freshModel.id ? { ...m, progress: p } : m,
            ),
          }));
        });
      } catch (err) {
        stopModelProgressInterval(freshModel.id);
        progressByModel.set(freshModel.id, 1);
        updateBatchProgress();
        const errorMessage = err instanceof Error ? err.message : String(err);
        set((s) => ({
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
      try {
        const result = await handle.promise;
        stopModelProgressInterval(freshModel.id);
        if (!isCurrentBatch()) return;
        progressByModel.set(freshModel.id, 1);
        updateBatchProgress();
        if (currentKey() !== inputKey) {
          // The model was edited while it was being analysed.
          set((s) => ({
            models: s.models.map((m) =>
              m.id === freshModel.id ? { ...m, ...RUN_RESET } : m,
            ),
          }));
          return;
        }
        set((s) => ({
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
        stopModelProgressInterval(freshModel.id);
        if (err instanceof AnalysisCancelledError || !isCurrentBatch()) return;
        progressByModel.set(freshModel.id, 1);
        updateBatchProgress();
        const errorMessage = err instanceof Error ? err.message : String(err);
        set((s) => ({
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

    const maxConcurrency =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    const concurrency = Math.max(1, Math.min(models.length, maxConcurrency));
    let cursor = 0;

    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (cursor < models.length && isCurrentBatch()) {
          const model = models[cursor++];
          await runModel(model);
        }
      }),
    );

    for (const interval of modelProgressIntervals.values()) {
      clearInterval(interval);
    }
    modelProgressIntervals.clear();
    if (!isCurrentBatch()) return;

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
