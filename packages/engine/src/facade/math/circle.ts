/** Facade shim of math/circle.ts (see facade/internal.ts). */
import { list, orNull, pt, wasm } from "../internal";

export function getCircleYCoordinateAtX(cx: number, cy: number, radius: number, x: number): number {
  return wasm().get_circle_y_coordinate_at_x(cx, cy, radius, x);
}

export function getCircleLineIntersections(cx: number, cy: number, r: number, px: number[], py: number[]): [number, number][] {
  return wasm().get_circle_line_intersections(cx, cy, r, px, py);
}

export function circleRadiusFromAbcd(cToE: number, C: number): number | null {
  return orNull(wasm().circle_radius_from_abcd(cToE, C));
}

export function circleCentre(beta: number, chordIntersection: [number, number], chordToCentre: number): [number, number] {
  return pt(wasm().circle_centre(beta, chordIntersection[0], chordIntersection[1], chordToCentre));
}

export function generateCircleCoordinates(cx: number, cy: number, radius: number, numPoints: number = 90): [number[], number[]] {
  const [x, y] = wasm().generate_circle_coordinates(cx, cy, radius, numPoints) as [number[], number[]];
  return [list(x), list(y)];
}
