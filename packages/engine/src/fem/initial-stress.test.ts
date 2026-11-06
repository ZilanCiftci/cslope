/**
 * Initial stresses and staged construction in the finite element analysis.
 * The K0 procedure, the inactive materials of later stages and the stresses
 * carried from stage to stage (internal functions) are tested in Rust:
 * packages/engine-rs/crates/cslope-engine/tests/fem_model_unit.rs.
 */
import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { analyzeFem } from "./analysis";
import { PROBLEMS } from "../verification/problems";

const slopeOf = (def: unknown) => buildSlope(toCanonicalSlopeDefinition(def as SlopeDefinition));

describe("K0 procedure", () => {
  it("does not change the factor of safety of associated flow (V055), whatever the initial stresses", () => {
    const slope = slopeOf(PROBLEMS.find((p) => p.id === "V055")!.definition);
    const F = (o: object) => analyzeFem(slope, { flowRule: "associated", elementSize: 1.5, fTolerance: 0.005, ...o }).factorOfSafety;
    const gravity = F({});
    expect(F({ initialStress: "k0" })).toBeCloseTo(gravity, 6);
    expect(F({ initialStress: "k0", originalGroundLevel: 14 })).toBeCloseTo(gravity, 6);
  }, 600000);
});

describe("staged construction", () => {
  const embankment = (foundationCohesion: number) => ({
    coordinates: [[0, 0], [0, 10], [10, 10], [20, 5], [40, 5], [40, 0]],
    materials: [
      { name: "found", model: { kind: "mohr-coulomb", unitWeight: 19, cohesion: foundationCohesion, frictionAngle: 25 } },
      { name: "fill1", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30 } },
      { name: "fill2", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30 } },
    ],
    materialBoundaries: [{ coordinates: [[0, 5], [40, 5]], materialName: "found" }, { coordinates: [[0, 7.5], [40, 7.5]], materialName: "fill1" }],
    regionAssignments: [{ point: [20, 2.5], materialName: "found" }, { point: [5, 6], materialName: "fill1" }, { point: [5, 9], materialName: "fill2" }],
  });

  it("builds the embankment in layers: the same factor with associated flow", () => {
    const slope = slopeOf(embankment(15));
    const opts = { flowRule: "associated" as const, elementSize: 1.5, fTolerance: 0.005 };
    const once = analyzeFem(slope, opts);
    const staged = analyzeFem(slope, { ...opts, materialStages: { fill1: 1, fill2: 2 } });
    expect(staged.warnings).toEqual(once.warnings);
    expect(staged.factorOfSafety).toBeCloseTo(once.factorOfSafety, 6);
  }, 300000);
});
