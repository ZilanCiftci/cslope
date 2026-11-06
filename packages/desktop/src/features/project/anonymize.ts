/**
 * File › Save as anonymized…: a copy of the project for sharing (a
 * project attached to a public issue), without what names the client,
 * the site or the people: the project information, the names of models,
 * materials and other objects, the drawings, free text in annotations,
 * and optionally the results and the real coordinates (moved to a local
 * origin). The open project is not changed: `anonymizeProject` works on a
 * copy of the project file and returns a new one.
 *
 * Moving to a local origin shifts every absolute coordinate of a model by
 * the same (dx, dy): the geometry, water lines, loads, reinforcement,
 * search limits, custom and block surfaces, the imported waternet and
 * earlier stage, the elevations of strength profiles (S = f(datum),
 * Su and c′ reference levels, OCR by elevation, spatial data points),
 * drawings, reference lines and a locked view. An expression of a shifted
 * value gets the shift added, so a parameter keeps its value. The
 * factor of safety of a rigid shift is the same; the results are removed
 * (they are in the old coordinates) and the views fitted again.
 */
import type { MaterialModel, SlopeDefinition } from "@cslope/engine";
import type { ProjectFile } from "../../store/persistence";
import type {
  Annotation,
  BackgroundImage,
  CoordinateExpression,
  MaterialRow,
  ModelEntry,
  ModelWaternet,
  ProjectInfo,
} from "../../store/types";
import type { ProjectAsset } from "../drawings/asset-registry";
import { writeProjectArchive } from "./cslp";

/** What an anonymized copy leaves out or changes. */
export interface AnonymizeOptions {
  /** Clear the project information (title, client, people, dates, description) and the import notes. */
  projectInfo: boolean;
  /** Models named "Model 1", "Model 2", … */
  renameModels: boolean;
  /** Materials named "Material 1", "Material 2", … (their parameters kept). */
  renameMaterials: boolean;
  /** Water lines, reinforcement and pile labels, reference lines, drawings, head lines: generic names. */
  renameObjects: boolean;
  /** Remove the drawings placed under the models, and their files. */
  removeDrawings: boolean;
  /**
   * Text annotations: "replace" keeps them with their variables (#FOS,
   * #Method, {{…}}) and replaces the other text with "Text"; "delete"
   * removes them; "keep" leaves them.
   */
  textAnnotations: "keep" | "replace" | "delete";
  /** Remove the analysis results. */
  removeResults: boolean;
  /** Shift the coordinates: "x" so that the smallest x is 0, "xy" also the lowest y 0. */
  localOrigin: "none" | "x" | "xy";
}

export const DEFAULT_ANONYMIZE_OPTIONS: AnonymizeOptions = {
  projectInfo: true,
  renameModels: true,
  renameMaterials: true,
  renameObjects: true,
  removeDrawings: true,
  textAnnotations: "replace",
  removeResults: false,
  localOrigin: "none",
};

/** What `anonymizeProject` did, for the summary before saving. */
export interface AnonymizeSummary {
  /** Models whose project information was cleared. */
  projectInfoCleared: number;
  importNotesRemoved: number;
  modelsRenamed: number;
  materialsRenamed: number;
  /** Water lines, labels, reference lines, drawings and head lines renamed. */
  objectsRenamed: number;
  drawingsRemoved: number;
  /** Drawing files (assets) not written. */
  filesRemoved: number;
  textAnnotationsReplaced: number;
  textAnnotationsDeleted: number;
  /** Models whose results were removed. */
  resultsRemoved: number;
  /** Models moved to a local origin, and by how much (new name). */
  shifted: { model: string; dx: number; dy: number }[];
  /** Models that could not be moved (new name) and why. */
  shiftBlocked: { model: string; reason: string }[];
  /** Free text that is left as it is (to check by hand), one line each. */
  unchanged: string[];
}

export interface AnonymizedProject {
  file: ProjectFile;
  /** The drawing files to write: without their original file names. */
  assets: ProjectAsset[];
  summary: AnonymizeSummary;
}

export const ANONYMIZED_SUFFIX = "-anonymized";

// ── Text annotations ───────────────────────────────────────────────

/** What a text annotation's variables look like (resolveAnnotationText.ts): {{expr}}, \n, #name. */
const VARIABLE = /\{\{[^{}]+\}\}|\\n|#[a-zA-Z_][a-zA-Z0-9_]*/g;

/**
 * A text annotation's text with its variables kept and every other piece
 * of text that has a letter or digit in it replaced by "Text":
 * "Calculated FOS: #FOS" gives "Text #FOS", "Smith Ltd" gives "Text".
 */
