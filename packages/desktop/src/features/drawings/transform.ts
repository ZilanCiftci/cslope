/**
 * The geometry of a drawing placed under a model: a 2D affine transform
 * from the drawing's own coordinates (source units: pixels of an image,
 * points of a PDF page, both with the origin at the top left and y
 * downwards) to the model's (m, y upwards), and the calibrations that
 * give it.
 *
 *   x = a·u + c·v + e
 *   y = b·u + d·v + f
 *
 * (the order of CanvasRenderingContext2D.setTransform). Pure functions.
 */

export type Pt = [number, number];

/** model = M · source. */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** A point of the drawing and the model point it is. */
export interface PointPair {
  source: Pt;
  model: Pt;
}

/** A transform, or why none could be found. */
export type FitResult =
  | { ok: true; transform: Affine; residuals: number[] }
  | { ok: false; error: string };

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** The model point of a source point. */
export function apply(m: Affine, [u, v]: Pt): Pt {
  return [m.a * u + m.c * v + m.e, m.b * u + m.d * v + m.f];
}

/** `outer ∘ inner`: first `inner`, then `outer`. */
export function compose(outer: Affine, inner: Affine): Affine {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f,
  };
}

export function determinant(m: Affine): number {
  return m.a * m.d - m.b * m.c;
}

/** The inverse, or null when the transform is singular. */
export function invert(m: Affine): Affine | null {
  const det = determinant(m);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** The transform moved by (dx, dy) in the model. */
export function translate(m: Affine, dx: number, dy: number): Affine {
  return { ...m, e: m.e + dx, f: m.f + dy };
}

const finiteAffine = (m: Affine) => [m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite);

/**
 * Whether a transform can place a drawing: finite and not (nearly)
 * singular relative to its own scale.
 */
export function isUsable(m: Affine): boolean {
  if (!finiteAffine(m)) return false;
  const scale = Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
  return scale > 0 && Math.abs(determinant(m)) > 1e-9 * scale * scale;
}

/** The scales of the drawing's axes: model metres per source unit along u and along v. */
export function axisScales(m: Affine): { u: number; v: number } {
  return { u: Math.hypot(m.a, m.b), v: Math.hypot(m.c, m.d) };
}

/**
 * Vertical exaggeration of a placed drawing: how many times more drawing
 * units a metre takes vertically than horizontally (1: true scale).
 */
export function verticalExaggeration(m: Affine): number {
  const { u, v } = axisScales(m);
  return v > 0 ? u / v : NaN;
}

/** The model-space residual (m) of each pair under `m`. */
export function residuals(m: Affine, pairs: PointPair[]): number[] {
  return pairs.map((p) => {
    const [x, y] = apply(m, p.source);
    return Math.hypot(x - p.model[0], y - p.model[1]);
  });
}

/** Points closer than this (source units, or model metres) count as the same point. */
const MIN_SOURCE_DISTANCE = 1;
const MIN_MODEL_DISTANCE = 1e-6;

/**
 * Two points: the similarity transform (translation, rotation, uniform
 * scale) that takes the drawing's points to the model's. The drawing's y
 * runs downwards and the model's upwards, so the transform includes that
 * flip (the drawing is never mirrored otherwise).
 */
export function similarityFromTwo(p1: PointPair, p2: PointPair): FitResult {
  // Complex numbers: w = u − i·v (the drawing, y flipped up), z = x + i·y.
  const wr = p2.source[0] - p1.source[0];
  const wi = -(p2.source[1] - p1.source[1]);
  const zr = p2.model[0] - p1.model[0];
  const zi = p2.model[1] - p1.model[1];
  const w2 = wr * wr + wi * wi;
  if (Math.sqrt(w2) < MIN_SOURCE_DISTANCE) {
    return { ok: false, error: "The two points are too close together in the drawing." };
  }
  if (Math.hypot(zr, zi) < MIN_MODEL_DISTANCE) {
    return { ok: false, error: "The two points have the same model coordinates." };
  }
  // s = z / w
  const p = (zr * wr + zi * wi) / w2;
  const q = (zi * wr - zr * wi) / w2;
  // x + i·y = s·(u − i·v) + t
  const a = p;
  const b = q;
  const c = q;
  const d = -p;
  const e = p1.model[0] - (a * p1.source[0] + c * p1.source[1]);
  const f = p1.model[1] - (b * p1.source[0] + d * p1.source[1]);
  const transform = { a, b, c, d, e, f };
  return { ok: true, transform, residuals: residuals(transform, [p1, p2]) };
}

/** Solve the 3 × 3 system A·x = r (Cramer's rule); null when singular. */
function solve3(A: number[][], r: number[]): number[] | null {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const norm = Math.max(...A.flat().map(Math.abs));
  if (!Number.isFinite(D) || Math.abs(D) <= 1e-12 * norm * norm * norm) return null;
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)))) / D);
}

