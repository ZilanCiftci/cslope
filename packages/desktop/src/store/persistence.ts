import { sanitizePile, sanitizeReinforcement } from "../utils/reinforcement";
import {
  ITERATIONS_RANGE,
  REFINED_ITERATIONS_RANGE,
  SLICES_RANGE,
  DEFAULT_FEM_SETTINGS,
  resolveOrientation,
  supportsAnisotropy,
  supportsSuctionStrength,
  swedishPartialFactors,
  validateMaterialModel,
  type AnalysisOptions,
  type FemAnalysisSettings,
  type FemResultSummary,
  type MaterialModel,
  type PartialFactors,
  type SwedishFactorBasis,
  type Sgi3dResult,
  type Sgi3dSettings,
} from "@cslope/engine";
import { DEFAULT_MODEL_NAME } from "../constants";
import { nextId } from "./helpers";
import { clampMinorTicks } from "../utils/ruler";
import {
  APP_DEFAULT_ANALYSIS_OPTIONS,
  DEFAULT_ANALYSIS_LIMITS,
  TOLERANCE_RANGE,
  DEFAULT_MATERIAL,
  DEFAULT_PIEZO_LINE,
  createDefaultProjectInfo,
  DEFAULT_RESULT_VIEW_SETTINGS,
  MATERIAL_COLORS,
  PAPER_DIMENSIONS,
} from "./defaults";
import type {
  AnalysisLimitsState,
  AppState,
  CoordinateExpression,
  LineLoadRow,
  PileRow,
  ReinforcementRow,
  MaterialRow,
  ModelEntry,
  ParameterDef,
  PiezometricLineState,
  ProjectInfo,
  ResultViewSettings,
  UdlRow,
} from "./types";
/**
 * 2: vertical pore-pressure head is the default, and the S = f(datum) rate
 *    is positive for strength increasing with depth (was: with elevation).
 * 3: a water line above the ground acts as free water (was: clipped).
 */
export const PROJECT_FILE_VERSION = 3;

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

  // Files without a version predate versioning and follow version 1.
  const fileVersion = typeof root.version === "number" ? root.version : 1;
  const models = root.models
    .map((m) => (fileVersion < 2 ? migrateModelFromV1(m) : m))
    .map((m) => (fileVersion < 3 ? migrateModelFromV2(m) : m))
    .map(normalizeModelEntry);
  // Model ids are unique (every edit finds its model by id: two models
  // with one id were both changed by an edit to either).
  // A repeated id gets a suffix no model of the file uses; the active
  // model stays the first one with the requested id.
  const usedIds = new Set(models.map((m) => m.id));
  const seenIds = new Set<string>();
  for (const m of models) {
    if (seenIds.has(m.id)) {
      let k = 2;
      while (usedIds.has(`${m.id}-${k}`)) k++;
      m.id = `${m.id}-${k}`;
      usedIds.add(m.id);
    }
    seenIds.add(m.id);
  }
  const requestedActiveId =
    typeof root.activeModelId === "string" ? root.activeModelId : undefined;
  const activeModelId =
    requestedActiveId && models.some((m) => m.id === requestedActiveId)
      ? requestedActiveId
      : models[0].id;

  return {
    version: PROJECT_FILE_VERSION,
    activeModelId,
    models,
  };
}

/**
 * Version 1 files keep their results: the phreatic correction they were
 * analysed with is made explicit, and S = f(datum) rates change sign.
 */
function migrateModelFromV1(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const model = { ...(raw as Record<string, unknown>) };
  const saved =
    model.options && typeof model.options === "object"
      ? (model.options as Record<string, unknown>)
      : undefined;
  model.options = {
    ...(saved ?? APP_DEFAULT_ANALYSIS_OPTIONS),
    porePressureHead: saved?.porePressureHead ?? "phreatic-correction",
  };
  if (Array.isArray(model.materials)) {
    model.materials = model.materials.map((m: unknown) => {
      if (!m || typeof m !== "object") return m;
      const material = m as Record<string, unknown>;
      const mm = material.model as Record<string, unknown> | undefined;
      if (!mm || mm.kind !== "s-f-datum") return m;
      const migrated: Record<string, unknown> = {
        ...material,
        model: {
          ...mm,
          rate: typeof mm.rate === "number" ? -mm.rate : mm.rate,
        },
      };
      const expressions = material.modelExpressions as
        | Record<string, unknown>
        | undefined;
      if (expressions && typeof expressions.rate === "string") {
        migrated.modelExpressions = {
          ...expressions,
          rate: `-(${expressions.rate})`,
        };
      }
      return migrated;
    });
  }
  return model;
}

