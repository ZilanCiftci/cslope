/**
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (internal functions: testing build).
 */
import { list, testCall } from "../facade/internal";
/**
 * Cubic spline through points (x increasing): natural (zero curvature at
 * the ends) unless an end slope is given (clamped there). Beyond the ends
 * it continues as a straight line with the end slope. Used for strength
 * functions given as points that their source smooths with a spline.
 */
export interface CubicSpline {
  x: Float64Array;
  y: Float64Array;
  /** Second derivatives at the points. */
  m: Float64Array;
}

interface WireSpline {
  x: number[];
  y: number[];
  m: number[];
}

/** Build the spline. `slopes`: the first derivative at the start and the end (null: natural). */
export function cubicSpline(points: readonly [number, number][], slopes: [number | null, number | null] = [null, null]): CubicSpline {
  const s = testCall<WireSpline>("math/spline::cubicSpline", [points, slopes]);
  return { x: new Float64Array(s.x), y: new Float64Array(s.y), m: new Float64Array(s.m) };
}

/** Value and first derivative of the spline at t. */
export function evalSpline(s: CubicSpline, t: number): { value: number; slope: number } {
  return testCall("math/spline::evalSpline", [{ x: list(s.x), y: list(s.y), m: list(s.m) }, t]);
}
