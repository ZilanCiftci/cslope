import { describe, expect, it } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import { runVerification } from "../verification/cases";

// A 4:5 slope, c′ = 15 kPa, φ′ = 30°, with the exit range given as the toe
// point (as the format of another program gives it); that program's
// example gives 1.2535 (Morgenstern-Price, half-sine).
const slope = (limits?: SlopeDefinition["analysisLimits"]): SlopeDefinition => ({
  orientation: "ltr",
  coordinates: [[8.5, 20], [22.5, 20], [30.5, 10], [40, 10], [40, 5], [8.5, 5]],
  materials: [{ name: "S", model: { kind: "mohr-coulomb", unitWeight: 20, cohesion: 15, frictionAngle: 30 } }],
  ...(limits ? { analysisLimits: limits } : {}),
});
const mp = { intersliceFunction: "half-sine" } as const;

describe("a search range given as a point", () => {
  it("finds the circles exiting at the toe corner", () => {
    const free = runVerification(slope(), "Morgenstern-Price", mp).fos!;
    const { fos, slope: s } = runVerification(
      slope({ entryLeftX: 17, entryRightX: 21.5, exitLeftX: 30.5, exitRightX: 30.5 }),
      "Morgenstern-Price",
      mp,
    );
    // A circle exactly through the corner runs on in the soil beyond it;
    // with the range widened by 1e-5 of the width the circles just beside
    // it exit there (1.331 before, from the few that rounding let through).
    expect(fos!).toBeCloseTo(1.2535, 2);
    expect(Math.abs(fos! / free - 1)).toBeLessThan(0.002);
    // As given; only the search widens it.
    expect(s.limits).toEqual([17, 21.5, 30.5, 30.5]);
    const crit = s.search.find((p) => p.fos != null)!;
    expect(Math.abs(crit.rc[0] - 30.5)).toBeLessThan(1e-3);
  });

  it("leaves a range of finite width as given", () => {
    const { slope: s } = runVerification(
      slope({ entryLeftX: 17, entryRightX: 21.5, exitLeftX: 30, exitRightX: 31 }),
      "Morgenstern-Price",
      mp,
    );
    expect(s.limits).toEqual([17, 21.5, 30, 31]);
    expect(s.searchLimits).toEqual([17, 21.5, 30, 31]);
  });
});
