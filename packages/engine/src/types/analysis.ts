/**
 * Analysis type definitions for slope stability analysis.
 */

import type { Material } from "./material";
import type { SlopeOrientation } from "../model/canonical";
import type { ReinforcementForce } from "./reinforcement";

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
  /**
   * Number of search iterations (500–100,000, default: 1000). The grid of
   * entry/exit pairs and circles is sized by it; the circles tangent to the
   * model base and to each material interface come on top, so a layered
   * model evaluates more surfaces than this.
   */
  iterations: number;
  /** Extra second-pass refinement iterations around critical candidates (0–100,000, default: 500). */
  refinedIterations: number;
  /** Minimum horizontal distance between entry and exit points (m). */
  minFailureDist: number;
  /** FOS convergence tolerance (default: 0.001). */
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
   * - "vertical" (default): full vertical head, as commercial programs
   *   use for a piezometric line.
   * - "phreatic-correction": vertical head × cos²θ of the line's
   *   inclination (equipotentials normal to a straight phreatic line).
   *   Gives lower pore pressure, i.e. a higher FOS, below a steep line.
   *   The correction belongs to a free phreatic surface with seepage
   *   parallel to it, not to a piezometric line, and the option applies to
   *   every water line of the model. A vertical step in a line (a wall or
   *   a sheet pile) gets no correction.
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
   * How trial surfaces are generated (default "circular"):
   * - "circular": the grid of circles through entry and exit points.
   * - "block": block surfaces through the model's block search objects
   *   (`SlopeDefinition.blockSearchObjects`), `iterations` of them, then
   *   `refinedIterations` around the best; with `nonCircularOptimization`
   *   the best are optimised as polylines.
   */
  searchMethod?: SearchMethod;
  /**
   * Block search: range [min, max] (°, from the horizontal) of the
   * inclination of the upslope (active) end segment. Null or not set:
   * the Rankine active angle 45° + φ/2 of the soil above the first base
   * point.
   */
  blockActiveAngle?: [number, number] | null;
  /**
   * Block search: range [min, max] (°, from the horizontal) of the
   * inclination of the downslope (passive) end segment. Null or not set:
   * the Rankine passive angle 45° − φ/2 of the soil above the last base
   * point.
   */
  blockPassiveAngle?: [number, number] | null;
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
  /** Strength reduction by finite elements after the limit equilibrium analysis. */
  fem?: FemAnalysisSettings;
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

export type SearchMethod = "circular" | "block";

/** Default analysis options. */
export const DEFAULT_ANALYSIS_OPTIONS: AnalysisOptions = {
  slices: 25,
  iterations: 1000,
  // As in the desktop app: without refinement the minimum of the first
  // grid is 0.5–4 % too high.
  refinedIterations: 500,
  minFailureDist: 0,
  // Morgenstern-Price accepts |Fm − Ff| below it: at 0.005 the factor on a
  // fixed non-circular surface was up to 0.2 % off the solution, at 0.001
  // within 0.02 %, for a search 0–25 % slower.
  tolerance: 0.001,
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
  /**
   * Whether the solver converged for this surface (for Morgenstern-Price:
   * a crossing Fm = Ff; false for a closest pair, see `closestPair`).
   */
  converged?: boolean;
  /**
   * Morgenstern-Price: the moment and force factors never met and the
   * closest pair was accepted (gap in `equilibriumGap`). The factor meets
   * moment equilibrium and force equilibrium only within the gap; the
   * surface is not converged but keeps its factor.
   */
  closestPair?: boolean;
  /** Lambda-Fm-Ff-gap rows for this surface (Morgenstern-Price only). */
  lffArray?: [number, number, number, number][];
  /**
   * Morgenstern-Price: |Fm − Ff| where the moment and force equilibrium
   * curves never crossed and the closest pair was accepted (no
   * complete-equilibrium solution exists on this surface). Absent when
   * they crossed.
   */
  equilibriumGap?: number;
  /**
   * Non-circular surface: its points from entry to exit (then cx, cy is
   * the moment axis and radius 0). Absent for a circle.
   */
  points?: [number, number][];
  /** Reinforcement forces on the sliding mass (critical surface only). */
  reinforcementForces?: ReinforcementForce[];
  /**
   * The tension crack the analysis cut the surface off at (critical
   * surface only): its x, the ground level there (`top`) and the crack
   * bottom on the surface (`bottom`, = entryPoint's y). Absent without a
   * crack.
   */
  crack?: { x: number; top: number; bottom: number };
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
  /** Effective base normal force N′ = N − u·l (kN) from the method's equilibrium at the FOS (solvedEffectiveNormals). */
  normalForce: number;
  /** Pore water pressure at the base (kPa). */
  porePressure: number;
  baseMaterial: Material;
}