/** Files before version 3 clipped water lines to the ground surface. */
function migrateModelFromV2(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const model = raw as Record<string, unknown>;
  const piezo = model.piezometricLine;
  if (!piezo || typeof piezo !== "object") return raw;
  return { ...model, piezometricLine: { ...piezo, freeWater: false } };
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
      ? model.materialBoundaries
          .filter((b) => b && typeof b === "object")
          .map((boundary) => {
          const boundaryRecord = boundary as Record<string, unknown>;
          const boundaryCoordinates = normalizePoints(boundaryRecord.coordinates);
          // (named fields only: unknown keys of the file are dropped)
          return {
            id:
              typeof boundaryRecord.id === "string"
                ? boundaryRecord.id
                : nextId("bnd"),
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
      ? (model.regionMaterials as unknown[])
          .filter(isRegionAssignment)
          .map((a) => ({
            point: [a.point[0], a.point[1]] as [number, number],
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
    ...(Array.isArray(model.reinforcements)
      ? {
          reinforcements: (model.reinforcements as unknown[])
            .map((r) => sanitizeReinforcement(r, nextId("reinf")))
            .filter((r): r is ReinforcementRow => r !== null),
        }
      : {}),
    ...(Array.isArray(model.piles)
      ? {
          piles: (model.piles as unknown[])
            .map((p) => sanitizePile(p, nextId("pile")))
            .filter((p): p is PileRow => p !== null),
        }
      : {}),
    options: model.options
      ? normalizeAnalysisOptions(model.options)
      : { ...APP_DEFAULT_ANALYSIS_OPTIONS },
    analysisLimits: normalizeAnalysisLimits(model.analysisLimits),
    editViewOffset: pointOrUndefined(model.editViewOffset ?? model.viewOffset),
    editViewScale: positiveOrUndefined(model.editViewScale ?? model.viewScale),
    resultViewOffset: pointOrUndefined(
      model.resultViewOffset ?? model.viewOffset,
    ),
    resultViewScale: positiveOrUndefined(
      model.resultViewScale ?? model.viewScale,
    ),
    customSearchPlanes: Array.isArray(model.customSearchPlanes)
      ? (model.customSearchPlanes as unknown[]).flatMap((raw) => {
          if (!raw || typeof raw !== "object") return [];
          const p = raw as Record<string, unknown>;
          if (Array.isArray(p.points)) {
            return [
              {
                id: typeof p.id === "string" ? p.id : nextId("plane"),
                cx: 0,
                cy: 0,
                radius: 0,
                points: normalizePoints(p.points),
              },
            ];
          }
          const [cx, cy, radius] = [p.cx, p.cy, p.radius];
          if (
            typeof cx !== "number" || !Number.isFinite(cx) ||
            typeof cy !== "number" || !Number.isFinite(cy) ||
            typeof radius !== "number" || !Number.isFinite(radius) ||
            radius <= 0
          ) {
            return [];
          }
          return [
            { id: typeof p.id === "string" ? p.id : nextId("plane"), cx, cy, radius },
          ];
        })
      : [],
    customPlanesOnly: (model.customPlanesOnly ===
      true) as ModelEntry["customPlanesOnly"],
    // Absent in files saved before the block search (read as none).
    ...(Array.isArray(model.blockSearchObjects)
      ? {
          blockSearchObjects: (model.blockSearchObjects as unknown[]).flatMap((raw) => {
            if (!raw || typeof raw !== "object") return [];
            const o = raw as Record<string, unknown>;
            return [
              {
                id: typeof o.id === "string" ? o.id : nextId("bso"),
                points: normalizePoints(o.points),
              },
            ];
          }),
        }
      : {}),
    // Imported from .stix files; absent in older files (none).
    ...normalizeWaternet(model.waternet),
    ...normalizeEarlierStage(model.earlierStage),
    ...(Array.isArray(model.importNotes)
      ? { importNotes: (model.importNotes as unknown[]).filter((n): n is string => typeof n === "string") }
      : {}),
    resultViewSettings: normalizeResultView(model.resultViewSettings),
    viewOffset: pointOrUndefined(model.viewOffset),
    viewScale: positiveOrUndefined(model.viewScale),
    ...savedRun(model),
    mode:
      model.mode === "edit" || model.mode === "result"
        ? model.mode
        : undefined,
  };
}

/**
 * Pore pressure from head and reference lines: kept with its lines' finite
 * points; dropped when it is not an object with lists of lines.
 */
function normalizeWaternet(raw: unknown): Pick<ModelEntry, "waternet"> {
  if (!raw || typeof raw !== "object") return {};
  const w = raw as Record<string, unknown>;
  if (!Array.isArray(w.headLines) || !Array.isArray(w.referenceLines)) return {};
  const optionalId = (v: unknown) => (typeof v === "string" ? v : undefined);
  const headLines = w.headLines.flatMap((h: unknown) => {
    const line = h as Record<string, unknown> | null;
    if (!line || typeof line !== "object" || typeof line.id !== "string") return [];
    return [{ id: line.id, points: normalizePoints(line.points) }];
  });
  const referenceLines = w.referenceLines.flatMap((r: unknown) => {
    const line = r as Record<string, unknown> | null;
    if (!line || typeof line !== "object") return [];
    const top = optionalId(line.topHeadLineId);
    const bottom = optionalId(line.bottomHeadLineId);
    return [
      {
        points: normalizePoints(line.points),
        ...(top !== undefined ? { topHeadLineId: top } : {}),
        ...(bottom !== undefined ? { bottomHeadLineId: bottom } : {}),
      },
    ];
  });
  const phreatic = optionalId(w.phreaticLineId);
  return {
    waternet: {
      headLines,
      referenceLines,
      ...(phreatic !== undefined ? { phreaticLineId: phreatic } : {}),
    },
  };
}

/**
 * An earlier construction stage: an engine definition, kept as saved when
 * it has a boundary and materials (the analysis checks the rest), dropped
 * otherwise.
 */
function normalizeEarlierStage(raw: unknown): Pick<ModelEntry, "earlierStage"> {
  if (!raw || typeof raw !== "object") return {};
  const d = raw as Record<string, unknown>;
  if (!Array.isArray(d.coordinates) || !Array.isArray(d.materials)) return {};
  // only an outline and valid materials reach the analysis
  const coordinates = normalizePoints(d.coordinates);
  const materials = (d.materials as unknown[]).flatMap((m): StageDefinition["materials"] => {
    const q = m as Record<string, unknown> | null;
    if (!q || typeof q.name !== "string" || !q.model || typeof q.model !== "object" || typeof (q.model as { kind?: unknown }).kind !== "string") return [];
    const model = sanitizeMaterialModel(q.model as MaterialModel);
    if (validateMaterialModel(model).length !== 0) return [];
    // Named fields only: unknown keys of the file are dropped.
    const kept: StageDefinition["materials"][number] = { name: q.name, model };
    if (typeof q.color === "string") kept.color = q.color;
    if (typeof q.waterTableId === "string") kept.waterTableId = q.waterTableId;
    const depthRange = pointOrUndefined(q.depthRange);
    if (depthRange) kept.depthRange = depthRange;
    return [kept];
  });
  if (coordinates.length < 3 || materials.length === 0) return {};
  // The stage's other fields, by name (unknown keys of the file are dropped;
  // its own earlier stage too: one stage back only).
  const stage: Record<string, unknown> = { coordinates, materials };
  for (const key of Object.keys(STAGE_FIELDS) as (keyof typeof STAGE_FIELDS)[]) {
    if (d[key] !== undefined) stage[key] = d[key];
  }
  if (stage.materialBoundaries !== undefined) {
    stage.materialBoundaries = Array.isArray(stage.materialBoundaries)
      ? (stage.materialBoundaries as { coordinates?: unknown; materialName?: unknown }[]).map((b) => ({ coordinates: normalizePoints(b?.coordinates), materialName: typeof b?.materialName === "string" && materials.some((m) => m.name === b.materialName) ? b.materialName : "" })).filter((b) => b.coordinates.length >= 2)
      : [];
  }
  // Assignments and loads may only name the materials kept.
  const names = new Set(materials.map((m) => m.name));
  if (stage.regionAssignments !== undefined) {
    stage.regionAssignments = Array.isArray(stage.regionAssignments)
      ? (stage.regionAssignments as { point?: unknown; materialName?: unknown }[]).flatMap((a) => {
          const point = pointOrUndefined(a?.point);
          return point && typeof a.materialName === "string" && names.has(a.materialName)
            ? [{ point, materialName: a.materialName }]
            : [];
        })
      : [];
  }
  if (stage.topRegionMaterialName !== undefined && !(typeof stage.topRegionMaterialName === "string" && names.has(stage.topRegionMaterialName))) {
    delete stage.topRegionMaterialName;
  }
  const waterTable = normalizeStageWaterTable(stage.waterTable);
  if (waterTable) stage.waterTable = waterTable;
  else delete stage.waterTable;
  if (stage.waterTables !== undefined) {
    stage.waterTables = Array.isArray(stage.waterTables)
      ? (stage.waterTables as { id?: unknown; coordinates?: unknown; followBoundary?: unknown }[]).flatMap((w) => {
          const coords = normalizePoints(w?.coordinates);
          return typeof w?.id === "string" && coords.length >= 2
            ? [{ id: w.id, coordinates: coords, ...(w.followBoundary === true ? { followBoundary: true } : {}) }]
            : [];
        })
      : [];
  }
  if (stage.udls !== undefined) {
    stage.udls = Array.isArray(stage.udls) ? (stage.udls as unknown[]).flatMap((u) => normalizeStageUdl(u, names)) : [];
  }
  return { earlierStage: stage as unknown as ModelEntry["earlierStage"] };
}

type StageDefinition = NonNullable<ModelEntry["earlierStage"]>;

/**
 * The fields of an earlier stage besides its outline and materials: every
 * field of an engine definition (a new field of the definition must be
 * added here, or the stage loses it on load).
 */
const STAGE_FIELDS: Record<Exclude<keyof StageDefinition, "coordinates" | "materials">, true> = {
  orientation: true,
  waterTable: true,
  waterTables: true,
  udls: true,
  lineLoads: true,
  rapidDrawdown: true,
  waternet: true,
  reinforcements: true,
  piles: true,
  materialBoundaries: true,
  topRegionMaterialName: true,
  regionAssignments: true,
  analysisLimits: true,
  customSearchPlanes: true,
  customSurfaces: true,
  customPlanesOnly: true,
  blockSearchObjects: true,
};

/** An earlier stage's water table (an engine definition's) with finite numbers, or undefined. */
function normalizeStageWaterTable(raw: unknown): StageDefinition["waterTable"] {
  if (!raw || typeof raw !== "object") return undefined;
  const w = raw as Record<string, unknown>;
  const followBoundary = w.followBoundary === true ? { followBoundary: true } : {};
  if (w.mode === "custom") {
    const value = normalizePoints(w.value);
    return value.length >= 2 ? { mode: "custom", value, ...followBoundary } : undefined;
  }
  if ((w.mode === "height" || w.mode === "depth") && typeof w.value === "number" && Number.isFinite(w.value)) {
    return { mode: w.mode, value: w.value, ...followBoundary };
  }
  return undefined;
}

/** An earlier stage's distributed load (an engine definition's) with finite numbers, or none. */
function normalizeStageUdl(raw: unknown, materialNames: Set<string>): NonNullable<StageDefinition["udls"]> {
  if (!raw || typeof raw !== "object") return [];
  const u = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!finite(u.magnitude) || !finite(u.x1) || !finite(u.x2) || u.x1 === u.x2) return [];
  const excess = Array.isArray(u.excessPorePressure)
    ? (u.excessPorePressure as { material?: unknown; ratio?: unknown }[]).flatMap((e) =>
        e && typeof e.material === "string" && materialNames.has(e.material) && finite(e.ratio) && e.ratio >= 0 && e.ratio <= 1
          ? [{ material: e.material, ratio: e.ratio }]
          : [],
      )
    : [];
  return [
    {
      magnitude: u.magnitude,
      x1: u.x1,
      x2: u.x2,
      ...(u.direction === "normal" ? { direction: "normal" as const } : {}),
      ...(excess.length > 0 ? { excessPorePressure: excess } : {}),
    },
  ];
}

/** Keep only finite [x, y] pairs. */
function normalizePoints(raw: unknown): [number, number][] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) =>
    Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
      ? [[p[0] as number, p[1] as number] as [number, number]]
      : [],
  );
}

function pointOrUndefined(raw: unknown): [number, number] | undefined {
  return Array.isArray(raw) && Number.isFinite(raw[0]) && Number.isFinite(raw[1])
    ? [raw[0] as number, raw[1] as number]
    : undefined;
}

/** View scale: finite and not negative (0 means "fit automatically"). */
function positiveOrUndefined(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
    ? raw
    : undefined;
}

function isRegionAssignment(
  raw: unknown,
): raw is { point: [number, number]; materialId: string } {
  if (!raw || typeof raw !== "object") return false;
  const a = raw as Record<string, unknown>;
  return (
    Array.isArray(a.point) &&
    Number.isFinite(a.point[0]) &&
    Number.isFinite(a.point[1]) &&
    typeof a.materialId === "string"
  );
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

/** Whether saved limit analysis bounds have the shape the result view shows. */
function isBounds(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const b = raw as Record<string, unknown>;
  const bound = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
  const davis = b.davis as Record<string, unknown> | undefined;
  return (
    bound(b.lower) && bound(b.upper) && Number.isFinite(b.elements) && Number.isFinite(b.elapsedMs) &&
    (davis === undefined || (!!davis && typeof davis === "object" && bound(davis.lower) && bound(davis.upper))) &&
    Array.isArray(b.warnings) && b.warnings.every((w) => typeof w === "string")
  );
}

/** A saved 3D result (SGI) with its factors and critical circle. */
function isSgi3dResult(raw: unknown): raw is Sgi3dResult {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Record<string, unknown>, c = r.critical as Record<string, unknown> | undefined;
  const fin = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return (
    fin(r.factorOfSafety) && fin(r.f2dCritical) && (r.equation === "2-3" || r.equation === "2-4") &&
    !!c && typeof c === "object" && ["cx", "cy", "radius", "f2d", "fp", "f3d", "drivingMoment", "endFaceArea", "endFaceMoment"].every((k) => fin(c[k])) &&
    isSgi3dOptions(r.options) && Array.isArray(r.warnings) && r.warnings.every((w) => typeof w === "string")
  );
}

/** The options a saved 3D result was computed with. */
function isSgi3dOptions(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  const o = raw as Record<string, unknown>;
  return (
    typeof o.length === "number" && Number.isFinite(o.length) && o.length > 0 &&
    (o.overstrongF2D === null || (typeof o.overstrongF2D === "number" && Number.isFinite(o.overstrongF2D))) &&
    Array.isArray(o.excludeMaterials) && o.excludeMaterials.every((n) => typeof n === "string")
  );
}

/** The 3D effects option: a positive stage length, a positive adjacent F2D or none, material names. */
function normalizeSgi3dSettings(raw: Record<string, unknown>): Sgi3dSettings {
  const L = typeof raw.length === "number" && Number.isFinite(raw.length) && raw.length > 0 ? raw.length : 15;
  const ov = typeof raw.overstrongF2D === "number" && Number.isFinite(raw.overstrongF2D) && raw.overstrongF2D > 0 ? raw.overstrongF2D : null;
  const ex = Array.isArray(raw.excludeMaterials) ? raw.excludeMaterials.filter((n): n is string => typeof n === "string") : [];
  return { enabled: raw.enabled === true, length: L, overstrongF2D: ov, excludeMaterials: [...new Set(ex)] };
}

/** Whether a saved finite element result has the shape the canvas draws. */
function isFemSummary(raw: unknown): raw is FemResultSummary {
  if (!raw || typeof raw !== "object") return false;
  const f = raw as Record<string, unknown>;
  const nums = (a: unknown) => Array.isArray(a) && a.every((v) => typeof v === "number");
  if (!Number.isFinite(f.factorOfSafety) || !nums(f.x) || !nums(f.y) || !nums(f.triangles) || !nums(f.plasticShear)) return false;
  const x = f.x as number[], tri = f.triangles as number[];
  return (
    (f.y as number[]).length === x.length &&
    tri.length % 3 === 0 &&
    (f.plasticShear as number[]).length === tri.length / 3 &&
    (f.shearIncrement === undefined || (nums(f.shearIncrement) && (f.shearIncrement as number[]).length === tri.length / 3)) &&
    tri.every((n) => Number.isInteger(n) && n >= 0 && n < x.length) &&
    nums(f.displacement) &&
    (f.displacement as number[]).length === 2 * x.length &&
    Number.isFinite(f.elapsedMs) &&
    (f.flowRule === "davis-b" || f.flowRule === "associated" || f.flowRule === "non-associated") &&
    Array.isArray(f.levels) &&
    f.levels.every((l) => !!l && typeof l === "object" && Number.isFinite(l.elements) && Number.isFinite(l.fos)) &&
    Array.isArray(f.warnings) &&
    f.warnings.every((w) => typeof w === "string") &&
    (f.bounds === undefined || isBounds(f.bounds)) &&
    (f.piles === undefined ||
      (Array.isArray(f.piles) &&
        f.piles.every((p) => !!p && typeof p === "object" && Number.isInteger(p.pile) && [p.maxAxialForce, p.maxShearForce, p.maxMoment].every(Number.isFinite)))) &&
    (f.curve === undefined ||
      (Array.isArray(f.curve) && f.curve.every((p) => !!p && typeof p === "object" && Number.isFinite(p.F) && Number.isFinite(p.displacement))))
  );
}

/**
 * The saved outcome of a run, if it is one the app can show: a result
 * with its factor of safety and surface lists, or an error message. A run
 * cannot survive a save/load (no worker exists for it any more), and an
 * outcome of another shape (a crafted or damaged file) is dropped: the
 * result view would otherwise fail to render.
 */
function savedRun(model: Record<string, unknown>): Pick<ModelEntry, "runState" | "progress" | "result" | "errorMessage"> {
  const idle = { runState: "idle" as const, progress: 0, result: null, errorMessage: null };
  const r = model.result as Record<string, unknown> | null | undefined;
  const result =
    r &&
    typeof r === "object" &&
    Number.isFinite(r.minFOS) &&
    Array.isArray(r.allSurfaces) &&
    Array.isArray(r.criticalSlices) &&
    (r.criticalSurface === null || typeof r.criticalSurface === "object")
      ? (r as unknown as NonNullable<ModelEntry["result"]>)
      : null;
  // A finite element result of another shape is dropped; the rest stays.
  if (result && result.fem !== undefined && !isFemSummary(result.fem)) delete result.fem;
  if (result && result.femError !== undefined && typeof result.femError !== "string") delete result.femError;
  // a 3D result of another shape is dropped, as the finite elements'
  if (result && result.sgi3d !== undefined && !isSgi3dResult(result.sgi3d)) delete result.sgi3d;
  if (result && result.sgi3dError !== undefined && typeof result.sgi3dError !== "string") delete result.sgi3dError;
  const errorMessage = typeof model.errorMessage === "string" ? model.errorMessage : null;
  if (model.runState === "done" && result) return { runState: "done", progress: 1, result, errorMessage: null };
  if (model.runState === "error" && errorMessage) return { runState: "error", progress: 0, result: null, errorMessage };
  return idle;
}

/** Also used for imported view templates. */
export function normalizeResultView(raw: unknown): ResultViewSettings {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_RESULT_VIEW_SETTINGS };
  }
  const view = raw as Partial<ResultViewSettings>;
  const rawPaperFrame =
    view.paperFrame ?? DEFAULT_RESULT_VIEW_SETTINGS.paperFrame;
  const paperFrame = {
    paperSize:
      typeof rawPaperFrame.paperSize === "string" &&
      Object.hasOwn(PAPER_DIMENSIONS, rawPaperFrame.paperSize)
        ? rawPaperFrame.paperSize
        : DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.paperSize,
    landscape:
      typeof rawPaperFrame.landscape === "boolean"
        ? rawPaperFrame.landscape
        : DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.landscape,
    showFrame:
      typeof rawPaperFrame.showFrame === "boolean"
        ? rawPaperFrame.showFrame
        : DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.showFrame,
    zoom:
      typeof rawPaperFrame.zoom === "number" &&
      Number.isFinite(rawPaperFrame.zoom)
        ? rawPaperFrame.zoom
        : (DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.zoom ?? 1),
    offsetX:
      typeof rawPaperFrame.offsetX === "number" &&
      Number.isFinite(rawPaperFrame.offsetX)
        ? rawPaperFrame.offsetX
        : (DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.offsetX ?? 0),
    offsetY:
      typeof rawPaperFrame.offsetY === "number" &&
      Number.isFinite(rawPaperFrame.offsetY)
        ? rawPaperFrame.offsetY
        : (DEFAULT_RESULT_VIEW_SETTINGS.paperFrame.offsetY ?? 0),
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
    ...(Number.isFinite(view.gridSpacing)
      ? { gridSpacing: view.gridSpacing }
      : {}),
    // A whole number of ticks: a huge count made the ruler loops endless.
    ...(Number.isFinite(view.minorTicks)
      ? { minorTicks: clampMinorTicks(view.minorTicks as number) }
      : {}),
    annotations,
    paperFrame: { ...paperFrame },
    viewLock:
      view.viewLock &&
      isFinitePair(view.viewLock.bottomLeft) &&
      isFinitePair(view.viewLock.topRight)
        ? {
            bottomLeft: [...view.viewLock.bottomLeft],
            topRight: [...view.viewLock.topRight],
          }
        : undefined,
  };
}

function isFinitePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

function normalizePiezo(raw: unknown): PiezometricLineState {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_PIEZO_LINE };
  }
  const piezo = raw as Partial<PiezometricLineState>;
  const lines = Array.isArray(piezo.lines)
    ? piezo.lines
        .filter((l) => l && typeof l === "object")
        .map((l) => {
          const coordinates = normalizePoints(l.coordinates);
          return {
            ...l,
            id: typeof l.id === "string" ? l.id : nextId("piezo"),
            coordinates,
            coordinateExpressions: normalizeCoordinateExpressions(
              l.coordinateExpressions,
              coordinates.length,
              true,
            ),
          };
        })
    : [];
  // Edits go to the active line; without one they would be dropped.
  const activeLineId =
    typeof piezo.activeLineId === "string" &&
    lines.some((l) => l.id === piezo.activeLineId)
      ? piezo.activeLineId
      : (lines[0]?.id ?? null);
  const materialAssignment: Record<string, string> = {};
  if (piezo.materialAssignment && typeof piezo.materialAssignment === "object") {
    for (const [matId, lineId] of Object.entries(piezo.materialAssignment)) {
      if (typeof lineId === "string") materialAssignment[matId] = lineId;
    }
  }
  return {
    enabled: piezo.enabled ?? false,
    lines,
    activeLineId,
    materialAssignment,
    ...(typeof piezo.freeWater === "boolean" ? { freeWater: piezo.freeWater } : {}),
    ...(typeof piezo.mainLineId === "string" &&
    lines.some((l) => l.id === piezo.mainLineId)
      ? { mainLineId: piezo.mainLineId }
      : {}),
    ...normalizeRapidDrawdown(piezo.rapidDrawdown),
  };
}

