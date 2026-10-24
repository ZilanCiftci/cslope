/**
 * World extents of what a model draws, for fitting a view or a paper frame
 * to it: the geometry, plus the parts of water lines, loads, reinforcement
 * and piles that belong with it.
 */

import { surfaceYAtX } from "./surface";

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
 * slope), and nothing when that part lies wholly below the model's base
 * (a "dry" line, e.g. at y = -100 under a 15 m model).
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
  return pts;
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

/*
 * Screen sizes (px at paper zoom 1) of the symbols drawn at a fixed size,
 * from draw.ts: a load is a 38 px arrow (ARROW_HEIGHT_PX) with a bold 13 px
 * label above it; the water-table triangle stands about 14 px above its line.
 */
const LOAD_SYMBOL_HEIGHT_PX = 38 + 8 + 13 + 3;
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

  const load = (x: number, label: string) => {
    const y = surfaceYAtX(coordinates, x);
    if (y === null) return;
    const halfLabel = Math.max(LOAD_ARROW_HEAD_PX, (label.length * LOAD_LABEL_CHAR_PX) / 2) * px;
    pts.push([x - halfLabel, y + LOAD_SYMBOL_HEIGHT_PX * px], [x + halfLabel, y + LOAD_SYMBOL_HEIGHT_PX * px]);
  };
  for (const u of content.udls ?? []) {
    // The label is centred over the load, the box spans x1..x2.
    load((u.x1 + u.x2) / 2, `q = ${u.magnitude} kPa`);
    load(u.x1, "");
    load(u.x2, "");
  }
  for (const l of content.lineLoads ?? []) load(l.x, `P = ${l.magnitude} kN/m`);

  for (const r of [...(content.reinforcements ?? []), ...(content.piles ?? [])]) {
    pts.push([r.x1, r.y1], [r.x2, r.y2]);
  }

  return boundsOf(pts);
}
