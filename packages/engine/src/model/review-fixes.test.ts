import { describe, it, expect } from "vitest";
import { buildSlope } from "./build-slope";
import { toCanonicalSlopeDefinition } from "./canonical";
import { VERIFICATION_CASES, runVerification } from "../verification/cases";

const caseById = (id: string) => {
  const c = VERIFICATION_CASES.find((v) => v.id === id);
  if (!c) throw new Error(`No verification case ${id}`);
  return c;
};

describe("interslice data points of a right-to-left model", () => {
  it("are given with x = 0 at the left end of the surface in model space", () => {
    // VP25 (Prandtl mechanism) slides right to left. An asymmetric f(x)
    // must give the same FOS as on the explicitly mirrored left-to-right
    // model with the mirrored function.
    const vp25 = caseById("VP25").definition;
    const points: [number, number][] = [[0, 0], [0.3, 1], [1, 0.2]];
    const mirrored = points.map(([x, f]) => [1 - x, f] as [number, number]);
    const opts = { intersliceFunction: "data-point-specified" as const };
    const rtl = runVerification(vp25, "Morgenstern-Price", { ...opts, intersliceDataPoints: points }).fos!;
    const ltrDef = { ...toCanonicalSlopeDefinition(vp25), orientation: "ltr" as const };
    const ltr = runVerification(ltrDef, "Morgenstern-Price", { ...opts, intersliceDataPoints: mirrored }).fos!;
    expect(rtl).toBeCloseTo(ltr, 6);
    // Unmirrored the asymmetric function gives a clearly different FOS.
    const wrong = runVerification(ltrDef, "Morgenstern-Price", { ...opts, intersliceDataPoints: points }).fos!;
    expect(Math.abs(wrong - rtl)).toBeGreaterThan(0.005);
  });

  it("are mirrored only on a mirrored model", () => {
    const slope = buildSlope(toCanonicalSlopeDefinition(caseById("VP25").definition));
    slope.updateAnalysisOptions({ intersliceDataPoints: [[0, 0], [0.25, 1]] });
    expect(slope.intersliceDataPoints).toEqual([[0.75, 1], [1, 0]]);
    slope.setMirrored(false);
    expect(slope.intersliceDataPoints).toEqual([[0, 0], [0.25, 1]]);
  });
});
