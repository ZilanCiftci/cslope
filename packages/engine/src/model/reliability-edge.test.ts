/**
 * Probabilistic analysis edge cases on a fixed circle (fast): σ = 0,
 * truncation, every sample failing, correlations (negative, invalid, not
 * positive definite), lognormal variables with mean ≤ 0, γ with γsat.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import type { AnalysisOptions } from "../types/analysis";
import type { MaterialModel } from "../types/material-models";
import { analyseReliability, reliabilitySurfaceToModelSpace, type RandomVariable } from "./reliability";
import { toCanonicalSlopeDefinition } from "./canonical";

const options: Partial<AnalysisOptions> = { slices: 30, tolerance: 1e-8, maxIterations: 100, method: "Bishop" };

function slope(top: MaterialModel, bottom?: MaterialModel): SlopeDefinition {
  const def: SlopeDefinition = {
    coordinates: [[0, -10], [0, 10], [10, 10], [25, 0], [40, 0], [40, -10]],
    materials: [{ name: "Top", unitWeight: top.unitWeight, cohesion: 0, frictionAngle: 0, model: top }],
    customSearchPlanes: [{ cx: 22, cy: 18, radius: 18.5 }],
    customPlanesOnly: true,
  };
  if (bottom) {
    def.materials.push({ name: "Bottom", unitWeight: bottom.unitWeight, cohesion: 0, frictionAngle: 0, model: bottom });
    def.materialBoundaries = [{ coordinates: [[0, 4], [40, 4]], materialName: "Bottom" }];
    def.regionAssignments = [
      { point: [1, 7], materialName: "Top" },
      { point: [1, -5], materialName: "Bottom" },
    ];
  }
  return def;
}

const su = (s: number, gamma = 18, extra: Partial<MaterialModel> = {}): MaterialModel =>
  ({ kind: "undrained", unitWeight: gamma, undrainedShearStrength: s, ...extra }) as MaterialModel;
const mc = (c: number, phi: number, gamma = 19, extra: Partial<MaterialModel> = {}): MaterialModel =>
  ({ kind: "mohr-coulomb", unitWeight: gamma, cohesion: c, frictionAngle: phi, ...extra }) as MaterialModel;

const clay = slope(su(40));
const SU: RandomVariable = { material: 0, field: "undrainedShearStrength", sd: 8 };

describe("reliability: input checks", () => {
  it("rejects no variables, negative or non-finite σ and unknown materials", () => {
    expect(() => analyseReliability(clay, options, [], { method: "taylor" })).toThrow(/at least one random variable/);
    expect(() => analyseReliability(clay, options, [{ ...SU, sd: -1 }], { method: "taylor" })).toThrow(/≥ 0/);
    expect(() => analyseReliability(clay, options, [{ ...SU, sd: NaN }], { method: "taylor" })).toThrow(/≥ 0/);
    expect(() => analyseReliability(clay, options, [{ ...SU, material: 3 }], { method: "taylor" })).toThrow(/no material 4/);
  });

  it("rejects a model without a slip surface at the mean values", () => {
    const missing = { ...clay, customSearchPlanes: [{ cx: 22, cy: 60, radius: 5 }] };
    expect(() => analyseReliability(missing, options, [SU], { method: "taylor" })).toThrow(/No valid slip surface/);
  });

  it("rejects invalid correlations and a matrix that is not positive definite", () => {
    const two = slope(su(40), su(50));
    const v: RandomVariable[] = [SU, { material: 1, field: "undrainedShearStrength", sd: 5 }];
    for (const c of [{ a: 0, b: 0, rho: 0.5 }, { a: 0, b: 2, rho: 0.5 }, { a: -1, b: 1, rho: 0.5 }, { a: 0, b: 1, rho: 1 }, { a: 0, b: 1, rho: NaN }]) {
      expect(() => analyseReliability(two, options, v, { method: "taylor", correlations: [c] })).toThrow(/\|ρ\| < 1/);
    }
    const three: RandomVariable[] = [...v, { material: 0, field: "unitWeight", sd: 1 }];
    expect(() =>
      analyseReliability(two, options, three, {
        method: "monte-carlo",
        samples: 10,
        correlations: [
          { a: 0, b: 1, rho: 0.9 },
          { a: 0, b: 2, rho: 0.9 },
          { a: 1, b: 2, rho: -0.9 },
        ],
      }),
    ).toThrow(/not positive definite/);
  });
});

describe("reliability: σ = 0", () => {
  it("Taylor: no spread, β = ∞, pf = 0 (and β = −∞, pf = 1 below F = 1)", () => {
    const r = analyseReliability(clay, options, [{ ...SU, sd: 0 }], { method: "taylor", search: false });
    expect(r.sdFOS).toBe(0);
    expect(r.cov).toBe(0);
    expect(r.terms![0].fPlus).toBeCloseTo(r.fos, 12);
    expect(r.betaLognormal).toBe(Infinity);
    expect(r.betaNormal).toBe(Infinity);
    expect(r.pfLognormal).toBe(0);
    const weak = analyseReliability(slope(su(10)), options, [{ ...SU, sd: 0 }], { method: "taylor", search: false });
    expect(weak.fos).toBeLessThan(1);
    expect(weak.betaNormal).toBe(-Infinity);
    expect(weak.betaLognormal).toBe(-Infinity);
    expect(weak.pfLognormal).toBe(1);
  });

  it("Monte Carlo: every sample is the FOS at the mean", () => {
    const r = analyseReliability(clay, options, [{ ...SU, sd: 0 }], { method: "monte-carlo", samples: 12 });
    expect(r.samples).toHaveLength(12);
    for (const f of r.samples!) expect(f).toBeCloseTo(r.fos, 9);
    expect(r.sdFOS).toBeCloseTo(0, 9);
    expect(r.pf).toBe(0);
    expect(r.failed).toBe(0);
  });
});

describe("reliability: Monte Carlo sampling", () => {
  it("at least 10 samples; progress reported; same seed, same samples", () => {
    const progress: number[] = [];
    const a = analyseReliability(clay, options, [SU], { method: "monte-carlo", samples: 3, seed: 5 });
    expect(a.samples).toHaveLength(10);
    const b = analyseReliability(clay, options, [SU], { method: "monte-carlo", samples: 100, seed: 5, onProgress: (p) => progress.push(p) });
    expect(b.samples!.slice(0, 10)).toEqual(a.samples);
    expect(progress).toEqual([0.5, 1]);
    const c = analyseReliability(clay, options, [SU], { method: "monte-carlo", samples: 10, seed: 6 });
    expect(c.samples).not.toEqual(a.samples);
  });

  it("truncates samples to [min, max]: F ∝ su stays within F(min)..F(max)", () => {
    const r = analyseReliability(clay, options, [{ ...SU, sd: 30, min: 35, max: 45 }], { method: "monte-carlo", samples: 60 });
    const perSu = r.fos / 40;
    for (const f of r.samples!) {
      expect(f).toBeGreaterThanOrEqual(perSu * 35 - 1e-9);
      expect(f).toBeLessThanOrEqual(perSu * 45 + 1e-9);
    }
  });

  it("clamps to the bounds when no sample in 100 attempts falls inside them", () => {
    // Bounds far out in the tail: every sample is clamped to min.
    const r = analyseReliability(clay, options, [{ ...SU, sd: 1, min: 80, max: 90 }], { method: "monte-carlo", samples: 10 });
    for (const f of r.samples!) expect(f).toBeCloseTo((r.fos / 40) * 80, 6);
  });

  it("strength is truncated at 0 by default (no negative su)", () => {
    const r = analyseReliability(slope(su(5)), options, [{ ...SU, sd: 20 }], { method: "monte-carlo", samples: 80 });
    for (const f of r.samples!) expect(f).toBeGreaterThanOrEqual(0);
  });

  it("throws when (almost) every sample fails", () => {
    // Negative strength everywhere: every FOS is negative and discarded.
    expect(() =>
      analyseReliability(clay, options, [{ ...SU, sd: 1, min: -1e6, max: -1 }], { method: "monte-carlo", samples: 10 }),
    ).toThrow(/Too few Monte Carlo samples/);
  });

  it("lognormal samples are positive; with mean ≤ 0 the variable is sampled as normal", () => {
    const logn = analyseReliability(clay, options, [{ ...SU, sd: 40, distribution: "lognormal" }], { method: "monte-carlo", samples: 100 });
    for (const f of logn.samples!) expect(f).toBeGreaterThan(0);
    // Mean of a lognormal variable is the given mean: E[F] ≈ F(mean).
    expect(logn.meanFOS / logn.fos).toBeGreaterThan(0.75);
    expect(logn.meanFOS / logn.fos).toBeLessThan(1.25);
    // su rising with depth at a rate of mean 0: lognormal impossible.
    const rising = slope(su(40, 18, { suRateOfChange: 0, suRefDepth: 10 } as Partial<MaterialModel>));
    const v: RandomVariable = { material: 0, field: "suRateOfChange", sd: 0.5, distribution: "lognormal" };
    const r = analyseReliability(rising, options, [v], { method: "monte-carlo", samples: 60, seed: 3 });
    const normal = analyseReliability(rising, options, [{ ...v, distribution: "normal" }], { method: "monte-carlo", samples: 60, seed: 3 });
    expect(r.samples).toEqual(normal.samples);
    expect(r.samples!.some((f) => f < r.fos)).toBe(true);
    expect(r.samples!.some((f) => f > r.fos)).toBe(true);
  });

  it("negative correlation narrows the spread of F when both strengths add", () => {
    const two = slope(su(40), su(40));
    const v: RandomVariable[] = [SU, { material: 1, field: "undrainedShearStrength", sd: 8 }];
    const indep = analyseReliability(two, options, v, { method: "monte-carlo", samples: 200, seed: 9 });
    const neg = analyseReliability(two, options, v, { method: "monte-carlo", samples: 200, seed: 9, correlations: [{ a: 0, b: 1, rho: -0.9 }] });
    const pos = analyseReliability(two, options, v, { method: "monte-carlo", samples: 200, seed: 9, correlations: [{ a: 0, b: 1, rho: 0.9 }] });
    expect(neg.sdFOS).toBeLessThan(indep.sdFOS);
    expect(pos.sdFOS).toBeGreaterThan(indep.sdFOS);
    // Taylor with ρ < 0: σF² = a² + b² + 2ρab.
    const t = analyseReliability(two, options, v, { method: "taylor", search: false, correlations: [{ a: 0, b: 1, rho: -0.5 }] });
    const [a, b] = t.terms!.map((x) => (x.fPlus - x.fMinus) / 2);
    expect(t.sdFOS).toBeCloseTo(Math.sqrt(a * a + b * b - a * b), 9);
  });
});

describe("reliability: unit weight", () => {
  it("F ∝ 1/γ for φ = 0 (Taylor); γsat moves with γ", () => {
    const r = analyseReliability(clay, options, [{ material: 0, field: "unitWeight", sd: 2 }], { method: "taylor", search: false });
    expect(r.terms![0].fPlus).toBeCloseTo((r.fos * 18) / 20, 6);
    expect(r.terms![0].fMinus).toBeCloseTo((r.fos * 18) / 16, 6);
    // Sand with γsat below a water table: γ ± σ shifts γsat by the same amount.
    const wet: SlopeDefinition = {
      ...slope(mc(5, 30, 18, { unitWeightSat: 20 } as Partial<MaterialModel>)),
      waterTable: { mode: "height", value: 3 },
    };
    const sameSat: SlopeDefinition = { ...slope(mc(5, 30, 20)), waterTable: { mode: "height", value: 3 } };
    const shifted = analyseReliability(wet, options, [{ material: 0, field: "unitWeight", sd: 2 }], { method: "taylor", search: false });
    // γ + σ = 20 and γsat = 22; γ − σ = 16, γsat = 18.
    const plain = analyseReliability(sameSat, options, [{ material: 0, field: "unitWeight", sd: 0 }], { method: "taylor", search: false });
    expect(shifted.terms![0].fPlus).not.toBeCloseTo(plain.fos, 4);
    const mcWet = analyseReliability(wet, options, [{ material: 0, field: "unitWeight", sd: 0 }], { method: "monte-carlo", samples: 10 });
    expect(mcWet.meanFOS).toBeCloseTo(shifted.fos, 9);
  });

  it("a material without a model: the flat unit weight is the variable", () => {
    const flat: SlopeDefinition = {
      ...clay,
      materials: [{ name: "Top", unitWeight: 18, cohesion: 30, frictionAngle: 0 }],
    };
    const r = analyseReliability(flat, options, [{ material: 0, field: "unitWeight", sd: 2 }], { method: "taylor", search: false });
    expect(r.terms![0].mean).toBe(18);
    expect(r.terms![0].fPlus).toBeLessThan(r.fos);
  });
});

describe("reliabilitySurfaceToModelSpace", () => {
  it("leaves a left-to-right surface and mirrors a right-to-left one, polyline points too", () => {
    const s = { cx: 22, cy: 18, radius: 18.5, lc: [5, 10] as [number, number], rc: [30, 0] as [number, number], points: [[5, 10], [30, 0]] as [number, number][] };
    expect(reliabilitySurfaceToModelSpace(s, clay)).toBe(s);
    const rtl = { ...clay, orientation: "rtl" as const };
    const m = reliabilitySurfaceToModelSpace(s, rtl);
    expect(m.cx).toBe(18);
    expect(m.lc).toEqual([35, 10]);
    expect(m.points).toEqual([[35, 10], [10, 0]]);
    expect(reliabilitySurfaceToModelSpace({ ...s, points: undefined }, rtl).points).toBeUndefined();
  });

  it("a right-to-left model gives the FOS of its mirror image", () => {
    const mirrored: SlopeDefinition = {
      ...clay,
      orientation: "rtl",
      coordinates: clay.coordinates.map(([x, y]) => [40 - x, y] as [number, number]),
      customSearchPlanes: [{ cx: 18, cy: 18, radius: 18.5 }],
    };
    const a = analyseReliability(clay, options, [SU], { method: "taylor", search: false });
    const b = analyseReliability(toCanonicalSlopeDefinition(mirrored), options, [SU], { method: "taylor", search: false });
    expect(b.fos).toBeCloseTo(a.fos, 9);
    expect(b.sdFOS).toBeCloseTo(a.sdFOS, 9);
  });
});
