// Fixtures for the math ports (math/*.ts): inputs and outputs of every
// public function on the verification problems' geometry and on seeded
// random inputs, plus the edge cases of the unit tests. Run under Node:
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts math
import { writeFixture } from "./write";
import { PROBLEMS } from "../../../engine/src/verification/problems";
import { calculatePolygonArea, isPointInPolygon, clipPolygonHalfplane, clipPolygonVertical } from "../../../engine/src/math/polygon";
import {
  getCircleYCoordinateAtX,
  getCircleLineIntersections,
  circleRadiusFromAbcd,
  circleCentre,
  generateCircleCoordinates,
} from "../../../engine/src/math/circle";
import {
  getYAtX,
  getYAtXMany,
  getYAtXStrict,
  getLineBetweenPoints,
  interpolateIDW,
  interpolateNearest,
} from "../../../engine/src/math/interpolation";
import { calculateAllLoads } from "../../../engine/src/math/loads";
import {
  getIntersliceFunctionValue,
  dataPointSpecified,
  midCoord,
  distPoints,
  extrapolateLambda,
  getPrecision,
} from "../../../engine/src/math/helpers";
import { cubicSpline, evalSpline } from "../../../engine/src/math/spline";

/** mulberry32: a seeded generator, so the fixtures are the same every run. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(20261103);
const uni = (a: number, b: number) => a + (b - a) * R();

/** The outlines of the verification problems, as [x[], y[]]. */
const outlines: [number[], number[]][] = PROBLEMS.map((p) => [p.definition.coordinates.map((c) => c[0]), p.definition.coordinates.map((c) => c[1])]);
/** Random star-shaped polygons. */
for (let k = 0; k < 20; k++) {
  const n = 3 + Math.floor(R() * 10), x: number[] = [], y: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n, r = uni(1, 10);
    x.push(uni(-5, 5) + r * Math.cos(t));
    y.push(uni(-5, 5) + r * Math.sin(t));
  }
  outlines.push([x, y]);
}
const bounds = (xs: number[]) => [Math.min(...xs), Math.max(...xs)];
/** Errors as { error: message }. */
const attempt = <T>(f: () => T) => {
  try {
    return { ok: f() };
  } catch (e) {
    return { error: (e as Error).message, range: e instanceof RangeError };
  }
};

