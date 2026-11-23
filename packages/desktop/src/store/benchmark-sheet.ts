/**
 * The sheet of a benchmark opened from Help › Benchmarks: where its
 * material table and its model go, measured against the title block and
 * against what the model draws.
 *
 * The title block (title, source, calculated F and the reference values)
 * hangs from the top left of the paper. The model is drawn at true scale
 * across the width of the drawing area, but low: its lowest point
 * MODEL_BOTTOM_MM above the bottom of the drawing area, its top under the
 * title block. The material table goes, in this order of preference, at
 * the top right; moved down beside the title block; or over empty sky
 * above the lower part of the ground (further left): wherever it is clear
 * of the title block and, by TABLE_GAP_MM, of everything the model draws
 * (the ground and its outline, the water and its symbols, loads and their
 * labels, reinforcement, the search limit markers, the F label and the
 * centre with its radius lines when shown). Only when it fits nowhere is
 * the model drawn at a smaller scale.
 *
 * After a run the sheet is laid out again with the result's F label (at
 * the critical circle's centre): the table moves, not the label.
 *
 * Only the benchmarks use this layout; a user's own model (and "Use model
 * bounds") keeps the frame of modelViewLock.
 */

import type { AnalysisResult } from "@cslope/engine";
import { PLOT_MARGINS } from "./defaults";
import type {
  AnalysisLimitsState,
  Annotation,
  MaterialRow,
  PaperAnnotation,
  PaperFrameSettings,
  PiezometricLineState,
  ProjectInfo,
  ViewLock,
} from "./types";
import { materialTableBox, type TextMeasure } from "../features/annotations/colorBarPlacement";
import { resolveAnnotationText } from "../features/annotations/resolveAnnotationText";
import {
  ANNOTATION_DEFAULT_FONT_SIZE,
  ANNOTATION_LINE_HEIGHT,
  ANNOTATION_SCALE_DIVISOR,
  CENTER_DOT_RADIUS_PX,
  MARKER_BAR_H_PX,
  MARKER_SZ_PX,
  styleMm,
} from "../features/rendering/style-spec";
import { boundsOf, paperContentBounds, paperContentShapes, type Bounds, type PaperContent } from "../features/view/extents";
import { getPaperDimensions, sheetMmPerPx, virtualPaperFrame } from "../features/view/paper";
import { surfaceYAtX } from "../features/view/surface";
import { PAPER_MARGIN_FRACTION } from "../features/view/viewLock";

type Pt = [number, number];

/** A box on the paper, as fractions of its width (x, w) and height (y down, h). */
export interface SheetBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Paper = Pick<PaperFrameSettings, "paperSize" | "landscape">;

/** What the layout reads of a model: its title block's text, its table's rows, and what it draws besides its content. */
export interface BenchmarkSheetModel {
  projectInfo: Pick<ProjectInfo, "title" | "subtitle"> & Partial<ProjectInfo>;
  materials: MaterialRow[];
  piezometricLine?: PiezometricLineState;
  coordinates?: Pt[];
  /** The search limits, drawn as markers on the ground when enabled. */
  analysisLimits?: AnalysisLimitsState;
  /** A result: its critical surface's centre and radius lines when shown. */
  result?: Pick<AnalysisResult, "criticalSurface"> | null;
  resultViewSettings?: { showCentreMarker?: boolean };
}

/** Space from the model's lowest point to the bottom of the drawing area (mm on the paper). */
export const MODEL_BOTTOM_MM = 10;
/** Space between the table and anything the model draws (mm on the paper). */
export const TABLE_GAP_MM = 3;
/** Space under the title block (fraction of the paper height) and beside its text (of the width). */
const GAP = 0.015;
const SIDE_GAP = 0.015;
/** Widest F the block shows ("Calculated F: #FOS"): its value has three decimals. */
const FOS_TEXT = "0.000";
/** The table's place at the top right (its top-right corner), as the examples have it. */
const TABLE_RIGHT = 0.94;
const TABLE_TOP = 0.065;
/** Steps of the search for the table's place (fraction of the paper) and the grid it is tested on. */
const STEP = 0.005;
const CELL = 0.0025;
/** The search for a scale: this many halvings between the true scale and one that surely fits. */
const SCALE_ROUNDS = 14;