/**
 * Three or more points: the affine transform that fits them best (least
 * squares), with the residual of each point in metres. Takes shear and
 * different scales along the two axes.
 */
export function affineLeastSquares(pairs: PointPair[]): FitResult {
  if (pairs.length < 3) return { ok: false, error: "At least three points are needed." };
  // Centred on the means, for a well-conditioned system.
  const n = pairs.length;
  const mu = pairs.reduce((s, p) => s + p.source[0], 0) / n;
  const mv = pairs.reduce((s, p) => s + p.source[1], 0) / n;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  for (const p of pairs) {
    const du = p.source[0] - mu;
    const dv = p.source[1] - mv;
    suu += du * du;
    suv += du * dv;
    svv += dv * dv;
  }
  const spread = Math.sqrt((suu + svv) / n);
  if (spread < MIN_SOURCE_DISTANCE) return { ok: false, error: "The points are too close together in the drawing." };
  // Collinear: the centred covariance is singular.
  if (suu * svv - suv * suv <= 1e-9 * (suu + svv) * (suu + svv)) {
    return { ok: false, error: "The points lie on one line in the drawing; pick points that span an area." };
  }
  const A = [
    [suu, suv, 0],
    [suv, svv, 0],
    [0, 0, n],
  ];
  const fit = (k: 0 | 1) => {
    let ru = 0;
    let rv = 0;
    let r1 = 0;
    for (const p of pairs) {
      const du = p.source[0] - mu;
      const dv = p.source[1] - mv;
      ru += du * p.model[k];
      rv += dv * p.model[k];
      r1 += p.model[k];
    }
    return solve3(A, [ru, rv, r1]);
  };
  const x = fit(0);
  const y = fit(1);
  if (!x || !y) return { ok: false, error: "No transform fits these points." };
  // x = a·(u − mu) + c·(v − mv) + e0
  const [a, c, ex] = x;
  const [b, d, fy] = y;
  const transform: Affine = { a, b, c, d, e: ex - a * mu - c * mv, f: fy - b * mu - d * mv };
  if (!isUsable(transform)) return { ok: false, error: "The points give a singular transform (all model points on one line?)." };
  return { ok: true, transform, residuals: residuals(transform, pairs) };
}

/** Points calibration: two points give a similarity, three or more an affine fit. */
export function fitPoints(pairs: PointPair[]): FitResult {
  if (pairs.length < 2) return { ok: false, error: "Pick at least two points." };
  if (pairs.length === 2) return similarityFromTwo(pairs[0], pairs[1]);
  return affineLeastSquares(pairs);
}

/** A click on an axis of the drawing and the axis value there. */
export interface AxisTick {
  /** The drawing point clicked (only u counts on the x axis, only v on the y axis). */
  source: Pt;
  value: number;
}

/**
 * Axes calibration: the x scale from two ticks of the horizontal axis and
 * the y scale from two ticks of the vertical axis, each on its own (so a
 * section drawn with vertical exaggeration comes out true to scale); no
 * rotation. With a known scale per axis (`scale`, metres per source unit,
 * from another placement of the same drawing) one tick per axis is enough.
 */
