import { DEFAULT_ANALYSIS_OPTIONS, resolveOrientation } from "@cslope/engine";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_PIEZO_LINE,
  DEFAULT_PROJECT_INFO,
  DEFAULT_RESULT_VIEW_SETTINGS,
} from "./defaults";
import type {
  AppState,
  ModelEntry,
  PiezometricLineState,
  ProjectInfo,
  ResultViewSettings,
} from "./types";

export const PROJECT_FILE_VERSION = 1;

export interface ProjectFile {
  version: number;
  activeModelId: string;
  models: ModelEntry[];
}

export function serializeProject(state: AppState): ProjectFile {
  return {
    version: PROJECT_FILE_VERSION,
    activeModelId: state.activeModelId,
    models: state.models,
  };
}

export function parseProjectFile(contents: string): ProjectFile {
  let data: unknown;
  try {
    data = JSON.parse(contents);
  } catch {
    throw new Error("File is not valid JSON.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("File is missing project data.");
  }

  const root = data as Partial<ProjectFile> & Record<string, unknown>;

  if (!Array.isArray(root.models) || root.models.length === 0) {
    throw new Error("File must include at least one model.");
  }

  const models = root.models.map(normalizeModelEntry);
  const requestedActiveId =
    typeof root.activeModelId === "string" ? root.activeModelId : undefined;
  const activeModelId =
    requestedActiveId && models.some((m) => m.id === requestedActiveId)
      ? requestedActiveId
      : models[0].id;

  return {
    version:
      typeof root.version === "number" ? root.version : PROJECT_FILE_VERSION,
    activeModelId,
    models,
  };
}

function normalizeModelEntry(raw: unknown): ModelEntry {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model entry is invalid.");
  }

  const model = raw as Record<string, unknown>;

  if (typeof model.id !== "string") {
    throw new Error("Model entry is missing an id.");
  }

  if (!Array.isArray(model.coordinates) || model.coordinates.length < 3) {
    throw new Error(`Model ${model.id} must include coordinates.`);
  }

  if (!Array.isArray(model.materials) || model.materials.length === 0) {
    throw new Error(`Model ${model.id} must include at least one material.`);
  }

  const coordinates = normalizeCoords(model.coordinates);
  const orientation = resolveOrientation(
    model.orientation === "ltr" || model.orientation === "rtl"
      ? model.orientation
      : undefined,
    coordinates,
  );

  return {
    id: model.id,
    name: typeof model.name === "string" ? model.name : "Untitled",
    orientation,
    projectInfo: normalizeProjectInfo(model.projectInfo),
    coordinates,
    materials: (model.materials as unknown[]).map((m) => ({
      ...(m as Record<string, unknown>),
    })) as unknown as ModelEntry["materials"],
    materialBoundaries: (Array.isArray(model.materialBoundaries)
      ? model.materialBoundaries.map((boundary) => {
          const boundaryRecord = boundary as Record<string, unknown>;
          return {
            ...boundaryRecord,
            coordinates: Array.isArray(boundaryRecord.coordinates)
              ? [...boundaryRecord.coordinates]
              : [],
          };
        })
      : []) as unknown as ModelEntry["materialBoundaries"],
    regionMaterials:
      model.regionMaterials && typeof model.regionMaterials === "object"
        ? { ...(model.regionMaterials as Record<string, string>) }
        : {},
    piezometricLine: normalizePiezo(model.piezometricLine),
    udls: (Array.isArray(model.udls)
      ? model.udls.map((load) => ({ ...(load as Record<string, unknown>) }))
      : []) as unknown as ModelEntry["udls"],
    lineLoads: (Array.isArray(model.lineLoads)
      ? model.lineLoads.map((load) => ({
          ...(load as Record<string, unknown>),
        }))
      : []) as unknown as ModelEntry["lineLoads"],
    options: model.options
      ? ({
          ...DEFAULT_ANALYSIS_OPTIONS,
          ...(model.options as Record<string, unknown>),
        } as unknown as ModelEntry["options"])
      : { ...DEFAULT_ANALYSIS_OPTIONS },
    analysisLimits: model.analysisLimits
      ? ({
          ...(model.analysisLimits as Record<string, unknown>),
        } as unknown as ModelEntry["analysisLimits"])
      : { ...DEFAULT_ANALYSIS_LIMITS },
    editViewOffset: (model.editViewOffset ??
      model.viewOffset) as ModelEntry["editViewOffset"],
    editViewScale: (model.editViewScale ??
      model.viewScale) as ModelEntry["editViewScale"],
    resultViewOffset: (model.resultViewOffset ??
      model.viewOffset) as ModelEntry["resultViewOffset"],
    resultViewScale: (model.resultViewScale ??
      model.viewScale) as ModelEntry["resultViewScale"],
    resultViewSettings: normalizeResultView(model.resultViewSettings),
    viewOffset: model.viewOffset as ModelEntry["viewOffset"],
    viewScale: model.viewScale as ModelEntry["viewScale"],
    runState: model.runState as ModelEntry["runState"],
    progress: model.progress as ModelEntry["progress"],
    result: (model.result as ModelEntry["result"]) ?? null,
    errorMessage: (model.errorMessage as ModelEntry["errorMessage"]) ?? null,
  };
}

