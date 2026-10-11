/**
 * Analysis type definitions for slope stability analysis.
 */

import type { Material } from "./material";
import type { SlopeOrientation } from "../model/canonical";

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
  /**
   * Pore pressure head below an inclined piezometric line:
   * - "vertical" (default): full vertical head, as Slide and SLOPE/W use
   *   for a piezometric line.
   * - "phreatic-correction": vertical head × cos²θ of the line's
   *   inclination (equipotentials normal to a straight phreatic line).
   *   Gives lower pore pressure, i.e. a higher FOS, below a steep line.
   */
  porePressureHead?: PorePressureHead;
  /**
   * Depth of a tension crack below the ground surface (m, default 0 = none).
   * The slip surface ends at the crack on the upslope side and the soil
   * above the crack depth there carries no shear.
   */
  tensionCrackDepth?: number;
  /** Fraction of the crack depth filled with water (0–1, default 0). */
  tensionCrackWater?: number;
  /**
   * Tension crack depth from the soil at each surface's entry instead of
   * `tensionCrackDepth`: the Rankine depth z = 2c/(γ√Ka) − q/γ with
   * Ka = tan²(45° − φ/2), i.e. 2cu/γ − q/γ for undrained clay (default
   * false). Uses the same (design) strengths as the analysis.
   */
  tensionCrackAuto?: boolean;
  /**
   * Partial factors (Eurocode 7 design values). When set, strengths are
   * divided and variable loads multiplied by them, and the FOS is the
   * over-design factor on design values (≥ 1.0 satisfies the design).
   */
  partialFactors?: PartialFactors | null;
  /**
   * Also analyse sliding in the opposite direction and report the lower
   * FOS. Run by the application around `analyseSlope` (see
   * `oppositeDirectionDefinition`); the opposite run uses automatic search
   * limits, since the model's limits belong to its own direction.
   */
  bothDirections?: boolean;
  /**
   * After the circular search, optimise the best circles as non-circular
   * (polyline) surfaces, which can follow weak layers (default false).
   */
  nonCircularOptimization?: boolean;
  /**
   * Surfaces less deep than this below the ground (m, vertical) are not
   * analysed (default 0).
   */
  minSlipDepth?: number;
  /**
   * Surfaces whose sliding mass is smaller than this (m²) are not
   * analysed. Null or not set: automatic, 1 % of the squared ground
   * relief. 0: no limit.
   */
  minSlipArea?: number | null;
}

/** Partial factors applied to characteristic values. */
export interface PartialFactors {
  /** γcu on undrained shear strength. */
  cu: number;
  /** γc' on effective cohesion. */
  cohesion: number;
  /** γφ' on tan φ'. */
  tanPhi: number;
  /** γQ on variable loads (distributed and line loads). */
  variableLoad: number;
}

/** EN 1997-1 Annex A, material set M2 with γQ = 1.3 (Design Approach 3). */
export const EC7_DA3_FACTORS: PartialFactors = {
  cu: 1.4,
  cohesion: 1.25,
  tanPhi: 1.25,
  variableLoad: 1.3,
};

export type PorePressureHead = "phreatic-correction" | "vertical";

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
  porePressureHead: "vertical",
  tensionCrackDepth: 0,
  tensionCrackWater: 0,
  nonCircularOptimization: false,
  minSlipDepth: 0,
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
  /** Lambda-Fm-Ff-gap rows for this surface (Morgenstern-Price only). */
  lffArray?: [number, number, number, number][];
  /**
   * Non-circular surface: its points from entry to exit (then cx, cy is
   * the moment axis and radius 0). Absent for a circle.
   */
  points?: [number, number][];
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
  /** Soil weight of the slice (kN). */
  weight: number;
  /** UDL and line load acting on the slice (kN). */
  surfaceLoad?: number;
  cohesion: number;
  /** Friction angle at the base (degrees). */
  frictionAngle: number;
  /** Effective base normal force N' = (W + loads)·cos α − u·l (kN). */
  normalForce: number;
  /** Pore water pressure at the base (kPa). */
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
  /** Critical surface pushing moment used in FoS calculations. */
  criticalPushingMoment?: number;
  /** Critical surface resisting moment used in FoS calculations. */
  criticalResistingMoment?: number;
  /** Critical slip volume (2D area, i.e. volume per unit width). */
  criticalSlipVolume?: number;
  /** Elapsed time in ms. */
  elapsedMs: number;
  /** Number of analysed surfaces that did not converge within iteration limits. */
  nonConvergedSurfaces?: number;
  /** Number of geometry split operations that failed and fell back to unsplit. */
  splitFailureCount?: number;
  /**
   * Sliding direction of the reported surfaces in model space: "ltr" =
   * towards +x. Set when both directions were analysed.
   */
  slidingDirection?: SlopeOrientation;
  /** Minimum FOS in the other direction (null: no valid surface). */
  otherDirectionMinFOS?: number | null;
}