/**
 * The water before a rapid drawdown: kept when it has two or more finite
 * points with x increasing, dropped otherwise (no drawdown analysis).
 */
function normalizeRapidDrawdown(raw: unknown): Pick<PiezometricLineState, "rapidDrawdown"> {
  const points = (raw as { waterBefore?: unknown } | null | undefined)?.waterBefore;
  if (!Array.isArray(points) || points.length < 2 || !points.every(isFinitePair)) return {};
  if (!points.every((p, i) => i === 0 || p[0] > points[i - 1][0])) return {};
  return { rapidDrawdown: { waterBefore: points.map(([x, y]) => [x, y] as [number, number]) } };
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
    // A bad saturated unit weight is dropped (γ applies) instead of failing
    // the analysis.
    if ("unitWeightSat" in model) {
      const g = model.unitWeightSat;
      if (!(typeof g === "number" && Number.isFinite(g) && g > 0 && g <= 500)) {
        model = { ...model };
        delete model.unitWeightSat;
      }
    }
    // A shear-normal function without a point list gets an empty one (for
    // validation to report) instead of failing the form.
    if (model.kind === "shear-normal" && !Array.isArray(model.points)) {
      model = { ...model, points: [] };
    }
    model = sanitizeMaterialModel(model);
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

/**
 * A saved material model with its optional fields checked. The strength
 * above the water line (`aboveWater`) is checked the same way, and dropped
 * when it is not a model.
 */
function sanitizeMaterialModel(model: MaterialModel, depth = 0): MaterialModel {
  let out = sanitizeDrawdown(sanitizeBBar(sanitizeSuction(sanitizeStrengthOptions(model))));
  if ("aboveWater" in out) {
    const above = out.aboveWater as unknown;
    out = { ...out };
    if (depth === 0 && above && typeof above === "object" && typeof (above as { kind?: unknown }).kind === "string") {
      out.aboveWater = sanitizeMaterialModel(above as MaterialModel, depth + 1);
    } else {
      delete out.aboveWater;
    }
  }
  return out;
}

/**
 * Depth reference, strength cutoff and anisotropy of the undrained-strength models.
 * An absent `depthReference` stays absent (the ground surface, as files
 * written before the option); an unknown value is dropped the same way. A
 * cutoff that is not a positive number is dropped (no cutoff).
 */
function sanitizeStrengthOptions(model: MaterialModel): MaterialModel {
  if (
    model.kind !== "s-f-depth" &&
    model.kind !== "s-f-datum" &&
    model.kind !== "undrained" &&
    model.kind !== "lime-cement-columns" &&
    model.kind !== "shansep"
  ) {
    return model;
  }
  let out = model;
  if ("suMax" in out) {
    const v = out.suMax;
    if (!(typeof v === "number" && Number.isFinite(v) && v > 0)) {
      out = { ...out };
      delete out.suMax;
    }
  }
  // anisotropy: an empty list or anything but a list is isotropic (dropped);
  // a list is kept as it is, for validation to report its points
  if ("anisotropy" in (out as object)) {
    const a = (out as { anisotropy?: unknown }).anisotropy;
    if (!Array.isArray(a) || a.length === 0 || !supportsAnisotropy(out.kind)) {
      out = { ...out };
      delete (out as { anisotropy?: unknown }).anisotropy;
    }
  }
  if (out.kind === "shansep") {
    // SHANSEP: a point table that is empty or not a list is not set (the
    // constant parameters apply); a list is kept for validation to report.
    for (const key of ["ocrByElevation", "suByStress"] as const) {
      if (key in out && (!Array.isArray(out[key]) || out[key].length === 0)) {
        out = { ...out };
        delete out[key];
      }
    }
    const suMin = out.suMin;
    if ("suMin" in out && !(typeof suMin === "number" && Number.isFinite(suMin) && suMin >= 0)) {
      out = { ...out };
      delete out.suMin;
    }
  }
  if (out.kind === "s-f-depth" && "depthReference" in out) {
    const r = out.depthReference;
    if (r !== "ground" && r !== "layer-top") {
      out = { ...out };
      delete (out as { depthReference?: unknown }).depthReference;
    }
  }
  return out;
}

/**
 * Excess pore pressure from fills: a B̄ that is not a finite number in
 * [0, 1.5] is dropped (none), and a fill flag that is not `true` too.
 */
function sanitizeBBar(model: MaterialModel): MaterialModel {
  if (!("bBar" in model) && !("bBarLoad" in model) && !("ru" in model)) return model;
  const out = { ...model } as MaterialModel & { bBar?: unknown; bBarLoad?: unknown; ru?: unknown };
  const ru = out.ru;
  if (!(typeof ru === "number" && Number.isFinite(ru) && ru >= 0 && ru < 1)) delete out.ru;
  const b = out.bBar;
  if (!(typeof b === "number" && Number.isFinite(b) && b >= 0 && b <= 1.5)) delete out.bBar;
  if (out.bBarLoad !== true) delete out.bBarLoad;
  return out;
}

/**
 * The drawdown (R) envelope of a soil that does not drain in rapid
 * drawdown: kept on a Mohr-Coulomb material when cR is a finite number
 * ≥ 0 and φR one in [0°, 90°), dropped otherwise (free-draining).
 */
function sanitizeDrawdown(model: MaterialModel): MaterialModel {
  if (!("drawdownStrength" in model)) return model;
  const out = { ...model } as MaterialModel & { drawdownStrength?: unknown };
  const r = out.drawdownStrength as { cohesion?: unknown; frictionAngle?: unknown } | null | undefined;
  const c = r?.cohesion, phi = r?.frictionAngle;
  if (
    out.kind === "mohr-coulomb" &&
    typeof c === "number" && Number.isFinite(c) && c >= 0 &&
    typeof phi === "number" && Number.isFinite(phi) && phi >= 0 && phi < 90
  ) {
    out.drawdownStrength = { cohesion: c, frictionAngle: phi };
  } else {
    delete out.drawdownStrength;
  }
  return out;
}

/**
 * Strength from suction (φb, maximum suction): a φb that is not a number in
 * [0°, 90°), or on a model that does not take it, is dropped (no suction
 * strength), as is a maximum suction that is not a positive number (no
 * limit).
 */
function sanitizeSuction(model: MaterialModel): MaterialModel {
  if (!("phiB" in model) && !("maxSuction" in model)) return model;
  const out = { ...model } as MaterialModel & { phiB?: unknown; maxSuction?: unknown };
  const phiB = out.phiB;
  if (!supportsSuctionStrength(out.kind) || !(typeof phiB === "number" && Number.isFinite(phiB) && phiB >= 0 && phiB < 90)) {
    delete out.phiB;
  }
  const cap = out.maxSuction;
  if (!supportsSuctionStrength(out.kind) || !(typeof cap === "number" && Number.isFinite(cap) && cap > 0)) {
    delete out.maxSuction;
  }
  return out;
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

/** A load's excess pore pressure: entries with a material id and a finite ratio. */
function normalizeExcessPorePressure(raw: unknown): Pick<UdlRow, "excessPorePressure"> {
  if (!Array.isArray(raw)) return {};
  const entries = raw.flatMap((e: unknown) => {
    const r = e as Record<string, unknown> | null;
    return r && typeof r === "object" && typeof r.materialId === "string" &&
      typeof r.ratio === "number" && Number.isFinite(r.ratio) && r.ratio >= 0 && r.ratio <= 1
      ? [{ materialId: r.materialId, ratio: r.ratio }]
      : [];
  });
  return entries.length > 0 ? { excessPorePressure: entries } : {};
}

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
    ...(u.direction === "normal" ? { direction: "normal" as const } : {}),
    ...normalizeExcessPorePressure(u.excessPorePressure),
    expressions: normalizeLoadExpressions(u.expressions, [
      "magnitude",
      "x1",
      "x2",
    ]),
  };
}