/** Kind of a result warning (see analysisWarnings). */
export type AnalysisWarningCode =
  | "dangling-boundary"
  | "negative-effective-normal"
  | "low-m-alpha"
  | "bishop-non-circular"
  | "frictional-surface-slide";

/**
 * Something about the input or the critical surface that the factor of
 * safety alone does not show, in English for display.
 */
export interface AnalysisWarning {
  code: AnalysisWarningCode;
  message: string;
  /** Slices of the critical surface concerned (the slice warnings). */
  count?: number;
  /** Index into materialBoundaries (dangling-boundary). */
  boundaryIndex?: number;
}

/**
 * Strength reduction by finite elements, run after the limit equilibrium
 * analysis when enabled (src/fem). Stiffness barely affects the factor of
 * safety; it scales the displacements.
 */
export interface FemAnalysisSettings {
  enabled: boolean;
  /** Davis B (default), associated, or non-associated with the dilation angle. */
  flowRule: "davis-b" | "associated" | "non-associated";
  /** Young's modulus E (kPa) of every soil. */
  youngsModulus: number;
  /** Poisson's ratio ν of every soil. */
  poissonsRatio: number;
  /** Dilation angle ψ (°), used by Davis B and non-associated flow. */
  dilationAngle: number;
  /** Initial element size (m); null: a twentieth of the model height. */
  elementSize: number | null;
  /**
   * Rankine tension cut-off at zero effective stress; default on for new
   * projects (soil carries no tension, the usual default of finite element
   * programs; it brought cSlope closer to a commercial program's verification
   * values, RMS 4.6 % to 3.0 %).
   */
  tensionCutoff: boolean;
  /**
   * Adaptive refinements of the mesh (0–3), for associated flow and Davis B.
   * Not with non-associated flow: its factor has no limit as the mesh is
   * refined (it falls on every refinement, Sysala et al. 2021), so it is
   * computed on the initial mesh only.
   */
  refinementLevels: number;
  /**
   * Pore pressures: hydrostatic below the water table ("water-table"), or
   * from steady seepage with the water table as reservoir and tail water
   * where it lies at or above the ground ("seepage"). Not set: water table.
   */
  porePressure?: "water-table" | "seepage";
  /**
   * Solver of non-associated flow: the viscoplastic iteration of Griffiths
   * & Lane ("viscoplastic", default) or Newton's method with the
   * unsymmetric consistent tangent, F raised in increments ("newton", the
   * implicit method of most finite element programs; similar F, usually
   * slower). Not set: viscoplastic.
   */
  nonAssociatedSolver?: "viscoplastic" | "newton";
  /**
   * Convergence test of the viscoplastic iteration: the displacement
   * increment ("increment"), or in addition the out-of-balance force of the
   * stresses returned to the yield surface, at most 0.1 % of the load
   * ("equilibrium", with Anderson acceleration of the iteration). Not set:
   * increment.
   */
  convergence?: "increment" | "equilibrium";
  /**
   * The lower and upper bounds of limit analysis (perfect plasticity,
   * associated flow, and with Davis B's reduced strength), which bracket
   * the factor of safety and converge as the mesh is refined: the finite
   * element factor of safety, the strength reduction a comparison; minutes
   * of run time. Not set: off (files from before; on for new projects).
   */
  limitAnalysis?: boolean;
  /**
   * Initial stresses: gravity applied in one increment ("gravity", default)
   * or the K0 procedure ("k0"): σ′h = K0 σ′v from the overburden
   * (fem/initial-stress.ts). With associated flow F does not depend on them.
   */
  initialStress?: "gravity" | "k0";
  /** K0 of every soil for the K0 procedure; null or not set: 1 − sin φ′ (Jaky). */
  k0?: number | null;
  /** Ground level before excavation (m) for the K0 procedure; null or not set: the present ground. */
  originalGroundLevel?: number | null;
  /** Construction stage per material name (0 by default); later stages are built after the earlier ones. */
  materialStages?: Record<string, number>;
}