export function replaceFreeText(text: string): string {
  let out = "";
  let last = 0;
  const literal = (s: string) => {
    if (!/[\p{L}\p{N}]/u.test(s)) return s;
    const lead = /^\s*/.exec(s)![0];
    const trail = /\s*$/.exec(s)![0];
    return `${lead}Text${trail}`;
  };
  for (const m of text.matchAll(VARIABLE)) {
    out += literal(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + literal(text.slice(last));
}

// ── Moving to a local origin ───────────────────────────────────────

type Point = [number, number];

/** v + d, with the float noise of the sum rounded away (0.30000000000000004 → 0.3). */
function add(v: number, d: number): number {
  if (d === 0 || !Number.isFinite(v)) return v;
  const r = v + d;
  const rounded = Math.round(r * 1e6) / 1e6;
  return Math.abs(rounded - r) <= 1e-9 * Math.max(1, Math.abs(r)) ? rounded : r;
}

const pt = ([x, y]: Point, dx: number, dy: number): Point => [add(x, dx), add(y, dy)];
const pts = (list: Point[] | undefined, dx: number, dy: number): Point[] | undefined => list?.map((p) => pt(p, dx, dy));

/** A number as an expression literal (no exponent). */
function literal(n: number): string {
  const s = String(n);
  return /e/i.test(s) ? n.toFixed(12).replace(/\.?0+$/, "") : s;
}

/** An expression with `d` added: "(H) + 1234.5"; an empty one stays empty. */
export function shiftExpression(expr: string | undefined, d: number): string | undefined {
  if (expr === undefined || expr.trim() === "" || d === 0) return expr;
  return `(${expr.trim()}) ${d < 0 ? "-" : "+"} ${literal(Math.abs(d))}`;
}

function shiftCoordinateExpressions(list: CoordinateExpression[] | undefined, dx: number, dy: number): CoordinateExpression[] | undefined {
  return list?.map((e) => {
    const out: CoordinateExpression = { ...e };
    if (e.x !== undefined) out.x = shiftExpression(e.x, dx);
    if (e.y !== undefined) out.y = shiftExpression(e.y, dy);
    return out;
  });
}

/** The material model kinds whose absolute coordinates are known here. */
const KNOWN_KINDS = new Set<string>([
  "mohr-coulomb",
  "undrained",
  "high-strength",
  "impenetrable",
  "spatial-mohr-coulomb",
  "anisotropic-function",
  "s-f-depth",
  "s-f-datum",
  "lime-cement-columns",
  "hoek-brown",
  "shansep",
  "shear-normal",
]);

/** Why a material model cannot be shifted exactly, or null. */
function materialShiftBlocker(model: MaterialModel | undefined): string | null {
  if (!model) return null;
  if (!KNOWN_KINDS.has(model.kind)) return `material model "${model.kind}" is not known to this version`;
  return materialShiftBlocker(model.aboveWater);
}

/**
 * A reference elevation shifted: a set one by dy; an unset one (0 in the
 * engine) set to dy when its rate makes it count.
 */
function shiftRef(ref: number | undefined, rate: number | undefined, dy: number): number | undefined {
  if (ref !== undefined) return add(ref, dy);
  return rate ? dy : undefined;
}

/** A material model with its elevations (and data points) shifted. */
export function shiftMaterialModel(model: MaterialModel, dx: number, dy: number): MaterialModel {
  const m = { ...model } as MaterialModel;
  if (m.aboveWater) m.aboveWater = shiftMaterialModel(m.aboveWater, dx, dy);
  switch (m.kind) {
    case "mohr-coulomb": {
      const ref = shiftRef(m.cohesionRefDepth, m.cohesionRateOfChange, dy);
      if (ref !== undefined) m.cohesionRefDepth = ref;
      break;
    }
    case "undrained":
    case "lime-cement-columns": {
      const ref = shiftRef(m.suRefDepth, m.suRateOfChange, dy);
      if (ref !== undefined) m.suRefDepth = ref;
      break;
    }
    case "s-f-datum":
      m.yRef = add(m.yRef, dy);
      break;
    case "spatial-mohr-coulomb":
      m.dataPoints = m.dataPoints.map(([x, y, c, phi, g]) => [add(x, dx), add(y, dy), c, phi, g]);
      break;
    case "shansep":
      if (m.ocrByElevation) m.ocrByElevation = m.ocrByElevation.map(([y, ocr]) => [add(y, dy), ocr]);
      break;
    default:
      break;
  }
  return m;
}

/** The material fields that are elevations (their expressions get dy). */
const ELEVATION_FIELDS = ["cohesionRefDepth", "suRefDepth", "yRef"];

function shiftMaterialRow(row: MaterialRow, dx: number, dy: number): MaterialRow {
  const out: MaterialRow = { ...row, model: shiftMaterialModel(row.model, dx, dy) };
  if (row.depthRange) out.depthRange = [add(row.depthRange[0], dy), add(row.depthRange[1], dy)];
  if (row.modelExpressions) {
    const exprs = { ...row.modelExpressions };
    for (const key of ELEVATION_FIELDS) {
      if (exprs[key] !== undefined) exprs[key] = shiftExpression(exprs[key], dy);
    }
    out.modelExpressions = exprs;
  }
  return out;
}

function shiftWaternet(w: ModelWaternet, dx: number, dy: number): ModelWaternet {
  return {
    ...w,
    headLines: w.headLines.map((h) => ({ ...h, points: pts(h.points, dx, dy)! })),
    referenceLines: w.referenceLines.map((r) => ({ ...r, points: pts(r.points, dx, dy)! })),
  };
}

type EarlierStage = Omit<SlopeDefinition, "earlierStage">;

/** An engine definition (an earlier stage) with every absolute coordinate shifted. */
export function shiftDefinition(def: EarlierStage, dx: number, dy: number): EarlierStage {
  const out: EarlierStage = { ...def, coordinates: pts(def.coordinates, dx, dy)! };
  out.materials = def.materials.map((m) => {
    const mat = { ...m };
    if (m.model) mat.model = shiftMaterialModel(m.model, dx, dy);
    else {
      const ref = shiftRef(m.cohesionRefDepth, m.cohesionRateOfChange, dy);
      if (ref !== undefined) mat.cohesionRefDepth = ref;
    }
    if (m.depthRange) mat.depthRange = [add(m.depthRange[0], dy), add(m.depthRange[1], dy)];
    return mat;
  });
  if (def.waterTable) {
    const w = def.waterTable;
    if (w.mode === "custom" && Array.isArray(w.value)) out.waterTable = { ...w, value: pts(w.value, dx, dy)! };
    else if (w.mode === "height" && typeof w.value === "number") out.waterTable = { ...w, value: add(w.value, dy) };
  }
  if (def.waterTables) out.waterTables = def.waterTables.map((w) => ({ ...w, coordinates: pts(w.coordinates, dx, dy)! }));
  if (def.udls) out.udls = def.udls.map((u) => ({ ...u, x1: add(u.x1, dx), x2: add(u.x2, dx) }));
  if (def.lineLoads) out.lineLoads = def.lineLoads.map((l) => ({ ...l, x: add(l.x, dx), ...(l.y !== undefined ? { y: add(l.y, dy) } : {}) }));
  if (def.rapidDrawdown) out.rapidDrawdown = { waterBefore: pts(def.rapidDrawdown.waterBefore, dx, dy)! };
  if (def.waternet) out.waternet = shiftWaternet(def.waternet, dx, dy);
  if (def.reinforcements) out.reinforcements = def.reinforcements.map((r) => ({ ...r, x1: add(r.x1, dx), y1: add(r.y1, dy), x2: add(r.x2, dx), y2: add(r.y2, dy) }));
  if (def.piles) out.piles = def.piles.map((p) => ({ ...p, x1: add(p.x1, dx), y1: add(p.y1, dy), x2: add(p.x2, dx), y2: add(p.y2, dy) }));
  if (def.materialBoundaries) out.materialBoundaries = def.materialBoundaries.map((b) => ({ ...b, coordinates: pts(b.coordinates, dx, dy)! }));
  if (def.regionAssignments) out.regionAssignments = def.regionAssignments.map((a) => ({ ...a, point: pt(a.point, dx, dy) }));
  if (def.analysisLimits) {
    const l = def.analysisLimits;
    out.analysisLimits = { entryLeftX: add(l.entryLeftX, dx), entryRightX: add(l.entryRightX, dx), exitLeftX: add(l.exitLeftX, dx), exitRightX: add(l.exitRightX, dx) };
  }
  if (def.customSearchPlanes) out.customSearchPlanes = def.customSearchPlanes.map((c) => ({ ...c, cx: add(c.cx, dx), cy: add(c.cy, dy) }));
  if (def.customSurfaces) {
    out.customSurfaces = def.customSurfaces.map((s) => ({ ...s, points: pts(s.points, dx, dy)!, ...(s.axis ? { axis: pt(s.axis, dx, dy) } : {}) }));
  }
  if (def.blockSearchObjects) out.blockSearchObjects = def.blockSearchObjects.map((o) => ({ ...o, points: pts(o.points, dx, dy)! }));
  return out;
}

function shiftBackground(b: BackgroundImage, dx: number, dy: number): BackgroundImage {
  const c = b.calibration;
  return {
    ...b,
    transform: { ...b.transform, e: add(b.transform.e, dx), f: add(b.transform.f, dy) },
    calibration: {
      ...c,
      points: c.points.map((p) => ({ ...p, model: pt(p.model, dx, dy) })),
      ...(c.axes
        ? {
            axes: {
              ...c.axes,
              x: c.axes.x.map((t) => ({ ...t, value: add(t.value, dx) })),
              y: c.axes.y.map((t) => ({ ...t, value: add(t.value, dy) })),
            },
          }
        : {}),
    },
  };
}

function shiftAnnotation(a: Annotation, dx: number, dy: number): Annotation {
  if (a.type !== "reference") return a;
  if (a.shape === "polyline") return { ...a, points: pts(a.points, dx, dy)! };
  return { ...a, cx: add(a.cx, dx), cy: add(a.cy, dy) };
}

/** Why a model cannot be moved to a local origin exactly, or null. */
export function originShiftBlocker(model: ModelEntry): string | null {
  if (model.coordinates.length === 0) return "it has no exterior boundary";
  for (const m of model.materials) {
    const reason = materialShiftBlocker(m.model);
    if (reason) return reason;
  }
  for (const m of model.earlierStage?.materials ?? []) {
    const reason = materialShiftBlocker(m.model);
    if (reason) return `its earlier stage's ${reason}`;
  }
  return null;
}

/**
 * A model with every absolute coordinate shifted by (dx, dy), its results
 * removed (they are in the old coordinates) and its views to be fitted
 * again. Nothing else changes, so its factor of safety is the same.
 */
export function shiftModel(model: ModelEntry, dx: number, dy: number): ModelEntry {
  const out: ModelEntry = {
    ...model,
    coordinates: pts(model.coordinates, dx, dy)!,
    coordinateExpressions: shiftCoordinateExpressions(model.coordinateExpressions, dx, dy),
    materials: model.materials.map((m) => shiftMaterialRow(m, dx, dy)),
    materialBoundaries: model.materialBoundaries.map((b) => ({
      ...b,
      coordinates: pts(b.coordinates, dx, dy)!,
      coordinateExpressions: shiftCoordinateExpressions(b.coordinateExpressions, dx, dy),
    })),
    regionMaterials: model.regionMaterials.map((r) => ({ ...r, point: pt(r.point, dx, dy) })),
    piezometricLine: {
      ...model.piezometricLine,
      lines: model.piezometricLine.lines.map((l) => ({
        ...l,
        coordinates: pts(l.coordinates, dx, dy)!,
        coordinateExpressions: shiftCoordinateExpressions(l.coordinateExpressions, dx, dy),
      })),
      ...(model.piezometricLine.rapidDrawdown
        ? { rapidDrawdown: { waterBefore: pts(model.piezometricLine.rapidDrawdown.waterBefore, dx, dy)! } }
        : {}),
    },
    udls: model.udls.map((u) => ({
      ...u,
      x1: add(u.x1, dx),
      x2: add(u.x2, dx),
      ...(u.expressions ? { expressions: { ...u.expressions, x1: shiftExpression(u.expressions.x1, dx), x2: shiftExpression(u.expressions.x2, dx) } } : {}),
    })),
    lineLoads: model.lineLoads.map((l) => ({
      ...l,
      x: add(l.x, dx),
      ...(l.y !== undefined ? { y: add(l.y, dy) } : {}),
      ...(l.expressions ? { expressions: { ...l.expressions, x: shiftExpression(l.expressions.x, dx) } } : {}),
    })),
    customSearchPlanes: model.customSearchPlanes.map((c) => ({
      ...c,
      cx: add(c.cx, dx),
      cy: add(c.cy, dy),
      ...(c.points ? { points: pts(c.points, dx, dy) } : {}),
    })),
    analysisLimits: {
      ...model.analysisLimits,
      entryLeftX: add(model.analysisLimits.entryLeftX, dx),
      entryRightX: add(model.analysisLimits.entryRightX, dx),
      exitLeftX: add(model.analysisLimits.exitLeftX, dx),
      exitRightX: add(model.analysisLimits.exitRightX, dx),
    },
  };
  // Leave out expression lists the model did not have.
  if (!model.coordinateExpressions) delete out.coordinateExpressions;
  for (const [i, b] of model.materialBoundaries.entries()) if (!b.coordinateExpressions) delete out.materialBoundaries[i].coordinateExpressions;
  for (const [i, l] of model.piezometricLine.lines.entries()) if (!l.coordinateExpressions) delete out.piezometricLine.lines[i].coordinateExpressions;
  if (model.reinforcements) out.reinforcements = model.reinforcements.map((r) => ({ ...r, x1: add(r.x1, dx), y1: add(r.y1, dy), x2: add(r.x2, dx), y2: add(r.y2, dy) }));
  if (model.piles) out.piles = model.piles.map((p) => ({ ...p, x1: add(p.x1, dx), y1: add(p.y1, dy), x2: add(p.x2, dx), y2: add(p.y2, dy) }));
  if (model.blockSearchObjects) out.blockSearchObjects = model.blockSearchObjects.map((o) => ({ ...o, points: pts(o.points, dx, dy)! }));
  if (model.waternet) out.waternet = shiftWaternet(model.waternet, dx, dy);
  if (model.earlierStage) out.earlierStage = shiftDefinition(model.earlierStage, dx, dy);
  if (model.backgrounds) out.backgrounds = model.backgrounds.map((b) => shiftBackground(b, dx, dy));
  if (model.resultViewSettings) {
    const rv = model.resultViewSettings;
    out.resultViewSettings = {
      ...rv,
      annotations: rv.annotations.map((a) => shiftAnnotation(a, dx, dy)),
      ...(rv.viewLock ? { viewLock: { bottomLeft: pt(rv.viewLock.bottomLeft, dx, dy), topRight: pt(rv.viewLock.topRight, dx, dy) } } : {}),
    };
  }
  // The views are offsets on the screen: fitted again (scale 0) on opening.
  for (const key of ["editViewOffset", "editViewScale", "resultViewOffset", "resultViewScale", "viewOffset", "viewScale"] as const) delete out[key];
  return withoutResult(out);
}

// ── Results ────────────────────────────────────────────────────────

const hasResult = (m: ModelEntry) => m.runState === "done" || m.runState === "error";

function withoutResult(model: ModelEntry): ModelEntry {
  const out = { ...model, runState: "idle" as const, progress: 0, result: null, errorMessage: null };
  return out;
}

/** Keys whose string values are enumerations, never a name (left alone when names are replaced). */
const ENUM_KEYS = new Set(["method", "kind", "code", "slidingDirection", "equation", "type", "flowRule", "reason", "mode", "runState", "shape"]);

/**
 * A copy of `value` (a result, notes) with every old name replaced by its
 * new one: a string equal to an old name, and an old name of three or
 * more characters inside a longer string.
 */
function replaceNames<T>(value: T, names: Map<string, string>): T {
  if (names.size === 0) return value;
  const long = [...names.keys()].filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  const re = long.length > 0 ? new RegExp(long.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g") : null;
  const text = (s: string) => names.get(s) ?? (re ? s.replace(re, (m) => names.get(m) ?? m) : s);
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return key !== undefined && ENUM_KEYS.has(key) ? v : text(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) out[k] = walk(x, k);
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

// ── The project ────────────────────────────────────────────────────

function blankProjectInfo(info: ProjectInfo | undefined): ProjectInfo | undefined {
  if (!info) return info;
  return {
    ...info,
    title: "",
    subtitle: "",
    client: "",
    projectNumber: "",
    revision: "",
    author: "",
    checker: "",
    date: "",
    description: "",
  };
}

const PROJECT_INFO_TEXT: (keyof ProjectInfo)[] = ["title", "subtitle", "client", "projectNumber", "revision", "author", "checker", "date", "description"];

/** The engine's names of a model's materials (the display name, suffixed on a repeat), as the analysis names them. */
function engineNames(materials: MaterialRow[]): Map<string, string> {
  const used = new Set<string>();
  const byId = new Map<string, string>();
  for (const m of materials) {
    let name = m.name;
    for (let k = 2; used.has(name); k++) name = `${m.name} (${k})`;
    used.add(name);
    byId.set(m.id, name);
  }
  return byId;
}

/** An earlier stage's materials renamed (by `rename`, a name not in it: the next "Material n"). */
function renameStageMaterials(stage: EarlierStage, rename: Map<string, string>, next: () => string): EarlierStage {
  const map = new Map<string, string>();
  for (const m of stage.materials) if (!map.has(m.name)) map.set(m.name, rename.get(m.name) ?? next());
  const to = (n: string) => map.get(n) ?? n;
  const out: EarlierStage = { ...stage, materials: stage.materials.map((m) => ({ ...m, name: to(m.name) })) };
  if (stage.materialBoundaries) out.materialBoundaries = stage.materialBoundaries.map((b) => ({ ...b, materialName: b.materialName ? to(b.materialName) : b.materialName }));
  if (stage.regionAssignments) out.regionAssignments = stage.regionAssignments.map((a) => ({ ...a, materialName: to(a.materialName) }));
  if (stage.topRegionMaterialName) out.topRegionMaterialName = to(stage.topRegionMaterialName);
  if (stage.udls) {
    out.udls = stage.udls.map((u) => (u.excessPorePressure ? { ...u, excessPorePressure: u.excessPorePressure.map((e) => ({ ...e, material: to(e.material) })) } : u));
  }
  for (const [from, name] of map) rename.set(from, name);
  return out;
}

/** Head lines with generic ids ("Head line 1", …), the references to them following. */
function renameWaternet(w: ModelWaternet): { waternet: ModelWaternet; count: number } {
  const ids = new Map(w.headLines.map((h, i) => [h.id, `Head line ${i + 1}`]));
  const to = (id: string | undefined) => (id === undefined ? undefined : (ids.get(id) ?? id));
  const waternet: ModelWaternet = {
    ...w,
    headLines: w.headLines.map((h) => ({ ...h, id: to(h.id)! })),
    referenceLines: w.referenceLines.map((r) => {
      const out = { ...r };
      if (r.topHeadLineId !== undefined) out.topHeadLineId = to(r.topHeadLineId);
      if (r.bottomHeadLineId !== undefined) out.bottomHeadLineId = to(r.bottomHeadLineId);
      return out;
    }),
  };
  if (w.phreaticLineId !== undefined) waternet.phreaticLineId = to(w.phreaticLineId);
  return { waternet, count: w.headLines.length };
}

const countExpressions = (m: ModelEntry): number => {
  const coord = (list: CoordinateExpression[] | undefined) => (list ?? []).reduce((n, e) => n + (e.x?.trim() ? 1 : 0) + (e.y?.trim() ? 1 : 0), 0);
  let n = coord(m.coordinateExpressions);
  for (const b of m.materialBoundaries) n += coord(b.coordinateExpressions);
  for (const l of m.piezometricLine.lines) n += coord(l.coordinateExpressions);
  for (const mat of m.materials) n += Object.values(mat.modelExpressions ?? {}).filter((e) => e?.trim()).length;
  for (const u of m.udls) n += Object.values(u.expressions ?? {}).filter((e) => e?.trim()).length;
  for (const l of m.lineLoads) n += Object.values(l.expressions ?? {}).filter((e) => e?.trim()).length;
  return n;
};

/**
 * The anonymized copy of a project file (see the module's comment). Pure:
 * `file` and `assets` are not changed. `now` is the time the copy's
 * drawing files are dated (their original dates are not kept).
 */
export function anonymizeProject(
  file: ProjectFile,
  options: AnonymizeOptions,
  assets: ProjectAsset[] = [],
  now: Date = new Date(),
): AnonymizedProject {
  const summary: AnonymizeSummary = {
    projectInfoCleared: 0,
    importNotesRemoved: 0,
    modelsRenamed: 0,
    materialsRenamed: 0,
    objectsRenamed: 0,
    drawingsRemoved: 0,
    filesRemoved: 0,
    textAnnotationsReplaced: 0,
    textAnnotationsDeleted: 0,
    resultsRemoved: 0,
    shifted: [],
    shiftBlocked: [],
    unchanged: [],
  };
  let parameters = 0;
  let expressions = 0;
  let layerNames = 0;
  let keptText = 0;
  let notesKept = 0;

  const modelIds = new Map<string, string>();
  const models = structuredClone(file.models).map((copy, index) => {
    let model: ModelEntry = copy;
    // Old name → new name, for the results and the text left.
    const names = new Map<string, string>();

    if (options.projectInfo) {
      const info = model.projectInfo;
      if (info && PROJECT_INFO_TEXT.some((k) => info[k] !== "")) summary.projectInfoCleared++;
      model.projectInfo = blankProjectInfo(info);
      if (model.importNotes?.length) {
        summary.importNotesRemoved += model.importNotes.length;
        delete model.importNotes;
      }
    }

    if (options.renameModels) {
      const name = `Model ${index + 1}`;
      if (model.name !== name) {
        summary.modelsRenamed++;
        names.set(model.name, name);
      }
      model.name = name;
      modelIds.set(model.id, `model-${index + 1}`);
      model.id = `model-${index + 1}`;
    }

    if (options.renameMaterials) {
      const before = engineNames(model.materials);
      const oldNames = model.materials.map((m) => m.name);
      const rename = new Map<string, string>();
      model.materials = model.materials.map((m, i) => {
        const name = `Material ${i + 1}`;
        if (m.name !== name) summary.materialsRenamed++;
        if (!rename.has(m.name)) rename.set(m.name, name);
        names.set(m.name, rename.get(m.name)!);
        names.set(before.get(m.id)!, name);
        return { ...m, name };
      });
      // Exact names of the old materials (the engine's names too) map to the new.
      const byOld = new Map<string, string>();
      for (const name of oldNames) byOld.set(name, rename.get(name)!);
      const sgi3d = model.options?.sgi3d;
      if (sgi3d?.excludeMaterials?.length) {
        model.options = { ...model.options, sgi3d: { ...sgi3d, excludeMaterials: sgi3d.excludeMaterials.map((n) => names.get(n) ?? byOld.get(n) ?? n) } };
      }
      if (model.earlierStage) {
        let k = model.materials.length;
        const stageRename = new Map(byOld);
        model.earlierStage = renameStageMaterials(model.earlierStage, stageRename, () => `Material ${++k}`);
        for (const [from, to] of stageRename) if (!names.has(from)) names.set(from, to);
      }
    }

    if (options.renameObjects) {
      const lines = model.piezometricLine.lines.map((l, i) => {
        const name = `Water line ${i + 1}`;
        if (l.name !== name) {
          summary.objectsRenamed++;
          names.set(l.name, name);
        }
        return { ...l, name };
      });
      model.piezometricLine = { ...model.piezometricLine, lines };
      const unlabel = <T extends { label?: string }>(r: T): T => {
        if (r.label === undefined) return r;
        summary.objectsRenamed++;
        const copy = { ...r };
        delete copy.label;
        return copy;
      };
      if (model.reinforcements) model.reinforcements = model.reinforcements.map(unlabel);
      if (model.piles) model.piles = model.piles.map(unlabel);
      if (model.resultViewSettings) {
        let k = 0;
        model.resultViewSettings = {
          ...model.resultViewSettings,
          annotations: model.resultViewSettings.annotations.map((a) => {
            if (a.type !== "reference" || !a.label) return a;
            summary.objectsRenamed++;
            return { ...a, label: `Reference line ${++k}` };
          }),
        };
      }
      if (model.backgrounds && !options.removeDrawings) {
        model.backgrounds = model.backgrounds.map((b, i) => {
          summary.objectsRenamed++;
          return { ...b, name: `Drawing ${i + 1}` };
        });
      }
      if (model.waternet) {
        const { waternet, count } = renameWaternet(model.waternet);
        model.waternet = waternet;
        summary.objectsRenamed += count;
      }
      if (model.earlierStage?.waternet) model.earlierStage = { ...model.earlierStage, waternet: renameWaternet(model.earlierStage.waternet).waternet };
    }

    if (options.removeDrawings && model.backgrounds?.length) {
      summary.drawingsRemoved += model.backgrounds.length;
      delete model.backgrounds;
    }
    if (options.removeDrawings && model.locks?.backgrounds) {
      const locks = { ...model.locks };
      delete locks.backgrounds;
      if (Object.keys(locks).length > 0) model.locks = locks;
      else delete model.locks;
    }

    if (options.textAnnotations !== "keep" && model.resultViewSettings) {
      const annotations: Annotation[] = [];
      for (const a of model.resultViewSettings.annotations) {
        if (a.type !== "text") {
          annotations.push(a);
        } else if (options.textAnnotations === "delete") {
          summary.textAnnotationsDeleted++;
        } else {
          const text = replaceFreeText(a.text ?? "");
          if (text !== (a.text ?? "")) summary.textAnnotationsReplaced++;
          annotations.push({ ...a, text });
        }
      }
      model.resultViewSettings = { ...model.resultViewSettings, annotations };
    }

    if (options.localOrigin !== "none") {
      const blocker = originShiftBlocker(model);
      if (blocker) {
        summary.shiftBlocked.push({ model: model.name, reason: blocker });
      } else {
        const dx = -Math.min(...model.coordinates.map((c) => c[0]));
        const dy = options.localOrigin === "xy" ? -Math.min(...model.coordinates.map((c) => c[1])) : 0;
        if (hasResult(model)) summary.resultsRemoved++;
        model = shiftModel(model, dx === 0 ? 0 : dx, dy === 0 ? 0 : dy);
        summary.shifted.push({ model: model.name, dx: dx === 0 ? 0 : dx, dy: dy === 0 ? 0 : dy });
      }
    }

    if (options.removeResults && hasResult(model)) {
      summary.resultsRemoved++;
      model = withoutResult(model);
    }

    // Old names left in the results, the notes and kept text.
    if (model.result) model.result = replaceNames(model.result, names);
    if (model.errorMessage) model.errorMessage = replaceNames(model.errorMessage, names);
    if (model.importNotes) {
      model.importNotes = replaceNames(model.importNotes, names);
      notesKept += model.importNotes.length;
    }
    if (options.textAnnotations === "keep" && model.resultViewSettings) {
      model.resultViewSettings = {
        ...model.resultViewSettings,
        annotations: model.resultViewSettings.annotations.map((a) => {
          if (a.type !== "text" || !a.text) return a;
          keptText++;
          return { ...a, text: replaceNames(a.text, names) };
        }),
      };
    }

    parameters += model.parameters?.length ?? 0;
    expressions += countExpressions(model);
    for (const b of model.backgrounds ?? []) layerNames += b.hiddenLayers?.length ?? 0;
    return model;
  });

  // The drawing files the copy refers to, without their names and dates.
  const referenced = new Set(models.flatMap((m) => (m.backgrounds ?? []).map((b) => b.assetId)));
  const keptAssets = assets
    .filter((a) => referenced.has(a.id))
    .map((a) => ({ ...a, originalName: "", addedAt: now.toISOString() }));
  summary.filesRemoved = new Set(assets.map((a) => a.id)).size - keptAssets.length;

  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (parameters > 0) summary.unchanged.push(`${plural(parameters, "parameter")}: their names and expressions`);
  if (expressions > 0) summary.unchanged.push(`${plural(expressions, "expression")} of coordinates, loads or materials`);
  if (keptText > 0) summary.unchanged.push(`${plural(keptText, "text annotation")} (kept as they are)`);
  if (notesKept > 0) summary.unchanged.push(`${plural(notesKept, "import note")}`);
  if (keptAssets.length > 0) summary.unchanged.push(`${plural(keptAssets.length, "drawing file")}: their content (text, title blocks, metadata)`);
  if (layerNames > 0) summary.unchanged.push(`${plural(layerNames, "hidden layer name")} of drawings`);

  const activeModelId = modelIds.get(file.activeModelId) ?? file.activeModelId;
  const out: ProjectFile = { version: file.version, activeModelId, models, units: file.units };
  return { file: out, assets: keptAssets, summary };
}

/** The file name offered for the copy: "<name>-anonymized.cslp" ("cslope-project" without a name). */
export function anonymizedFileName(name: string): string {
  const base = name.trim().replace(/(\.(cslp|cslope|json))+$/i, "").trim() || "cslope-project";
  return `${base}${ANONYMIZED_SUFFIX}.cslp`;
}

/** The summary as lines of text, for the dialog. */
export function summaryLines(summary: AnonymizeSummary, options: AnonymizeOptions): string[] {
  const lines: string[] = [];
  const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
  // Only what is done: an option that changes nothing in this project has no line.
  if (options.projectInfo && (summary.projectInfoCleared > 0 || summary.importNotesRemoved > 0)) {
    const notes = summary.importNotesRemoved ? `${n(summary.importNotesRemoved, "import note")} removed` : "";
    lines.push(summary.projectInfoCleared > 0
      ? `Project information cleared in ${n(summary.projectInfoCleared, "model")}${notes ? `, ${notes}` : ""}.`
      : `${notes[0].toUpperCase()}${notes.slice(1)}.`);
  }
  if (options.renameModels && summary.modelsRenamed > 0) lines.push(`${n(summary.modelsRenamed, "model")} renamed.`);
  if (options.renameMaterials && summary.materialsRenamed > 0) lines.push(`${n(summary.materialsRenamed, "material")} renamed.`);
  if (options.renameObjects && summary.objectsRenamed > 0) lines.push(`${n(summary.objectsRenamed, "other name")} made generic (water lines, labels, reference lines, drawings, head lines).`);
  if (options.removeDrawings && (summary.drawingsRemoved > 0 || summary.filesRemoved > 0)) lines.push(`${n(summary.drawingsRemoved, "drawing")} and ${n(summary.filesRemoved, "file")} removed.`);
  if (options.textAnnotations === "replace" && summary.textAnnotationsReplaced > 0) lines.push(`Free text replaced in ${n(summary.textAnnotationsReplaced, "text annotation")}.`);
  if (options.textAnnotations === "delete" && summary.textAnnotationsDeleted > 0) lines.push(`${n(summary.textAnnotationsDeleted, "text annotation")} removed.`);
  if (summary.resultsRemoved > 0) lines.push(`Results removed from ${n(summary.resultsRemoved, "model")}.`);
  for (const s of summary.shifted) {
    const fmt = (v: number) => (v >= 0 ? `+${Number(v.toFixed(6))}` : `${Number(v.toFixed(6))}`);
    lines.push(`${s.model} moved by ${fmt(s.dx)} m in x${options.localOrigin === "xy" ? ` and ${fmt(s.dy)} m in y` : ""}.`);
  }
  for (const s of summary.shiftBlocked) lines.push(`${s.model} not moved: ${s.reason}.`);
  lines.push("The thumbnail, the original file names of drawings and the dates of the file are removed.");
  return lines;
}

/**
 * The anonymized copy as a .cslp archive: dated now (created and modified),
 * without a thumbnail, with only the drawing files it refers to.
 */
export async function writeAnonymizedArchive(
  file: ProjectFile,
  options: AnonymizeOptions,
  assets: ProjectAsset[] = [],
  now: Date = new Date(),
): Promise<{ bytes: Uint8Array; summary: AnonymizeSummary }> {
  const anonymized = anonymizeProject(file, options, assets, now);
  const bytes = await writeProjectArchive(anonymized.file, {
    results: !options.removeResults,
    created: now,
    modified: now,
    thumbnail: null,
    assets: anonymized.assets,
  });
  return { bytes, summary: anonymized.summary };
}
