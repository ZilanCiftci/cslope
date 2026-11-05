/**
 * Moving one handle of a canvas object to a position: a drag, a nudge
 * with the arrow keys, or coordinates typed in the point editor all end
 * here. An axis driven by a parameter expression stays where the
 * expression puts it (otherwise the next parameter edit would snap the
 * point back).
 */

import type { AppState, CanvasObjectRef, CanvasPointKey } from "../../store/types";
import { MIN_CUSTOM_CIRCLE_RADIUS } from "./custom-plane-geometry";

type Pt = [number, number];

/** The store actions a handle move calls. */
export type HandleActions = Pick<
  AppState,
  | "setCoordinate"
  | "updateBoundaryPoint"
  | "setPiezoCoordinate"
  | "setActivePiezoLine"
  | "updateUdl"
  | "updateLineLoad"
  | "setAnalysisLimits"
  | "updateCustomSearchPlane"
  | "updateCustomPlanePoint"
  | "updateReinforcement"
  | "updatePile"
>;

/** What a handle move reads. */
export type HandleState = Pick<
  AppState,
  | "coordinates"
  | "coordinateExpressions"
  | "materialBoundaries"
  | "piezometricLine"
  | "udls"
  | "lineLoads"
  | "reinforcements"
  | "piles"
  | "customSearchPlanes"
  | "analysisLimits"
>;

/** The axes of a handle a move can change: both, x only (loads, limits), or the radius. */
export type HandleAxes = "xy" | "x" | "radius";

export function handleAxes(object: CanvasObjectRef, point: CanvasPointKey): HandleAxes {
  if (point === "rim") return "radius";
  if (object.type === "udl" || object.type === "lineLoad" || object.type === "searchLimits") return "x";
  return "xy";
}

/** The position of a handle (a rim: its point on the right of the centre), or null. */
export function handlePosition(
  st: HandleState,
  object: CanvasObjectRef,
  point: CanvasPointKey,
  groundY: (x: number) => number | null,
): Pt | null {
  const atGround = (x: number): Pt => [x, groundY(x) ?? 0];
  switch (object.type) {
    case "exterior":
      return typeof point === "number" ? (st.coordinates[point] ?? null) : null;
    case "boundary":
      return typeof point === "number" ? (st.materialBoundaries.find((b) => b.id === object.id)?.coordinates[point] ?? null) : null;
    case "waterLine":
      return typeof point === "number" ? (st.piezometricLine.lines.find((l) => l.id === object.id)?.coordinates[point] ?? null) : null;
    case "searchLimits":
      return point === "entryLeftX" || point === "entryRightX" || point === "exitLeftX" || point === "exitRightX"
        ? atGround(st.analysisLimits[point])
        : null;
    case "udl": {
      const u = st.udls.find((x) => x.id === object.id);
      return u && (point === "x1" || point === "x2") ? atGround(u[point]) : null;
    }
    case "lineLoad": {
      const l = st.lineLoads.find((x) => x.id === object.id);
      if (!l) return null;
      return l.angle && Number.isFinite(l.y) ? [l.x, l.y!] : atGround(l.x);
    }
    case "reinforcement":
    case "pile": {
      const list = object.type === "pile" ? st.piles : st.reinforcements;
      const r = list.find((x) => x.id === object.id);
      if (!r) return null;
      return point === "end1" ? [r.x1, r.y1] : point === "end2" ? [r.x2, r.y2] : null;
    }
    case "customPlane": {
      const p = st.customSearchPlanes.find((x) => x.id === object.id);
      if (!p) return null;
      if (p.points) return typeof point === "number" ? (p.points[point] ?? null) : null;
      return point === "centre" ? [p.cx, p.cy] : point === "rim" ? [p.cx + p.radius, p.cy] : null;
    }
  }
}

/** The new point, keeping an axis an expression drives. */
function keepAxes(current: Pt | undefined, expr: { x?: string; y?: string } | undefined, [x, y]: Pt): Pt {
  return [current && expr?.x?.trim() ? current[0] : x, current && expr?.y?.trim() ? current[1] : y];
}

