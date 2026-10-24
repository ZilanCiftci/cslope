/**
 * Geometry of the edit-view markers, shared by the drawing and by the
 * vertex-label layout (which keeps labels clear of them), so the two
 * cannot drift apart: the search-limit markers and the tension-crack
 * depth marker.
 */
import { MARKER_BAR_H_PX, MARKER_SZ_PX } from "../rendering/style-spec";
import { searchRange, groundBetween } from "../../utils/slip-mass";
import { surfaceYAtX } from "../view/surface";
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

/** A round point marker (a vertex dot) in canvas px: centre and radius. */
export interface MarkerDot {
  x: number;
  y: number;
  r: number;
}

/** Gap kept between a vertex dot and a limit triangle moved off it, px. */
const DOT_GAP_PX = 2;

/**
 * The marker at canvas (cx, cy): a bar, and unless `towardCanvasX` is null
 * a triangle outside the range pointing into it, towards that canvas x
 * (>| at the start of a range, |< at its end, in any orientation).
 *
 * A triangle that a vertex dot in `dots` would cover (a limit at a
 * vertex: the dots are drawn over the markers) moves outward, away from
 * the range, until it starts `DOT_GAP_PX` beyond the dot; the bar stays
 * at the limit.
 */
export function limitMarkerGeometry(
  cx: number,
  cy: number,
  towardCanvasX: number | null,
  zoom = 1,
  dots: readonly MarkerDot[] = [],
): LimitMarker {
  const barH = MARKER_BAR_H_PX * zoom;
  if (towardCanvasX === null) return { x: cx, y: cy, barH, triangle: null };
  const sz = MARKER_SZ_PX * zoom;
  const inward = towardCanvasX >= cx ? 1 : -1;
  // Outward offset of the tip: past every dot over the triangle's span.
  let gap = 0;
  for (const d of [...dots].sort((a, b) => (a.x - b.x) * -inward)) {
    const out = (d.x - cx) * -inward;
    if (Math.abs(d.y - cy) >= sz + d.r || out + d.r <= gap || out - d.r >= gap + 2 * sz) continue;
    gap = Math.max(gap, out + d.r + DOT_GAP_PX * zoom);
  }
  const tipX = cx - inward * gap;
  const baseX = tipX - inward * sz * 2;
  return {
    x: cx,
    y: cy,
    barH,
    triangle: [
      [tipX, cy],
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

/** A world line segment [x1, y1, x2, y2]. */
type WSeg = readonly [number, number, number, number];

export interface CrackMarkerOptions {
  /** Lines the bottom tick must not end on (material boundaries, world). */
  lines?: readonly WSeg[];
  /** Least distance (world) from the bottom tick to those lines. */
  lineClear?: number;
  /** Half the bottom tick's width (world). */
  tickHalf?: number;
}

/** Distance from (x, y) to a segment. */
function distToSeg(x: number, y: number, [x1, y1, x2, y2]: WSeg): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2)) : 0;
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}

/**
 * A vertical dimension showing a fixed tension-crack depth, standing on
 * the crest: the highest stretch of ground, a little in from its edge
 * towards the slope (the downslope side: right for a left-to-right model,
 * left for right-to-left; the other edge when the ground does not fall
 * on that side). `inset` is the largest distance in from the edge (world
 * units). It moves farther in, at most to the middle of the crest, while
 * it is closer than `clear` to one of `avoid` (x of the search-limit
 * markers). Its bottom tick must not end on one of `opts.lines` (a
 * material boundary at the crack depth would read as the end of the
 * crack): it moves along the crest, or just past its edge onto the
 * slope, to the nearest place clear of them, and stays where it was
 * when there is none. Null without ground.
 */
export function crackMarkerPosition(
  coordinates: readonly Pt[],
  depth: number,
  rtl: boolean,
  inset: number,
  avoid: readonly number[] = [],
  clear = 0,
  opts: CrackMarkerOptions = {},
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
  // The ground and the model's base at x (the crack ends at the base).
  const at = (px: number): { top: number; bottom: number } | null => {
    const top = surfaceYAtX(coordinates as Pt[], px);
    if (top === null) return null;
    let base = Infinity;
    const n = coordinates.length;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = coordinates[i];
      const [x1, y1] = coordinates[(i + 1) % n];
      if (x0 === x1 || px < Math.min(x0, x1) || px > Math.max(x0, x1)) continue;
      base = Math.min(base, y0 + ((px - x0) / (x1 - x0)) * (y1 - y0));
    }
    return { top, bottom: Math.max(top - depth, Number.isFinite(base) ? base : top - depth) };
  };
  const lines = opts.lines ?? [];
  const lineClear = opts.lineClear ?? 0;
  const tickHalf = opts.tickHalf ?? 0;
  const onLine = (px: number, bottom: number) =>
    lines.some((sg) => [-tickHalf, 0, tickHalf].some((o) => distToSeg(px + o, bottom, sg) < lineClear));
  const nearMarker = (px: number) => avoid.some((a) => Math.abs(a - px) < clear);
  const here = at(x);
  if (here && lines.length > 0 && lineClear > 0 && onLine(x, here.bottom)) {
    // The nearest place along the crest whose bottom tick is clear, else
    // the nearest just past its downslope edge (up to `inset`), onto the
    // slope.
    const lo = xa - (edge === "left" ? Math.max(inset, d) : 0);
    const hi = xb + (edge === "right" ? Math.max(inset, d) : 0);
    const dx = Math.max((hi - lo) / 400, 1e-9);
    const spots: number[] = [];
    for (let px = lo; px <= hi + dx / 2; px += dx) spots.push(px);
    const onCrest = (px: number) => px >= xa - tol && px <= xb + tol;
    spots.sort((p, q) => Number(onCrest(q)) - Number(onCrest(p)) || Math.abs(p - x) - Math.abs(q - x));
    for (const px of spots) {
      if (nearMarker(px)) continue;
      const p = at(px);
      if (p && !onLine(px, p.bottom)) return { x: px, top: p.top, bottom: p.bottom, inward };
    }
  }
  return here ? { x, top: here.top, bottom: here.bottom, inward } : { x, top: gTop, bottom: gTop - depth, inward };
}
