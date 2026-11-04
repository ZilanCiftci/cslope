import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { configDefaults, defineConfig } from "vitest/config";

/**
 * Left out of the quick run (CSLOPE_QUICK_TESTS=1, CI on pushes to working
 * branches): the verification problems, all finite element tests and the
 * slowest search tests. The full suite runs on main and on pull requests.
 */
const SLOW = [
  "src/model/verification-problems-*.test.ts",
  "src/model/verification.test.ts",
  "src/model/benchmarks.test.ts",
  "src/model/reliability.test.ts",
  "src/model/search-review-c2.test.ts",
  "src/model/orientation-matrix.test.ts",
  "src/parallel/parallel-search.test.ts",
  "src/fem/**",
  "src/facade/fem/**",
];

const SRC = join(dirname(fileURLToPath(import.meta.url)), "src");
const GLUE = join(SRC, "wasm", "cslope_wasm.js");
const TESTING_GLUE = join(SRC, "wasm-testing", "cslope_wasm.js");

/**
 * The tests run on the testing build of the engine (src/wasm-testing, built
 * by `bun packages/engine-rs/tools/build-wasm.ts testing`), which adds the
 * internal functions the unit tests call: the glue of the product build is
 * replaced by the testing build's (vitest.setup.ts starts its wasm).
 */
function testingGlue(): Plugin {
  return {
    name: "cslope-testing-glue",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !source.includes("cslope_wasm")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved?.id.split("?")[0] === GLUE ? TESTING_GLUE : null;
    },
  };
}

export default defineConfig({
  plugins: [testingGlue()],
  test: {
    globals: true,
    // Many tests run full searches; the non-circular problems with the full
    // optimisation take several seconds each, more under coverage and on CI
    // runners.
    testTimeout: 120_000,
    setupFiles: ["vitest.setup.ts"],
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