/**
 * Move a handle to `to` (world): a vertex, an end of a load or element,
 * a limit, a circle's centre; for a rim the radius becomes the distance
 * from the centre. Returns false when nothing could be moved.
 */
export function moveHandleTo(
  st: HandleState,
  a: HandleActions,
  object: CanvasObjectRef,
  point: CanvasPointKey,
  to: Pt,
): boolean {
  const [x, y] = to;
  switch (object.type) {
    case "exterior": {
      if (typeof point !== "number" || !st.coordinates[point]) return false;
      a.setCoordinate(point, keepAxes(st.coordinates[point], st.coordinateExpressions[point], to));
      return true;
    }
    case "boundary": {
      const b = st.materialBoundaries.find((m) => m.id === object.id);
      if (!b || typeof point !== "number" || !b.coordinates[point]) return false;
      a.updateBoundaryPoint(b.id, point, keepAxes(b.coordinates[point], b.coordinateExpressions?.[point], to));
      return true;
    }
    case "waterLine": {
      const line = st.piezometricLine.lines.find((l) => l.id === object.id);
      if (!line || typeof point !== "number" || !line.coordinates[point]) return false;
      // The store moves points of the active line.
      if (st.piezometricLine.activeLineId !== line.id) a.setActivePiezoLine(line.id);
      a.setPiezoCoordinate(point, keepAxes(line.coordinates[point], line.coordinateExpressions?.[point], to));
      return true;
    }
    case "searchLimits":
      if (point !== "entryLeftX" && point !== "entryRightX" && point !== "exitLeftX" && point !== "exitRightX") return false;
      a.setAnalysisLimits({ [point]: x });
      return true;
    case "udl": {
      const u = st.udls.find((v) => v.id === object.id);
      if (!u || (point !== "x1" && point !== "x2") || u.expressions?.[point]?.trim()) return false;
      a.updateUdl(u.id, { [point]: x });
      return true;
    }
    case "lineLoad": {
      const l = st.lineLoads.find((v) => v.id === object.id);
      if (!l || l.expressions?.x?.trim()) return false;
      a.updateLineLoad(l.id, { x });
      return true;
    }
    case "reinforcement":
    case "pile": {
      if (point !== "end1" && point !== "end2") return false;
      const patch = point === "end1" ? { x1: x, y1: y } : { x2: x, y2: y };
      if (object.type === "pile") a.updatePile(object.id, patch);
      else a.updateReinforcement(object.id, patch);
      return true;
    }
    case "customPlane": {
      const p = st.customSearchPlanes.find((v) => v.id === object.id);
      if (!p) return false;
      if (p.points) {
        if (typeof point !== "number" || !p.points[point]) return false;
        a.updateCustomPlanePoint(p.id, point, to);
        return true;
      }
      if (point === "centre") a.updateCustomSearchPlane(p.id, { cx: x, cy: y });
      else if (point === "rim") a.updateCustomSearchPlane(p.id, { radius: Math.max(MIN_CUSTOM_CIRCLE_RADIUS, Math.hypot(x - p.cx, y - p.cy)) });
      else return false;
      return true;
    }
  }
}

/**
 * Nudge a handle by (dx, dy) world units: along x only for loads and
 * limits; a rim's radius grows to the right and up.
 */
export function nudgeHandle(
  st: HandleState,
  a: HandleActions,
  object: CanvasObjectRef,
  point: CanvasPointKey,
  dx: number,
  dy: number,
  groundY: (x: number) => number | null,
): boolean {
  const axes = handleAxes(object, point);
  if (axes === "radius") {
    const p = st.customSearchPlanes.find((v) => v.id === (object as { id: string }).id);
    if (!p || p.points) return false;
    const dr = dx !== 0 ? dx : dy;
    a.updateCustomSearchPlane(p.id, { radius: Math.max(MIN_CUSTOM_CIRCLE_RADIUS, p.radius + dr) });
    return true;
  }
  if (axes === "x" && dx === 0) return false;
  const at = handlePosition(st, object, point, groundY);
  if (!at) return false;
  return moveHandleTo(st, a, object, point, [at[0] + dx, at[1] + (axes === "x" ? 0 : dy)]);
}
