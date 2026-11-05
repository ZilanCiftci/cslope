/**
 * The canvas's snapping to the placed drawings: the visible placements of
 * the view (in the result view those shown in results) with line work,
 * when snapping is on (the status bar's Snap).
 */
import type { BackgroundImage } from "../../store/types";
import { SNAP_THRESHOLD } from "../canvas/constants";
import { snapSourceFor } from "./drawing-cache";
import { snapToDrawings, type DrawingSnap, type SnapSource } from "./snap";

/** The snap sources of the placements a view shows. */
export function viewSnapSources(backgrounds: readonly BackgroundImage[], mode: "edit" | "result"): SnapSource[] {
  const out: SnapSource[] = [];
  for (const b of backgrounds) {
    if (!b.visible || b.opacity <= 0 || (mode === "result" && b.showInResults !== true)) continue;
    const s = snapSourceFor(b);
    if (s) out.push(s);
  }
  return out;
}

/** The snap to the drawings at a model point, within the snap distance (px) at `viewScale` (px per m). */
export function drawingSnapAt(
  state: { backgrounds: readonly BackgroundImage[]; snapToGrid: boolean },
  mode: "edit" | "result",
  wx: number,
  wy: number,
  viewScale: number,
): DrawingSnap | null {
  if (!state.snapToGrid || state.backgrounds.length === 0 || !(viewScale > 0)) return null;
  const sources = viewSnapSources(state.backgrounds, mode);
  if (sources.length === 0) return null;
  return snapToDrawings(sources, wx, wy, SNAP_THRESHOLD / viewScale);
}

/** What the canvas shows where a point snapped: a square at an end point, an X at an intersection, a line along a line. */
export interface SnapMarker {
  /** Canvas px. */
  x: number;
  y: number;
  kind: DrawingSnap["kind"];
  /** "line": the angle of the line on the canvas (radians). */
  angle?: number;
}
