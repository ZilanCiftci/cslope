/**
 * Polygon area and point-in-polygon calculations.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { wasm } from "../facade/internal";

/**
 * Calculate the area of a polygon using the Shoelace formula.
 *
 * @param x - x-coordinates of the polygon vertices
 * @param y - y-coordinates of the polygon vertices
 * @returns Area of the polygon (always positive)
 */
export function calculatePolygonArea(x: number[], y: number[]): number {
  return wasm().calculate_polygon_area(x, y);
}

/**
 * Determine if a point (px, py) is inside a polygon using ray casting.
 *
 * @param px - x-coordinate of the point
 * @param py - y-coordinate of the point
 * @param polyX - x-coordinates of the polygon vertices
 * @param polyY - y-coordinates of the polygon vertices
 * @returns true if the point is inside the polygon
 */
export function isPointInPolygon(px: number, py: number, polyX: number[], polyY: number[]): boolean {
  return wasm().is_point_in_polygon(px, py, polyX, polyY);
}

/**
 * Clip a polygon by a half-plane ax + by + c >= 0 (Sutherland–Hodgman).
 *
 * @returns Clipped polygon as [x[], y[]]
 */
export function clipPolygonHalfplane(px: number[], py: number[], a: number, b: number, c: number): [number[], number[]] {
  return wasm().clip_polygon_halfplane(px, py, a, b, c);
}

/**
 * Clip a polygon to a vertical strip [xMin, xMax].
 *
 * @returns Clipped polygon as [x[], y[]]
 */
export function clipPolygonVertical(polyX: number[], polyY: number[], xMin: number, xMax: number): [number[], number[]] {
  return wasm().clip_polygon_vertical(polyX, polyY, xMin, xMax);
}
