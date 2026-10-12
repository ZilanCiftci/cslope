/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  test: {
    globals: true,
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
      thresholds: {
        lines: 38,
        functions: 54,
        branches: 35,
        statements: 39,
      },
    },
  },
});
