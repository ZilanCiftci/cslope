/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
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
      reporter: ["text", "html", "lcov"],
      // Just below the measured coverage: a drop fails the run.
      thresholds: {
        lines: 96,
        functions: 94,
        branches: 86,
        statements: 94,
      },
    },
  },
});
