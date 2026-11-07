/**
 * The message protocol between the page and the analysis worker
 * (analysis.worker.ts): one request kind, four answers. The page's side is
 * `AnalysisClient` (client.ts).
 */
import type { AnalysisResult, ResultSummary, ValidationIssue } from "@cslope/engine";
import type { AnalysisDocument } from "./document";

/** Runs an analysis document; the answers carry its `id`. */
export interface RunRequest {
  type: "run";
  id: string;
  /**
   * The engine's WebAssembly module, compiled by the main thread
   * (engine-module.ts): the worker starts the engine from it on its first
   * request. Optional only for tests that start the engine themselves.
   */
  engine?: WebAssembly.Module;
  document: AnalysisDocument;
}

export type WorkerRequest = RunRequest;

export type WorkerResponse =
  | {
      /** The search goes on: trial surfaces evaluated so far. */
      type: "progress";
      id: string;
      surfaces: number;
    }
  | {
      /** The document has errors (`validateDefinition`); nothing ran. */
      type: "invalid";
      id: string;
      issues: ValidationIssue[];
    }
  | {
      type: "complete";
      id: string;
      /** In the document's own coordinates. */
      result: AnalysisResult;
      /** What F is, the method, the critical surface and the warnings (`summarizeResult`). */
      summary: ResultSummary;
      /** The document's warnings (`validateDefinition`), which did not stop the run. */
      warnings: ValidationIssue[];
    }
  | {
      type: "error";
      id: string;
      error: string;
    };
