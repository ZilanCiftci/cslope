/**
 * Geometry operations for slope analysis.
 *
 * splitPolygonByPolyline uses JSTS (JavaScript Topology Suite) — a robust,
 * battle-tested geometry engine with correct handling of concave polygons,
 * collinear edges, shared vertices, and all other edge cases.
 */

// ── JSTS imports ──────────────────────────────────────────────────
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import Polygonizer from "jsts/org/locationtech/jts/operation/polygonize/Polygonizer.js";
import UnaryUnionOp from "jsts/org/locationtech/jts/operation/union/UnaryUnionOp.js";
import GeometryNoder from "jsts/org/locationtech/jts/noding/snapround/GeometryNoder.js";
import PrecisionModel from "jsts/org/locationtech/jts/geom/PrecisionModel.js";
import ArrayList from "jsts/java/util/ArrayList.js";
// Side-effect import: patches Geometry.prototype with union/contains/intersects/etc.
import "jsts/org/locationtech/jts/monkey.js";
import { getYAtX } from "../math/index";

/** Shared JSTS GeometryFactory instance. */
const gf = new GeometryFactory();

export interface SplitPolygonResult {
  pieces: { px: number[]; py: number[] }[];
  splitFailed: boolean;
}

// ── Line-segment intersection ─────────────────────────────────────

/**
 * Compute the intersection point of two line segments, if any.
 *
 * Uses parametric form: P = p1 + t*(p2 - p1), Q = p3 + u*(p4 - p3)
 * Returns the intersection point if 0 ≤ t ≤ 1 and 0 ≤ u ≤ 1.
 */
export function lineSegmentIntersection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  x4: number,
  y4: number,
): [number, number] | null {
  const dx1 = x2 - x1;
  const dy1 = y2 - y1;
  const dx2 = x4 - x3;
  const dy2 = y4 - y3;
  const denom = dx1 * dy2 - dy1 * dx2;

  if (Math.abs(denom) < 1e-12) return null; // parallel / collinear

  const t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / denom;
  const u = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / denom;

  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;

  return [x1 + t * dx1, y1 + t * dy1];
}

// ── Polyline Y-interpolation (for splitting) ──────────────────────

/**
 * Get the y-value of a polyline at a given x-coordinate.
 * Returns `undefined` if x is outside the polyline's x-range.
 */
export function polylineYAtX(
  lx: number[],
  ly: number[],
  x: number,
): number | undefined {
  const xMin = lx[0] <= lx[lx.length - 1] ? lx[0] : lx[lx.length - 1];
  const xMax = lx[0] >= lx[lx.length - 1] ? lx[0] : lx[lx.length - 1];
  if (x < xMin - 1e-9 || x > xMax + 1e-9) return undefined;

  for (let i = 0; i < lx.length - 1; i++) {
    const segXMin = Math.min(lx[i], lx[i + 1]);
    const segXMax = Math.max(lx[i], lx[i + 1]);
    if (x >= segXMin - 1e-9 && x <= segXMax + 1e-9) {
      if (Math.abs(lx[i + 1] - lx[i]) < 1e-12) return (ly[i] + ly[i + 1]) / 2;
      const t = (x - lx[i]) / (lx[i + 1] - lx[i]);
      return ly[i] + t * (ly[i + 1] - ly[i]);
    }
  }
  return undefined;
}

// ── getSurfaceLine ────────────────────────────────────────────────

/**
 * Extract the upper (surface) boundary of a polygon.
 *
 * Replaces `utilities.get_surface_line(Polygon)`.
 *
 * Algorithm:
 * 1. Find the leftmost (min-x, max-y) and rightmost (max-x, max-y) vertices.
 * 2. Walk the polygon boundary in both directions between these vertices.
 * 3. Return the path with the higher average y (= upper boundary).
 *
 * @param px Polygon x-coordinates (may be closed or open).
 * @param py Polygon y-coordinates.
 * @returns Surface line as sorted {x, y} arrays.
 */
