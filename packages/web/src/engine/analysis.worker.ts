/**
 * The analysis worker: runs an analysis document with the engine, off the
 * page's thread, and answers with the result and its summary.
 *
 * The engine is WebAssembly: each request brings the module the main
 * thread compiled (`engine`), and the worker starts it on the first one
 * (as the app's worker, packages/desktop/src/worker/analysis.worker.ts),
 * without compiling it again. A run is synchronous in here, so the page
 * cancels one by ending the worker (client.ts).
 */
import {
  DEFAULT_ANALYSIS_OPTIONS,
  initEngineSync,
  publicDefaultOptions,
  runAnalysis,
  summarizeResult,
  toCanonicalSlopeDefinition,
  validateDefinition,
  type AnalysisOptions,
} from "@cslope/engine";
import type { WorkerRequest, WorkerResponse } from "./messages";

const post = (message: WorkerResponse) => self.postMessage(message);

/** The options of a run: the document's over the public defaults (D-23). */
export function analysisOptions(options: Partial<AnalysisOptions> | undefined): AnalysisOptions {
  return { ...DEFAULT_ANALYSIS_OPTIONS, ...publicDefaultOptions(), ...options };
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.engine) initEngineSync(message.engine);
  const id = message.id ?? "unknown";
  if (message.type !== "run") {
    post({ type: "error", id, error: `Unknown message type: ${String(message.type)}` });
    return;
  }
  try {
    const issues = validateDefinition(message.document);
    if (issues.some((i) => i.severity === "error")) {
      post({ type: "invalid", id, issues });
      return;
    }
    const { definition, options: given } = message.document;
    const options = analysisOptions(given);
    const result = runAnalysis(toCanonicalSlopeDefinition(definition), options, {
      onProgress: (surfaces) => post({ type: "progress", id, surfaces }),
    });
    post({ type: "complete", id, result, summary: summarizeResult(result, options), warnings: issues });
  } catch (err: unknown) {
    post({ type: "error", id, error: err instanceof Error ? err.message : String(err) });
  }
};

// A request that could not be read (it did not survive the structured
// clone): the page learns it at once instead of waiting for an answer.
self.onmessageerror = () => post({ type: "error", id: "unknown", error: "The analysis worker could not read the request." });
