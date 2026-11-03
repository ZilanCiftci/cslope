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

/** Build the spline. `slopes`: the first derivative at the start and the end (null: natural). */
export function cubicSpline(points: readonly [number, number][], slopes: [number | null, number | null] = [null, null]): CubicSpline {
  const n = points.length;
  const x = new Float64Array(points.map((p) => p[0]));
  const y = new Float64Array(points.map((p) => p[1]));
  const m = new Float64Array(n);
  if (n < 3 && slopes[0] === null && slopes[1] === null) return { x, y, m };
  // tridiagonal system for the second derivatives (Thomas algorithm)
  const a = new Float64Array(n), b = new Float64Array(n), c = new Float64Array(n), r = new Float64Array(n);
  const h = (i: number) => x[i + 1] - x[i];
  const d = (i: number) => (y[i + 1] - y[i]) / h(i);
  if (slopes[0] === null) b[0] = 1;
  else {
    b[0] = 2 * h(0);
    c[0] = h(0);
    r[0] = 6 * (d(0) - slopes[0]);
  }
  for (let i = 1; i < n - 1; i++) {
    a[i] = h(i - 1);
    b[i] = 2 * (h(i - 1) + h(i));
    c[i] = h(i);
    r[i] = 6 * (d(i) - d(i - 1));
  }
  if (slopes[1] === null) b[n - 1] = 1;
  else {
    a[n - 1] = h(n - 2);
    b[n - 1] = 2 * h(n - 2);
    r[n - 1] = 6 * (slopes[1] - d(n - 2));
  }
  for (let i = 1; i < n; i++) {
    const w = a[i] / b[i - 1];
    b[i] -= w * c[i - 1];
    r[i] -= w * r[i - 1];
  }
  m[n - 1] = r[n - 1] / b[n - 1];
  for (let i = n - 2; i >= 0; i--) m[i] = (r[i] - c[i] * m[i + 1]) / b[i];
  return { x, y, m };
}

/** Value and first derivative of the spline at t. */
export function evalSpline(s: CubicSpline, t: number): { value: number; slope: number } {
  const { x, y, m } = s;
  const n = x.length;
  if (n === 0) return { value: 0, slope: 0 };
  if (n === 1) return { value: y[0], slope: 0 };
  const segSlope = (i: number, at: "start" | "end") => {
    const h = x[i + 1] - x[i];
    const d = (y[i + 1] - y[i]) / h;
    return at === "start" ? d - (h * (2 * m[i] + m[i + 1])) / 6 : d + (h * (m[i] + 2 * m[i + 1])) / 6;
  };
  if (t <= x[0]) {
    const k = segSlope(0, "start");
    return { value: y[0] + (t - x[0]) * k, slope: k };
  }
  if (t >= x[n - 1]) {
    const k = segSlope(n - 2, "end");
    return { value: y[n - 1] + (t - x[n - 1]) * k, slope: k };
  }
  let i = 0;
  while (i < n - 2 && x[i + 1] < t) i++;
  const h = x[i + 1] - x[i];
  const A = (x[i + 1] - t) / h, B = (t - x[i]) / h;
  const value = A * y[i] + B * y[i + 1] + (((A ** 3 - A) * m[i] + (B ** 3 - B) * m[i + 1]) * h * h) / 6;
  const slope = (y[i + 1] - y[i]) / h + ((-(3 * A * A - 1) * m[i] + (3 * B * B - 1) * m[i + 1]) * h) / 6;
  return { value, slope };
}
