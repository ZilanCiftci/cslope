import { isPointInPolygon } from "@cslope/engine";
import { surfaceYAtX } from "../features/view/surface";
import type { Region } from "./regions";

type Pt = [number, number];

/**
 * Horizontal continuations of a piezometric line beyond its end points to
 * the model edges, as the engine applies them (as is common practice).
 * Drawn dashed so the user sees the water the analysis actually uses.
 */
export function piezoExtensions(line: Pt[], model: Pt[]): [Pt, Pt][] {
  if (line.length < 2 || model.length < 3) return [];
  const xs = model.map((p) => p[0]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  let left = line[0];
  let right = line[0];
  for (const p of line) {
    if (p[0] < left[0]) left = p;
    if (p[0] > right[0]) right = p;
  }
  const out: [Pt, Pt][] = [];
  if (left[0] > xMin) out.push([[xMin, left[1]], left]);
  if (right[0] < xMax) out.push([right, [xMax, right[1]]]);
  return out;
}

/** Ground surface at x, as the slip-mass fill draws it. */
function groundTopAt(model: Pt[], x: number): number {
  return surfaceYAtX(model, x) ?? Number.NaN;
}

/** Water level of a line at x, continued horizontally beyond its ends. */
function lineYAt(line: Pt[], x: number): number {
  const pts = [...line].sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (x <= bx) return bx === ax ? by : ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return pts[pts.length - 1][1];
}

function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % poly.length];
    a += x0 * y1 - x1 * y0;
  }
  return Math.abs(a) / 2;
}

/** A pond: its water surface and the ground under it, both left to right. */
export interface Pond {
  water: Pt[];
  ground: Pt[];
}

/**
 * Areas where the water line lies above the ground: the free water the
 * analysis loads the slope with. Each polygon runs along the water surface
 * and back along the ground.
 */
export function freeWaterPolygons(line: Pt[], model: Pt[]): Pt[][] {
  return freeWaterPonds(line, model).map((p) => [...p.water, ...[...p.ground].reverse()]);
}

/** The free water of freeWaterPolygons, with the water surface and the ground apart. */
export function freeWaterPonds(line: Pt[], model: Pt[]): Pond[] {
  if (line.length < 2) return [];
  return surfaceWaterPonds(model, () => line, line.map((p) => p[0]));
}

/** Water line whose free water stands on the ground at x, or null for none. */
export type PondLineAt = (x: number) => Pt[] | null;

/**
 * Free water with the line over each stretch of ground given by `lineAt`
 * (taken at the middle of the stretch). `breaksX` are the x where the line
 * may change, with the x of its points; where it changes, one pond ends
 * and the next begins.
 */