function normalizeLineLoad(raw: unknown): LineLoadRow | null {
  if (!raw || typeof raw !== "object") return null;
  const l = raw as Record<string, unknown>;
  const id = typeof l.id === "string" ? l.id : null;
  const magnitude = finiteOr(l.magnitude, 0);
  const x = finiteOr(l.x, 0);
  if (!id) return null;
  // the inclination: finite, within ±180°; 0 (vertical) is not stored
  const angle =
    typeof l.angle === "number" &&
    Number.isFinite(l.angle) &&
    l.angle !== 0 &&
    Math.abs(l.angle) <= 180
      ? l.angle
      : undefined;
  const y = typeof l.y === "number" && Number.isFinite(l.y) ? l.y : undefined;
  return {
    id,
    magnitude,
    x,
    ...(angle !== undefined ? { angle } : {}),
    ...(y !== undefined ? { y } : {}),
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
  // The default numbers are tuned for the starter geometry; a file without
  // limits should search the whole slope, not x 4–15.
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_ANALYSIS_LIMITS, enabled: false };
  }
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

function normalizePartialFactors(raw: unknown): PartialFactors | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const f = raw as Record<string, unknown>;
  const factor = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 1;
  const out: PartialFactors = {
    cu: factor(f.cu),
    cohesion: factor(f.cohesion),
    tanPhi: factor(f.tanPhi),
    variableLoad: factor(f.variableLoad),
  };
  // how the factors were formed (safety class and η): kept when it gives
  // these factors, for display and editing; else dropped (the factors stay)
  if (f.basis && typeof f.basis === "object") {
    try {
      const formed = swedishPartialFactors(f.basis as SwedishFactorBasis);
      const same = (["cu", "cohesion", "tanPhi", "variableLoad"] as const).every((k) => Math.abs(formed[k] - out[k]) < 1e-9);
      if (same) out.basis = formed.basis;
    } catch {
      // an incomplete or invalid basis: the factors without it
    }
  }
  return out;
}

