/**
 * vitest setup file: starts the testing build of the engine before the
 * tests import anything (ARCHITECTURE.md §3.2). The testing build adds the
 * internal functions the unit tests call (`__test_call`); vitest.config.ts
 * points the glue at it.
 */
import { readFileSync } from "node:fs";
import { initEngineSync } from "./src/engine";

const wasm = new URL("./src/wasm-testing/cslope_wasm_bg.wasm", import.meta.url);
let bytes: Uint8Array;
try {
  bytes = readFileSync(wasm);
} catch {
  throw new Error("No testing build of the engine: run `bun packages/engine-rs/tools/build-wasm.ts testing` first.");
}
initEngineSync(bytes);
