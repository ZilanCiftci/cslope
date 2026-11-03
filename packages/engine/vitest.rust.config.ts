// The existing unit tests, unchanged, against the Rust engine (ARCHITECTURE.md
// §6.2): every module that has a facade shim in src/facade/<path>.ts is
// replaced by it wherever it is imported (the tests and the TypeScript
// modules not ported yet), and the engine is the testing build
// (src/wasm-testing, built by `bun packages/engine-rs/tools/build-wasm.ts
// testing`). The files to run, and why the others do not, are in
// test-manifest.json.
//   cd packages/engine && bunx vitest run --config vitest.rust.config.ts
// The default config (vitest.config.ts) still tests the TypeScript engine.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, "src");
const FACADE = join(SRC, "facade");
const GLUE = join(SRC, "wasm", "cslope_wasm.js");
const TESTING_GLUE = join(SRC, "wasm-testing", "cslope_wasm.js");

interface ManifestEntry {
  mode: string;
  run: boolean;
  status?: "facade" | "mixed" | "pending";
  reason?: string;
}
const manifest = JSON.parse(readFileSync(join(ROOT, "test-manifest.json"), "utf8")) as { tests: Record<string, ManifestEntry> };

/** Resolves a module of src/ to its facade shim, and the glue to the testing build's. */
function facadeShims(): Plugin {
  return {
    name: "cslope-facade-shims",
    enforce: "pre",
    async resolveId(source, importer, options) {
      // the shims import the originals for their types and data, and a
      // facade test can ask for an original with "?original"
      if (!importer || source.endsWith("?original")) return null;
      if (importer.startsWith(FACADE + sep) && !importer.endsWith(".rust-test.ts")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      const id = resolved.id.split("?")[0];
      if (id === GLUE) return TESTING_GLUE;
      if (!id.startsWith(SRC + sep) || id.startsWith(FACADE + sep)) return null;
      const shim = join(FACADE, relative(SRC, id));
      return existsSync(shim) ? shim : null;
    },
  };
}

export default defineConfig({
  plugins: [facadeShims()],
  test: {
    globals: true,
    testTimeout: 120_000,
    setupFiles: ["vitest.rust.setup.ts"],
    // the quick run (CSLOPE_QUICK_TESTS, CI on working branches) leaves out
    // the "mixed" files: TypeScript modules not ported yet over the shims
    include: [
      ...Object.entries(manifest.tests)
        .filter(([, e]) => e.run && (!process.env.CSLOPE_QUICK_TESTS || e.status === "facade"))
        .map(([file]) => file),
      "src/facade/**/*.rust-test.ts",
    ],
  },
});
