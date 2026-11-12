import { describe, it, expect } from "vitest";
import { resolveStrength } from "./strength";
import { validateMaterialModel } from "./validation";
import type { MaterialModel } from "./material-models";
import { buildSlope } from "../model/build-slope";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import { analyseSlope } from "../model/solvers";
import { DEFAULT_ANALYSIS_OPTIONS } from "./analysis";
import type { SlopeDefinition } from "./slope-definition";

type Mat = { name: string; model: MaterialModel };
type Bound = { coordinates: number[][]; materialName: string };
type Assign = { point: number[]; materialName: string };

const FN: [number, number][] = [[-45, 0.82], [0, 1], [60, 1.5]];
const ctx = (alphaDeg: number, yBottom = -2) => ({ yBottom, x: 0, yGround: 0, alpha: (alphaDeg * Math.PI) / 180 });

describe("anisotropy on the undrained models", () => {
  it("multiplies Su by the factor at the base inclination", () => {
    const m: MaterialModel = { kind: "undrained", unitWeight: 17, undrainedShearStrength: 20, anisotropy: FN };
    expect(resolveStrength(m, ctx(0)).cohesion).toBeCloseTo(20, 10);
    expect(resolveStrength(m, ctx(60)).cohesion).toBeCloseTo(30, 10);
    expect(resolveStrength(m, ctx(80)).cohesion).toBeCloseTo(30, 10); // constant beyond the ends
    expect(resolveStrength(m, ctx(30)).cohesion).toBeCloseTo(25, 10); // linear between 0 and 60
    expect(resolveStrength(m, ctx(-45)).cohesion).toBeCloseTo(16.4, 10);
    const r = resolveStrength(m, ctx(-90));
    expect(r.cohesionUndrained).toBeCloseTo(16.4, 10);
    expect(r.frictionAngle).toBe(0);
  });

  it("applies to Su = f(datum) and f(depth) after their cutoff", () => {
    const datum: MaterialModel = { kind: "s-f-datum", unitWeight: 17, suRef: 10, yRef: 0, rate: 2, suMax: 13, anisotropy: FN };
    // Su = 10 + 2·2 = 14, cut to 13, times 1.5
    expect(resolveStrength(datum, ctx(60)).cohesion).toBeCloseTo(19.5, 10);
    const depth: MaterialModel = { kind: "s-f-depth", unitWeight: 17, suRef: 10, depthRef: 0, rate: 2, anisotropy: FN };
    expect(resolveStrength(depth, ctx(-45)).cohesion).toBeCloseTo(14 * 0.82, 10);
  });

  it("leaves the models isotropic without it", () => {
    const m: MaterialModel = { kind: "s-f-datum", unitWeight: 17, suRef: 10, yRef: 0, rate: 2 };
    expect(resolveStrength(m, ctx(60)).cohesion).toBeCloseTo(14, 10);
    expect(resolveStrength({ ...m, anisotropy: [] }, ctx(60)).cohesion).toBeCloseTo(14, 10);
    expect(validateMaterialModel({ ...m, anisotropy: [] })).toEqual([]);
    // a negative factor (unvalidated input) gives no negative strength
    expect(resolveStrength({ ...m, anisotropy: [[0, 1], [60, -1]] }, ctx(60)).cohesion).toBe(0);
  });

  it("validates the modifier function", () => {
    const base = { kind: "undrained", unitWeight: 17, undrainedShearStrength: 20 } as const;
    expect(validateMaterialModel({ ...base, anisotropy: FN })).toEqual([]);
    expect(validateMaterialModel({ ...base, anisotropy: [[0, 1]] }).join()).toMatch(/at least 2/);
    expect(validateMaterialModel({ ...base, anisotropy: [[0, 1], [45, -1]] }).join()).toMatch(/factor must be ≥ 0/);
    expect(validateMaterialModel({ ...base, anisotropy: [[0, 1], [NaN, 1]] }).join()).toMatch(/finite/);
  });
});

// A slope in clay with Su decreasing then increasing with depth: Su = f(datum)
// with anisotropy against the same strength in thin layers of the
// anisotropic-function model (constant c in each, the value at its middle).
const layered = (thin: boolean): SlopeDefinition => {
  const top = 0, bottom = -12, h = 0.2;
  const su = (y: number) => 18 + 1.5 * (-2 - y); // 18 kPa at y = -2, +1.5 kPa/m below
  const materials: Mat[] = [{ name: "clay", model: { kind: "s-f-datum", unitWeight: 17, suRef: 18, yRef: -2, rate: 1.5, anisotropy: FN } }];
  const bounds: Bound[] = [], assigns: Assign[] = [{ point: [-15, -11.95], materialName: "clay" }];
  if (thin) {
    materials.length = 0; assigns.length = 0;
    for (let y0 = bottom, k = 0; y0 < top - 1e-9; y0 += h, k++) {
      const name = `c${k}`; const ym = y0 + h / 2;
      materials.push({ name, model: { kind: "anisotropic-function", unitWeight: 17, cohesion: su(ym), frictionAngle: 0, modifierFunction: FN } });
      if (y0 > bottom + 1e-9) bounds.push({ coordinates: [[-20.05, y0], [20.05, y0]], materialName: "" });
      assigns.push({ point: [-19.9, ym], materialName: name });
    }
  }
  return {
    orientation: "ltr",
    coordinates: [[-20, bottom], [-20, top], [-6, top], [0, -6], [20, -6], [20, bottom]],
    materials, materialBoundaries: bounds, regionAssignments: assigns, udls: [],
  } as unknown as SlopeDefinition;
};

describe("anisotropy on Su = f(datum) in a slope", () => {
  it("gives the factor of the same strength in thin layers of the anisotropic model", () => {
    const run = (thin: boolean) => {
      const s = buildSlope(toCanonicalSlopeDefinition(layered(thin)));
      s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 40, iterations: 2000, refinedIterations: 1000 });
      return analyseSlope(s) as number;
    };
    // At 2 000 iterations: with fewer the search itself can miss the
    // minimum of one of the two by more than the tolerance (with 300 by
    // up to 0.95 % before #160 and 1.2 % after it; with 1 000 by 1.6 %
    // since #158, whose points along the ground no longer fall on the toe,
    // where the critical circle exits).
    const fNew = run(false), fThin = run(true);
    expect(Math.abs(fNew / fThin - 1)).toBeLessThan(0.01);
    // and differs from the isotropic slope (active zone stronger, passive weaker)
    const iso = layered(false); ((iso.materials as unknown as Mat[])[0].model as { anisotropy?: unknown }).anisotropy = undefined;
    const s = buildSlope(toCanonicalSlopeDefinition(iso));
    s.updateAnalysisOptions({ ...DEFAULT_ANALYSIS_OPTIONS, method: "Morgenstern-Price", slices: 40, iterations: 2000, refinedIterations: 1000 });
    expect(Math.abs((analyseSlope(s) as number) / fNew - 1)).toBeGreaterThan(0.02);
  }, 300000);
});
