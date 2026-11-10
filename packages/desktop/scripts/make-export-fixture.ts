/**
 * Write packages/engine-rs/crates/cslope-py/tests/data/app-results.cslp: a
 * project saved by the app's writer with the results the app computes
 * (the engine the app ships, through @cslope/engine, on each model as the
 * app opens it), for the Python test that `cslope export` runs to the F the
 * app shows (tests/test_export.py). The models: the examples, a saved model
 * with fields missing (orientation, options, limits) and one with a region
 * left to the first material (#85). Run it again after a change that moves
 * results, and commit the file.
 *
 *   bun scripts/make-export-fixture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { initEngineSync, runAnalysis } from "@cslope/engine";

const require = createRequire(import.meta.url);
initEngineSync(readFileSync(require.resolve("@cslope/engine/wasm")));
const engineDir = join(import.meta.dirname, "../../engine");
const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
Object.assign(globalThis, {
  __APP_VERSION__: readJson(join(import.meta.dirname, "../package.json")).version,
  __ENGINE_BUILD__: { version: readJson(join(engineDir, "package.json")).version, sourceHash: readJson(join(engineDir, "src/wasm/BUILD-INFO.json")).sourceHash },
});
const { writeProjectArchive } = await import("../src/features/project/cslp");
const { parseProjectData } = await import("../src/store/persistence");
const { BENCHMARK_MODELS } = await import("../src/store/benchmarks");
const { buildSlopeDTOFromModel } = await import("../src/store/helpers");

const mc = (unitWeight: number, cohesion: number, frictionAngle: number) => ({ kind: "mohr-coulomb", unitWeight, cohesion, frictionAngle });
const saved: Record<string, unknown>[] = [
  ...BENCHMARK_MODELS.map((m, i) => {
    const { resultViewSettings: _v, result: _r, runState: _s, progress: _p, errorMessage: _e, ...rest } = m;
    void [_v, _r, _s, _p, _e];
    return { ...(JSON.parse(JSON.stringify(rest)) as Record<string, unknown>), id: `model-${i + 1}` };
  }),
  {
    // a file with fields missing: faces left (inferred), no options, no limits
    id: "model-sparse",
    name: "Fields missing",
    coordinates: [[0, 0], [0, 20], [20, 20], [40, 10], [60, 10], [60, 0]],
    materials: [{ id: "m1", name: "Soil", model: mc(18, 5, 28) }],
    options: { method: "Bishop", slices: 30, iterations: 1000, refinedIterations: 500 },
  },
  {
    // two regions, one assigned: the other keeps the first material (#85)
    id: "model-unassigned",
    name: "A region left to the first material",
    orientation: "ltr",
    coordinates: [[0, 0], [0, 20], [20, 20], [40, 10], [60, 10], [60, 0]],
    materials: [
      { id: "m1", name: "Soil", color: "#aaaaaa", model: mc(18, 5, 28) },
      { id: "m2", name: "Rock", color: "#666666", model: mc(22, 50, 40) },
    ],
    materialBoundaries: [{ id: "b", coordinates: [[0, 4], [60, 5]] }],
    regionMaterials: [{ point: [5, 2], materialId: "m2" }],
    piezometricLine: { enabled: true, lines: [{ id: "w", name: "W", color: "#3b82f6", coordinates: [[0, 9], [60, 6]] }], activeLineId: "w", freeWater: false, materialAssignment: {} },
  },
];

const file = parseProjectData({ version: 3, activeModelId: "model-1", models: saved, units: "SI" });
for (const m of file.models) {
  try {
    m.result = runAnalysis(buildSlopeDTOFromModel(m), m.options);
  } catch (e) {
    throw new Error(`${m.name}: ${(e as Error).message}`, { cause: e });
  }
  // the app keeps the surfaces for the view; the test needs the factor
  m.result = { ...m.result, allSurfaces: [] };
  m.runState = "done";
  m.progress = 1;
  m.errorMessage = null;
}
const bytes = await writeProjectArchive(file, { modified: new Date("2026-11-06T12:00:00Z"), created: "2026-11-06T12:00:00.000Z" });
const out = join(import.meta.dirname, "../../engine-rs/crates/cslope-py/tests/data/app-results.cslp");
writeFileSync(out, bytes);
console.log(`${out}: ${bytes.length} bytes, ${file.models.length} models: ${file.models.map((m) => `${m.name} F ${m.result?.minFOS.toFixed(4)}`).join("; ")}`);
