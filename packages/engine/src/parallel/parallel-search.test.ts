/**
 * Parallel evaluation of the slower searches gives exactly the sequential
 * result (see parallel.test.ts): the non-circular optimisation (its seeds
 * in lockstep, each round's shifts as one batch), the block search and a
 * Taylor series that searches again for every evaluation.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import { analyseReliability, analyseReliabilityAsync, type RandomVariable } from "../model/reliability";
import { verificationOptions } from "../verification/cases";
import { expectSame, fakePool, parallel, problem, sameBits, sequential, SHORT } from "./test-pool";

const spencer = (extra: Partial<AnalysisOptions> = {}) => ({
  ...verificationOptions("Morgenstern-Price", { intersliceFunction: "constant", nonCircularOptimization: true, ...extra }),
  ...SHORT,
});

describe("parallel evaluation of the slower searches gives the sequential result bit for bit", () => {
  it("non-circular optimisation (V050b, Spencer, with seeds along the weak layer)", async () => {
    const def = problem("V050b");
    const o = spencer();
    const seq = sequential(def, o);
    expect(seq.slope.search.some((p) => p.points)).toBe(true);
    expectSame(seq, await parallel(def, o, 3, 7));
  });

  it("non-circular optimisation with the coordinator only coordinating (V001, Spencer)", async () => {
    const def = problem("V001");
    const o = spencer();
    const seq = sequential(def, o);
    const par = await parallel(def, o, 2, 11, { local: false });
    expectSame(seq, par);
    expect(par.sent.planes).toBe(seq.evaluated);
  });

  it("block search, also with the optimisation of the best blocks", async () => {
    const mc = (name: string, c: number, phi: number) => ({ name, model: { kind: "mohr-coulomb", unitWeight: 18.84, cohesion: c, frictionAngle: phi } });
    // ACADS 3(a) as in block-search.test.ts, two lines along the weak layer
    const def = toCanonicalSlopeDefinition({
      coordinates: [[20, 20], [20, 27.75], [43, 27.75], [67.5, 40], [84, 40], [84, 20]],
      materials: [mc("Soil 1", 28.5, 20), mc("Weak layer", 0, 10), mc("Soil 1 below", 28.5, 20)],
      materialBoundaries: [
        { coordinates: [[19, 27], [85, 27]], materialName: "" },
        { coordinates: [[19, 26.5], [85, 26.5]], materialName: "" },
      ],
      regionAssignments: [
        { point: [20.64, 27.05], materialName: "Soil 1" },
        { point: [20.64, 26.75], materialName: "Weak layer" },
        { point: [20.64, 23.25], materialName: "Soil 1 below" },
      ],
      orientation: "rtl",
      waterTable: { mode: "custom", value: [[20, 26.5], [84, 26.5]] },
      blockSearchObjects: [{ points: [[25, 26.75], [50, 26.75]] }, { points: [[50, 26.75], [80, 26.75]] }],
    } as unknown as SlopeDefinition);
    const o: Partial<AnalysisOptions> = {
      method: "Morgenstern-Price",
      intersliceFunction: "constant",
      slices: 40,
      tolerance: 0.001,
      iterations: 500,
      refinedIterations: 300,
      searchMethod: "block",
    };
    for (const options of [o, { ...o, nonCircularOptimization: true }]) {
      const seq = sequential(def, options);
      expect(seq.fos).not.toBeNull();
      expectSame(seq, await parallel(def, options, 3, 5));
    }
  });

  it("reliability: a Taylor series searching again for each evaluation", async () => {
    const def = problem("V001");
    const options = { ...verificationOptions("Bishop"), ...SHORT };
    const variables: RandomVariable[] = [
      { material: 0, field: "cohesion", sd: 6 },
      { material: 0, field: "frictionAngle", sd: 2 },
    ];
    const ro = { method: "taylor" as const, search: true, correlations: [{ a: 0, b: 1, rho: -0.3 }] };
    const seq = analyseReliability(def, options, variables, ro);
    const { pool, sent } = fakePool(3, 17);
    const par = await analyseReliabilityAsync(def, options, variables, ro, pool.reliabilityRunner());
    pool.close();
    expect(sameBits(seq, par)).toBeNull();
    expect(sent.planes).toBeGreaterThan(0);
  });
});
