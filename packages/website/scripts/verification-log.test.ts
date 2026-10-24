import { describe, expect, it } from "vitest";
import { moved, points, stats } from "./verification-log";
import type { VerificationData } from "../src/content/verification-types";

const data = (computed: number) =>
  ({
    problems: [
      {
        id: "V1",
        published: [{ value: 2, method: "Bishop", source: "Paper", computed }],
        results: [{ method: "Bishop", computed, programs: { min: 1.9, max: 2.1 } }],
      },
    ],
  }) as unknown as VerificationData;

describe("verification log", () => {
  it("compares with the programs' midpoint and the published value", () => {
    const { programs, papers } = points(data(2.2));
    expect(programs[0].reference).toBeCloseTo(2, 12);
    expect(papers[0].reference).toBe(2);
    const s = stats(programs);
    expect(s.mean).toBeCloseTo(10, 9);
    expect(s.meanAbs).toBeCloseTo(10, 9);
    expect(s.rms).toBeCloseTo(10, 9);
    expect(s.maxAbs).toBeCloseTo(10, 9);
  });

  it("lists only the results whose value changed", () => {
    expect(moved(points(data(2)).programs, points(data(2)).programs)).toHaveLength(0);
    const m = moved(points(data(2)).programs, points(data(2.1)).programs);
    expect(m).toHaveLength(1);
    expect(m[0].after.computed).toBe(2.1);
  });

  it("gives zeros without results", () => {
    expect(stats([])).toEqual({ n: 0, mean: 0, meanAbs: 0, rms: 0, maxAbs: 0 });
  });
});