export function getSurfaceLine(
  px: number[],
  py: number[],
): { x: number[]; y: number[] } {
  let n = px.length;
  if (n < 3) throw new Error("Polygon must have at least 3 vertices");

  // Remove closing vertex if present
  if (
    Math.abs(px[0] - px[n - 1]) < 1e-12 &&
    Math.abs(py[0] - py[n - 1]) < 1e-12
  ) {
    n -= 1;
  }

  // Find leftmost vertex (min x, tie-break max y)
  let leftIdx = 0;
  for (let i = 1; i < n; i++) {
    if (px[i] < px[leftIdx] || (px[i] === px[leftIdx] && py[i] > py[leftIdx])) {
      leftIdx = i;
    }
  }

  // Find rightmost vertex (max x, tie-break max y)
  let rightIdx = 0;
  for (let i = 1; i < n; i++) {
    if (
      px[i] > px[rightIdx] ||
      (px[i] === px[rightIdx] && py[i] > py[rightIdx])
    ) {
      rightIdx = i;
    }
  }

  // Walk forward from leftIdx → rightIdx
  const fwdX: number[] = [];
  const fwdY: number[] = [];
  let idx = leftIdx;
  for (;;) {
    fwdX.push(px[idx]);
    fwdY.push(py[idx]);
    if (idx === rightIdx) break;
    idx = (idx + 1) % n;
  }

  // Walk backward from leftIdx → rightIdx
  const bwdX: number[] = [];
  const bwdY: number[] = [];
  idx = leftIdx;
  for (;;) {
    bwdX.push(px[idx]);
    bwdY.push(py[idx]);
    if (idx === rightIdx) break;
    idx = (((idx - 1) % n) + n) % n;
  }

  // Pick the path with higher average y (= surface).  Average over x,
  // not over vertices: a densely digitised stretch must not outweigh the
  // rest of the path.
  const avgFwd = averageYOverX(fwdX, fwdY);
  const avgBwd = averageYOverX(bwdX, bwdY);

  return avgFwd >= avgBwd ? { x: fwdX, y: fwdY } : { x: bwdX, y: bwdY };
}

// ── clipLineToSurface ─────────────────────────────────────────────

/**
 * Y-value of a polyline at x, approached from one side.
 *
 * Only non-vertical segments are considered, so at a vertical step the
 * "left" and "right" values differ.  Returns NaN when no segment on that
 * side contains x.
 */
export function polylineYAtSide(
  px: number[],
  py: number[],
  x: number,
  side: "left" | "right",
): number {
  for (let i = 0; i < px.length - 1; i++) {
    const a = Math.min(px[i], px[i + 1]);
    const b = Math.max(px[i], px[i + 1]);
    if (b - a < 1e-12) continue;
    const inside = side === "left" ? a < x && x <= b : a <= x && x < b;
    if (inside) {
      const t = (x - px[i]) / (px[i + 1] - px[i]);
      return py[i] + t * (py[i + 1] - py[i]);
    }
  }
  return NaN;
}

/**
 * y of a polyline at x approached from one side (at a vertical step the
 * two sides differ), or its plain value where that side has no segment.
 */
export function polylineYFrom(
  px: number[],
  py: number[],
  x: number,
  side: "left" | "right",
): number {
  const y = polylineYAtSide(px, py, x, side);
  return Number.isFinite(y) ? y : getYAtX(px, py, x);
}

/**
 * Clip a phreatic / piezometric line so that it never rises above the
 * ground surface: returns the pointwise minimum of the two polylines over
 * their common x-range, including the points where they cross.
 *
 * @returns The clipped line, or `null` when the x-ranges do not overlap.
 */
