/**
 * Geometry of the edit-view markers, shared by the drawing and by the
 * vertex-label layout (which keeps labels clear of them), so the two
 * cannot drift apart: the search-limit markers and the tension-crack
 * depth marker.
 */
import { MARKER_BAR_H_PX, MARKER_SZ_PX } from "../rendering/style-spec";
import { searchRange, groundBetween } from "../../utils/slip-mass";
import type { Box } from "./label-layout";

type Pt = [number, number];

/**
 * The marked ends of a search range given by its two handles (world x):
 * each end with the range's other end (`toward`, world x) that its
 * triangle points to; one end with `toward` null for a range of zero
 * width (a bar only). `end` says which handle (0: `xa`, 1: `xb`; a
 * zero-width range's single end stands for both).
 */
export function rangeMarkerEnds(xa: number, xb: number): { x: number; toward: number | null; end: 0 | 1 }[] {
  const range = searchRange(xa, xb);
  if (range.point) return [{ x: xa, toward: null, end: 0 }];
  return [
    { x: xa, toward: xa <= xb ? range.hi : range.lo, end: 0 },
    { x: xb, toward: xb < xa ? range.hi : range.lo, end: 1 },
  ];
}

/** A search-limit marker in canvas px: a bar across the ground and a triangle. */
export interface LimitMarker {
  x: number;
  y: number;
  /** Half the bar's height. */
  barH: number;
  /** Tip at the bar, base outside the range; null for a bar only. */
  triangle: [Pt, Pt, Pt] | null;
}

/**
 * The marker at canvas (cx, cy): a bar, and unless `towardCanvasX` is null
 * a triangle outside the range pointing into it, towards that canvas x
 * (>| at the start of a range, |< at its end, in any orientation).
 */
export function limitMarkerGeometry(cx: number, cy: number, towardCanvasX: number | null, zoom = 1): LimitMarker {
  const barH = MARKER_BAR_H_PX * zoom;
  if (towardCanvasX === null) return { x: cx, y: cy, barH, triangle: null };
  const sz = MARKER_SZ_PX * zoom;
  const inward = towardCanvasX >= cx ? 1 : -1;
  const baseX = cx - inward * sz * 2;
  return {
    x: cx,
    y: cy,
    barH,
    triangle: [
      [cx, cy],
      [baseX, cy - sz],
      [baseX, cy + sz],
    ],
  };
}

/** Boxes covering a marker: its bar and its triangle. */
export function limitMarkerBoxes(m: LimitMarker, zoom = 1): Box[] {
  const boxes: Box[] = [{ left: m.x - 1.5 * zoom, top: m.y - m.barH, right: m.x + 1.5 * zoom, bottom: m.y + m.barH }];
  if (m.triangle) {
    const xs = m.triangle.map((p) => p[0]);
    const ys = m.triangle.map((p) => p[1]);
    boxes.push({ left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) });
  }
  return boxes;
}

/** Where the tension-crack depth marker stands (world): at x, from the ground down. */
export interface CrackMarker {
  x: number;
  /** Ground level at x. */
  top: number;
  /** The crack's bottom (the depth below the ground, not below the model's base). */
  bottom: number;
  /** Direction from the crest's edge into the crest (+1: larger x), 0 in its middle. */
  inward: 1 | -1 | 0;
}

/**
 * A vertical dimension showing a fixed tension-crack depth, standing on
 * the crest: the highest stretch of ground, a little in from its edge
 * towards the slope (the downslope side: right for a left-to-right model,
 * left for right-to-left; the other edge when the ground does not fall
 * on that side). `inset` is the largest distance in from the edge (world
 * units). It moves farther in, at most to the middle of the crest, while
 * it is closer than `clear` to one of `avoid` (x of the search-limit
 * markers). Null without ground.
 */
export function crackMarkerPosition(
  coordinates: readonly Pt[],
  depth: number,
  rtl: boolean,
  inset: number,
  avoid: readonly number[] = [],
  clear = 0,
): CrackMarker | null {
  if (coordinates.length < 3 || !(depth > 0)) return null;
  const xs = coordinates.map((c) => c[0]);
  const ys = coordinates.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const ground = groundBetween(coordinates, xMin, xMax);
  if (ground.length < 2) return null;
  const gTop = Math.max(...ground.map((g) => g[1]));
  const tol = 1e-6 * Math.max(1, Math.max(...ys) - Math.min(...ys));
  // The first stretch of ground at the top level.
  const first = ground.findIndex((g) => g[1] >= gTop - tol);
  let last = first;
  while (last + 1 < ground.length && ground[last + 1][1] >= gTop - tol) last++;
  const xa = ground[first][0];
  const xb = ground[last][0];
  const fallsRight = xb < xMax - tol;
  const fallsLeft = xa > xMin + tol;
  const width = xb - xa;
  const d = Math.min(inset, width * 0.3);
  const edge = rtl
    ? fallsLeft
      ? "left"
      : fallsRight
        ? "right"
        : null
    : fallsRight
      ? "right"
      : fallsLeft
        ? "left"
        : null;
  let x = edge === "left" ? xa + d : edge === "right" ? xb - d : (xa + xb) / 2;
  const inward = edge === "left" ? 1 : edge === "right" ? -1 : 0;
  const mid = (xa + xb) / 2;
  const step = clear / 2;
  for (let k = 0; k < 100 && inward !== 0 && step > 0 && avoid.some((a) => Math.abs(a - x) < clear); k++) {
    const next = x + inward * step;
    if ((next - mid) * inward > 0) break;
    x = next;
  }
  // Not below the model's base.
  let base = Infinity;
  const n = coordinates.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = coordinates[i];
    const [x1, y1] = coordinates[(i + 1) % n];
    if (x0 === x1 || x < Math.min(x0, x1) || x > Math.max(x0, x1)) continue;
    base = Math.min(base, y0 + ((x - x0) / (x1 - x0)) * (y1 - y0));
  }
  return { x, top: gTop, bottom: Math.max(gTop - depth, Number.isFinite(base) ? base : gTop - depth), inward };
}
