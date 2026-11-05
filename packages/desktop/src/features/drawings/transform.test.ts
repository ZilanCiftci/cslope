import { describe, expect, it } from "vitest";
import {
  affineLeastSquares,
  apply,
  compose,
  cropCorners,
  fitAxes,
  fitPoints,
  fitScale,
  insideConvex,
  invert,
  isUsable,
  legacyTransform,
  similarityFromTwo,
  translate,
  verticalExaggeration,
  type Affine,
  type Pt,
} from "./transform";

const close = (a: Pt, b: Pt, eps = 1e-9) => {
  expect(a[0]).toBeCloseTo(b[0], -Math.log10(eps));
  expect(a[1]).toBeCloseTo(b[1], -Math.log10(eps));
};

describe("2-point similarity", () => {
  it("takes both points exactly, with the drawing's y flipped up", () => {
    // 100 px = 10 m along the drawing's x; the drawing upright.
    const fit = similarityFromTwo({ source: [100, 400], model: [0, 0] }, { source: [200, 400], model: [10, 0] });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    close(apply(fit.transform, [100, 400]), [0, 0]);
    close(apply(fit.transform, [200, 400]), [10, 0]);
    // 50 px up in the drawing (smaller v) is 5 m up in the model.
    close(apply(fit.transform, [100, 350]), [0, 5]);
    expect(fit.residuals.every((r) => r < 1e-9)).toBe(true);
    expect(verticalExaggeration(fit.transform)).toBeCloseTo(1, 12);
  });

  it("finds a rotation and a uniform scale", () => {
    // A drawing turned 30° and scaled 0.05 m per px.
    const angle = (30 * Math.PI) / 180;
    const truth: Affine = { a: 0.05 * Math.cos(angle), b: 0.05 * Math.sin(angle), c: 0.05 * Math.sin(angle), d: -0.05 * Math.cos(angle), e: 12, f: -3 };
    const s1: Pt = [10, 20];
    const s2: Pt = [400, 250];
    const fit = similarityFromTwo({ source: s1, model: apply(truth, s1) }, { source: s2, model: apply(truth, s2) });
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    for (const k of ["a", "b", "c", "d", "e", "f"] as const) expect(fit.transform[k]).toBeCloseTo(truth[k], 10);
  });

  it("refuses points too close together, or with one model point", () => {
    expect(similarityFromTwo({ source: [10, 10], model: [0, 0] }, { source: [10.5, 10], model: [5, 0] })).toEqual({
      ok: false,
      error: "The two points are too close together in the drawing.",
    });
    expect(similarityFromTwo({ source: [10, 10], model: [3, 4] }, { source: [100, 10], model: [3, 4] })).toMatchObject({ ok: false, error: /same model coordinates/ });
  });
});

describe("3+ point least-squares affine", () => {
  const truth: Affine = { a: 0.1, b: 0.002, c: -0.001, d: -0.05, e: -4, f: 20 };
  const src: Pt[] = [
    [0, 0],
    [500, 10],
    [20, 300],
    [480, 320],
    [250, 150],
  ];

  it("fits three points exactly (vertical exaggeration and shear included)", () => {
    const fit = affineLeastSquares(src.slice(0, 3).map((s) => ({ source: s, model: apply(truth, s) })));
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    for (const k of ["a", "b", "c", "d", "e", "f"] as const) expect(fit.transform[k]).toBeCloseTo(truth[k], 9);
    expect(Math.max(...fit.residuals)).toBeLessThan(1e-9);
  });

  it("gives each point's residual in metres when the points do not fit exactly", () => {
    const pairs = src.map((s, i) => {
      const [x, y] = apply(truth, s);
      // one point clicked 0.3 m off
      return { source: s, model: (i === 3 ? [x + 0.3, y] : [x, y]) as Pt };
    });
    const fit = fitPoints(pairs);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.residuals).toHaveLength(5);
    expect(Math.max(...fit.residuals)).toBeGreaterThan(0.05);
    // the misfit is shared out, the worst at the point clicked off
    expect(fit.residuals.indexOf(Math.max(...fit.residuals))).toBe(3);
    // residuals are |M·source − model|
    pairs.forEach((p, i) => {
      const [x, y] = apply(fit.transform, p.source);
      expect(Math.hypot(x - p.model[0], y - p.model[1])).toBeCloseTo(fit.residuals[i], 12);
    });
  });

  it("refuses collinear or coincident drawing points and a singular result", () => {
    const line = [0, 100, 200].map((u) => ({ source: [u, 2 * u] as Pt, model: [u, u] as Pt }));
    expect(affineLeastSquares(line)).toMatchObject({ ok: false, error: /on one line/ });
    const same = [0, 0, 0].map(() => ({ source: [5, 5] as Pt, model: [1, 1] as Pt }));
    expect(affineLeastSquares(same)).toMatchObject({ ok: false, error: /too close/ });
    const flat = [
      { source: [0, 0] as Pt, model: [0, 0] as Pt },
      { source: [100, 0] as Pt, model: [10, 0] as Pt },
      { source: [0, 100] as Pt, model: [20, 0] as Pt },
    ];
    expect(affineLeastSquares(flat)).toMatchObject({ ok: false, error: /singular/ });
    expect(fitPoints([{ source: [0, 0], model: [0, 0] }])).toMatchObject({ ok: false });
  });
});

