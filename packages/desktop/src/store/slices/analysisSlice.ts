import type { AnalysisOptions } from "@cslope/engine";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  toCanonicalSlopeDefinition,
} from "@cslope/engine";
import type { AnalysisResponse, SlopeDefinition } from "../../worker/messages";
import type { SliceCreator } from "../helpers";
import { buildSlopeDTO } from "../helpers";
import type { AnalysisSlice, ModelEntry } from "../types";
import { DEFAULT_ANALYSIS_LIMITS, DEFAULT_PIEZO_LINE } from "../defaults";
import {
  computeRegions,
  findMaterialBelowBoundary,
  type Region,
} from "../../utils/regions";
import { ANALYSIS_TIMEOUT_MS } from "../../constants";
import { nextId } from "../helpers";

/** Active worker reference — used to terminate a previous run on re-invocation. */
let activeWorker: Worker | null = null;
let activeTimeout: ReturnType<typeof setTimeout> | null = null;
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
    // Terminate any previously running worker to prevent racing updates
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
    if (activeTimeout) {
      clearTimeout(activeTimeout);
      activeTimeout = null;
    }
    stopProgressInterval();

    const state = get();
    set({
      runState: "running",
      progress: 0.02,
      result: null,
      errorMessage: null,
    });

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

    const worker = new Worker(
      new URL("../../worker/analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
    activeWorker = worker;

    // Auto-terminate after 60s
    activeTimeout = setTimeout(() => {
      if (activeWorker === worker) {
        worker.terminate();
        activeWorker = null;
        activeTimeout = null;
        set({
          runState: "error",
          errorMessage: "Analysis timed out after 60 seconds.",
        });
        stopProgressInterval();
      }
    }, ANALYSIS_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const msg = event.data;
      if (msg.type === "analysis-complete") {
        stopProgressInterval();
        set({ runState: "done", result: msg.result, progress: 1 });
        worker.terminate();
        if (activeWorker === worker) activeWorker = null;
        if (activeTimeout) {
          clearTimeout(activeTimeout);
          activeTimeout = null;
        }
      } else if (msg.type === "analysis-progress") {
        set((s) => ({
          progress: Math.max(
            s.progress,
            Math.min(RUN_PROGRESS_MAX, Math.max(0, msg.progress)),
          ),
        }));
      } else if (msg.type === "analysis-error") {
        stopProgressInterval();
        set({ runState: "error", errorMessage: msg.error });
        worker.terminate();
        if (activeWorker === worker) activeWorker = null;
        if (activeTimeout) {
          clearTimeout(activeTimeout);
          activeTimeout = null;
        }
      }
    };

    worker.onerror = (err) => {
      stopProgressInterval();
      set({ runState: "error", errorMessage: err.message });
      worker.terminate();
      if (activeWorker === worker) activeWorker = null;
      if (activeTimeout) {
        clearTimeout(activeTimeout);
        activeTimeout = null;
      }
    };

    worker.postMessage({
      type: "run-analysis",
      id: crypto.randomUUID(),
      slope: buildSlopeDTO(state),
      options: state.options,
    });
  },

  cancelAnalysis: () => {
    if (activeWorker) {
      activeWorker.terminate();
      activeWorker = null;
    }
    if (activeTimeout) {
      clearTimeout(activeTimeout);
      activeTimeout = null;
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

    const runModel = (model: ModelEntry) =>
      new Promise<void>((resolve) => {
        const freshModel = get().models.find((m) => m.id === model.id);
        if (!freshModel) return resolve();

        const slope = buildSlopeFromModel(freshModel);
        const worker = new Worker(
          new URL("../../worker/analysis.worker.ts", import.meta.url),
          { type: "module" },
        );

        // 60s timeout per individual model
        const timeout = setTimeout(() => {
          worker.terminate();
          stopModelProgressInterval(freshModel.id);
          progressByModel.set(freshModel.id, 1);
          updateBatchProgress();
          set((s) => ({
            models: s.models.map((m) =>
              m.id === freshModel.id
                ? {
                    ...m,
                    runState: "error",
                    errorMessage: "Analysis timed out after 60 seconds.",
                  }
                : m,
            ),
            ...(freshModel.id === activeId
              ? {
                  runState: "error",
                  errorMessage: "Analysis timed out after 60 seconds.",
                }
              : {}),
          }));
          resolve();
        }, ANALYSIS_TIMEOUT_MS);

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

        worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
          const msg = event.data;
          if (msg.type === "analysis-complete") {
            clearTimeout(timeout);
            stopModelProgressInterval(freshModel.id);
            progressByModel.set(freshModel.id, 1);
            updateBatchProgress();
            set((s) => ({
              models: s.models.map((m) =>
                m.id === freshModel.id
                  ? { ...m, runState: "done", progress: 1, result: msg.result }
                  : m,
              ),
              ...(freshModel.id === activeId
                ? {
                    runState: "done",
                    result: msg.result,
                    errorMessage: null,
                  }
                : {}),
            }));
            worker.terminate();
            resolve();
          } else if (msg.type === "analysis-progress") {
            const nextProgress = Math.min(
              RUN_PROGRESS_MAX,
              Math.max(0, msg.progress),
            );
            progressByModel.set(
              freshModel.id,
              Math.max(progressByModel.get(freshModel.id) ?? 0, nextProgress),
            );
            updateBatchProgress();
            set((s) => ({
              models: s.models.map((m) =>
                m.id === freshModel.id ? { ...m, progress: nextProgress } : m,
              ),
            }));
          } else if (msg.type === "analysis-error") {
            clearTimeout(timeout);
            stopModelProgressInterval(freshModel.id);
            progressByModel.set(freshModel.id, 1);
            updateBatchProgress();
            set((s) => ({
              models: s.models.map((m) =>
                m.id === freshModel.id
                  ? {
                      ...m,
                      runState: "error",
                      errorMessage: msg.error,
                    }
                  : m,
              ),
              ...(freshModel.id === activeId
                ? { runState: "error", errorMessage: msg.error }
                : {}),
            }));
            worker.terminate();
            resolve();
          }
        };

        worker.onerror = (err) => {
          clearTimeout(timeout);
          stopModelProgressInterval(freshModel.id);
          progressByModel.set(freshModel.id, 1);
          updateBatchProgress();
          set((s) => ({
            models: s.models.map((m) =>
              m.id === freshModel.id
                ? { ...m, runState: "error", errorMessage: err.message }
                : m,
            ),
            ...(freshModel.id === activeId
              ? { runState: "error", errorMessage: err.message }
              : {}),
          }));
          worker.terminate();
          resolve();
        };

        worker.postMessage({
          type: "run-analysis",
          id: crypto.randomUUID(),
          slope,
          options: freshModel.options ?? {
            ...DEFAULT_ANALYSIS_OPTIONS,
            method: "Morgenstern-Price",
            slices: 30,
          },
        });
      });

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

function buildSlopeFromModel(model: ModelEntry): SlopeDefinition {
  const materials = model.materials ?? [];
  const analysisLimits = model.analysisLimits ?? { ...DEFAULT_ANALYSIS_LIMITS };
  const piezometricLine = model.piezometricLine ?? { ...DEFAULT_PIEZO_LINE };
  const slope: SlopeDefinition = {
    orientation: model.orientation ?? "ltr",
    coordinates: model.coordinates,
    materials: materials.map((m) => ({
      name: m.name,
      unitWeight: m.unitWeight,
      frictionAngle: m.frictionAngle,
      cohesion: m.cohesion,
      color: m.color,
      depthRange: m.depthRange,
      model: m.model,
    })),
  };

  if (model.materialBoundaries?.length) {
    const defaultMatId = materials[0]?.id ?? "";
    const regions = computeRegions(
      model.coordinates,
      model.materialBoundaries,
      model.regionMaterials,
      defaultMatId,
    );

    slope.materialBoundaries = model.materialBoundaries.map((b) => {
      const matId = findMaterialBelowBoundary(b, regions, defaultMatId);
      const matName =
        materials.find((m) => m.id === matId)?.name ?? materials[0]?.name ?? "";
      return {
        coordinates: b.coordinates,
        materialName: matName,
      };
    });

    const topRegion = regions.find((r: Region) => r.regionKey === "top");
    if (topRegion && topRegion.materialId !== defaultMatId) {
      const topMatName = materials.find(
        (m) => m.id === topRegion.materialId,
      )?.name;
      if (topMatName) slope.topRegionMaterialName = topMatName;
    }
  }

  if (analysisLimits.enabled) {
    slope.analysisLimits = {
      entryLeftX: analysisLimits.entryLeftX,
      entryRightX: analysisLimits.entryRightX,
      exitLeftX: analysisLimits.exitLeftX,
      exitRightX: analysisLimits.exitRightX,
    };
  }

  if (piezometricLine.lines.length > 0) {
    const firstLine = piezometricLine.lines[0];
    if (firstLine.coordinates.length >= 2) {
      slope.waterTable = { mode: "custom", value: firstLine.coordinates };
    }
  }

  if (model.udls?.length) {
    slope.udls = model.udls.map((u) => ({
      magnitude: u.magnitude,
      x1: u.x1,
      x2: u.x2,
    }));
  }

  if (model.lineLoads?.length) {
    slope.lineLoads = model.lineLoads.map((l) => ({
      magnitude: l.magnitude,
      x: l.x,
    }));
  }

  return toCanonicalSlopeDefinition(slope);
}
