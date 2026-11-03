/** Facade shim of math/helpers.ts (see facade/internal.ts). */
import { pt, wasm } from "../internal";

// Data: kept as TypeScript (read at module load; the consistency test
// compares it with the engine's).
export { MATERIAL_COLORS } from "../../math/helpers";

export function constantInterslice(x: number, xStart: number, xEnd: number): number {
  return wasm().constant_interslice(x, xStart, xEnd);
}

export function halfsine(x: number, xStart: number, xEnd: number): number {
  return wasm().halfsine(x, xStart, xEnd);
}

export function clippedSine(x: number, xStart: number, xEnd: number): number {
  return wasm().clipped_sine(x, xStart, xEnd);
}

export function trapezoidal(x: number, xStart: number, xEnd: number): number {
  return wasm().trapezoidal(x, xStart, xEnd);
}

export function dataPointSpecified(x: number, xStart: number, xEnd: number, points: [number, number][]): number {
  return wasm().data_point_specified(x, xStart, xEnd, points);
}

export function getIntersliceFunctionValue(
  kind: "constant" | "half-sine" | "clipped-sine" | "trapezoidal" | "data-point-specified" | undefined,
  x: number,
  xStart: number,
  xEnd: number,
  points: [number, number][] = [],
): number {
  return wasm().get_interslice_function_value(kind, x, xStart, xEnd, points);
}

export function midCoord(p1: [number, number], p2: [number, number]): [number, number] {
  return pt(wasm().mid_coord(p1[0], p1[1], p2[0], p2[1]));
}

export function distPoints(p1: [number, number], p2: [number, number]): number {
  return wasm().dist_points(p1[0], p1[1], p2[0], p2[1]);
}

export function extrapolateLambda(lffArray: [number, number, number][]): [number, number] {
  return pt(wasm().extrapolate_lambda(lffArray));
}

export function getPrecision(n: number): number {
  return wasm().get_precision(n);
}
