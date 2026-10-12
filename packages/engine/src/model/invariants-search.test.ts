/**
 * Invariants of the critical-surface search: the reported critical surface
 * re-analysed on its own gives the reported FOS (circles and optimised
 * polylines), the search never reports more than a surface it contains,
 * and a mirrored model finds the mirrored minimum.
 */
import { describe, it, expect } from "vitest";
import type { SlopeDefinition } from "../types/slope-definition";
import type { AnalysisOptions } from "../types/analysis";
import { toCanonicalSlopeDefinition, mapAnalysisResultToModelSpace } from "./canonical";
import { buildSlope } from "./build-slope";
import { analyseSlope } from "./solvers";
import { rng, randomCase, onCircle, onPolyline, fosOf, mirrorDefinition, relDiff, PROPERTY_OPTIONS, type Method } from "./property-helpers";
import type { AnalysisResult } from "../types/analysis";

const SEARCH: Partial<AnalysisOptions> = { ...PROPERTY_OPTIONS, slices: 25, iterations: 200, refinedIterations: 40 };

function search(def: SlopeDefinition, method: Method, extra: Partial<AnalysisOptions> = {}) {
  const slope = buildSlope(toCanonicalSlopeDefinition(def));
  slope.updateAnalysisOptions({ ...SEARCH, ...extra, method: method === "Ordinary" ? "Bishop" : method });
  const fos = analyseSlope(slope);
  return { fos, slope, best: slope.search[0] };
}

describe("critical-surface search", () => {
  it("the critical circle re-analysed alone gives the reported FOS; a custom circle bounds the minimum", () => {
    const r = rng(4040);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r, { water: i % 2 === 1 });
      const def = { ...g.def, udls: i % 3 === 0 ? [{ magnitude: 15, x1: 1, x2: g.shape.crest - 1 }] : undefined };
      for (const method of ["Bishop", "Morgenstern-Price"] as Method[]) {
        const { fos, best } = search({ ...def, customSearchPlanes: [g.circle] }, method);
        expect(fos, `seed 4040 case ${i} ${method}`).not.toBeNull();
        const again = fosOf(onCircle(def, best), method, { slices: 25 });
        expect(relDiff(again!, fos!), `seed 4040 case ${i} ${method}: ${again} vs ${fos}`).toBeLessThan(1e-6);
        const custom = fosOf(onCircle(def, g.circle), method, { slices: 25 });
        if (custom !== null) expect(fos!).toBeLessThanOrEqual(custom * (1 + 1e-9));
      }
    }
  }, 60_000);

  it("an optimised non-circular surface re-analysed about its axis gives the reported FOS", () => {
    const r = rng(4041);
    for (let i = 0; i < 2; i++) {
      const g = randomCase(r, { layers: 2 });
      const { fos, best } = search(g.def, "Morgenstern-Price", { nonCircularOptimization: true });
      expect(fos).not.toBeNull();
      if (!best.points) continue;
      const again = fosOf(onPolyline(g.def, best.points, [best.cx, best.cy]), "Morgenstern-Price", { slices: 25 });
      expect(relDiff(again!, fos!), `seed 4041 case ${i}: ${again} vs ${fos}`).toBeLessThan(1e-4);
    }
  }, 60_000);

  it("a mirrored model finds the mirrored minimum", () => {
    const r = rng(4042);
    for (let i = 0; i < 4; i++) {
      const g = randomCase(r);
      const xMax = Math.max(...g.def.coordinates.map((c) => c[0]));
      // Mirror onto the same domain: the canonical model is the original one.
      const mirrored = mirrorDefinition(g.def, xMax / 2);
      for (const method of ["Bishop", "Janbu"] as Method[]) {
        const a = search(g.def, method);
        const b = search(mirrored, method);
        // The search is chaotic in the last bits (many near-equal
        // surfaces), so allow a small difference.
        expect(relDiff(a.fos!, b.fos!), `seed 4042 case ${i} ${method}: ${a.fos} vs ${b.fos}`).toBeLessThan(5e-3);
        // The critical surface maps back to the mirror image of a surface
        // of the original model with that FOS.
        const canonical = toCanonicalSlopeDefinition(mirrored);
        const result = {
          minFOS: b.fos!,
          maxFOS: b.fos!,
          criticalSurface: {
            cx: b.best.cx,
            cy: b.best.cy,
            radius: b.best.radius,
            fos: b.fos!,
            entryPoint: b.best.lc,
            exitPoint: b.best.rc,
          },
          allSurfaces: [],
          criticalSlices: [],
          method: method as AnalysisResult["method"],
          elapsedMs: 0,
        } satisfies AnalysisResult;
        const mapped = mapAnalysisResultToModelSpace(result, canonical).criticalSurface!;
        expect(mapped.cx).toBeCloseTo(xMax - b.best.cx, 9);
        expect(mapped.entryPoint[0]).toBeGreaterThan(mapped.exitPoint[0]);
        const back = fosOf(onCircle(mirrored, { cx: mapped.cx, cy: mapped.cy, radius: mapped.radius }), method, { slices: 25 });
        expect(relDiff(back!, b.fos!), `case ${i} ${method} mapped`).toBeLessThan(1e-6);
      }
    }
  }, 60_000);
});
