// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELIABILITY_CASES, VERIFICATION_CASES } from "@cslope/engine/verification";
import data from "../src/content/generated/verification.json";
import type { VerificationData } from "../src/content/verification-types";
import { buildData } from "./generate-data";

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
    // The pass marks come from the unrounded results, so they are compared
    // separately below.
    const withoutPass = (d: VerificationData) =>
      JSON.parse(JSON.stringify(d), (key, value) => (key === "pass" || key === "passed" ? undefined : value));
    expect(withoutPass(buildData(fos, reliability))).toEqual(withoutPass(file));
  });

  it("marks a check as passed exactly when it is within tolerance (to rounding)", () => {
    for (const k of file.problems.flatMap((p) => p.checks)) {
      if (k.deviation == null) expect(k.pass).toBe(false);
      else if (Math.abs(Math.abs(k.deviation) - k.tolerance) > 1e-5) expect(k.pass).toBe(Math.abs(k.deviation) <= k.tolerance);
    }
  });

  it("has a summary consistent with its rows", () => {
    const checks = file.problems.flatMap((p) => p.checks);
    expect(file.summary.checks).toBe(checks.length);
    expect(file.summary.passed).toBe(checks.filter((k) => k.pass).length);
    expect(file.summary.problems).toBe(file.problems.length);
  });
});
