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
    // The shear force of each base, as the app's slice table shows it.
    for (const s of r.criticalSlices) {
      expect(s.shearForce).toBeCloseTo(s.cohesion * s.baseLength + Math.max(s.normalForce, 0) * Math.tan((s.frictionAngle * Math.PI) / 180), 9);
    }
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

  it("marks the custom search planes' surfaces and lists each with its factor or why it has none, also on a pool", async () => {
    // V001 (canonical: the crest at y = 35 left of x = 22, a 1.5:1 slope down to (52, 15), the lower ground at y = 15).
    const def = {
      ...problem("V001"),
      customSearchPlanes: [
        { cx: 40, cy: 60, radius: 40 },
        { cx: 0, cy: 0, radius: 0.1 },
      ],
      customSurfaces: [{ points: [[0, 30], [20, 18], [45, 18.5]] as [number, number][] }],
    };
    const r = runAnalysis(def, options());
    const customs = r.customSurfaces!;
    expect(customs.map((c) => [c.kind, c.index])).toEqual([
      ["circle", 0],
      ["circle", 1],
      ["polyline", 0],
    ]);
    expect(customs[0].surface!.customPlane).toEqual({ kind: "circle", index: 0 });
    expect(customs[0].surface!.fos).toBeGreaterThan(0);
    expect(customs[0].reason).toBeUndefined();
    expect(customs[1].surface).toBeUndefined();
    expect(customs[1].reason).toMatch(/does not cut the ground twice/);
    expect(customs[2].surface!.points!.length).toBeGreaterThanOrEqual(3);
    expect(customs[2].surface!.customPlane).toEqual({ kind: "polyline", index: 0 });
    // The analysed ones are among all surfaces, marked, and only they are.
    const marked = r.allSurfaces.filter((s) => s.customPlane);
    expect(marked).toHaveLength(2);
    expect(marked.map((s) => s.fos).sort()).toEqual([customs[0].surface!.fos, customs[2].surface!.fos].sort());
    // Without custom planes there is no list.
    expect(runAnalysis(problem("V001"), options()).customSurfaces).toBeUndefined();
    // The marks and the list survive the pool's workers (the planes cross the wire).
    const { pool } = fakePool(2, 5);
    const par = await runAnalysisAsync(def, options(), (slope, d, opts) => pool.analyse(slope, d, opts));
    pool.close();
    expect(sameBits(withoutTime(r), withoutTime(par), "", new Set())).toBeNull();
    // With both directions the custom planes (analysed in the model's own direction) stay listed.
    const both = runAnalysis(def, options({ bothDirections: true }));
    expect(both.customSurfaces).toEqual(customs);
  }, 120_000);

  it("both directions: no surface leaves through a side of the model that leans out by a hair", () => {
    // Level ground at y = 0 (x −20 to 15), a channel down to −2.5 at x −1..1,
    // the base at −8, turned by 0.006°: the left side leans out by 0.8 mm,
    // its bottom corner the leftmost vertex. The side once counted as
    // ground, and circles leaving through it at that corner were critical
    // in the opposite direction (F 0.34 against 1.48).
    const level: [number, number][] = [[-20, -8], [-20, 0], [-3.4, 0], [-1, -2.5], [1, -2.5], [3.4, 0], [15, 0], [15, -8]];
    const a = 1e-4;
    const coordinates = level.map(([x, y]) => [x * Math.cos(a) + y * Math.sin(a), -x * Math.sin(a) + y * Math.cos(a)] as [number, number]);
    const def = (c: [number, number][]) => ({
      orientation: "ltr" as const,
      coordinates: c,
      materials: [{ name: "Clay", unitWeight: 17, frictionAngle: 0, cohesion: 12 }],
    });
    const o = options({ bothDirections: true, minSlipDepth: 0.5 });
    const turned = runAnalysis(def(coordinates), o);
    const onSide = (p: [number, number]) => p[0] < -19.99 && p[1] < -0.01;
    expect(turned.allSurfaces.filter((s) => onSide(s.entryPoint) || onSide(s.exitPoint))).toHaveLength(0);
    expect(turned.minFOS).toBeCloseTo(runAnalysis(def(level), o).minFOS, 1);
  });

  it("no valid surface is an error", () => {
    const def = { ...problem("V001"), customSearchPlanes: [{ cx: 0, cy: 0, radius: 0.1 }], customPlanesOnly: true };
    expect(() => runAnalysis(def, options())).toThrow(/No valid slip surface/);
  });
});
