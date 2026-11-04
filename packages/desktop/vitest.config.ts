import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { configDefaults } from "vitest/config";

/** Left out of the quick run (CSLOPE_QUICK_TESTS=1): full engine searches. */
const SLOW = ["src/test/engine/benchmarks.test.ts", "src/test/engine/mirrored-examples.test.ts"];

export default defineConfig({
  plugins: [tailwindcss(), react()],
  test: {
    globals: true,
    // Rendering the whole app and running analyses is slow under coverage
    // instrumentation, above all on the Windows CI runner.
    testTimeout: 30_000,
    projects: [
      {
        extends: true,
        test: {
          name: "renderer",
          environment: "jsdom",
          setupFiles: ["./vitest.engine-setup.ts", "./src/test/setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: process.env.CSLOPE_QUICK_TESTS ? [...configDefaults.exclude, ...SLOW] : configDefaults.exclude,
        },
      },
      {
        // Electron main process and preload, with `electron` mocked.
        extends: true,
        test: {
          name: "electron",
          environment: "node",
          include: ["electron/**/*.{test,spec}.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      // Measured and reported, never a reason to fail the run.
      reporter: ["text", "html", "lcov"],
    },
  },
});
