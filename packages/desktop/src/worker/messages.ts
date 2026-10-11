/**
 * Worker message contracts for the analysis Web Worker.
 *
 * These DTOs define the request/response protocol between the main
 * thread and the analysis worker.
 */

import type {
  AnalysisOptions,
  AnalysisResult,
  RandomVariable,
  ReliabilityOptions,
  ReliabilityResult,
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

/** Probabilistic analysis of the model (its own sliding direction). */
export interface ReliabilityRequest {
  type: "run-reliability";
  id: string;
  slope: SlopeDefinition;
  options: AnalysisOptions;
  variables: RandomVariable[];
  reliability: Omit<ReliabilityOptions, "onProgress">;
}

/** Response messages sent from the worker. */
export type AnalysisResponse =
  | {
      type: "analysis-complete";
      id: string;
      result: AnalysisResult;
    }
  | {
      type: "reliability-complete";
      id: string;
      /** Critical surface in model coordinates. */
      result: ReliabilityResult;
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
export type WorkerMessage = AnalysisRequest | ReliabilityRequest;
export type WorkerResponse = AnalysisResponse;
