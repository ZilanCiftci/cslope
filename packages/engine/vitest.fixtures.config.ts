// Runs the Rust port's fixture exporters (packages/engine-rs/tools/fixtures/
// *.fixture.ts) under Node (V8), the runtime the app ships with: Bun's
// JavaScriptCore uses the platform libm, so its transcendental results can
// differ in the last bit from V8's. Each exporter is a file with one `it(...)`
// (vitest globals, no import) that writes its fixtures.
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts [area]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    dir: "../engine-rs/tools/fixtures",
    include: ["**/*.fixture.ts"],
    testTimeout: 0,
    pool: "forks",
  },
});
