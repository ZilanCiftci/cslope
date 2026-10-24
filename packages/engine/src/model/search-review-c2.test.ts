/**
 * Search and optimisation (review C2): loads and the entry grid, surfaces
 * leaving the model at a re-entrant corner of its base, the non-circular
 * optimisation running to its minimum, and the engine's default search.
 */
import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";
import { setEntryExitPlanes } from "./search";
import { getSlices } from "./slices";
import { VERIFICATION_CASES } from "../verification/cases";

const caseDef = (id: string) => VERIFICATION_CASES.find((c) => c.id === id)!.definition;

describe("loads and the entry grid", () => {
  // V001 (Arai & Tagyo 1985, example 1) with 12 negligible strip loads
  // behind the search limits (x = 0–66): they add no surfaces and must not
  // take any away.
  const v001 = caseDef("V001");
  const loaded = {
    ...v001,
    udls: Array.from({ length: 12 }, (_, i) => ({ magnitude: 1e-6, x1: -29 + i, x2: -28.5 + i })),
  } as SlopeDefinition;

  const planes = (def: SlopeDefinition) => {
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    slope.updateAnalysisOptions({ iterations: 1000 });
    setEntryExitPlanes(slope);
    return slope.search.length;
  };

  it("the first pass has as many surfaces with the loads as without", () => {
    expect(planes(loaded)).toBe(planes(v001));
  });

  it("the minimum without refinement does not change", () => {
    const fos = (def: SlopeDefinition) => {
      const slope = buildSlope(toCanonicalSlopeDefinition(def));
      slope.updateAnalysisOptions({ method: "Bishop", slices: 50, iterations: 1000, refinedIterations: 0, tolerance: 0.001 });
      return analyseSlope(slope)!;
    };
    expect(fos(loaded)).toBeCloseTo(fos(v001), 4);
  });
});

describe("surfaces leaving the model below a re-entrant corner of its base", () => {
  // Base at y = 5 for x > 50 and at y = 0 for x < 50: the corner (50, 5)
  // points into the model.
  const notch = {
    coordinates: [[0, 0], [0, 20], [20, 20], [40, 10], [80, 10], [80, 5], [50, 5], [50, 0]],
    materials: [{ name: "Clay", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 } }],
    materialBoundaries: [],
    regionAssignments: [{ point: [10, 10], materialName: "Clay" }],
  } as unknown as SlopeDefinition;
  const analyse = (def: SlopeDefinition) => {
    const slope = buildSlope(toCanonicalSlopeDefinition(def));
    slope.updateAnalysisOptions({ method: "Bishop", slices: 20, tolerance: 0.001 });
    return { fos: analyseSlope(slope), slope };
  };

  it("a polyline with its vertices inside but a segment below the corner is no surface", () => {
    // The segment (49, 1)–(62, 10) passes below the corner from x = 50 to 54.8.
    const { fos } = analyse({ ...notch, customSurfaces: [{ points: [[15, 20], [35, 1], [49, 1], [62, 10]] }], customPlanesOnly: true });
    expect(fos).toBeNull();
  });

  it("nor is a circle passing below the corner between the samples along it", () => {
    // Below the corner from x = 50 to about 50.7, 0.3 m deep.
    const { fos } = analyse({ ...notch, customSearchPlanes: [{ cx: 37.5, cy: 32, radius: 30 }], customPlanesOnly: true });
    expect(fos).toBeNull();
  });

  it("a surface with a slice base outside the model has no slices", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(notch));
    slope.updateAnalysisOptions({ slices: 20 });
    const lc = 37.5 - Math.sqrt(30 ** 2 - 12 ** 2);
    const rc = 37.5 + Math.sqrt(30 ** 2 - 22 ** 2);
    expect(getSlices(slope, lc, rc, 37.5, 32, 30)).toEqual([]);
  });

  it("V053: no circle of the first pass passes more than 0.1 mm below the base", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(caseDef("V053")));
    slope.updateAnalysisOptions({ iterations: 4000 });
    setEntryExitPlanes(slope);
    let outside = 0;
    for (const p of slope.search) {
      for (let i = 1; i < 400; i++) {
        const x = p.lc[0] + ((p.rc[0] - p.lc[0]) * i) / 400;
        const y = p.cy - Math.sqrt(p.radius ** 2 - (x - p.cx) ** 2);
        if (!slope.isInsideExternalBoundary(x, y + 1e-4)) {
          outside++;
          break;
        }
      }
    }
    expect(slope.search.length).toBeGreaterThan(1000);
    expect(outside).toBe(0);
  });
});
