// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELIABILITY_CASES, VERIFICATION_CASES } from "@cslope/engine/verification";
import data from "../src/content/generated/verification.json";
import type { VerificationData } from "../src/content/verification-types";
import { agreement, buildData } from "./generate-data";

const file = data as VerificationData;

/** The computed values in the checked-in file, keyed as the generator keys them. */
function computedFromFile() {
  const fos: Record<string, (number | null)[]> = {};
  VERIFICATION_CASES.forEach((c, i) => (fos[c.id] = file.problems[i].checks.map((k) => k.computed)));
  const reliability: Record<string, number[]> = {};
  RELIABILITY_CASES.forEach((c, i) => (reliability[c.id] = file.reliability[i].checks.map((k) => k.computed ?? NaN)));
  return { fos, reliability };
}

describe("generated/verification.json", () => {
  it("matches the engine's problems (regenerate with bun scripts/generate-data.ts)", () => {
    expect(file.problems.length).toBe(VERIFICATION_CASES.length);
    expect(file.reliability.length).toBe(RELIABILITY_CASES.length);
    const { fos, reliability } = computedFromFile();
    // Everything except the engine's results is rebuilt from the problems.
    expect(buildData(fos, reliability)).toEqual(file);
  });

  it("publishes no tolerance or pass mark, only the reference and the computed value", () => {
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/"(tolerance|pass|passed)":/);
  });

  it("agrees with every reference by the engine's rule (tolerance.ts)", () => {
    const { fos } = computedFromFile();
    const a = agreement(fos);
    expect(a.agree).toBe(a.total);
  });

  it("has a summary consistent with its rows", () => {
    const checks = file.problems.flatMap((p) => p.checks);
    expect(file.summary.checks).toBe(checks.length);
    expect(file.summary.problems).toBe(file.problems.length);
  });
});
