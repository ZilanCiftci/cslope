/**
 * Strength reduction analysis of a slope by finite elements: builds the
 * model, finds the factor of safety (srm.ts) and returns the fields for
 * display, optionally on adaptively refined meshes (adapt.ts).
 *
 * Implementation choices (not from the literature), with their reasons:
 * - Adaptive loop: up to `levels` refinements, stopping when F changes by
 *   less than 0.01; F on the coarser meshes to half that (the stop test's
 *   resolution), on the final mesh to `fTolerance`, continuing the
 *   bracket of the last search. When no factor is found on a refined mesh,
 *   the coarser mesh's result stands, with a warning.
 * - A refined mesh starts its search at 0.6 × the coarser mesh's F with
 *   steps of 4 %, guided by that F: a finer mesh usually gives a lower
 *   collapse load (de Borst & Vermeer 1984, Géotechnique 34(2), 199–210),
 *   and trials rising from converged states avoid the false failures of a
 *   cold start.
 * - The failure mechanism is shown by the shear strain of the displacement
 *   increment between the last two converged reductions, which shows the
 *   band that moves at failure; the accumulated plastic strain also covers
 *   zones that yielded early and stopped.
 */

import type { Slope } from "../model/slope";
import { gaussStrains, type FeModel, type FeModelOptions } from "./model";
import { prepareFeModel, type InitialStressOptions } from "./initial-stress";
import { dissipationIndicator, dorflerMark, refinedSizeField, zzIndicator } from "./adapt";
import {
  runTrial,
  strengthReductionSearch,
  type SrmOptions,
  type SrmResult,
  type SrmTrial,
  type TrialBatch,
  type TrialOutcome,
} from "./srm";

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
  /**
   * The element size of the final mesh as a size field, to mesh the same
   * slope again (e.g. for the lower bound, whose mechanism is the same).
   */
  sizeField: ((x: number, y: number) => number) & { min?: number };
  elapsedMs: number;
}

/** In-plane maximum shear strain of the displacement change between two states, per element. */
export function shearIncrementPerElement(model: FeModel, u: Float64Array, uPrev: Float64Array | null): Float64Array {
  const du = uPrev ? u.map((v, i) => v - uPrev[i]) : u;
  const strain = new Float64Array(4 * 3 * model.elementCount);
  gaussStrains(model, du, strain);
  const out = new Float64Array(model.elementCount);
  for (let e = 0; e < model.elementCount; e++) {
    let s = 0;
    for (let g = 0; g < 3; g++) {
      const o = 4 * (3 * e + g);
      s += Math.hypot(strain[o] - strain[o + 1], strain[o + 2]);
    }
    out[e] = s / 3;
  }
  return out;
}

/** Plastic shear strain (ε₁ − ε₃ of the viscoplastic strain) per element. */
export function plasticShearPerElement(model: FeModel, evp: Float64Array): Float64Array {
  const out = new Float64Array(model.elementCount);
  for (let e = 0; e < model.elementCount; e++) {
    let s = 0;
    for (let g = 0; g < 3; g++) {
      const o = 4 * (3 * e + g);
      const ex = evp[o], ey = evp[o + 1], gxy = evp[o + 2], ez = evp[o + 3];
      const r = Math.sqrt(((ex - ey) / 2) ** 2 + (gxy / 2) ** 2);
      const a = (ex + ey) / 2 + r, b = (ex + ey) / 2 - r;
      s += Math.max(a, b, ez) - Math.min(a, b, ez);
    }
    out[e] = s / 3;
  }
  return out;
}

/** A batch of trials of the analysis, with the model (mesh level) they belong to. */
export interface FemTrialBatch extends TrialBatch {
  model: FeModel;
  /** Mesh level, 0 for the first mesh. */
  level: number;
  /** Options of the trials (`runTrial`). */
  options: SrmOptions;
}

/** Tag the batches of one search with their model. */
function* onModel(
  search: Generator<TrialBatch, SrmResult, TrialOutcome[]>,
  model: FeModel,
  level: number,
  options: SrmOptions,
): Generator<FemTrialBatch, SrmResult, TrialOutcome[]> {
  let step = search.next();
  while (!step.done) step = search.next(yield { ...step.value, model, level, options });
  return step.value;
}

