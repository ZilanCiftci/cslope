/**
 * The Place drawing window's calibration inputs (what was clicked in the
 * drawing and typed for it) and what they give: a transform, or why not.
 * Pure, so the window's logic is tested without the window.
 */
import type { BackgroundImage, DrawingCalibration } from "../../store/types";
import { fitAxes, fitPoints, fitScale, verticalExaggeration, type Affine, type FitResult, type Pt } from "./transform";
import { drawingCoordinatesTransform, INSUNITS } from "./vectors";

/** "drawing": a DWG or DXF drawing's own coordinates, scaled to metres by its units. */
export type CalibrationMode = "points" | "axes" | "scale" | "drawing";
/** Pixel, PDF point, millimetre on a PDF sheet, or a DWG or DXF drawing's unit. */
export type ScaleUnit = "px" | "pt" | "mm" | "du";

/** A point of the drawing and the model coordinates typed for it (as typed). */
export interface PointRow {
  source: Pt | null;
  x: string;
  y: string;
}

/** A tick clicked on an axis and its value (as typed). */
export interface TickRow {
  source: Pt | null;
  value: string;
}

export interface CalibrationForm {
  mode: CalibrationMode;
  points: PointRow[];
  axes: { x: TickRow[]; y: TickRow[] };
  /** Axes mode: the placement whose x and y scales are reused (one tick per axis then). */
  reuseFrom: string | null;
  scale: { origin: PointRow; metersPerUnit: string; unit: ScaleUnit };
  /** Drawing mode: the drawing's unit ($INSUNITS code: 4 mm, 6 m, …). */
  drawingUnit: number;
}

/** Where the next click in the drawing goes. */
export type PickTarget = { kind: "point"; index: number } | { kind: "x" | "y"; index: number } | { kind: "origin" };

const emptyPoint = (): PointRow => ({ source: null, x: "", y: "" });
const emptyTick = (): TickRow => ({ source: null, value: "" });

export function emptyForm(unit: ScaleUnit = "px"): CalibrationForm {
  return {
    mode: "axes",
    points: [emptyPoint(), emptyPoint()],
    axes: { x: [emptyTick(), emptyTick()], y: [emptyTick(), emptyTick()] },
    reuseFrom: null,
    scale: { origin: emptyPoint(), metersPerUnit: "", unit },
    drawingUnit: 0,
  };
}

/**
 * The form a drawing starts with: a DWG or DXF drawing (unit "du") at its
 * own coordinates; another file in the mode of the one shown before
 * (`previous`), else axes. `unit` is the file's source unit.
 */
export function initialForm(unit: ScaleUnit, previous?: CalibrationForm): CalibrationForm {
  if (unit === "du") return { ...emptyForm("du"), mode: "drawing" };
  return { ...emptyForm(unit), mode: !previous || previous.mode === "drawing" ? "axes" : previous.mode };
}

/** A number typed in a field ("," as the decimal mark too), or null. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Metres per source unit for a scale typed in `unit` (a PDF's source unit is the point; 1 mm = 72 / 25.4 pt; a drawing unit is the source unit). */
export function metersPerSourceUnit(metersPerUnit: number, unit: ScaleUnit): number {
  return unit === "mm" ? (metersPerUnit * 25.4) / 72 : metersPerUnit;
}

/** The x and y scales (m per source unit) of an axis-aligned placement, or null. */
export function axisScalesOf(t: Affine): { x: number; y: number } | null {
  const tol = 1e-9 * Math.max(Math.abs(t.a), Math.abs(t.d));
  if (Math.abs(t.b) > tol || Math.abs(t.c) > tol || t.a === 0 || t.d === 0) return null;
  return { x: t.a, y: t.d };
}

/** The pick targets of a mode, in order. */
export function pickTargets(form: CalibrationForm): PickTarget[] {
  switch (form.mode) {
    case "points":
      return form.points.map((_, index) => ({ kind: "point", index }));
    case "axes": {
      const n = form.reuseFrom ? 1 : 2;
      return [
        ...Array.from({ length: n }, (_, index): PickTarget => ({ kind: "x", index })),
        ...Array.from({ length: n }, (_, index): PickTarget => ({ kind: "y", index })),
      ];
    }
    case "scale":
      return [{ kind: "origin" }];
    case "drawing":
      return [];
  }
}

