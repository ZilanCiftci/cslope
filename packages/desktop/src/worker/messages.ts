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

/**
 * The engine's WebAssembly module, compiled by the main thread
 * (`engineModule()`): the worker starts the engine from it on its first
 * request. Optional only for tests that start the engine themselves.
 */
interface EngineCarrier {
  engine?: WebAssembly.Module;
}

/** Request message sent to the worker. */
export interface AnalysisRequest extends EngineCarrier {
  type: "run-analysis";
  id: string;
  slope: SlopeDefinition;
  options: AnalysisOptions;
  /**
   * The model in its own coordinates for the finite element analysis (which
   * turns it to canonical orientation itself); `slope` is canonical. Without
   * it the worker turns `slope` back (a model facing left is mirrored again).
   */
  femSlope?: SlopeDefinition;
  /** Ports to evaluator workers that evaluate trial surfaces for this run (transferred). */
  evaluators?: MessagePort[];
}

/** Probabilistic analysis of the model (its own sliding direction). */
export interface ReliabilityRequest extends EngineCarrier {
  type: "run-reliability";
  id: string;
  slope: SlopeDefinition;
  options: AnalysisOptions;
  variables: RandomVariable[];
  reliability: Omit<ReliabilityOptions, "onProgress">;
  /** Ports to evaluator workers (transferred), as for an analysis. */
  evaluators?: MessagePort[];
}

/**
 * Makes the worker an evaluator for the analysis worker at the other end
 * of `port` (transferred), until that one detaches.
 */
export interface EvaluatorRequest extends EngineCarrier {
  type: "serve-evaluator";
  port: MessagePort;
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
      /**
       * The limit equilibrium result of a run that goes on with the finite
       * element analysis (shown while that runs); "analysis-complete" follows
       * with the whole result.
       */
      type: "analysis-partial";
      id: string;
      result: AnalysisResult;
    }
  | {
      type: "analysis-progress";
      id: string;
      /** Progress 0–1. */
      progress: number;
      /** What the run is doing (the finite element analysis's stage and trials). */
      stage?: string;
    }
  | {
      type: "analysis-error";
      id: string;
      error: string;
    };

/** Union of all worker messages. */
export type WorkerMessage = AnalysisRequest | ReliabilityRequest | EvaluatorRequest;
export type WorkerResponse = AnalysisResponse;
