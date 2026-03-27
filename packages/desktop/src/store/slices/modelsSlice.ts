import { DEFAULT_ANALYSIS_OPTIONS } from "@cslope/engine";
import { DEFAULT_MODEL_NAME } from "../../constants";
import { BENCHMARK_MODELS } from "../benchmarks";
import { LOVO_MODELS } from "../lovo";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_COORDINATE_EXPRESSIONS,
  DEFAULT_COORDS,
  DEFAULT_MATERIAL,
  DEFAULT_PARAMETERS,
  DEFAULT_PIEZO_LINE,
  createDefaultProjectInfo,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "../defaults";
import type { SliceCreator } from "../helpers";
import { nextId } from "../helpers";
import type { ModelEntry, ModelsSlice } from "../types";

function cloneModelEntry(model: ModelEntry): ModelEntry {
  const clone = globalThis.structuredClone
    ? globalThis.structuredClone
    : (value: ModelEntry) => JSON.parse(JSON.stringify(value));
  return clone(model);
}

function createDefaultModel(id: string, name: string): ModelEntry {
  return {
    id,
    name,
    mode: "edit",
    orientation: "ltr",
    projectInfo: createDefaultProjectInfo(),
    coordinates: [...DEFAULT_COORDS],
    coordinateExpressions: [...DEFAULT_COORDINATE_EXPRESSIONS],
    parameters: [...DEFAULT_PARAMETERS],
    materials: [{ ...DEFAULT_MATERIAL, id: nextId("mat") }],
    materialBoundaries: [],
    regionMaterials: [],
    piezometricLine: { ...DEFAULT_PIEZO_LINE },
    udls: [],
    lineLoads: [],
    customSearchPlanes: [],
    customPlanesOnly: false,
    options: {
      ...DEFAULT_ANALYSIS_OPTIONS,
      method: "Morgenstern-Price",
      slices: 30,
      iterations: 1000,
      refinedIterations: 500,
    },
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
  };
}

const mapModelToState = (model: ModelEntry) => ({
  mode: model.mode ?? "edit",
  orientation: model.orientation ?? "ltr",
  projectInfo: model.projectInfo ?? createDefaultProjectInfo(),
  coordinates: model.coordinates,
  coordinateExpressions: model.coordinateExpressions ?? [],
  parameters: model.parameters ?? [],
  materials: model.materials,
  materialBoundaries: model.materialBoundaries,
  regionMaterials: model.regionMaterials,
  piezometricLine: model.piezometricLine ?? { ...DEFAULT_PIEZO_LINE },
  udls: model.udls ?? [],
  lineLoads: model.lineLoads ?? [],
  customSearchPlanes: model.customSearchPlanes ?? [],
  customPlanesOnly: model.customPlanesOnly ?? false,
  options: model.options ?? {
    ...DEFAULT_ANALYSIS_OPTIONS,
    method: "Morgenstern-Price",
    slices: 30,
    iterations: 1000,
    refinedIterations: 500,
  },
  analysisLimits: model.analysisLimits ?? { ...DEFAULT_ANALYSIS_LIMITS },
  editViewOffset: model.editViewOffset ?? model.viewOffset ?? [0, 0],
  editViewScale: model.editViewScale ?? model.viewScale ?? 0,
  resultViewOffset: model.resultViewOffset ?? model.viewOffset ?? [0, 0],
  resultViewScale: model.resultViewScale ?? model.viewScale ?? 0,
  resultViewSettings: model.resultViewSettings ?? {
    ...DEFAULT_RESULT_VIEW_SETTINGS,
  },
  runState: model.runState ?? "idle",
  progress: model.progress ?? 0,
  result: model.result ?? null,
  errorMessage: model.errorMessage ?? null,
  selectedPointIndex: null,
  assigningMaterialId: null,
  selectedRegionKey: null,
  selectedAnnotationIds: [],
});

export const INITIAL_MODEL_ID = "model-initial";
const STARTER_MODEL_NAME = "T-ACADS Simple";

function createStarterModel(id: string): ModelEntry {
  const starter =
    BENCHMARK_MODELS.find((m) => m.name === STARTER_MODEL_NAME) ??
    BENCHMARK_MODELS[0];
  if (!starter) {
    return createDefaultModel(id, DEFAULT_MODEL_NAME);
  }

  return {
    ...cloneModelEntry(starter),
    id,
    mode: "edit",
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
  };
}

export const INITIAL_MODEL = createStarterModel(INITIAL_MODEL_ID);