export function clipLineToSurface(
  wx: number[],
  wy: number[],
  sx: number[],
  sy: number[],
): { x: number[]; y: number[] } | null {
  if (wx.length < 2 || sx.length < 2) return null;
  const lo = Math.max(Math.min(...wx), Math.min(...sx));
  const hi = Math.min(Math.max(...wx), Math.max(...sx));
  if (!(hi - lo > 1e-12)) return null;

  const breaks = [...wx, ...sx, lo, hi]
    .filter((x) => x >= lo && x <= hi)
    .sort((a, b) => a - b)
    .filter((x, i, arr) => i === 0 || x - arr[i - 1] > 1e-9);

  const evalSide = (
    px: number[],
    py: number[],
    x: number,
    side: "left" | "right",
  ) => {
    const v = polylineYAtSide(px, py, x, side);
    return Number.isFinite(v)
      ? v
      : polylineYAtSide(px, py, x, side === "left" ? "right" : "left");
  };

  const outX: number[] = [];
  const outY: number[] = [];
  const push = (x: number, y: number) => {
    const n = outX.length;
    if (
      n > 0 &&
      Math.abs(outX[n - 1] - x) < 1e-9 &&
      Math.abs(outY[n - 1] - y) < 1e-9
    )
      return;
    outX.push(x);
    outY.push(y);
  };

  let prevX = NaN;
  let prevDiff = NaN;
  for (const x of breaks) {
    const wL = evalSide(wx, wy, x, "left");
    const wR = evalSide(wx, wy, x, "right");
    const sL = evalSide(sx, sy, x, "left");
    const sR = evalSide(sx, sy, x, "right");

    // Crossing strictly between the previous breakpoint and this one.
    const diffL = wL - sL;
    if (Number.isFinite(prevDiff) && prevDiff * diffL < 0) {
      const xc = prevX + ((x - prevX) * prevDiff) / (prevDiff - diffL);
      push(xc, evalSide(wx, wy, xc, "right"));
    }

    push(x, Math.min(wL, sL));
    push(x, Math.min(wR, sR));
    prevX = x;
    prevDiff = wR - sR;
  }

  return outX.length >= 2 ? { x: outX, y: outY } : null;
}

/** Mean y of a path weighted by horizontal extent (vertex mean if vertical). */
function averageYOverX(px: number[], py: number[]): number {
  let area = 0;
  let span = 0;
  for (let i = 0; i < px.length - 1; i++) {
    const dx = Math.abs(px[i + 1] - px[i]);
    area += ((py[i] + py[i + 1]) / 2) * dx;
    span += dx;
  }
  if (span > 1e-12) return area / span;
  return py.reduce((s, v) => s + v, 0) / py.length;
}

// ── splitPolygonByPolyline (JSTS-based) ───────────────────────────

/**
 * Split a polygon into pieces along a polyline, using JSTS.
 *
 * Algorithm:
 * 1. Node the polygon boundary with the cutting line (union inserts
 *    intersection vertices into both geometries).
 * 2. Polygonize the noded edges to rebuild closed polygons.
 * 3. Filter to keep only polygons whose interior lies inside the original.
 *
 * Correctly handles concave polygons, multiple crossings, collinear
 * edges, and shared vertices — all cases that tripped up the hand-rolled
 * implementation.
 *
 * @param px Polygon x-coordinates (closed, first == last).
 * @param py Polygon y-coordinates (closed, first == last).
 * @param lx Polyline x-coordinates.
 * @param ly Polyline y-coordinates.
 * @returns Array of polygon pieces as {px, py} (closed).
 *          Returns [original] if the polyline doesn't split the polygon.
 */
export function splitPolygonByPolyline(
  px: number[],
  py: number[],
  lx: number[],
  ly: number[],
): { px: number[]; py: number[] }[] {
  return splitPolygonByPolylineDetailed(px, py, lx, ly).pieces;
}

