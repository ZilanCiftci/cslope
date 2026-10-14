/**
 * The interslice acceptability check on the candidates of the non-circular
 * optimisation (solvers.ts, intersliceShearRatio).
 */
import { describe, it, expect } from "vitest";
import { VERIFICATION_CASES } from "../verification/cases";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { analyseSlope } from "./solvers";

// A surface the optimisation reached on V002 (Arai & Tagyo, weak layer) with
// a 0.001 tolerance, in the engine's canonical coordinates. Fm(λ) and Ff(λ)
// run nearly parallel and meet only at λ ≈ −0.94, where the interslice
// shear is up to 2.8 times what the soil can carry: FOS 0.344 against a
// published 0.414.
const SURFACE: [number, number][] = [
  [39.63, 35], [43.77, 30.61], [47.91, 26.23], [50.26, 23.65], [52.61, 21.07], [54.96, 19.43],
  [57.32, 17.8], [59.67, 16.83], [62.02, 15.85], [64.37, 14.84], [66.73, 13.82], [69.08, 13.09],
  [71.43, 12.56], [73.78, 13.42], [76.14, 14.28], [77.17, 14.64], [78.2, 15],
];

function fos(optimised: boolean, tolerance: number): number | null {
  const c = VERIFICATION_CASES.find((v) => v.id === "V002")!;
  const slope = buildSlope(toCanonicalSlopeDefinition(c.definition));
  slope.updateAnalysisOptions({ method: "Morgenstern-Price", intersliceFunction: "constant", slices: 50, tolerance });
  slope.customPlanesOnly = true;
  slope.addIndividualPlanes([
    { lc: SURFACE[0], rc: SURFACE[SURFACE.length - 1], cx: 72.44, cy: 44.6, radius: 0, points: SURFACE, optimised, fos: null, slices: null },
  ]);
  analyseSlope(slope);
  return slope.search[0].fos;
}

describe("interslice acceptability of optimised surfaces", () => {
  it("rejects a candidate whose solution needs more interslice shear than the soil can carry", () => {
    expect(fos(true, 0.001)).toBeNull();
  });

  it("leaves given surfaces as they are", () => {
    expect(fos(false, 0.001)).toBeCloseTo(0.344, 2);
  });

  it("accepts the solution at a small λ, which the soil can carry", () => {
    // With 0.005 the λ iteration stops at λ ≈ −0.26: 0.415.
    expect(fos(true, 0.005)).toBeCloseTo(0.415, 2);
  });
});
