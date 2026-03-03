/**
 * Shared paper/frame geometry helpers.
 *
 * Single source of truth for:
 *  - resolved paper dimensions (mm) for a given size + orientation
 *  - paper frame rectangle (centered pixel rect with margin)
 *  - inner plotting frame (inset by percentage margins)
 *  - plot aspect ratio
 */

import type { PaperSize } from "../../store/types";
import { PAPER_DIMENSIONS, PLOT_MARGINS } from "../../store/defaults";
import { PAPER_FRAME_MARGIN_PX } from "../../constants";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Resolve paper dimensions in mm for a given size and orientation.
 */
export function getPaperDimensions(
  paperSize: PaperSize,
  landscape: boolean,
): { width: number; height: number } {
  const { w, h } = PAPER_DIMENSIONS[paperSize];
  return {
    width: landscape ? Math.max(w, h) : Math.min(w, h),
    height: landscape ? Math.min(w, h) : Math.max(w, h),
  };
}

/**
 * Compute the paper frame rectangle (centered, with margin) given canvas CSS size.
 *
 * Used by both the canvas renderer and the PDF exporter (via a virtual canvas).
 */
export function computePaperFrame(
  canvasW: number,
  canvasH: number,
  paperSize: PaperSize,
  landscape = true,
): Rect {
  const { width: pw, height: ph } = getPaperDimensions(paperSize, landscape);
  const paperAspect = pw / ph;
  const margin = PAPER_FRAME_MARGIN_PX;
  const availW = canvasW - margin * 2;
  const availH = canvasH - margin * 2;
  let frameW: number;
  let frameH: number;
  if (availW / availH > paperAspect) {
    // Canvas is wider than paper — fit height
    frameH = availH;
    frameW = frameH * paperAspect;
  } else {
    // Canvas is taller — fit width
    frameW = availW;
    frameH = frameW / paperAspect;
  }
  const x = (canvasW - frameW) / 2;
  const y = (canvasH - frameH) / 2;
  return { x, y, w: frameW, h: frameH };
}

/**
 * Compute the inner plotting frame within a paper frame, inset by percentage margins.
 *
 * L/R margins are computed as fractions of frame width;
 * T/B margins are computed as fractions of frame height.
 */
export function computeInnerFrame(
  frame: Rect,
  margins: { L: number; R: number; T: number; B: number } = PLOT_MARGINS,
): Rect {
  const padL = frame.w * margins.L;
  const padR = frame.w * margins.R;
  const padT = frame.h * margins.T;
  const padB = frame.h * margins.B;
  return {
    x: frame.x + padL,
    y: frame.y + padT,
    w: frame.w - padL - padR,
    h: frame.h - padT - padB,
  };
}

/**
 * Compute the aspect ratio of the inner plot area for the given paper size,
 * orientation, and margins.
 */
export function getPlotAspectRatio(
  paperSize: PaperSize,
  landscape: boolean,
  margins: { L: number; R: number; T: number; B: number } = PLOT_MARGINS,
): number {
  const { width, height } = getPaperDimensions(paperSize, landscape);
  const plotW = width * (1 - margins.L - margins.R);
  const plotH = height * (1 - margins.T - margins.B);
  return plotW / plotH;
}