export function splitPolygonByPolylineDetailed(
  px: number[],
  py: number[],
  lx: number[],
  ly: number[],
): SplitPolygonResult {
  // Ensure polygon is closed
  const cpx = [...px];
  const cpy = [...py];
  if (
    Math.abs(cpx[0] - cpx[cpx.length - 1]) > 1e-12 ||
    Math.abs(cpy[0] - cpy[cpy.length - 1]) > 1e-12
  ) {
    cpx.push(cpx[0]);
    cpy.push(cpy[0]);
  }

  // Build JSTS geometries
  const polyCoords = cpx.map((x, i) => new Coordinate(x, cpy[i]));
  const polygon = gf.createPolygon(gf.createLinearRing(polyCoords));

  const lineCoords = lx.map((x, i) => new Coordinate(x, ly[i]));
  if (lineCoords.length < 2) {
    return { pieces: [{ px: cpx, py: cpy }], splitFailed: false };
  }
  const line = gf.createLineString(lineCoords);

  // Quick bail-out if line doesn't touch the polygon
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(polygon as any).intersects(line)) {
    return { pieces: [{ px: cpx, py: cpy }], splitFailed: false };
  }

  try {
    // Node the polygon boundary with the cutting line
    const boundary = polygon.getBoundary();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noded = (boundary as any).union(line);

    // Polygonize the noded edges
    const polygonizer = new Polygonizer();
    polygonizer.add(noded);
    const polys = polygonizer.getPolygons();

    // Filter to polygons inside the original
    const results: { px: number[]; py: number[] }[] = [];
    const arr = polys.array; // JSTS ArrayList backs onto a plain JS array
    for (let i = 0; i < arr.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const p = arr[i] as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((polygon as any).contains(p.getInteriorPoint())) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toXY = (ring: any): [number, number][] =>
          ring
            .getCoordinates()
            .map((c: InstanceType<typeof Coordinate>) => [c.x, c.y]);
        const holes: [number, number][][] = [];
        for (let h = 0; h < p.getNumInteriorRing(); h++) {
          holes.push(toXY(p.getInteriorRingN(h)));
        }
        // A piece around a closed boundary (lens) has a hole. The engine's
        // polygons are single rings, so cut the hole in through a bridge;
        // dropping it made the lens count twice (weight) and gave its
        // slices the surrounding material.
        const ring = keyholeRing(toXY(p.getExteriorRing()), holes);
        results.push({ px: ring.map((c) => c[0]), py: ring.map((c) => c[1]) });
      }
    }

    if (results.length === 0) {
      return { pieces: [{ px: cpx, py: cpy }], splitFailed: false };
    }

    // Only accept a clean split: no sliver pieces and the pieces add up
    // to the original. Re-splitting with a line that runs along an
    // existing edge produced zero-area and duplicated "phantom" pieces.
    const parentArea = Math.abs(signedArea(cpx.map((x, i) => [x, cpy[i]])));
    const areas = results.map((r) =>
      Math.abs(signedArea(r.px.map((x, i) => [x, r.py[i]]))),
    );
    const eps = 1e-9 * Math.max(1, parentArea);
    const total = areas.reduce((s, a) => s + a, 0);
    if (
      results.length > 1 &&
      (areas.some((a) => a <= eps) ||
        Math.abs(total - parentArea) > 1e-6 * Math.max(1, parentArea))
    ) {
      return { pieces: [{ px: cpx, py: cpy }], splitFailed: false };
    }

    // Sort by average y descending so upper (surface-side) pieces come first,
    // matching the expected order for slope analysis.
    results.sort((a, b) => {
      const avgA = a.py.reduce((s, v) => s + v, 0) / a.py.length;
      const avgB = b.py.reduce((s, v) => s + v, 0) / b.py.length;
      return avgB - avgA;
    });

    return { pieces: results, splitFailed: false };
  } catch (error) {
    // If JSTS fails for any reason, return the original polygon unsplit,
    // but make the failure explicit for diagnostics.
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn(
      "splitPolygonByPolyline: JSTS split failed, returning original polygon unsplit.",
      {
        polygonVertexCount: cpx.length,
        polylineVertexCount: lx.length,
        error: errorMessage,
      },
    );
    return { pieces: [{ px: cpx, py: cpy }], splitFailed: true };
  }
}

// ── Helper: Create a GeometryWithMaterial ─────────────────────────

import type { GeometryWithMaterial } from "../types/geometry";
import type { Material } from "../types/material";

/**
 * Factory function to create a GeometryWithMaterial from coordinates.
 */
export function createGeometryWithMaterial(
  px: number[],
  py: number[],
  material: Material,
  calculateBounds = true,
): GeometryWithMaterial {
  const gm: GeometryWithMaterial = { px: [...px], py: [...py], material };
  if (calculateBounds && px.length > 0) {
    gm.xMin = Math.min(...px);
    gm.xMax = Math.max(...px);
    gm.yMax = Math.max(...py);
  }
  return gm;
}

