/**
 * Probabilistic analysis. The published problems (V021, V022, V023) are
 * in verification/reliability-cases.ts.
 */
import { describe, it, expect } from "vitest";
import { layered, mc, su, VERIFICATION_OPTIONS } from "../verification/cases";
import { analyseReliability, lognormalBeta, normalCdf, reliabilitySurfaceToModelSpace } from "./reliability";
import { RELIABILITY_CASES } from "../verification/reliability-cases";
import { runVerification } from "../verification/cases";
import { toCanonicalSlopeDefinition } from "./canonical";
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
    expect(lognormalBeta(0.8, 0)).toBe(-Infinity);
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

  it("right-to-left models: the canonical definition, surface mapped back", () => {
    const c = RELIABILITY_CASES.find((x) => x.id === "V022a")!;
    const def = toCanonicalSlopeDefinition(c.definition);
    const r = analyseReliability(def, { ...options, slices: 60 }, c.variables, { method: "taylor", search: false });
    expect(r.fos).toBeCloseTo(runVerification(c.definition, "Bishop", { slices: 60 }).fos!, 9);
    const s = reliabilitySurfaceToModelSpace(r.surface, def);
    const given = c.definition.customSearchPlanes![0];
    expect(s.cx).toBeCloseTo(given.cx, 6);
    expect(s.radius).toBeCloseTo(given.radius, 6);
    // On the model's left side (face 30–55, crest 55–60).
    expect(Math.min(s.lc[0], s.rc[0])).toBeGreaterThan(15);
    expect(Math.max(s.lc[0], s.rc[0])).toBeLessThan(60);
  });

  it("rates may be zero or negative", () => {
    const rising = layered(ground, -10, [{ name: "C", topY: null, model: su(40, 18, 10, 0) }]);
    const v: RandomVariable[] = [{ material: 0, field: "suRateOfChange", sd: 1 }];
    const r = analyseReliability(rising, options, v, { method: "taylor", search: false });
    expect(r.terms![0].fPlus).toBeGreaterThan(r.fos);
    expect(r.terms![0].fMinus).toBeLessThan(r.fos);
  });

  it("re-analyses an optimised non-circular surface about the same axis", () => {
    const sand = layered(ground, -10, [{ name: "S", topY: null, model: mc(5, 30, 19) }]);
    const v: RandomVariable[] = [{ material: 0, field: "cohesion", sd: 1e-6 }];
    const opts = { ...options, nonCircularOptimization: true };
    const r = analyseReliability(sand, opts, v, { method: "taylor", search: false });
    expect(r.surface.points).toBeDefined();
    expect(r.terms![0].fPlus).toBeCloseTo(r.fos, 5);
    const m = analyseReliability(sand, opts, v, { method: "monte-carlo", samples: 20 });
    expect(m.meanFOS).toBeCloseTo(r.fos, 5);
  });

  it("rejects a material that is in no region", () => {
    const unused = { ...clay, materials: [...clay.materials, { ...clay.materials[0], name: "Unused" }] };
    expect(() =>
      analyseReliability(unused, options, [{ material: 1, field: "undrainedShearStrength", sd: 8 }], { method: "monte-carlo" }),
    ).toThrow(/not used/);
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

  it("does not truncate rates at zero", () => {
    const rising = layered(ground, -10, [{ name: "C", topY: null, model: su(40, 18, 10, 0) }]);
    const v: RandomVariable[] = [{ material: 0, field: "suRateOfChange", sd: 1 }];
    const r = analyseReliability(rising, options, v, { method: "monte-carlo", samples: 400, seed: 2 });
    // Symmetric about the mean: about half of the samples below F.
    const below = r.samples!.filter((f) => f < r.fos).length / r.samples!.length;
    expect(below).toBeGreaterThan(0.4);
    expect(below).toBeLessThan(0.6);
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
