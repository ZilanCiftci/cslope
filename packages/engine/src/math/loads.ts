/**
 * Load force calculations for slices.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { wasm } from "../facade/internal";

/**
 * UDL input data: [x1, x2, magnitude] per UDL.
 */
export type UdlData = [number, number, number];

/**
 * Line load input data: [x, magnitude] per load.
 */
export type LineLoadData = [number, number];

/**
 * Calculate UDL and Line Load forces for all slices at once.
 *
 * @param widths - Array of slice widths (m)
 * @param centerXs - Array of slice center x-coordinates
 * @param udls - Nx3 data: [x1, x2, magnitude] per UDL
 * @param linLoads - Mx2 data: [x, magnitude] per line load
 * @returns [udlForces, llForces] per slice
 */
export function calculateAllLoads(widths: number[], centerXs: number[], udls: UdlData[], linLoads: LineLoadData[]): [number[], number[]] {
  return wasm().calculate_all_loads(widths, centerXs, udls, linLoads);
}
