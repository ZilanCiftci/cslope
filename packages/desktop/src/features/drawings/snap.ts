/**
 * Snapping to the line work of the placed drawings, as in CAD: to an end
 * point of a line or a line–line intersection first, else to the nearest
 * point on a line, within a tolerance in model metres. Only the part of a
 * drawing inside its placement's crop counts, and only its shown layers.
 * The geometry is looked up in the drawing's segment grid (vector-index.ts)
 * around the pointer; distances are measured in the model (a placement may
 * scale x and y differently).
 */
import type { BackgroundImage } from "../../store/types";
import { apply, invert, type Pt } from "./transform";
import type { SegmentIndex } from "./vector-index";
import { hiddenLayerSet, type VectorDrawing } from "./vectors";

export type SnapKind = "endpoint" | "intersection" | "line";

export interface DrawingSnap {
  /** The model point snapped to. */
  point: Pt;
  kind: SnapKind;
  /** Distance from the pointer (m). */
  distance: number;
  placementId: string;
  /** "line": the direction of the line in the model (a unit vector). */
  direction?: Pt;
}

/** A placed drawing with line work, and its grid. */
export interface SnapSource {
  placement: Pick<BackgroundImage, "id" | "transform" | "crop" | "hiddenLayers">;
  drawing: VectorDrawing;
  index: SegmentIndex;
}

/** At most this many segments near the pointer are looked at (their intersections pairwise). */
const MAX_CANDIDATES = 400;

const inCrop = (crop: SnapSource["placement"]["crop"], u: number, v: number) =>
  !crop || (u >= crop.x0 - 1e-9 && u <= crop.x1 + 1e-9 && v >= crop.y0 - 1e-9 && v <= crop.y1 + 1e-9);

/** The source rectangle that covers the model square of half-side `tol` around (wx, wy). */
function sourceWindow(inv: ReturnType<typeof invert>, wx: number, wy: number, tol: number) {
  if (!inv) return null;
  const corners = [
    apply(inv, [wx - tol, wy - tol]),
    apply(inv, [wx + tol, wy - tol]),
    apply(inv, [wx + tol, wy + tol]),
    apply(inv, [wx - tol, wy + tol]),
  ];
  return {
    x0: Math.min(...corners.map((c) => c[0])),
    y0: Math.min(...corners.map((c) => c[1])),
    x1: Math.max(...corners.map((c) => c[0])),
    y1: Math.max(...corners.map((c) => c[1])),
  };
}

/** The intersection of segments p1p2 and p3p4 (both inclusive), or null (parallel or apart). */
export function segmentIntersection(p1: Pt, p2: Pt, p3: Pt, p4: Pt): Pt | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];
  const den = d1x * d2y - d1y * d2x;
  const scale = Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y);
  if (scale === 0 || Math.abs(den) <= 1e-12 * scale) return null;
  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / den;
  const s = ((p3[0] - p1[0]) * d1y - (p3[1] - p1[1]) * d1x) / den;
  const eps = 1e-9;
  if (t < -eps || t > 1 + eps || s < -eps || s > 1 + eps) return null;
  return [p1[0] + t * d1x, p1[1] + t * d1y];
}

/** The point of segment ab nearest p. */
export function nearestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return [a[0] + t * dx, a[1] + t * dy];
}

/**
 * The snap of the model point (wx, wy) to the drawings' line work within
 * `tol` metres: the nearest end point or intersection, else the nearest
 * point on a line; null when nothing is that close.
 */
export function snapToDrawings(sources: readonly SnapSource[], wx: number, wy: number, tol: number): DrawingSnap | null {
  let bestPoint: DrawingSnap | null = null;
  let bestLine: DrawingSnap | null = null;
  const p: Pt = [wx, wy];
  for (const { placement, drawing, index } of sources) {
    const m = placement.transform;
    const inv = invert(m);
    const win = sourceWindow(inv, wx, wy, tol);
    if (!win || !inv) continue;
    const hidden = hiddenLayerSet(drawing, placement.hiddenLayers);
    const crop = placement.crop;
    const segs: number[] = [];
    index.query(win, (s) => {
      if (segs.length >= MAX_CANDIDATES) return;
      if (hidden.size > 0 && hidden.has(drawing.paths[index.path[s]].layer)) return;
      // (only segments whose box meets the window)
      const minx = Math.min(index.x0[s], index.x1[s]);
      const maxx = Math.max(index.x0[s], index.x1[s]);
      const miny = Math.min(index.y0[s], index.y1[s]);
      const maxy = Math.max(index.y0[s], index.y1[s]);
      if (maxx < win.x0 || minx > win.x1 || maxy < win.y0 || miny > win.y1) return;
      segs.push(s);
    });
    if (segs.length === 0) continue;
    const consider = (src: Pt, kind: SnapKind, direction?: Pt) => {
      if (!inCrop(crop, src[0], src[1])) return;
      const q = apply(m, src);
      const d = Math.hypot(q[0] - wx, q[1] - wy);
      if (d > tol) return;
      if (kind === "line") {
        if (!bestLine || d < bestLine.distance) bestLine = { point: q, kind, distance: d, placementId: placement.id, direction };
      } else if (!bestPoint || d < bestPoint.distance - 1e-12 || (Math.abs(d - bestPoint.distance) <= 1e-12 && kind === "endpoint")) {
        bestPoint = { point: q, kind, distance: d, placementId: placement.id };
      }
    };
    const A = (s: number): Pt => [index.x0[s], index.y0[s]];
    const B = (s: number): Pt => [index.x1[s], index.y1[s]];
    for (const s of segs) {
      consider(A(s), "endpoint");
      consider(B(s), "endpoint");
    }
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const x = segmentIntersection(A(segs[i]), B(segs[i]), A(segs[j]), B(segs[j]));
        if (x) consider(x, "intersection");
      }
    }
    // On a line: nearest in the model (the transform may scale x and y differently).
    for (const s of segs) {
      const a = apply(m, A(s));
      const b = apply(m, B(s));
      const q = nearestOnSegment(p, a, b);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      consider(apply(inv, q), "line", len > 0 ? [(b[0] - a[0]) / len, (b[1] - a[1]) / len] : [1, 0]);
    }
  }
  return bestPoint ?? bestLine;
}
