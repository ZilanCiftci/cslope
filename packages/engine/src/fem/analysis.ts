/**
 * Strength reduction analysis of a slope by finite elements: builds the
 * model, finds the factor of safety and returns the fields for display.
 */

import type { Slope } from "../model/slope";
import { buildFeModel, gaussStrains, type FeModel, type FeModelOptions } from "./model";
import { dissipationIndicator, dorflerMark, refinedSizeField, zzIndicator } from "./adapt";
import { strengthReduction, type SrmOptions, type SrmTrial } from "./srm";

export interface FemAnalysisOptions extends FeModelOptions, SrmOptions {
  /**
   * Adaptive refinement (plan section 4.8): after each analysis the mesh is
   * refined where the Zienkiewicz–Zhu indicator of the stresses at the factor
   * of safety is largest (Dörfler marking), until F changes less than
   * `tolerance` or `levels` refinements have been made. Default: off.
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
  sizeField: (x: number, y: number) => number;
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

export function analyzeFem(slope: Slope, options: FemAnalysisOptions = {}): FemAnalysisResult {
  const t0 = performance.now();
  const warnings: string[] = [];
  let model = buildFeModel(slope, options);
  const flowRule = options.flowRule ?? "davis-b";
  if (flowRule === "non-associated" && model.gpPhi.some((p) => p > (35 * Math.PI) / 180)) {
    warnings.push(
      "Non-associated flow with friction angles above 35° can give an oscillating or non-unique factor of safety (Tschuchnigg et al. 2015); Davis B is recommended.",
    );
  }
  const tensionCutoff = options.tensionCutoff ?? (slope.tensionCrackDepth > 0 || slope.tensionCrackAuto);
  // With refinement to follow, the coarser meshes need F only to 0.01: as
  // fine as the test that stops the refinement (a change below 0.01), so
  // that the test does not see the bisection's scatter.
  const ad = options.adaptive;
  const coarseTol = ad ? Math.max(options.fTolerance ?? 0.005, 0.01) : options.fTolerance;
  let r = strengthReduction(model, { ...options, flowRule, tensionCutoff, fTolerance: coarseTol });
  const levels: FemLevel[] = [{ elements: model.elementCount, factorOfSafety: r.factorOfSafety, iterations: r.iterations }];
  if (ad && r.factorOfSafety > 0 && Number.isFinite(r.failedF)) {
    const maxLevels = ad.levels ?? 3, tol = ad.tolerance ?? 0.01;
    for (let level = 0; level < maxLevels; level++) {
      const eta = ad.indicator === "zz"
        ? zzIndicator(model, r.state.stress)
        : dissipationIndicator(model, r.state.stress, r.state.evp);
      const marked = dorflerMark(eta, ad.theta ?? 0.3);
      model = buildFeModel(slope, { ...options, sizeField: refinedSizeField(model, marked) });
      const prev = r.factorOfSafety;
      // Start below the coarser mesh's factor (a finer mesh gives less) and
      // step up from converged states.
      r = strengthReduction(model, { ...options, flowRule, tensionCutoff, startF: 0.6 * prev, bracketStep: 0.04, guide: prev, fTolerance: coarseTol });
      levels.push({ elements: model.elementCount, factorOfSafety: r.factorOfSafety, iterations: r.iterations });
      if (Math.abs(r.factorOfSafety - prev) < tol) break;
    }
    // F to the requested tolerance on the final mesh.
    if (r.factorOfSafety > 0 && Number.isFinite(r.failedF) && r.failedF - r.factorOfSafety > (options.fTolerance ?? 0.005)) {
      const prior = r;
      r = strengthReduction(model, { ...options, flowRule, tensionCutoff, resume: { lo: prior.factorOfSafety, hi: prior.failedF, state: prior.state, trials: prior.trials } });
      r = { ...r, trials: [...prior.trials, ...r.trials], previousState: r.previousState ?? prior.previousState };
      levels[levels.length - 1] = { elements: model.elementCount, factorOfSafety: r.factorOfSafety, iterations: levels[levels.length - 1].iterations + r.iterations };
    }
  }
  if (slope.piles.length) {
    warnings.push("Piles are not included in the finite element analysis: a pile row needs beam elements and three-dimensional flow of soil between the piles.");
  }
  if (model.seepage && !model.seepage.converged) warnings.push("The seepage iteration did not converge; the pore pressures are approximate.");
  if (model.triangulation.capped) warnings.push("The mesh reached its vertex limit; the element size was not reached everywhere.");
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
    sizeField: refinedSizeField(model, new Uint8Array(model.elementCount)),
    elapsedMs: performance.now() - t0,
  };
}
