import type { AnalysisOptions } from "../../engine/types/analysis";
import { DEFAULT_ANALYSIS_OPTIONS } from "../../engine/types/analysis";
import type { AnalysisResponse, SlopeDefinition } from "../../worker/messages";
import type { SliceCreator } from "../helpers";
import { RUN_RESET } from "../helpers";
import { buildSlopeDTO } from "../helpers";
import type { AnalysisSlice, ModelEntry } from "../types";
import { DEFAULT_ANALYSIS_LIMITS, DEFAULT_PIEZO_LINE } from "../defaults";
import {
  computeRegions,
  findMaterialBelowBoundary,
  type Region,
} from "../../utils/regions";
import { toCanonicalSlopeDefinition } from "../../engine/model/canonical";

export const createAnalysisSlice: SliceCreator<AnalysisSlice> = (set, get) => ({
  analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
  options: { ...DEFAULT_ANALYSIS_OPTIONS },
  runState: "idle",
  progress: 0,
  result: null,
  errorMessage: null,

  setAnalysisLimits: (limits) =>
    set((s) => ({
      analysisLimits: { ...s.analysisLimits, ...limits },
      ...RUN_RESET,
    })),

  setOptions: (opts: Partial<AnalysisOptions>) =>
    set((s) => ({ options: { ...s.options, ...opts }, ...RUN_RESET })),

  runAnalysis: () => {
    const state = get();
    set({ runState: "running", progress: 0, result: null, errorMessage: null });

    const worker = new Worker(
      new URL("../../worker/analysis.worker.ts", import.meta.url),
      { type: "module" },
    );

    worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
      const msg = event.data;
      if (msg.type === "analysis-complete") {
        set({ runState: "done", result: msg.result, progress: 1 });
        worker.terminate();
      } else if (msg.type === "analysis-progress") {
        set({ progress: msg.progress });
      } else if (msg.type === "analysis-error") {
        set({ runState: "error", errorMessage: msg.error });
        worker.terminate();
      }
    };

    worker.onerror = (err) => {
      set({ runState: "error", errorMessage: err.message });
      worker.terminate();
    };

    worker.postMessage({
      type: "run-analysis",
      id: crypto.randomUUID(),
      slope: buildSlopeDTO(state),
      options: state.options,
    });
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
                progress: 0,
                result: null,
                errorMessage: null,
              }
            : {}),
        }));

        worker.onmessage = (event: MessageEvent<AnalysisResponse>) => {
          const msg = event.data;
          if (msg.type === "analysis-complete") {
            set((s) => ({
              models: s.models.map((m) =>
                m.id === freshModel.id
                  ? { ...m, runState: "done", progress: 1, result: msg.result }
                  : m,
              ),
              ...(freshModel.id === activeId
                ? {
                    runState: "done",
                    progress: 1,
                    result: msg.result,
                    errorMessage: null,
                  }
                : {}),
            }));
            worker.terminate();
            resolve();
          } else if (msg.type === "analysis-progress") {
            set((s) => ({
              models: s.models.map((m) =>
                m.id === freshModel.id ? { ...m, progress: msg.progress } : m,
              ),
              ...(freshModel.id === activeId ? { progress: msg.progress } : {}),
            }));
          } else if (msg.type === "analysis-error") {
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
          options: freshModel.options ?? { ...DEFAULT_ANALYSIS_OPTIONS },
        });
      });

    for (const model of get().models) {
      await runModel(model);
    }

    const refreshedActive = get().models.find((m) => m.id === activeId);
    if (refreshedActive) {
      set({
        runState: refreshedActive.runState ?? "idle",
        progress: refreshedActive.progress ?? 0,
        result: refreshedActive.result ?? null,
        errorMessage: refreshedActive.errorMessage ?? null,
      });
    } else {
      set({ runState: "idle", progress: 0 });
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
