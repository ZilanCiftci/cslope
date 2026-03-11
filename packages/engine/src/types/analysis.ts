/**
 * Analysis type definitions for slope stability analysis.
 */

import type { Material } from "./material";

/** Supported analysis methods. */
export type AnalysisMethod = "Bishop" | "Janbu" | "Morgenstern-Price";

/** Supported interslice force functions for Morgenstern-Price. */
export type IntersliceFunctionType =
  | "constant"
  | "half-sine"
  | "clipped-sine"
  | "trapezoidal"
  | "data-point-specified";

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
  /** Apply Janbu correction factor f₀ (default: false). */
  janbuCorrection?: boolean;
  /** Interslice force function shape for Morgenstern-Price. */
  intersliceFunction?: IntersliceFunctionType;
  /** Normalized [x, f] points in [0,1]×[0,1] for data-point-specified mode. */
  intersliceDataPoints?: [number, number][];
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
  janbuCorrection: false,
  intersliceFunction: "half-sine",
  intersliceDataPoints: [],
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
  /** Whether iterative solver converged for this surface. */
  converged?: boolean;
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
  /** Lambda-Fm-Ff data for the critical surface (Morgenstern-Price only). */
  criticalLffArray?: [number, number, number, number][];
  /** Elapsed time in ms. */
  elapsedMs: number;
  /** Number of analysed surfaces that did not converge within iteration limits. */
  nonConvergedSurfaces?: number;
  /** Number of geometry split operations that failed and fell back to unsplit. */
  splitFailureCount?: number;
}
