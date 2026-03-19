import {
  DEFAULT_ANALYSIS_OPTIONS,
  resolveOrientation,
  type AnalysisOptions,
  type MaterialModel,
} from "@cslope/engine";
import { DEFAULT_MODEL_NAME } from "../constants";
import {
  DEFAULT_ANALYSIS_LIMITS,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  createDefaultProjectInfo,
  DEFAULT_RESULT_VIEW_SETTINGS,
  MATERIAL_COLORS,
} from "./defaults";
import type {
  AnalysisLimitsState,
  AppState,
  CoordinateExpression,
  LineLoadRow,
  MaterialRow,
  ModelEntry,
  ParameterDef,
  PiezometricLineState,
  ProjectInfo,
  ResultViewSettings,
  UdlRow,
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
  const coordinateExpressions = normalizeCoordinateExpressions(
    model.coordinateExpressions,
    coordinates.length,
    true,
  );
  const orientation = resolveOrientation(
    model.orientation === "ltr" || model.orientation === "rtl"
      ? model.orientation
      : undefined,
    coordinates,
  );

  return {
    id: model.id,
    name: typeof model.name === "string" ? model.name : DEFAULT_MODEL_NAME,
    orientation,
    projectInfo: normalizeProjectInfo(model.projectInfo),
    coordinates,
    coordinateExpressions,
    parameters: normalizeParameters(model.parameters, true),
    materials: (model.materials as unknown[]).map((m, i) =>
      normalizeMaterial(m, i),
    ),
    materialBoundaries: (Array.isArray(model.materialBoundaries)
      ? model.materialBoundaries.map((boundary) => {
          const boundaryRecord = boundary as Record<string, unknown>;
          const boundaryCoordinates = Array.isArray(boundaryRecord.coordinates)
            ? [...boundaryRecord.coordinates]
            : [];
          return {
            ...boundaryRecord,
            coordinates: boundaryCoordinates,
            coordinateExpressions: normalizeCoordinateExpressions(
              boundaryRecord.coordinateExpressions,
              boundaryCoordinates.length,
              true,
            ),
          };
        })
      : []) as unknown as ModelEntry["materialBoundaries"],
    regionMaterials: Array.isArray(model.regionMaterials)
      ? (
          model.regionMaterials as {
            point: [number, number];
            materialId: string;
          }[]
        ).map((a) => ({
          point: [...a.point] as [number, number],
          materialId: a.materialId,
        }))
      : [],
    piezometricLine: normalizePiezo(model.piezometricLine),
    udls: Array.isArray(model.udls)
      ? ((model.udls as unknown[])
          .map(normalizeUdl)
          .filter(Boolean) as UdlRow[])
      : [],
    lineLoads: Array.isArray(model.lineLoads)
      ? ((model.lineLoads as unknown[])
          .map(normalizeLineLoad)
          .filter(Boolean) as LineLoadRow[])
      : [],
    options: model.options
      ? normalizeAnalysisOptions(model.options)
      : { ...DEFAULT_ANALYSIS_OPTIONS },
    analysisLimits: normalizeAnalysisLimits(model.analysisLimits),
    editViewOffset: (model.editViewOffset ??
      model.viewOffset) as ModelEntry["editViewOffset"],
    editViewScale: (model.editViewScale ??
      model.viewScale) as ModelEntry["editViewScale"],
    resultViewOffset: (model.resultViewOffset ??
      model.viewOffset) as ModelEntry["resultViewOffset"],
    resultViewScale: (model.resultViewScale ??
      model.viewScale) as ModelEntry["resultViewScale"],
    customSearchPlanes: (Array.isArray(model.customSearchPlanes)
      ? model.customSearchPlanes
      : []) as ModelEntry["customSearchPlanes"],
    customPlanesOnly: (model.customPlanesOnly ===
      true) as ModelEntry["customPlanesOnly"],
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
    return createDefaultProjectInfo();
  }
  const info = raw as Partial<ProjectInfo>;
  const base = createDefaultProjectInfo();
  const width =
    typeof info.canvasWidth === "number" && isFinite(info.canvasWidth)
      ? info.canvasWidth
      : base.canvasWidth;
  const height =
    typeof info.canvasHeight === "number" && isFinite(info.canvasHeight)
      ? info.canvasHeight
      : base.canvasHeight;
  return {
    title: typeof info.title === "string" ? info.title : base.title,
    subtitle: typeof info.subtitle === "string" ? info.subtitle : base.subtitle,
    client: typeof info.client === "string" ? info.client : base.client,
    projectNumber:
      typeof info.projectNumber === "string"
        ? info.projectNumber
        : base.projectNumber,
    revision: typeof info.revision === "string" ? info.revision : base.revision,
    author: typeof info.author === "string" ? info.author : base.author,
    checker: typeof info.checker === "string" ? info.checker : base.checker,
    date: typeof info.date === "string" ? info.date : base.date,
    description:
      typeof info.description === "string"
        ? info.description
        : base.description,
    canvasWidth: width,
    canvasHeight: height,
  };
}

