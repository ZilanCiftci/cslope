/**
 * What the section drawing draws, in model coordinates (m): the layers as
 * polygons (the outline clipped to each layer's band), the road's fill,
 * the water line where it is in the ground, the critical surface and the
 * slices from the result, and the ticks of the axes. Pure TypeScript.
 */
import type { SliceData } from "@cslope/engine";
import { exteriorOf, geometry, type ExcavationGeometry, type ExcavationParams } from "../templates/excavation";

export type Point = [number, number];

/** The part of a polygon with y between `lo` and `hi` (Sutherland–Hodgman against two half-planes). */
export function clipBand(poly: Point[], lo: number, hi: number): Point[] {
  const clip = (pts: Point[], inside: (p: Point) => boolean, y: number): Point[] => {
    const out: Point[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const ia = inside(a);
      const ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (y - a[1]) / (b[1] - a[1]);
        out.push([a[0] + t * (b[0] - a[0]), y]);
      }
    }
    return out;
  };
  return clip(
    clip(poly, (p) => p[1] <= hi, hi),
    (p) => p[1] >= lo,
    lo,
  );
}

/** Where the horizontal line y = `level` is inside the polygon: [x1, x2] pairs, left to right. */
export function horizontalSpans(poly: Point[], level: number): [number, number][] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    if (y1 > level !== y2 > level) xs.push(x1 + ((level - y1) * (x2 - x1)) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

export interface SectionShapes {
  g: ExcavationGeometry;
  exterior: Point[];
  /** One polygon per layer, from the top down. */
  layers: Point[][];
  road: Point[] | null;
  /** The water line's pieces in the ground. */
  water: [number, number][];
  /** The traffic load's span, when there is one. */
  load: { x1: number; x2: number; y: number } | null;
}

/** The shapes of a parameter set whose geometry fields are valid (the materials may be empty). */
export function sectionShapes(params: ExcavationParams): SectionShapes {
  const g = geometry(params);
  const exterior = exteriorOf(params, g);
  const layers: Point[][] = [];
  let top = g.ground;
  params.layers.forEach((layer, i) => {
    const bottom = i === params.layers.length - 1 ? g.base : layer.bottomLevel;
    layers.push(clipBand(exterior, bottom, top));
    top = layer.bottomLevel;
  });
  const r = g.road;
  const road: Point[] | null = r && [
    [r.farToe, g.ground],
    [r.topLeft, r.top],
    [r.topRight, r.top],
    [r.nearToe, g.ground],
  ];
  const water = params.waterLevel === null ? [] : horizontalSpans(exterior, params.waterLevel);
  const q = params.road?.trafficLoad;
  const load = r && q ? { x1: r.topLeft, x2: r.topRight, y: r.top } : null;
  return { g, exterior, layers, road, water, load };
}

/** The base of a slice at x, from its middle and its base angle (the slope slides to the right). */
const baseAt = (s: SliceData, x: number) => s.yBottom - Math.tan(s.alpha) * (x - s.x);

/** The critical surface from its slices: the base of each, left to right. */
export function surfaceLine(slices: SliceData[]): Point[] {
  if (!slices.length) return [];
  const pts: Point[] = slices.map((s) => [s.xLeft, baseAt(s, s.xLeft)]);
  const last = slices[slices.length - 1];
  pts.push([last.xRight, baseAt(last, last.xRight)]);
  return pts;
}

/** The ground surface's height at x: the top of the outline (the highest crossing of a vertical line). */
export function groundAt(exterior: Point[], x: number): number | null {
  let best: number | null = null;
  for (let i = 0; i < exterior.length; i++) {
    const [x1, y1] = exterior[i];
    const [x2, y2] = exterior[(i + 1) % exterior.length];
    if (x1 === x2 || x < Math.min(x1, x2) || x > Math.max(x1, x2)) continue;
    const y = y1 + ((x - x1) * (y2 - y1)) / (x2 - x1);
    if (best === null || y > best) best = y;
  }
  return best;
}

/** The slices' sides, from the base to the ground (the inner ones). */
export function sliceSides(slices: SliceData[], exterior: Point[]): [Point, Point][] {
  return slices.slice(1).map((s) => {
    const base = baseAt(s, s.xLeft);
    const top = groundAt(exterior, s.xLeft) ?? s.yTop;
    return [
      [s.xLeft, base],
      [s.xLeft, top],
    ];
  });
}

/** Round tick values from `lo` to `hi`, about `count` of them. */
export function ticks(lo: number, hi: number, count = 6): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // The round step whose number of ticks is nearest to `count`.
  const step = [1, 2, 5, 10].map((m) => m * mag).reduce((a, b) => (Math.abs(span / b - count) < Math.abs(span / a - count) ? b : a));
  const out: number[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) out.push(Number((k * step).toPrecision(12)) + 0);
  return out;
}

/**
 * The part of the model the drawing shows: the slope, the road and the
 * critical surface with some ground around them, not the whole width the
 * search needs (which would make the slope small, on a phone tiny).
 */
export function viewOf(g: ExcavationGeometry, depth: number, surface: Point[] | null): { x0: number; x1: number; y0: number; y1: number } {
  const xs = surface?.map((p) => p[0]) ?? [];
  const ys = surface?.map((p) => p[1]) ?? [];
  const x0 = Math.max(g.left, Math.min(g.road?.farToe ?? 0, -2 * depth, ...xs) - depth);
  const x1 = Math.min(g.right, Math.max(g.toeX + 2 * depth, ...xs) + depth);
  const y0 = Math.max(g.base, Math.min(g.bottom - 1.5 * depth, ...ys) - 1);
  return { x0, x1, y0, y1: g.road ? g.road.top : g.ground };
}
