/**
 * Geometry operations for slope analysis: polygon splitting and region
 * polygonisation, with correct handling of concave polygons, collinear
 * edges, shared vertices and the other edge cases (PORTING.md, the
 * geometry decisions).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { list, testCall, wasm } from "../facade/internal";
import type { GeometryWithMaterial } from "../types/geometry";
import type { Material } from "../types/material";

export interface SplitPolygonResult {
  pieces: { px: number[]; py: number[] }[];
  splitFailed: boolean;
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

// ── internal (testing build) ─────────────────────────────────────

/**
 * Get the y-value of a polyline at a given x-coordinate.
 * Returns `undefined` if x is outside the polyline's x-range.
 */
export function polylineYAtX(lx: number[], ly: number[], x: number): number | undefined {
  return testCall("model/geometry-ops::polylineYAtX", [lx, ly, x]);
}

/**
 * Y-value of a polyline at x, approached from one side.
 *
 * Only non-vertical segments are considered, so at a vertical step the
 * "left" and "right" values differ.  Returns NaN when no segment on that
 * side contains x.
 */
export function polylineYAtSide(px: number[], py: number[], x: number, side: "left" | "right"): number {
  return testCall("model/geometry-ops::polylineYAtSide", [px, py, x, side]);
}

/**
 * y of a polyline at x approached from one side (at a vertical step the
 * two sides differ), or its plain value where that side has no segment.
 */
export function polylineYFrom(px: number[], py: number[], x: number, side: "left" | "right"): number {
  return testCall("model/geometry-ops::polylineYFrom", [px, py, x, side]);
}

/**
 * Clip a phreatic / piezometric line so that it never rises above the
 * ground surface: returns the pointwise minimum of the two polylines over
 * their common x-range, including the points where they cross.
 *
 * @returns The clipped line, or `null` when the x-ranges do not overlap.
 */
export function clipLineToSurface(wx: number[], wy: number[], sx: number[], sy: number[]): { x: number[]; y: number[] } | null {
  return testCall("model/geometry-ops::clipLineToSurface", [wx, wy, sx, sy]);
}

export function splitPolygonByPolylineDetailed(px: number[], py: number[], lx: number[], ly: number[]): SplitPolygonResult {
  return testCall("model/geometry-ops::splitPolygonByPolylineDetailed", [px, py, lx, ly]);
}

/** Materials cross as indices: their order of first appearance in `geometries`. */
export function materialLayerTopAt(geometries: readonly GeometryWithMaterial[], material: Material, x: number, y: number): number | null {
  const index = new Map<Material, number>();
  const wire = geometries.map((g) => {
    if (!index.has(g.material)) index.set(g.material, index.size);
    return { px: g.px, py: g.py, material: index.get(g.material), xMin: g.xMin, xMax: g.xMax, yMax: g.yMax };
  });
  return testCall("model/geometry-ops::materialLayerTopAt", [wire, index.get(material) ?? index.size, x, y]);
}

/**
 * Single closed ring for a polygon with holes: each hole is joined to the
 * outline by a zero-width bridge between their nearest vertices and
 * traversed in the opposite direction, so the shoelace area and even-odd
 * point tests treat it as a hole.
 */
export function keyholeRing(outer: [number, number][], holes: [number, number][][]): [number, number][] {
  return testCall("model/geometry-ops::keyholeRing", [outer, holes]);
}

/** polygonizeRegions that also reports a failed split. */
export function polygonizeRegionsDetailed(px: number[], py: number[], lines: [number, number][][]): RegionFacesResult {
  return testCall("model/geometry-ops::polygonizeRegionsDetailed", [px, py, lines]);
}
