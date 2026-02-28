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
// Side-effect import: patches Geometry.prototype with union/contains/intersects/etc.
import "jsts/org/locationtech/jts/monkey.js";

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

  // Pick the path with higher average y (= surface)
  const avgFwd = fwdY.reduce((s, v) => s + v, 0) / fwdY.length;
  const avgBwd = bwdY.reduce((s, v) => s + v, 0) / bwdY.length;

  return avgFwd >= avgBwd ? { x: fwdX, y: fwdY } : { x: bwdX, y: bwdY };
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
        const ring = p.getExteriorRing();
        const coords = ring.getCoordinates();
        results.push({
          px: coords.map((c: InstanceType<typeof Coordinate>) => c.x),
          py: coords.map((c: InstanceType<typeof Coordinate>) => c.y),
        });
      }
    }

    if (results.length === 0) {
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
  }
  return gm;
}
