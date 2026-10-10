/**
 * Benchmark validation tests.
 *
 * Runs each BENCHMARK_MODELS entry through the solver pipeline and
 * compares the computed minimum FOS against published reference values.
 */

import { describe, expect, it } from "vitest";
import { BENCHMARK_MODELS, PUBLISHED_BENCHMARKS } from "../../store/benchmarks";
import type { ModelEntry } from "../../store/types";
import { analyseSlope, buildSlope } from "@cslope/engine";
import { buildSlopeDTOFromModel } from "../../store/helpers";

// ── Helpers ─────────────────────────────────────────────────────
// Benchmarks go through the same request builder as the app
// (buildSlopeDTOFromModel), so they validate what users actually run.

function runBenchmark(
  model: ModelEntry,
  methodOverride?: string,
): { minFos: number; surfaceCount: number } {
  const slope = buildSlope(buildSlopeDTOFromModel(model));

  slope.updateAnalysisOptions({
    ...model.options,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(methodOverride ? { method: methodOverride as any } : {}),
  });

  analyseSlope(slope);

  return {
    minFos: slope.getMinFOS(),
    surfaceCount: slope.search.filter((s) => s.fos != null).length,
  };
}

// ── Published Benchmark Validation ──────────────────────────────

describe("Published benchmark validation", () => {
  for (const benchmark of PUBLISHED_BENCHMARKS) {
    const model = BENCHMARK_MODELS.find((m) => m.id === benchmark.modelId);

    it(`${benchmark.name} (${benchmark.method}) ≈ published FOS ${benchmark.publishedFos}`, () => {
      expect(model, `Model ${benchmark.modelId} not found`).toBeDefined();

      const { minFos, surfaceCount } = runBenchmark(model!, benchmark.method);

      // Must find at least some valid surfaces
      expect(
        surfaceCount,
        `${benchmark.name}: no valid surfaces found`,
      ).toBeGreaterThan(0);

      // FOS must be finite and positive
      expect(Number.isFinite(minFos)).toBe(true);
      expect(minFos).toBeGreaterThan(0);

      // Compare against published value within tolerance
      const diff = Math.abs(minFos - benchmark.publishedFos);
      expect(
        diff,
        `${benchmark.name} (${benchmark.method}): computed FOS ${minFos.toFixed(4)} ` +
          `differs from published ${benchmark.publishedFos} by ${diff.toFixed(4)} ` +
          `(tolerance: ±${benchmark.tolerance})`,
      ).toBeLessThanOrEqual(benchmark.tolerance);
    }, 30_000);
  }
});

// ── Cross-method consistency for benchmark models ───────────────

describe("Benchmark cross-method consistency", () => {
  const METHODS = ["Bishop", "Janbu", "Morgenstern-Price"] as const;

  for (const model of BENCHMARK_MODELS) {
    it(`${model.name}: all methods produce finite positive FOS`, () => {
      const results: Record<string, number> = {};

      for (const method of METHODS) {
        const { minFos } = runBenchmark(model, method);
        expect(Number.isFinite(minFos), `${method} FOS not finite`).toBe(true);
        expect(minFos, `${method} FOS not positive`).toBeGreaterThan(0);
        results[method] = minFos;
      }

      // All methods should agree within 15% of the mean
      const vals = Object.values(results);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      for (const [method, fos] of Object.entries(results)) {
        const deviation = Math.abs(fos - avg) / avg;
        expect(
          deviation,
          `${model.name} — ${method} deviates ${(deviation * 100).toFixed(1)}% from mean ${avg.toFixed(4)}`,
        ).toBeLessThan(0.15);
      }
    }, 60_000);
  }
});