// ── Top of a material layer ───────────────────────────────────────

/**
 * Vertical extents [bottom, top] of a polygon on the line at x, appended
 * to `out`. Edges are taken half-open in x so that a vertex on the line is
 * counted once; vertical edges never cross it.
 */
function verticalExtentsAt(
  px: readonly number[],
  py: readonly number[],
  x: number,
  out: [number, number][],
): void {
  const ys: number[] = [];
  const n = px.length;
  for (let i = 0; i < n; i++) {
    const j = i + 1 < n ? i + 1 : 0;
    const xi = px[i];
    const xj = px[j];
    if ((xi <= x && x < xj) || (xj <= x && x < xi)) {
      ys.push(py[i] + ((x - xi) * (py[j] - py[i])) / (xj - xi));
    }
  }
  if (ys.length < 2) return;
  ys.sort((a, b) => a - b);
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]]);
}

/**
 * Elevation of the top of the layer of `material` at the point (x, y):
 * the highest y reached by going straight up from the point while staying
 * inside regions of that material. Adjoining regions of the same material
 * (a layer split by another boundary line) count as one layer; a lens of
 * the same material higher up, separated by another material, does not.
 * For the uppermost material this is the ground surface.
 *
 * @returns The layer top, or null when the point is not inside `material`.
 */
export function materialLayerTopAt(
  geometries: readonly GeometryWithMaterial[],
  material: Material,
  x: number,
  y: number,
): number | null {
  const extents: [number, number][] = [];
  for (const g of geometries) {
    if (g.material !== material) continue;
    if (g.xMin !== undefined && g.xMax !== undefined && (x < g.xMin || x > g.xMax)) {
      continue;
    }
    verticalExtentsAt(g.px, g.py, x, extents);
  }
  if (extents.length === 0) return null;
  const tol = (v: number) => 1e-6 * Math.max(1, Math.abs(v));
  let top: number | null = null;
  for (const [lo, hi] of extents) {
    if (y >= lo - tol(lo) && y <= hi + tol(hi) && (top === null || hi > top)) top = hi;
  }
  if (top === null) return null;
  // Climb through same-material regions stacked directly on top.
  extents.sort((a, b) => a[0] - b[0]);
  for (const [lo, hi] of extents) {
    if (lo <= top + tol(top) && hi > top) top = hi;
  }
  return top;
}

function signedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

/**
 * Single closed ring for a polygon with holes: each hole is joined to the
 * outline by a zero-width bridge between their nearest vertices and
 * traversed in the opposite direction, so the shoelace area and even-odd
 * point tests treat it as a hole.
 */
export function keyholeRing(
  outer: [number, number][],
  holes: [number, number][][],
): [number, number][] {
  const open = (r: [number, number][]) =>
    r.length > 1 &&
    r[0][0] === r[r.length - 1][0] &&
    r[0][1] === r[r.length - 1][1]
      ? r.slice(0, -1)
      : [...r];
  let ring = open(outer);
  const outerSign = Math.sign(signedArea(ring));
  for (const rawHole of holes) {
    let hole = open(rawHole);
    if (hole.length < 3) continue;
    if (Math.sign(signedArea(hole)) === outerSign) hole = hole.reverse();
    let bi = 0;
    let bj = 0;
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      for (let j = 0; j < hole.length; j++) {
        const d =
          (ring[i][0] - hole[j][0]) ** 2 + (ring[i][1] - hole[j][1]) ** 2;
        if (d < best) {
          best = d;
          bi = i;
          bj = j;
        }
      }
    }
    const holeLoop = [...hole.slice(bj), ...hole.slice(0, bj), hole[bj]];
    ring = [
      ...ring.slice(0, bi + 1),
      ...holeLoop,
      ring[bi],
      ...ring.slice(bi + 1),
    ];
  }
  return [...ring, ring[0]];
}

/** A face of the slope cut by all material boundaries. */
export interface RegionFace {
  outer: [number, number][];
  holes: [number, number][][];
}

