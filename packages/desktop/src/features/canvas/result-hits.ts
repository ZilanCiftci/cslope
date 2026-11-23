/**
 * What a press in the result view takes: the paper annotations (text,
 * material table, colour bar, plot) by their drawn box, the reference
 * annotations by their handles and lines. The selection is hit first, so
 * a selected object is dragged (or gets the menu) wherever another object
 * lies over it; elsewhere the topmost object wins, as drawn.
 */

import type { Annotation, AppState } from "../../store/types";
import { annotationsInLayerOrder } from "../results/layers";
import { SCREEN_PAPER_BOTTOM_RESERVE_PX } from "../../constants";
import { computePaperFrame, getAnnotationBoundsPx } from "./helpers";
import { findReferencePartsAt } from "./reference-geometry";
import type { PointHit } from "./types";

type ClientRect = { left: number; top: number; width: number; height: number };

/** Distance (px) from a paper annotation's anchor that hits it when there is no result to measure its box by. */
const ANCHOR_HIT_PX = 15;

/**
 * The topmost paper annotation under the pointer, by its drawn box (its
 * anchor within 15 px when there is no result or no context to measure
 * it); with `only`, of those annotations alone.
 */
export function findPaperAnnotationAt(
  ctx: CanvasRenderingContext2D | null,
  state: AppState,
  rect: ClientRect,
  clientX: number,
  clientY: number,
  only?: readonly string[],
): Annotation | null {
  const frame = state.resultViewSettings.paperFrame;
  const pf = computePaperFrame(
    rect.width,
    rect.height,
    frame.paperSize,
    frame.landscape,
    frame.zoom ?? 1,
    frame.offsetX ?? 0,
    frame.offsetY ?? 0,
    SCREEN_PAPER_BOTTOM_RESERVE_PX,
  );
  const cxPx = clientX - rect.left;
  const cyPx = clientY - rect.top;
  // In the order they are drawn (Properties › Layers): the topmost is hit first.
  const annos = annotationsInLayerOrder(state);
  for (let i = annos.length - 1; i >= 0; i--) {
    const a = annos[i];
    // Reference annotations are hit by their handles and lines.
    if (a.type === "reference" || (only && !only.includes(a.id))) continue;
    if (ctx && state.result) {
      const b = getAnnotationBoundsPx(ctx, {
        annotation: a,
        paperFrame: pf,
        paper: frame,
        result: state.result,
        materials: state.materials,
        piezometricLine: state.piezometricLine,
        projectInfo: state.projectInfo,
        parameters: state.parameters,
        resultView: state.resultViewSettings,
      });
      if (cxPx >= b.x && cxPx <= b.x + b.w && cyPx >= b.y && cyPx <= b.y + b.h) return a;
    } else if (Math.hypot(cxPx - (pf.x + a.x * pf.w), cyPx - (pf.y + a.y * pf.h)) < ANCHOR_HIT_PX) {
      return a;
    }
  }
  return null;
}

/** The annotation a result-view hit names. */
export function resultHitId(hit: PointHit | null): string | null {
  if (!hit) return null;
  switch (hit.kind) {
    case "annotation":
      return hit.annoId;
    case "referenceVertex":
    case "referenceCircle":
    case "referenceLine":
      return hit.annoId;
    default:
      return null;
  }
}

/**
 * The object under the pointer in the result view. The selected objects
 * first: a handle of a selected reference annotation (drawn on top of
 * everything), then a selected paper annotation, then a selected
 * reference line or rim. Then the others as drawn: a paper annotation
 * (over the model), then a reference handle, line or rim.
 * `preferSelected` false skips the first step (a press with Ctrl or
 * Shift, which changes the selection, takes the topmost object).
 */
export function findResultHitAt(
  ctx: CanvasRenderingContext2D | null,
  state: AppState,
  rect: ClientRect,
  clientX: number,
  clientY: number,
  selectedIds: readonly string[],
  preferSelected = true,
): PointHit | null {
  if (preferSelected && selectedIds.length > 0) {
    const ref = findReferencePartsAt(state, rect, clientX, clientY, selectedIds);
    if (ref.handle) return ref.handle;
    const paper = findPaperAnnotationAt(ctx, state, rect, clientX, clientY, selectedIds);
    if (paper) return { kind: "annotation", annoId: paper.id };
    if (ref.line) return ref.line;
  }
  const paper = findPaperAnnotationAt(ctx, state, rect, clientX, clientY);
  if (paper) return { kind: "annotation", annoId: paper.id };
  const ref = findReferencePartsAt(state, rect, clientX, clientY);
  return ref.handle ?? ref.line;
}
