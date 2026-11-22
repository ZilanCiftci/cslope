/**
 * The sheet of a benchmark opened from Help › Benchmarks: where its
 * material table and its model go, measured against the title block.
 *
 * The title block (title, source, calculated F and the reference values)
 * hangs from the top left of the paper. The material table sits at the top
 * right, or right under the title block when it would reach into the
 * block's text there. The model is drawn at true scale across the width of
 * the drawing area, but low: its lowest point MODEL_BOTTOM_MM above the
 * bottom of the drawing area, so the room above it holds the block and the
 * table. Where that room is too small, the model is drawn at a smaller
 * scale rather than run into them, either under both or, when that draws
 * it larger (a long table), left of the table and under the block.
 *
 * Only the benchmarks use this layout; a user's own model (and "Use model
 * bounds") keeps the frame of modelViewLock.
 */

import { PLOT_MARGINS } from "./defaults";
import type { Annotation, MaterialRow, PaperFrameSettings, PiezometricLineState, ProjectInfo, ViewLock } from "./types";
import { materialTableBox, type TextMeasure } from "../features/annotations/colorBarPlacement";
import { resolveAnnotationText } from "../features/annotations/resolveAnnotationText";
import { ANNOTATION_DEFAULT_FONT_SIZE, ANNOTATION_LINE_HEIGHT, ANNOTATION_SCALE_DIVISOR } from "../features/rendering/style-spec";
import { boundsOf, paperContentBounds, type Bounds, type PaperContent } from "../features/view/extents";
import { getPaperDimensions } from "../features/view/paper";
import { PAPER_MARGIN_FRACTION, REFERENCE_PAPER_WIDTH_PX } from "../features/view/viewLock";

/** A box on the paper, as fractions of its width (x, w) and height (y down, h). */
export interface SheetBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Paper = Pick<PaperFrameSettings, "paperSize" | "landscape">;

/** What the layout reads of a model. */
export interface BenchmarkSheetModel {
  projectInfo: Pick<ProjectInfo, "title" | "subtitle"> & Partial<ProjectInfo>;
  materials: MaterialRow[];
  piezometricLine?: PiezometricLineState;
}

/** Space from the model's lowest point to the bottom of the drawing area (mm on the paper). */
export const MODEL_BOTTOM_MM = 10;
/** Space under the title block and the table (fraction of the paper height). */
const GAP = 0.015;
/** Space beside the table (fraction of the paper width). */
const SIDE_GAP = 0.015;
/** Widest F the block shows ("Calculated F: #FOS"): its value has three decimals. */
const FOS_TEXT = "0.000";

/**
 * Sheet scale (px per annotation px) at which the table is measured: a
 * sheet 600 px tall, about what a full-HD screen shows. The canvas draws
 * the table's text no smaller than 9 px, so there the table is half as
 * large again as in the PDF (and larger still on a smaller sheet).
 */
const TABLE_SHEET_SCALE = 1;

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

/** The boxes of the title block's lines and of the material tables, as the sheet draws them. */
export function annotationBoxes(model: BenchmarkSheetModel, annotations: Annotation[], paper: Paper) {
  const texts = annotations.filter((a) => a.type === "text").map((a) => textBox(a, model.projectInfo, paper));
  const tables = annotations
    .filter((a) => a.type === "material-table")
    .map((a) => materialTableBox(a, model.materials, model.piezometricLine, paper, estimate, TABLE_SHEET_SCALE));
  return { texts, tables };
}

