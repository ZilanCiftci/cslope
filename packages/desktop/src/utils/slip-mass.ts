/**
 * Geometry for drawing a result: the ground surface between two points,
 * the sliding mass above a slip surface, the tension crack at its upslope
 * end and the slice lines split by material region. Shared by the canvas
 * (features/canvas/draw.ts) and the PDF (features/pdf/pdf-drawing.ts).
 */

import { isPointInPolygon } from "@cslope/engine";
import type { DrawableSurface } from "./arc";
import type { Region } from "./regions";

type Pt = [number, number];

/** Points closer than this (m) are the same point. */
const SAME_POINT = 1e-9;

/**
 * The top of the ground at x, approached from one side: "left" is the
 * limit from x − 0, "right" from x + 0. At a vertical face the two differ
 * (the top and the foot of the face); elsewhere both are the ground at x.
 * Null when no boundary segment reaches x from that side.
 */
export function groundYFromSide(
  coordinates: readonly Pt[],
  x: number,
  side: "left" | "right",
): number | null {
  let best: number | null = null;
  const n = coordinates.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = coordinates[i];
    const [x1, y1] = coordinates[(i + 1) % n];
    if (x0 === x1) continue;
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    const covers = side === "left" ? x > lo && x <= hi : x >= lo && x < hi;
    if (!covers) continue;
    const y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    if (best === null || y > best) best = y;
  }
  return best;
}

/** The ground at x from one side, or from the other when that side has none. */
function groundYPreferring(coordinates: readonly Pt[], x: number, side: "left" | "right"): number | null {
  return groundYFromSide(coordinates, x, side) ?? groundYFromSide(coordinates, x, side === "left" ? "right" : "left");
}

function pushPoint(out: Pt[], p: Pt): void {
  const last = out[out.length - 1];
  if (last && Math.abs(last[0] - p[0]) <= SAME_POINT && Math.abs(last[1] - p[1]) <= SAME_POINT) return;
  out.push(p);
}

/**
 * The ground surface (top of the exterior boundary) from `from` to `to`,
 * in that order, with both corners of every vertical face between them.
 * The end points are kept as they are: a point below the ground (the
 * bottom of a tension crack, a point on a vertical face) joins the ground
 * above or below it with a vertical segment.
 */
export function groundProfile(coordinates: readonly Pt[], from: Pt, to: Pt): Pt[] {
  const out: Pt[] = [];
  pushPoint(out, [from[0], from[1]]);
  const dir = Math.sign(to[0] - from[0]);
  if (dir === 0 || coordinates.length < 3) {
    pushPoint(out, [to[0], to[1]]);
    return out;
  }
  // Walking forward, the ground just after a point is its right limit and
  // just before it its left limit (mirrored walking backward).
  const ahead: "left" | "right" = dir > 0 ? "right" : "left";
  const behind: "left" | "right" = dir > 0 ? "left" : "right";
  const lo = Math.min(from[0], to[0]);
  const hi = Math.max(from[0], to[0]);

  const startY = groundYPreferring(coordinates, from[0], ahead);
  if (startY !== null) pushPoint(out, [from[0], startY]);

  const xs = [...new Set(coordinates.map((c) => c[0]).filter((x) => x > lo && x < hi))];
  xs.sort((a, b) => (a - b) * dir);
  for (const x of xs) {
    const before = groundYFromSide(coordinates, x, behind);
    const after = groundYFromSide(coordinates, x, ahead);
    if (before !== null) pushPoint(out, [x, before]);
    if (after !== null) pushPoint(out, [x, after]);
  }

  const endY = groundYPreferring(coordinates, to[0], behind);
  if (endY !== null) pushPoint(out, [to[0], endY]);
  pushPoint(out, [to[0], to[1]]);
  return out;
}

/**
 * The ground between two x positions, from the smaller to the larger, on
 * top of any vertical face at the ends. Empty when the ground does not
 * reach both.
 */
export function groundBetween(coordinates: readonly Pt[], xa: number, xb: number): Pt[] {
  const x1 = Math.min(xa, xb);
  const x2 = Math.max(xa, xb);
  const top = (x: number) => {
    const l = groundYFromSide(coordinates, x, "left");
    const r = groundYFromSide(coordinates, x, "right");
    if (l === null) return r;
    if (r === null) return l;
    return Math.max(l, r);
  };
  const y1 = top(x1);
  const y2 = top(x2);
  if (y1 === null || y2 === null) return [];
  return groundProfile(coordinates, [x1, y1], [x2, y2]);
}

