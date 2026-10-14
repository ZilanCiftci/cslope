/**
 * The published verification checks, split over several test files so that
 * they run in parallel: Vitest runs the tests of one file one after another,
 * and all checks in one file took about 18 minutes under coverage in CI.
 * Each verification-problems-<k>.test.ts runs every SHARDS-th analysis.
 *
 * Checks with the same problem, method and options (one analysis compared
 * with several published values) share one run and one shard.
 */
import { describe, it, expect } from "vitest";
import { RELIABILITY_CASES } from "../verification/reliability-cases";
import { VERIFICATION_CASES, runReliabilityCase, runVerification } from "../verification/cases";
import { agrees } from "../verification/tolerance";

export const SHARDS = 8;

/** The analysis a check runs, as a key: problem, method and its own options. */
const analysisKey = (id: string, method: string, options: object = {}) =>
  `${id}|${method}|${JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))))}`;

export function defineVerificationShard(shard: number): void {
  const checks = VERIFICATION_CASES.flatMap((c) => c.checks.map((check) => ({ c, check })));
  const keys = [...new Set(checks.map(({ c, check }) => analysisKey(c.id, check.method, check.options)))];
  const results = new Map<string, number | null>();
  describe(`Verification problems (part ${shard + 1} of ${SHARDS})`, () => {
    checks.forEach(({ c, check }) => {
      const key = analysisKey(c.id, check.method, check.options);
      if (keys.indexOf(key) % SHARDS !== shard) return;
      // Searches with non-circular optimisation take a few seconds. A check
      // marked pending waits for an engine change and fails until it lands.
      const pending = check.pending ? ` [pending: ${check.pending}]` : "";
      it(`${c.id} ${c.title}: ${check.label} ${check.published} (${check.publishedBy})${pending}`, { timeout: 60000 }, () => {
        if (!results.has(key)) results.set(key, runVerification(c.definition, check.method, check.options).fos);
        const fos = results.get(key)!;
        expect(fos).not.toBeNull();
        const deviation = (fos! - check.published) / check.published;
        expect(agrees(check, fos!), `deviation ${(deviation * 100).toFixed(2)} %, tolerance ${(check.tolerance * 100).toFixed(2)} %`).toBe(true);
      });
    });
  });

  describe(`Probabilistic verification problems (part ${shard + 1} of ${SHARDS})`, () => {
    RELIABILITY_CASES.forEach((c, k) => {
      if (k % SHARDS !== shard) return;
      // One run per case (Taylor series and Monte Carlo), one test per check.
      let results: ReturnType<typeof runReliabilityCase> | null = null;
      const run = () => (results ??= runReliabilityCase(c));
      c.checks.forEach(([quantity, published, publishedBy, tolerance], i) => {
        if (quantity === "fos") return; // in VERIFICATION_CASES
        it(`${c.id} ${c.title}: ${quantity} ${published} (${publishedBy})`, { timeout: 120000 }, () => {
          const r = run()[i];
          expect(r.quantity).toBe(quantity);
          expect(Math.abs(r.computed - published)).toBeLessThanOrEqual(tolerance + 1e-9);
        });
      });
    });
  });
}
