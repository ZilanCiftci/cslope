/**
 * The color bar's layout, shared by the result view (and its hit areas)
 * and the PDF: its sizes are the same in mm on every paper size (layout
 * px, SHEET_LAYOUT_MM_PER_PX; its text in px of the F label's unit), and
 * it is drawn inside the plot frame wherever its stored point is.
 */

import { PLOT_MARGINS } from "../../store/defaults";
import type { AnchorPosition } from "../../store/types";
import {
  COLOR_BAR_FONT_PX,
  COLOR_BAR_H,
  COLOR_BAR_LABEL_GAP,
  COLOR_BAR_PLATE_PAD,
  COLOR_BAR_TICK,
  COLOR_BAR_TITLE_GAP,
  COLOR_BAR_W,
  textLayoutPx,
} from "../rendering/style-spec";
import { anchoredTopLeft } from "./anchorPosition";

/** The color bar's text size in layout px (11). */
export const COLOR_BAR_FONT_LAYOUT_PX = textLayoutPx(COLOR_BAR_FONT_PX);

/** The color bar's sizes in the caller's unit, `scale` of it per layout px. */
export interface ColorBarLayout {
  barW: number;
  barH: number;
  /** The title's and the values' text size. */
  fontSize: number;
  /** From the bar to its values; a tick's length. */
  labelGap: number;
  tick: number;
  /** From the title's baseline to the top of the bar. */
  titleGap: number;
  /** From the top of the content (the title's line) to the top of the bar. */
  titleExtraTop: number;
  /** Space between the content and the edge of its plate. */
  plate: number;
  /** The content's width and height (title, bar and values), without the plate. */
  w: number;
  h: number;
}

/** The text size of the bar's title and values at `scale` per layout px. */
export function colorBarFontSize(scale: number): number {
  return COLOR_BAR_FONT_LAYOUT_PX * scale;
}

/** The color bar's layout at `scale` per layout px, its widest value `maxLabelW` wide (in the same unit). */
export function colorBarLayout(scale: number, maxLabelW: number): ColorBarLayout {
  const barW = COLOR_BAR_W * scale;
  const barH = COLOR_BAR_H * scale;
  const fontSize = colorBarFontSize(scale);
  const labelGap = COLOR_BAR_LABEL_GAP * scale;
  const titleGap = COLOR_BAR_TITLE_GAP * scale;
  const titleExtraTop = fontSize + titleGap;
  return {
    barW,
    barH,
    fontSize,
    labelGap,
    tick: COLOR_BAR_TICK * scale,
    titleGap,
    titleExtraTop,
    plate: COLOR_BAR_PLATE_PAD * scale,
    w: barW + labelGap + maxLabelW,
    h: barH + titleExtraTop,
  };
}

/**
 * The top-left corner of the color bar's content: hung from its point
 * (`ax`, `ay`) by its anchor, then moved, where it is needed, so that its
 * plate lies inside the plot frame (PLOT_MARGINS of `paper`, the paper's
 * box in the caller's unit). A point stored outside the frame, or one that
 * a smaller paper no longer has room for, is drawn at the frame's edge; a
 * bar inside the frame is drawn where its point puts it.
 */
export function colorBarTopLeft(
  ax: number,
  ay: number,
  layout: Pick<ColorBarLayout, "w" | "h" | "plate">,
  anchor: AnchorPosition | undefined,
  paper: { x: number; y: number; w: number; h: number },
): { x: number; y: number } {
  const { x, y } = anchoredTopLeft(ax, ay, layout.w, layout.h, anchor);
  const left = paper.x + paper.w * PLOT_MARGINS.L + layout.plate;
  const right = paper.x + paper.w * (1 - PLOT_MARGINS.R) - layout.plate - layout.w;
  const top = paper.y + paper.h * PLOT_MARGINS.T + layout.plate;
  const bottom = paper.y + paper.h * (1 - PLOT_MARGINS.B) - layout.plate - layout.h;
  // Too large for the frame (not on any paper size there is): its top left.
  return { x: Math.max(left, Math.min(x, right)), y: Math.max(top, Math.min(y, bottom)) };
}
