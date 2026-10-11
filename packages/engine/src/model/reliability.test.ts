/**
 * Probabilistic analysis. The published problems (Slide2 VP28, VP29) are
 * in verification/reliability-cases.ts.
 */
import { describe, it, expect } from "vitest";
import { layered, mc, su, VERIFICATION_OPTIONS } from "../verification/cases";
import { analyseReliability, lognormalBeta, normalCdf } from "./reliability";
import type { RandomVariable } from "./reliability";
import type { AnalysisOptions } from "../types/analysis";

const ground: [number, number][] = [[0, 10], [10, 10], [25, 0], [40, 0]];
const options: Partial<AnalysisOptions> = { ...VERIFICATION_OPTIONS, method: "Bishop" };
// φ = 0: on a fixed surface F is proportional to su (and to 1/γ).
const clay = layered(ground, -10, [{ name: "C", topY: null, model: su(40, 18) }]);

describe("normal distribution helpers", () => {
  it("Φ and the lognormal β", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.6449)).toBeCloseTo(0.95, 4);
    expect(normalCdf(-2.3263)).toBeCloseTo(0.01, 4);
    // ln(1.5/√1.04)/√ln 1.04
    expect(lognormalBeta(1.5, 0.2)).toBeCloseTo(1.9483, 4);
    expect(lognormalBeta(1.5, 0)).toBe(Infinity);
  });
});

describe("Taylor series", { timeout: 30_000 }, () => {
  it("COV of F equals the COV of su when F ∝ su", () => {
    const v: RandomVariable[] = [{ material: 0, field: "undrainedShearStrength", sd: 8 }];
    const r = analyseReliability(clay, options, v, { method: "taylor", search: false });
    expect(r.cov).toBeCloseTo(8 / 40, 6);
    expect(r.sdFOS).toBeCloseTo(r.fos * 0.2, 6);
    expect(r.betaLognormal).toBeCloseTo(lognormalBeta(r.fos, 0.2), 6);
    expect(r.pfLognormal).toBeCloseTo(normalCdf(-r.betaLognormal), 9);
    expect(r.terms![0].fPlus).toBeCloseTo(r.fos * 1.2, 6);
  });

  it("adds the variables, with their correlation", () => {
    const two = layered(ground, -10, [
      { name: "Top", topY: null, model: su(40, 18) },
      { name: "Base", topY: 4, model: su(40, 18) },
    ]);
    const v: RandomVariable[] = [
      { material: 0, field: "undrainedShearStrength", sd: 8 },
      { material: 1, field: "undrainedShearStrength", sd: 8 },
    ];
    const independent = analyseReliability(two, options, v, { method: "taylor", search: false });
    const [a, b] = independent.terms!.map((t) => (t.fPlus - t.fMinus) / 2);
    expect(independent.sdFOS).toBeCloseTo(Math.hypot(a, b), 9);
    const correlated = analyseReliability(two, options, v, {
      method: "taylor",
      search: false,
      correlations: [{ a: 0, b: 1, rho: 0.5 }],
    });
    expect(correlated.sdFOS).toBeCloseTo(Math.sqrt(a * a + b * b + a * b), 9);
  });

  it("searches the surface again for each evaluation (never above the fixed surface)", () => {
    const sand = layered(ground, -10, [{ name: "S", topY: null, model: mc(5, 30, 19) }]);
    const v: RandomVariable[] = [{ material: 0, field: "cohesion", sd: 2 }];
    const fixed = analyseReliability(sand, options, v, { method: "taylor", search: false });
    const searched = analyseReliability(sand, options, v, { method: "taylor" });
    expect(searched.fos).toBeCloseTo(fixed.fos, 9);
    expect(searched.terms![0].fPlus).toBeLessThanOrEqual(fixed.terms![0].fPlus + 1e-9);
    expect(searched.terms![0].fMinus).toBeLessThanOrEqual(fixed.terms![0].fMinus + 1e-9);
  });

  it("rejects mean − σ below zero and unknown fields", () => {
    expect(() =>
      analyseReliability(clay, options, [{ material: 0, field: "undrainedShearStrength", sd: 50 }], { method: "taylor" }),
    ).toThrow(/negative/);
    expect(() => analyseReliability(clay, options, [{ material: 0, field: "cohesion", sd: 1 }], { method: "taylor" })).toThrow(
      /has no cohesion/,
    );
  });
});

describe("Monte Carlo", { timeout: 30_000 }, () => {
  const v: RandomVariable[] = [{ material: 0, field: "undrainedShearStrength", sd: 8, distribution: "lognormal" }];

  it("reproduces F lognormal with the COV of su", () => {
    const r = analyseReliability(clay, options, v, { method: "monte-carlo", samples: 4000, seed: 7 });
    expect(r.failed).toBe(0);
    expect(r.samples).toHaveLength(4000);
    expect(r.meanFOS / r.fos).toBeCloseTo(1, 1);
    expect(r.cov).toBeGreaterThan(0.19);
    expect(r.cov).toBeLessThan(0.21);
    // The share below 1 matches the lognormal Pf of F.
    expect(Math.abs(r.pf! - normalCdf(-lognormalBeta(r.fos, 0.2)))).toBeLessThan(0.02);
  });

  it("is reproducible with the seed and restores the slope", () => {
    const a = analyseReliability(clay, options, v, { method: "monte-carlo", samples: 200, seed: 3 });
    const b = analyseReliability(clay, options, v, { method: "monte-carlo", samples: 200, seed: 3 });
    const c = analyseReliability(clay, options, v, { method: "monte-carlo", samples: 200, seed: 4 });
    expect(a.samples).toEqual(b.samples);
    expect(a.samples).not.toEqual(c.samples);
  });

  it("truncates normal samples at zero", () => {
    const wide: RandomVariable[] = [{ material: 0, field: "undrainedShearStrength", sd: 30 }];
    const r = analyseReliability(clay, options, wide, { method: "monte-carlo", samples: 500, seed: 1 });
    expect(Math.min(...r.samples!)).toBeGreaterThan(0);
  });

  it("correlated variables widen the spread as in the Taylor series", () => {
    const two = layered(ground, -10, [
      { name: "Top", topY: null, model: su(40, 18) },
      { name: "Base", topY: 4, model: su(40, 18) },
    ]);
    const vars: RandomVariable[] = [
      { material: 0, field: "undrainedShearStrength", sd: 6 },
      { material: 1, field: "undrainedShearStrength", sd: 6 },
    ];
    const ind = analyseReliability(two, options, vars, { method: "monte-carlo", samples: 2000, seed: 5 });
    const cor = analyseReliability(two, options, vars, {
      method: "monte-carlo",
      samples: 2000,
      seed: 5,
      correlations: [{ a: 0, b: 1, rho: 0.9 }],
    });
    const correlations = [{ a: 0, b: 1, rho: 0.9 }];
    const taylor = analyseReliability(two, options, vars, { method: "taylor", search: false, correlations });
    expect(cor.sdFOS).toBeGreaterThan(ind.sdFOS);
    expect(cor.sdFOS / taylor.sdFOS).toBeCloseTo(1, 1);
    expect(() =>
      analyseReliability(two, options, vars, { method: "monte-carlo", correlations: [{ a: 0, b: 0, rho: 0.5 }] }),
    ).toThrow(/two different/);
  });
});
