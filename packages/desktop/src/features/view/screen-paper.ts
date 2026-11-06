import { SCREEN_PAPER_BOTTOM_RESERVE_PX } from "../../constants";
import type { PaperFrameSettings } from "../../store/types";
import { ANNOTATION_SCALE_DIVISOR } from "../rendering/style-spec";
import { computePaperFrame, type Rect } from "./paper";

/**
 * The sheet on the result canvas (CSS px), as drawCanvas lays it out, with
 * the canvas's box; undefined without a canvas (tests, other windows).
 */
export function screenPaper(
  paperFrame: Pick<PaperFrameSettings, "paperSize" | "landscape" | "zoom" | "offsetX" | "offsetY">,
): { rect: DOMRect; pf: Rect } | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.querySelector<HTMLCanvasElement>("[data-testid='slope-canvas']");
  if (!canvas) return undefined;
  const rect = canvas.getBoundingClientRect();
  const pf = computePaperFrame(
    rect.width,
    rect.height,
    paperFrame.paperSize,
    paperFrame.landscape,
    paperFrame.zoom ?? 1,
    paperFrame.offsetX ?? 0,
    paperFrame.offsetY ?? 0,
    SCREEN_PAPER_BOTTOM_RESERVE_PX,
  );
  return { rect, pf };
}

/**
 * The scale of the sheet's annotations on screen (px per annotation px, as
 * drawCanvas's annoScale), or undefined without a canvas.
 */
export function screenSheetScale(
  paperFrame: Pick<PaperFrameSettings, "paperSize" | "landscape" | "zoom" | "offsetX" | "offsetY">,
): number | undefined {
  const pf = screenPaper(paperFrame)?.pf;
  const scale = pf ? Math.min(pf.w, pf.h) / ANNOTATION_SCALE_DIVISOR : 0;
  return scale > 0 ? scale : undefined;
}
