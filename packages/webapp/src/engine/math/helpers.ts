/**
 * Miscellaneous helper/utility functions.
 *
 * Mirrors Python: math_utils.halfsine, utilities.mid_coord,
 * utilities.dist_points, utilities.extrapolate_lambda,
 * utilities.get_precision, utilities.MATERIAL_COLORS
 */

/**
 * Half-sine interslice function for Morgenstern-Price analysis.
 *
 * @param x - x-coordinate to evaluate
 * @param xStart - start of the function domain
 * @param xEnd - end of the function domain
 * @returns Half-sine value (0 outside domain)
 */
export function halfsine(x: number, xStart: number, xEnd: number): number {
  if (x <= xStart || x >= xEnd) return 0.0;
  return Math.sin((Math.PI * (x - xStart)) / (xEnd - xStart));
}

/**
 * Midpoint between two 2D points.
 */
export function midCoord(
  p1: [number, number],
  p2: [number, number],
): [number, number] {
  return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

/**
 * Euclidean distance between two 2D points.
 */
export function distPoints(p1: [number, number], p2: [number, number]): number {
  return Math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2);
}

/**
 * Extrapolate the lambda value where FS_moment ≈ FS_force
 * for Morgenstern-Price convergence.
 *
 * @param lffArray - Array of [lambda, FS, FS_force] triplets
 * @returns [extrapolated_lambda, extrapolated_FS]
 */
export function extrapolateLambda(
  lffArray: [number, number, number][],
): [number, number] {
  if (lffArray.length < 2) {
    throw new Error(
      "lffArray must contain at least two points for extrapolation.",
    );
  }

  // Sort by |FS - FS_force| (ascending — closest pair first)
  const sorted = [...lffArray].sort(
    (a, b) => Math.abs(a[1] - a[2]) - Math.abs(b[1] - b[2]),
  );
  const [lambda1, fs1, fsForce1] = sorted[0];
  const [lambda2, fs2, fsForce2] = sorted[1];

  const slopeM = (fs2 - fs1) / (lambda2 - lambda1);
  const slopeF = (fsForce2 - fsForce1) / (lambda2 - lambda1);

  // Parallel slopes — return the better point
  if (Math.abs(slopeM - slopeF) < 1e-10) {
    const error1 = Math.abs(fs1 - fsForce1);
    const error2 = Math.abs(fs2 - fsForce2);
    return error1 < error2 ? [lambda1, fs1] : [lambda2, fs2];
  }

  let lambdaExtrap = lambda2 + (fsForce2 - fs2) / (slopeM - slopeF);
  lambdaExtrap = Math.max(-1, Math.min(lambdaExtrap, 1));
  const fsExtrap = fs1 + slopeM * (lambdaExtrap - lambda1);
  return [lambdaExtrap, fsExtrap];
}

/**
 * Determine the decimal precision of a number.
 */
export function getPrecision(n: number): number {
  const mag = String(n);
  if (!mag.includes(".")) return 0;
  const decimals = mag.split(".")[1];
  for (let i = 0; i < decimals.length - 2; i++) {
    if (
      decimals[i] === "0" &&
      decimals[i + 1] === "0" &&
      decimals[i + 2] === "0"
    ) {
      return i;
    }
  }
  return decimals.length;
}

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
