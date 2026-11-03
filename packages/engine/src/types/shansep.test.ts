import { describe, expect, it } from "vitest";
import { layered, mc, runVerification } from "../verification/cases";
import { shansepSu } from "./strength";
import type { MaterialModel } from "./material-models";

const shansep = (extra: Partial<Extract<MaterialModel, { kind: "shansep" }>> = {}): Extract<MaterialModel, { kind: "shansep" }> => ({
  kind: "shansep",
  unitWeight: 18,
  ratio: 0.25,
  ...extra,
});

describe("SHANSEP", () => {
  it("Su = σ′v·S·OCR^m, OCR constant or from elevation, Su from σ′v, a lower limit", () => {
    const at = (m: Extract<MaterialModel, { kind: "shansep" }>, sv: number, y = 0) => shansepSu(m, { yBottom: y, yGround: 10, effectiveVerticalStress: sv });
    expect(at(shansep({ ocr: 4, exponent: 0.8 }), 100)).toBeCloseTo(100 * 0.25 * 4 ** 0.8, 12);
    expect(at(shansep(), 100)).toBeCloseTo(25, 12);
    const byY = shansep({ exponent: 1, ocrByElevation: [[0, 1], [10, 3]] });
    expect(at(byY, 100, 5)).toBeCloseTo(100 * 0.25 * 2, 12);
    expect(at(byY, 100, -5)).toBeCloseTo(25, 12); // constant beyond the ends
    expect(at(shansep({ suByStress: [[0, 10], [100, 30]] }), 50)).toBeCloseTo(20, 12);
    expect(at(shansep({ suMin: 8 }), 10)).toBe(8);
    // without σ′v: the overburden of the model's unit weight
    expect(shansepSu(shansep(), { yBottom: 6, yGround: 10 })).toBeCloseTo(4 * 18 * 0.25, 12);
  });

  it("on a slice: S times the slice's weight per width less its pore pressure; B̄ adds the fill's weight to it", () => {
    // clay (SHANSEP) under 3 m of fill; water at the top of the clay
    const def = (clay: MaterialModel) =>
      layered([[0, 13], [20, 13], [30, 10], [60, 10]], 0, [
        { name: "Fill", topY: null, model: { ...mc(0, 35, 18), bBarLoad: true } },
        { name: "Clay", topY: 10, model: clay },
      ], { waterTable: { mode: "custom", value: [[0, 10], [60, 10]], followBoundary: false } });
    const circle = { customSearchPlanes: [{ cx: 25, cy: 25, radius: 21 }], customPlanesOnly: true };
    const run = (clay: MaterialModel) => runVerification({ ...def(clay), ...circle }, "Bishop", { slices: 40 });
    const plain = run(shansep({ unitWeight: 17 }));
    const withB = run(shansep({ unitWeight: 17, bBar: 1 }));
    for (const s of plain.slope.search[0].slices!) {
      if (s.baseMaterial?.name !== "Clay") continue;
      expect(s.cohesion).toBeCloseTo(0.25 * ((s.weight + s.udl + s.ll) / s.width - s.U), 9);
    }
    // the fill's weight per width becomes pore pressure in the clay below it
    const a = plain.slope.search[0].slices!, b = withB.slope.search[0].slices!;
    let checked = 0;
    a.forEach((s, i) => {
      if (s.baseMaterial?.name !== "Clay" || s.yTop <= 10.01) return;
      const fill = (Math.min(s.y0Top, s.y1Top) - 10) * 18;
      expect(b[i].U - s.U).toBeGreaterThanOrEqual(fill - 1e-6);
      checked++;
    });
    expect(checked).toBeGreaterThan(3);
    expect(withB.fos!).toBeLessThan(plain.fos!);
  });
});

describe("shear-normal function", () => {
  it("tangent c and φ of the segment at σn; a spline's tangent with it", async () => {
    const { shearNormalAt } = await import("./strength");
    const pts: [number, number][] = [[0, 0], [10, 10], [30, 25], [100, 45]];
    // on the segment 10–30: tan φ = 0.75, c = 10 − 10·0.75
    const a = shearNormalAt({ points: pts }, 20);
    expect(Math.tan((a.frictionAngle * Math.PI) / 180)).toBeCloseTo(0.75, 12);
    expect(a.cohesion).toBeCloseTo(2.5, 12);
    // the last segment extended beyond the end
    const b = shearNormalAt({ points: pts }, 200);
    expect(b.cohesion + 200 * Math.tan((b.frictionAngle * Math.PI) / 180)).toBeCloseTo(45 + 100 * (20 / 70), 9);
    // a natural spline: through the points, its tangent there
    const s = shearNormalAt({ points: pts, spline: {} }, 30);
    expect(s.cohesion + 30 * Math.tan((s.frictionAngle * Math.PI) / 180)).toBeCloseTo(25, 9);
  });

  it("a natural cubic spline: zero curvature at the ends, exact on a cubic's knots, straight beyond", async () => {
    const { cubicSpline, evalSpline } = await import("../math/spline");
    const line = cubicSpline([[0, 1], [1, 3], [3, 7]]);
    expect(evalSpline(line, 2).value).toBeCloseTo(5, 12);
    expect(evalSpline(line, 5).value).toBeCloseTo(11, 12);
    // clamped with the true end slopes of y = x²: exact for the parabola
    const sq = cubicSpline([[0, 0], [1, 1], [2, 4], [3, 9]], [0, 6]);
    expect(evalSpline(sq, 1.5).value).toBeCloseTo(2.25, 12);
    expect(evalSpline(sq, 2.5).slope).toBeCloseTo(5, 12);
  });

  it("the analysis updates the tangent strength from the normal stress it finds", () => {
    const def = layered([[0, 10], [10, 10], [20, 0], [40, 0]], -10, [
      { name: "S", topY: null, model: { kind: "shear-normal", unitWeight: 19, points: [[0, 5], [50, 35], [200, 100]] } as MaterialModel },
    ]);
    const r = runVerification({ ...def, customSearchPlanes: [{ cx: 18, cy: 18, radius: 19 }], customPlanesOnly: true }, "Morgenstern-Price", { slices: 30 });
    expect(r.fos).not.toBeNull();
    // each base on the envelope at its final normal stress (within the fixed point's tolerance)
    const slices = r.slope.search[0].slices!;
    const varied = new Set(slices.map((s) => s.frictionAngle.toFixed(3)));
    expect(varied.size).toBeGreaterThan(1);
  });
});

describe("shear-normal function, convex and falling parts", () => {
  it("never above the curve: the secant where the tangent's intercept would be negative, the value where it falls", async () => {
    const { shearNormalAt } = await import("./strength");
    const tau = (pts: [number, number][], sn: number, spline = false) => {
      const t = shearNormalAt({ points: pts, ...(spline ? { spline: {} } : {}) }, sn);
      return t.cohesion + sn * Math.tan((t.frictionAngle * Math.PI) / 180);
    };
    const convex: [number, number][] = [[0, 0], [50, 10], [100, 60]];
    expect(tau(convex, 100)).toBeCloseTo(60, 9);
    expect(tau(convex, 75)).toBeCloseTo(35, 9);
    const falling: [number, number][] = [[0, 0], [100, 60], [200, 50]];
    expect(tau(falling, 150)).toBeCloseTo(55, 9);
  });
});