function normalizeCoords(raw: unknown): [number, number][] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("Coordinates are missing.");
  }

  return raw.map((pair, idx) => {
    if (!Array.isArray(pair) || pair.length < 2) {
      throw new Error(`Coordinate #${idx + 1} is invalid.`);
    }
    const [x, y] = pair;
    if (typeof x !== "number" || typeof y !== "number") {
      throw new Error(`Coordinate #${idx + 1} must be numbers.`);
    }
    return [x, y];
  });
}

function normalizeProjectInfo(raw: unknown): ProjectInfo {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PROJECT_INFO };
  }
  const info = raw as Partial<ProjectInfo>;
  const width =
    typeof info.canvasWidth === "number" && isFinite(info.canvasWidth)
      ? info.canvasWidth
      : DEFAULT_PROJECT_INFO.canvasWidth;
  const height =
    typeof info.canvasHeight === "number" && isFinite(info.canvasHeight)
      ? info.canvasHeight
      : DEFAULT_PROJECT_INFO.canvasHeight;
  return {
    title:
      typeof info.title === "string" ? info.title : DEFAULT_PROJECT_INFO.title,
    subtitle:
      typeof info.subtitle === "string"
        ? info.subtitle
        : DEFAULT_PROJECT_INFO.subtitle,
    client:
      typeof info.client === "string"
        ? info.client
        : DEFAULT_PROJECT_INFO.client,
    projectNumber:
      typeof info.projectNumber === "string"
        ? info.projectNumber
        : DEFAULT_PROJECT_INFO.projectNumber,
    revision:
      typeof info.revision === "string"
        ? info.revision
        : DEFAULT_PROJECT_INFO.revision,
    author:
      typeof info.author === "string"
        ? info.author
        : DEFAULT_PROJECT_INFO.author,
    checker:
      typeof info.checker === "string"
        ? info.checker
        : DEFAULT_PROJECT_INFO.checker,
    date: typeof info.date === "string" ? info.date : DEFAULT_PROJECT_INFO.date,
    description:
      typeof info.description === "string"
        ? info.description
        : DEFAULT_PROJECT_INFO.description,
    canvasWidth: width,
    canvasHeight: height,
  };
}

function normalizeResultView(raw: unknown): ResultViewSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_RESULT_VIEW_SETTINGS };
  }
  const view = raw as Partial<ResultViewSettings>;
  const paperFrame = view.paperFrame ?? DEFAULT_RESULT_VIEW_SETTINGS.paperFrame;
  return {
    surfaceDisplay:
      view.surfaceDisplay ?? DEFAULT_RESULT_VIEW_SETTINGS.surfaceDisplay,
    fosFilterMax:
      typeof view.fosFilterMax === "number"
        ? view.fosFilterMax
        : DEFAULT_RESULT_VIEW_SETTINGS.fosFilterMax,
    showSlices: view.showSlices ?? DEFAULT_RESULT_VIEW_SETTINGS.showSlices,
    showFosLabel:
      view.showFosLabel ?? DEFAULT_RESULT_VIEW_SETTINGS.showFosLabel,
    showCentreMarker:
      view.showCentreMarker ?? DEFAULT_RESULT_VIEW_SETTINGS.showCentreMarker,
    showGrid: view.showGrid ?? DEFAULT_RESULT_VIEW_SETTINGS.showGrid,
    annotations: Array.isArray(view.annotations) ? [...view.annotations] : [],
    paperFrame: { ...paperFrame },
    viewLock:
      view.viewLock &&
      Array.isArray(view.viewLock.bottomLeft) &&
      Array.isArray(view.viewLock.topRight)
        ? {
            ...view.viewLock,
            bottomLeft: [...view.viewLock.bottomLeft],
            topRight: [...view.viewLock.topRight],
          }
        : undefined,
  };
}

function normalizePiezo(raw: unknown): PiezometricLineState {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PIEZO_LINE };
  }
  const piezo = raw as Partial<PiezometricLineState>;
  return {
    enabled: piezo.enabled ?? false,
    lines: Array.isArray(piezo.lines)
      ? piezo.lines.map((l) => ({
          ...l,
          coordinates: Array.isArray(l.coordinates) ? [...l.coordinates] : [],
        }))
      : [],
    activeLineId:
      typeof piezo.activeLineId === "string" ? piezo.activeLineId : null,
    materialAssignment:
      piezo.materialAssignment && typeof piezo.materialAssignment === "object"
        ? (piezo.materialAssignment as Record<string, string>)
        : {},
  };
}
