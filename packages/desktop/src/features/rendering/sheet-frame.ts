/**
 * The result sheet's frame (Layers › Frame), as the result view and the
 * PDF both draw it: the plot frame's width, the color of the frame, the
 * ticks and their labels, and the labels' size and place on the paper
 * (mm, pt), from the model's frame style. One function for both
 * renderers, so the screen and the print agree.
 */
import type { ResultLayerStyles } from "../../store/types";
import { PLOT_FRAME_LINE_MM, RULER_FONT_PT, RULER_LABEL_GAP_MM, STYLE_PX_PER_MM } from "./style-spec";

/** The frame on the paper: widths and offsets in mm, the labels' size in pt, the color of the user's (absent: the default). */
export interface SheetFrameStyle {
  frameMm: number;
  fontPt: number;
  /** Whether the ticks are labelled. */
  labels: boolean;
  /** The x axis's labels' baseline below their tick, and the y axis's beside theirs (mm). */
  xLabelBaselineMm: number;
  yLabelBaselineMm: number;
  color?: string;
}

/** The frame's style on the paper from the model's `layerStyles.frame`. */
export function sheetFrameStyle(style: ResultLayerStyles["frame"]): SheetFrameStyle {
  const fontPt = style?.fontSize ?? RULER_FONT_PT;
  return {
    frameMm: style?.width === undefined ? PLOT_FRAME_LINE_MM : style.width / STYLE_PX_PER_MM,
    fontPt,
    labels: style?.labels !== false,
    xLabelBaselineMm: fontPt * 0.35 + RULER_LABEL_GAP_MM,
    yLabelBaselineMm: fontPt * 0.12,
    ...(style?.color ? { color: style.color } : {}),
  };
}
