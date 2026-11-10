/**
 * The input hash of a result survives a save and reopen: the hash taken
 * when a run completes (of the model as the app holds it) is the hash of
 * the model the file reads back as, for every value of every option
 * control, every example and every verification problem (Help ›
 * Benchmarks). The Rust input_hash is held to the same models by the
 * golden corpus (scripts/project-corpus.ts, crates/cslope-project).
 */
import { describe, expect, it } from "vitest";
import { BENCHMARK_MODELS } from "../../store/benchmarks";
import { verificationModels } from "../../store/verification-models";
import { rememberResultInput } from "../../store/result-input";
import { isResultOutOfDate } from "../../store/out-of-date";
import { PROJECT_FILE_VERSION } from "../../store/persistence";
import type { AnalysisResult, ModelEntry } from "../../store/types";
import { OPTION_VARIANTS } from "../../test/option-variants";
import { openProject, readProject, writeProjectArchive } from "./cslp";
import { analysisInputHash } from "./input-hash";

const RESULT = { minFOS: 1.2, maxFOS: 2, criticalSurface: null, allSurfaces: [], criticalSlices: [], method: "Bishop", elapsedMs: 1 };

/** Each model run (its result stamped as a completed run stamps it), saved by the app and opened again. */
async function runSaveReopen(models: ModelEntry[]) {
  const run = models.map((m, i) => {
    const result = { ...RESULT } as unknown as AnalysisResult;
    rememberResultInput(result, m);
    return { ...m, id: `model-${i}`, runState: "done" as const, progress: 1, result, errorMessage: null };
  });
  const bytes = await writeProjectArchive({ version: PROJECT_FILE_VERSION, activeModelId: run[0].id, models: run, units: "SI" }, { assets: [] });
  const opened = await openProject(bytes);
  const read = await readProject(bytes);
  return { run, opened, read };
}

async function expectCurrent(models: ModelEntry[], names: string[]) {
  const { run, opened, read } = await runSaveReopen(models);
  for (const [i, m] of read.file.models.entries()) {
    const saved = opened.results.get(m.id)?.inputHash;
    expect(saved, names[i]).toBe(await analysisInputHash(run[i]));
    expect(saved, names[i]).toBe(await analysisInputHash(m));
    expect(isResultOutOfDate(m.result), names[i]).toBe(false);
  }
}

describe("a result's input hash after a save and reopen", () => {
  it("is the same for every value of every option control", async () => {
    const base = BENCHMARK_MODELS[0];
    const models = OPTION_VARIANTS.map(({ patch }) => ({ ...base, options: { ...base.options, ...patch } }) as ModelEntry);
    await expectCurrent(models, OPTION_VARIANTS.map((v) => v.name));
  });

  it("is the same for every example and every verification problem", async () => {
    const models = [...BENCHMARK_MODELS, ...verificationModels()];
    await expectCurrent(models, models.map((m) => m.name));
  });
});

describe("the anonymized copy of a project", () => {
  it("keeps a current result current and leaves a result out of date out", async () => {
    const { anonymizeProject, DEFAULT_ANONYMIZE_OPTIONS } = await import("./anonymize");
    const { markResultOutOfDate } = await import("../../store/out-of-date");
    const [a, b] = BENCHMARK_MODELS;
    const { run } = await runSaveReopen([a, b]);
    // the second result is out of date (as a file edited after its run opens)
    markResultOutOfDate(run[1].result);
    const options = { ...DEFAULT_ANONYMIZE_OPTIONS, removeResults: false, localOrigin: "none" as const };
    const { file, summary } = anonymizeProject({ version: PROJECT_FILE_VERSION, activeModelId: run[0].id, models: run, units: "SI" }, options, [], new Date("2026-11-07T00:00:00Z"));
    expect(summary.resultsRemoved).toBe(1);
    expect(file.models[1].result).toBeNull();
    // the first, renamed (its materials too), opens current
    const bytes = await writeProjectArchive(file, { assets: [] });
    const read = await readProject(bytes);
    expect(read.file.models[0].name).not.toBe(a.name);
    expect(read.file.models[0].runState).toBe("done");
    expect(isResultOutOfDate(read.file.models[0].result)).toBe(false);
  });
});