/** Whether two boxes overlap. */
export function boxesOverlap(a: SheetBox, b: SheetBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

const bottomOf = (boxes: SheetBox[]) => Math.max(...boxes.map((b) => b.y + b.h));

/**
 * The material table placed clear of the title block: at its own place
 * (the top right) when it is clear of every line of the block there, else
 * moved down to start under the block's last line.
 */
function placeMaterialTable(model: BenchmarkSheetModel, annotations: Annotation[], paper: Paper): Annotation[] {
  const { texts } = annotationBoxes(model, annotations, paper);
  if (texts.length === 0) return annotations;
  return annotations.map((a) => {
    if (a.type !== "material-table") return a;
    const box = materialTableBox(a, model.materials, model.piezometricLine, paper, estimate, TABLE_SHEET_SCALE);
    const beside = { x: box.x - SIDE_GAP, y: box.y, w: box.w + SIDE_GAP, h: box.h };
    if (!texts.some((t) => boxesOverlap(beside, t))) return a;
    return { ...a, y: Math.round((bottomOf(texts) + GAP) * 1000) / 1000 };
  });
}

/** Where the model may go: from `left` to `right` (fractions of the paper width) and below `top` (of its height). */
interface Region {
  left: number;
  right: number;
  top: number;
}

/**
 * The paper frame that draws `content` at true scale as large as it goes
 * in `region` with the usual margin at its sides (PAPER_MARGIN_FRACTION),
 * centred across the region, its lowest point MODEL_BOTTOM_MM above the
 * bottom of the drawing area; with `scale`, the world units per mm of
 * paper (smaller draws the model larger).
 */
function fitInRegion(content: PaperContent, paper: Paper, region: Region): { lock: ViewLock; scale: number } | null {
  const base = boundsOf(content.coordinates);
  if (!base) return null;
  const { width: paperW, height: paperH } = getPaperDimensions(paper.paperSize, paper.landscape);
  const plotW = paperW * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R);
  const plotH = paperH * (1 - PLOT_MARGINS.T - PLOT_MARGINS.B);
  // The region in mm from the drawing area's left and top edges.
  const left = (region.left - PLOT_MARGINS.L) * paperW;
  const right = (region.right - PLOT_MARGINS.L) * paperW;
  const top = (region.top - PLOT_MARGINS.T) * paperH;
  const roomW = Math.max(1, right - left);
  const roomH = Math.max(1, plotH - MODEL_BOTTOM_MM - top);
  const lockFor = (b: Bounds) => {
    const margin = Math.max(b.xMax - b.xMin, b.yMax - b.yMin) * PAPER_MARGIN_FRACTION || 1;
    const scale = Math.max((b.xMax - b.xMin + 2 * margin) / roomW, (b.yMax - b.yMin) / roomH);
    const x0 = (b.xMin + b.xMax) / 2 - ((left + right) / 2) * scale;
    const y0 = b.yMin - MODEL_BOTTOM_MM * scale;
    const lock: ViewLock = { bottomLeft: [x0, y0], topRight: [x0 + plotW * scale, y0 + plotH * scale] };
    return { lock, scale };
  };
  // The symbols drawn at a fixed size (loads, the water-table triangle) take
  // more world units the smaller the scale: a few rounds settle it (as paperViewLock).
  const pxPerMm = (REFERENCE_PAPER_WIDTH_PX * (1 - PLOT_MARGINS.L - PLOT_MARGINS.R)) / plotW;
  let fit = lockFor(base);
  for (let i = 0; i < 4; i++) {
    const next = lockFor(paperContentBounds(content, fit.scale / pxPerMm) ?? base);
    const same = Math.abs(next.scale - fit.scale) < 1e-12 * Math.max(1, fit.scale);
    fit = next;
    if (same) break;
  }
  return fit;
}

/**
 * The sheet of a benchmark: its annotations with the material table placed
 * clear of the title block, and the frame that draws the model as large as
 * it goes low on the sheet, clear of both (see the top of this file).
 */
export function layoutBenchmarkSheet(
  model: BenchmarkSheetModel,
  content: PaperContent,
  annotations: Annotation[],
  paper: Paper,
): { annotations: Annotation[]; viewLock: ViewLock | null } {
  const placed = placeMaterialTable(model, annotations, paper);
  const { texts, tables } = annotationBoxes(model, placed, paper);
  const plotLeft = PLOT_MARGINS.L;
  const plotRight = 1 - PLOT_MARGINS.R;
  const all = [...texts, ...tables];
  if (all.length === 0) return { annotations: placed, viewLock: fitInRegion(content, paper, { left: plotLeft, right: plotRight, top: PLOT_MARGINS.T })?.lock ?? null };
  // Under the block and the table, across the drawing area.
  const under = fitInRegion(content, paper, { left: plotLeft, right: plotRight, top: bottomOf(all) + GAP });
  // Left of the table, under the block (and under any table further left).
  const tableLeft = tables.length ? Math.min(...tables.map((t) => t.x)) - SIDE_GAP : plotRight;
  const leftOf = tables.length
    ? fitInRegion(content, paper, { left: plotLeft, right: tableLeft, top: (texts.length ? bottomOf(texts) : PLOT_MARGINS.T) + GAP })
    : null;
  const best = leftOf && under && leftOf.scale < under.scale ? leftOf : under;
  return { annotations: placed, viewLock: best?.lock ?? null };
}

/** Whether a sheet carries a benchmark's title block (Help › Benchmarks; its reference values). */
export function isBenchmarkSheet(annotations: readonly Pick<Annotation, "id">[]): boolean {
  return annotations.some((a) => a.id === BENCHMARK_REFERENCE_ID);
}

/** Id of the reference values' text in a benchmark's title block. */
export const BENCHMARK_REFERENCE_ID = "anno-benchmark-reference";

/**
 * The frame layoutBenchmarkSheet gives a benchmark with its sheet as it
 * is: after a run, with the result's marks in `content` (its F label at
 * the circle's centre), so they too stay clear of the block and the table.
 */
export function benchmarkSheetViewLock(
  model: BenchmarkSheetModel,
  content: PaperContent,
  settings: { annotations: Annotation[]; paperFrame: Paper },
): ViewLock | null {
  return layoutBenchmarkSheet(model, content, settings.annotations, settings.paperFrame).viewLock;
}

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