/**
 * Default trials per round: 1, bisection. Measured 2026-10-28, three trials
 * per round run in parallel shortened the wall time only by 1.2–1.35 ×
 * (V018, V020) for 1.5–1.8 × the work: every round waits for a failed
 * trial, which runs to the iteration limit.
 */
export const DEFAULT_TRIALS_PER_ROUND = 1;

/** The analysis with its trials run one after another. */
export function analyzeFem(slope: Slope, options: FemAnalysisOptions = {}): FemAnalysisResult {
  const search = analyzeFemSearch(slope, options);
  let step = search.next();
  while (!step.done) {
    const b = step.value;
    step = search.next(b.F.map((F) => runTrial(b.model, F, b.start, b.options, undefined, b.startF)));
  }
  return step.value;
}

/** The analysis with each batch of trials run by `runBatch`, e.g. in parallel workers; the result is that of `analyzeFem`. */
export async function analyzeFemAsync(
  slope: Slope,
  options: FemAnalysisOptions,
  runBatch: (batch: FemTrialBatch) => Promise<TrialOutcome[]>,
): Promise<FemAnalysisResult> {
  const search = analyzeFemSearch(slope, options);
  let step = search.next();
  while (!step.done) step = search.next(await runBatch(step.value));
  return step.value;
}

