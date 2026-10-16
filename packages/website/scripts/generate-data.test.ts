// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELIABILITY_CASES, VERIFICATION_CASES, presentedAnalyses } from "@cslope/engine/verification";
import data from "../src/content/generated/verification.json";
import type { VerificationData } from "../src/content/verification-types";
import { findForbiddenNames } from "./forbidden-names";
import { agreement, buildData } from "./generate-data";

const file = data as VerificationData;

/** The computed values in the checked-in file, per check as the generator keys them. */
function computedFromFile() {
  const fos: Record<string, (number | null)[]> = {};
  VERIFICATION_CASES.forEach((c, i) => {
    const values: (number | null)[] = c.checks.map(() => null);
    presentedAnalyses(c).forEach((a, j) => {
      for (const k of a.checks) values[k] = file.problems[i].results[j].computed;
    });
    fos[c.id] = values;
  });
  const reliability: Record<string, number[]> = {};
  RELIABILITY_CASES.forEach((c, i) => {
    reliability[i] = c.checks.map(([q]) => file.reliability[i].rows.find((r) => r.quantity === q)?.computed ?? NaN);
  });
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

  it("presents results only: no tolerance, pass mark or deviation", () => {
    const text = JSON.stringify(file);
    expect(text).not.toMatch(/"(tolerance|pass|passed|deviation)":/);
  });

  it("names no program", () => {
    const text = JSON.stringify(file, null, 1);
    expect(text).not.toMatch(/\b[Pp]rogram [A-Z]\b/);
    expect(findForbiddenNames("verification.json", text)).toEqual([]);
  });

  it("agrees with every check by the engine's rule (tolerance.ts)", () => {
    const { fos } = computedFromFile();
    const a = agreement(fos);
    expect(a.agree).toBe(a.total);
  });

  it("has a summary consistent with its rows", () => {
    const s = file.summary;
    expect(s.problems).toBe(file.problems.length);
    expect(s.results).toBe(file.problems.reduce((n, p) => n + p.results.length, 0));
    expect(s.publishedValues).toBe(file.problems.reduce((n, p) => n + p.published.length, 0));
    expect(s.problemsWithPublished).toBe(file.problems.filter((p) => p.published.length > 0).length);
  });
});
