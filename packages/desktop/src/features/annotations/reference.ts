/**
 * Reference annotations: lines in model coordinates drawn over the result
 * (a slip surface from another program's printout, one interpreted from a
 * paper). Pure functions: type guards, the drawn geometry (a circle
 * clipped to below the ground), label anchors, defaults, copies of custom
 * search planes and the file normalizer. The canvas and PDF renderers and
 * the hit test build on these.
 */

import type {
  Annotation,
  CustomSearchPlane,
  PaperAnnotation,
  ReferenceAnnotation,
  ReferenceDash,
  ReferenceSpec,
} from "../../store/types";

/** Line width (paper px) when none is set. */
export const REFERENCE_DEFAULT_WIDTH = 1.5;
/** The smallest radius a reference circle is dragged or edited to (m). */
export const MIN_REFERENCE_RADIUS = 0.1;

export const REFERENCE_DASHES: readonly ReferenceDash[] = ["solid", "dashed", "dotted"];
const REFERENCE_CLIPS = ["ground", "none"] as const;

export type { ReferenceSpec } from "../../store/types";

export type GroundYAt = (x: number) => number | null;

export function isReferenceAnnotation(a: Annotation): a is ReferenceAnnotation {
  return a.type === "reference";
}

export function isPaperAnnotation(a: Annotation): a is PaperAnnotation {
  return a.type !== "reference";
}

/** The paper-space annotations of a list (what view templates carry). */
export function paperAnnotations(list: readonly Annotation[]): PaperAnnotation[] {
  return list.filter(isPaperAnnotation);
}

export function referenceAnnotations(list: readonly Annotation[]): ReferenceAnnotation[] {
  return list.filter(isReferenceAnnotation);
}

/** The line width of a reference annotation (paper px). */
export function referenceWidth(a: ReferenceAnnotation): number {
  return a.width !== undefined && Number.isFinite(a.width) && a.width > 0 ? a.width : REFERENCE_DEFAULT_WIDTH;
}

/**
 * The dash pattern of a line of `width` px, in px (scaled by the caller
 * for the paper zoom or to mm): empty for a solid line.
 */
export function referenceDashPattern(dash: ReferenceDash | undefined, width: number): number[] {
  if (dash === "dashed") return [4 * width + 2, 2 * width + 2];
  if (dash === "dotted") return [width, 2 * width + 1];
  return [];
}

/** How the annotation is listed: its label, else its shape. */
export function referenceListName(a: ReferenceAnnotation): string {
  const label = a.label?.trim();
  if (label) return label;
  return a.shape === "circle" ? "Reference circle" : "Reference line";
}

/** Circle sampling: segments of a full circle, and of the clipped arc per radian. */
const CIRCLE_SEGMENTS = 144;
const ARC_STEP = Math.PI / 90;

/**
 * The points of the drawn line in model coordinates: a polyline's own
 * points; a circle sampled, closed when it is drawn whole, else the arc
 * below the ground surface (from where it enters the ground to where it
 * leaves it, found from its lowest point). Empty when nothing is drawn (a
 * clipped circle whose lowest point lies above the ground or outside the
 * model, a polyline with one point).
 */
export function referenceWorldPoints(a: ReferenceAnnotation, groundYAt: GroundYAt): [number, number][] {
  if (a.shape === "polyline") return a.points.length >= 2 ? a.points.map(([x, y]) => [x, y]) : [];
  const { cx, cy, radius: r } = a;
  if (!(r > 0)) return [];
  const at = (t: number): [number, number] => [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  if ((a.clip ?? "ground") === "none") {
    const out: [number, number][] = [];
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) out.push(at((i * 2 * Math.PI) / CIRCLE_SEGMENTS));
    out.push([out[0][0], out[0][1]]);
    return out;
  }
  const below = (t: number) => {
    const [x, y] = at(t);
    const g = groundYAt(x);
    return g !== null && y < g;
  };
  const bottom = -Math.PI / 2;
  if (!below(bottom)) return [];
  // Walk from the bottom to where the arc comes out of the ground on each
  // side, then bisect the crossing.
  const crossing = (dir: 1 | -1): number => {
    let inside = bottom;
    let outside: number | null = null;
    for (let k = 1; k <= 180; k++) {
      const t = bottom + dir * k * ARC_STEP;
      if (below(t)) inside = t;
      else {
        outside = t;
        break;
      }
    }
    if (outside === null) return bottom + dir * Math.PI;
    let above: number = outside;
    for (let i = 0; i < 12; i++) {
      const mid = (inside + above) / 2;
      if (below(mid)) inside = mid;
      else above = mid;
    }
    return inside;
  };
  const t0 = crossing(-1);
  const t1 = crossing(1);
  // Sampled from each end to the bottom, so the lowest point (the label's
  // anchor) lies on the line.
  const out: [number, number][] = [];
  const nL = Math.max(4, Math.ceil((bottom - t0) / ARC_STEP));
  for (let i = 0; i < nL; i++) out.push(at(t0 + ((bottom - t0) * i) / nL));
  const nR = Math.max(4, Math.ceil((t1 - bottom) / ARC_STEP));
  for (let i = 0; i <= nR; i++) out.push(at(bottom + ((t1 - bottom) * i) / nR));
  return out;
}

/**
 * Where the label sits: the polyline's midpoint along its length, the
 * lowest point of a circle. Null when nothing is drawn.
 */
