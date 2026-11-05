/**
 * Combined S = f(depth): the drained c′ + σ′·tan φ′ (c′ varying with the
 * same depth as Su) limited by the undrained Su, the depth measured from
 * the ground or the top of the layer.
 */

import { describe, it, expect } from "vitest";
import type { MaterialModel } from "../types/material-models";
import type { SlopeDefinition } from "../types/slope-definition";
import { designStrength, resolveStrength } from "../types/strength";
import { validateMaterialModel } from "../types/validation";
import { layered, mc, runVerification } from "../verification/cases";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { sgi3dFactorOfSafety } from "./sgi3d";
import { DEFAULT_ANALYSIS_OPTIONS } from "../types/analysis";

type Pt = [number, number];

// A fill (φ 32°) on clay whose top is at y = 0, under a 6 m embankment.
const ground: Pt[] = [[0, 1], [20, 1], [32, 7], [60, 7]];
const FILL = mc(0, 32, 19);
const sfDepth = (extra: Partial<MaterialModel> = {}): MaterialModel =>
  ({ kind: "s-f-depth", unitWeight: 16, suRef: 10, depthRef: 0, rate: 1.5, depthReference: "layer-top", ...extra }) as MaterialModel;
const embankment = (clay: MaterialModel, extra: Partial<SlopeDefinition> = {}) =>
  layered(ground, -15, [
    { name: "Fill", topY: null, model: FILL },
    { name: "Clay", topY: 0, model: clay },
  ], { waterTable: { mode: "custom", value: [[0, 0.5], [60, 0.5]] }, ...extra });
const SEARCH = { slices: 30, iterations: 400, refinedIterations: 200, tolerance: 0.005 };
const fos = (def: SlopeDefinition) => runVerification(def, "Morgenstern-Price", SEARCH).fos!;

describe("resolveStrength, combined S = f(depth)", () => {
  const model = sfDepth({ drainedCohesion: 1, drainedCohesionRate: 0.15, drainedFrictionAngle: 30 });
  const ctx = { yBottom: -4, x: 10, yGround: 1, yLayerTop: 0, alpha: 0 };

  it("gives c′ and Su at the same depth below the layer top, and marks the material combined", () => {
    const st = resolveStrength(model, ctx);
    expect(st.cohesion).toBeCloseTo(1 + 4 * 0.15, 12);
    expect(st.frictionAngle).toBe(30);
    expect(st.cohesionUndrained).toBeCloseTo(10 + 4 * 1.5, 12);
    expect(st.isCombined).toBe(true);
  });

  it("is undrained only without the drained parameters", () => {
    const st = resolveStrength(sfDepth(), ctx);
    expect(st).toEqual({ cohesion: 16, frictionAngle: 0, cohesionUndrained: 16 });
  });

  it("applies the anisotropy to Su only", () => {
    const st = resolveStrength({ ...model, anisotropy: [[-90, 0.8], [90, 0.8]] } as MaterialModel, ctx);
    expect(st.cohesion).toBeCloseTo(1.6, 12);
    expect(st.cohesionUndrained).toBeCloseTo(16 * 0.8, 12);
  });

  it("takes the drained partial factors on c′ and tan φ′ and γcu on Su", () => {
    const st = resolveStrength(model, ctx);
    const d = designStrength("s-f-depth", st, { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1, permanentLoad: 1 } as never);
    expect(d.undrained).toBe(false);
    expect(d.cohesion).toBeCloseTo(1.6 / 1.3, 12);
    expect(d.tanPhi).toBeCloseTo(Math.tan(Math.PI / 6) / 1.3, 12);
    expect(d.cohesionUndrained).toBeCloseTo(16 / 1.5, 12);
  });

  it("validates the drained parameters", () => {
    expect(validateMaterialModel(model)).toEqual([]);
    expect(validateMaterialModel(sfDepth({ drainedCohesion: 1 })).join()).toMatch(/both the drained/);
    expect(validateMaterialModel(sfDepth({ drainedCohesion: -1, drainedFrictionAngle: 30 })).join()).toMatch(/c′/);
    expect(validateMaterialModel(sfDepth({ drainedCohesion: 1, drainedFrictionAngle: 90 })).join()).toMatch(/φ′/);
    expect(validateMaterialModel(sfDepth({ drainedCohesion: 1, drainedCohesionRate: NaN, drainedFrictionAngle: 30 })).join()).toMatch(/c′/);
  });
});

describe("combined S = f(depth) in the analysis", () => {
  const undrained = fos(embankment(sfDepth()));
  // a weak drained branch (φ′ 10°) governs near the ground surface
  const combined = fos(embankment(sfDepth({ drainedCohesion: 0.5, drainedCohesionRate: 0.05, drainedFrictionAngle: 10 })));

  it("equals the undrained analysis when the drained branch is the stronger", () => {
    const strong = fos(embankment(sfDepth({ drainedCohesion: 1000, drainedFrictionAngle: 30 })));
    expect(strong).toBeCloseTo(undrained, 6);
  });

  it("is lower than the undrained analysis where the drained branch governs", () => {
    expect(Number.isFinite(combined)).toBe(true);
    expect(combined).toBeLessThan(undrained);
  });

  it("equals a combined Mohr-Coulomb with c′ increasing below the (level) layer top", () => {
    // With the clay top level at y = 0, the depth below the layer top is −y:
    // Mohr-Coulomb c′ = 1 + 0.15·(0 − y), Su huge, against the drained branch alone.
    const drainedOnly = fos(embankment(sfDepth({ suRef: 1e6, rate: 0, drainedCohesion: 1, drainedCohesionRate: 0.15, drainedFrictionAngle: 30 })));
    const mcClay = { kind: "mohr-coulomb", unitWeight: 16, cohesion: 1, frictionAngle: 30, cohesionRefDepth: 0, cohesionRateOfChange: 0.15 } as MaterialModel;
    expect(drainedOnly).toBeCloseTo(fos(embankment(mcClay)), 6);
  });
});

describe("SGI 3D with combined clay", () => {
  // the end faces take the undrained strength of combined clay
  const cut = (clay: MaterialModel): SlopeDefinition =>
    ({
      orientation: "ltr",
      coordinates: [[0, -12], [0, 0], [6, 0], [14, -4], [20, -4], [20, -12]],
      materials: [{ name: "clay", model: clay }],
      regionAssignments: [{ point: [10, -8], materialName: "clay" }],
    }) as unknown as SlopeDefinition;
  const run = (clay: MaterialModel) => {
    const s = buildSlope(toCanonicalSlopeDefinition(cut(clay)));
    s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 30, iterations: 200, refinedIterations: 100 });
    const F2D = analyseSlope(s) as number;
    return { F2D, F3D: sgi3dFactorOfSafety(s, { length: 10 })!.factorOfSafety };
  };

  it("gives the same F3D as the undrained clay when the drained branch never governs", () => {
    const su = { kind: "s-f-depth", unitWeight: 18, suRef: 15, depthRef: 0, rate: 1, depthReference: "ground" } as MaterialModel;
    const a = run(su), b = run({ ...su, drainedCohesion: 1000, drainedFrictionAngle: 30 } as MaterialModel);
    expect(b.F2D).toBeCloseTo(a.F2D, 6);
    expect(b.F3D).toBeCloseTo(a.F3D, 6);
    expect(a.F3D).toBeGreaterThan(a.F2D);
  });
});
