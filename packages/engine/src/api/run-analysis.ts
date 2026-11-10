/**
 * The product path of a limit equilibrium analysis: a definition and the
 * analysis options in, the AnalysisResult the app shows out (moved here
 * from the desktop worker, so that the app, Python and the verification
 * report share it; the Rust port is api/run_analysis.rs).
 *
 * - runAnalysis builds the slope, runs the search and assembles the
 *   result: the critical surface and its slices, every valid surface, the
 *   critical moments, the counts and warnings, and the 3D factor after
 *   SGI's guidance on request; with `bothDirections` the opposite sliding
 *   direction too, reporting the lower factor. The result is in model
 *   coordinates (the definition is the canonical one).
 * - runAnalysisAsync does the same with each search run by `analyse` (a
 *   pool of evaluators, src/parallel), which gives the same result.
 *
 * Finite elements are not part of it (the worker adds them).
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts): runAnalysis
 * is the engine's (api/run_analysis.rs); runAnalysisAsync runs each search
 * with the caller's `analyse` (a pool of evaluators) and assembles the
 * result in the engine, around the same orchestration as TypeScript's.
 */
import type { AnalysisOptions, AnalysisResult } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import type { SearchPlane, Slope } from "../model/slope";
import { wasm } from "../facade/internal";
import { buildSlope } from "../model/build-slope";
import { mapAnalysisResultToModelSpace, oppositeDirectionDefinition, resolveOrientation } from "../model/canonical";
import { h } from "../facade/wire";

export interface RunAnalysisHooks {
  /** Called after each batch of trial surfaces with the number evaluated so far (in this direction). */
  onProgress?: (surfacesEvaluated: number) => void;
}

/** Runs the search of an analysis slope; returns the minimum FOS (analyseSlope). */
export type AnalyseHook = (slope: Slope, def: SlopeDefinition, options: AnalysisOptions) => Promise<number | null>;

/**
 * Analysis of a canonical definition with the options, the result in
 * model coordinates (both directions when `options.bothDirections`, unless
 * only custom surfaces are analysed). `elapsedMs` is the time of the whole
 * run.
 */
export function runAnalysis(def: SlopeDefinition, options: AnalysisOptions, hooks: RunAnalysisHooks = {}): AnalysisResult {
  return wasm().run_analysis(def, options, hooks.onProgress) as AnalysisResult;
}

/** The slope of a definition with the analysis options, as an analysis builds it. */
function analysisSlope(def: SlopeDefinition, options: Partial<AnalysisOptions>): Slope {
  const slope = buildSlope(def);
  slope.updateAnalysisOptions(options);
  return slope;
}

/** analyse with the search run by `analyse`: the same result. */
async function analyseWith(def: SlopeDefinition, options: AnalysisOptions, run: AnalyseHook): Promise<AnalysisResult> {
  const start = performance.now();
  const slope = analysisSlope(def, options);
  return analysisResult(slope, await run(slope, def, options), options, start);
}

/** The lower FOS of the two directions, with the direction it slides in. */
function governingDirection(def: SlopeDefinition, ownResult: AnalysisResult, opposite: AnalysisResult | undefined): AnalysisResult {
  const own = resolveOrientation(def.orientation, def.coordinates);
  const ownGoverns = !opposite || ownResult.minFOS <= opposite.minFOS;
  const governing = ownGoverns ? ownResult : opposite;
  const other = ownGoverns ? opposite : ownResult;
  return {
    ...governing,
    slidingDirection: ownGoverns ? own : own === "ltr" ? "rtl" : "ltr",
    otherDirectionMinFOS: other ? other.minFOS : null,
    // The custom search planes are analysed in the model's own direction
    // (the opposite definition has none): their results stay.
    ...(ownResult.customSurfaces ? { customSurfaces: ownResult.customSurfaces } : {}),
  };
}

/** runAnalysis with each search run by `analyse` (e.g. EvaluatorPool.analyse): the same result. */
export async function runAnalysisAsync(def: SlopeDefinition, options: AnalysisOptions, analyse: AnalyseHook): Promise<AnalysisResult> {
  const start = performance.now();
  const both = options.bothDirections && !def.customPlanesOnly;
  let result: AnalysisResult;
  if (both) {
    const oppositeDef = oppositeDirectionDefinition(def);
    const ownResult = mapAnalysisResultToModelSpace(await analyseWith(def, options, analyse), def);
    let opposite: AnalysisResult | undefined;
    try {
      opposite = mapAnalysisResultToModelSpace(await analyseWith(oppositeDef, options, analyse), oppositeDef);
    } catch {
      opposite = undefined;
    }
    result = governingDirection(def, ownResult, opposite);
  } else {
    result = mapAnalysisResultToModelSpace(await analyseWith(def, options, analyse), def);
  }
  result.elapsedMs = performance.now() - start;
  return result;
}

/**
 * Points of a non-circular surface as drawn: from the crack bottom (when
 * cracked) to the exit.
 */
export function displayPoints(p: SearchPlane): [number, number][] | undefined {
  return (wasm().display_points({ ...p, slices: null }) as [number, number][] | null | undefined) ?? undefined;
}

/** The result of an analysed slope (canonical space). */
export function analysisResult(slope: Slope, minFOS: number | null, options: AnalysisOptions, start: number): AnalysisResult {
  return wasm().analysis_result(h(slope), minFOS ?? undefined, options, performance.now() - start) as AnalysisResult;
}
