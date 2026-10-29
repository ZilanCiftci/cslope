import { describe, it, expect } from "vitest";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildFeModel, solveElastic, withInitialStress } from "./model";
import { k0Stress, prepareFeModel } from "./initial-stress";
import { analyzeFem } from "./analysis";
import { PROBLEMS } from "../verification/problems";

const slopeOf = (def: unknown) => buildSlope(toCanonicalSlopeDefinition(def as SlopeDefinition));
const norm = (a: Float64Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0));

describe("K0 procedure", () => {
  const layer = slopeOf({
    coordinates: [[0, 0], [0, 10], [40, 10], [40, 0]],
    materials: [{ name: "s", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30 } }],
  });

  it("gives the elastic gravity stresses of level ground for K0 = ν/(1 − ν), in equilibrium", () => {
    const model = buildFeModel(layer, { elementSize: 2 });
    const elastic = solveElastic(model).stress;
    const k0 = k0Stress(model, layer, { k0: 0.3 / 0.7 });
    let diff = 0, max = 0;
    for (let i = 0; i < k0.length; i++) { diff = Math.max(diff, Math.abs(k0[i] - elastic[i])); max = Math.max(max, Math.abs(elastic[i])); }
    expect(diff).toBeLessThan(1e-9 * max);
    // the out-of-balance force of a field in equilibrium vanishes
    expect(norm(withInitialStress(model, k0).f)).toBeLessThan(1e-9 * model.loadNorm);
  });

  it("takes K0 = 1 − sin φ′ by default and counts the overburden from an original ground level", () => {
    const model = buildFeModel(layer, { elementSize: 2 });
    const k0 = k0Stress(model, layer);
    const deep = k0Stress(model, layer, { originalGroundLevel: 15 });
    const i = model.gpY.findIndex((y) => y < 2);
    expect(k0[4 * i] / k0[4 * i + 1]).toBeCloseTo(1 - Math.sin(Math.PI / 6), 12);
    expect(k0[4 * i + 1]).toBeCloseTo(-20 * (10 - model.gpY[i]), 9);
    expect(deep[4 * i + 1]).toBeCloseTo(-20 * (15 - model.gpY[i]), 9);
  });

  it("does not change the factor of safety of associated flow (V055), whatever the initial stresses", () => {
    const slope = slopeOf(PROBLEMS.find((p) => p.id === "V055")!.definition);
    const F = (o: object) => analyzeFem(slope, { flowRule: "associated", elementSize: 1.5, fTolerance: 0.005, ...o }).factorOfSafety;
    const gravity = F({});
    expect(F({ initialStress: "k0" })).toBeCloseTo(gravity, 6);
    expect(F({ initialStress: "k0", originalGroundLevel: 14 })).toBeCloseTo(gravity, 6);
  }, 300000);
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

  it("leaves materials of later stages weightless", () => {
    const slope = slopeOf(embankment(15));
    const full = buildFeModel(slope, { elementSize: 1.5 });
    const first = buildFeModel(slope, { elementSize: 1.5, inactiveMaterials: ["fill1", "fill2"] });
    expect(first.elementCount).toBe(full.elementCount);
    expect(first.elInactive.some((v) => v === 1)).toBe(true);
    expect(first.loadNorm).toBeLessThan(full.loadNorm);
  });

  it("builds the embankment in layers: the same factor with associated flow, stresses carried over", () => {
    const slope = slopeOf(embankment(15));
    const opts = { flowRule: "associated" as const, elementSize: 1.5, fTolerance: 0.005 };
    const once = analyzeFem(slope, opts);
    const staged = analyzeFem(slope, { ...opts, materialStages: { fill1: 1, fill2: 2 } });
    expect(staged.warnings).toEqual(once.warnings);
    expect(staged.factorOfSafety).toBeCloseTo(once.factorOfSafety, 6);
    // the full model starts from the stresses of the first two stages: the foundation is loaded, the top layer not
    const { model } = prepareFeModel(slope, { elementSize: 1.5, materialStages: { fill1: 1, fill2: 2 } }, { flowRule: "associated" });
    const top = model.materials.findIndex((m) => m.name === "fill2"), base = model.materials.findIndex((m) => m.name === "found");
    let topMax = 0, baseMin = 0;
    for (let e = 0; e < model.elementCount; e++) {
      for (let g = 0; g < 3; g++) {
        const sy = model.stress0![4 * (3 * e + g) + 1];
        if (model.elMaterial[e] === top) topMax = Math.max(topMax, Math.abs(sy));
        if (model.elMaterial[e] === base) baseMin = Math.min(baseMin, sy);
      }
    }
    expect(topMax).toBe(0);
    expect(baseMin).toBeLessThan(-100);
  }, 300000);

  it("warns when a stage fails while it is built", () => {
    // a foundation too weak for the first fill layer
    const slope = slopeOf({ ...embankment(15), materials: embankment(15).materials.map((m) => (m.name === "found" ? { ...m, model: { kind: "undrained", unitWeight: 19, undrainedShearStrength: 5 } } : m)) });
    const r = prepareFeModel(slope, { elementSize: 1.5, materialStages: { fill1: 1, fill2: 2 } }, { flowRule: "associated" });
    expect(r.warnings.some((w) => /Construction stage 2 of 3 did not reach equilibrium/.test(w))).toBe(true);
    // the failed stage's last state is carried on (Newton keeps none; the viscoplastic iteration does)
    expect(Math.max(...Array.from(r.model.stress0!, Math.abs))).toBeGreaterThan(50);
  }, 300000);
});
