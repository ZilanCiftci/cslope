import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Many tests run full searches; coverage instrumentation slows them a lot.
    testTimeout: 30_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      // Just below the measured coverage: a drop fails the run.
      thresholds: {
        lines: 98,
        functions: 98,
        branches: 92,
        statements: 97,
      },
    },
  },
});
