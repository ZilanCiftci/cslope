/**
 * Polyline interpolation functions.
 */

/**
 * Get the y-coordinate on a polyline at a specific x-coordinate.
 * If multiple segments contain x, returns the average y.
 *
 * @param polyX - x-coordinates of the polyline
 * @param polyY - y-coordinates of the polyline
 * @param x - x-coordinate to query
 * @returns Interpolated y-coordinate, or NaN if out of bounds
 */
export function getYAtX(polyX: number[], polyY: number[], x: number): number {
  let ySum = 0.0;
  let count = 0;

  for (let i = 0; i < polyX.length - 1; i++) {
    const x1 = polyX[i],
      x2 = polyX[i + 1];
    const y1 = polyY[i],
      y2 = polyY[i + 1];

    if ((x1 <= x && x <= x2) || (x2 <= x && x <= x1)) {
      if (Math.abs(x1 - x2) < 1e-12) {
        ySum += (y1 + y2) / 2.0;
        count++;
      } else {
        const t = (x - x1) / (x2 - x1);
        ySum += y1 + t * (y2 - y1);
        count++;
      }
    }
  }

  return count > 0 ? ySum / count : NaN;
}

/**
 * Get y-coordinates on a polyline for multiple x-coordinates.
 *
 * @param polyX - x-coordinates of the polyline
 * @param polyY - y-coordinates of the polyline
 * @param xValues - x-coordinates to query
 * @returns Array of interpolated y-coordinates (NaN where out of bounds)
 */
export function getYAtXMany(
  polyX: number[],
  polyY: number[],
  xValues: number[],
): number[] {
  return xValues.map((x) => getYAtX(polyX, polyY, x));
}

/**
 * Get the y-coordinate on a line at x (strict — throws if out of bounds).
 * Mirrors utilities.get_y_at_x (the non-Numba version).
 *
 * @param line - [x[], y[]] polyline tuple
 * @param x - x-coordinate to query
 * @returns Interpolated y-coordinate
 * @throws If x is outside the line's bounds
 */
export function getYAtXStrict(line: [number[], number[]], x: number): number {
  const [xArr, yArr] = line;
  const xMin = Math.min(...xArr);
  const xMax = Math.max(...xArr);

  if (x < xMin - 1e-7 || x > xMax + 1e-7) {
    throw new RangeError(
      `x (${x}) is outside the limits of the line (${xMin} to ${xMax}).`,
    );
  }

  // Clamp
  const xClamped = Math.max(xMin, Math.min(xMax, x));

  for (let i = 0; i < xArr.length - 1; i++) {
    if (xArr[i] <= xClamped && xClamped <= xArr[i + 1]) {
      const slope = (yArr[i + 1] - yArr[i]) / (xArr[i + 1] - xArr[i]);
      return yArr[i] + slope * (xClamped - xArr[i]);
    }
  }

  throw new RangeError(`Could not interpolate y-value for x=${x}`);
}

/**
 * Get the line segment between two x-coordinates on a polyline.
 *
 * @param line - [x[], y[]] polyline tuple
 * @param x1 - Starting x-coordinate
 * @param x2 - Ending x-coordinate
 * @returns [x[], y[]] of the segment
 */
export function getLineBetweenPoints(
  line: [number[], number[]],
  x1: number,
  x2: number,
): [number[], number[]] {
  const [xArr, yArr] = line;
  const lineXMin = Math.min(...xArr);
  const lineXMax = Math.max(...xArr);

  if (x1 < lineXMin || x1 > lineXMax || x2 < lineXMin || x2 > lineXMax) {
    throw new RangeError("x1 or x2 is outside the limits of the line.");
  }

  const xOut: number[] = [];
  const yOut: number[] = [];

  // Gather points inside [x1, x2]
  for (let i = 0; i < xArr.length; i++) {
    if (xArr[i] >= x1 && xArr[i] <= x2) {
      xOut.push(xArr[i]);
      yOut.push(yArr[i]);
    }
  }

  if (xOut.length === 0) {
    return [
      [x1, x2],
      [getYAtXStrict(line, x1), getYAtXStrict(line, x2)],
    ];
  }

  // Ensure first point is at x1
  if (xOut[0] > x1) {
    xOut.unshift(x1);
    yOut.unshift(getYAtXStrict(line, x1));
  }

  // Ensure last point is at x2
  if (xOut[xOut.length - 1] < x2) {
    xOut.push(x2);
    yOut.push(getYAtXStrict(line, x2));
  }

  return [xOut, yOut];
}
