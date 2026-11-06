/**
 * Geometry operations for slope analysis: polygon splitting and region
 * polygonisation, with correct handling of concave polygons, collinear
 * edges, shared vertices and the other edge cases (PORTING.md, the
 * geometry decisions).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { list, wasm } from "../facade/internal";
import type { GeometryWithMaterial } from "../types/geometry";
import type { Material } from "../types/material";

/** A face of the slope cut by all material boundaries. */
export interface RegionFace {
  outer: [number, number][];
  holes: [number, number][][];
}

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
  const p = wasm().line_segment_intersection(x1, y1, x2, y2, x3, y3, x4, y4);
  return p ? [p[0], p[1]] : null;
}

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
export function getSurfaceLine(px: number[], py: number[]): { x: number[]; y: number[] } {
  return wasm().get_surface_line(px, py);
}

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
export function splitPolygonByPolyline(px: number[], py: number[], lx: number[], ly: number[]): { px: number[]; py: number[] }[] {
  return wasm().split_polygon_by_polyline(px, py, lx, ly);
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
export function polygonizeRegions(px: number[], py: number[], lines: [number, number][][]): RegionFace[] {
  return wasm().polygonize_regions(px, py, lines);
}

/**
 * Factory function to create a GeometryWithMaterial from coordinates.
 */
export function createGeometryWithMaterial(px: number[], py: number[], material: Material, calculateBounds = true): GeometryWithMaterial {
  const gm: GeometryWithMaterial = { px: [...px], py: [...py], material };
  if (calculateBounds) {
    const b = list(wasm().geometry_bounds(px, py));
    if (b.length === 3) [gm.xMin, gm.xMax, gm.yMax] = b;
  }
  return gm;
}
