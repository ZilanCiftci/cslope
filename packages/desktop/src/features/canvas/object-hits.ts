/**
 * What is under the pointer on the edit canvas: every selectable object
 * there, with the handle under the pointer when there is one. Pure
 * functions over canvas pixels.
 */

import type { AppState, CanvasObjectRef, CanvasPointKey } from "../../store/types";
import type { CanvasObjectsState } from "../../store/canvas-selection";
import { EDGE_THRESHOLD, SNAP_THRESHOLD } from "./constants";
import { loadArrowLifts } from "./overlay-geometry";
import { lineLoadArrow } from "../rendering/overlay-layout";
import { distanceToSegment } from "./label-layout";
import { projectOnSegment } from "./custom-plane-geometry";
import type { EdgeHit, LimitHandle, PointHit } from "./types";

type Pt = [number, number];
type ToPx = (wx: number, wy: number) => Pt;

/** An object under the pointer, with its handle there (null: its line or area). */
export interface CanvasCandidate {
  object: CanvasObjectRef;
  point: CanvasPointKey | null;
}

/** What the hit test reads: the model's objects and the ground. */
export type ObjectHitState = CanvasObjectsState & Pick<AppState, "customSearchPlanes">;

const LIMIT_HANDLES: LimitHandle[] = ["entryLeftX", "entryRightX", "exitLeftX", "exitRightX"];

/** Handles and lines win over areas; small objects drawn on top over the long lines under them. */
const TYPE_ORDER: CanvasObjectRef["type"][] = [
  "searchLimits",
  "udl",
  "lineLoad",
  "reinforcement",
  "pile",
  "customPlane",
  "waterLine",
  "boundary",
  "exterior",
];

const near = (a: Pt, mx: number, my: number, r: number) => Math.hypot(a[0] - mx, a[1] - my) < r;

