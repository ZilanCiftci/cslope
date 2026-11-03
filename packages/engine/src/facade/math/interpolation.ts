/** Facade shim of math/interpolation.ts (see facade/internal.ts). */
import { list, testCall, wasm } from "../internal";
import type { SpatialDataPoint } from "../../math/interpolation";

export type { SpatialDataPoint } from "../../math/interpolation";

export function getYAtX(polyX: number[], polyY: number[], x: number): number {
  return wasm().get_y_at_x(polyX, polyY, x);
}

export function getYAtXMany(polyX: number[], polyY: number[], xValues: number[]): number[] {
  return list(wasm().get_y_at_x_many(polyX, polyY, xValues));
}

export function getYAtXStrict(line: [number[], number[]], x: number): number {
  return wasm().get_y_at_x_strict(line[0], line[1], x);
}

export function getLineBetweenPoints(line: [number[], number[]], x1: number, x2: number): [number[], number[]] {
  return wasm().get_line_between_points(line[0], line[1], x1, x2);
}

export function interpolateIDW(points: SpatialDataPoint[], qx: number, qy: number, power?: number, eps?: number): number[] {
  return testCall("math/interpolation::interpolateIDW", [points, qx, qy, power, eps]);
}

export function interpolateNearest(points: SpatialDataPoint[], qx: number, qy: number): number[] {
  return testCall("math/interpolation::interpolateNearest", [points, qx, qy]);
}