/** The analysis as a generator of trial batches (see `strengthReductionSearch`). */
export function* analyzeFemSearch(slope: Slope, options: FemAnalysisOptions = {}): Generator<FemTrialBatch, FemAnalysisResult, TrialOutcome[]> {
  const t0 = performance.now();
  const warnings: string[] = [];
  const flowRule = options.flowRule ?? "davis-b";
  const tensionCutoff = options.tensionCutoff ?? (slope.tensionCrackDepth > 0 || slope.tensionCrackAuto);
  // With refinement to follow, the coarser meshes need F to half the change
  // that stops the refinement (0.01 by default), so that the stop test is
  // not decided by the bisection's scatter, and no finer than the final
  // tolerance.
  const ad = options.adaptive;
  const coarseTol = ad ? Math.max(options.fTolerance ?? 0.005, (ad.tolerance ?? 0.01) / 2) : options.fTolerance;
  const perRound = options.trialsPerRound ?? DEFAULT_TRIALS_PER_ROUND;
  const trialOptions: SrmOptions = {
    flowRule, tensionCutoff, solver: options.solver, tolerance: options.tolerance, maxIterations: options.maxIterations,
    newtonIterations: options.newtonIterations, convergence: options.convergence, unbalanceTolerance: options.unbalanceTolerance, relaxation: options.relaxation,
  };
  // The model with its initial stresses (K0 procedure, construction stages; initial-stress.ts).
  const prepared = (o: FemAnalysisOptions) => {
    const p = prepareFeModel(slope, o, trialOptions);
    for (const w of p.warnings) if (!warnings.includes(w)) warnings.push(w);
    return p.model;
  };
  let model = prepared(options);
  // Implementation choice: the warning from φ > 35°.
  if (flowRule === "non-associated" && model.gpPhi.some((p) => p > (35 * Math.PI) / 180)) {
    warnings.push(
      "Non-associated flow at high friction angles can give an oscillating or non-unique factor of safety (Tschuchnigg et al. 2015); Davis B is recommended.",
    );
  }
  const search = (m: FeModel, level: number, o: SrmOptions) =>
    onModel(strengthReductionSearch(m, { ...options, ...o, flowRule, tensionCutoff, trialsPerRound: perRound }), m, level, trialOptions);
  let r = yield* search(model, 0, { fTolerance: coarseTol });
  const levels: FemLevel[] = [{ elements: model.elementCount, factorOfSafety: r.factorOfSafety, iterations: r.iterations }];
  let capped = model.triangulation.capped;
  if (ad && r.factorOfSafety > 0 && Number.isFinite(r.failedF)) {
    const maxLevels = ad.levels ?? 3, tol = ad.tolerance ?? 0.01;
    let finalLevel = 0;
    for (let level = 0; level < maxLevels; level++) {
      const eta = ad.indicator === "zz"
        ? zzIndicator(model, r.state.stress)
        : dissipationIndicator(model, r.state.stress, r.state.evp);
      const marked = dorflerMark(eta, ad.theta ?? 0.3);
      const coarser = model, coarserR = r;
      model = prepared({ ...options, sizeField: refinedSizeField(model, marked) });
      const prev = r.factorOfSafety;
      // Start below the coarser mesh's factor (a finer mesh gives less) and
      // step up from converged states.
      r = yield* search(model, level + 1, { startF: 0.6 * prev, bracketStep: 0.04, guide: prev, fTolerance: coarseTol });
      levels.push({ elements: model.elementCount, factorOfSafety: r.factorOfSafety, iterations: r.iterations });
      if (!(r.factorOfSafety > 0 && Number.isFinite(r.failedF))) {
        // No factor on the refined mesh: the result stays the coarser mesh's.
        warnings.push(
          `No factor of safety was found on the refined mesh ${level + 1}${r.warning ? ` (${r.warning})` : ""}; the result is that of the coarser mesh.`,
        );
        model = coarser; r = coarserR;
        levels.pop();
        break;
      }
      capped ||= model.triangulation.capped;
      finalLevel = level + 1;
      if (Math.abs(r.factorOfSafety - prev) < tol) break;
    }
    // F to the requested tolerance on the final mesh.
    if (r.factorOfSafety > 0 && Number.isFinite(r.failedF) && r.failedF - r.factorOfSafety > (options.fTolerance ?? 0.005)) {
      const prior = r;
      r = yield* search(model, finalLevel, { fTolerance: options.fTolerance, resume: { lo: prior.factorOfSafety, hi: prior.failedF, hiFrom: prior.failedFrom, state: prior.state } });
      r = { ...r, trials: [...prior.trials, ...r.trials], previousState: r.previousState ?? prior.previousState };
      levels[finalLevel] = { elements: model.elementCount, factorOfSafety: r.factorOfSafety, iterations: levels[finalLevel].iterations + r.iterations };
    }
  }
  if (slope.piles.length) {
    warnings.push("Piles are not included in the finite element analysis: a pile row needs beam elements and three-dimensional flow of soil between the piles.");
  }
  if (model.seepage && !model.seepage.converged) warnings.push("The seepage iteration did not converge; the pore pressures are approximate.");
  if (capped) warnings.push("The mesh reached its vertex limit; the element size was not reached everywhere.");
  if (model.triangulation.missingSegments > 0) warnings.push("A material boundary shorter than the mesh's merge tolerance is not represented in the mesh.");
  if (r.warning) warnings.push(r.warning);

  const nc = model.cornerCount;
  const displacement = new Float64Array(2 * nc);
  for (let n = 0; n < nc; n++) {
    const ix = model.eq[2 * n], iy = model.eq[2 * n + 1];
    displacement[2 * n] = ix >= 0 ? r.state.u[ix] : 0;
    displacement[2 * n + 1] = iy >= 0 ? r.state.u[iy] : 0;
  }
  const triangles = new Int32Array(3 * model.elementCount);
  for (let e = 0; e < model.elementCount; e++) for (let k = 0; k < 3; k++) triangles[3 * e + k] = model.el[6 * e + k];

  return {
    factorOfSafety: r.factorOfSafety,
    failedF: r.failedF,
    displacementJumpF: r.displacementJumpF,
    trials: r.trials,
    iterations: r.iterations,
    warnings,
    mesh: {
      x: model.x.slice(0, nc),
      y: model.y.slice(0, nc),
      triangles,
      elementMaterial: model.elMaterial,
      materialNames: model.materials.map((m) => m.name),
    },
    displacement,
    plasticShearStrain: plasticShearPerElement(model, r.state.evp),
    shearStrainIncrement: shearIncrementPerElement(model, r.state.u, r.previousState?.u ?? null),
    levels,
    sizeField: model.sizeField,
    elapsedMs: performance.now() - t0,
  };
}
