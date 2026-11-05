/**
 * Miscellaneous helper/utility functions.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { pt, wasm } from "../facade/internal";

/** Default palette for material layers. */
export const MATERIAL_COLORS: readonly string[] = [
  "#efa59c",
  "#77e1ca",
  "#cdacfc",
  "#f2c6a7",
  "#7edff4",
  "#f2a8c3",
  "#cde9ba",
  "#f2c1fa",
  "#f1dba3",
  "#a3acf7",
] as const;

/**
 * Constant interslice function (unity across domain).
 */
export function constantInterslice(x: number, xStart: number, xEnd: number): number {
  return wasm().constant_interslice(x, xStart, xEnd);
}

/**
 * Half-sine interslice function for Morgenstern-Price analysis.
 *
 * @param x - x-coordinate to evaluate
 * @param xStart - start of the function domain
 * @param xEnd - end of the function domain
 * @returns Half-sine value (0 outside domain)
 */
export function halfsine(x: number, xStart: number, xEnd: number): number {
  return wasm().halfsine(x, xStart, xEnd);
}

/**
 * Clipped-sine interslice function.
 *
 * Uses a half-sine profile clipped from below to avoid very low tail values.
 */
export function clippedSine(x: number, xStart: number, xEnd: number): number {
  return wasm().clipped_sine(x, xStart, xEnd);
}

/**
 * Trapezoidal interslice function.
 *
 * Piecewise-linear rise (0–20%), flat top (20–80%), and fall (80–100%).
 */
export function trapezoidal(x: number, xStart: number, xEnd: number): number {
  return wasm().trapezoidal(x, xStart, xEnd);
}

/**
 * Data-point-specified interslice function using piecewise-linear interpolation.
 *
 * The provided points are normalized: x in [0,1], f in [0,1].
 */
export function dataPointSpecified(x: number, xStart: number, xEnd: number, points: [number, number][]): number {
  return wasm().data_point_specified(x, xStart, xEnd, points);
}

/**
 * Select and evaluate the configured interslice function.
 */
export function getIntersliceFunctionValue(
  kind: "constant" | "half-sine" | "clipped-sine" | "trapezoidal" | "data-point-specified" | undefined,
  x: number,
  xStart: number,
  xEnd: number,
  points: [number, number][] = [],
): number {
  return wasm().get_interslice_function_value(kind, x, xStart, xEnd, points);
}

/**
 * Midpoint between two 2D points.
 */
export function midCoord(p1: [number, number], p2: [number, number]): [number, number] {
  return pt(wasm().mid_coord(p1[0], p1[1], p2[0], p2[1]));
}

/**
 * Euclidean distance between two 2D points.
 */
export function distPoints(p1: [number, number], p2: [number, number]): number {
  return wasm().dist_points(p1[0], p1[1], p2[0], p2[1]);
}

/**
 * Extrapolate the lambda value where FS_moment ≈ FS_force
 * for Morgenstern-Price convergence.
 *
 * @param lffArray - Array of [lambda, FS, FS_force] triplets
 * @returns [extrapolated_lambda, extrapolated_FS]
 */
export function extrapolateLambda(lffArray: [number, number, number][]): [number, number] {
  return pt(wasm().extrapolate_lambda(lffArray));
}

/**
 * Determine the decimal precision of a number.
 */
export function getPrecision(n: number): number {
  return wasm().get_precision(n);
}
