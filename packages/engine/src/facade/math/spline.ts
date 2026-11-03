/** Facade shim of math/spline.ts (internal functions: testing build). */
import { list, testCall } from "../internal";
import type { CubicSpline } from "../../math/spline";

export type { CubicSpline } from "../../math/spline";

interface WireSpline {
  x: number[];
  y: number[];
  m: number[];
}

export function cubicSpline(points: readonly [number, number][], slopes: [number | null, number | null] = [null, null]): CubicSpline {
  const s = testCall<WireSpline>("math/spline::cubicSpline", [points, slopes]);
  return { x: new Float64Array(s.x), y: new Float64Array(s.y), m: new Float64Array(s.m) };
}

export function evalSpline(s: CubicSpline, t: number): { value: number; slope: number } {
  return testCall("math/spline::evalSpline", [{ x: list(s.x), y: list(s.y), m: list(s.m) }, t]);
}
