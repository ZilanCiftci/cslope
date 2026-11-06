/**
 * Strength reduction by finite elements (SRFEM).
 *
 * Implemented in packages/engine-rs/crates/cslope-engine/src/fem/srm.rs,
 * where the method, its sources and the implementation choices are
 * documented; called through WebAssembly (facade/internal.ts).
 */
import { testCall } from "../facade/internal";
import type { FeModel } from "./model";
import { dataOptions,modelChanged,modelHandle } from "../facade/fem/_handles";

export type FlowRule = "davis-b" | "non-associated" | "associated";

export interface SrmOptions {
  flowRule?: FlowRule;
  /**
   * "newton" (default for Davis B and associated flow): implicit return and
   * consistent tangent (newton.ts), which decides convergence sharply; with
   * non-associated flow the tangent is unsymmetric (LU, sparse.rs) and F
   * rises in increments from the starting state (`runTrial`).
   * "viscoplastic" (default for non-associated flow): the explicit
   * iteration of Griffiths & Lane. Measured 2026-10-29 on five
   * non-associated cases (V055, V094 and three published benchmark
   * slopes), Newton's F lies within 1.3 % of the viscoplastic one, at 0.7
   * to 8 times its run time (4 times on the median case), so viscoplastic
   * stays the default. "bfgs": quasi-Newton on the elastic stiffness.
   */
  solver?: "newton" | "bfgs" | "viscoplastic";
  /** Rankine tension cut-off at zero effective stress; default false. */
  tensionCutoff?: boolean;
  /**
   * Convergence test of the viscoplastic iteration: "increment", max|Δu|/max|u| ≤ tolerance as
   * Griffiths & Lane (1999) and Smith & Griffiths (2014); "extrapolated", the
   * estimated distance to the fixed point Δu·r/(1 − r) instead of Δu, which
   * does not accept a slowly creeping state near collapse but needs more
   * iterations, so with the same limit it gives a lower F (V055: 1.31
   * against 1.35); "equilibrium", the increment test and in addition the
   * out-of-balance force of the stresses returned to the yield surface,
   * ‖f − ∫Bᵀσ‖ ≤ `unbalanceTolerance`·‖f‖ (the unbalanced-force criterion
   * of explicit and implicit codes), which does not depend on Δt, and
   * with which the iteration is accelerated (`acceleration`).
   */
  convergence?: "increment" | "extrapolated" | "equilibrium";
  /**
   * Anderson acceleration of the viscoplastic iteration (fem/anderson.rs in the engine): the
   * number of past iterates mixed; 0 turns it off. Default 10 with the
   * "equilibrium" test, 0 otherwise: an accelerated iterate can have a small
   * displacement change without equilibrium, which the increment test
   * would accept (measured on 33 slopes: F far above the references on most, up to 97).
   */
  acceleration?: number;
  /** Relative out-of-balance force of the "equilibrium" test; default 1e-3. */
  unbalanceTolerance?: number;
  /** Convergence tolerance; default 1e-4 (viscoplastic), 1e-6 relative residual (Newton). */
  tolerance?: number;
  /** Viscoplastic iteration limit per trial (failure when reached); default 1000 × √(elements/2500), at least 1000 (1500 with acceleration). */
  maxIterations?: number;
  /** Newton iteration limit per trial; default 200 (newton.ts). */
  newtonIterations?: number;
  /** Absolute tolerance on F; default 0.005. */
  fTolerance?: number;
  /**
   * Viscoplastic step as a fraction of the stability limit 2/a (see `reduce`):
   * Δt = relaxation / a; default 1 (exact return on a single plane).
   */
  relaxation?: number;
  /** First trial F; default 1. */
  startF?: number;
  /** Relative step while bracketing F; default 0.25, and 0.1 (constant) for non-associated flow. */
  bracketStep?: number;
  /**
   * Expected F (a coarser mesh's): while rising towards it the steps stop
   * at 0.97 × guide and then rise by 0.02 × guide, so that F does not
   * overshoot far and leave failed trials to bisect.
   */
  guide?: number;
  /**
   * Continue an earlier search on the same model: its converged F and state
   * and its smallest failed F; only the bisection remains.
   */
  resume?: { lo: number; hi: number; state: SrmState; hiFrom?: number };
  /**
   * A starting state for the first trials, e.g. a coarser mesh's converged
   * state transferred to this one (fem/transfer.rs in the engine): the trials start from it
   * until one converges, but no F counts as converged from it alone.
   */
  warmStart?: SrmState;
  /**
   * Trials per round (default 1, bisection): with n > 1 the search tries n
   * reductions per round from the same converged state (multisection), which
   * the app runs in parallel. The result depends on n, not on how the
   * trials are run.
   */
  trialsPerRound?: number;
  /** Called after each trial. */
  onTrial?: (trial: SrmTrial) => void;
}

