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
