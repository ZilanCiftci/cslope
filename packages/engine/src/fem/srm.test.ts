import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildFeModel } from "./model";
import { davisB, strengthReduction } from "./srm";
import { PROBLEMS } from "../verification/problems";

const deg = Math.PI / 180;

describe("davisB", () => {
  it("reproduces the Davis B factors of Sysala et al. (2021, table 1)", () => {
    // Single material: FS_B solves q_B(FS_B) = FS_associated = 1.52 (φ' = 45°).
    const solve = (psi: number) => {
      let a = 1, b = 1.52;
      for (let k = 0; k < 60; k++) {
        const m = (a + b) / 2;
        if (davisB(m, 45 * deg, psi * deg) < 1.52) a = m; else b = m;
      }
      return (a + b) / 2;
    };
    expect(solve(15)).toBeCloseTo(1.356, 2);
    expect(solve(0)).toBeCloseTo(1.145, 2);
  });

  it("is F for associated flow and F / cos φ_F for ψ = 0", () => {
    expect(davisB(1.3, 30 * deg, 30 * deg)).toBeCloseTo(1.3, 12);
    const phiF = Math.atan(Math.tan(30 * deg) / 1.3);
    expect(davisB(1.3, 30 * deg, 0)).toBeCloseTo(1.3 / Math.cos(phiF), 12);
  });
});

describe("strengthReduction", () => {
  it("finds Griffiths & Lane's homogeneous slope near 1.4 on a coarse mesh", () => {
    // Griffiths & Lane (1999), example 1: 2:1 slope, H = 10 m, c' = 10 kPa,
    // φ' = 20°, γ = 20 kN/m³, ψ = 0; F = 1.4 by SRFEM, 1.38 by Bishop.
    const def = PROBLEMS.find((p) => p.id === "V055")!.definition as SlopeDefinition;
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const model = buildFeModel(slope, { elementSize: 1.25 });
    const r = strengthReduction(model, { flowRule: "non-associated", fTolerance: 0.02 });
    expect(r.factorOfSafety).toBeGreaterThan(1.3);
    expect(r.factorOfSafety).toBeLessThan(1.5);
    expect(r.failedF - r.factorOfSafety).toBeLessThanOrEqual(0.02);
  }, 120000);

  it("gives the same factor with Newton and the viscoplastic iteration for associated flow", () => {
    const def = PROBLEMS.find((p) => p.id === "V055")!.definition as SlopeDefinition;
    const model = buildFeModel(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 1.5 });
    const newton = strengthReduction(model, { flowRule: "associated", fTolerance: 0.01 });
    const vp = strengthReduction(model, { flowRule: "associated", solver: "viscoplastic", fTolerance: 0.01 });
    expect(Math.abs(newton.factorOfSafety - vp.factorOfSafety)).toBeLessThan(0.02);
    expect(newton.iterations).toBeLessThan(vp.iterations);
  }, 180000);

  it("gives the same factor with Newton and BFGS (constant stiffness) for associated flow", () => {
    const def = PROBLEMS.find((p) => p.id === "V055")!.definition as SlopeDefinition;
    const model = buildFeModel(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 2 });
    const newton = strengthReduction(model, { flowRule: "associated", fTolerance: 0.01 });
    const bfgs = strengthReduction(model, { flowRule: "associated", solver: "bfgs", fTolerance: 0.01 });
    expect(bfgs.trials.every((t) => t.solver === "bfgs")).toBe(true);
    expect(Math.abs(newton.factorOfSafety - bfgs.factorOfSafety)).toBeLessThan(0.02);
  }, 300000);
});

describe("strengthReduction with reinforcement", () => {
  const def = (reinforced: boolean) =>
    ({
      coordinates: [[0, 0], [0, 10], [10, 10], [15, 4], [30, 4], [30, 0]],
      materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 25 } }],
      reinforcements: reinforced
        ? [5, 6.5, 8].map((y) => ({ x1: 15 - ((y - 4) * 5) / 6, y1: y, x2: 2, y2: y, tensileCapacity: 60, application: "passive" }))
        : [],
    }) as unknown as SlopeDefinition;
  it("raises the factor of safety, with Newton and with the viscoplastic iteration", () => {
    for (const solver of ["newton", "viscoplastic"] as const) {
      const plain = strengthReduction(buildFeModel(buildSlope(toCanonicalSlopeDefinition(def(false))), { elementSize: 1.5 }), { solver, fTolerance: 0.02 });
      const reinf = strengthReduction(buildFeModel(buildSlope(toCanonicalSlopeDefinition(def(true))), { elementSize: 1.5 }), { solver, fTolerance: 0.02 });
      expect(reinf.factorOfSafety).toBeGreaterThan(plain.factorOfSafety + 0.01);
    }
  }, 240000);
});
