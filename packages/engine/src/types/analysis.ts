/**
 * Analysis type definitions for slope stability analysis.
 */

import type { Material } from "./material";

/** Supported analysis methods. */
export type AnalysisMethod = "Bishop" | "Janbu" | "Morgenstern-Price";

/** Analysis configuration options. */
export interface AnalysisOptions {
  /** Number of slices (10–500, default: 25). */
  slices: number;
  /** Number of search iterations (500–100,000, default: 1000). */
  iterations: number;
  /** Extra second-pass refinement iterations around critical candidates (0–100,000). */
  refinedIterations: number;
  /** Minimum horizontal distance between entry and exit points (m). */
  minFailureDist: number;
  /** FOS convergence tolerance (default: 0.005). */
  tolerance: number;
  /** Max inner-loop FOS iterations (default: 15). */
  maxIterations: number;
  /** Analysis method. */
  method: AnalysisMethod;
  /** FOS limit for Bishop. */
  limitBishop: number;
  /** FOS limit for Janbu. */
  limitJanbu: number;
  /** FOS limit for Morgenstern-Price. */
  limitMorgensternPrice: number;
}

/** Default analysis options. */
export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  slices: 25,
  iterations: 1000,
  refinedIterations: 0,
  minFailureDist: 0,
  tolerance: 0.005,
  maxIterations: 15,
  method: "Bishop",
  limitBishop: 5,
  limitJanbu: 5,
  limitMorgensternPrice: 5,
};

/** Water table input — one of three modes. */
export type WaterTableInput =
  | { mode: "height"; height: number; followBoundary?: boolean }
  | { mode: "depth"; depth: number; followBoundary?: boolean }
  | {
      mode: "custom";
      coordinates: [number, number][];
      followBoundary?: boolean;
    };

/** Analysis limit bounds for search area. */
export interface AnalysisLimits {
  entryLeftX: number;
  entryRightX: number;
  exitLeftX: number;
  exitRightX: number;
}

/** A single slip surface with its computed FOS. */
export interface SlipSurfaceResult {
  /** Circle center x (m). */
  cx: number;
  /** Circle center y (m). */
  cy: number;
  /** Circle radius (m). */
  radius: number;
  /** Factor of Safety. */
  fos: number;
  /** Entry point [x, y]. */
  entryPoint: [number, number];
  /** Exit point [x, y]. */
  exitPoint: [number, number];
}

/** Slice data for detailed output. */
export interface SliceData {
  x: number;
  xLeft: number;
  xRight: number;
  width: number;
  yTop: number;
  yBottom: number;
  height: number;
  area: number;
  alpha: number;
  baseLength: number;
  weight: number;
  cohesion: number;
  frictionAngle: number;
  normalForce: number;
  porePressure: number;
  baseMaterial: Material;
}

/** Full analysis result. */
export interface AnalysisResult {
  /** Minimum Factor of Safety found. */
  minFOS: number;
  /** Maximum Factor of Safety found. */
  maxFOS: number;
  /** Critical slip surface (lowest FOS). */
  criticalSurface: SlipSurfaceResult | null;
  /** All evaluated slip surfaces. */
  allSurfaces: SlipSurfaceResult[];
  /** Slices for the critical surface. */
  criticalSlices: SliceData[];
  /** Analysis method used. */
  method: AnalysisMethod;
  /** Elapsed time in ms. */
  elapsedMs: number;
}
