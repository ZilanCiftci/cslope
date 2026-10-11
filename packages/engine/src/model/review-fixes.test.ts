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

describe("Morgenstern-Price λ iteration", () => {
  // Non-circular surface the optimisation reached on VP15 (canonical
  // coordinates). Fm(λ) and Ff(λ) run parallel; beyond λ ≈ −0.95 the force
  // iteration no longer converges and its value dropped onto Fm, which was
  // taken for the Spencer solution (0.326 against Bishop 0.447).
  const surface: [number, number][] = [[39.28, 35], [43.44, 30.84], [47.43, 26.74], [49.63, 24.77], [51.83, 22.84], [54.03, 20.89], [56.23, 18.93], [58.43, 17.2], [60.63, 15.64], [62.83, 14.4], [65.03, 13.58], [67.23, 13.13], [69.43, 13.11], [71.62, 13.52], [73.82, 14.36], [75.36, 15.02], [76.9, 15.73]];

  it("does not take an unconverged force solution for the intersection", () => {
    const def = {
      ...toCanonicalSlopeDefinition(caseById("VP15").definition),
      orientation: "ltr" as const,
      customSurfaces: [{ points: surface }],
      customPlanesOnly: true,
    };
    const spencer = runVerification(def, "Morgenstern-Price", { intersliceFunction: "constant", slices: 25 }).fos!;
    const bishop = runVerification(def, "Bishop", { slices: 25 }).fos!;
    expect(bishop).toBeCloseTo(0.4465, 3);
    expect(spencer).toBeGreaterThan(0.4);
  });

  it("keeps the VP15 non-circular Spencer search within the published range", () => {
    // Slide2 0.414, literature 0.39–0.44; the spurious intersections gave
    // 0.27–0.33 with exit segments of −60° and steeper.
    const { fos, slope } = runVerification(caseById("VP15").definition, "Morgenstern-Price", {
      intersliceFunction: "constant",
      nonCircularOptimization: true,
      slices: 100,
    });
    expect(fos!).toBeGreaterThan(0.39);
    expect(fos!).toBeLessThan(0.44);
    const points = slope.search.find((p) => p.fos != null)!.points!;
    const [a, b] = points.slice(-2);
    const exitDeg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    expect(exitDeg).toBeLessThan(45);
  }, 60_000);
});
