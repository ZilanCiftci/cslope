/**
 * The finite element analysis as the app runs it: from a slope definition
 * and the analysis settings to a summary in model coordinates, as plain
 * arrays that pass through a worker message and a project file.
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly
 * (see facade/internal.ts): the app's FE analysis in one engine call, the
 * bounds' conic programs solved by Clarabel, linked into the engine.
 */
import { wasm } from "../facade/internal";
import type { SrmTrial } from "./srm";
import type { FemAnalysisSettings,FemResultSummary } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";

/**
 * A stage of the finite element analysis as it starts (progress only; the
 * trials and the bounds' levels report what it finds). Meshes count from 0;
 * `meshes` is the most there can be (the refinements stop earlier when the
 * result has converged). `davis`: the bounds with Davis B's reduced strength.
 */
export type FemStage =
  | { stage: "mesh" }
  | { stage: "strengthReduction"; mesh: number; meshes: number }
  | { stage: "upperBound" | "lowerBound"; mesh: number; meshes: number; davis: boolean };

export function runFemSummary(
  definition: SlopeDefinition,
  settings: FemAnalysisSettings,
  onTrial?: (trial: SrmTrial) => void,
  onStage?: (stage: FemStage) => void,
): FemResultSummary {
  return wasm().run_fem_summary(definition, settings, onTrial, onStage);
}

/**
 * The finite element analysis and, when the settings ask for them
 * (`limitAnalysis`), the lower and upper bounds of limit analysis, starting
 * on a mesh graded as the strength reduction's final mesh, BOUND_COARSENING
 * times coarser (the linear programs grow fast with the elements), and
 * refined where the gap between the bounds lies (bound-adapt.ts) within
 * BOUND_REFINEMENT_TIME_LIMIT; the upper bound's search starts at the
 * strength reduction factor. `solvers` gives the solvers' WebAssembly
 * binaries (an app), called only once the strength reduction is done. A failure of the bounds
 * leaves the strength reduction's result, with the reason in the bounds'
 * warnings.
 */
export async function runFemSummaryWithBounds(
  definition: SlopeDefinition,
  settings: FemAnalysisSettings,
  onTrial?: (trial: SrmTrial) => void,
  onStage?: (stage: FemStage) => void,
): Promise<FemResultSummary> {
  return wasm().run_fem_summary_with_bounds(definition, settings, onTrial, onStage);
}
