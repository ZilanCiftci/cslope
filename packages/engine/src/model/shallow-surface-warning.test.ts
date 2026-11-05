import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { analysisWarnings, shallowCohesionlessMessage } from "./result-warnings";
import { DEFAULT_ANALYSIS_OPTIONS } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";

// A road bank of cohesionless fill (45° edges) on clay beside a 1:2 cut: the
// search finds a thin slide in the bank's edge before the cut's slip surface.
const bankBesideCut: SlopeDefinition = {
  orientation: "ltr",
  coordinates: [[0, -10], [0, 0], [2, 0], [2.4, 0.4], [6.6, 0.4], [7, 0], [8, 0], [12, -2], [20, -2], [20, -10]],
  materials: [
    { name: "fill", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 32 } },
    { name: "clay", model: { kind: "undrained", unitWeight: 17, undrainedShearStrength: 18 } },
  ],
  materialBoundaries: [{ coordinates: [[1.95, 0], [7.05, 0]], materialName: "" }],
  regionAssignments: [{ point: [4, 0.2], materialName: "fill" }, { point: [10, -6], materialName: "clay" }],
  udls: [{ magnitude: 15, x1: 2.4, x2: 6.6 }],
} as unknown as SlopeDefinition;

const run = (minFailureDist: number) => {
  const s = buildSlope(toCanonicalSlopeDefinition(bankBesideCut));
  s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 30, iterations: 600, refinedIterations: 300, minFailureDist, minSlipArea: 0 });
  const F = analyseSlope(s) as number;
  return { s, F, warnings: analysisWarnings(s) };
};

describe("shallow cohesionless critical surface", () => {
  it("is named when the search finds a thin slide in a cohesionless bank's edge, and not once a minimum entry–exit distance skips it", () => {
    const thin = run(0);
    const w = thin.warnings.find((x) => x.code === "shallow-cohesionless-surface");
    expect(w?.message).toMatch(/shallow slide.*cohesionless soil \(fill\)/);
    const deep = run(2);
    expect(deep.F).toBeGreaterThan(thin.F);
    expect(deep.warnings.some((x) => x.code === "shallow-cohesionless-surface")).toBe(false);
  }, 120000);

  it("needs both a shallow surface and most of its base in cohesionless soil", () => {
    const slice = (h: number, c: number, phi: number, cu = 0) => ({ yTop: h, yBottom: 0, baseLength: 1, cohesion: c, cohesionUndrained: cu, frictionAngle: phi, baseMaterial: null }) as never;
    expect(shallowCohesionlessMessage([slice(0.5, 0, 30), slice(0.6, 0, 30)], 0.7, 3)).toMatch(/on average 0.55 m and at most 0.60 m/);
    expect(shallowCohesionlessMessage([slice(1.5, 0, 30)], 0.7, 3)).toBeNull(); // deeper than 1 m
    expect(shallowCohesionlessMessage([slice(1.5, 0, 30)], 0.7, 20)).toMatch(/shallow/); // a tenth of a 20 m relief: 2 m
    // a long thin surface with one deeper slice: by its mean depth
    expect(shallowCohesionlessMessage([...Array(9).fill(slice(0.3, 0, 30)), slice(1.2, 0, 30)], 0.7, 3)).toMatch(/at most 1.20 m/);
    expect(shallowCohesionlessMessage([slice(0.5, 10, 0), slice(0.5, 0, 30)], 0.7, 3)).toMatch(/50 %/);
    expect(shallowCohesionlessMessage([slice(0.5, 10, 0), slice(0.5, 10, 0), slice(0.5, 0, 30)], 0.7, 3)).toBeNull();
    // combined clay (c′ = 0 with an undrained strength) is not cohesionless
    expect(shallowCohesionlessMessage([slice(0.5, 0, 30, 15), slice(0.5, 0, 30, 15)], 0.7, 3)).toBeNull();
  });
});
