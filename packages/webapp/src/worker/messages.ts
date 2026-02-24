/**
 * Worker message contracts for the analysis Web Worker.
 *
 * These DTOs define the request/response protocol between the main
 * thread and the analysis worker.
 */

import type {
  AnalysisOptions,
  AnalysisResult,
  AnalysisLimits,
} from "../engine/types/index";
import type { SlopeOrientation } from "../engine/model/canonical";

/** Slope definition sent from the UI to the worker. */
export interface SlopeDefinition {
  /** Model orientation used for canonical mirroring. */
  orientation?: SlopeOrientation;
  /** Boundary coordinates [[x,y], ...]. */
  coordinates: [number, number][];
  /** Material assignments. */
  materials: Array<{
    name: string;
    unitWeight: number;
    frictionAngle: number;
    cohesion: number;
    cohesionRefDepth?: number;
    cohesionRateOfChange?: number;
    cohesionUndrained?: number;
    materialType?: string;
    /** Depth range [top, bottom] in m for this material. */
    depthRange?: [number, number];
    color?: string;
  }>;
  /** Water table definition (optional). */
  waterTable?: {
    mode: "height" | "depth" | "custom";
    value: number | [number, number][];
    followBoundary?: boolean;
  };
  /** UDL loads. */
  udls?: Array<{ magnitude: number; x1: number; x2: number }>;
  /** Line loads (point loads). */
  lineLoads?: Array<{ magnitude: number; x: number }>;
  /** Material boundary polylines that divide the slope into layers. */
  materialBoundaries?: Array<{
    coordinates: [number, number][];
    materialName: string;
  }>;
  /** Material name for the top region (above all boundaries).
   *  Only needed when it differs from the first (default) material. */
  topRegionMaterialName?: string;
  /** Search area limits for entry/exit ranges. */
  analysisLimits?: AnalysisLimits;
}

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
