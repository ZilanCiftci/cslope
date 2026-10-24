/**
 * Layout helpers shared by the canvas and the PDF drawing: greedy label
 * placement (cartographic practice: try a few candidate positions, take
 * the first free one, skip the label when none is free), grouping of
 * adjacent load strips and display rounding of load magnitudes (the
 * water-table symbols are placed in piezo-layout.ts).
 *
 * Everything works in drawing units (canvas px or PDF mm) with y down;
 * `unit` converts the canvas pixel sizes of the style spec to them.
 */
import { boxesOverlap, distanceToSegment, type Box } from "../canvas/label-layout";

export type { Box };

type Pt = [number, number];

/** A line segment [x1, y1, x2, y2]. */
export type Seg = readonly [number, number, number, number];

/** Whether a segment passes through a box (Liang–Barsky clipping). */
export function segmentHitsBox([x1, y1, x2, y2]: Seg, b: Box): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - b.left, b.right - x1, y1 - b.top, b.bottom - y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** Distance from a point to a segment. */
export function pointSegmentDistance(px: number, py: number, [x1, y1, x2, y2]: Seg): number {
  return distanceToSegment(px, py, [x1, y1], [x2, y2]);
}

/** Segments of an open polyline. */
export function polylineSegments(pts: readonly Pt[]): Seg[] {
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) out.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
  return out;
}

/**
 * Greedy label placement: of the candidates (in order of preference), the
 * first that overlaps no placed box and crosses the fewest obstacle
 * segments. The chosen box is added to `placed`. Null when every
 * candidate overlaps a placed label (or fails `accept`): the label is
 * then left out.
 */
export function placeLabel(
  candidates: readonly Box[],
  placed: Box[],
  obstacles: readonly Seg[] = [],
  gap = 0,
  accept: (box: Box) => boolean = () => true,
): Box | null {
  let best: Box | null = null;
  let bestHits = Infinity;
  for (const c of candidates) {
    if (placed.some((p) => boxesOverlap(c, p, gap)) || !accept(c)) continue;
    let hits = 0;
    for (const s of obstacles) if (segmentHitsBox(s, c)) hits++;
    if (hits < bestHits) {
      best = c;
      bestHits = hits;
      if (hits === 0) break;
    }
  }
  if (best) placed.push(best);
  return best;
}

/**
 * A load magnitude for display: two decimals below 10, one below 100 and
 * none above; trailing zeros only where the value has no more digits
 * (20 → "20", 20.5 → "20.5", 23.94013 → "23.9", 11.97 → "12.0").
 */
export function formatMagnitude(v: number): string {
  const a = Math.abs(v);
  const decimals = a >= 99.95 ? 0 : a >= 9.995 ? 1 : 2;
  let s = v.toFixed(decimals);
  if (s.includes(".")) {
    const short = s.replace(/\.?0+$/, "");
    if (Math.abs(Number(short) - v) < 1e-9 * Math.max(1, a)) s = short;
  }
  return /^-0(\.0*)?$/.test(s) ? s.slice(1) : s;
}

/** "q = 20 kPa", or the range of a group of strips "q = 20–40 kPa". */
export function formatRange(lo: number, hi: number, symbol: string, unit: string): string {
  // Both ends with the decimals formatMagnitude gives the larger one;
  // trailing zeros dropped only when neither end has more digits.
  const big = Math.max(Math.abs(lo), Math.abs(hi));
  const decimals = big >= 99.95 ? 0 : big >= 9.995 ? 1 : 2;
  const exact = (v: number) => Math.abs(Number(v.toFixed(decimals)) - v) < 1e-9 * Math.max(1, Math.abs(v));
  const a = lo.toFixed(decimals);
  const b = hi.toFixed(decimals);
  if (a === b) return `${symbol} = ${formatMagnitude(hi)} ${unit}`;
  return exact(lo) && exact(hi)
    ? `${symbol} = ${formatMagnitude(lo)}–${formatMagnitude(hi)} ${unit}`
    : `${symbol} = ${a}–${b} ${unit}`;
}

/**
 * Height of a load symbol as a fraction of the full arrow: in proportion
 * to the largest load of its kind in the model, at least `min` so small
 * loads stay visible.
 */
export function loadHeightFraction(q: number, qMax: number, min = 0.4): number {
  if (!(qMax > 0)) return 1;
  return Math.max(min, Math.min(1, Math.abs(q) / qMax));
}

export interface StripGroup<T> {
  /** Strips left to right. */
  strips: T[];
  lo: number;
  hi: number;
  qMin: number;
  qMax: number;
}

/**
 * Groups load strips whose x ranges touch end to end (a ramp or varying
 * load entered as many strips) so they are drawn and labelled as one load.
 * Overlapping strips stay separate groups: they are separate surcharges.
 */
export function groupTouchingStrips<T extends { x1: number; x2: number; magnitude: number }>(
  strips: readonly T[],
): StripGroup<T>[] {
  const sorted = [...strips].sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));
  const groups: StripGroup<T>[] = [];
  for (const s of sorted) {
    const lo = Math.min(s.x1, s.x2);
    const hi = Math.max(s.x1, s.x2);
    const tol = 1e-6 * Math.max(1, Math.abs(lo));
    const g = hi > lo ? groups.find((gr) => gr.hi > gr.lo && Math.abs(gr.hi - lo) <= tol) : undefined;
    if (g) {
      g.strips.push(s);
      g.hi = hi;
      g.qMin = Math.min(g.qMin, s.magnitude);
      g.qMax = Math.max(g.qMax, s.magnitude);
    } else {
      groups.push({ strips: [s], lo, hi, qMin: s.magnitude, qMax: s.magnitude });
    }
  }
  return groups;
}

/**
 * Which strip edges of a group get an arrow: always the two outer ends,
 * inner edges only when at least `minSpacing` from the previous arrow and
 * from the far end. `xs` are the edge positions in drawing units, left to
 * right (n strips → n + 1 edges).
 */
export function arrowEdges(xs: readonly number[], minSpacing: number): number[] {
  if (xs.length === 0) return [];
  const out = [0];
  const last = xs.length - 1;
  for (let i = 1; i < last; i++) {
    if (Math.abs(xs[i] - xs[out[out.length - 1]]) >= minSpacing && Math.abs(xs[last] - xs[i]) >= minSpacing) {
      out.push(i);
    }
  }
  if (last > 0) out.push(last);
  return out;
}