/** The index of the vertex within `r` px nearest the pointer, or -1. */
function nearestVertex(pts: Pt[], mx: number, my: number, r: number): number {
  let best = -1;
  let bestD = r;
  pts.forEach(([x, y], i) => {
    const d = Math.hypot(x - mx, y - my);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** True when the pointer is within `r` px of the polyline (closed: also its closing edge). */
function onPolyline(pts: Pt[], mx: number, my: number, r: number, closed = false): boolean {
  const n = pts.length;
  for (let i = 0; i + 1 < n + (closed ? 1 : 0); i++) {
    if (distanceToSegment(mx, my, pts[i], pts[(i + 1) % n]) < r) return true;
  }
  return false;
}

/**
 * The objects under the pointer (canvas px `mx`, `my`), topmost first:
 * those with a handle there before those touched by their line or area,
 * each once.
 */
export function findCanvasObjectsAt(
  state: ObjectHitState,
  mx: number,
  my: number,
  toPx: ToPx,
  surfaceYAtX: (x: number) => number | null,
): CanvasCandidate[] {
  const handles: CanvasCandidate[] = [];
  const bodies: CanvasCandidate[] = [];
  const add = (object: CanvasObjectRef, point: CanvasPointKey | null) =>
    (point === null ? bodies : handles).push({ object, point });

  const polylineObject = (object: CanvasObjectRef, coords: Pt[], closed: boolean) => {
    if (coords.length === 0) return;
    const pts = coords.map(([x, y]) => toPx(x, y));
    const v = nearestVertex(pts, mx, my, SNAP_THRESHOLD);
    if (v >= 0) add(object, v);
    else if (onPolyline(pts, mx, my, EDGE_THRESHOLD, closed)) add(object, null);
  };

  polylineObject({ type: "exterior" }, state.coordinates, true);
  for (const b of state.materialBoundaries) polylineObject({ type: "boundary", id: b.id }, b.coordinates, false);
  for (const l of state.piezometricLine.lines) polylineObject({ type: "waterLine", id: l.id }, l.coordinates, false);

  // Search limits: the four markers on the ground.
  if (state.analysisLimits.enabled && state.coordinates.length >= 3) {
    let best: LimitHandle | null = null;
    let bestD = SNAP_THRESHOLD + 4;
    for (const h of LIMIT_HANDLES) {
      const x = state.analysisLimits[h];
      const y = surfaceYAtX(x);
      if (y === null) continue;
      const [px, py] = toPx(x, y);
      const d = Math.hypot(px - mx, py - my);
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best) add({ type: "searchLimits" }, best);
  }

  // Loads, with the arrow heights as drawn (they follow the magnitude).
  if (state.coordinates.length >= 3 && (state.udls.length > 0 || state.lineLoads.length > 0)) {
    const lifts = loadArrowLifts(state.udls, state.lineLoads, surfaceYAtX);
    // An arrow between touching strips is as tall as the taller one.
    const edgeLift = (x: number) =>
      Math.max(
        0,
        ...state.udls
          .filter((o) => Math.abs(o.x1 - x) <= 1e-9 || Math.abs(o.x2 - x) <= 1e-9)
          .map((o) => lifts.udl.get(o.id) ?? 0),
      );
    for (const u of state.udls) {
      if (!lifts.udl.has(u.id)) continue;
      const object: CanvasObjectRef = { type: "udl", id: u.id };
      let handle: "x1" | "x2" | null = null;
      for (const h of ["x1", "x2"] as const) {
        const gy = surfaceYAtX(u[h]);
        if (gy === null) continue;
        const [px, py] = toPx(u[h], gy);
        if (Math.abs(px - mx) < SNAP_THRESHOLD + 4 && my >= py - edgeLift(u[h]) - 4 && my <= py + 4) {
          handle = h;
          break;
        }
      }
      if (handle) {
        add(object, handle);
        continue;
      }
      // The loaded strip: between its ends, from the ground up to its top.
      const lo = Math.min(u.x1, u.x2);
      const hi = Math.max(u.x1, u.x2);
      const [pxLo] = toPx(lo, 0);
      const [pxHi] = toPx(hi, 0);
      if (mx < Math.min(pxLo, pxHi) || mx > Math.max(pxLo, pxHi)) continue;
      const wx = lo + ((mx - pxLo) / (pxHi - pxLo || 1)) * (hi - lo);
      const gy = surfaceYAtX(wx);
      if (gy === null) continue;
      const [, py] = toPx(wx, gy);
      const lift = lifts.udl.get(u.id) ?? 0;
      if (my >= py - lift - 4 && my <= py + 4) add(object, null);
    }
    for (const ll of state.lineLoads) {
      const arrow = lineLoadArrow(ll, toPx, surfaceYAtX, lifts.lineLoad.get(ll.id) ?? 0);
      if (!arrow) continue;
      const [tx, ty] = arrow.tail;
      const [hx, hy] = arrow.tip;
      const hit = arrow.inclined
        ? distanceToSegment(mx, my, [tx, ty], [hx, hy]) < SNAP_THRESHOLD + 4
        : Math.abs(hx - mx) < SNAP_THRESHOLD + 4 && my >= ty - 4 && my <= hy + 4;
      // The arrow is the load: a press anywhere on it takes its point.
      if (hit) add({ type: "lineLoad", id: ll.id }, "x");
    }
  }

  // Reinforcement and piles: their ends are handles, their lines the body.
  const element = (object: CanvasObjectRef, r: { x1: number; y1: number; x2: number; y2: number }) => {
    const a = toPx(r.x1, r.y1);
    const b = toPx(r.x2, r.y2);
    if (near(a, mx, my, SNAP_THRESHOLD)) add(object, "end1");
    else if (near(b, mx, my, SNAP_THRESHOLD)) add(object, "end2");
    else if (distanceToSegment(mx, my, a, b) < EDGE_THRESHOLD) add(object, null);
  };
  for (const r of state.reinforcements) element({ type: "reinforcement", id: r.id }, r);
  for (const p of state.piles) element({ type: "pile", id: p.id }, p);

  // Custom search planes: a polyline's vertices and segments, a circle's
  // centre and rim (a drag on the rim sets the radius).
  for (const p of state.customSearchPlanes) {
    const object: CanvasObjectRef = { type: "customPlane", id: p.id };
    if (p.points) {
      polylineObject(object, p.points, false);
      continue;
    }
    const c = toPx(p.cx, p.cy);
    if (near(c, mx, my, SNAP_THRESHOLD)) {
      add(object, "centre");
      continue;
    }
    if (!(p.radius > 0)) continue;
    const [ex] = toPx(p.cx + p.radius, p.cy);
    const rPx = Math.abs(ex - c[0]);
    if (Math.abs(Math.hypot(c[0] - mx, c[1] - my) - rPx) < EDGE_THRESHOLD) add(object, "rim");
  }

  const rank = (c: CanvasCandidate) => TYPE_ORDER.indexOf(c.object.type);
  return [...handles.sort((a, b) => rank(a) - rank(b)), ...bodies.sort((a, b) => rank(a) - rank(b))];
}

/** True when a drag on the object's line or area moves it whole: loads and custom surfaces. */
export function bodyDraggable(object: CanvasObjectRef): boolean {
  return object.type === "udl" || object.type === "lineLoad" || object.type === "customPlane";
}

/** The drag a press on a handle (or the body, `point` null) of an object starts, or null. */
export function dragHitOf(state: ObjectHitState, object: CanvasObjectRef, point: CanvasPointKey | null): PointHit | null {
  switch (object.type) {
    case "exterior":
      return typeof point === "number" ? { kind: "external", index: point } : null;
    case "boundary":
      return typeof point === "number" ? { kind: "boundary", boundaryId: object.id, pointIndex: point } : null;
    case "waterLine":
      return typeof point === "number" ? { kind: "piezo", lineId: object.id, index: point } : null;
    case "searchLimits":
      return point !== null && (LIMIT_HANDLES as CanvasPointKey[]).includes(point) ? { kind: "limit", handle: point as LimitHandle } : null;
    case "udl":
      if (point === "x1" || point === "x2") return { kind: "udl", udlId: object.id, handle: point };
      return point === null ? { kind: "udlBody", udlId: object.id } : null;
    case "lineLoad":
      return { kind: "lineLoad", loadId: object.id };
    case "reinforcement":
    case "pile":
      return point === "end1" || point === "end2"
        ? { kind: "elementEnd", element: object.type, id: object.id, end: point }
        : null;
    case "customPlane": {
      const plane = state.customSearchPlanes.find((p) => p.id === object.id);
      if (!plane) return null;
      if (plane.points) {
        if (typeof point === "number") return { kind: "customVertex", planeId: object.id, pointIndex: point };
        return point === null ? { kind: "customPlaneBody", planeId: object.id } : null;
      }
      return point === "centre" || point === "rim" ? { kind: "customCircle", planeId: object.id, handle: point } : null;
    }
  }
}

/**
 * Where a point would be added on the object's line under the pointer
 * (exterior, boundary, water line, custom polyline), snapped; null when
 * the pointer is not on a segment of it.
 */
export function edgeInsertAt(
  state: ObjectHitState,
  object: CanvasObjectRef,
  mx: number,
  my: number,
  toPx: ToPx,
  toWorld: (px: number, py: number) => Pt,
  snap: (v: number) => number,
): EdgeHit | null {
  let coords: Pt[] | undefined;
  let closed = false;
  switch (object.type) {
    case "exterior":
      coords = state.coordinates;
      closed = true;
      break;
    case "boundary":
      coords = state.materialBoundaries.find((b) => b.id === object.id)?.coordinates;
      break;
    case "waterLine":
      coords = state.piezometricLine.lines.find((l) => l.id === object.id)?.coordinates;
      break;
    case "customPlane":
      coords = state.customSearchPlanes.find((p) => p.id === object.id)?.points;
      break;
    default:
      return null;
  }
  if (!coords || coords.length < 2) return null;
  const pts = coords.map(([x, y]) => toPx(x, y));
  const n = pts.length;
  let best = -1;
  let bestD = EDGE_THRESHOLD;
  for (let i = 0; i + 1 < n + (closed ? 1 : 0); i++) {
    const d = distanceToSegment(mx, my, pts[i], pts[(i + 1) % n]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const proj = projectOnSegment(mx, my, pts[best], pts[(best + 1) % n]);
  const [wx, wy] = toWorld(proj[0], proj[1]);
  const snapPoint: Pt = [snap(wx), snap(wy)];
  const next = (best + 1) % n;
  const insertIndex = closed && next === 0 ? n : best + 1;
  switch (object.type) {
    case "exterior":
      return { kind: "external", insertIndex, snapPoint };
    case "boundary":
      return { kind: "boundary", boundaryId: object.id, insertIndex, snapPoint };
    case "waterLine":
      return { kind: "piezo", lineId: object.id, insertIndex, snapPoint };
    default:
      return { kind: "customPlane", planeId: (object as { id: string }).id, insertIndex, snapPoint };
  }
}
