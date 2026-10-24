/**
 * Layout helpers shared by the canvas and the PDF drawing: greedy label
 * placement (cartographic practice: try a few candidate positions, take
 * the first free one, skip the label when none is free), grouping of
 * adjacent load strips, display rounding of load magnitudes and the
 * placement of water-table symbols along a line.
 *
 * Everything works in drawing units (canvas px or PDF mm) with y down;
 * `unit` converts the canvas pixel sizes of the style spec to them.
 */
import { surfaceYAtX } from "../view/surface";
import { surfacePoints, type DrawableSurface } from "../../utils/arc";
import { PIEZO_BAR_GAP2_PX, PIEZO_TRI_HALF_PX, PIEZO_TRI_H_PX } from "./style-spec";
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

// ── Water-table symbols ───────────────────────────────────

/** A water-table symbol: tip of the ▽ at (x, y); `bars` false where the "≡" would go into the ground. */
export interface PiezoSymbol {
  x: number;
  y: number;
  bars: boolean;
}

export interface PiezoLayoutOptions {
  /** Drawing units per canvas pixel (paper zoom on the canvas, mm per px in the PDF). */
  unit: number;
  /** External boundary of the model (world). */
  model: readonly Pt[];
  /** Critical slip surface, kept clear of symbols. */
  critical?: DrawableSurface | null;
  /** Symbols already placed (other lines); new ones are added. */
  taken?: Pt[];
  /** Boxes and lines to keep clear of (element heads, numbers and bars). */
  avoid?: readonly Box[];
  avoidLines?: readonly Seg[];
}

/** Arc length between symbols, in canvas pixels. */
export const PIEZO_SYMBOL_SPACING_PX = 200;
/** Steepest segment (|dy/dx|) a symbol is put on. */
const PIEZO_MAX_SLOPE = 1;

/**
 * Positions of the water-table symbols along a line: about one per
 * PIEZO_SYMBOL_SPACING_PX of its drawn length (at least one), each moved
 * from its ideal position to the nearest spot on a flat enough segment,
 * clear of the critical surface and of other symbols, preferring open
 * water above the ground. Where the line runs at the ground surface the
 * "≡" is left out so it doesn't go into the ground.
 */
export function piezoSymbolLayout(
  line: readonly Pt[],
  toScreen: (x: number, y: number) => Pt,
  opts: PiezoLayoutOptions,
): PiezoSymbol[] {
  const u = opts.unit;
  const triH = PIEZO_TRI_H_PX * u;
  const triHalf = PIEZO_TRI_HALF_PX * u;
  const barGap2 = PIEZO_BAR_GAP2_PX * u;
  const minGap = 4 * triHalf;
  const step = 3 * u;
  const taken = opts.taken ?? [];
  const pts = line.map(([x, y]) => toScreen(x, y));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = cum[cum.length - 1];
  if (pts.length < 2 || !(total > 0)) return [];

  const critSegs = opts.critical ? polylineSegments(surfacePoints(opts.critical).map(([x, y]) => toScreen(x, y))) : [];
  const critDots = opts.critical ? [opts.critical.entryPoint, opts.critical.exitPoint].map(([x, y]) => toScreen(x, y)) : [];

  interface Spot {
    x: number;
    y: number;
    steep: boolean;
    tier: number;
    bars: boolean;
  }
  const at = (s: number): Spot => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    while (i < cum.length - 1 && cum[i] === cum[i - 1]) i++;
    const segLen = cum[i] - cum[i - 1];
    const t = segLen > 0 ? Math.max(0, Math.min(1, (s - cum[i - 1]) / segLen)) : 0;
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const x = ax + t * (bx - ax);
    const y = ay + t * (by - ay);
    const steep = Math.abs(by - ay) > PIEZO_MAX_SLOPE * Math.abs(bx - ax);
    const box: Box = { left: x - triHalf - 2 * u, top: y - triH - 2 * u, right: x + triHalf + 2 * u, bottom: y + barGap2 + 2 * u };
    const wx = line[i - 1][0] + t * (line[i][0] - line[i - 1][0]);
    const gy = surfaceYAtX(opts.model as Pt[], wx);
    const groundY = gy === null ? null : toScreen(wx, gy)[1];
    // Line at or above the ground with the bars reaching into it.
    const bars = groundY === null || !(y <= groundY + u && y + barGap2 > groundY - u);
    let tier = groundY === null || y < groundY - barGap2 - u ? 0 : 1;
    const dotR = 5 * u;
    if (
      critSegs.some((sg) => segmentHitsBox(sg, box)) ||
      (opts.avoidLines ?? []).some((sg) => segmentHitsBox(sg, box)) ||
      (opts.avoid ?? []).some((b) => boxesOverlap(b, box, 0)) ||
      critDots.some(([dx, dy]) => dx > box.left - dotR && dx < box.right + dotR && dy > box.top - dotR && dy < box.bottom + dotR)
    ) {
      tier = 2;
    }
    return { x, y, steep, tier, bars };
  };
  const free = (p: Spot) => taken.every(([tx, ty]) => Math.hypot(tx - p.x, ty - p.y) >= minGap);

  /** Best spot within ±half of `center`, searching outward; null when none qualifies. */
  const search = (center: number, half: number, maxTier: number, strict: boolean): Spot | null => {
    let best: Spot | null = null;
    for (let k = 0; k * step <= half; k++) {
      for (const sign of k === 0 ? [1] : [1, -1]) {
        const s = center + sign * k * step;
        if (s < 0 || s > total) continue;
        const p = at(s);
        if (strict && (p.steep || !free(p))) continue;
        if (p.tier > maxTier) continue;
        if (!best || p.tier < best.tier) best = p;
        if (p.tier === 0) return p;
      }
    }
    return best;
  };

  const n = Math.max(1, Math.round(total / (PIEZO_SYMBOL_SPACING_PX * u)));
  const win = total / n;
  const out: PiezoSymbol[] = [];
  const add = (p: Spot) => {
    out.push({ x: p.x, y: p.y, bars: p.bars });
    taken.push([p.x, p.y]);
  };
  for (let k = 0; k < n; k++) {
    const p = search((k + 0.5) * win, win / 2, 1, true);
    if (p) add(p);
  }
  if (out.length === 0) {
    // At least one symbol per line: anywhere flat and free, else the middle.
    const p = search(total / 2, total / 2, 2, true) ?? at(total / 2);
    add(p);
  }
  return out;
}