/**
 * The sliding mass as a closed polygon: the ground from the entry to the
 * exit (both corners of every vertical face, and the crack face at a
 * tension crack), then the slip surface back from the exit to the entry.
 * `surfacePts` are the slip surface's points from entry to exit.
 */
export function slipMassPolygon(
  coordinates: readonly Pt[],
  surf: Pick<DrawableSurface, "entryPoint" | "exitPoint">,
  surfacePts: readonly Pt[],
): Pt[] {
  const top = groundProfile(coordinates, surf.entryPoint, surf.exitPoint);
  const out = [...top];
  for (let i = surfacePts.length - 1; i >= 0; i--) pushPoint(out, [surfacePts[i][0], surfacePts[i][1]]);
  // The polygon closes itself; drop a repeated first point.
  const first = out[0];
  const last = out[out.length - 1];
  if (out.length > 1 && Math.abs(first[0] - last[0]) <= SAME_POINT && Math.abs(first[1] - last[1]) <= SAME_POINT) out.pop();
  return out;
}

/**
 * Mean thickness of a closed polygon, 2·area / perimeter: for a thin
 * sliver about its width, so a shallow sliding mass can be recognised in
 * screen units.
 */
export function meanThickness(pts: readonly Pt[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let area2 = 0;
  let perimeter = 0;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % n];
    area2 += x0 * y1 - x1 * y0;
    perimeter += Math.hypot(x1 - x0, y1 - y0);
  }
  return perimeter > 0 ? Math.abs(area2) / perimeter : 0;
}

/** A tension crack at the upslope end of a slip surface. */
export interface TensionCrackFace {
  x: number;
  /** Ground level at the crack (m). */
  top: number;
  /** Crack bottom: the slip surface's entry (m). */
  bottom: number;
  /** +1 when the sliding mass lies at larger x than the crack, −1 otherwise. */
  massSide: 1 | -1;
}

/** Crack faces shallower than this (m) are taken as no crack. */
const MIN_CRACK_DEPTH = 1e-4;

/**
 * The tension crack of a surface, as the analysis reported it (`crack` of
 * the result). Null without one: an entry below the ground alone (on a
 * vertical face, a ditch wall, the model's side) is no crack, and results
 * saved before the crack was reported show none.
 */
export function tensionCrackFace(
  surf: Pick<DrawableSurface, "entryPoint" | "exitPoint"> & {
    crack?: { x: number; top: number; bottom: number };
  },
): TensionCrackFace | null {
  const c = surf.crack;
  if (!c || !(c.top - c.bottom >= MIN_CRACK_DEPTH)) return null;
  const massSide: 1 | -1 = surf.exitPoint[0] >= c.x ? 1 : -1;
  return { x: c.x, top: c.top, bottom: c.bottom, massSide };
}

/** A part of a vertical line inside one material region. */
export interface LineSegmentInRegion {
  /** Lower and upper y of the part (m). */
  y0: number;
  y1: number;
  /** The region it lies in, or null outside every region. */
  region: Region | null;
}

function insideRegion(region: Region, x: number, y: number): boolean {
  if (region.px.length < 3 || !isPointInPolygon(x, y, region.px, region.py)) return false;
  return !region.holes?.some((h) => h.px.length >= 3 && isPointInPolygon(x, y, h.px, h.py));
}

/**
 * Splits the vertical line at x from `yBottom` to `yTop` where it crosses
 * region boundaries, so each part can be drawn in a colour that stands out
 * against its region's fill. Neighbouring parts in the same region are
 * merged.
 */
export function splitVerticalByRegion(
  regions: readonly Region[],
  x: number,
  yBottom: number,
  yTop: number,
): LineSegmentInRegion[] {
  const lo = Math.min(yBottom, yTop);
  const hi = Math.max(yBottom, yTop);
  const cuts = [lo, hi];
  const addCrossings = (px: number[], py: number[]) => {
    const n = px.length;
    for (let i = 0; i < n; i++) {
      const x0 = px[i];
      const x1 = px[(i + 1) % n];
      if (x0 === x1) continue;
      if (!((x0 <= x && x < x1) || (x1 <= x && x < x0))) continue;
      const y = py[i] + ((x - x0) / (x1 - x0)) * (py[(i + 1) % n] - py[i]);
      if (y > lo && y < hi) cuts.push(y);
    }
  };
  for (const r of regions) {
    addCrossings(r.px, r.py);
    for (const h of r.holes ?? []) addCrossings(h.px, h.py);
  }
  cuts.sort((a, b) => a - b);
  const out: LineSegmentInRegion[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const y0 = cuts[i];
    const y1 = cuts[i + 1];
    if (y1 - y0 <= SAME_POINT) continue;
    const mid = (y0 + y1) / 2;
    const region = regions.find((r) => insideRegion(r, x, mid)) ?? null;
    const prev = out[out.length - 1];
    if (prev && prev.region === region) prev.y1 = y1;
    else out.push({ y0, y1, region });
  }
  return out;
}

