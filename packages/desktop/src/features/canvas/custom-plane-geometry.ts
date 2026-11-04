/**
 * Hit testing and drag maths for the custom search planes on the edit
 * canvas: a circle's centre dot and rim, and the vertices and segments of
 * a non-circular surface. Pure functions over canvas pixels.
 */

import type { CustomSearchPlane } from "../../store/types";
import { distanceToSegment } from "./label-layout";
import type { EdgeHit, PointHit } from "./types";

/** The smallest radius a circle can be dragged to (m), as the dialog allows. */
export const MIN_CUSTOM_CIRCLE_RADIUS = 0.1;

type ToPx = (wx: number, wy: number) => [number, number];

/**
 * The handle under the pointer (canvas px): a vertex of a non-circular
 * surface or a circle's centre within `handleRadius`, else a circle's rim
 * within `rimRadius` of it. Dots beat rims, so a rim passing over another
 * circle's centre does not hide it; otherwise the first plane in the list
 * wins.
 */
export function findCustomPlaneHandle(
  planes: readonly CustomSearchPlane[],
  mx: number,
  my: number,
  toPx: ToPx,
  handleRadius: number,
  rimRadius: number,
): PointHit | null {
  for (const p of planes) {
    if (p.points) {
      for (let i = 0; i < p.points.length; i++) {
        const [px, py] = toPx(p.points[i][0], p.points[i][1]);
        if (Math.hypot(px - mx, py - my) < handleRadius) {
          return { kind: "customVertex", planeId: p.id, pointIndex: i };
        }
      }
    } else {
      const [px, py] = toPx(p.cx, p.cy);
      if (Math.hypot(px - mx, py - my) < handleRadius) {
        return { kind: "customCircle", planeId: p.id, handle: "centre" };
      }
    }
  }
  for (const p of planes) {
    if (p.points || !(p.radius > 0)) continue;
    const [px, py] = toPx(p.cx, p.cy);
    const [ex] = toPx(p.cx + p.radius, p.cy);
    const rPx = Math.abs(ex - px);
    if (Math.abs(Math.hypot(px - mx, py - my) - rPx) < rimRadius) {
      return { kind: "customCircle", planeId: p.id, handle: "rim" };
    }
  }
  return null;
}

/** The nearest segment of a non-circular surface within `maxDist` px. */
export function findCustomPlaneSegment(
  planes: readonly CustomSearchPlane[],
  mx: number,
  my: number,
  toPx: ToPx,
  maxDist: number,
): { planeId: string; insertIndex: number; dist: number; proj: [number, number] } | null {
  let best: { planeId: string; insertIndex: number; dist: number; proj: [number, number] } | null = null;
  let bestDist = maxDist;
  for (const p of planes) {
    if (!p.points) continue;
    const pts = p.points.map(([x, y]) => toPx(x, y));
    for (let i = 0; i < pts.length - 1; i++) {
      const dist = distanceToSegment(mx, my, pts[i], pts[i + 1]);
      if (dist < bestDist) {
        bestDist = dist;
        best = { planeId: p.id, insertIndex: i + 1, dist, proj: projectOnSegment(mx, my, pts[i], pts[i + 1]) };
      }
    }
  }
  return best;
}

/** The foot of the perpendicular from (x, y) onto the segment a–b, clamped to it. */
export function projectOnSegment(
  x: number,
  y: number,
  a: readonly [number, number],
  b: readonly [number, number],
): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * The radius a rim drag sets: the pointer's distance from the centre (m),
 * snapped as the grid snap does, never below MIN_CUSTOM_CIRCLE_RADIUS.
 */
export function circleRadiusFromPointer(
  cx: number,
  cy: number,
  wx: number,
  wy: number,
  snap: (v: number) => number = (v) => v,
): number {
  return Math.max(MIN_CUSTOM_CIRCLE_RADIUS, snap(Math.hypot(wx - cx, wy - cy)));
}

/** The edge hit a segment hit becomes, its insertion point snapped. */
export function customPlaneEdgeHit(
  seg: { planeId: string; insertIndex: number; proj: [number, number] },
  toWorld: (px: number, py: number) => [number, number],
  snapValue: (v: number) => number,
): EdgeHit {
  const [wx, wy] = toWorld(seg.proj[0], seg.proj[1]);
  return {
    kind: "customPlane",
    planeId: seg.planeId,
    insertIndex: seg.insertIndex,
    snapPoint: [snapValue(wx), snapValue(wy)],
  };
}

/** True when two hits name the same handle. */
export function isSameCustomPlaneHit(a: PointHit, b: PointHit): boolean {
  if (a.kind === "customCircle") {
    return b.kind === "customCircle" && a.planeId === b.planeId && a.handle === b.handle;
  }
  if (a.kind === "customVertex") {
    return b.kind === "customVertex" && a.planeId === b.planeId && a.pointIndex === b.pointIndex;
  }
  return false;
}