export function sameTarget(a: PickTarget | null, b: PickTarget | null): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && (a.kind === "origin" || a.index === (b as { index: number }).index);
}

/** The source point a target holds. */
export function targetSource(form: CalibrationForm, t: PickTarget): Pt | null {
  switch (t.kind) {
    case "point":
      return form.points[t.index]?.source ?? null;
    case "x":
    case "y":
      return form.axes[t.kind][t.index]?.source ?? null;
    case "origin":
      return form.scale.origin.source;
  }
}

/** The form with a clicked point stored at `t`. */
export function withSource(form: CalibrationForm, t: PickTarget, source: Pt): CalibrationForm {
  switch (t.kind) {
    case "point":
      return { ...form, points: form.points.map((p, i) => (i === t.index ? { ...p, source } : p)) };
    case "x":
    case "y":
      return { ...form, axes: { ...form.axes, [t.kind]: form.axes[t.kind].map((p, i) => (i === t.index ? { ...p, source } : p)) } };
    case "origin":
      return { ...form, scale: { ...form.scale, origin: { ...form.scale.origin, source } } };
  }
}

/** The target after `t` that has no point yet (else the next one), for the next click. */
export function nextTarget(form: CalibrationForm, t: PickTarget | null): PickTarget | null {
  const targets = pickTargets(form);
  const at = t ? targets.findIndex((x) => sameTarget(x, t)) : -1;
  for (let k = 1; k <= targets.length; k++) {
    const c = targets[(at + k) % targets.length];
    if (!targetSource(form, c)) return c;
  }
  return null;
}

/** The label of a target on the drawing and its pick button ("1", "x1", "y2", "Origin"). */
export function targetLabel(t: PickTarget): string {
  switch (t.kind) {
    case "point":
      return String(t.index + 1);
    case "x":
    case "y":
      return `${t.kind}${t.index + 1}`;
    case "origin":
      return "Origin";
  }
}

export interface FormResult {
  fit: FitResult;
  /** The calibration as it is saved. */
  calibration: DrawingCalibration;
  /** What the fit says, for the window (scales, exaggeration). */
  summary: string[];
  /** The inputs are not complete yet: the error says what to do next (a prompt, not a failure). */
  prompt?: boolean;
}

const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(3));

/**
 * The transform the inputs give. `reuseScale` is the x and y scale of the
 * placement named by `reuseFrom` (axes mode).
 */
