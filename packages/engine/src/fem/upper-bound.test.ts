import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { upperBound } from "./upper-bound";
import { lowerBound } from "./lower-bound";
import { buildFeModel } from "./model";
import { strengthReduction } from "./srm";

describe("upperBound", () => {
  it("bounds Prandtl's bearing capacity from above", async () => {
    // Weightless Tresca soil, c = 20 kPa, strip load c(2 + π) over 10 m: F = 1 exactly.
    const def = {
      coordinates: [[-20, 0], [-20, 10], [20, 10], [20, 0]],
      materials: [{ name: "soil", model: { kind: "undrained", unitWeight: 1e-6, undrainedShearStrength: 20 } }],
      udls: [{ magnitude: 20 * (2 + Math.PI), x1: -5, x2: 5 }],
    } as unknown as SlopeDefinition;
    const r = await upperBound(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 1.5 });
    expect(r.factorOfSafety).toBeGreaterThan(1);
    expect(r.factorOfSafety).toBeLessThan(1.06);
    expect(r.trials).toHaveLength(1); // φ = 0: one linear program
    expect(r.mechanism!.velocity.some((v) => v !== 0)).toBe(true);
  }, 120000);

  it("bounds the frictional bearing capacity (Prandtl–Reissner N_c) from above", async () => {
    const phi = (20 * Math.PI) / 180;
    const Nq = Math.exp(Math.PI * Math.tan(phi)) * Math.tan(Math.PI / 4 + phi / 2) ** 2, Nc = (Nq - 1) / Math.tan(phi);
    const def = {
      coordinates: [[-30, 0], [-30, 15], [30, 15], [30, 0]],
      materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 1e-6, cohesion: 10, frictionAngle: 20 } }],
      udls: [{ magnitude: 10 * Nc, x1: -5, x2: 5 }],
    } as unknown as SlopeDefinition;
    const r = await upperBound(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 2, fTolerance: 0.005 });
    expect(r.factorOfSafety).toBeGreaterThan(1);
    expect(r.factorOfSafety).toBeLessThan(1.08);
    // the reported factor was evaluated and fails the slope: λ(F) ≤ 1, near 1
    const at = r.trials.find((t) => t.F === r.factorOfSafety)!;
    expect(at.lambda).toBeLessThanOrEqual(1);
    expect(at.lambda).toBeGreaterThan(0.95);
  }, 180000);

  it("brackets the strength reduction factor of a frictional slope with the lower bound", async () => {
    const def = {
      coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
      materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 15, frictionAngle: 10 } }],
    } as unknown as SlopeDefinition;
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const fe = strengthReduction(buildFeModel(slope, { elementSize: 1.25 }), { flowRule: "associated", fTolerance: 0.005 });
    const ub = await upperBound(slope, { elementSize: 1.25, fTolerance: 0.005, startF: fe.factorOfSafety });
    const lb = await lowerBound(slope, { elementSize: 1.25, fTolerance: 0.005 });
    expect(ub.factorOfSafety).toBeGreaterThanOrEqual(fe.factorOfSafety - 0.01);
    expect(lb.factorOfSafety).toBeLessThanOrEqual(fe.factorOfSafety + 0.01);
    expect(ub.factorOfSafety - lb.factorOfSafety).toBeLessThan(0.25 * fe.factorOfSafety);
    expect(ub.trials.length).toBeLessThanOrEqual(4); // started at the strength reduction factor
  }, 300000);

  it("gives a slip band between two soils the strength of one of them, not a mix", async () => {
    // Clay (c = 30 kPa, φ = 0) over cohesionless sand (φ = 45°): a mix of
    // the lesser c and the lesser φ would make the interface frictionless
    // and cohesionless (F 0.57 here); one material's strength gives 0.89.
    const def = {
      coordinates: [[0, 0], [0, 15], [15, 15], [25, 5], [40, 5], [40, 0]],
      materials: [
        { name: "clay", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 30, frictionAngle: 0 } },
        { name: "sand", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 0, frictionAngle: 45 } },
      ],
      materialBoundaries: [{ coordinates: [[0, 3], [40, 3]], materialName: "sand" }],
    } as unknown as SlopeDefinition;
    const r = await upperBound(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 1, fTolerance: 0.005 });
    expect(r.factorOfSafety).toBeGreaterThan(0.85);
  }, 300000);

  it("lowers the bound with a water table (pore pressure power)", async () => {
    const def = (water: boolean) =>
      ({
        coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [30, 5], [30, 0]],
        materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 15, frictionAngle: 20 } }],
        ...(water ? { waterTable: { mode: "custom", value: [[0, 9], [20, 5], [30, 5]], followBoundary: false } } : {}),
        reinforcements: [],
      }) as unknown as SlopeDefinition;
    const dry = await upperBound(buildSlope(toCanonicalSlopeDefinition(def(false))), { elementSize: 2, fTolerance: 0.01 });
    const wet = await upperBound(buildSlope(toCanonicalSlopeDefinition(def(true))), { elementSize: 2, fTolerance: 0.01 });
    expect(wet.factorOfSafety).toBeLessThan(dry.factorOfSafety - 0.05);
  }, 300000);
});
