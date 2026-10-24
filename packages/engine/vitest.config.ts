import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Many tests run full searches; coverage instrumentation slows them a
    // lot, and the non-circular problems with the full optimisation take
    // about 25 s under coverage on four cores (V094), more on CI runners.
    testTimeout: 120_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Measured and reported, never a reason to fail the run: the
      // verification problems are the engine's real check.
      reporter: ["text", "html", "lcov"],
    },
  },
});