export const DEFAULT_FEM_SETTINGS: FemAnalysisSettings = {
  enabled: false,
  // The factor of safety from the limit analysis bounds, the strength
  // reduction with ψ (non-associated) for comparison with other programs.
  flowRule: "non-associated",
  youngsModulus: 1e5,
  poissonsRatio: 0.3,
  dilationAngle: 0,
  elementSize: null,
  tensionCutoff: true,
  refinementLevels: 1,
  limitAnalysis: true,
};

/** Result of the finite element analysis in model coordinates, as plain arrays (JSON). */
export interface FemResultSummary {
  /** Factor of safety by strength reduction (largest converged F). */
  factorOfSafety: number;
  /** Smallest F that did not converge. */
  failedF: number;
  flowRule: FemAnalysisSettings["flowRule"];
  /** Elements and F per mesh, coarsest first. */
  levels: { elements: number; fos: number }[];
  warnings: string[];
  elapsedMs: number;
  /** Corner node coordinates of the final mesh. */
  x: number[];
  y: number[];
  /** Corner nodes of each element (3 per element). */
  triangles: number[];
  /** Plastic shear strain per element at the factor of safety. */
  plasticShear: number[];
  /** Shear strain of the last displacement increment per element: the failure mechanism. */
  shearIncrement?: number[];
  /** Displacement (x, y) per node at the factor of safety (m). */
  displacement: number[];
  /**
   * The converged trials of the final mesh that rose from a converged
   * state, by increasing F: the largest displacement component (m) at each
   * reduction factor (the F–displacement
   * curve; it turns flat at failure). Absent in results saved before it.
   */
  curve?: { F: number; displacement: number }[];
  /** The piles' largest forces at the factor of safety, per pile (kN, kNm), in the slope's pile order. */
  piles?: { pile: number; maxAxialForce: number; maxShearForce: number; maxMoment: number }[];
  /** Lower and upper bounds of limit analysis (null where not found), when asked for. */
  bounds?: {
    lower: number | null;
    upper: number | null;
    /** Elements of the last mesh. */
    elements: number;
    /** Refinements on the bound gap (bound-adapt.ts); absent in older results: none. */
    refinements?: number;
    elapsedMs: number;
    warnings: string[];
    /**
     * The same bounds with Davis B's reduced strength for the dilation
     * angle (limit-common.ts): the associated material that stands for
     * non-associated flow, below the bounds above. Absent in older results.
     */
    davis?: { lower: number | null; upper: number | null };
  };
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
  /** Warnings on the input and the critical surface (none: omitted or empty). */
  warnings?: AnalysisWarning[];
  /**
   * Number of trial surfaces not analysed because they are shallower than
   * the minimum slip depth or smaller than the minimum slip area.
   */
  discardedBySize?: number;
  /**
   * Sliding direction of the reported surfaces in model space: "ltr" =
   * towards +x. Set when both directions were analysed.
   */
  slidingDirection?: SlopeOrientation;
  /** Minimum FOS in the other direction (null: no valid surface). */
  otherDirectionMinFOS?: number | null;
  /** Strength reduction by finite elements, when enabled in the options. */
  fem?: FemResultSummary;
  /** Why the finite element analysis failed, when it was enabled and did not complete. */
  femError?: string;
}