/** An angle range [min, max] with 0° < min ≤ max < 90°, as the engine takes it, or null. */
function angleRangeOrNull(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const [lo, hi] = raw;
  return typeof lo === "number" && typeof hi === "number" && lo > 0 && hi < 90 && lo <= hi ? [lo, hi] : null;
}

function normalizeAnalysisOptions(raw: unknown): AnalysisOptions {
  const base: AnalysisOptions = { ...APP_DEFAULT_ANALYSIS_OPTIONS };
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

  // Numbers or numeric text; Number(null) or Number("") would read a
  // missing value as 0.
  const pointValue = (v: unknown) =>
    typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  const intersliceDataPoints = Array.isArray(o.intersliceDataPoints)
    ? o.intersliceDataPoints
        .map((p) => (Array.isArray(p) ? [pointValue(p[0]), pointValue(p[1])] : null))
        .filter(
          (p): p is [number, number] =>
            !!p && Number.isFinite(p[0]) && Number.isFinite(p[1]),
        )
    : base.intersliceDataPoints;

  return {
    ...base,
    janbuCorrection:
      typeof o.janbuCorrection === "boolean"
        ? o.janbuCorrection
        : base.janbuCorrection,
    method:
      o.method === "Bishop" ||
      o.method === "Janbu" ||
      o.method === "Morgenstern-Price"
        ? o.method
        : base.method,
    // Same ranges as the engine and the options form.
    slices: Math.max(
      SLICES_RANGE.min,
      Math.min(SLICES_RANGE.max, finiteOr(o.slices, base.slices)),
    ),
    iterations: Math.max(
      ITERATIONS_RANGE.min,
      Math.min(ITERATIONS_RANGE.max, finiteOr(o.iterations, base.iterations)),
    ),
    refinedIterations: Math.max(
      REFINED_ITERATIONS_RANGE.min,
      Math.min(
        REFINED_ITERATIONS_RANGE.max,
        finiteOr(o.refinedIterations, base.refinedIterations),
      ),
    ),
    minFailureDist: Math.max(
      0,
      finiteOr(o.minFailureDist, base.minFailureDist),
    ),
    tolerance: Math.max(
      TOLERANCE_RANGE.min,
      Math.min(TOLERANCE_RANGE.max, finiteOr(o.tolerance, base.tolerance)),
    ),
    maxIterations: Math.max(1, finiteOr(o.maxIterations, base.maxIterations)),
    intersliceFunction,
    intersliceDataPoints,
    partialFactors: normalizePartialFactors(o.partialFactors),
    ...(o.bothDirections === true ? { bothDirections: true } : {}),
    // composite surfaces: on for new projects; a project saved before the
    // option existed keeps circles only, so its results do not change
    compositeSurfaces: o.compositeSurfaces === true,
    ...(o.compositeBase === true ? { compositeBase: true } : {}),
    ...(o.nonCircularOptimization === true
      ? { nonCircularOptimization: true }
      : {}),
    ...(typeof o.minSlipDepth === "number" &&
    Number.isFinite(o.minSlipDepth) &&
    o.minSlipDepth > 0
      ? { minSlipDepth: o.minSlipDepth }
      : {}),
    ...(typeof o.minSlipArea === "number" &&
    Number.isFinite(o.minSlipArea) &&
    o.minSlipArea >= 0
      ? { minSlipArea: o.minSlipArea }
      : {}),
    ...(o.tensionCrackAuto === true ? { tensionCrackAuto: true } : {}),
    ...(typeof o.seismicHorizontal === "number" && Number.isFinite(o.seismicHorizontal) && o.seismicHorizontal > 0 && o.seismicHorizontal <= 1
      ? { seismicHorizontal: o.seismicHorizontal }
      : {}),
    ...(typeof o.seismicVertical === "number" && Number.isFinite(o.seismicVertical) && o.seismicVertical !== 0 && Math.abs(o.seismicVertical) <= 1
      ? { seismicVertical: o.seismicVertical }
      : {}),
    ...(typeof o.tensionCrackAngle === "number" && Number.isFinite(o.tensionCrackAngle) && o.tensionCrackAngle > 0 && o.tensionCrackAngle < 90
      ? { tensionCrackAngle: o.tensionCrackAngle }
      : {}),
    ...(o.searchMethod === "block" ? { searchMethod: "block" as const } : {}),
    ...(angleRangeOrNull(o.blockActiveAngle) ? { blockActiveAngle: angleRangeOrNull(o.blockActiveAngle) } : {}),
    ...(angleRangeOrNull(o.blockPassiveAngle) ? { blockPassiveAngle: angleRangeOrNull(o.blockPassiveAngle) } : {}),
    tensionCrackDepth: Math.max(
      0,
      finiteOr(o.tensionCrackDepth, base.tensionCrackDepth ?? 0),
    ),
    tensionCrackWater: Math.max(
      0,
      Math.min(1, finiteOr(o.tensionCrackWater, base.tensionCrackWater ?? 0)),
    ),
    porePressureHead:
      o.porePressureHead === "vertical" ||
      o.porePressureHead === "phreatic-correction"
        ? o.porePressureHead
        : (base.porePressureHead ?? "vertical"),
    ...(o.fem && typeof o.fem === "object" ? { fem: normalizeFemSettings(o.fem as Record<string, unknown>) } : {}),
    ...(o.sgi3d && typeof o.sgi3d === "object" ? { sgi3d: normalizeSgi3dSettings(o.sgi3d as Record<string, unknown>) } : {}),
  };
}

