/**
 * runAnalysis: the result the app shows, in model coordinates, the same
 * with the searches run on a pool of evaluators, both directions.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisOptions } from "../types/analysis";
import { verificationOptions } from "../verification/cases";
import { fakePool, problem, sameBits, SHORT } from "../parallel/test-pool";
import { runAnalysis, runAnalysisAsync } from "./run-analysis";

const options = (extra: Partial<AnalysisOptions> = {}): AnalysisOptions =>
  ({ ...verificationOptions("Bishop", {}), ...SHORT, ...extra }) as AnalysisOptions;

const withoutTime = (r: object) => ({ ...r, elapsedMs: 0 });

describe("runAnalysis", () => {
  it("assembles the result: critical surface, slices, moments, counts", () => {
    const r = runAnalysis(problem("V001"), options());
    expect(r.minFOS).toBeGreaterThan(0);
    expect(r.criticalSurface!.fos).toBe(r.minFOS);
    expect(r.allSurfaces[0].fos).toBe(r.minFOS);
    expect(r.criticalSlices.length).toBeGreaterThan(0);
    expect(r.criticalResistingMoment).toBeCloseTo(r.criticalPushingMoment! * r.minFOS, 6);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("reports progress after each batch", () => {
    const seen: number[] = [];
    runAnalysis(problem("V001"), options(), { onProgress: (n) => seen.push(n) });
    expect(seen.length).toBeGreaterThan(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThan(seen[i - 1]);
  });

  it("gives the same result on a pool of evaluators, also both directions", async () => {
    for (const extra of [{}, { bothDirections: true }, { method: "Morgenstern-Price" as const, nonCircularOptimization: true }]) {
      const def = problem("V050b");
      const o = options(extra);
      const seq = runAnalysis(def, o);
      const { pool } = fakePool(2, 5);
      const par = await runAnalysisAsync(def, o, (slope, d, opts) => pool.analyse(slope, d, opts));
      pool.close();
      expect(sameBits(withoutTime(seq), withoutTime(par), "", new Set())).toBeNull();
    }
  }, 120_000);

  it("both directions: the lower factor with its direction", () => {
    const def = problem("V001");
    const own = runAnalysis(def, options());
    const both = runAnalysis(def, options({ bothDirections: true }));
    expect(both.minFOS).toBeLessThanOrEqual(own.minFOS);
    expect(both.slidingDirection).toBeDefined();
    expect(both.otherDirectionMinFOS).not.toBeUndefined();
  });

  it("no valid surface is an error", () => {
    const def = { ...problem("V001"), customSearchPlanes: [{ cx: 0, cy: 0, radius: 0.1 }], customPlanesOnly: true };
    expect(() => runAnalysis(def, options())).toThrow(/No valid slip surface/);
  });
});