describe("axes calibration", () => {
  // A section drawn at 1:200 horizontally, 1:100 vertically (exaggeration 2),
  // in PDF points: x 0 m at u = 100 pt, 40 m at u = 667 pt; y 0 m at v = 500, 10 m at v = 216.5.
  const x = [
    { source: [100, 505] as Pt, value: 0 },
    { source: [667, 498] as Pt, value: 40 },
  ];
  const y = [
    { source: [96, 500] as Pt, value: 0 },
    { source: [101, 216.5] as Pt, value: 10 },
  ];

  it("scales x and y separately (vertical exaggeration), with no rotation", () => {
    const fit = fitAxes(x, y);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.transform.b).toBe(0);
    expect(fit.transform.c).toBe(0);
    expect(fit.transform.a).toBeCloseTo(40 / 567, 12);
    expect(fit.transform.d).toBeCloseTo(-10 / 283.5, 12);
    expect(verticalExaggeration(fit.transform)).toBeCloseTo(2, 2);
    close(apply(fit.transform, [100, 500]), [0, 0]);
    close(apply(fit.transform, [667, 216.5]), [40, 10]);
    // only u counts on the x axis, only v on the y axis
    expect(Math.max(...fit.residuals)).toBeLessThan(1e-9);
  });

  it("reuses a known scale: one point per axis is enough", () => {
    const first = fitAxes(x, y);
    if (!first.ok) throw new Error(first.error);
    // A second section on the same sheet, elsewhere on it.
    const second = fitAxes([{ source: [150, 300], value: 5 }], [{ source: [150, 260], value: 20 }], { x: first.transform.a, y: first.transform.d });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.transform.a).toBe(first.transform.a);
    expect(second.transform.d).toBe(first.transform.d);
    close(apply(second.transform, [150, 260]), [5, 20]);
  });

  it("says what is missing or degenerate", () => {
    expect(fitAxes(x.slice(0, 1), y)).toMatchObject({ ok: false, error: "Pick two points on the x axis." });
    expect(fitAxes(x, [y[0], { source: [96, 500.5], value: 10 }])).toMatchObject({ ok: false, error: /y axis are too close/ });
    expect(fitAxes([x[0], { ...x[1], value: 0 }], y)).toMatchObject({ ok: false, error: /x axis have the same value/ });
    expect(fitAxes(x.slice(0, 1), y.slice(0, 1), { x: 0, y: -1 })).toMatchObject({ ok: false, error: /x scale to reuse/ });
  });
});

describe("scale calibration", () => {
  it("places an origin point and a uniform scale (y flipped up)", () => {
    const fit = fitScale({ source: [50, 400], model: [10, -2] }, 0.2);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    close(apply(fit.transform, [50, 400]), [10, -2]);
    close(apply(fit.transform, [60, 390]), [12, 0]);
    expect(fitScale({ source: [0, 0], model: [0, 0] }, 0)).toMatchObject({ ok: false });
    expect(fitScale({ source: [0, 0], model: [0, 0] }, Number.NaN)).toMatchObject({ ok: false });
  });
});

describe("transform helpers", () => {
  const m: Affine = { a: 2, b: 0.5, c: -0.25, d: -3, e: 7, f: -1 };

  it("inverts and composes", () => {
    const inv = invert(m)!;
    close(apply(compose(inv, m), [3, 4]), [3, 4], 1e-12);
    close(apply(compose(m, inv), [3, 4]), [3, 4], 1e-12);
    expect(invert({ a: 1, b: 2, c: 2, d: 4, e: 0, f: 0 })).toBeNull();
    close(apply(translate(m, 1, -2), [0, 0]), [8, -3]);
  });

  it("tells a usable transform from a singular or non-finite one", () => {
    expect(isUsable(m)).toBe(true);
    expect(isUsable({ ...m, a: 0, b: 0 })).toBe(false);
    expect(isUsable({ ...m, e: Number.POSITIVE_INFINITY })).toBe(false);
  });

  it("maps a crop's corners and tests points inside", () => {
    const corners = cropCorners({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 0 }, { x0: 0, y0: 0, x1: 10, y1: 5 });
    expect(corners).toEqual([
      [0, 0],
      [10, 0],
      [10, -5],
      [0, -5],
    ]);
    expect(insideConvex(corners, [5, -2])).toBe(true);
    expect(insideConvex(corners, [11, -2])).toBe(false);
    expect(insideConvex([...corners].reverse(), [5, -2])).toBe(true);
  });
});

describe("the first form of a placement", () => {
  it("puts the image's bottom-left corner at the origin, metres per pixel", () => {
    const t = legacyTransform({ originX: 3, originY: 4, scale: 0.5, rotationDeg: 0, mirrored: false }, 100, 40);
    close(apply(t, [0, 40]), [3, 4]); // bottom-left
    close(apply(t, [100, 0]), [53, 24]); // top-right
  });

  it("rotates about the corner and mirrors in place", () => {
    const r = legacyTransform({ originX: 0, originY: 0, scale: 1, rotationDeg: 90, mirrored: false }, 10, 10);
    close(apply(r, [10, 10]), [0, 10], 1e-12); // bottom-right → up the y axis
    const m = legacyTransform({ originX: 0, originY: 0, scale: 1, rotationDeg: 0, mirrored: true }, 10, 4);
    close(apply(m, [10, 4]), [0, 0]); // the bottom-right pixel is the bottom-left corner
    close(apply(m, [0, 0]), [10, 4]);
  });
});