export function evaluateForm(form: CalibrationForm, reuseScale: { x: number; y: number } | null, unitName: string): FormResult {
  switch (form.mode) {
    case "points": {
      const rows = form.points.filter((p) => p.source || p.x.trim() || p.y.trim());
      const pairs: DrawingCalibration["points"] = [];
      for (const [i, p] of form.points.entries()) {
        if (!rows.includes(p)) continue;
        const x = parseNumber(p.x);
        const y = parseNumber(p.y);
        if (!p.source) return fail(`Click point ${i + 1} in the drawing.`, form);
        if (x === null || y === null) return fail(`Type the model x and y of point ${i + 1}.`, form);
        pairs.push({ source: p.source, model: [x, y] });
      }
      if (pairs.length < 2) return fail("Click two points in the drawing and type their model coordinates.", form);
      const fit = fitPoints(pairs);
      const summary: string[] = [];
      if (fit.ok) {
        const { a, b, c, d } = fit.transform;
        const ve = verticalExaggeration(fit.transform);
        if (pairs.length >= 3 && Math.abs(ve - 1) > 0.005) {
          summary.push(`x: ${fmt(Math.hypot(a, b))} m per ${unitName}`, `y: ${fmt(Math.hypot(c, d))} m per ${unitName}`, `vertical exaggeration ${ve.toFixed(2)}`);
        } else {
          summary.push(`Scale ${fmt(Math.hypot(a, b))} m per ${unitName}`);
        }
        const rot = (Math.atan2(b, a) * 180) / Math.PI;
        if (Math.abs(rot) > 0.005) summary.push(`rotated ${rot.toFixed(2)}°`);
        if (pairs.length >= 3 && Math.abs(a * c + b * d) > 1e-6 * Math.hypot(a, b) * Math.hypot(c, d)) summary.push("with shear");
        if (pairs.length >= 3) summary.push(`largest misfit ${Math.max(...fit.residuals).toFixed(3)} m`);
      }
      return { fit, calibration: { mode: "points", points: pairs }, summary };
    }
    case "axes": {
      const ticks = (rows: TickRow[], name: string, n: number) => {
        const out: { source: Pt; value: number }[] = [];
        for (const [i, r] of rows.slice(0, n).entries()) {
          const v = parseNumber(r.value);
          if (!r.source) return `Click point ${name}${i + 1} on the ${name} axis.`;
          if (v === null) return `Type the ${name} value at ${name}${i + 1}.`;
          out.push({ source: r.source, value: v });
        }
        return out;
      };
      const n = form.reuseFrom && reuseScale ? 1 : 2;
      const x = ticks(form.axes.x, "x", n);
      if (typeof x === "string") return fail(x, form);
      const y = ticks(form.axes.y, "y", n);
      if (typeof y === "string") return fail(y, form);
      const fit = fitAxes(x, y, n === 1 && reuseScale ? reuseScale : undefined);
      const calibration: DrawingCalibration = { mode: "axes", points: [], axes: { x, y, ...(form.reuseFrom && n === 1 ? { reuseFrom: form.reuseFrom } : {}) } };
      const summary: string[] = [];
      if (fit.ok) {
        const { a, d } = fit.transform;
        summary.push(`x: ${fmt(Math.abs(a))} m per ${unitName}`, `y: ${fmt(Math.abs(d))} m per ${unitName}`);
        const ve = verticalExaggeration(fit.transform);
        summary.push(Math.abs(ve - 1) > 0.005 ? `vertical exaggeration ${ve.toFixed(2)}` : "no vertical exaggeration");
        if (a < 0) summary.push("x runs right to left");
        if (d > 0) summary.push("y runs downwards");
      }
      return { fit, calibration, summary };
    }
    case "scale": {
      const o = form.scale.origin;
      const x = parseNumber(o.x);
      const y = parseNumber(o.y);
      const k = parseNumber(form.scale.metersPerUnit);
      if (!o.source) return fail("Click the origin point in the drawing.", form);
      if (x === null || y === null) return fail("Type the model x and y of the origin point.", form);
      if (k === null || k <= 0) return fail("Type the scale: how many meters one drawing unit is.", form);
      const fit = fitScale({ source: o.source, model: [x, y] }, metersPerSourceUnit(k, form.scale.unit));
      return {
        fit,
        calibration: { mode: "scale", points: [{ source: o.source, model: [x, y] }], scale: { metersPerUnit: k, unit: form.scale.unit } },
        summary: fit.ok ? [`1 ${form.scale.unit === "du" ? unitName : form.scale.unit} = ${fmt(k)} m`] : [],
      };
    }
    case "drawing": {
      const unit = INSUNITS[form.drawingUnit];
      if (!unit) return fail("Choose the drawing's unit.", form);
      const transform = drawingCoordinatesTransform(unit.meters);
      return {
        fit: { ok: true, transform, residuals: [] },
        calibration: { mode: "drawing", points: [] },
        summary: [`The drawing's own coordinates, 1 ${unit.name} = ${fmt(unit.meters)} m`],
      };
    }
  }
}

