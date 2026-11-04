/**
 * Analysis Web Worker.
 *
 * Reconstructs a Slope model from the serialized SlopeDefinition,
 * runs the full analysis, and returns structured results.
 *
 * The engine is WebAssembly: each request brings the module the main
 * thread compiled (`engine`), and the worker starts it on the first one
 * (ARCHITECTURE.md §3.2), without compiling it again.
 */

import type { AnalysisResponse, ReliabilityRequest, WorkerMessage } from "./messages";
import { runReliabilityRequest, runReliabilityRequestParallel } from "./reliability-run";
import type { AnalysisResult, ReliabilityResult } from "@cslope/engine";
import {
  runAnalysis,
  runAnalysisAsync,
  runFemSummary,
  runFemSummaryWithBounds,
  initEngineSync,
  EvaluatorPool,
  serveEvaluator,
  webEndpoint,
  type CoordinatorEndpoint,
  type EvaluatorEndpoint,
} from "@cslope/engine";

// ── Worker handler ──────────────────────────────────────────────

/**
 * The evaluators of a request, if it brought any: a pool that spreads the
 * trial surfaces over them (the result is the same as without).
 */
function evaluatorPool(ports: MessagePort[] | undefined): EvaluatorPool | null {
  if (!ports || ports.length === 0) return null;
  return new EvaluatorPool(ports.map((port) => webEndpoint(port) as CoordinatorEndpoint));
}

/** Handle incoming analysis requests. */
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  // the engine, compiled by the main thread (a no-op once started)
  if (event.data.engine) initEngineSync(event.data.engine);
  if (event.data.type === "serve-evaluator") {
    // This worker evaluates trial surfaces for an analysis worker.
    serveEvaluator(webEndpoint(event.data.port) as EvaluatorEndpoint);
    return;
  }
  if (event.data.type === "run-reliability") {
    await runReliability(event.data);
    return;
  }
  const { type, id, slope: slopeDef, options } = event.data;

  if (type !== "run-analysis") {
    const errorResponse: AnalysisResponse = {
      type: "analysis-error",
      id: id ?? "unknown",
      error: `Unknown message type: ${type}`,
    };
    self.postMessage(errorResponse);
    return;
  }

  const pool = evaluatorPool(event.data.evaluators);
  try {
    let result: AnalysisResult;
    if (pool) {
      // (awaited only with evaluators: without, the result is posted at once)
      try {
        result = await runAnalysisAsync(slopeDef, options, (slope, def, opts) => pool.analyse(slope, def, opts));
      } finally {
        pool.close();
      }
    } else {
      result = runAnalysis(slopeDef, options);
    }
    // Strength reduction by finite elements, in the model's own sliding direction.
    // A failure here keeps the limit equilibrium result and reports the error with it.
    if (options.fem?.enabled) {
      let trials = 0;
      try {
        const onTrial = () => {
          // No measure of the remaining work: report the trials as they pass.
          trials++;
          self.postMessage({ type: "analysis-progress", id, progress: Math.min(0.9, 0.3 + 0.03 * trials) } satisfies AnalysisResponse);
        };
        result.fem = options.fem.limitAnalysis
          ? await runFemSummaryWithBounds(slopeDef, options.fem, onTrial)
          : runFemSummary(slopeDef, options.fem, onTrial);
      } catch (err: unknown) {
        result.femError = err instanceof Error ? err.message : String(err);
      }
    }

    const completeResponse: AnalysisResponse = {
      type: "analysis-complete",
      id,
      result,
    };
    self.postMessage(completeResponse);
  } catch (err: unknown) {
    const errorResponse: AnalysisResponse = {
      type: "analysis-error",
      id,
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(errorResponse);
  }
};

/** Probabilistic analysis; the result's surface is in model coordinates. */
async function runReliability(req: ReliabilityRequest): Promise<void> {
  const onProgress = (progress: number) =>
    self.postMessage({ type: "analysis-progress", id: req.id, progress } satisfies AnalysisResponse);
  const pool = evaluatorPool(req.evaluators);
  try {
    let result: ReliabilityResult;
    if (pool) {
      try {
        result = await runReliabilityRequestParallel(req, pool, onProgress);
      } finally {
        pool.close();
      }
    } else {
      result = runReliabilityRequest(req, onProgress);
    }
    self.postMessage({ type: "reliability-complete", id: req.id, result } satisfies AnalysisResponse);
  } catch (err: unknown) {
    self.postMessage({
      type: "analysis-error",
      id: req.id,
      error: err instanceof Error ? err.message : String(err),
    } satisfies AnalysisResponse);
  }
}

export {}; // Ensure this is treated as a module
