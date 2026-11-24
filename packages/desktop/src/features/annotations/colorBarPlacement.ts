import type {
  Annotation,
  MaterialRow,
  PaperFrameSettings,
  PiezometricLineState,
} from "../../store/types";
import { PLOT_MARGINS } from "../../store/defaults";
import { buildMaterialTableData } from "../canvas/helpers";
import { COLOR_BAR_PLATE_PAD, SHEET_LAYOUT_MM_PER_PX, SHEET_SANS_FAMILY, textLayoutPx } from "../rendering/style-spec";
import { getPaperDimensions } from "../view/paper";
import { anchoredTopLeft } from "./anchorPosition";
import { COLOR_BAR_FONT_LAYOUT_PX, colorBarLayout } from "./colorBarLayout";
import { layoutMaterialTable, MATERIAL_TABLE_FONT_SIZE } from "./materialTableLayout";

/**
 * Where a new color bar goes: at the right edge of the plot frame, just
 * below the material table as it is drawn (its height for the materials,
 * columns, text size and paper), or where it always went when the sheet
 * has no table; clear of the drawn model and the text where the caller
 * knows them (SheetObstacles), over empty sky where these places are not.
 */

/** Space between the frame line and a pinned table or bar (fraction of the paper). */
export const FRAME_INSET = 0.01;
/** The right edge of the plot frame, just inside it. */
export const RIGHT_INSIDE_FRAME = Math.round((1 - PLOT_MARGINS.R - FRAME_INSET) * 1000) / 1000;
/** The top edge of the plot frame, just inside it. */
export const TOP_INSIDE_FRAME = Math.round((PLOT_MARGINS.T + FRAME_INSET) * 1000) / 1000;
/** The color bar's place on a sheet without a material table. */
export const COLOR_BAR_DEFAULT_Y = 0.35;
/** Gap between the table and the bar (fraction of the paper height): clear of the bar's plate. */
const GAP = 0.025;

/** Text width in px at a font: the canvas's measure, or an estimate without one. */
export type TextMeasure = (text: string, fontPx: number, bold: boolean) => number;

let canvasContext: CanvasRenderingContext2D | null | undefined;

/** Average glyph widths of a sans-serif font, as a fraction of its size. */
function estimateWidth(text: string, fontPx: number, bold: boolean): number {
  return text.length * fontPx * (bold ? 0.6 : 0.55);
}

/** The canvas's text measure (as the sheet draws), or an estimate where there is none. */
export const measureSansText: TextMeasure = (text, fontPx, bold) => {
  if (canvasContext === undefined) {
    try {
      canvasContext =
        typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
    } catch {
      canvasContext = null;
    }
  }
  if (canvasContext) {
    canvasContext.font = `${bold ? "bold " : ""}${fontPx}px ${SHEET_SANS_FAMILY}`;
    const width = canvasContext.measureText(text).width;
    // A stand-in canvas (tests) measures nothing.
    if (width > 0 || text.length === 0) return width;
  }
  return estimateWidth(text, fontPx, bold);
};

/**
 * Size of an annotation drawn at `px` layout px (the table's and the color
 * bar's, the same mm on every paper size), as fractions of the paper.
 */
function paperFractions(paper: Pick<PaperFrameSettings, "paperSize" | "landscape">) {
  const { width, height } = getPaperDimensions(paper.paperSize, paper.landscape);
  const unit = SHEET_LAYOUT_MM_PER_PX;
  return { w: (px: number) => (px * unit) / width, h: (px: number) => (px * unit) / height };
}

/**
 * The box of a material table on the paper, in fractions of the paper's
 * width (x, w) and height (y, h): layoutMaterialTable, as the canvas and the
 * PDF lay it out. The canvas draws it at the sheet's scale, as the PDF
 * does, so it takes the same share of the paper at any `sheetScale` (the
 * sheet's scale on screen, px per layout px: its text is measured at the
 * size it is drawn at). Its text and layout are the same in mm on every
 * paper size, so it takes a smaller share of a larger paper.
 */
export function materialTableBox(
  table: Annotation,
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState | undefined,
  paper: Pick<PaperFrameSettings, "paperSize" | "landscape">,
  measure: TextMeasure = measureSansText,
  sheetScale?: number,
): { x: number; y: number; w: number; h: number } {
  const fontSize = textLayoutPx(table.fontSizePx ?? MATERIAL_TABLE_FONT_SIZE);
  const { columnKeys, header, rows } = buildMaterialTableData(table, materials, piezometricLine);
  // In sheet px at the scale the table is drawn at, then back to the
  // sheet's own scale (where the paper fractions are measured).
  const sheet = sheetScale !== undefined && sheetScale > 0 ? sheetScale : 1;
  const size = fontSize * sheet;
  const layout = layoutMaterialTable(
    columnKeys,
    header,
    rows,
    { header: (t) => measure(t, size, true), body: (t) => measure(t, size, false) },
    sheet,
    fontSize,
  );
  const frac = paperFractions(paper);
  const w = frac.w(layout.totalW / sheet);
  const h = frac.h(layout.totalH / sheet);
  const { x, y } = anchoredTopLeft(table.x ?? 0, table.y ?? 0, w, h, table.anchor);
  return { x, y, w, h };
}

/** Height of the color bar with its title, as a fraction of the paper height (the same mm on every paper size). */
export function colorBarHeight(paper: Pick<PaperFrameSettings, "paperSize" | "landscape">): number {
  // As drawn: the bar under a title line and its space (layout px).
  return paperFractions(paper).h(colorBarLayout(1, 0).h);
}

