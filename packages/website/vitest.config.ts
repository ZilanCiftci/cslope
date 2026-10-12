import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default defineConfig(async () =>
  mergeConfig(
    await viteConfig({ mode: "test", command: "serve" }),
    defineConfig({
    test: {
      environment: "jsdom",
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
      setupFiles: ["./src/test/setup.ts"],
    },
    }),
  ),
);
