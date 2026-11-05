/**
 * Which drawing Model › Drawing › Pick lines… starts on: the topmost
 * drawing of the active model with line work (a DWG, DXF or PDF file) that
 * is shown; else why there is none, for the disabled command's tooltip.
 */
import { sortedBackgrounds } from "../../store/slices/backgroundsSlice";
import type { BackgroundImage } from "../../store/types";
import { DRAWING_MIME } from "./sources";

export type PickLinesTarget = { id: string } | { reason: string };

/** Messages of a disabled Pick lines… (also the Drawings panel's). */
export const PICK_LINES_NO_DRAWING = "Place a DWG, DXF or PDF drawing in this model first, to pick its lines";
export const PICK_LINES_HIDDEN = "Show the drawing to pick its lines";

/** A drawing file that may have line work to pick (a DWG, DXF or PDF file, not an image). */
export function mimeHasLineWork(mime: string | undefined): boolean {
  if (!mime) return false;
  const kind = DRAWING_MIME[mime];
  return kind === "vector" || kind === "pdf";
}

export function pickLinesTarget(backgrounds: readonly BackgroundImage[], mimeOf: (assetId: string) => string | undefined): PickLinesTarget {
  const withLines = sortedBackgrounds(backgrounds)
    .reverse()
    .filter((b) => mimeHasLineWork(mimeOf(b.assetId)));
  if (withLines.length === 0) return { reason: PICK_LINES_NO_DRAWING };
  const shown = withLines.find((b) => b.visible);
  return shown ? { id: shown.id } : { reason: PICK_LINES_HIDDEN };
}
