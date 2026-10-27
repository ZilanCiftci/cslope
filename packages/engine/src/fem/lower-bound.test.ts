import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { lowerBound } from "./lower-bound";

describe("lowerBound", () => {
  it("bounds Prandtl's bearing capacity from below", async () => {
    // Weightless Tresca soil, c = 20 kPa, strip load c(2 + π) over 10 m: F = 1 exactly.
    const def = {
      coordinates: [[-20, 0], [-20, 10], [20, 10], [20, 0]],
      materials: [{ name: "soil", model: { kind: "undrained", unitWeight: 1e-6, undrainedShearStrength: 20 } }],
      udls: [{ magnitude: 20 * (2 + Math.PI), x1: -5, x2: 5 }],
    } as unknown as SlopeDefinition;
    const r = await lowerBound(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 1.5 });
    expect(r.factorOfSafety).toBeLessThan(1);
    expect(r.factorOfSafety).toBeGreaterThan(0.8);
    expect(r.trials).toHaveLength(1); // φ = 0: one linear program
  }, 120000);

  it("bounds a frictional slope from below its strength reduction factor", async () => {
    const def = {
      coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
      materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 25 } }],
    } as unknown as SlopeDefinition;
    const r = await lowerBound(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 2.5, fTolerance: 0.01 });
    expect(r.factorOfSafety).toBeGreaterThan(0.8);
    expect(r.factorOfSafety).toBeLessThan(2.5);
    // λ(F) = 1 at the reported factor
    const last = r.trials[r.trials.length - 1];
    expect(Math.abs(last.lambda - 1)).toBeLessThan(0.05);
  }, 180000);
});
