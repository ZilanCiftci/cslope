/**
 * Probabilistic (reliability) analysis.
 *
 * Material parameters are random variables (mean = the model value,
 * standard deviation given). Two methods:
 *
 * - Taylor series (TSPM, Duncan 2000; US Army Corps of Engineers): F at the
 *   most likely values and at mean ± σ of each variable in turn;
 *   σF = √Σ(ΔFᵢ/2)² (with correlation terms), COV = σF/F, lognormal
 *   reliability index β = ln(F/√(1+COV²))/√ln(1+COV²) and Pf = Φ(−β). The
 *   critical surface can be searched again for every evaluation.
 * - Monte Carlo on the critical surface at the mean values (commonly
 *   called the "Global Minimum" method; its "Overall Slope" method repeats the search
 *   for every sample, which is not done here): sampled parameters (normal
 *   or lognormal, truncated, optionally correlated), Pf = share of samples
 *   with F < 1.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts). The
 * asynchronous driver runs the engine's reliability steps: the slope of an
 * analysis step is handed to the runner as a `Slope` (the engine takes it
 * back on the next step), a samples step's sampler evaluates in the engine.
 */
import { engineEpoch } from "../engine";
import type { AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import { type Slope as TsSlope, Slope } from "./slope";
import { shareUnchanged, wasm } from "../facade/internal";

export interface RandomVariable {
  /** Index of the material in the definition's materials. */
  material: number;
  /** Field of the material model, e.g. "cohesion", "frictionAngle", "unitWeight", "undrainedShearStrength". */
  field: string;
  /** Standard deviation (same unit as the field). */
  sd: number;
  /** Default "normal". */
  distribution?: "normal" | "lognormal";
  /** Truncation of sampled values (Monte Carlo). Default: ≥ 0 for strength and unit weight, φ < 90°. */
  min?: number;
  max?: number;
}

export interface ReliabilityOptions {
  method: "taylor" | "monte-carlo";
  /** Taylor series: search the critical surface again for each evaluation. Default true. */
  search?: boolean;
  /** Monte Carlo: number of samples (default 1000) and random seed (default 1). */
  samples?: number;
  seed?: number;
  /** Correlation coefficients between variables (indices into the list). */
  correlations?: { a: number; b: number; rho: number }[];
  /** Called with the progress 0–1. */
  onProgress?: (progress: number) => void;
}

export interface TaylorTerm {
  variable: number;
  mean: number;
  sd: number;
  /** F with the variable at mean + σ and mean − σ. */
  fPlus: number;
  fMinus: number;
}

export interface CriticalSurface {
  cx: number;
  cy: number;
  radius: number;
  lc: [number, number];
  rc: [number, number];
  points?: [number, number][];
}

export interface ReliabilityResult {
  method: "taylor" | "monte-carlo";
  /** F at the most likely (mean) values. */
  fos: number;
  /** Mean and standard deviation of F (Taylor: F at the means and σF). */
  meanFOS: number;
  sdFOS: number;
  cov: number;
  /** Lognormal reliability index and its probability of failure Φ(−β). */
  betaLognormal: number;
  pfLognormal: number;
  /** Normal reliability index (μF − 1)/σF. */
  betaNormal: number;
  /** Monte Carlo: share of samples with F < 1. */
  pf?: number;
  /** Monte Carlo: the sampled F (failed evaluations left out). */
  samples?: number[];
  /** Taylor series: F at mean ± σ of each variable. */
  terms?: TaylorTerm[];
  /** Critical surface at the mean values (canonical coordinates). */
  surface: CriticalSurface;
  /** Evaluations without a FOS. */
  failed: number;
}

/**
 * What the reliability analysis asks of its driver (analyseReliability
 * runs them in turn; analyseReliabilityAsync may spread them over workers):
 * - "analyse": a full analysis of `slope` (built from `def` and `options`),
 *   in place, as analyseSlope;
 * - "samples": F of each set of values by `sampler` (null when it has
 *   none), in order; `progress` takes the number done.
 */
export type ReliabilityStep =
  | { kind: "analyse"; slope: Slope; def: SlopeDefinition; options: Partial<AnalysisOptions> }
  | {
      kind: "samples";
      /** The definition with only the critical surface (the sampler's). */
      def: SlopeDefinition;
      options: Partial<AnalysisOptions>;
      variables: RandomVariable[];
      values: number[][];
      sampler: MonteCarloSampler;
      progress: (done: number) => void;
    };

/** F of the slope with the variables at the given values, null when there is none. */
export type MonteCarloSampler = (values: number[]) => number | null;

/** How analyseReliabilityAsync runs the steps (e.g. on a pool of workers). */
export interface ReliabilityRunner {
  /** Analyse the slope in place, as analyseSlope. */
  analyse(step: Extract<ReliabilityStep, { kind: "analyse" }>): Promise<void>;
  /** F of each set of values, in order (null where there is none). */
  samples(step: Extract<ReliabilityStep, { kind: "samples" }>): Promise<(number | null)[]>;
}

const samplers = new FinalizationRegistry<{ handle: number; epoch: number }>((s) => {
  if (s.epoch === engineEpoch()) wasm().monte_carlo_sampler_free(s.handle);
});

/** Standard normal cumulative distribution (Abramowitz & Stegun 26.2.17). */
export function normalCdf(x: number): number {
  return wasm().normal_cdf(x);
}

/** Lognormal reliability index of a factor of safety with mean F and coefficient of variation COV. */
export function lognormalBeta(F: number, cov: number): number {
  return wasm().lognormal_beta(F, cov);
}

/**
 * The Monte Carlo sampler of a definition with only the critical surface
 * (onSurface): the slope is built once and only the materials change.
 */
export function monteCarloSampler(surfaceDef: SlopeDefinition, options: Partial<AnalysisOptions>, variables: RandomVariable[]): MonteCarloSampler {
  const handle = wasm().monte_carlo_sampler_new(surfaceDef, options, variables) as number;
  const sampler: MonteCarloSampler = (values) => (wasm().monte_carlo_sample(handle, Float64Array.from(values)) as number | undefined) ?? null;
  samplers.register(sampler, { handle, epoch: engineEpoch() });
  return sampler;
}

function withoutCallback(ro: ReliabilityOptions): Omit<ReliabilityOptions, "onProgress"> {
  const rest: ReliabilityOptions = { ...ro };
  delete rest.onProgress;
  return rest;
}

/**
 * Reliability of a slope (canonical definition, analysis options as for
 * a normal run) for the given random variables.
 */
export function analyseReliability(
  def: SlopeDefinition,
  options: Partial<AnalysisOptions>,
  variables: RandomVariable[],
  ro: ReliabilityOptions,
): ReliabilityResult {
  return wasm().analyse_reliability(def, options, variables, withoutCallback(ro), ro.onProgress) as ReliabilityResult;
}

type StepOut =
  | { kind: "done"; progress?: number; result: ReliabilityResult }
  | { kind: "analyse"; progress?: number; slope: number; def: SlopeDefinition }
  | { kind: "samples"; progress?: number; values: number[][]; def: SlopeDefinition; count: number };

/** analyseReliability with the analyses and samples run by `runner`; the same result. */
export async function analyseReliabilityAsync(
  def: SlopeDefinition,
  options: Partial<AnalysisOptions>,
  variables: RandomVariable[],
  ro: ReliabilityOptions,
  runner: ReliabilityRunner,
): Promise<ReliabilityResult> {
  const steps = wasm().reliability_steps_new(def, options, variables, withoutCallback(ro)) as number;
  try {
    let factors: (number | null)[] | undefined;
    for (;;) {
      const r = wasm().reliability_steps_resume(steps, factors) as StepOut;
      factors = undefined;
      if (r.progress !== undefined) ro.onProgress?.(r.progress);
      if (r.kind === "done") return r.result;
      if (r.kind === "analyse") {
        const slope = Slope._wrap(r.slope) as unknown as TsSlope;
        await runner.analyse({ kind: "analyse", slope, def: r.def, options });
      } else {
        const n = r.count;
        factors = await runner.samples({
          kind: "samples",
          def: r.def,
          options,
          variables,
          values: r.values,
          sampler: (values) => (wasm().reliability_steps_sample(steps, Float64Array.from(values)) as number | undefined) ?? null,
          progress: (done) => ro.onProgress?.(done / n),
        });
      }
    }
  } finally {
    wasm().reliability_steps_free(steps);
  }
}

/**
 * The critical surface of a result in model coordinates. `def` is the
 * model definition whose canonical form was analysed (a right-to-left
 * model is mirrored back).
 */
export function reliabilitySurfaceToModelSpace(surface: CriticalSurface, def: SlopeDefinition): CriticalSurface {
  // (TypeScript gives a left-to-right model's surface back itself)
  const out = wasm().reliability_surface_to_model_space(surface, def) as CriticalSurface;
  return shareUnchanged(surface, out, true);
}