/** Relative luminance (0 black – 1 white) of a CSS hex colour; null if not hex. */
export function colorLuminance(color: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/** Below this fill luminance slice lines are drawn light instead of black. */
const DARK_FILL_LUMINANCE = 0.18;

/** Whether lines over this fill colour should be light (the fill is dark). */
export function isDarkFill(color: string | undefined): boolean {
  if (!color) return false;
  const l = colorLuminance(color);
  return l !== null && l < DARK_FILL_LUMINANCE;
}

/**
 * How much to thin and fade slice lines that lie close together on screen:
 * 1 at `fullSpacing` or more, down to `minFactor` as the typical (median)
 * spacing shrinks, so dense slices don't merge into a solid fill.
 */
export function sliceDensityFactor(spacings: readonly number[], fullSpacing = 5, minFactor = 0.3): number {
  const s = spacings.filter((d) => d > 0).sort((a, b) => a - b);
  if (s.length === 0) return 1;
  const median = s[Math.floor(s.length / 2)];
  return Math.max(minFactor, Math.min(1, median / fullSpacing));
}

/**
 * The positions of the slice boundaries of a result, sorted, with the
 * on-screen spacing between neighbours (via `toScreenX`). Boundaries
 * closer than `minGap` on screen (coincident sides of neighbouring
 * slices, slices split at a layer vertex) are one line, not two drawn on
 * top of each other.
 */
export function sliceBoundaries(
  slices: readonly { xLeft: number; xRight: number }[],
  toScreenX: (x: number) => number,
  minGap = 0.5,
): { xs: number[]; spacings: number[] } {
  const sorted = [...new Set(slices.flatMap((s) => [s.xLeft, s.xRight]))].sort((a, b) => a - b);
  const xs: number[] = [];
  const spacings: number[] = [];
  for (const x of sorted) {
    if (xs.length > 0) {
      const d = Math.abs(toScreenX(x) - toScreenX(xs[xs.length - 1]));
      if (d < minGap) continue;
      spacings.push(d);
    }
    xs.push(x);
  }
  return { xs, spacings };
}

/**
 * The slice lines to draw: the boundaries (see sliceBoundaries) with every
 * other inner line left out while the typical spacing on screen is below
 * `minSpacing` (dense slices at a small scale would read as a solid
 * fill), and the thinning/fading factor for what is left
 * (sliceDensityFactor).
 */
export function sliceLines(
  slices: readonly { xLeft: number; xRight: number }[],
  toScreenX: (x: number) => number,
  minSpacing = 3,
): { xs: number[]; density: number } {
  let { xs, spacings } = sliceBoundaries(slices, toScreenX);
  const median = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] ?? Infinity;
  while (xs.length > 3 && median(spacings) < minSpacing) {
    const kept = xs.filter((_, i) => i % 2 === 0 || i === xs.length - 1);
    xs = kept;
    spacings = kept.slice(1).map((x, i) => Math.abs(toScreenX(x) - toScreenX(kept[i])));
  }
  return { xs, density: sliceDensityFactor(spacings) };
}

/** A search range from its two handles: numeric ends, whatever their order. */
export interface SearchRange {
  lo: number;
  hi: number;
  /** The two handles coincide (a range of zero width). */
  point: boolean;
}

export function searchRange(a: number, b: number): SearchRange {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return { lo, hi, point: hi - lo <= 1e-9 * Math.max(1, Math.abs(hi)) };
}

/** Whether two search ranges cover the same span. */
export function sameRange(a: SearchRange, b: SearchRange): boolean {
  const tol = 1e-9 * Math.max(1, Math.abs(a.hi), Math.abs(b.hi));
  return Math.abs(a.lo - b.lo) <= tol && Math.abs(a.hi - b.hi) <= tol;
}
