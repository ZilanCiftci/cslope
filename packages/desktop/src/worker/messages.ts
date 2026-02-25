/**
 * Worker message contracts for the analysis Web Worker.
 *
 * These DTOs define the request/response protocol between the main
 * thread and the analysis worker.
 */

import type {
  AnalysisOptions,
  AnalysisResult,
  SlopeDefinition,
  SlopeOrientation,
} from "@cslope/engine";

// Re-export SlopeDefinition so existing consumers can still import from here
export type { SlopeDefinition, SlopeOrientation };

/** Request message sent to the worker. */
export interface AnalysisRequest {
  type: "run-analysis";
  id: string;
  slope: SlopeDefinition;
  options: AnalysisOptions;
}

/** Response messages sent from the worker. */
export type AnalysisResponse =
  | {
      type: "analysis-complete";
      id: string;
      result: AnalysisResult;
    }
  | {
      type: "analysis-progress";
      id: string;
      /** Progress 0–1. */
      progress: number;
    }
  | {
      type: "analysis-error";
      id: string;
      error: string;
    };

/** Union of all worker messages. */
export type WorkerMessage = AnalysisRequest;
export type WorkerResponse = AnalysisResponse;
