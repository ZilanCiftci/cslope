import type { AnalysisOptions, AnalysisResult } from "@cslope/engine";
import { DEFAULT_ANALYSIS_OPTIONS } from "@cslope/engine";
import type { AnalysisResponse } from "../../worker/messages";
import type { SliceCreator } from "../helpers";
import { buildSlopeDTOFromModel, nextId } from "../helpers";
import type { AnalysisSlice, ModelEntry } from "../types";
import { DEFAULT_ANALYSIS_LIMITS } from "../defaults";
import { ANALYSIS_TIMEOUT_MS } from "../../constants";

// ── Shared worker execution ────────────────────────────────────────

/** A cancellable handle to a running analysis worker. */
interface AnalysisHandle {
  promise: Promise<AnalysisResult>;
  cancel: () => void;
}

/**
 * Spawn a Web Worker to run a single model analysis.
 *
 * Returns a `{ promise, cancel }` handle.  The promise resolves with
 * the `AnalysisResult` on success, or rejects on error / timeout.
 * Calling `cancel()` terminates the worker early.
 */
function executeModelAnalysis(
  model: ModelEntry,
  onProgress?: (progress: number) => void,
): AnalysisHandle {
  const slope = buildSlopeDTOFromModel(model);
  const options: AnalysisOptions = model.options ?? {
    ...DEFAULT_ANALYSIS_OPTIONS,
    method: "Morgenstern-Price",
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
  };

  let worker: Worker | null = new Worker(
    new URL("../../worker/analysis.worker.ts", import.meta.url),
    { type: "module" },
  );
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  const cancel = () => {
    if (settled) return;
    settled = true;
    worker?.terminate();
    worker = null;
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    timeout = setTimeout(() => {
      if (settled) return;
      cancel();
      reject(new Error("Analysis timed out after 60 seconds."));
    }, ANALYSIS_TIMEOUT_MS);

    worker!.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      if (settled) return;
      const msg = event.data;
      if (msg.type === "analysis-complete") {
        settled = true;
        if (timeout) clearTimeout(timeout);
        worker?.terminate();
        worker = null;
        resolve(msg.result);
      } else if (msg.type === "analysis-progress") {
        onProgress?.(Math.min(RUN_PROGRESS_MAX, Math.max(0, msg.progress)));
      } else if (msg.type === "analysis-error") {
        settled = true;
        if (timeout) clearTimeout(timeout);
        worker?.terminate();
        worker = null;
        reject(new Error(msg.error));
      }
    };

    worker!.onerror = (err) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      worker?.terminate();
      worker = null;
      reject(new Error(err.message));
    };

    worker!.postMessage({
      type: "run-analysis",
      id: crypto.randomUUID(),
      slope,
      options,
    });
  });

  return { promise, cancel };
}

// ── Single-run state ───────────────────────────────────────────────

/** Handle for the currently running single-model analysis. */
let activeHandle: AnalysisHandle | null = null;
let activeProgressInterval: ReturnType<typeof setInterval> | null = null;

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

  invalidateAnalysis: () =>
    set({ runState: "idle", progress: 0, result: null, errorMessage: null }),

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

  addCustomSearchPlane: () => {
    set((s) => {
      const plane = { id: nextId("csp"), cx: 0, cy: 0, radius: 10 };
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
    // Cancel any previously running analysis
    if (activeHandle) {
      activeHandle.cancel();
      activeHandle = null;
    }
    stopProgressInterval();

    const state = get();

    // Build a model snapshot from the current flat state for the shared
    // execution path.  This ensures "Run" and "Run All" go through the
    // exact same DTO-building and worker-spawning code.
    const modelSnapshot: ModelEntry = {
      id: state.activeModelId,
      name: "",
      orientation: state.orientation,
      coordinates: state.coordinates,
      materials: state.materials,
      materialBoundaries: state.materialBoundaries,
      regionMaterials: state.regionMaterials,
      piezometricLine: state.piezometricLine,
      udls: state.udls,
      lineLoads: state.lineLoads,
      customSearchPlanes: state.customSearchPlanes,
      customPlanesOnly: state.customPlanesOnly,
      options: state.options,
      analysisLimits: state.analysisLimits,
    };

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

    const handle = executeModelAnalysis(modelSnapshot, (p) =>
      set((s) => ({ progress: Math.max(s.progress, p) })),
    );
    activeHandle = handle;

    handle.promise
      .then((result) => {
        stopProgressInterval();
        set({ runState: "done", result, progress: 1 });
        if (activeHandle === handle) activeHandle = null;
      })
      .catch((err) => {
        stopProgressInterval();
        set({
          runState: "error",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        if (activeHandle === handle) activeHandle = null;
      });
  },

  cancelAnalysis: () => {
    if (activeHandle) {
      activeHandle.cancel();
      activeHandle = null;
    }
    stopProgressInterval();
    set({ runState: "idle", progress: 0, errorMessage: null });
  },

  reset: () =>
    set({
      runState: "idle",
      progress: 0,
      result: null,
      errorMessage: null,
    }),

  runAllAnalyses: async () => {
    const baseState = get();
    const activeId = baseState.activeModelId;
    baseState.saveCurrentModel();
    const models = get().models.slice();

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
      const freshModel = get().models.find((m) => m.id === model.id);
      if (!freshModel) return;

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
        ...(freshModel.id === activeId
          ? {
              runState: "running",
              result: null,
              errorMessage: null,
            }
          : {}),
      }));

      const handle = executeModelAnalysis(freshModel, (p) => {
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

      try {
        const result = await handle.promise;
        stopModelProgressInterval(freshModel.id);
        progressByModel.set(freshModel.id, 1);
        updateBatchProgress();
        set((s) => ({
          models: s.models.map((m) =>
            m.id === freshModel.id
              ? { ...m, runState: "done", progress: 1, result }
              : m,
          ),
          ...(freshModel.id === activeId
            ? {
                runState: "done",
                result,
                errorMessage: null,
              }
            : {}),
        }));
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
          ...(freshModel.id === activeId
            ? { runState: "error", errorMessage }
            : {}),
        }));
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
        while (cursor < models.length) {
          const model = models[cursor++];
          await runModel(model);
        }
      }),
    );

    for (const interval of modelProgressIntervals.values()) {
      clearInterval(interval);
    }
    modelProgressIntervals.clear();

    const refreshedActive = get().models.find((m) => m.id === activeId);
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
