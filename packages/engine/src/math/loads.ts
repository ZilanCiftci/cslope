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

    // UDLs — single overlap formula handles all cases
    for (let j = 0; j < udls.length; j++) {
      const [ux1, ux2, umag] = udls[j];
      const overlapL = Math.max(sxl, ux1);
      const overlapR = Math.min(sxr, ux2);
      if (overlapR > overlapL) {
        udlForces[i] += (overlapR - overlapL) * umag;
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
