import type { AnchorPosition } from "../../store/types";

/**
 * Compute the top-left draw position given the anchor point and content dimensions.
 * The anchor point (ax, ay) is where the specified corner of the content is pinned.
 */
export function anchoredTopLeft(
  ax: number,
  ay: number,
  contentW: number,
  contentH: number,
  anchor: AnchorPosition | undefined,
): { x: number; y: number } {
  const a = anchor ?? "top-left";
  return {
    x: a === "top-right" || a === "bottom-right" ? ax - contentW : ax,
    y: a === "bottom-left" || a === "bottom-right" ? ay - contentH : ay,
  };
}

/**
 * Inverse of anchoredTopLeft: given the top-left position and content dimensions,
 * compute the anchor point for the specified anchor corner.
 */
export function anchorPointFromTopLeft(
  tlx: number,
  tly: number,
  contentW: number,
  contentH: number,
  anchor: AnchorPosition | undefined,
): { x: number; y: number } {
  const a = anchor ?? "top-left";
  return {
    x: a === "top-right" || a === "bottom-right" ? tlx + contentW : tlx,
    y: a === "bottom-left" || a === "bottom-right" ? tly + contentH : tly,
  };
}