export interface SrmTrial {
  F: number;
  converged: boolean;
  iterations: number;
  /** Solver that decided the trial. */
  solver: "newton" | "bfgs" | "viscoplastic";
  /** F of the converged state the trial started from; 0 for the unloaded state. */
  startF: number;
  /** Largest nodal displacement (m) at the end of the trial. */
  maxDisplacement: number;
}

export interface SrmState {
  /** Displacements per equation. */
  u: Float64Array;
  /** Total viscoplastic strain per Gauss point (εx, εy, γxy, εz). */
  evp: Float64Array;
  /** Body loads of the viscoplastic strains, per equation. */
  bodyLoads: Float64Array;
  /** Effective stresses per Gauss point (σx, σy, τxy, σz). */
  stress: Float64Array;
  /** Plastic axial strain of the reinforcement bars (2 per bar). */
  barEp: Float64Array;
}

export interface SrmResult {
  /** Factor of safety: the largest converged F (non-convergence criterion). */
  factorOfSafety: number;
  /** Smallest F that failed to converge from a converged state below it. */
  failedF: number;
  /** F of the converged state the trial at `failedF` started from. */
  failedFrom: number;
  /**
   * F at the displacement jump (Huang & Jia 2009, Comput. Geotech. 36, 93–101:
   * failure where a characteristic nodal displacement increases suddenly):
   * the largest converged F before the growth rate of the largest
   * displacement exceeds ten times that of the first trials; null when
   * there are too few converged trials. The factor ten is an
   * implementation choice: the source judges the jump from the curve.
   */
  displacementJumpF: number | null;
  trials: SrmTrial[];
  /** State at the factor of safety. */
  state: SrmState;
  /** The converged state before it (lower F), if any: their difference shows the mechanism. */
  previousState: SrmState | null;
  /** Total iterations. */
  iterations: number;
  /** Reason when no factor of safety could be bracketed. */
  warning?: string;
}

/** Trials the search asks for: these reductions, each from the same starting state (null: unloaded). */
export interface TrialBatch {
  start: SrmState | null;
  /** F of the starting state; 0 for the unloaded state. */
  startF: number;
  F: number[];
}

/** The outcome of one trial, with the state it reached. */
export interface TrialOutcome {
  converged: boolean;
  iterations: number;
  solver: SrmTrial["solver"];
  state: SrmState;
}

/** The options as the engine reads them: data, the warm start and onTrial (a function, called from the engine). */
function trialOptions(options: SrmOptions): Record<string, unknown> {
  return { ...dataOptions(options), warmStart: options.warmStart, onTrial: options.onTrial };
}

/** Factor of safety by strength reduction, the trials run one after another. */
export function strengthReduction(model: FeModel, options: SrmOptions = {}): SrmResult {
  try {
    return testCall("fem/srm::strengthReduction", [modelHandle(model), trialOptions(options)]);
  } finally {
    modelChanged(model);
  }
}