it("exports the math fixtures", () => {
  // ── polygon ──
  const polygon = outlines.map(([x, y]) => {
    const [x0, x1] = bounds(x), [y0, y1] = bounds(y);
    const points = Array.from({ length: 30 }, () => [uni(x0 - 1, x1 + 1), uni(y0 - 1, y1 + 1)]);
    // vertices themselves too (the ray-casting edge cases)
    for (let i = 0; i < x.length; i++) points.push([x[i], y[i]]);
    const strips = Array.from({ length: 8 }, () => {
      const a = uni(x0 - 2, x1 + 2), b = uni(x0 - 2, x1 + 2);
      return [Math.min(a, b), Math.max(a, b)];
    });
    strips.push([x0, x1], [x0, x0], [(x0 + x1) / 2, (x0 + x1) / 2 + 1e-13]);
    const planes = Array.from({ length: 6 }, () => [uni(-1, 1), uni(-1, 1), uni(-20, 20)]);
    planes.push([1, 0, -x0], [0, 1, -(y0 + y1) / 2], [0, 0, 1]);
    return {
      x,
      y,
      area: calculatePolygonArea(x, y),
      inside: points.map(([px, py]) => ({ p: [px, py], inside: isPointInPolygon(px, py, x, y) })),
      vertical: strips.map(([a, b]) => ({ strip: [a, b], out: clipPolygonVertical(x, y, a, b) })),
      halfplane: planes.map(([a, b, c]) => ({ abc: [a, b, c], out: clipPolygonHalfplane(x, y, a, b, c) })),
    };
  });
  polygon.push({ x: [0, 1], y: [0, 1], area: calculatePolygonArea([0, 1], [0, 1]), inside: [], vertical: [{ strip: [0, 1], out: clipPolygonVertical([], [], 0, 1) }], halfplane: [] });
  writeFixture("math", "polygon", polygon);

  // ── circle ──
  const circle = outlines.slice(0, 60).map(([x, y]) => {
    const [x0, x1] = bounds(x), [y0, y1] = bounds(y);
    const circles = Array.from({ length: 10 }, () => {
      const cx = uni(x0, x1), cy = uni(y1, y1 + (x1 - x0)), r = uni(0.2, 1.5) * (cy - y0);
      return { cx, cy, r, out: getCircleLineIntersections(cx, cy, r, x, y) };
    });
    // a circle through a vertex (the snapped crossing)
    const vx = x[1], vy = y[1], cx = vx + 3, cy = vy + 4;
    circles.push({ cx, cy, r: 5, out: getCircleLineIntersections(cx, cy, 5, x, y) });
    return { x, y, circles };
  });
  const yAt = Array.from({ length: 200 }, () => {
    const cx = uni(-10, 10), cy = uni(-10, 10), r = uni(0, 10), x = uni(-25, 25);
    return { args: [cx, cy, r, x], out: getCircleYCoordinateAtX(cx, cy, r, x) };
  });
  const abcd = [[0, 5], [1e-13, 4], [2, 9], [-3, 7], ...Array.from({ length: 50 }, () => [uni(-10, 10), uni(0, 100)])].map(([c, C]) => ({ args: [c, C], out: circleRadiusFromAbcd(c, C) }));
  const centre = Array.from({ length: 50 }, () => {
    const beta = uni(-Math.PI, Math.PI), p: [number, number] = [uni(-50, 50), uni(-50, 50)], d = uni(-30, 30);
    return { args: [beta, p, d], out: circleCentre(beta, p, d) };
  });
  const coords = [0, 1, 2, 3, 10, 90].flatMap((n) => [{ args: [12.3, 45.6, 17.89, n], out: generateCircleCoordinates(12.3, 45.6, 17.89, n) }]);
  for (let k = 0; k < 20; k++) {
    const args = [uni(-100, 100), uni(-100, 100), uni(0.1, 80), 2 + Math.floor(R() * 120)];
    coords.push({ args, out: generateCircleCoordinates(args[0], args[1], args[2], args[3]) });
  }
  writeFixture("math", "circle", { intersections: circle, yAt, abcd, centre, coords });

  // ── interpolation ──
  const lines = outlines.slice(0, 40).map(([x, y]) => {
    const [x0, x1] = bounds(x);
    const xs = Array.from({ length: 25 }, () => uni(x0 - 1, x1 + 1));
    xs.push(...x, x0 - 2e-7, x1 + 5e-8, NaN);
    const pairs = Array.from({ length: 6 }, () => {
      const a = uni(x0 - 1, x1 + 1), b = uni(x0 - 1, x1 + 1);
      return [Math.min(a, b), Math.max(a, b)];
    });
    pairs.push([x0, x1], [x0, x0]);
    return {
      x,
      y,
      at: getYAtXMany(x, y, xs).map((v, i) => ({ x: xs[i], y: v, single: getYAtX(x, y, xs[i]) })),
      strict: xs.map((v) => ({ x: v, out: attempt(() => getYAtXStrict([x, y], v)) })),
      between: pairs.map(([a, b]) => ({ x1: a, x2: b, out: attempt(() => getLineBetweenPoints([x, y], a, b)) })),
    };
  });
  // vertical steps and a line with a gap
  const step: [number[], number[]] = [[0, 5, 5, 10], [0, 0, 3, 3]];
  lines.push({
    x: step[0],
    y: step[1],
    at: [5, 4.9, 5.1].map((v) => ({ x: v, y: getYAtX(step[0], step[1], v), single: getYAtX(step[0], step[1], v) })),
    strict: [5, 0, 10, -1, 11].map((v) => ({ x: v, out: attempt(() => getYAtXStrict(step, v)) })),
    between: [[1, 9], [6, 7], [-1, 3], [2, 2]].map(([a, b]) => ({ x1: a, x2: b, out: attempt(() => getLineBetweenPoints(step, a, b)) })),
  });
  const spatial = Array.from({ length: 30 }, (_, k) => {
    const n = k === 0 ? 0 : k === 1 ? 1 : 2 + Math.floor(R() * 8);
    const points = Array.from({ length: n }, () => ({ x: uni(-10, 10), y: uni(-10, 10), values: [uni(0, 50), uni(0, 45), uni(15, 22)] }));
    const queries = Array.from({ length: 10 }, () => [uni(-12, 12), uni(-12, 12)]);
    if (n > 0) queries.push([points[0].x, points[0].y], [points[0].x + 1e-11, points[0].y]);
    return {
      points,
      queries: queries.map(([qx, qy]) => ({
        q: [qx, qy],
        idw1: interpolateIDW(points, qx, qy, 1),
        idw2: interpolateIDW(points, qx, qy),
        idw3: interpolateIDW(points, qx, qy, 3),
        nearest: interpolateNearest(points, qx, qy),
      })),
    };
  });
  writeFixture("math", "interpolation", { lines, spatial });

  // ── loads ──
  const loads = Array.from({ length: 40 }, () => {
    const n = 1 + Math.floor(R() * 30), x0 = uni(-20, 20);
    const widths: number[] = [], centres: number[] = [];
    let x = x0;
    for (let i = 0; i < n; i++) {
      const w = uni(0.1, 3);
      widths.push(w);
      centres.push(x + w / 2);
      x += w;
    }
    const udls = Array.from({ length: Math.floor(R() * 4) }, () => [uni(x0 - 5, x + 5), uni(x0 - 5, x + 5), uni(-20, 50)]);
    // line loads at slice boundaries too (the half-open rule) and at the exit
    const lineLoads = Array.from({ length: Math.floor(R() * 4) }, () => [uni(x0 - 2, x + 2), uni(0, 100)]);
    lineLoads.push([centres[0] - widths[0] / 2, 7], [centres[n - 1] + widths[n - 1] / 2, 11]);
    return { widths, centres, udls, lineLoads, out: calculateAllLoads(widths, centres, udls as [number, number, number][], lineLoads as [number, number][]) };
  });
  writeFixture("math", "loads", loads);

  // ── helpers ──
  const kinds = ["constant", "half-sine", "clipped-sine", "trapezoidal", "data-point-specified", undefined] as const;
  const dataSets: [number, number][][] = [
    [],
    [[0, 0], [0.5, 1], [1, 0]],
    [[0.7, 0.2], [0.1, 0.9], [0.5, 0.5]],
    [[-1, 2], [0.3, NaN], [2, -1], [0.4, 0.6]],
    [[0.5, 0.3], [0.5, 0.8]],
    [[NaN, 1]],
  ];
  const interslice = [];
  for (const kind of kinds)
    for (const pts of dataSets)
      for (const [xs, xe] of [[0, 10], [-3, 7], [5, 5], [4, 2]])
        for (let k = 0; k < 15; k++) {
          const x = k < 13 ? xs + ((xe - xs) * (k - 1)) / 10 : k === 13 ? uni(-5, 12) : xs + (xe - xs) * 0.2;
          interslice.push({ kind: kind ?? null, x, xs, xe, pts, out: getIntersliceFunctionValue(kind, x, xs, xe, pts), dps: dataPointSpecified(x, xs, xe, pts) });
        }
  const points = Array.from({ length: 50 }, () => {
    const a: [number, number] = [uni(-50, 50), uni(-50, 50)], b: [number, number] = [uni(-50, 50), uni(-50, 50)];
    return { a, b, mid: midCoord(a, b), dist: distPoints(a, b) };
  });
  const lambda = [
    [],
    [[0, 1.2, 1.1]],
    [[0, 1.2, 1.1], [0.5, 1.25, 1.24]],
    [[0, 1, 1.2], [1, 1.1, 1.3]], // parallel slopes
    [[0, 1, 1.2], [1, 1.1, 1.3 + 1e-12], [0.5, 2, 0]],
    [[0, 1, 2], [0.1, 1, -50]], // far extrapolation: clamped to ±5
    [[0, NaN, 1], [0.2, 1.1, 1.0], [0.4, 1.2, 1.25]],
    ...Array.from({ length: 30 }, () => Array.from({ length: 2 + Math.floor(R() * 4) }, () => [uni(-1, 2), uni(0.5, 2), uni(0.5, 2)])),
  ].map((rows) => ({ rows, out: attempt(() => extrapolateLambda(rows as [number, number, number][])) }));
  const precision = [0, 1, -1, 0.1, 0.25, 1.5, 123.456, 0.0001, 1e-7, 1.5e-7, 1e21, 1.000012, 2.0003, 0.1 + 0.2, 1 / 3, -0.000123, 12.30001, NaN, Infinity, 5e-324, 123456789.125]
    .map((n) => ({ n, out: getPrecision(n) }));
  writeFixture("math", "helpers", { interslice, points, lambda, precision });

  // ── spline ──
  const tables: [number, number][][] = [
    [],
    [[1, 2]],
    [[0, 1], [1, 3]],
    [[0, 1], [1, 3], [3, 7]],
    [[0, 0], [1, 1], [2, 4], [3, 9]],
    [[0, 0], [10, 10], [30, 25], [100, 45]],
    ...Array.from({ length: 15 }, () => {
      let x = uni(-10, 10);
      return Array.from({ length: 2 + Math.floor(R() * 8) }, () => [(x += uni(0.1, 5)), uni(-20, 50)] as [number, number]);
    }),
  ];
  const slopes: [number | null, number | null][] = [[null, null], [0, null], [null, 6], [0, 6], [-1.5, 2.5]];
  const spline = [];
  for (const pts of tables)
    for (const s of slopes) {
      if (pts.length < 2 && (s[0] !== null || s[1] !== null) && pts.length === 0) continue;
      const sp = cubicSpline(pts, s);
      const x0 = pts.length ? pts[0][0] : 0, x1 = pts.length ? pts[pts.length - 1][0] : 1;
      const ts = Array.from({ length: 12 }, () => uni(x0 - 3, x1 + 3));
      ts.push(...pts.map((p) => p[0]));
      spline.push({ pts, slopes: s, m: Array.from(sp.m), evals: ts.map((t) => ({ t, ...evalSpline(sp, t) })) });
    }
  writeFixture("math", "spline", spline);
});
