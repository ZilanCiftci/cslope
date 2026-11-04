/**
 * Hit testing for the reference annotations on the result canvas: a
 * polyline's vertices, line and segments, a circle's centre and arc. Pure
 * functions over canvas pixels, like custom-plane-geometry.ts for the
 * custom search planes.
 */

import type { Annotation, ReferenceAnnotation } from "../../store/types";
import { isReferenceAnnotation, referenceWorldPoints, type GroundYAt } from "../annotations/reference";
import { surfaceYAtX } from "../view/surface";
import { distanceToSegment } from "./label-layout";
import { projectOnSegment } from "./custom-plane-geometry";
import type { EdgeHit, PointHit } from "./types";

type ToPx = (wx: number, wy: number) => [number, number];

/**
 * The pixel transform of the result view as the store holds it (the
 * viewport hooks compute the same): the canvas centre is the world origin
 * shifted by the offset, y up.
 */
export function resultToPx(
  view: { resultViewScale: number; resultViewOffset: [number, number] },
  w: number,
  h: number,
): ToPx {
  const s = view.resultViewScale;
  const [ox, oy] = view.resultViewOffset;
  return (wx, wy) => [w / 2 + (wx + ox) * s, h / 2 - (wy + oy) * s];
}

/**
 * The handle under the pointer: a polyline's vertex or a circle's centre
 * within `handleRadius` px. The last annotation in the list (drawn on
 * top) wins.
 */
export function findReferenceHandle(
  annos: readonly ReferenceAnnotation[],
  mx: number,
  my: number,
  toPx: ToPx,
  handleRadius: number,
): PointHit | null {
  for (let k = annos.length - 1; k >= 0; k--) {
    const a = annos[k];
    if (a.shape === "polyline") {
      for (let i = 0; i < a.points.length; i++) {
        const [px, py] = toPx(a.points[i][0], a.points[i][1]);
        if (Math.hypot(px - mx, py - my) < handleRadius) {
          return { kind: "referenceVertex", annoId: a.id, pointIndex: i };
        }
      }
    } else {
      const [px, py] = toPx(a.cx, a.cy);
      if (Math.hypot(px - mx, py - my) < handleRadius) {
        return { kind: "referenceCircle", annoId: a.id, handle: "centre" };
      }
    }
  }
  return null;
}

/**
 * The line under the pointer within `maxDist` px of what is drawn: a
 * polyline (hit on its line) or a circle's arc (its rim). The last in
 * the list wins.
 */
export function findReferenceLine(
  annos: readonly ReferenceAnnotation[],
  mx: number,
  my: number,
  toPx: ToPx,
  maxDist: number,
  groundYAt: GroundYAt,
): PointHit | null {
  for (let k = annos.length - 1; k >= 0; k--) {
    const a = annos[k];
    const pts = referenceWorldPoints(a, groundYAt).map(([x, y]) => toPx(x, y));
    for (let i = 1; i < pts.length; i++) {
      if (distanceToSegment(mx, my, pts[i - 1], pts[i]) < maxDist) {
        return a.shape === "circle"
          ? { kind: "referenceCircle", annoId: a.id, handle: "rim" }
          : { kind: "referenceLine", annoId: a.id };
      }
    }
  }
  return null;
}

/** The nearest segment of a reference polyline within `maxDist` px. */
export function findReferenceSegment(
  annos: readonly ReferenceAnnotation[],
  mx: number,
  my: number,
  toPx: ToPx,
  maxDist: number,
): { annoId: string; insertIndex: number; dist: number; proj: [number, number] } | null {
  let best: { annoId: string; insertIndex: number; dist: number; proj: [number, number] } | null = null;
  let bestDist = maxDist;
  for (const a of annos) {
    if (a.shape !== "polyline") continue;
    const pts = a.points.map(([x, y]) => toPx(x, y));
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = distanceToSegment(mx, my, pts[i], pts[i + 1]);
      if (dist < bestDist) {
        bestDist = dist;
        best = { annoId: a.id, insertIndex: i + 1, dist, proj: projectOnSegment(mx, my, pts[i], pts[i + 1]) };
      }
    }
  }
  return best;
}