/** The widest value the bar shows, about (a capped F of two digits). */
const WIDEST_VALUE = "≥ 00.00";

/** Width of the color bar with its values, as a fraction of the paper width (the same mm on every paper size). */
export function colorBarWidth(
  paper: Pick<PaperFrameSettings, "paperSize" | "landscape">,
  measure: TextMeasure = measureSansText,
): number {
  const value = measure(WIDEST_VALUE, COLOR_BAR_FONT_LAYOUT_PX, false);
  return paperFractions(paper).w(colorBarLayout(1, value).w);
}

/** A box on the paper, as fractions of its width (x, w) and height (y down, h). */
export interface PaperBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * What else is on the sheet besides its tables, for the color bar's place
 * (store/benchmark-sheet.ts sheetObstacles): the drawn model (its ground
 * and outline, water, loads, the search limit markers, the F label) and
 * the text (a title block).
 */
export interface SheetObstacles {
  /** Whether a box (the bar with its plate) is clear of the model's drawing and of the text. */
  clear(box: PaperBox): boolean;
  /**
   * The first place over empty sky inside the frame for a box of `size`,
   * clear of the model, the text and `avoid` (the tables), as the
   * benchmark sheet places its table: its top-right corner, from `start`
   * down and then further left. Null where there is none.
   */
  place(size: { w: number; h: number }, avoid: PaperBox[], start: { right: number; top: number }): { x: number; y: number } | null;
}

/**
 * The anchor point (top right) of a new color bar: the first of these
 * places where the whole bar lies inside the plot frame and clear of the
 * material tables and, with `sheet`, of the drawn model and the text.
 * Right below the lowest table, at the right edge of the plot frame; to
 * the left of the tables, at the top of the frame; to the right of the
 * tables, at their top. With `sheet`, where none of these is free, the
 * first spot over empty sky from the top right of the frame
 * (SheetObstacles.place). Where none is free, below the tables at the
 * right edge, as low as the frame lets it. Without a table, where it
 * always went, or over empty sky when the model or the text is there.
 * (A sheet whose table is at the left, as a benchmark's, put the bar left
 * of the table, off the paper, before the second and third places were
 * checked against the frame.) `sheetScale` is the sheet's scale on screen
 * (see materialTableBox): the table as it is drawn there, which on a
 * small sheet is larger than on paper.
 */
export function colorBarDefaultPosition(
  annotations: Annotation[],
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState | undefined,
  paper: Pick<PaperFrameSettings, "paperSize" | "landscape">,
  measure: TextMeasure = measureSansText,
  sheetScale?: number,
  sheet?: SheetObstacles,
): { x: number; y: number } {
  const r = (v: number) => Math.round(v * 1000) / 1000;
  const w = colorBarWidth(paper, measure);
  const h = colorBarHeight(paper);
  const frac = paperFractions(paper);
  const plate = { w: frac.w(COLOR_BAR_PLATE_PAD), h: frac.h(COLOR_BAR_PLATE_PAD) };
  // The bar hangs from its top-right corner, on its plate.
  const withPlate = (c: { x: number; y: number }): PaperBox => ({
    x: c.x - w - plate.w,
    y: c.y - plate.h,
    w: w + 2 * plate.w,
    h: h + 2 * plate.h,
  });
  const clearOfSheet = (c: { x: number; y: number }) => !sheet || sheet.clear(withPlate(c));
  // Over empty sky: the bar's point from its plate's top-right corner.
  const sky = (avoid: PaperBox[]) => {
    const at = sheet?.place({ w: w + 2 * plate.w, h: h + 2 * plate.h }, avoid, {
      right: RIGHT_INSIDE_FRAME + plate.w,
      top: TOP_INSIDE_FRAME - plate.h,
    });
    return at ? { x: r(at.x - plate.w), y: r(at.y + plate.h) } : null;
  };
  const tables = annotations.filter((a) => a.type === "material-table");
  if (tables.length === 0) {
    const place = { x: RIGHT_INSIDE_FRAME, y: COLOR_BAR_DEFAULT_Y };
    return clearOfSheet(place) ? place : (sky([]) ?? place);
  }
  const boxes = tables.map((t) => materialTableBox(t, materials, piezometricLine, paper, measure, sheetScale));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.w));
  const top = Math.min(...boxes.map((b) => b.y));
  const frameLeft = PLOT_MARGINS.L + FRAME_INSET;
  const frameBottom = 1 - PLOT_MARGINS.B - FRAME_INSET;
  const below = { x: RIGHT_INSIDE_FRAME, y: r(bottom + GAP) };
  const candidates = [
    below,
    { x: r(left - GAP), y: TOP_INSIDE_FRAME },
    { x: r(right + GAP + w), y: r(Math.max(top, TOP_INSIDE_FRAME)) },
  ];
  const free = candidates.find(
    (c) =>
      c.x - w >= frameLeft &&
      c.x <= RIGHT_INSIDE_FRAME &&
      c.y + h <= frameBottom &&
      boxes.every((b) => c.x <= b.x || c.x - w >= b.x + b.w || c.y >= b.y + b.h || c.y + h <= b.y) &&
      clearOfSheet(c),
  );
  return free ?? sky(boxes) ?? { x: RIGHT_INSIDE_FRAME, y: r(Math.max(TOP_INSIDE_FRAME, Math.min(below.y, frameBottom - h))) };
}
