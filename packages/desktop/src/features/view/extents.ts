/**
 * World extents of what a model draws, for fitting a view or a paper frame
 * to it: the geometry, plus the parts of water lines, loads, reinforcement
 * and piles that belong with it.
 */

import { surfaceYAtX } from "./surface";
import { formatMagnitude, formatRange, groupTouchingStrips } from "../rendering/overlay-layout";

type Pt = [number, number];

export interface Bounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Bounding box of points, or null without any. */
export function boundsOf(points: Pt[]): Bounds | null {
  if (points.length === 0) return null;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [x, y] of points) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    xMin = Math.min(xMin, x);
    xMax = Math.max(xMax, x);
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
  }
  return Number.isFinite(xMin) ? { xMin, xMax, yMin, yMax } : null;
}

/**
 * The part of a water line that a view of the model should show: the line
 * clipped to the model's x range (water lines are often drawn far past the
 * slope), raised to the model's base where it lies below it, and nothing
 * when that part lies wholly below the base (a "dry" line, e.g. at
 * y = -100 under a 15 m model).
 */
export function waterLineFitPoints(line: Pt[], model: Pt[]): Pt[] {
  const mb = boundsOf(model);
  if (!mb) return line;
  const pts: Pt[] = [];
  const inRange = (x: number) => x >= mb.xMin && x <= mb.xMax;
  if (line.length === 1) {
    if (inRange(line[0][0])) pts.push(line[0]);
  }
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = line[i][0] <= line[i + 1][0] ? [line[i], line[i + 1]] : [line[i + 1], line[i]];
    if (b[0] < mb.xMin || a[0] > mb.xMax) continue;
    if (a[0] === b[0]) {
      pts.push(a, b);
      continue;
    }
    const yAt = (x: number) => a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
    const x0 = Math.max(a[0], mb.xMin);
    const x1 = Math.min(b[0], mb.xMax);
    pts.push([x0, yAt(x0)], [x1, yAt(x1)]);
  }
  if (pts.every(([, y]) => y < mb.yMin)) return [];
  // A line partly below the base: what lies below it stays out of view.
  return pts.map(([x, y]) => [x, Math.max(y, mb.yMin)]);
}

/** What a model draws on the paper, in world units (loads stand on the ground surface). */
export interface PaperContent {
  coordinates: Pt[];
  waterLines?: Pt[][];
  udls?: { x1: number; x2: number; magnitude: number }[];
  lineLoads?: { x: number; magnitude: number }[];
  reinforcements?: { x1: number; y1: number; x2: number; y2: number }[];
  piles?: { x1: number; y1: number; x2: number; y2: number }[];
}

/** What a model (or the app state of one) draws on the paper. */
export function paperContentOf(model: {
  coordinates: Pt[];
  piezometricLine?: { lines: { coordinates: Pt[] }[] };
  udls?: PaperContent["udls"];
  lineLoads?: PaperContent["lineLoads"];
  reinforcements?: PaperContent["reinforcements"];
  piles?: PaperContent["piles"];
}): PaperContent {
  return {
    coordinates: model.coordinates,
    waterLines: (model.piezometricLine?.lines ?? []).map((l) => l.coordinates),
    udls: (model.udls ?? []).map(({ x1, x2, magnitude }) => ({ x1, x2, magnitude })),
    lineLoads: (model.lineLoads ?? []).map(({ x, magnitude }) => ({ x, magnitude })),
    reinforcements: (model.reinforcements ?? []).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
    piles: (model.piles ?? []).map(({ x1, y1, x2, y2 }) => ({ x1, y1, x2, y2 })),
  };
}

/*
 * Screen sizes (px at paper zoom 1) of the symbols drawn at a fixed size,
 * from canvas/overlay-geometry.ts: a load is at most a 38 px arrow
 * (ARROW_HEIGHT_PX) with a bold 13 px label 8 px above it, moved up a
 * 15 px line for each label it would overlap (at most three); the
 * water-table triangle stands about 14 px above its line.
 */
const LOAD_SYMBOL_HEIGHT_PX = 38 + 8 + 13 + 3;
const LOAD_LABEL_LINE_PX = 15;
const LOAD_LABEL_CHAR_PX = 8;
const LOAD_ARROW_HEAD_PX = 8;
const WATER_SYMBOL_HEIGHT_PX = 16;

/**
 * Extents of the content on the paper. `worldPerPx` converts the symbols
 * drawn at a fixed screen size (load arrows and labels, the water-table
 * triangle) into world units.
 */
export function paperContentBounds(content: PaperContent, worldPerPx: number): Bounds | null {
  const { coordinates } = content;
  const pts: Pt[] = coordinates.map(([x, y]) => [x, y]);
  const model = boundsOf(coordinates);
  if (!model) return null;
  const px = Math.max(0, worldPerPx);

  for (const line of content.waterLines ?? []) {
    const wl = waterLineFitPoints(line, coordinates);
    pts.push(...wl);
    const top = boundsOf(wl);
    if (top) pts.push([top.xMin, top.yMax + WATER_SYMBOL_HEIGHT_PX * px]);
  }

  // Labels as layoutLoads places them: one per group of touching UDL
  // strips, raised past the labels before it that it would overlap.
  const labelSpans: [number, number][] = [];
  const load = (x: number, label: string) => {
    const y = surfaceYAtX(coordinates, x);
    if (y === null) return;
    const halfLabel = Math.max(LOAD_ARROW_HEAD_PX, (label.length * LOAD_LABEL_CHAR_PX) / 2) * px;
    let raise = 0;
    if (label) {
      raise = Math.min(3, labelSpans.filter(([a, b]) => a < x + halfLabel && x - halfLabel < b).length);
      labelSpans.push([x - halfLabel, x + halfLabel]);
    }
    const top = y + (LOAD_SYMBOL_HEIGHT_PX + raise * LOAD_LABEL_LINE_PX) * px;
    pts.push([x - halfLabel, top], [x + halfLabel, top]);
  };
  const onModel = (content.udls ?? []).filter(
    (u) => surfaceYAtX(coordinates, u.x1) !== null && surfaceYAtX(coordinates, u.x2) !== null,
  );
  for (const g of groupTouchingStrips(onModel)) {
    // The label is centred over the group, the boxes span its strips.
    load((g.lo + g.hi) / 2, formatRange(g.qMin, g.qMax, "q", "kPa"));
    load(g.lo, "");
    load(g.hi, "");
  }
  for (const l of content.lineLoads ?? []) load(l.x, `P = ${formatMagnitude(l.magnitude)} kN/m`);

  for (const r of [...(content.reinforcements ?? []), ...(content.piles ?? [])]) {
    pts.push([r.x1, r.y1], [r.x2, r.y2]);
  }

  return boundsOf(pts);
}
