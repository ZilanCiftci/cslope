/**
 * The result sheet's grid (Layers › Grid), as the result view and the PDF
 * both draw it: where its lines are (world coordinates along one axis) and
 * how wide they are on the paper (mm), from the model's grid style. One
 * function for both renderers, so the screen and the print agree.
 */
import type { ResultLayerStyles } from "../../store/types";
import { pdfScaled } from "../results/layer-styles";
import {
  GRID_LINE_MM,
  GRID_LINE_WIDTH_PX,
  GRID_MINOR_LINE_WIDTH_PX,
  GRID_MINOR_MIN_SPACING_MM,
} from "./style-spec";

/** The grid's lines on the paper: widths in mm, the minor lines' subdivisions (0: none), the color of the user's (absent: the default). */
export interface SheetGridStyle {
  majorMm: number;
  minorMm: number;
  subdivisions: number;
  color?: string;
}

/** The grid's style on the paper from the model's `layerStyles.grid`. */
export function sheetGridStyle(style: ResultLayerStyles["grid"]): SheetGridStyle {
  return {
    majorMm: pdfScaled(GRID_LINE_MM, style?.width, GRID_LINE_WIDTH_PX),
    minorMm: pdfScaled(GRID_LINE_MM, style?.minorWidth ?? GRID_MINOR_LINE_WIDTH_PX, GRID_LINE_WIDTH_PX),
    subdivisions: style?.subdivisions ?? 0,
    ...(style?.color ? { color: style.color } : {}),
  };
}

/**
 * The grid lines along one axis from `min` to `max` (world units): the
 * major lines at the multiples of `step`, and with `subdivisions` (2 or
 * more) the minor lines between them, when they lie at least
 * GRID_MINOR_MIN_SPACING_MM apart on the paper (`mmPerUnit`: paper mm per
 * world unit). Positions are whole multiples, so they do not drift.
 */
export function gridLinePositions(
  min: number,
  max: number,
  step: number,
  subdivisions: number,
  mmPerUnit: number,
): { major: number[]; minor: number[] } {
  const major: number[] = [];
  const minor: number[] = [];
  if (!(step > 0) || !Number.isFinite(step) || !(max >= min)) return { major, minor };
  const eps = 1e-9;
  for (let i = Math.ceil(min / step - eps); i <= Math.floor(max / step + eps); i++) major.push(i * step + 0); // (+ 0: no -0)
  const sub = Math.round(subdivisions);
  const minorStep = step / sub;
  if (sub >= 2 && minorStep * Math.abs(mmPerUnit) >= GRID_MINOR_MIN_SPACING_MM) {
    for (let i = Math.ceil(min / minorStep - eps); i <= Math.floor(max / minorStep + eps); i++) {
      if (i % sub !== 0) minor.push(i * minorStep + 0);
    }
  }
  return { major, minor };
}
