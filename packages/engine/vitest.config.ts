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
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 60,
        statements: 60,
      },
    },
  },
});
