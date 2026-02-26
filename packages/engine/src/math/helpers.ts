/**
 * Miscellaneous helper/utility functions.
 */

/**
 * Constant interslice function (unity across domain).
 */
export function constantInterslice(
  x: number,
  xStart: number,
  xEnd: number,
): number {
  if (x <= xStart || x >= xEnd) return 0.0;
  return 1.0;
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
  if (x <= xStart || x >= xEnd) return 0.0;
  return Math.sin((Math.PI * (x - xStart)) / (xEnd - xStart));
}

/**
 * Clipped-sine interslice function.
 *
 * Uses a half-sine profile clipped from below to avoid very low tail values.
 */
export function clippedSine(x: number, xStart: number, xEnd: number): number {
  if (x <= xStart || x >= xEnd) return 0.0;
  const y = halfsine(x, xStart, xEnd);
  return Math.max(0.35, y);
}

/**
 * Trapezoidal interslice function.
 *
 * Piecewise-linear rise (0–20%), flat top (20–80%), and fall (80–100%).
 */
export function trapezoidal(x: number, xStart: number, xEnd: number): number {
  if (x <= xStart || x >= xEnd) return 0.0;
  const span = xEnd - xStart;
  if (span <= 0) return 0.0;

  const xi = (x - xStart) / span;
  if (xi <= 0 || xi >= 1) return 0.0;
  if (xi < 0.2) return xi / 0.2;
  if (xi <= 0.8) return 1.0;
  return (1 - xi) / 0.2;
}

/**
 * Data-point-specified interslice function using piecewise-linear interpolation.
 *
 * The provided points are normalized: x in [0,1], f in [0,1].
 */
export function dataPointSpecified(
  x: number,
  xStart: number,
  xEnd: number,
  points: [number, number][],
): number {
  if (x <= xStart || x >= xEnd) return 0.0;
  const span = xEnd - xStart;
  if (span <= 0 || points.length === 0) return halfsine(x, xStart, xEnd);

  const xi = (x - xStart) / span;
  if (xi <= 0 || xi >= 1) return 0.0;

  const normalized = [...points]
    .filter(
      (p): p is [number, number] =>
        Number.isFinite(p[0]) && Number.isFinite(p[1]),
    )
    .map(([px, py]) => [Math.max(0, Math.min(1, px)), Math.max(0, py)] as const)
    .sort((a, b) => a[0] - b[0]);

  if (normalized.length === 0) return halfsine(x, xStart, xEnd);

  if (xi <= normalized[0][0]) return normalized[0][1];
  if (xi >= normalized[normalized.length - 1][0]) {
    return normalized[normalized.length - 1][1];
  }

  for (let i = 0; i < normalized.length - 1; i++) {
    const [x0, y0] = normalized[i];
    const [x1, y1] = normalized[i + 1];
    if (xi >= x0 && xi <= x1) {
      const dx = x1 - x0;
      if (dx <= 1e-12) return y1;
      const t = (xi - x0) / dx;
      return y0 + t * (y1 - y0);
    }
  }

  return 0.0;
}

/**
 * Select and evaluate the configured interslice function.
 */
export function getIntersliceFunctionValue(
  kind:
    | "constant"
    | "half-sine"
    | "clipped-sine"
    | "trapezoidal"
    | "data-point-specified"
    | undefined,
  x: number,
  xStart: number,
  xEnd: number,
  points: [number, number][] = [],
): number {
  switch (kind ?? "half-sine") {
    case "constant":
      return constantInterslice(x, xStart, xEnd);
    case "half-sine":
      return halfsine(x, xStart, xEnd);
    case "clipped-sine":
      return clippedSine(x, xStart, xEnd);
    case "trapezoidal":
      return trapezoidal(x, xStart, xEnd);
    case "data-point-specified":
      return dataPointSpecified(x, xStart, xEnd, points);
    default:
      return halfsine(x, xStart, xEnd);
  }
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
