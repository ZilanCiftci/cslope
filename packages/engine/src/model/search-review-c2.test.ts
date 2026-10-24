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
