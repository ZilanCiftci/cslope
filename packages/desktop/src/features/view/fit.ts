/**
 * View-lock fitting helpers.
 *
 * Computes the scale and offset needed to map a world-space bounding box
 * (ViewLock) into a screen-space inner plotting frame, centered within a
 * canvas of known dimensions.
 */

import type { Rect } from "./paper";

export interface ViewLockBounds {
  bottomLeft: [number, number];
  topRight: [number, number];
}

export interface ViewFitResult {
  scale: number;
  offset: [number, number];
}

/**
 * Compute the view scale and offset that fits a world-space ViewLock rectangle
 * into a screen-space inner frame, centred within a canvas of the given size.
 *
 * Returns `null` when the inputs are degenerate (zero-sized world or frame).
 */
export function computeViewLockFit(
  innerFrame: Rect,
  viewLock: ViewLockBounds,
  canvasW: number,
  canvasH: number,
): ViewFitResult | null {
  const worldW = viewLock.topRight[0] - viewLock.bottomLeft[0];
  const worldH = viewLock.topRight[1] - viewLock.bottomLeft[1];

  if (worldW <= 0 || worldH <= 0 || innerFrame.w <= 0 || innerFrame.h <= 0) {
    return null;
  }

  const scale = Math.min(innerFrame.w / worldW, innerFrame.h / worldH);
  const worldCx = (viewLock.bottomLeft[0] + viewLock.topRight[0]) / 2;
  const worldCy = (viewLock.bottomLeft[1] + viewLock.topRight[1]) / 2;
  const targetCx = innerFrame.x + innerFrame.w / 2;
  const targetCy = innerFrame.y + innerFrame.h / 2;

  const ox = (targetCx - canvasW / 2) / scale - worldCx;
  const oy = (canvasH / 2 - targetCy) / scale - worldCy;

  return { scale, offset: [ox, oy] };
}
