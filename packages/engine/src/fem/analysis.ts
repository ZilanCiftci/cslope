/**
 * Strength reduction analysis of a slope by finite elements: builds the
 * model, finds the factor of safety (srm.ts) and returns the fields for
 * display, optionally on adaptively refined meshes (adapt.ts).
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/analysis.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import { wasm } from "../facade/internal";
import type { FeModel,FeModelOptions } from "./model";
import type { SrmOptions,SrmTrial,TrialBatch } from "./srm";
import type { Slope } from "../model/slope";
import { dataOptions, sizeFieldHandle, sizeFieldOf, slopeRef } from "../facade/fem/_handles";
import type { InitialStressOptions } from "./initial-stress";

export interface FemAnalysisOptions extends FeModelOptions, SrmOptions, InitialStressOptions {
  /**
   * Adaptive refinement: after each analysis the mesh is refined where the
   * indicator at the factor of safety is largest (Dörfler marking, θ
   * default 0.3), until F changes less than `tolerance` (default 0.01) or
   * `levels` refinements (default 3) have been made. Indicator: the plastic
   * dissipation (default) or the Zienkiewicz–Zhu stress error (adapt.ts).
   * Default: off.
   */
  adaptive?: { levels?: number; theta?: number; tolerance?: number; indicator?: "dissipation" | "zz" };
}

/** Largest forces of a pile at the factor of safety, per pile (kN, kNm). */
export interface FemPileResult {
  /** Index in the slope's piles. */
  pile: number;
  maxAxialForce: number;
  maxShearForce: number;
  maxMoment: number;
}

export interface FemLevel {
  elements: number;
  factorOfSafety: number;
  iterations: number;
}

export interface FemMeshView {
  /** Corner node coordinates. */
  x: Float64Array;
  y: Float64Array;
  /** Corner nodes of each element (3 per element). */
  triangles: Int32Array;
  /** Index into `materialNames` per element. */
  elementMaterial: Int32Array;
  materialNames: string[];
}

export interface FemAnalysisResult {
  factorOfSafety: number;
  /** Smallest F that did not converge. */
  failedF: number;
  /** F by the displacement-jump criterion, when it could be found. */
  displacementJumpF: number | null;
  trials: SrmTrial[];
  iterations: number;
  warnings: string[];
  mesh: FemMeshView;
  /** Displacement (x, y) of each corner node at the factor of safety (m). */
  displacement: Float64Array;
  /**
   * Accumulated plastic shear strain per element at the factor of safety
   * (mean over the Gauss points of (ε₁ − ε₃) of the viscoplastic strain);
   * the failure mechanism is where it concentrates.
   */
  plasticShearStrain: Float64Array;
  /**
   * Shear strain of the displacement increment between the last two
   * converged reductions (γmax per element, the mean of its Gauss points):
   * the incremental shear strain that shows the failure mechanism as a band,
   * where the accumulated plastic strain also covers zones that yielded
   * early and stopped.
   */
  shearStrainIncrement: Float64Array;
  /** Factor of safety per mesh, coarsest first (one entry without refinement). */
  levels: FemLevel[];
  /** The piles' largest forces at the factor of safety (per pile). */
  piles: FemPileResult[];
  /**
   * The element size of the final mesh as a size field, to mesh the same
   * slope again (e.g. for the lower bound, whose mechanism is the same).
   */
  sizeField: ((x: number, y: number) => number) & { min?: number };
  elapsedMs: number;
}

/** A batch of trials of the analysis, with the model (mesh level) they belong to. */
export interface FemTrialBatch extends TrialBatch {
  model: FeModel;
  /** Mesh level, 0 for the first mesh. */
  level: number;
  /** Options of the trials (`runTrial`). */
  options: SrmOptions;
}

/**
 * Default trials per round: 1, bisection. Measured 2026-10-28, three trials
 * per round run in parallel shortened the wall time only by 1.2–1.35 ×
 * (V018, V020) for 1.5–1.8 × the work: every round waits for a failed
 * trial, which runs to the iteration limit.
 */
export const DEFAULT_TRIALS_PER_ROUND = 1;

/** The strength reduction of a slope, with refinement when asked (`options.onTrial` is called after each trial). */
export function analyzeFem(slope: Slope, options: FemAnalysisOptions = {}): FemAnalysisResult {
  const r = wasm().analyze_fem(slopeRef(slope), dataOptions(options), sizeFieldHandle(options.sizeField), options.onTrial) as Omit<FemAnalysisResult, "sizeField"> & { sizeField: number };
  return { ...r, sizeField: sizeFieldOf(r.sizeField) };
}