export function referenceLabelAnchor(a: ReferenceAnnotation, pts: readonly (readonly [number, number])[]): [number, number] | null {
  if (pts.length === 0) return null;
  if (a.shape === "circle") return [a.cx, a.cy - a.radius];
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (total === 0) return [pts[0][0], pts[0][1]];
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (run + len >= total / 2) {
      const t = len > 0 ? (total / 2 - run) / len : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    run += len;
  }
  return [pts[pts.length - 1][0], pts[pts.length - 1][1]];
}

/** The annotation moved by (dx, dy) m. */
export function translateReference(a: ReferenceAnnotation, dx: number, dy: number): ReferenceAnnotation {
  if (a.shape === "polyline") return { ...a, points: a.points.map(([x, y]) => [x + dx, y + dy]) };
  return { ...a, cx: a.cx + dx, cy: a.cy + dy };
}

/** A deep copy (a duplicated model must not share the points). */
export function cloneAnnotation<T extends Annotation>(a: T): T {
  if (a.type === "reference" && a.shape === "polyline") {
    return { ...a, points: a.points.map(([x, y]) => [x, y] as [number, number]) };
  }
  if (a.type !== "reference" && a.tableColumns) return { ...a, tableColumns: [...a.tableColumns] };
  return { ...a };
}

/**
 * A custom search plane as a reference annotation, labelled "Custom
 * surface n" (n = `index` + 1, its place in customPlanesInResultOrder,
 * as the result numbers it): a circle clipped to the ground, a
 * non-circular surface as its points. Null for a plane without geometry.
 */
export function referenceFromCustomPlane(plane: CustomSearchPlane, index: number): ReferenceSpec | null {
  const label = `Custom surface ${index + 1}`;
  if (plane.points) {
    if (plane.points.length < 2) return null;
    return { shape: "polyline", points: plane.points.map(([x, y]) => [x, y]), label };
  }
  if (!(plane.radius > 0)) return null;
  return { shape: "circle", cx: plane.cx, cy: plane.cy, radius: plane.radius, clip: "ground", label };
}

export interface WorldBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * A new polyline through the middle of the view: from the ground at 30 %
 * of the width to the ground at 70 %, sagging a fifth of the height
 * between them (at the view's middle where there is no ground).
 */
export function defaultReferencePolyline(b: WorldBounds, groundYAt: GroundYAt): ReferenceSpec {
  const w = b.xMax - b.xMin;
  const h = b.yMax - b.yMin;
  const mid = (b.yMin + b.yMax) / 2;
  const groundOr = (x: number) => groundYAt(x) ?? mid;
  const x0 = b.xMin + 0.3 * w;
  const x1 = b.xMin + 0.5 * w;
  const x2 = b.xMin + 0.7 * w;
  const points: [number, number][] = [
    [round2(x0), round2(groundOr(x0))],
    [round2(x1), round2(Math.min(groundOr(x0), groundOr(x2)) - 0.2 * h)],
    [round2(x2), round2(groundOr(x2))],
  ];
  return { shape: "polyline", points };
}

/**
 * A new circle through the middle of the view: centred above the middle,
 * reaching 0.45 of the height down, clipped to the ground.
 */
export function defaultReferenceCircle(b: WorldBounds): ReferenceSpec {
  const h = b.yMax - b.yMin;
  return {
    shape: "circle",
    cx: round2((b.xMin + b.xMax) / 2),
    cy: round2(b.yMax - 0.2 * h),
    radius: round2(Math.max(MIN_REFERENCE_RADIUS, 0.45 * h)),
    clip: "ground",
  };
}

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function finitePairs(v: unknown): [number, number][] | null {
  if (!Array.isArray(v)) return null;
  const out: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2 || !finite(p[0]) || !finite(p[1])) return null;
    out.push([p[0], p[1]]);
  }
  return out;
}

/**
 * A reference annotation read from a file or template: its named fields
 * only, validated; null when the shape or geometry is unusable (then the
 * annotation is dropped, as other invalid annotations are).
 */
export function normalizeReferenceAnnotation(raw: Record<string, unknown>): ReferenceAnnotation | null {
  if (typeof raw.id !== "string" || raw.type !== "reference") return null;
  const common = {
    id: raw.id,
    type: "reference" as const,
    ...(typeof raw.label === "string" ? { label: raw.label } : {}),
    ...(typeof raw.color === "string" ? { color: raw.color } : {}),
    ...(REFERENCE_DASHES.includes(raw.dash as ReferenceDash) ? { dash: raw.dash as ReferenceDash } : {}),
    ...(finite(raw.width) && raw.width > 0 ? { width: raw.width } : {}),
    ...(typeof raw.showInEdit === "boolean" ? { showInEdit: raw.showInEdit } : {}),
  };
  if (raw.shape === "polyline") {
    const points = finitePairs(raw.points);
    if (!points || points.length < 2) return null;
    return { ...common, shape: "polyline", points };
  }
  if (raw.shape === "circle") {
    if (!finite(raw.cx) || !finite(raw.cy) || !finite(raw.radius) || raw.radius <= 0) return null;
    const clip = REFERENCE_CLIPS.includes(raw.clip as "ground" | "none") ? (raw.clip as "ground" | "none") : undefined;
    return { ...common, shape: "circle", cx: raw.cx, cy: raw.cy, radius: raw.radius, ...(clip ? { clip } : {}) };
  }
  return null;
}