export function fitAxes(
  x: AxisTick[],
  y: AxisTick[],
  scale?: { x?: number; y?: number },
): FitResult {
  const axis = (ticks: AxisTick[], k: 0 | 1, known: number | undefined, name: string): { s: number; o: number } | string => {
    if (known !== undefined && ticks.length >= 1) {
      if (!Number.isFinite(known) || known === 0) return `The ${name} scale to reuse is not valid.`;
      const t = ticks[0];
      return { s: known, o: t.value - known * t.source[k] };
    }
    if (ticks.length < 2) return `Pick two points on the ${name} axis.`;
    const [t1, t2] = ticks;
    const ds = t2.source[k] - t1.source[k];
    if (Math.abs(ds) < MIN_SOURCE_DISTANCE) return `The two points on the ${name} axis are too close together.`;
    if (Math.abs(t2.value - t1.value) < MIN_MODEL_DISTANCE) return `The two points on the ${name} axis have the same value.`;
    const s = (t2.value - t1.value) / ds;
    return { s, o: t1.value - s * t1.source[k] };
  };
  const ax = axis(x, 0, scale?.x, "x");
  if (typeof ax === "string") return { ok: false, error: ax };
  const ay = axis(y, 1, scale?.y, "y");
  if (typeof ay === "string") return { ok: false, error: ay };
  const transform: Affine = { a: ax.s, b: 0, c: 0, d: ay.s, e: ax.o, f: ay.o };
  const res = [
    ...x.map((t) => Math.abs(ax.s * t.source[0] + ax.o - t.value)),
    ...y.map((t) => Math.abs(ay.s * t.source[1] + ay.o - t.value)),
  ];
  return { ok: true, transform, residuals: res };
}

/**
 * Scale calibration: one drawing point is a model point, and one drawing
 * unit is `metersPerUnit` metres in both directions (y flipped up).
 */
export function fitScale(origin: PointPair, metersPerUnit: number): FitResult {
  if (!Number.isFinite(metersPerUnit) || metersPerUnit <= 0) {
    return { ok: false, error: "The scale must be a positive number." };
  }
  const k = metersPerUnit;
  const transform: Affine = {
    a: k,
    b: 0,
    c: 0,
    d: -k,
    e: origin.model[0] - k * origin.source[0],
    f: origin.model[1] + k * origin.source[1],
  };
  return { ok: true, transform, residuals: [0] };
}

/**
 * The first form of a background's placement (bottom-left corner in the
 * model, metres per pixel, rotation counter-clockwise about that corner,
 * mirrored left to right in place before the rotation) as an affine
 * transform, for an image of `width` × `height` pixels.
 */
export function legacyTransform(
  t: { originX: number; originY: number; scale: number; rotationDeg: number; mirrored: boolean },
  width: number,
  height: number,
): Affine {
  const s = t.scale;
  // Local (before the rotation), y up, the bottom-left corner at 0:
  //   lx = s·u (mirrored: s·(W − u)), ly = s·(H − v)
  const local: Affine = t.mirrored
    ? { a: -s, b: 0, c: 0, d: -s, e: s * width, f: s * height }
    : { a: s, b: 0, c: 0, d: -s, e: 0, f: s * height };
  const r = (t.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rotate: Affine = { a: cos, b: sin, c: -sin, d: cos, e: t.originX, f: t.originY };
  const m = compose(rotate, local);
  // (no negative zeros from the rotation by 0)
  for (const k of ["a", "b", "c", "d", "e", "f"] as const) if (m[k] === 0) m[k] = 0;
  return m;
}

/** A crop rectangle in source units, normalized (x0 < x1, y0 < y1). */
export interface Crop {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function normalizeCrop(c: Crop): Crop {
  return { x0: Math.min(c.x0, c.x1), y0: Math.min(c.y0, c.y1), x1: Math.max(c.x0, c.x1), y1: Math.max(c.y0, c.y1) };
}

/** The four corners of a crop rectangle in the model (top-left, top-right, bottom-right, bottom-left of the drawing). */
export function cropCorners(m: Affine, c: Crop): Pt[] {
  return [
    apply(m, [c.x0, c.y0]),
    apply(m, [c.x1, c.y0]),
    apply(m, [c.x1, c.y1]),
    apply(m, [c.x0, c.y1]),
  ];
}

/** True when the point is inside the convex polygon (either winding). */
export function insideConvex(poly: Pt[], [x, y]: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
    if (cross === 0) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}
