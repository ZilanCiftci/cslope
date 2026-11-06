/**
 * Polyline interpolation functions.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { list, wasm } from "../facade/internal";

/**
 * Get the y-coordinate on a polyline at a specific x-coordinate.
 * If multiple segments contain x, returns the average y.
 *
 * @param polyX - x-coordinates of the polyline
 * @param polyY - y-coordinates of the polyline
 * @param x - x-coordinate to query
 * @returns Interpolated y-coordinate, or NaN if out of bounds
 */
export function getYAtX(polyX: number[], polyY: number[], x: number): number {
  return wasm().get_y_at_x(polyX, polyY, x);
}

/**
 * Get y-coordinates on a polyline for multiple x-coordinates.
 *
 * @param polyX - x-coordinates of the polyline
 * @param polyY - y-coordinates of the polyline
 * @param xValues - x-coordinates to query
 * @returns Array of interpolated y-coordinates (NaN where out of bounds)
 */
export function getYAtXMany(polyX: number[], polyY: number[], xValues: number[]): number[] {
  return list(wasm().get_y_at_x_many(polyX, polyY, xValues));
}

/**
 * Get the y-coordinate on a line at x (strict — throws if out of bounds).
 * Mirrors utilities.get_y_at_x (the non-Numba version).
 *
 * @param line - [x[], y[]] polyline tuple
 * @param x - x-coordinate to query
 * @returns Interpolated y-coordinate
 * @throws If x is outside the line's bounds
 */
export function getYAtXStrict(line: [number[], number[]], x: number): number {
  return wasm().get_y_at_x_strict(line[0], line[1], x);
}

/**
 * Get the line segment between two x-coordinates on a polyline.
 *
 * @param line - [x[], y[]] polyline tuple
 * @param x1 - Starting x-coordinate
 * @param x2 - Ending x-coordinate
 * @returns [x[], y[]] of the segment
 */
export function getLineBetweenPoints(line: [number[], number[]], x1: number, x2: number): [number[], number[]] {
  return wasm().get_line_between_points(line[0], line[1], x1, x2);
}
