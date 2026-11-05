import type {
  Annotation,
  MaterialRow,
  PaperFrameSettings,
  PiezometricLineState,
} from "../../store/types";
import { PLOT_MARGINS } from "../../store/defaults";
import { buildMaterialTableData } from "../canvas/helpers";
import { ANNOTATION_SCALE_DIVISOR } from "../rendering/style-spec";
import { getPaperDimensions } from "../view/paper";
import { anchoredTopLeft } from "./anchorPosition";
import { layoutMaterialTable, MATERIAL_TABLE_FONT_SIZE } from "./materialTableLayout";

/**
 * Where a new color bar goes: at the right edge of the plot frame, just
 * below the material table as it is drawn (its height for the materials,
 * columns, text size and paper), or where it always went when the sheet
 * has no table.
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
    canvasContext.font = `${bold ? "bold " : ""}${fontPx}px sans-serif`;
    const width = canvasContext.measureText(text).width;
    // A stand-in canvas (tests) measures nothing.
    if (width > 0 || text.length === 0) return width;
  }
  return estimateWidth(text, fontPx, bold);
};

/** Size of an annotation drawn at `px` sheet pixels, as fractions of the paper. */
function paperFractions(paper: Pick<PaperFrameSettings, "paperSize" | "landscape">) {
  const { width, height } = getPaperDimensions(paper.paperSize, paper.landscape);
  // The sheet scales annotations by min(paper width, height) / divisor.
  const unit = Math.min(width, height) / ANNOTATION_SCALE_DIVISOR;
  return { w: (px: number) => (px * unit) / width, h: (px: number) => (px * unit) / height };
}

/**
 * The box of a material table on the paper, in fractions of the paper's
 * width (x, w) and height (y, h): layoutMaterialTable, as the canvas and the
 * PDF lay it out.
 */
export function materialTableBox(
  table: Annotation,
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState | undefined,
  paper: Pick<PaperFrameSettings, "paperSize" | "landscape">,
  measure: TextMeasure = measureSansText,
): { x: number; y: number; w: number; h: number } {
  const fontSize = table.fontSize ?? MATERIAL_TABLE_FONT_SIZE;
  const { columnKeys, header, rows } = buildMaterialTableData(table, materials, piezometricLine);
  // At scale 1: the layout scales linearly with the sheet.
  const layout = layoutMaterialTable(
    columnKeys,
    header,
    rows,
    { header: (t) => measure(t, fontSize, true), body: (t) => measure(t, fontSize, false) },
    1,
    fontSize,
  );
  const frac = paperFractions(paper);
  const w = frac.w(layout.totalW);
  const h = frac.h(layout.totalH);
  const { x, y } = anchoredTopLeft(table.x ?? 0, table.y ?? 0, w, h, table.anchor);
  return { x, y, w, h };
}

/** Height of the color bar with its title, as a fraction of the paper height. */
export function colorBarHeight(paper: Pick<PaperFrameSettings, "paperSize" | "landscape">): number {
  // As drawn: a 200 px bar under a title line of 11 px text and 4 px space.
  return paperFractions(paper).h(200 + 11 + 4);
}

/**
 * The anchor point (top right) of a new color bar: right below the lowest
 * material table, at the right edge of the plot frame. When the bar would
 * run past the bottom of the frame there, it goes to the left of the
 * table at the top instead; without a table, where it always went.
 */
export function colorBarDefaultPosition(
  annotations: Annotation[],
  materials: MaterialRow[],
  piezometricLine: PiezometricLineState | undefined,
  paper: Pick<PaperFrameSettings, "paperSize" | "landscape">,
  measure: TextMeasure = measureSansText,
): { x: number; y: number } {
  const tables = annotations.filter((a) => a.type === "material-table");
  if (tables.length === 0) return { x: RIGHT_INSIDE_FRAME, y: COLOR_BAR_DEFAULT_Y };
  const boxes = tables.map((t) => materialTableBox(t, materials, piezometricLine, paper, measure));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h));
  const y = Math.round((bottom + GAP) * 1000) / 1000;
  const frameBottom = 1 - PLOT_MARGINS.B - FRAME_INSET;
  if (y + colorBarHeight(paper) <= frameBottom) return { x: RIGHT_INSIDE_FRAME, y };
  const left = Math.min(...boxes.map((b) => b.x));
  return { x: Math.round((left - GAP) * 1000) / 1000, y: TOP_INSIDE_FRAME };
}
