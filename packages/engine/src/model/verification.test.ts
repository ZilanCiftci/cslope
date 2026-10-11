/**
 * Published verification problems (see verification/cases.ts for the data
 * and sources). The same cases produce the verification report.
 */
import { describe, it, expect } from "vitest";
import {
  VERIFICATION_CASES,
  circle,
  layered,
  mc,
  runVerification,
} from "../verification/cases";

describe("Verification problems", () => {
  for (const c of VERIFICATION_CASES) {
    for (const check of c.checks) {
      it(`${c.id} ${c.title}: ${check.label} ${check.published}`, () => {
        const { fos } = runVerification(c.definition, check.method, check.options);
        expect(fos).not.toBeNull();
        expect(Math.abs(fos! - check.published) / check.published).toBeLessThanOrEqual(check.tolerance);
      });
    }
  }
});

describe("Slice-count convergence", () => {
  it("VP23 geometry: a nearly vertical entry slice in a stiff crust does not inflate FOS", () => {
    // Low (1989) / Slide VP23 layering with the lower clay simplified to a
    // constant Su. With the arc length as base length, 50 slices gave 1.469
    // against 1.40 at 500 slices (independent 2000-slice check: 1.389).
    const def = layered(
      [[0, 8], [10, 8], [26, 16], [40, 16]],
      0,
      [
        { name: "Upper", topY: null, model: mc(95, 15, 20) },
        { name: "Middle", topY: 8, model: mc(15, 0, 20) },
        { name: "Lower", topY: 4, model: mc(22.5, 0, 20) },
      ],
      circle(18, 16, 12),
    );
    const f50 = runVerification(def, "Bishop", { slices: 50 }).fos!;
    const f500 = runVerification(def, "Bishop", { slices: 500 }).fos!;
    expect(Math.abs(f50 / f500 - 1)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(f500 / 1.389 - 1)).toBeLessThanOrEqual(0.01);
  });
});

describe("Search convergence", () => {
  it("VP24: the local search reaches the minimum between grid points", () => {
    // The one-pass refinement stopped at the grid resolution: 1.455 with
    // 4000 grid surfaces but 1.447 with 2000. A dense brute-force search
    // gives 1.438 (Slide2 1.439).
    const c = VERIFICATION_CASES.find((v) => v.id === "VP24")!;
    const coarse = runVerification(c.definition, "Bishop", { iterations: 2000, refinedIterations: 1000 }).fos!;
    const fine = runVerification(c.definition, "Bishop", { iterations: 4000, refinedIterations: 2000 }).fos!;
    expect(Math.abs(coarse / fine - 1)).toBeLessThanOrEqual(0.002);
    expect(fine).toBeLessThanOrEqual(1.439);
  });
});