function normalizeResultView(raw: unknown): ResultViewSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_RESULT_VIEW_SETTINGS };
  }
  const view = raw as Partial<ResultViewSettings>;
  const rawPaperFrame =
    view.paperFrame ?? DEFAULT_RESULT_VIEW_SETTINGS.paperFrame;
  const paperFrame = {
    paperSize:
      rawPaperFrame.paperSize ??
      DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.paperSize,
    landscape:
      typeof rawPaperFrame.landscape === "boolean"
        ? rawPaperFrame.landscape
        : DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.landscape,
    showFrame:
      typeof rawPaperFrame.showFrame === "boolean"
        ? rawPaperFrame.showFrame
        : DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.showFrame,
  };
  const annotations = Array.isArray(view.annotations)
    ? view.annotations.filter(
        (anno): anno is ResultViewSettings["annotations"][number] => {
          if (!anno || typeof anno !== "object") return false;
          const a = anno as unknown as Record<string, unknown>;
          if (typeof a.id !== "string") return false;
          if (typeof a.type !== "string") return false;
          if (typeof a.x !== "number" || typeof a.y !== "number") return false;
          return true;
        },
      )
    : [];

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
    showSoilColor:
      view.showSoilColor ?? DEFAULT_RESULT_VIEW_SETTINGS.showSoilColor,
    annotations,
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
          coordinateExpressions: normalizeCoordinateExpressions(
            l.coordinateExpressions,
            Array.isArray(l.coordinates) ? l.coordinates.length : 0,
            true,
          ),
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

// ── 4.2 — Material field validation ──

const finiteOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && isFinite(v) ? v : fallback;

function normalizeMaterial(raw: unknown, index: number): MaterialRow {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_MATERIAL, id: `mat-${index + 1}` };
  }
  const m = raw as Record<string, unknown>;

  const name = typeof m.name === "string" ? m.name : DEFAULT_MATERIAL.name;
  const color =
    typeof m.color === "string" && m.color.length > 0
      ? m.color
      : MATERIAL_COLORS[index % MATERIAL_COLORS.length];
  const depthRange = (
    Array.isArray(m.depthRange) &&
    m.depthRange.length >= 2 &&
    typeof m.depthRange[0] === "number" &&
    typeof m.depthRange[1] === "number"
      ? [m.depthRange[0], m.depthRange[1]]
      : undefined
  ) as [number, number] | undefined;

  // Use persisted model if present; otherwise synthesise from legacy flat fields
  let model: MaterialModel;
  if (m.model && typeof m.model === "object" && "kind" in (m.model as object)) {
    model = m.model as MaterialModel;
  } else {
    // Legacy file without model — synthesise MohrCoulomb from flat fields
    const unitWeight = Math.max(
      0.1,
      finiteOr(m.unitWeight, DEFAULT_MATERIAL.model.unitWeight),
    );
    const frictionAngle = Math.max(0, finiteOr(m.frictionAngle, 0));
    const cohesion = Math.max(0, finiteOr(m.cohesion, 0));
    model = {
      kind: "mohr-coulomb",
      unitWeight,
      frictionAngle,
      cohesion,
    };
  }

  return {
    id: typeof m.id === "string" ? m.id : `mat-${index + 1}`,
    name,
    color,
    depthRange,
    model,
    modelExpressions: normalizeModelExpressions(m.modelExpressions, true),
  };
}

function normalizeParameters(
  raw: unknown,
  preserveMissing: boolean,
): ParameterDef[] | undefined {
  if (!Array.isArray(raw)) return preserveMissing ? undefined : [];

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      if (
        typeof record.id !== "string" ||
        typeof record.name !== "string" ||
        typeof record.expression !== "string"
      ) {
        return null;
      }
      return {
        id: record.id,
        name: record.name,
        expression: record.expression,
      } satisfies ParameterDef;
    })
    .filter((entry): entry is ParameterDef => entry !== null);
}

function normalizeCoordinateExpressions(
  raw: unknown,
  length: number,
  preserveMissing: boolean,
): CoordinateExpression[] | undefined {
  if (!Array.isArray(raw)) {
    return preserveMissing ? undefined : Array.from({ length }, () => ({}));
  }

  const out = Array.from({ length }, (_, i) => {
    const item = raw[i];
    if (!item || typeof item !== "object") return {};
    const record = item as Record<string, unknown>;
    const next: CoordinateExpression = {};
    if (typeof record.x === "string") next.x = record.x;
    if (typeof record.y === "string") next.y = record.y;
    return next;
  });

  return out;
}

