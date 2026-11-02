import { configDefaults, defineConfig } from "vitest/config";

/**
 * Left out of the quick run (CSLOPE_QUICK_TESTS=1, CI on pushes to working
 * branches): the verification problems, all finite element tests and the
 * slowest search tests, about 860 of the suite's 990 test seconds
 * (2026-11). The full suite runs on main and on pull requests.
 */
const SLOW = [
  "src/model/verification-problems-*.test.ts",
  "src/model/verification.test.ts",
  "src/model/benchmarks.test.ts",
  "src/model/reliability.test.ts",
  "src/model/search-review-c2.test.ts",
  "src/model/orientation-matrix.test.ts",
  "src/fem/**",
];

export default defineConfig({
  test: {
    globals: true,
    // Many tests run full searches; coverage instrumentation slows them a
    // lot, and the non-circular problems with the full optimisation take
    // about 25 s under coverage on four cores (V094), more on CI runners.
    testTimeout: 120_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: process.env.CSLOPE_QUICK_TESTS ? [...configDefaults.exclude, ...SLOW] : configDefaults.exclude,
    coverage: {
      provider: "v8",
      // Measured and reported, never a reason to fail the run: the
      // verification problems are the engine's real check.
      reporter: ["text", "html", "lcov"],
    },
  },
});
