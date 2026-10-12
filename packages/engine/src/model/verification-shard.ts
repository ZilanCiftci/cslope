/**
 * The published verification checks, split over several test files so that
 * they run in parallel: Vitest runs the tests of one file one after another,
 * and all checks in one file took about 18 minutes under coverage in CI.
 * Each verification-problems-<k>.test.ts runs every SHARDS-th check.
 */
import { describe, it, expect } from "vitest";
import { RELIABILITY_CASES } from "../verification/reliability-cases";
import { VERIFICATION_CASES, runReliabilityCase, runVerification } from "../verification/cases";

export const SHARDS = 8;

export function defineVerificationShard(shard: number): void {
  const checks = VERIFICATION_CASES.flatMap((c) => c.checks.map((check) => ({ c, check })));
  describe(`Verification problems (part ${shard + 1} of ${SHARDS})`, () => {
    checks.forEach(({ c, check }, i) => {
      if (i % SHARDS !== shard) return;
      // Searches with non-circular optimisation take a few seconds. A check
      // marked pending waits for an engine change and fails until it lands.
      const pending = check.pending ? ` [pending: ${check.pending}]` : "";
      it(`${c.id} ${c.title}: ${check.label} ${check.published} (${check.publishedBy})${pending}`, { timeout: 60000 }, () => {
        const { fos } = runVerification(c.definition, check.method, check.options);
        expect(fos).not.toBeNull();
        expect(Math.abs(fos! - check.published) / check.published).toBeLessThanOrEqual(check.tolerance);
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
