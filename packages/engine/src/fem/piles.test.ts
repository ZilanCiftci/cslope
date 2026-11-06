/**
 * Pile rows in the finite element analysis. The pile beams, the springs
 * and the model built with piles (internal functions) are tested in Rust:
 * packages/engine-rs/crates/cslope-engine/tests/fem_model_unit.rs.
 */
import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { analyzeFem } from "./analysis";

describe("pile rows in the strength reduction", () => {
  const def = (piles: object[]) =>
    ({
      coordinates: [[0, 0], [0, 15], [15, 15], [30, 5], [50, 5], [50, 0]],
      materials: [{ name: "soil", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: 8, frictionAngle: 25 } }],
      piles,
    }) as unknown as SlopeDefinition;
  const row = (extra: object = {}) => ({ x1: 22, y1: 15 - (7 * 10) / 15, x2: 22, y2: 0.5, diameter: 0.6, spacing: 2, application: "passive", ...extra });
  const run = (piles: object[], solver: "newton" | "viscoplastic") =>
    analyzeFem(buildSlope(toCanonicalSlopeDefinition(def(piles))), { flowRule: "associated", solver, elementSize: 1.25, fTolerance: 0.01 });

  it("raise the factor of safety, with both solvers alike, and report their forces", () => {
    const plain = run([], "newton").factorOfSafety;
    const newton = run([row()], "newton"), vp = run([row()], "viscoplastic");
    expect(newton.factorOfSafety).toBeGreaterThan(plain + 0.1);
    expect(Math.abs(newton.factorOfSafety - vp.factorOfSafety)).toBeLessThan(0.03);
    expect(newton.piles).toHaveLength(1);
    expect(newton.piles[0].maxMoment).toBeGreaterThan(0);
    expect(newton.piles[0].maxShearForce).toBeGreaterThan(0);
  }, 300000);

  it("warn where the forces exceed the pile's capacity", () => {
    const r = run([row({ momentCapacity: 10 })], "newton");
    expect(r.warnings.some((w) => /Pile 1: the bending moment/.test(w))).toBe(true);
  }, 300000);
});