/** The edge hit a segment hit becomes, its insertion point snapped. */
export function referenceEdgeHit(
  seg: { annoId: string; insertIndex: number; proj: [number, number] },
  toWorld: (px: number, py: number) => [number, number],
  snapValue: (v: number) => number,
): EdgeHit {
  const [wx, wy] = toWorld(seg.proj[0], seg.proj[1]);
  return { kind: "reference", annoId: seg.annoId, insertIndex: seg.insertIndex, snapPoint: [snapValue(wx), snapValue(wy)] };
}

/** True when two hits name the same reference handle or line. */
export function isSameReferenceHit(a: PointHit, b: PointHit): boolean {
  if (a.kind === "referenceVertex") {
    return b.kind === "referenceVertex" && a.annoId === b.annoId && a.pointIndex === b.pointIndex;
  }
  if (a.kind === "referenceCircle") {
    return b.kind === "referenceCircle" && a.annoId === b.annoId && a.handle === b.handle;
  }
  if (a.kind === "referenceLine") return b.kind === "referenceLine" && a.annoId === b.annoId;
  return false;
}

/** Whether a hit names a reference annotation; its id then. */
export function referenceHitId(hit: PointHit | null): string | null {
  if (!hit) return null;
  return hit.kind === "referenceVertex" || hit.kind === "referenceCircle" || hit.kind === "referenceLine" ? hit.annoId : null;
}

/** Hit radius of a vertex or centre handle (canvas px). */
export const REFERENCE_HANDLE_HIT_PX = 8;
/** Hit distance from a line or arc (canvas px). */
export const REFERENCE_LINE_HIT_PX = 6;

/** What the result-view hit test reads of the store. */
export interface ReferenceHitState {
  resultViewScale: number;
  resultViewOffset: [number, number];
  resultViewSettings: { annotations: readonly Annotation[] };
  coordinates: [number, number][];
}

type ClientRect = { left: number; top: number; width: number; height: number };

/**
 * The reference annotation under a pointer on the result canvas: a
 * handle first (a vertex, a centre), then a line or arc. `rect` is the
 * canvas's bounding rectangle and (clientX, clientY) the pointer.
 */
export function findReferenceHitAt(state: ReferenceHitState, rect: ClientRect, clientX: number, clientY: number): PointHit | null {
  const refs = state.resultViewSettings.annotations.filter(isReferenceAnnotation);
  if (refs.length === 0) return null;
  const toPx = resultToPx(state, rect.width, rect.height);
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  return (
    findReferenceHandle(refs, mx, my, toPx, REFERENCE_HANDLE_HIT_PX) ??
    findReferenceLine(refs, mx, my, toPx, REFERENCE_LINE_HIT_PX, (x) => surfaceYAtX(state.coordinates, x))
  );
}

/** The segment of a reference polyline under the pointer, as an edge hit (its insertion point snapped). */
export function findReferenceEdgeAt(
  state: ReferenceHitState,
  rect: ClientRect,
  clientX: number,
  clientY: number,
  snapValue: (v: number) => number,
): EdgeHit | null {
  const refs = state.resultViewSettings.annotations.filter(isReferenceAnnotation);
  if (refs.length === 0) return null;
  const toPx = resultToPx(state, rect.width, rect.height);
  const seg = findReferenceSegment(refs, clientX - rect.left, clientY - rect.top, toPx, REFERENCE_LINE_HIT_PX);
  if (!seg) return null;
  const s = state.resultViewScale;
  const [ox, oy] = state.resultViewOffset;
  const toWorld = (px: number, py: number): [number, number] => [(px - rect.width / 2) / s - ox, -(py - rect.height / 2) / s - oy];
  return referenceEdgeHit(seg, toWorld, snapValue);
}
