/**
 * Circle geometry calculations.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { list, orNull, pt, wasm } from "../facade/internal";

/**
 * Get the y-coordinate on the bottom of a circle at a given x.
 *
 * @param cx - Circle center x
 * @param cy - Circle center y
 * @param radius - Circle radius
 * @param x - x-coordinate to query
 * @returns y-coordinate on the lower arc
 */
export function getCircleYCoordinateAtX(cx: number, cy: number, radius: number, x: number): number {
  return wasm().get_circle_y_coordinate_at_x(cx, cy, radius, x);
}

/**
 * Get intersections between a circle and a polyline.
 *
 * @returns Array of [x, y] intersection points
 */
export function getCircleLineIntersections(cx: number, cy: number, r: number, px: number[], py: number[]): [number, number][] {
  return wasm().get_circle_line_intersections(cx, cy, r, px, py);
}

/**
 * Calculate circle radius from intersecting chord property.
 * a * b = c * d  →  R = (C + c²) / (2c)
 */
export function circleRadiusFromAbcd(cToE: number, C: number): number | null {
  return orNull(wasm().circle_radius_from_abcd(cToE, C));
}

/**
 * Calculate circle centre from chord intersection.
 */
export function circleCentre(beta: number, chordIntersection: [number, number], chordToCentre: number): [number, number] {
  return pt(wasm().circle_centre(beta, chordIntersection[0], chordIntersection[1], chordToCentre));
}

/**
 * Generate coordinates around the bottom half of a circle circumference.
 *
 * @param cx - Circle center x
 * @param cy - Circle center y
 * @param radius - Circle radius
 * @param numPoints - Number of points (default: 90)
 * @returns [x[], y[]] arrays
 */
export function generateCircleCoordinates(cx: number, cy: number, radius: number, numPoints: number = 90): [number[], number[]] {
  const [x, y] = wasm().generate_circle_coordinates(cx, cy, radius, numPoints) as [number[], number[]];
  return [list(x), list(y)];
}