/** Average glyph width of the sheet's sans-serif as a share of its size, a little wide (as colorBarPlacement estimates). */
const estimate: TextMeasure = (text, fontPx, bold) => text.length * fontPx * (bold ? 0.6 : 0.55);

/** The box of a text annotation hanging from its point (top left), its tags filled in. */
function textBox(a: Annotation, projectInfo: BenchmarkSheetModel["projectInfo"], paper: Paper): SheetBox {
  const { width, height } = getPaperDimensions(paper.paperSize, paper.landscape);
  const unit = Math.min(width, height) / ANNOTATION_SCALE_DIVISOR;
  const size = a.fontSize ?? ANNOTATION_DEFAULT_FONT_SIZE;
  const text = resolveAnnotationText({ text: (a.text ?? "").replace(/#FOS\b/gi, FOS_TEXT), projectInfo });
  const lines = text.split("\n");
  const w = Math.max(...lines.map((l) => estimate(l, size, a.type === "text" && !!a.bold)));
  return { x: a.x ?? 0, y: a.y ?? 0, w: (w * unit) / width, h: (lines.length * size * ANNOTATION_LINE_HEIGHT * unit) / height };
}

/** The boxes of the title block's lines and of the material tables, as the sheet (and the PDF) draws them. */
export function annotationBoxes(model: BenchmarkSheetModel, annotations: Annotation[], paper: Paper) {
  const texts = annotations.filter((a) => a.type === "text").map((a) => textBox(a, model.projectInfo, paper));
  const tables = annotations
    .filter((a) => a.type === "material-table")
    .map((a) => materialTableBox(a, model.materials, model.piezometricLine, paper, estimate));
  return { texts, tables };
}

/** Whether two boxes overlap. */
export function boxesOverlap(a: SheetBox, b: SheetBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const bottomOf = (boxes: SheetBox[]) => Math.max(...boxes.map((b) => b.y + b.h));

/** The box on the paper of world bounds in a locked view. */
export function worldBox(b: Bounds, lock: ViewLock): SheetBox {
  const plotW = 1 - PLOT_MARGINS.L - PLOT_MARGINS.R;
  const plotH = 1 - PLOT_MARGINS.T - PLOT_MARGINS.B;
  const [l, bt] = lock.bottomLeft;
  const [r, tp] = lock.topRight;
  const x = PLOT_MARGINS.L + ((b.xMin - l) / (r - l)) * plotW;
  const y = PLOT_MARGINS.T + ((tp - b.yMax) / (tp - bt)) * plotH;
  return { x, y, w: ((b.xMax - b.xMin) / (r - l)) * plotW, h: ((b.yMax - b.yMin) / (tp - bt)) * plotH };
}

// ── What the model draws ────────────────────────────────────────

/** What the model draws in a locked view, in world units: lines, the ground (a polygon) and boxes. */
export interface SheetShapes {
  lines: Pt[][];
  ground: Pt[];
  boxes: Bounds[];
}

/** World units per logical px of the sheet (style-spec _PX) in a locked view: the symbols' sizes. */
function worldPerPx(lock: ViewLock, paper: Paper): number {
  const plotPx = virtualPaperFrame(paper.paperSize, paper.landscape).w * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
  return (lock.topRight[0] - lock.bottomLeft[0]) / plotPx;
}

/**
 * Everything the model draws on the sheet in a locked view: its content's
 * shapes (paperContentShapes), the water lines in full, the search limit
 * markers and, with a result, the centre and its radius lines when shown.
 */
export function sheetShapes(model: BenchmarkSheetModel, content: PaperContent, lock: ViewLock, paper: Paper): SheetShapes {
  const px = worldPerPx(lock, paper);
  const shapes = paperContentShapes(content, px) ?? { lines: [], boxes: [] };
  const coordinates = model.coordinates ?? content.coordinates;
  const lines = [...shapes.lines, ...(content.waterLines ?? [])];
  const boxes = [...shapes.boxes];
  const limits = model.analysisLimits;
  if (limits?.enabled) {
    for (const x of [limits.entryLeftX, limits.entryRightX, limits.exitLeftX, limits.exitRightX]) {
      const y = surfaceYAtX(coordinates, x);
      if (y === null) continue;
      // An arrow (2 × MARKER_SZ_PX long) pointing along the ground and a bar across it.
      const half = (2 * MARKER_SZ_PX + 2) * px;
      boxes.push({ xMin: x - half, xMax: x + half, yMin: y - MARKER_BAR_H_PX * px, yMax: y + MARKER_BAR_H_PX * px });
    }
  }
  const cs = model.result?.criticalSurface;
  if (cs && model.resultViewSettings?.showCentreMarker && !cs.points) {
    // The dot's radius in style px (0.1 mm), in logical px of this sheet.
    const r = (styleMm(CENTER_DOT_RADIUS_PX) / sheetMmPerPx(paper.paperSize, paper.landscape)) * px;
    boxes.push({ xMin: cs.cx - r, xMax: cs.cx + r, yMin: cs.cy - r, yMax: cs.cy + r });
    lines.push([[cs.cx, cs.cy], cs.entryPoint], [[cs.cx, cs.cy], cs.exitPoint]);
  }
  return { lines, ground: coordinates, boxes };
}

/** Whether a point lies inside a polygon (even-odd). */
function insidePolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Whether a segment meets a box (Liang–Barsky). */
function segmentMeetsBox([x0, y0]: Pt, [x1, y1]: Pt, b: Bounds): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  for (const [p, q] of [
    [-dx, x0 - b.xMin],
    [dx, b.xMax - x0],
    [-dy, y0 - b.yMin],
    [dy, b.yMax - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * Whether a box on the paper, widened by `gapMm` on every side, is clear
 * of everything the model draws (exactly: lines, the ground, boxes).
 */
export function boxClearOfShapes(box: SheetBox, shapes: SheetShapes, lock: ViewLock, paper: Paper, gapMm: number): boolean {
  const { width, height } = getPaperDimensions(paper.paperSize, paper.landscape);
  const plotW = 1 - PLOT_MARGINS.L - PLOT_MARGINS.R;
  const plotH = 1 - PLOT_MARGINS.T - PLOT_MARGINS.B;
  const [l, bt] = lock.bottomLeft;
  const [r, tp] = lock.topRight;
  const gx = gapMm / width;
  const gy = gapMm / height;
  const wx = (fx: number) => l + ((fx - PLOT_MARGINS.L) / plotW) * (r - l);
  const wy = (fy: number) => tp - ((fy - PLOT_MARGINS.T) / plotH) * (tp - bt);
  const b: Bounds = { xMin: wx(box.x - gx), xMax: wx(box.x + box.w + gx), yMin: wy(box.y + box.h + gy), yMax: wy(box.y - gy) };
  for (const line of shapes.lines) {
    for (let i = 0; i + 1 < line.length; i++) if (segmentMeetsBox(line[i], line[i + 1], b)) return false;
    if (line.length === 1 && segmentMeetsBox(line[0], line[0], b)) return false;
  }
  for (const s of shapes.boxes) if (s.xMin < b.xMax && b.xMin < s.xMax && s.yMin < b.yMax && b.yMin < s.yMax) return false;
  // Wholly inside the ground (no line meets it): a corner tells.
  if (shapes.ground.length >= 3 && insidePolygon([b.xMin, b.yMin], shapes.ground)) return false;
  return true;
}

// ── The occupancy grid: where the table may go, tested fast ─────

/** Cells of the paper (CELL wide) that the model's drawing, widened by the gap, touches; with prefix sums. */
class Occupancy {
  readonly cols = Math.ceil(1 / CELL);
  readonly rows = Math.ceil(1 / CELL);
  private readonly sum: Int32Array;

  constructor(shapes: SheetShapes, lock: ViewLock, paper: Paper, gapMm: number) {
    const { cols, rows } = this;
    const grid = new Uint8Array(cols * rows);
    const plotW = 1 - PLOT_MARGINS.L - PLOT_MARGINS.R;
    const plotH = 1 - PLOT_MARGINS.T - PLOT_MARGINS.B;
    const [l, bt] = lock.bottomLeft;
    const [r, tp] = lock.topRight;
    const fx = (x: number) => PLOT_MARGINS.L + ((x - l) / (r - l)) * plotW;
    const fy = (y: number) => PLOT_MARGINS.T + ((tp - y) / (tp - bt)) * plotH;
    const { width, height } = getPaperDimensions(paper.paperSize, paper.landscape);
    // The gap, and a cell more, so the grid is never kinder than the exact test.
    const gc = Math.ceil(gapMm / width / CELL) + 1;
    const gr = Math.ceil(gapMm / height / CELL) + 1;
    const mark = (x0: number, y0: number, x1: number, y1: number) => {
      const c0 = Math.max(0, Math.floor(Math.min(x0, x1) / CELL) - gc);
      const c1 = Math.min(cols - 1, Math.floor(Math.max(x0, x1) / CELL) + gc);
      const r0 = Math.max(0, Math.floor(Math.min(y0, y1) / CELL) - gr);
      const r1 = Math.min(rows - 1, Math.floor(Math.max(y0, y1) / CELL) + gr);
      for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) grid[rr * cols + cc] = 1;
    };
    for (const line of shapes.lines) {
      for (let i = 0; i + 1 < line.length || (i === 0 && line.length === 1); i++) {
        const a = line[i];
        const b = line[Math.min(i + 1, line.length - 1)];
        const ax = fx(a[0]);
        const ay = fy(a[1]);
        const bx = fx(b[0]);
        const by = fy(b[1]);
        const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (CELL / 2)));
        for (let k = 0; k <= n; k++) {
          const t = k / n;
          const x = ax + (bx - ax) * t;
          const y = ay + (by - ay) * t;
          if (x < -1 || x > 2 || y < -1 || y > 2) continue;
          mark(x, y, x, y);
        }
      }
    }
    for (const s of shapes.boxes) mark(fx(s.xMin), fy(s.yMax), fx(s.xMax), fy(s.yMin));
    // The ground's inside, column by column.
    const poly = shapes.ground;
    if (poly.length >= 3) {
      for (let cc = 0; cc < cols; cc++) {
        const wxc = l + (((cc + 0.5) * CELL - PLOT_MARGINS.L) / plotW) * (r - l);
        const ys: number[] = [];
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [xi, yi] = poly[i];
          const [xj, yj] = poly[j];
          if (xi > wxc !== xj > wxc) ys.push(yi + ((wxc - xi) * (yj - yi)) / (xj - xi));
        }
        ys.sort((a, b) => a - b);
        for (let k = 0; k + 1 < ys.length; k += 2) {
          const top = fy(ys[k + 1]);
          const bottom = fy(ys[k]);
          mark((cc + 0.5) * CELL, top, (cc + 0.5) * CELL, bottom);
        }
      }
    }
    // Prefix sums: a box's cells counted in four lookups.
    this.sum = new Int32Array((cols + 1) * (rows + 1));
    for (let rr = 0; rr < rows; rr++) {
      let run = 0;
      for (let cc = 0; cc < cols; cc++) {
        run += grid[rr * cols + cc];
        this.sum[(rr + 1) * (cols + 1) + cc + 1] = this.sum[rr * (cols + 1) + cc + 1] + run;
      }
    }
  }

  /** Whether a box on the paper touches no marked cell. */
  free(box: SheetBox): boolean {
    const { cols } = this;
    const c0 = Math.max(0, Math.floor(box.x / CELL));
    const c1 = Math.min(this.cols, Math.ceil((box.x + box.w) / CELL));
    const r0 = Math.max(0, Math.floor(box.y / CELL));
    const r1 = Math.min(this.rows, Math.ceil((box.y + box.h) / CELL));
    const at = (rr: number, cc: number) => this.sum[rr * (cols + 1) + cc];
    return at(r1, c1) - at(r0, c1) - at(r1, c0) + at(r0, c0) === 0;
  }
}

// ── The frame ───────────────────────────────────────────────────

/** How the model sits across the drawing area when it is drawn smaller than its width allows. */
type Align = "centre" | "left" | "right";

/**
 * The frame that draws `content` at `scale` (world units per mm of paper),
 * its lowest point MODEL_BOTTOM_MM above the bottom of the drawing area,
 * across the drawing area as `align` says (with the usual side margin).
 */
function frameAt(content: PaperContent, paper: Paper, scale: number, align: Align): ViewLock | null {
  const { width: paperW, height: paperH } = getPaperDimensions(paper.paperSize, paper.landscape);
  const plotW = paperW * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
  const plotH = paperH * (1 - PLOT_MARGINS.T - PLOT_MARGINS.B);
  const pxPerMm = virtualPaperFrame(paper.paperSize, paper.landscape).w / paperW;
  const b = paperContentBounds(content, scale / pxPerMm) ?? boundsOf(content.coordinates);
  if (!b) return null;
  const margin = Math.max(b.xMax - b.xMin, b.yMax - b.yMin) * PAPER_MARGIN_FRACTION || 1;
  const x0 =
    align === "left" ? b.xMin - margin : align === "right" ? b.xMax + margin - plotW * scale : (b.xMin + b.xMax) / 2 - (plotW / 2) * scale;
  const y0 = b.yMin - MODEL_BOTTOM_MM * scale;
  return { bottomLeft: [x0, y0], topRight: [x0 + plotW * scale, y0 + plotH * scale] };
}

/**
 * The largest scale (least world units per mm) at which the content fits
 * the drawing area's width and the room under `top` (a fraction of the
 * paper height), its symbols (fixed px sizes) taken in.
 */
function fitScale(content: PaperContent, paper: Paper, top: number): number | null {
  const base = boundsOf(content.coordinates);
  if (!base) return null;
  const { width: paperW, height: paperH } = getPaperDimensions(paper.paperSize, paper.landscape);
  const plotW = paperW * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
  const plotH = paperH * (1 - PLOT_MARGINS.T - PLOT_MARGINS.B);
  const roomH = Math.max(1, plotH - MODEL_BOTTOM_MM - (top - PLOT_MARGINS.T) * paperH);
  const pxPerMm = virtualPaperFrame(paper.paperSize, paper.landscape).w / paperW;
  const scaleFor = (b: Bounds) => {
    const margin = Math.max(b.xMax - b.xMin, b.yMax - b.yMin) * PAPER_MARGIN_FRACTION || 1;
    return Math.max((b.xMax - b.xMin + 2 * margin) / plotW, (b.yMax - b.yMin) / roomH);
  };
  // The symbols take more world units the smaller the scale: a few rounds settle it.
  let s = scaleFor(base);
  for (let i = 0; i < 6; i++) {
    const next = scaleFor(paperContentBounds(content, s / pxPerMm) ?? base);
    if (Math.abs(next - s) < 1e-12 * s) break;
    s = next;
  }
  return s;
}

/**
 * The table's place in a frame: its top-right corner, from the top right
 * down and then further left, the first where it is clear of the title
 * block's text and (on the grid) of what the model draws. Null where none.
 */
function placeTable(size: { w: number; h: number }, texts: SheetBox[], occupancy: Occupancy): { x: number; y: number } | null {
  const left = PLOT_MARGINS.L + 0.01;
  const bottom = 1 - PLOT_MARGINS.B - 0.01;
  for (let right = TABLE_RIGHT; right - size.w >= left - 1e-9; right -= STEP) {
    for (let top = TABLE_TOP; top + size.h <= bottom + 1e-9; top += STEP) {
      const box = { x: right - size.w, y: top, w: size.w, h: size.h };
      const beside = { x: box.x - SIDE_GAP, y: box.y - GAP / 2, w: box.w + SIDE_GAP, h: box.h + GAP };
      if (texts.some((t) => boxesOverlap(beside, t))) continue;
      if (!occupancy.free(box)) continue;
      return { x: Math.round(right * 1000) / 1000, y: Math.round(top * 1000) / 1000 };
    }
  }
  return null;
}

/**
 * The sheet of a benchmark: its annotations with the material table placed
 * (see the top of this file), and the frame that draws the model at true
 * scale low on the sheet, or as large as the table's place allows.
 */
export function layoutBenchmarkSheet(
  model: BenchmarkSheetModel,
  content: PaperContent,
  annotations: Annotation[],
  paper: Paper,
): { annotations: Annotation[]; viewLock: ViewLock | null } {
  const { texts } = annotationBoxes(model, annotations, paper);
  const table = annotations.find((a): a is PaperAnnotation => a.type === "material-table");
  const blockBottom = texts.length ? bottomOf(texts) + GAP : PLOT_MARGINS.T;
  // The model's own drawing goes under the title block; its marks (the F
  // label at a circle's centre, which can lie high above it) need only be
  // clear of the block's text and on the drawing area (marksFit).
  const body: PaperContent = { ...content, marks: [] };
  const s0 = fitScale(body, paper, blockBottom);
  if (s0 === null) return { annotations, viewLock: null };
  const marksFit = (lock: ViewLock) => {
    const px = worldPerPx(lock, paper);
    return (content.marks ?? []).every(({ at: [x, y], rightPx, upPx }) => {
      const m = worldBox({ xMin: x, xMax: x + rightPx * px, yMin: y, yMax: y + upPx * px }, lock);
      const inside = m.x >= PLOT_MARGINS.L && m.x + m.w <= 1 - PLOT_MARGINS.R && m.y >= PLOT_MARGINS.T && m.y + m.h <= 1 - PLOT_MARGINS.B;
      return inside && !texts.some((t) => boxesOverlap({ x: m.x - SIDE_GAP / 2, y: m.y - GAP / 2, w: m.w + SIDE_GAP, h: m.h + GAP }, t));
    });
  };
  const sized = table ? materialTableBox({ ...table, x: 0, y: 0, anchor: "top-left" }, model.materials, model.piezometricLine, paper, estimate) : null;
  if (!table || !sized) return { annotations, viewLock: frameAt(body, paper, s0, "centre") };

  const tryAt = (scale: number, align: Align) => {
    const lock = frameAt(body, paper, scale, align);
    if (!lock || !marksFit(lock)) return null;
    const occupancy = new Occupancy(sheetShapes(model, content, lock, paper), lock, paper, TABLE_GAP_MM);
    const at = placeTable(sized, texts, occupancy);
    return at ? { lock, at } : null;
  };
  // At true scale; else the largest smaller scale at which the table fits
  // somewhere, the model centred or (when that draws it larger) at a side.
  let best = tryAt(s0, "centre");
  if (!best) {
    // A scale that surely fits: the model under the table at the top right, below the block.
    const under = fitScale(content, paper, Math.max(blockBottom, TABLE_TOP + sized.h + GAP));
    let found: { scale: number; fit: NonNullable<ReturnType<typeof tryAt>> } | null = null;
    for (const align of ["centre", "left", "right"] as const) {
      let lo = s0;
      let hi = Math.max(s0, under ?? s0) * 1.01;
      let fit = tryAt(hi, align);
      for (let k = 0; !fit && k < 6; k++) fit = tryAt((hi *= 1.5), align);
      if (!fit) continue;
      for (let k = 0; k < SCALE_ROUNDS; k++) {
        const mid = (lo + hi) / 2;
        const f = tryAt(mid, align);
        if (f) {
          hi = mid;
          fit = f;
        } else lo = mid;
      }
      if (!found || hi < found.scale * 0.999) found = { scale: hi, fit };
    }
    best = found?.fit ?? null;
  }
  if (!best) return { annotations, viewLock: frameAt(body, paper, s0, "centre") };
  const { lock, at } = best;
  return {
    annotations: annotations.map((a): Annotation => (a === table ? { ...table, x: at.x, y: at.y, anchor: "top-right" } : a)),
    viewLock: lock,
  };
}

/** What the layout reads of a model's state (or entry), with its result view's annotations and paper. */
export function benchmarkSheetOf(s: {
  projectInfo?: ProjectInfo;
  materials: MaterialRow[];
  piezometricLine?: PiezometricLineState;
  coordinates: Pt[];
  analysisLimits?: AnalysisLimitsState;
  result?: Pick<AnalysisResult, "criticalSurface"> | null;
  resultViewSettings?: { showCentreMarker?: boolean };
}): BenchmarkSheetModel {
  return {
    projectInfo: s.projectInfo ?? { title: "", subtitle: "" },
    materials: s.materials,
    piezometricLine: s.piezometricLine,
    coordinates: s.coordinates,
    analysisLimits: s.analysisLimits,
    result: s.result ?? null,
    resultViewSettings: { showCentreMarker: s.resultViewSettings?.showCentreMarker },
  };
}

/** Whether a sheet carries a benchmark's title block (Help › Benchmarks; its reference values). */
export function isBenchmarkSheet(annotations: readonly Pick<Annotation, "id">[]): boolean {
  return annotations.some((a) => a.id === BENCHMARK_REFERENCE_ID);
}

/** Id of the reference values' text in a benchmark's title block. */
export const BENCHMARK_REFERENCE_ID = "anno-benchmark-reference";
