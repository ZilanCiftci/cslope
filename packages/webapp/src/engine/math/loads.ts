/**
 * Load force calculations for slices.
 */

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
export function calculateAllLoads(
  widths: number[],
  centerXs: number[],
  udls: UdlData[],
  linLoads: LineLoadData[],
): [number[], number[]] {
  const numSlices = widths.length;
  const udlForces = new Array<number>(numSlices).fill(0);
  const llForces = new Array<number>(numSlices).fill(0);

  for (let i = 0; i < numSlices; i++) {
    const b = widths[i];
    const sx = centerXs[i];
    const sxl = sx - b / 2.0;
    const sxr = sx + b / 2.0;

    // UDLs
    for (let j = 0; j < udls.length; j++) {
      const [ux1, ux2, umag] = udls[j];

      // Case 1: load completely covers slice
      if (ux1 <= sxl && ux2 >= sxr) {
        udlForces[i] += b * umag;
      }
      // Case 2: slice extends past left edge of load
      else if (sxl <= ux1 && sxr >= ux1) {
        udlForces[i] += (sxr - ux1) * umag;
      }
      // Case 3: slice extends past right edge of load
      else if (sxl <= ux2 && sxr >= ux2) {
        udlForces[i] += (ux2 - sxl) * umag;
      }
    }

    // Line loads
    for (let j = 0; j < linLoads.length; j++) {
      const [lx, lmag] = linLoads[j];
      if (sxl <= lx && lx < sxr) {
        llForces[i] += lmag;
      }
    }
  }

  return [udlForces, llForces];
}
