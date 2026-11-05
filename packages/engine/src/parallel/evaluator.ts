/**
 * The evaluator side of a parallel search: builds each slope the
 * coordinator describes once, then evaluates the jobs sent for it.
 */

import type { AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import { buildSlope } from "../model/build-slope";
import type { Slope } from "../model/slope";
import { evaluatePlanes, setMorgensternPriceSolver } from "../model/solvers";
import { monteCarloSampler, type MonteCarloSampler, type RandomVariable } from "../model/reliability";
import { planeWithoutSlices, type EvaluatorEndpoint, type ToEvaluator } from "./protocol";

interface Context {
  def: SlopeDefinition;
  options: Partial<AnalysisOptions>;
  variables?: RandomVariable[];
  mpSolver: "iterative" | "march";
  slope?: Slope;
  sampler?: MonteCarloSampler;
}

/** The slope of a definition with the analysis options, as an analysis builds it. */
export function buildAnalysisSlope(def: SlopeDefinition, options: Partial<AnalysisOptions>): Slope {
  const slope = buildSlope(def);
  slope.updateAnalysisOptions(options);
  return slope;
}

/** Serves the jobs of one coordinator on `endpoint` until it detaches. */
export function serveEvaluator(endpoint: EvaluatorEndpoint): void {
  const contexts = new Map<number, Context>();
  const context = (key: number): Context => {
    const c = contexts.get(key);
    if (!c) throw new Error(`Evaluator: no context ${key}.`);
    setMorgensternPriceSolver(c.mpSolver);
    return c;
  };
  endpoint.listen((m: ToEvaluator) => {
    switch (m.type) {
      case "context":
        contexts.set(m.key, { def: m.def, options: m.options, variables: m.variables, mpSolver: m.mpSolver });
        return;
      case "drop-context":
        contexts.delete(m.key);
        return;
      case "detach":
        contexts.clear();
        endpoint.close?.();
        return;
      case "planes":
        try {
          const c = context(m.key);
          c.slope ??= buildAnalysisSlope(c.def, c.options);
          evaluatePlanes(c.slope, m.planes);
          endpoint.send({ type: "planes-done", job: m.job, planes: m.planes.map(planeWithoutSlices) });
        } catch (err) {
          endpoint.send({ type: "job-error", job: m.job, error: err instanceof Error ? err.message : String(err) });
        }
        return;
      case "samples":
        try {
          const c = context(m.key);
          c.sampler ??= monteCarloSampler(c.def, c.options, c.variables ?? []);
          const sampler = c.sampler;
          endpoint.send({ type: "samples-done", job: m.job, fos: m.values.map((v) => sampler(v)) });
        } catch (err) {
          endpoint.send({ type: "job-error", job: m.job, error: err instanceof Error ? err.message : String(err) });
        }
        return;
    }
  });
}
