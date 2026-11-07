/**
 * What the section drawing draws, in model coordinates (m): the layers as
 * polygons (the outline clipped to each layer's band), the fill (the
 * excavation's road, the embankment), the water line (cut at the ground),
 * the critical surface and the slices from the result, and the ticks of
 * the axes. Pure TypeScript.
 */
import type { SliceData } from "@cslope/engine";
import type { Layer } from "../templates/common";
import { embankmentExterior, embankmentGeometry, type EmbankmentParams } from "../templates/embankment";
import { exteriorOf, geometry, type ExcavationParams } from "../templates/excavation";

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

/**
 * The water line: the level, cut at the ground where the ground is lower
 * (the template's water has no free water), from the model's left edge to
 * its right; empty below the model's base.
 */
export function waterLine(exterior: Point[], level: number): Point[] {
  const ys = exterior.map((p) => p[1]);
  if (level <= Math.min(...ys)) return [];
  const xs = [...new Set(exterior.map((p) => p[0]))].sort((a, b) => a - b);
  const out: Point[] = [];
  xs.forEach((x, i) => {
    const y = groundAt(exterior, x) ?? level;
    if (i > 0) {
      // Where the ground crosses the level between two vertices.
      const x0 = xs[i - 1];
      const y0 = groundAt(exterior, x0) ?? level;
      if ((y0 - level) * (y - level) < 0) out.push([x0 + ((level - y0) * (x - x0)) / (y - y0), level]);
    }
    out.push([x, Math.min(level, y)]);
  });
  return out;
}

/** The height of a polyline (left to right) at x. */
export function lineAt(line: Point[], x: number): number | null {
  for (let i = 1; i < line.length; i++) {
    const [x1, y1] = line[i - 1];
    const [x2, y2] = line[i];
    if (x >= x1 && x <= x2) return x2 === x1 ? y1 : y1 + ((x - x1) * (y2 - y1)) / (x2 - x1);
  }
  return null;
}

/** What the drawing draws of a template's section. */
export interface SectionShapes {
  exterior: Point[];
  /** One polygon per layer, from the top down. */
  layers: Point[][];
  /** The lines between materials: the layer levels and the fill's foot on the ground. */
  boundaries: [Point, Point][];
  /** The fill above the ground (the road, the embankment). */
  fill: Point[] | null;
  /** The water line, cut at the ground. */
  water: Point[];
  /** A distributed load: its span, the ground it stands on and q (kPa). */
  load: { x1: number; x2: number; y: number; q: number } | null;
  /** The model's extent. */
  extent: { left: number; right: number; base: number; top: number };
  /**
   * The part the drawing shows at least (`x0` to `x1`, down to `y0`), and
   * the margin it adds around that and the critical surface.
   */
  focus: { x0: number; x1: number; y0: number; margin: number };
}

/** Each layer's band of the outline, from the top down (the last one's down to the base). */
function layerBands(exterior: Point[], layers: Layer[], ground: number, base: number): Point[][] {
  const out: Point[][] = [];
  let top = ground;
  layers.forEach((layer, i) => {
    const bottom = i === layers.length - 1 ? base : layer.bottomLevel;
    out.push(clipBand(exterior, bottom, top));
    top = layer.bottomLevel;
  });
  return out;
}

/** The shapes of an excavation whose geometry fields are valid (the materials may be empty). */
export function excavationShapes(params: ExcavationParams): SectionShapes {
  const g = geometry(params);
  const exterior = exteriorOf(params, g);
  const r = g.road;
  const fill: Point[] | null = r && [
    [r.farToe, g.ground],
    [r.topLeft, r.top],
    [r.topRight, r.top],
    [r.nearToe, g.ground],
  ];
  const boundaries: [Point, Point][] = g.levels.map((level) => [
    [g.left, level],
    [level > g.bottom ? params.slope * (g.ground - level) : g.right, level],
  ]);
  if (r) boundaries.push([
    [r.farToe, g.ground],
    [r.nearToe, g.ground],
  ]);
  const q = params.road?.trafficLoad;
  const H = params.excavationDepth;
  return {
    exterior,
    layers: layerBands(exterior, params.layers, g.ground, g.base),
    boundaries,
    fill,
    water: params.waterLevel === null ? [] : waterLine(exterior, params.waterLevel),
    load: r && q ? { x1: r.topLeft, x2: r.topRight, y: r.top, q } : null,
    extent: { left: g.left, right: g.right, base: g.base, top: r ? r.top : g.ground },
    focus: { x0: Math.min(r?.farToe ?? 0, -2 * H), x1: g.toeX + 2 * H, y0: g.bottom - 1.5 * H, margin: H },
  };
}

/** The shapes of an embankment whose geometry fields are valid. */
export function embankmentShapes(params: EmbankmentParams): SectionShapes {
  const g = embankmentGeometry(params);
  const exterior = embankmentExterior(g);
  const h = params.embankmentHeight;
  return {
    exterior,
    layers: layerBands(exterior, params.layers, g.ground, g.base),
    boundaries: [
      ...g.levels.map((level): [Point, Point] => [
        [g.left, level],
        [g.right, level],
      ]),
      [
        [g.farToe, g.ground],
        [g.toeX, g.ground],
      ],
    ],
    fill: [
      [g.farToe, g.ground],
      [g.crestLeft, g.crest],
      [0, g.crest],
      [g.toeX, g.ground],
    ],
    water: params.waterLevel === null ? [] : waterLine(exterior, params.waterLevel),
    load: params.crestLoad ? { x1: g.crestLeft, x2: 0, y: g.crest, q: params.crestLoad } : null,
    extent: { left: g.left, right: g.right, base: g.base, top: g.crest },
    focus: { x0: g.farToe, x1: g.toeX + 2 * h, y0: g.ground - 1.5 * h, margin: h },
  };
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
 * The part of the model the drawing shows: the slope, the fill and the
 * critical surface with some ground around them, not the whole width the
 * search needs (which would make the slope small, on a phone tiny).
 */
export function viewOf(s: Pick<SectionShapes, "extent" | "focus">, surface: Point[] | null): { x0: number; x1: number; y0: number; y1: number } {
  const xs = surface?.map((p) => p[0]) ?? [];
  const ys = surface?.map((p) => p[1]) ?? [];
  const { extent: e, focus: f } = s;
  const x0 = Math.max(e.left, Math.min(f.x0, ...xs) - f.margin);
  const x1 = Math.min(e.right, Math.max(f.x1, ...xs) + f.margin);
  const y0 = Math.max(e.base, Math.min(f.y0, ...ys) - 1);
  return { x0, x1, y0, y1: e.top };
}