/** Faces of the slope, and whether noding the boundaries failed. */
export interface RegionFacesResult {
  faces: RegionFace[];
  /** True when the boundaries could not be noded (slope left unsplit). */
  failed: boolean;
  /**
   * Indices (into the given lines) of boundaries with an end that lies
   * inside the slope, off the outline and off every other boundary, after
   * snapping (see END_SNAP_TOLERANCE). Such an end does not split the
   * region it lies in.
   */
  danglingBoundaries: number[];
}

/**
 * Cut the slope polygon by all boundary polylines at once and return the
 * faces inside it (with holes for enclosed lenses).
 *
 * Noding every line together makes the result independent of the order
 * of the boundaries and avoids re-splitting already split pieces (which
 * produced slivers and duplicate pieces). The canvas and the engine both
 * use this, so the regions shown are the regions analysed.
 */
export function polygonizeRegions(
  px: number[],
  py: number[],
  lines: [number, number][][],
): RegionFace[] {
  return polygonizeRegionsDetailed(px, py, lines).faces;
}

/**
 * Relative tolerances of the region split (fractions of the model size).
 *
 * END_SNAP_TOLERANCE: a boundary end this close to the outline or to
 * another boundary is put on the nearest point of it. An end short of the
 * model edge or of the boundary it meets (by a rounding error, or a
 * millimetre in a hand-edited or imported file) left the boundary
 * dangling, and the layer below it was silently not split off: one
 * region, the first material throughout. 1e-3 of the model size (4 cm on
 * a 40 m model) is a geometric tolerance of the drawing, as in the
 * endpoint snapping of CAD and GIS line cleaning; it is not fitted to any
 * result. An end farther away is left as drawn and reported in
 * `danglingBoundaries`.
 *
 * SNAP_ROUNDING_GRID: the grid of snap rounding when plain noding fails.
 * DANGLE_TOLERANCE: an end this close to a line counts as on it.
 */
const END_SNAP_TOLERANCE = 1e-3;
const DANGLE_TOLERANCE = 1e-9;
const SNAP_ROUNDING_GRID = 1e-9;
/** The faces must cover the slope to this fraction of its area. */
const COVERAGE_TOLERANCE = 1e-6;

/** A JTS ArrayList of the items (GeometryNoder takes a Java collection). */
function arrayListOf<T>(items: T[]): unknown {
  const list = new (ArrayList as unknown as new () => { add(item: unknown): void })();
  for (const item of items) list.add(item);
  return list;
}

/** The point of the ring nearest to (x, y), and its distance. */
function nearestOnRing(ring: [number, number][], x: number, y: number): { p: [number, number]; d: number } {
  let best: { p: [number, number]; d: number } = { p: [x, y], d: Infinity };
  for (let i = 0; i + 1 < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const p: [number, number] = [ax + t * dx, ay + t * dy];
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < best.d) best = { p, d };
  }
  return best;
}

/**
 * The point of the other lines nearest to the end `which` of line k (its
 * own segments count too, except the one the end belongs to, so that a
 * lens drawn with a small gap closes).
 */
function nearestOnLines(
  lines: [number, number][][],
  k: number,
  which: "first" | "last",
): { p: [number, number]; d: number } {
  const l = lines[k];
  const [x, y] = which === "first" ? l[0] : l[l.length - 1];
  let best: { p: [number, number]; d: number } = { p: [x, y], d: Infinity };
  for (let j = 0; j < lines.length; j++) {
    let line = lines[j];
    if (j === k) {
      line = which === "first" ? l.slice(1) : l.slice(0, -1);
      if (line.length < 2) continue;
    }
    const r = nearestOnRing(line, x, y);
    if (r.d < best.d) best = r;
  }
  return best;
}

/** True when the polyline is closed (a lens); a closed line has no ends. */
function isClosedLine(l: [number, number][]): boolean {
  return l.length > 2 && l[0][0] === l[l.length - 1][0] && l[0][1] === l[l.length - 1][1];
}

