import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { analyzeFem } from "./analysis";
import { buildFeModel, ignoredInputWarnings } from "./model";
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

describe("inputs the finite element analyses do not take", () => {
  it("warns that rᵤ is not included, naming the material", () => {
    const def = cut({ materials: [{ name: "Clay", model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 25, ru: 0.3 } }] } as Partial<SlopeDefinition>);
    const r = analyzeFem(buildSlope(toCanonicalSlopeDefinition(def)), { elementSize: 2.5, fTolerance: 0.05 });
    expect(r.warnings.some((w) => w.includes("rᵤ") && w.includes("Clay"))).toBe(true);
    // a model without them gets none of these warnings
    expect(ignoredInputWarnings(buildSlope(toCanonicalSlopeDefinition(cut())))).toEqual([]);
  }, 60000);

  it("names each ignored input", () => {
    const clay = { kind: "shansep", unitWeight: 18, ratio: 0.25, bBar: 0.5, aboveWater: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30 } };
    const water = { mode: "custom", value: [[0, 6], [30, 6]], followBoundary: false };
    const def = cut({
      materials: [{ name: "Clay", model: clay }],
      waterTable: water,
      waternet: { headLines: [{ id: "h", points: [[0, 6], [30, 6]] }], referenceLines: [{ points: [[0, -5], [30, -5]], topHeadLineId: "h", bottomHeadLineId: "h" }] },
      udls: [{ magnitude: 10, x1: 1, x2: 5, excessPorePressure: [{ material: "Clay", ratio: 0.5 }] }],
      earlierStage: cut({ materials: [{ name: "Clay", model: clay }] } as Partial<SlopeDefinition>),
      rapidDrawdown: { waterBefore: [[0, 8], [30, 8]] },
    } as Partial<SlopeDefinition>);
    const w = ignoredInputWarnings(buildSlope(toCanonicalSlopeDefinition(def)));
    for (const what of ["waternet", "B̄", "above the water table", "distributed loads", "earlier stage", "Rapid drawdown"]) {
      expect(w.some((x) => x.includes(what))).toBe(true);
    }
  });
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