function normalizeModelExpressions(
  raw: unknown,
  preserveMissing: boolean,
): MaterialRow["modelExpressions"] {
  if (!raw || typeof raw !== "object") {
    return preserveMissing ? undefined : {};
  }

  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, string] => {
        const value = entry[1];
        return typeof value === "string";
      })
      .map(([key, value]) => [key, value]),
  );
}

// ── 4.3 — UDL / lineLoad field validation ──

function normalizeUdl(raw: unknown): UdlRow | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const id = typeof u.id === "string" ? u.id : null;
  const magnitude = finiteOr(u.magnitude, 0);
  const x1 = finiteOr(u.x1, 0);
  const x2 = finiteOr(u.x2, 0);
  if (!id || x1 === x2) return null;
  return {
    id,
    magnitude,
    x1,
    x2,
    expressions: normalizeLoadExpressions(u.expressions, ["magnitude", "x1", "x2"]),
  };
}

function normalizeLineLoad(raw: unknown): LineLoadRow | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const id = typeof l.id === "string" ? l.id : null;
  const magnitude = finiteOr(l.magnitude, 0);
  const x = finiteOr(l.x, 0);
  if (!id) return null;
  return {
    id,
    magnitude,
    x,
    expressions: normalizeLoadExpressions(l.expressions, ["magnitude", "x"]),
  };
}

function normalizeLoadExpressions(
  raw: unknown,
  allowedKeys: string[],
): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowedKeys.includes(key) || typeof value !== "string") {
      continue;
    }
    out[key] = value;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

// ── 4.4 — analysisLimits type validation ──

function normalizeAnalysisLimits(raw: unknown): AnalysisLimitsState {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_ANALYSIS_LIMITS };
  const a = raw as Record<string, unknown>;
  return {
    enabled:
      typeof a.enabled === "boolean"
        ? a.enabled
        : DEFAULT_ANALYSIS_LIMITS.enabled,
    entryLeftX: finiteOr(a.entryLeftX, DEFAULT_ANALYSIS_LIMITS.entryLeftX),
    entryRightX: finiteOr(a.entryRightX, DEFAULT_ANALYSIS_LIMITS.entryRightX),
    exitLeftX: finiteOr(a.exitLeftX, DEFAULT_ANALYSIS_LIMITS.exitLeftX),
    exitRightX: finiteOr(a.exitRightX, DEFAULT_ANALYSIS_LIMITS.exitRightX),
  };
}

function normalizeAnalysisOptions(raw: unknown): AnalysisOptions {
  const base: AnalysisOptions = { ...DEFAULT_ANALYSIS_OPTIONS };
  if (!raw || typeof raw !== "object") return base;

  const o = raw as Record<string, unknown>;
  const intersliceFunction =
    o.intersliceFunction === "constant" ||
    o.intersliceFunction === "half-sine" ||
    o.intersliceFunction === "clipped-sine" ||
    o.intersliceFunction === "trapezoidal" ||
    o.intersliceFunction === "data-point-specified"
      ? o.intersliceFunction
      : base.intersliceFunction;

  const intersliceDataPoints = Array.isArray(o.intersliceDataPoints)
    ? o.intersliceDataPoints
        .map((p) => (Array.isArray(p) ? [Number(p[0]), Number(p[1])] : null))
        .filter(
          (p): p is [number, number] =>
            !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]),
        )
    : base.intersliceDataPoints;

  return {
    ...base,
    ...o,
    method:
      o.method === "Bishop" ||
      o.method === "Janbu" ||
      o.method === "Morgenstern-Price"
        ? o.method
        : base.method,
    slices: Math.max(10, Math.min(500, finiteOr(o.slices, base.slices))),
    iterations: Math.max(
      500,
      Math.min(100000, finiteOr(o.iterations, base.iterations)),
    ),
    refinedIterations: Math.max(
      0,
      Math.min(100000, finiteOr(o.refinedIterations, base.refinedIterations)),
    ),
    minFailureDist: Math.max(
      0,
      finiteOr(o.minFailureDist, base.minFailureDist),
    ),
    tolerance: Math.max(0.000001, finiteOr(o.tolerance, base.tolerance)),
    maxIterations: Math.max(1, finiteOr(o.maxIterations, base.maxIterations)),
    intersliceFunction,
    intersliceDataPoints,
  };
}