export const createModelsSlice: SliceCreator<ModelsSlice> = (set, get) => ({
  activeModelId: INITIAL_MODEL_ID,
  models: [INITIAL_MODEL],
  _pendingFitToScreen: false,
  clearPendingFitToScreen: () => set({ _pendingFitToScreen: false }),

  setProjectInfo: (patch) =>
    set((s) => ({
      projectInfo: { ...s.projectInfo, ...patch },
      models: s.models.map((m) =>
        m.id === s.activeModelId
          ? { ...m, projectInfo: { ...s.projectInfo, ...patch } }
          : m,
      ),
    })),

  updateModelProjectInfo: (id, info) =>
    set((s) => {
      const isTargetActive = id === s.activeModelId;
      return {
        models: s.models.map((m) =>
          m.id === id ? { ...m, projectInfo: info } : m,
        ),
        projectInfo: isTargetActive ? info : s.projectInfo,
      };
    }),

  addModel: (name) => {
    const id = nextId("model");
    const entry = createDefaultModel(
      id,
      name ?? `${DEFAULT_MODEL_NAME} ${get().models.length + 1}`,
    );
    set((s) => ({ models: [...s.models, entry] }));
    get().switchModel(id);
  },

  duplicateModel: (id) => {
    const s = get();
    s.saveCurrentModel();
    const source = get().models.find((m) => m.id === id);
    if (!source) return;
    const newId = nextId("model");
    const bndIdMap = new Map<string, string>();
    const matIdMap = new Map<string, string>();
    const lineIdMap = new Map<string, string>();
    const copy: ModelEntry = {
      ...source,
      id: newId,
      name: `${source.name} (copy)`,
      coordinates: source.coordinates.map((c) => [...c] as [number, number]),
      coordinateExpressions: (source.coordinateExpressions ?? []).map((expr) =>
        expr ? { ...expr } : {},
      ),
      parameters: (source.parameters ?? []).map((p) => ({ ...p })),
      materials: source.materials.map((m) => {
        const newMatId = nextId("mat");
        matIdMap.set(m.id, newMatId);
        return {
          ...m,
          id: newMatId,
          modelExpressions: { ...(m.modelExpressions ?? {}) },
        };
      }),
      materialBoundaries: source.materialBoundaries.map((b) => {
        const newBndId = nextId("bnd");
        bndIdMap.set(b.id, newBndId);
        return {
          ...b,
          id: newBndId,
          coordinates: b.coordinates.map((c) => [...c] as [number, number]),
          coordinateExpressions: (b.coordinateExpressions ?? []).map((expr) =>
            expr ? { ...expr } : {},
          ),
        };
      }),
      regionMaterials: source.regionMaterials.map((a) => ({
        point: [...a.point] as [number, number],
        materialId: matIdMap.get(a.materialId) ?? a.materialId,
      })),
      piezometricLine: {
        ...source.piezometricLine,
        lines: source.piezometricLine.lines.map((l) => {
          const newLineId = nextId("piezo");
          lineIdMap.set(l.id, newLineId);
          return {
            ...l,
            id: newLineId,
            coordinates: l.coordinates.map((c) => [...c] as [number, number]),
            coordinateExpressions: (l.coordinateExpressions ?? []).map(
              (expr) => (expr ? { ...expr } : {}),
            ),
          };
        }),
        activeLineId: source.piezometricLine.activeLineId
          ? (lineIdMap.get(source.piezometricLine.activeLineId) ??
            source.piezometricLine.activeLineId)
          : null,
        materialAssignment: Object.fromEntries(
          Object.entries(source.piezometricLine.materialAssignment).map(
            ([materialId, piezoLineId]) => [
              matIdMap.get(materialId) ?? materialId,
              lineIdMap.get(piezoLineId) ?? piezoLineId,
            ],
          ),
        ),
      },
      udls: source.udls.map((u) => ({ ...u, id: nextId("udl") })),
      lineLoads: source.lineLoads.map((l) => ({ ...l, id: nextId("ll") })),
      customSearchPlanes: (source.customSearchPlanes ?? []).map((p) => ({
        ...p,
        id: nextId("csp"),
      })),
      customPlanesOnly: source.customPlanesOnly ?? false,
      options: { ...source.options },
      analysisLimits: { ...source.analysisLimits },
      editViewOffset: source.editViewOffset
        ? ([...source.editViewOffset] as [number, number])
        : source.viewOffset
          ? ([...source.viewOffset] as [number, number])
          : undefined,
      editViewScale: source.editViewScale ?? source.viewScale,
      resultViewOffset: source.resultViewOffset
        ? ([...source.resultViewOffset] as [number, number])
        : source.viewOffset
          ? ([...source.viewOffset] as [number, number])
          : undefined,
      resultViewScale: source.resultViewScale ?? source.viewScale,
      resultViewSettings: source.resultViewSettings
        ? {
            ...source.resultViewSettings,
            annotations: source.resultViewSettings.annotations.map((a) => ({
              ...a,
            })),
            paperFrame: { ...source.resultViewSettings.paperFrame },
            viewLock: source.resultViewSettings.viewLock
              ? {
                  ...source.resultViewSettings.viewLock,
                  bottomLeft: [
                    ...source.resultViewSettings.viewLock.bottomLeft,
                  ] as [number, number],
                  topRight: [
                    ...source.resultViewSettings.viewLock.topRight,
                  ] as [number, number],
                }
              : undefined,
          }
        : undefined,
      runState: "idle",
      progress: 0,
      result: null,
      errorMessage: null,
    };

    set((st) => ({ models: [...st.models, copy] }));
    get().switchModel(newId);
  },

  deleteModel: (id) => {
    const s = get();
    if (s.models.length <= 1) return;
    const remaining = s.models.filter((m) => m.id !== id);
    const newActive =
      s.activeModelId === id ? remaining[0].id : s.activeModelId;
    set({ models: remaining });
    if (newActive !== s.activeModelId) get().switchModel(newActive);
  },

  renameModel: (id, name) =>
    set((s) => ({
      models: s.models.map((m) => (m.id === id ? { ...m, name } : m)),
    })),

  reorderModels: (draggedId, targetId, position = "before") =>
    set((s) => {
      if (draggedId === targetId) return {};
      const fromIndex = s.models.findIndex((m) => m.id === draggedId);
      const targetIndex = s.models.findIndex((m) => m.id === targetId);
      if (fromIndex < 0 || targetIndex < 0) return {};

      const reordered = [...s.models];
      const [draggedModel] = reordered.splice(fromIndex, 1);
      let insertIndex = position === "after" ? targetIndex + 1 : targetIndex;

      // Account for index shift after removing the dragged model.
      if (fromIndex < insertIndex) {
        insertIndex -= 1;
      }

      if (insertIndex === fromIndex) return {};
      reordered.splice(insertIndex, 0, draggedModel);
      return { models: reordered };
    }),

  switchModel: (id) => {
    const s = get();
    const updated = s.models.map((m) =>
      m.id === s.activeModelId
        ? {
            ...m,
            mode: s.mode,
            orientation: s.orientation,
            projectInfo: s.projectInfo,
            coordinates: s.coordinates,
            coordinateExpressions: s.coordinateExpressions,
            parameters: s.parameters,
            materials: s.materials,
            materialBoundaries: s.materialBoundaries,
            regionMaterials: s.regionMaterials,
            piezometricLine: s.piezometricLine,
            udls: s.udls,
            lineLoads: s.lineLoads,
            customSearchPlanes: s.customSearchPlanes,
            customPlanesOnly: s.customPlanesOnly,
            options: s.options,
            analysisLimits: s.analysisLimits,
            editViewOffset: s.editViewOffset,
            editViewScale: s.editViewScale,
            resultViewOffset: s.resultViewOffset,
            resultViewScale: s.resultViewScale,
            resultViewSettings: s.resultViewSettings,
            runState: s.runState,
            progress: s.progress,
            result: s.result,
            errorMessage: s.errorMessage,
          }
        : m,
    );
    const target = updated.find((m) => m.id === id);
    if (!target) return;
    set({
      models: updated,
      activeModelId: id,
      ...mapModelToState(target),
    });
  },

  saveCurrentModel: () =>
    set((s) => ({
      models: s.models.map((m) =>
        m.id === s.activeModelId
          ? {
              ...m,
              mode: s.mode,
              orientation: s.orientation,
              projectInfo: s.projectInfo,
              coordinates: s.coordinates,
              coordinateExpressions: s.coordinateExpressions,
              parameters: s.parameters,
              materials: s.materials,
              materialBoundaries: s.materialBoundaries,
              regionMaterials: s.regionMaterials,
              piezometricLine: s.piezometricLine,
              udls: s.udls,
              lineLoads: s.lineLoads,
              customSearchPlanes: s.customSearchPlanes,
              customPlanesOnly: s.customPlanesOnly,
              options: s.options,
              analysisLimits: s.analysisLimits,
              editViewOffset: s.editViewOffset,
              editViewScale: s.editViewScale,
              resultViewOffset: s.resultViewOffset,
              resultViewScale: s.resultViewScale,
              resultViewSettings: s.resultViewSettings,
              runState: s.runState,
              progress: s.progress,
              result: s.result,
              errorMessage: s.errorMessage,
            }
          : m,
      ),
    })),

  loadProject: ({ models, activeModelId }) => {
    if (!models || models.length === 0) return;
    const targetId =
      activeModelId && models.some((m) => m.id === activeModelId)
        ? activeModelId
        : models[0].id;
    const target = models.find((m) => m.id === targetId);
    if (!target) return;

    const hasSavedViewport =
      (typeof target.editViewScale === "number" && target.editViewScale > 0) ||
      (typeof target.resultViewScale === "number" &&
        target.resultViewScale > 0);

    set({
      models,
      activeModelId: targetId,
      ...mapModelToState(target),
      _pendingFitToScreen: !hasSavedViewport,
    });
  },

  newProject: () => {
    const id = nextId("model");
    const entry = createStarterModel(id);

    set({
      models: [entry],
      activeModelId: id,
      ...mapModelToState(entry),
    });
  },

  loadBenchmarks: () => {
    const models = BENCHMARK_MODELS.map(cloneModelEntry);
    if (models.length === 0) return;
    const first = models[0];
    set({
      models,
      activeModelId: first.id,
      ...mapModelToState(first),
      _pendingFitToScreen: true,
    });
  },

  loadLovoModels: () => {
    const models = LOVO_MODELS.map(cloneModelEntry);
    if (models.length === 0) return;
    const first = models[0];
    set({
      models,
      activeModelId: first.id,
      ...mapModelToState(first),
      _pendingFitToScreen: true,
    });
  },
});
