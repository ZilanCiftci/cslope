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
import { boxesOverlap, distanceToSegment, segmentHitsBox, type Box } from "../canvas/label-layout";

export type { Box };
export { segmentHitsBox };

type Pt = [number, number];

/** A line segment [x1, y1, x2, y2]. */
export type Seg = readonly [number, number, number, number];

/** Distance from a point to a segment. */
export function pointSegmentDistance(px: number, py: number, [x1, y1, x2, y2]: Seg): number {
  return distanceToSegment(px, py, [x1, y1], [x2, y2]);
}

/** Shortest distance between two segments (0 when they cross). */
export function segmentDistance(a: Seg, b: Seg): number {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) =>
    (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(a[0], a[1], a[2], a[3], b[0], b[1]);
  const d2 = cross(a[0], a[1], a[2], a[3], b[2], b[3]);
  const d3 = cross(b[0], b[1], b[2], b[3], a[0], a[1]);
  const d4 = cross(b[0], b[1], b[2], b[3], a[2], a[3]);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return 0;
  return Math.min(
    pointSegmentDistance(a[0], a[1], b),
    pointSegmentDistance(a[2], a[3], b),
    pointSegmentDistance(b[0], b[1], a),
    pointSegmentDistance(b[2], b[3], a),
  );
}

/**
 * Distance between the boxes around two segments: never more than their
 * segmentDistance, and far cheaper, so a far segment can be passed over.
 */
export function segmentBoxGap(a: Seg, b: Seg): number {
  const dx = Math.max(0, Math.min(b[0], b[2]) - Math.max(a[0], a[2]), Math.min(a[0], a[2]) - Math.max(b[0], b[2]));
  const dy = Math.max(0, Math.min(b[1], b[3]) - Math.max(a[1], a[3]), Math.min(a[1], a[3]) - Math.max(b[1], b[3]));
  return Math.hypot(dx, dy);
}

/**
 * Positions for a row of labels along one axis, each wanting to sit at
 * `desired` (ascending), at least `pitch` apart, in the same order, with
 * the least squared movement (isotonic regression by pooling adjacent
 * violators): labels that fit stay where they want to be, a crowd spreads
 * evenly around its centre.
 */
export function stackPositions(desired: readonly number[], pitch: number): number[] {
  const blocks: { sum: number; n: number }[] = [];
  desired.forEach((d, i) => {
    blocks.push({ sum: d - i * pitch, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1];
      const a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum;
      a.n += b.n;
      blocks.pop();
    }
  });
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.n; k++) out.push(b.sum / b.n + out.length * pitch);
  return out;
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

/** A line load's arrow in drawing units: the tip at the load point, the tail `length` back. */
export interface LineLoadArrowGeometry {
  tip: Pt;
  tail: Pt;
  /** Not vertical: the tail is not straight above the tip. */
  inclined: boolean;
}

/**
 * Where a line load's arrow goes: the tip at the load point (the ground at
 * x, or the given elevation of an inclined load on a wall face), the tail
 * `length` back against the load's direction (its angle from the downward
 * vertical, positive towards +x). A vertical load's tail is straight above
 * the tip. Null when the point is off the model.
 */
export function lineLoadArrow(
  load: { x: number; angle?: number; y?: number },
  toD: (x: number, y: number) => Pt,
  groundY: (x: number) => number | null,
  length: number,
): LineLoadArrowGeometry | null {
  const a = Number.isFinite(load.angle) && load.angle !== 0 ? (load.angle! * Math.PI) / 180 : 0;
  const wy = a !== 0 && Number.isFinite(load.y) ? load.y! : groundY(load.x);
  if (wy === null) return null;
  const tip = toD(load.x, wy);
  if (a === 0) return { tip, tail: [tip[0], tip[1] - length], inclined: false };
  // the direction in drawing units, from a step along it in the world
  const ahead = toD(load.x + Math.sin(a), wy - Math.cos(a));
  const dx = ahead[0] - tip[0];
  const dy = ahead[1] - tip[1];
  const d = Math.hypot(dx, dy) || 1;
  return { tip, tail: [tip[0] - (dx / d) * length, tip[1] - (dy / d) * length], inclined: true };
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
export function groupTouchingStrips<T extends { x1: number; x2: number; magnitude: number; direction?: string }>(
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