/** The $INSUNITS code of a "drawing's coordinates" transform (k, 0, 0, −k, 0, 0), or null for any other. */
export function drawingUnitOf(t: Affine): number | null {
  if (t.b !== 0 || t.c !== 0 || t.e !== 0 || t.f !== 0 || t.a <= 0 || Math.abs(t.d + t.a) > 1e-12 * t.a) return null;
  for (const [code, u] of Object.entries(INSUNITS)) if (Math.abs(u.meters - t.a) <= 1e-12 * t.a) return Number(code);
  return null;
}

function fail(error: string, form: CalibrationForm): FormResult {
  return { fit: { ok: false, error }, calibration: { mode: form.mode, points: [] }, summary: [], prompt: true };
}

/** The form a stored calibration fills (recalibrating). `fallback` gives two points for a "drawing" placement. */
export function formFromCalibration(c: DrawingCalibration, unit: ScaleUnit, fallback: () => DrawingCalibration["points"]): CalibrationForm {
  const form = emptyForm(unit);
  const str = (v: number) => String(Math.round(v * 1e6) / 1e6);
  const row = (p: { source: Pt; model: Pt }): PointRow => ({ source: p.source, x: str(p.model[0]), y: str(p.model[1]) });
  switch (c.mode) {
    case "axes":
      return {
        ...form,
        mode: "axes",
        reuseFrom: c.axes?.reuseFrom ?? null,
        axes: {
          x: padTicks((c.axes?.x ?? []).map((t) => ({ source: t.source, value: str(t.value) }))),
          y: padTicks((c.axes?.y ?? []).map((t) => ({ source: t.source, value: str(t.value) }))),
        },
      };
    case "scale":
      return {
        ...form,
        mode: "scale",
        scale: {
          origin: c.points[0] ? row(c.points[0]) : emptyPoint(),
          metersPerUnit: c.scale ? str(c.scale.metersPerUnit) : "",
          unit: c.scale?.unit ?? unit,
        },
      };
    case "points":
      return { ...form, mode: "points", points: padPoints(c.points.map(row)) };
    case "drawing":
      return { ...form, mode: "points", points: padPoints(fallback().map(row)) };
  }
}

/** The form of a DWG or DXF placement: its drawing mode when its transform is the drawing's coordinates, else as formFromCalibration. */
export function formForVector(c: DrawingCalibration, t: Affine, fileUnit: number, fallback: () => DrawingCalibration["points"]): CalibrationForm {
  const code = c.mode === "drawing" ? drawingUnitOf(t) : null;
  if (code !== null) return { ...emptyForm("du"), mode: "drawing", drawingUnit: code };
  return { ...formFromCalibration(c, "du", fallback), drawingUnit: fileUnit };
}

const padTicks = (t: TickRow[]) => [...t, ...Array.from({ length: Math.max(0, 2 - t.length) }, emptyTick)];
const padPoints = (p: PointRow[]) => [...p, ...Array.from({ length: Math.max(0, 2 - p.length) }, emptyPoint)];

/** The placement the window places: a new one, or `existing` recalibrated. */
export function buildPlacement(args: {
  id: string;
  assetId: string;
  name: string;
  page: number | undefined;
  crop: BackgroundImage["crop"];
  calibration: DrawingCalibration;
  transform: Affine;
  existing?: BackgroundImage;
  /** A new placement's opacity (default 0.5). */
  opacity?: number;
  /** A new placement's hidden layers. */
  hiddenLayers?: string[];
}): BackgroundImage {
  const { existing } = args;
  const placement: BackgroundImage = {
    id: args.id,
    assetId: args.assetId,
    name: args.name,
    calibration: args.calibration,
    transform: args.transform,
    opacity: existing?.opacity ?? args.opacity ?? 0.5,
    visible: existing?.visible ?? true,
    order: existing?.order ?? 0,
  };
  if (args.page !== undefined) placement.page = args.page;
  if (args.crop) placement.crop = args.crop;
  if (existing?.showInResults) placement.showInResults = true;
  if (existing?.invertInDark === false) placement.invertInDark = false;
  const hidden = existing ? existing.hiddenLayers : args.hiddenLayers;
  if (hidden && hidden.length > 0) placement.hiddenLayers = [...hidden];
  return placement;
}