export function surfaceWaterPonds(model: Pt[], lineAt: PondLineAt, breaksX: number[]): Pond[] {
  if (model.length < 3) return [];
  const xs = model.map((p) => p[0]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const eps = 1e-9 * Math.max(1, xMax - xMin);
  const breaks = [...new Set([...xs, ...breaksX])]
    .filter((x) => x >= xMin && x <= xMax)
    .sort((a, b) => a - b);
  const ponds: Pond[] = [];
  let water: Pt[] = [];
  let ground: Pt[] = [];
  // Slivers (water on a vertical face, or a line lying on the ground) are
  // no pond: below 1e-4 of the model width squared, under a pixel at any
  // plot size.
  const minArea = 1e-4 * (xMax - xMin) ** 2;
  const close = () => {
    const poly = [...water, ...[...ground].reverse()];
    if (water.length >= 2 && polygonArea(poly) > minArea) ponds.push({ water, ground });
    water = [];
    ground = [];
  };
  let prevLine: Pt[] | null = null;
  for (let i = 0; i < breaks.length - 1; i++) {
    const xa = breaks[i];
    const xb = breaks[i + 1];
    if (xb - xa <= 2 * eps) continue;
    const line = lineAt((xa + xb) / 2);
    if (line !== prevLine) close();
    prevLine = line;
    if (!line || line.length < 2) continue;
    // Ground just inside the interval, so vertical faces are taken from
    // the correct side.
    const ga = groundTopAt(model, xa + eps);
    const gb = groundTopAt(model, xb - eps);
    const wa = lineYAt(line, xa);
    const wb = lineYAt(line, xb);
    if (!Number.isFinite(ga) || !Number.isFinite(gb)) {
      close();
      continue;
    }
    const da = wa - ga;
    const db = wb - gb;
    if (da <= 0 && db <= 0) {
      close();
      continue;
    }
    let xs0 = xa;
    let xs1 = xb;
    if (da <= 0) xs0 = xa + ((xb - xa) * da) / (da - db);
    if (db <= 0) xs1 = xa + ((xb - xa) * da) / (da - db);
    const at = (x: number, a: number, b: number) => a + ((x - xa) / (xb - xa)) * (b - a);
    if (da <= 0 || water.length === 0) {
      close();
      water.push([xs0, at(xs0, wa, wb)]);
      ground.push([xs0, at(xs0, ga, gb)]);
    } else if (ground.length > 0 && ground[ground.length - 1][1] !== ga) {
      // Vertical face between intervals.
      ground.push([xa, ga]);
    }
    water.push([xs1, at(xs1, wa, wb)]);
    ground.push([xs1, at(xs1, ga, gb)]);
    if (db <= 0) close();
  }
  close();
  return ponds;
}

/**
 * The main piezometric line: it gives the pore pressure, and the free water
 * above the ground, of materials without a line of their own. The chosen
 * line, or the first one.
 */
export function mainPiezoLine<L extends { id: string }>(pl: {
  lines: L[];
  mainLineId?: string;
}): L | undefined {
  return pl.lines.find((l) => l.id === pl.mainLineId) ?? pl.lines[0];
}

/**
 * The free water standing on the ground, as the analysis loads it: over
 * each stretch of ground the water of the line that governs the material
 * just below the ground there (its assigned line, else the main line), the
 * same line that gives that material its pore pressure (as the engine
 * takes it; lines as passed to it in store/helpers.ts). Load and pore
 * pressure come from one water level (Duncan & Wright 2014, ch. 6).
 * Without `regions`, or without assigned lines, the main line's water.
 */
export function piezoPonds(
  piezo: {
    lines: { id: string; coordinates: Pt[] }[];
    mainLineId?: string;
    materialAssignment?: Record<string, string>;
  },
  model: Pt[],
  regions: readonly Region[] = [],
): Pond[] {
  const usable = piezo.lines.filter((l) => l.coordinates.length >= 2);
  const main = (mainPiezoLine({ lines: usable, mainLineId: piezo.mainLineId }) ?? piezo.lines[0])
    ?.coordinates;
  const mainLine = main && main.length >= 2 ? main : null;
  const own = new Map<string, Pt[]>();
  if (piezo.lines.length > 1) {
    for (const [materialId, lineId] of Object.entries(piezo.materialAssignment ?? {})) {
      const line = usable.find((l) => l.id === lineId);
      if (line) own.set(materialId, line.coordinates);
    }
  }
  if (own.size === 0 || regions.length === 0) return mainLine ? freeWaterPonds(mainLine, model) : [];
  const xs = model.map((p) => p[0]);
  const eps = 1e-6 * Math.max(1, Math.max(...xs) - Math.min(...xs));
  const lineAt = (x: number): Pt[] | null => {
    const g = surfaceYAtX(model, x);
    if (g === null) return mainLine;
    const y = g - eps;
    const region = regions.find(
      (r) =>
        isPointInPolygon(x, y, r.px, r.py) &&
        !r.holes?.some((h) => isPointInPolygon(x, y, h.px, h.py)),
    );
    return (region && own.get(region.materialId)) ?? mainLine;
  };
  const breaks = [
    ...regions.flatMap((r) => r.px),
    ...usable.flatMap((l) => l.coordinates.map((p) => p[0])),
  ];
  return surfaceWaterPonds(model, lineAt, breaks);
}

/**
 * Where "Add point" puts a new point of a piezometric line, always inside
 * the model's x extent: an empty line starts at the left edge at mid
 * height; a line that stops short of the model edge it runs towards (the
 * right edge for a line entered left to right, the left edge for one
 * entered right to left) is continued 5 m that way, at most to the edge;
 * otherwise the point goes in the middle of the widest gap between
 * neighbouring points. `index` is where to insert it.
 */
export function nextPiezoPoint(line: Pt[], model: Pt[]): { index: number; point: Pt } {
  const xs = model.map((c) => c[0]);
  const ys = model.map((c) => c[1]);
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 50;
  const midY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  if (line.length === 0) return { index: 0, point: [xMin, midY] };
  const last = line[line.length - 1];
  const eps = 1e-6;
  // The direction the line was entered in (one point: left to right).
  if (last[0] < line[0][0]) {
    if (last[0] > xMin + eps) {
      return { index: line.length, point: [Math.max(last[0] - 5, xMin), last[1]] };
    }
  } else if (last[0] < xMax - eps) {
    return { index: line.length, point: [Math.min(last[0] + 5, xMax), last[1]] };
  }
  if (line.length === 1) {
    return { index: 0, point: [Math.max(last[0] - 5, xMin), last[1]] };
  }
  let widest = 0;
  for (let i = 1; i < line.length - 1; i++) {
    if (Math.abs(line[i + 1][0] - line[i][0]) > Math.abs(line[widest + 1][0] - line[widest][0])) widest = i;
  }
  const [a, b] = [line[widest], line[widest + 1]];
  const round = (v: number) => Math.round(v * 100) / 100;
  return { index: widest + 1, point: [round((a[0] + b[0]) / 2), round((a[1] + b[1]) / 2)] };
}
