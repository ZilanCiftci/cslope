/**
 * A search spread over evaluators gives exactly the sequential result:
 * every plane (FOS, convergence, crack, interslice data, the order), the
 * critical slices and the number of surfaces evaluated, bit for bit, with
 * the chunks completing in shuffled order (test-pool.ts). The slower
 * searches (non-circular, block, Taylor series) are in
 * parallel-search.test.ts.
 */
import { describe, expect, it } from "vitest";
import type { AnalysisOptions } from "../types/analysis";
import type { FromEvaluator, CoordinatorEndpoint } from "./protocol";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import { analyseReliability, analyseReliabilityAsync } from "../model/reliability";
import { verificationOptions } from "../verification/cases";
import { RELIABILITY_CASES } from "../verification/reliability-cases";
import { buildAnalysisSlope } from "./evaluator";
import { EvaluatorPool } from "./pool";
import { applyEvaluatedPlane } from "./protocol";
import { expectSame, fakePool, parallel, problem, sameBits, sequential, SHORT } from "./test-pool";

describe("parallel evaluation gives the sequential result bit for bit", () => {
  const circular: [string, string, Partial<AnalysisOptions>][] = [
    ["V001", "Bishop", { method: "Bishop" }],
    ["V001", "Morgenstern-Price", { method: "Morgenstern-Price" }],
    ["V005", "Bishop, layered", { method: "Bishop" }],
    ["V020", "Morgenstern-Price, layered", { method: "Morgenstern-Price" }],
    ["V036a", "Spencer", { method: "Morgenstern-Price", intersliceFunction: "constant" }],
  ];
  for (const [id, label, options] of circular) {
    it(`circular search: ${id} ${label}`, async () => {
      const def = problem(id);
      const o = { ...verificationOptions(options.method!, options), ...SHORT };
      const seq = sequential(def, o);
      expect(seq.fos).not.toBeNull();
      for (const [n, seed] of [[1, 1], [3, 2]] as const) {
        const par = await parallel(def, o, n, seed);
        expectSame(seq, par);
        expect(par.sent.planes).toBeGreaterThan(0); // the evaluators had a share
      }
    });
  }

  it("reliability: Monte Carlo samples on the critical surface", async () => {
    const c = RELIABILITY_CASES.find((r) => r.id === "V021a")!;
    const def = toCanonicalSlopeDefinition(c.definition);
    const options = { ...verificationOptions("Bishop", c.options), ...SHORT };
    const ro = { method: "monte-carlo" as const, samples: 600, seed: 3 };
    const seqProgress: number[] = [];
    const seq = analyseReliability(def, options, c.variables, { ...ro, onProgress: (p) => seqProgress.push(p) });
    const { pool, sent } = fakePool(3, 13);
    const parProgress: number[] = [];
    const par = await analyseReliabilityAsync(def, options, c.variables, { ...ro, onProgress: (p) => parProgress.push(p) }, pool.reliabilityRunner());
    pool.close();
    expect(sameBits(seq, par)).toBeNull();
    expect(sent.samples).toBeGreaterThan(0);
    // progress rises to the end in both
    expect(seqProgress.at(-1)).toBe(1);
    expect(parProgress.at(-1)).toBe(1);
    for (let i = 1; i < parProgress.length; i++) expect(parProgress[i]).toBeGreaterThanOrEqual(parProgress[i - 1]);
  });

  it("an evaluated plane replaces the fields evaluation set or deleted, in place", () => {
    const target = { lc: [0, 0], rc: [1, 0], cx: 0, cy: 1, radius: 1, fos: null, slices: [], belowMinSize: true } as never;
    const evaluated = { lc: [0, 0], rc: [1, 0], cx: 0, cy: 1, radius: 1, fos: 1.5, slices: null, crack: [0.1, -0.1], converged: true } as never;
    applyEvaluatedPlane(target, evaluated);
    expect(target).toStrictEqual({ lc: [0, 0], rc: [1, 0], cx: 0, cy: 1, radius: 1, fos: 1.5, slices: null, crack: [0.1, -0.1], converged: true });
  });

  it("an evaluator's error fails the analysis, and a closed pool stops", async () => {
    const def = problem("V001");
    const o = { ...verificationOptions("Bishop"), ...SHORT };
    let handler: (m: FromEvaluator) => void = () => {};
    const broken: CoordinatorEndpoint = {
      send: (m) => {
        if (m.type === "planes") setTimeout(() => handler({ type: "job-error", job: m.job, error: "boom" }), 0);
      },
      listen: (h) => (handler = h),
    };
    const pool = new EvaluatorPool([broken]);
    await expect(pool.analyse(buildAnalysisSlope(def, o), def, o)).rejects.toThrow("boom");

    const silent: CoordinatorEndpoint = { send: () => {}, listen: () => {} };
    const stuck = new EvaluatorPool([silent], { local: false });
    const run = stuck.analyse(buildAnalysisSlope(def, o), def, o);
    setTimeout(() => stuck.close(), 5);
    await expect(run).rejects.toThrow("closed");
  });
});
