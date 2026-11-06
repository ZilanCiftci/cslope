import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig(
  mergeConfig(
    viteConfig,
    defineConfig({
      test: {
        environment: "jsdom",
        include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
        setupFiles: ["./src/test/setup.ts"],
        // The template tests run full searches with the engine.
        testTimeout: 120_000,
      },
    }),
  ),
);