/**
 * Put each boundary end within `tol` of the outline or of another boundary
 * on the nearest point of it. Ends nearest the outline are snapped first,
 * then ends nearest a boundary, onto the boundaries as already snapped (a
 * T-junction then meets the line it ends on where that line now runs).
 */
function snapBoundaryEnds(
  ring: [number, number][],
  lines: [number, number][][],
  tol: number,
): [number, number][][] {
  const out = lines.map((l) => l.map((p): [number, number] => [p[0], p[1]]));
  const endOf = (l: [number, number][], which: "first" | "last") => (which === "first" ? l[0] : l[l.length - 1]);
  const set = (k: number, which: "first" | "last", p: [number, number]) => {
    out[k][which === "first" ? 0 : out[k].length - 1] = p;
  };
  const toLines: { k: number; which: "first" | "last" }[] = [];
  for (let k = 0; k < out.length; k++) {
    if (isClosedLine(out[k])) continue;
    for (const which of ["first", "last"] as const) {
      const [x, y] = endOf(out[k], which);
      const onRing = nearestOnRing(ring, x, y);
      const onLine = nearestOnLines(lines, k, which);
      if (onRing.d <= onLine.d) {
        if (onRing.d > 0 && onRing.d <= tol) set(k, which, onRing.p);
      } else if (onLine.d > 0 && onLine.d <= tol) {
        toLines.push({ k, which });
      }
    }
  }
  for (const { k, which } of toLines) {
    const { p, d } = nearestOnLines(out, k, which);
    if (d > 0 && d <= tol) set(k, which, p);
  }
  return out;
}

/**
 * Indices of the lines with an end strictly inside the polygon and more
 * than `tol` from the outline and from every other line.
 */
function danglingLines(
  polygon: unknown,
  ring: [number, number][],
  lines: [number, number][][],
  tol: number,
): number[] {
  const result: number[] = [];
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    if (isClosedLine(l)) continue;
    const dangles = (["first", "last"] as const).some((which) => {
      const [x, y] = which === "first" ? l[0] : l[l.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (!(polygon as any).contains(gf.createPoint(new Coordinate(x, y)))) return false;
      return nearestOnRing(ring, x, y).d > tol && nearestOnLines(lines, k, which).d > tol;
    });
    if (dangles) result.push(k);
  }
  return result;
}

/**
 * Cut the ring by the lines: node all linework, polygonize, and keep the
 * faces inside the ring. With `grid`, noding is by snap rounding on that
 * grid (Hobby 1999, as JTS implements it), which is robust where plain
 * floating-point noding throws or loses faces (a boundary vertex on the
 * outline, a boundary through a vertex of the outline).
 */
function polygonizeOnce(
  polygon: unknown,
  ring: [number, number][],
  lines: [number, number][][],
  grid: number | null,
): { faces: RegionFace[]; dangles: number } {
  const lineStrings = [
    gf.createLineString(ring.map(([x, y]) => new Coordinate(x, y))),
    ...lines.map((l) => gf.createLineString(l.map(([x, y]) => new Coordinate(x, y)))),
  ];
  const polygonizer = new Polygonizer();
  if (grid === null) {
    // One unary union nodes everything at once (a union per line was
    // quadratic: 150 ms for 50 layers, recomputed while dragging).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    polygonizer.add((UnaryUnionOp as any).union(gf.createMultiLineString(lineStrings)));
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noded: any = new GeometryNoder(new PrecisionModel(1 / grid)).node(arrayListOf(lineStrings));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const merged: any = (UnaryUnionOp as any).union(gf.createMultiLineString(noded.toArray()));
    polygonizer.add(merged);
  }
  const parentArea = Math.abs(signedArea(ring));
  const faces: RegionFace[] = [];
  const arr = polygonizer.getPolygons().array;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toXY = (r: any): [number, number][] => r.getCoordinates().map((c: InstanceType<typeof Coordinate>) => [c.x, c.y]);
  for (let i = 0; i < arr.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = arr[i] as any;
    if (p.getArea() <= 1e-9 * Math.max(1, parentArea)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!(polygon as any).contains(p.getInteriorPoint())) continue;
    const holes: [number, number][][] = [];
    for (let h = 0; h < p.getNumInteriorRing(); h++) holes.push(toXY(p.getInteriorRingN(h)));
    faces.push({ outer: toXY(p.getExteriorRing()), holes });
  }
  // A boundary end not exactly on the outline or another boundary is a
  // dangle: plain noding leaves it unsplit (and the faces still cover the
  // slope, so only the dangle shows it).
  return { faces, dangles: polygonizer.getDangles().size() };
}

