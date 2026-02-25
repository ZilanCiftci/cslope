import { DEFAULT_ANALYSIS_OPTIONS } from "@cslope/engine";
import { DEFAULT_MODEL_NAME } from "../../constants";
import { BENCHMARK_MODELS } from "../examples";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_COORDS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  DEFAULT_PROJECT_INFO,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "../defaults";
import type { SliceCreator } from "../helpers";
import { nextId } from "../helpers";
import type { ModelEntry, ModelsSlice } from "../types";

function cloneModelEntry(model: ModelEntry): ModelEntry {
  return {
    ...model,
    projectInfo: model.projectInfo ? { ...model.projectInfo } : undefined,
    coordinates: model.coordinates.map((c) => [...c] as [number, number]),
    materials: model.materials.map((m) => ({ ...m })),
    materialBoundaries: model.materialBoundaries.map((b) => ({
      ...b,
      coordinates: b.coordinates.map((c) => [...c] as [number, number]),
    })),
    regionMaterials: { ...model.regionMaterials },
    piezometricLine: {
      ...model.piezometricLine,
      lines: model.piezometricLine.lines.map((line) => ({
        ...line,
        coordinates: line.coordinates.map((c) => [...c] as [number, number]),
      })),
      materialAssignment: { ...model.piezometricLine.materialAssignment },
    },
    udls: model.udls.map((u) => ({ ...u })),
    lineLoads: model.lineLoads.map((l) => ({ ...l })),
    options: { ...model.options },
    analysisLimits: { ...model.analysisLimits },
    editViewOffset: model.editViewOffset
      ? ([...model.editViewOffset] as [number, number])
      : undefined,
    editViewScale: model.editViewScale,
    resultViewOffset: model.resultViewOffset
      ? ([...model.resultViewOffset] as [number, number])
      : undefined,
    resultViewScale: model.resultViewScale,
    viewOffset: model.viewOffset
      ? ([...model.viewOffset] as [number, number])
      : undefined,
    viewScale: model.viewScale,
    resultViewSettings: model.resultViewSettings
      ? {
          ...model.resultViewSettings,
          annotations: model.resultViewSettings.annotations.map((a) => ({
            ...a,
          })),
          paperFrame: { ...model.resultViewSettings.paperFrame },
          viewLock: model.resultViewSettings.viewLock
            ? {
                ...model.resultViewSettings.viewLock,
                bottomLeft: [
                  ...model.resultViewSettings.viewLock.bottomLeft,
                ] as [number, number],
                topRight: [...model.resultViewSettings.viewLock.topRight] as [
                  number,
                  number,
                ],
              }
            : undefined,
        }
      : undefined,
  };
}

function createDefaultModel(id: string, name: string): ModelEntry {
  return {
    id,
    name,
    orientation: "ltr",
    projectInfo: { ...DEFAULT_PROJECT_INFO },
    coordinates: [...DEFAULT_COORDS],
    materials: [{ ...DEFAULT_MATERIAL, id: nextId("mat") }],
    materialBoundaries: [],
    regionMaterials: {},
    piezometricLine: { ...DEFAULT_PIEZO_LINE },
    udls: [],
    lineLoads: [],
    options: { ...DEFAULT_ANALYSIS_OPTIONS },
    analysisLimits: { ...DEFAULT_ANALYSIS_LIMITS },
    runState: "idle",
    progress: 0,
    result: null,
    errorMessage: null,
  };
}

const mapModelToState = (model: ModelEntry) => ({
  orientation: model.orientation ?? "ltr",
  projectInfo: model.projectInfo ?? { ...DEFAULT_PROJECT_INFO },
  coordinates: model.coordinates,
  materials: model.materials,
  materialBoundaries: model.materialBoundaries,
  regionMaterials: model.regionMaterials,
  piezometricLine: model.piezometricLine ?? { ...DEFAULT_PIEZO_LINE },
  udls: model.udls ?? [],
  lineLoads: model.lineLoads ?? [],
  options: model.options ?? { ...DEFAULT_ANALYSIS_OPTIONS },
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
export const INITIAL_MODEL = createDefaultModel(
  INITIAL_MODEL_ID,
  DEFAULT_MODEL_NAME,
);

export const createModelsSlice: SliceCreator<ModelsSlice> = (set, get) => ({
  activeModelId: INITIAL_MODEL_ID,
  models: [INITIAL_MODEL],

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
      materials: source.materials.map((m) => {
        const newMatId = nextId("mat");
        matIdMap.set(m.id, newMatId);
        return { ...m, id: newMatId };
      }),
      materialBoundaries: source.materialBoundaries.map((b) => {
        const newBndId = nextId("bnd");
        bndIdMap.set(b.id, newBndId);
        return {
          ...b,
          id: newBndId,
          coordinates: b.coordinates.map((c) => [...c] as [number, number]),
        };
      }),
      regionMaterials: {},
      piezometricLine: {
        ...source.piezometricLine,
        lines: source.piezometricLine.lines.map((l) => {
          const newLineId = nextId("piezo");
          lineIdMap.set(l.id, newLineId);
          return {
            ...l,
            id: newLineId,
            coordinates: l.coordinates.map((c) => [...c] as [number, number]),
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

    for (const [key, matId] of Object.entries(source.regionMaterials)) {
      const mappedMatId = matIdMap.get(matId) ?? matId;
      if (key === "top") {
        copy.regionMaterials["top"] = mappedMatId;
      } else if (key.startsWith("below-")) {
        const idPart = key.slice(6);
        const oldIds = idPart.split("+");
        const newIds = oldIds.map((oldId) => bndIdMap.get(oldId) ?? oldId);
        copy.regionMaterials[`below-${newIds.join("+")}`] = mappedMatId;
      }
    }
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

  switchModel: (id) => {
    const s = get();
    const updated = s.models.map((m) =>
      m.id === s.activeModelId
        ? {
            ...m,
            orientation: s.orientation,
            projectInfo: s.projectInfo,
            coordinates: s.coordinates,
            materials: s.materials,
            materialBoundaries: s.materialBoundaries,
            regionMaterials: s.regionMaterials,
            piezometricLine: s.piezometricLine,
            udls: s.udls,
            lineLoads: s.lineLoads,
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
              orientation: s.orientation,
              projectInfo: s.projectInfo,
              coordinates: s.coordinates,
              materials: s.materials,
              materialBoundaries: s.materialBoundaries,
              regionMaterials: s.regionMaterials,
              piezometricLine: s.piezometricLine,
              udls: s.udls,
              lineLoads: s.lineLoads,
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

    set({
      models,
      activeModelId: targetId,
      mode: "edit",
      ...mapModelToState(target),
    });
  },

  newProject: () => {
    const id = nextId("model");
    const entry = createDefaultModel(id, DEFAULT_MODEL_NAME);

    set({
      models: [entry],
      activeModelId: id,
      mode: "edit",
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
      mode: "edit",
      ...mapModelToState(first),
    });
  },
});
