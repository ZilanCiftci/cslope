/**
 * Serialized slope definition DTO.
 *
 * This is the data-transfer shape used to pass a slope model between
 * the UI, the Web Worker, and the engine.
 */

import type { AnalysisLimits } from "./analysis";
import type { SlopeOrientation } from "../model/canonical";

/** Slope definition sent from the UI to the engine / worker. */
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
  /** User-specified circular search planes (cx, cy, radius). */
  customSearchPlanes?: Array<{ cx: number; cy: number; radius: number }>;
  /** When true, only analyse custom search planes (skip random search). */
  customPlanesOnly?: boolean;
}