/** Area of the faces (outer rings less holes). */
function facesArea(faces: RegionFace[]): number {
  return faces.reduce(
    (sum, f) => sum + Math.abs(signedArea(f.outer)) - f.holes.reduce((h, r) => h + Math.abs(signedArea(r)), 0),
    0,
  );
}

/** polygonizeRegions that also reports a failed split. */
export function polygonizeRegionsDetailed(
  px: number[],
  py: number[],
  lines: [number, number][][],
): RegionFacesResult {
  const ring: [number, number][] = px.map((x, i) => [x, py[i]]);
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push([ring[0][0], ring[0][1]]);
  }
  if (ring.length < 4) return { faces: [], failed: false, danglingBoundaries: [] };
  const polygon = gf.createPolygon(
    gf.createLinearRing(ring.map(([x, y]) => new Coordinate(x, y))),
  );
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1e-9);
  // Boundary ends near the outline or another boundary are put on it.
  const indices = lines.map((_, i) => i).filter((i) => lines[i].length >= 2);
  const usable = snapBoundaryEnds(ring, indices.map((i) => lines[i]), END_SNAP_TOLERANCE * size);
  const dangling = danglingLines(polygon, ring, usable, DANGLE_TOLERANCE * size).map((k) => indices[k]);
  const toFace = (outer: [number, number][], failed = false): RegionFacesResult => ({
    faces: [{ outer, holes: [] }],
    failed,
    danglingBoundaries: dangling,
  });
  if (usable.length === 0) return toFace(ring);

  const parentArea = Math.abs(signedArea(ring));
  const covers = (faces: RegionFace[]) =>
    faces.length > 0 && Math.abs(facesArea(faces) - parentArea) <= COVERAGE_TOLERANCE * parentArea;

  // Plain noding first: exact where it works (no dangles, the slope
  // covered).
  let plain: RegionFace[] | null = null;
  try {
    const r = polygonizeOnce(polygon, ring, usable, null);
    if (covers(r.faces)) {
      if (r.dangles === 0) return { faces: r.faces, failed: false, danglingBoundaries: dangling };
      plain = r.faces;
    }
  } catch {
    // snap rounding below
  }
  // Snap rounding where plain noding throws, loses a face or leaves a
  // boundary end unsplit (an end on a sloping edge or on another boundary
  // is off it by a rounding error). It runs about a local origin, so that
  // the grid suits the model's size also at large map coordinates. A
  // dangle left after it is a boundary that really ends inside a region.
  try {
    const [ox, oy] = [Math.min(...xs), Math.min(...ys)];
    const local = (pts: [number, number][]) => pts.map(([x, y]): [number, number] => [x - ox, y - oy]);
    const back = (pts: [number, number][]) => pts.map(([x, y]): [number, number] => [x + ox, y + oy]);
    const localPolygon = gf.createPolygon(gf.createLinearRing(local(ring).map(([x, y]) => new Coordinate(x, y))));
    const r = polygonizeOnce(localPolygon, local(ring), usable.map(local), SNAP_ROUNDING_GRID * size);
    const faces = r.faces.map((f) => ({ outer: back(f.outer), holes: f.holes.map(back) }));
    // Taken only when it splits more than plain noding did: a boundary
    // that really ends inside a region keeps the exact plain faces.
    if (covers(faces) && (!plain || faces.length > plain.length)) {
      return { faces, failed: false, danglingBoundaries: dangling };
    }
  } catch {
    // fall back to the plain faces, if they cover the slope
  }
  if (plain) return { faces: plain, failed: false, danglingBoundaries: dangling };
  console.warn("polygonizeRegions failed; using the unsplit slope.");
  return toFace(ring, true);
}
