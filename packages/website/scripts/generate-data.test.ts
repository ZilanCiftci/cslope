// @vitest-environment node
import { describe, expect, it } from "vitest";
import { RELIABILITY_CASES, VERIFICATION_CASES } from "@cslope/engine/verification";
import data from "../src/content/generated/verification.json";
import type { VerificationData } from "../src/content/verification-types";
import { findForbiddenNames } from "./forbidden-names";
import { FEM_LABEL, agreement, buildData, type FemRaw } from "./generate-data";

const file = data as VerificationData;

/** The computed values in the checked-in file, per analysis as the generator keys them. */
function computedFromFile() {
  const fos: Record<string, (number | null)[]> = {};
  VERIFICATION_CASES.forEach(
    (c, i) => (fos[c.id] = file.problems[i].results.filter((r) => r.method !== FEM_LABEL).map((r) => r.computed)),
  );
  const reliability: Record<string, number[]> = {};
  RELIABILITY_CASES.forEach((c, i) => {
    reliability[i] = c.checks.map(([q]) => file.reliability[i].rows.find((r) => r.quantity === q)?.computed ?? NaN);
  });
  const fem: Record<string, FemRaw> = {};
  for (const p of file.problems) {
    if (!p.fem) continue;
    fem[p.id] = { fos: p.results.find((r) => r.method === FEM_LABEL)?.computed ?? NaN, flowRule: p.fem.flowRule, levels: p.fem.levels };
  }
  return { fos, reliability, fem };
}

describe("generated/verification.json", () => {
  it("matches the engine's problems (regenerate with bun scripts/generate-data.ts)", () => {
    expect(file.problems.length).toBe(VERIFICATION_CASES.length);
    expect(file.reliability.length).toBe(RELIABILITY_CASES.length);
    const { fos, reliability, fem } = computedFromFile();
    // Everything except the engine's results is rebuilt from the problems.
    expect(buildData(fos, reliability, fem)).toEqual(file);
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