/** Construction stages per material name from a file: integer stages 0–20, or nothing. */
function stagesOf(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 20) out[name] = v;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Flow rule of a file's finite element settings without a valid one: the
 * default of new projects before Davis B (non-associated), so that such a
 * file gives the result it gave before.
 */
export const LEGACY_FEM_FLOW_RULE: FemAnalysisSettings["flowRule"] = "non-associated";

/** Finite element settings from a file: each field checked, the default where it is not valid. */
function normalizeFemSettings(f: Record<string, unknown>): FemAnalysisSettings {
  const d = DEFAULT_FEM_SETTINGS;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : fallback;
  return {
    enabled: f.enabled === true,
    flowRule: f.flowRule === "associated" || f.flowRule === "non-associated" || f.flowRule === "davis-b" ? f.flowRule : LEGACY_FEM_FLOW_RULE,
    youngsModulus: num(f.youngsModulus, 1, 1e9, d.youngsModulus),
    poissonsRatio: num(f.poissonsRatio, 0, 0.49, d.poissonsRatio),
    dilationAngle: num(f.dilationAngle, 0, 60, d.dilationAngle),
    elementSize: typeof f.elementSize === "number" && Number.isFinite(f.elementSize) && f.elementSize > 0 ? f.elementSize : null,
    tensionCutoff: f.tensionCutoff === true,
    refinementLevels: Math.round(num(f.refinementLevels, 0, 3, d.refinementLevels)),
    ...(f.porePressure === "seepage" ? { porePressure: "seepage" as const } : {}),
    ...(f.nonAssociatedSolver === "newton" ? { nonAssociatedSolver: "newton" as const } : {}),
    ...(f.convergence === "equilibrium" ? { convergence: "equilibrium" as const } : {}),
    ...(f.limitAnalysis === true ? { limitAnalysis: true } : {}),
    ...(f.initialStress === "k0" ? { initialStress: "k0" as const } : {}),
    ...(typeof f.k0 === "number" && Number.isFinite(f.k0) && f.k0 > 0 && f.k0 <= 5 ? { k0: f.k0 } : {}),
    ...(typeof f.originalGroundLevel === "number" && Number.isFinite(f.originalGroundLevel) ? { originalGroundLevel: f.originalGroundLevel } : {}),
    ...(stagesOf(f.materialStages) ? { materialStages: stagesOf(f.materialStages)! } : {}),
  };
}
