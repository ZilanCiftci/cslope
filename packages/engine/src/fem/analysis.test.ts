import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { analyzeFem } from "./analysis";
import { buildFeModel } from "./model";
import { dorflerMark, refinedSizeField, zzIndicator } from "./adapt";
import { solveElastic } from "./model";

const cut = (extra: Partial<SlopeDefinition> = {}): SlopeDefinition => ({
  coordinates: [[0, 0], [0, 10], [10, 10], [15, 5], [30, 5], [30, 0]],
  materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 20 } }],
  ...extra,
}) as SlopeDefinition;

describe("analyzeFem", () => {
  it("returns the factor of safety with the mesh and the fields", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(cut()));
    const r = analyzeFem(slope, { elementSize: 1.25, fTolerance: 0.02 });
    expect(r.factorOfSafety).toBeGreaterThan(0.8);
    expect(r.factorOfSafety).toBeLessThan(2);
    const nc = r.mesh.x.length;
    expect(r.displacement.length).toBe(2 * nc);
    expect(r.plasticShearStrain.length).toBe(r.mesh.triangles.length / 3);
    expect(r.shearStrainIncrement.length).toBe(r.mesh.triangles.length / 3);
    expect(Math.max(...r.shearStrainIncrement)).toBeGreaterThan(0);
    expect(r.levels).toHaveLength(1);
    // the mechanism is plastic somewhere
    expect(Math.max(...r.plasticShearStrain)).toBeGreaterThan(0);
  }, 60000);

  it("warns about non-associated flow at high friction angles", () => {
    const def = cut({ materials: [{ name: "Sand", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 5, frictionAngle: 40 } }] } as Partial<SlopeDefinition>);
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    const r = analyzeFem(slope, { elementSize: 2.5, flowRule: "non-associated", fTolerance: 0.05 });
    expect(r.warnings.some((w) => w.includes("Davis B"))).toBe(true);
  }, 60000);
});

describe("adaptive refinement", () => {
  it("halves the size of marked elements only", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(cut()));
    const model = buildFeModel(slope, { elementSize: 2 });
    const { stress } = solveElastic(model);
    const eta = zzIndicator(model, stress);
    const marked = dorflerMark(eta, 0.5);
    let sum = 0, markedSum = 0, count = 0;
    for (let e = 0; e < eta.length; e++) { sum += eta[e]; if (marked[e]) { markedSum += eta[e]; count++; } }
    expect(markedSum).toBeGreaterThanOrEqual(0.5 * sum);
    expect(count).toBeLessThan(eta.length);
    const field = refinedSizeField(model, marked);
    const finer = buildFeModel(slope, { sizeField: field });
    expect(finer.elementCount).toBeGreaterThan(model.elementCount);
  });
});
