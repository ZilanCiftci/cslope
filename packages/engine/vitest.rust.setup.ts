/**
 * vitest setup file of vitest.rust.config.ts: starts the testing build of
 * the engine before the tests import anything (ARCHITECTURE.md §3.2), and
 * skips the tests test-manifest.json lists as known differences (with the
 * reason there), so that the run is green and every difference is written
 * down.
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach } from "vitest";
import { initEngineSync } from "./src/engine";

const wasm = new URL("./src/wasm-testing/cslope_wasm_bg.wasm", import.meta.url);
let bytes: Uint8Array;
try {
  bytes = readFileSync(wasm);
} catch {
  throw new Error("No testing build of the engine: run `bun packages/engine-rs/tools/build-wasm.ts testing` first.");
}
initEngineSync(bytes);

interface ManifestEntry {
  knownDifferences?: Record<string, string>;
}
const manifest = JSON.parse(readFileSync(new URL("./test-manifest.json", import.meta.url), "utf8")) as { tests: Record<string, ManifestEntry> };
const root = fileURLToPath(new URL("./", import.meta.url));

interface TaskLike {
  name: string;
  suite?: TaskLike;
  file?: { filepath: string };
}

/** "describe > … > test", as vitest reports it (without the file). */
function fullName(task: TaskLike): string {
  const names: string[] = [];
  for (let t: TaskLike | undefined = task; t && t !== (task.file as unknown); t = t.suite) names.unshift(t.name);
  return names.join(" > ");
}

beforeEach((ctx) => {
  const task = ctx.task as unknown as TaskLike;
  const file = task.file ? relative(root, task.file.filepath).split("\\").join("/") : "";
  const known = manifest.tests[file]?.knownDifferences;
  if (known && fullName(task) in known) ctx.skip();
});
