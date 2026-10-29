/**
 * Initial stresses of the finite element model: the K0 procedure and staged
 * construction.
 *
 * - K0 procedure (e.g. Potts & Zdravković, Finite Element Analysis in
 *   Geotechnical Engineering: Theory, 1999, § 9.2; the "K0 procedure" of
 *   most programs): the vertical effective stress from the overburden,
 *   σ′v = −Σ γ h + u (tension positive), and σ′h = σ′z = K0 σ′v, τ = 0,
 *   with K0 = 1 − sin φ′ (Jaky 1944) unless given; for φ = 0 (undrained)
 *   and rigid materials the elastic ν/(1 − ν). The field is in equilibrium
 *   only under a horizontal ground surface; under a slope its out-of-balance
 *   force is applied with the first solution (as the programs do). With an
 *   original ground level above the slope (a cut), the overburden is
 *   counted from it, the soil above the ground taken as the top material,
 *   and the out-of-balance force is the excavation's unloading.
 * - Staged construction: each material is built in a stage (a number; 0
 *   by default). The stages before the last are solved one after the
 *   other at F = 1, each from the stresses of the one before, with the
 *   materials of later stages inactive (model.ts: weightless and soft);
 *   the stress of the last is the initial stress of the full model, whose
 *   strength reduction then builds the last stage in its first trial.
 *   Displacements are counted from the start of each stage. The
 *   reinforcement acts from the last stage on (the stages before it are
 *   solved without it, so that the stresses carried on are in equilibrium
 *   without bar forces). A stage that fails with Newton's method is solved
 *   again by the viscoplastic iteration, whose last state is carried on.
 *
 * Implementation choices (not from the literature): the overburden is
 * integrated over the material polygons along the vertical through each
 * Gauss point, by the midpoint rule on steps of at most 0.25 m, with the
 * unit weight below each material's water line taken saturated (also with
 * seepage pore pressures); σ′v ≤ 0 (no tension).
 */

import type { Slope } from "../model/slope";
import type { Material } from "../types/material";
import { buildFeModel, gaussUnitWeight, withInitialStress, type FeModel, type FeModelOptions } from "./model";
import { runTrial, type SrmOptions } from "./srm";

export interface InitialStressOptions {
  /** "gravity" (default): gravity applied in one increment from zero stress; "k0": the K0 procedure. */
  initialStress?: "gravity" | "k0";
  /** K0 of every soil; default 1 − sin φ′ per Gauss point (Jaky). */
  k0?: number;
  /** Ground level before excavation (m): the overburden of the K0 procedure counts from it where it is above the ground. */
  originalGroundLevel?: number;
  /** Construction stage per material name (default 0): materials of later stages are built later. */
  materialStages?: Readonly<Record<string, number>>;
}

/** Intervals of y inside a polygon along the vertical at x. */
function verticalIntervals(px: readonly number[], py: readonly number[], x: number): [number, number][] {
  const ys: number[] = [];
  const n = px.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = px[i], x2 = px[j];
    // half-open rule: a vertex on the line counts once
    if ((x1 <= x && x < x2) || (x2 <= x && x < x1)) ys.push(py[i] + ((x - x1) / (x2 - x1)) * (py[j] - py[i]));
  }
  ys.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]]);
  return out;
}

/**
 * Initial effective stresses of the K0 procedure per Gauss point (σx, σy,
 * τxy, σz), the materials named in `inactive` excluded (zero stress, no
 * weight).
 */
export function k0Stress(
  model: FeModel,
  slope: Slope,
  options: { k0?: number; originalGroundLevel?: number; inactive?: ReadonlySet<string> } = {},
): Float64Array {
  const ngp = 3 * model.elementCount;
  const out = new Float64Array(4 * ngp);
  const inactive = options.inactive ?? new Set<string>();
  const geoms = slope.materialGeometries.filter((g) => !inactive.has(g.material.name));
  const waterLine = new Map<Material, { x: number[]; y: number[] } | null>();
  const wl = (m: Material) => {
    if (!waterLine.has(m)) waterLine.set(m, slope.getWaterLineForMaterial(m));
    return waterLine.get(m)!;
  };
  const STEP = 0.25;
  const weightOver = (m: Material, x: number, lo: number, hi: number): number => {
    if (!(hi > lo)) return 0;
    const n = Math.max(1, Math.ceil((hi - lo) / STEP)), h = (hi - lo) / n;
    let s = 0;
    for (let k = 0; k < n; k++) s += gaussUnitWeight(m, wl(m), false, 0, x, lo + (k + 0.5) * h) * h;
    return s;
  };
  for (let e = 0; e < model.elementCount; e++) {
    if (model.elInactive[e]) continue;
    const rigid = model.elElastic[e] === 1;
    const nu = model.elNu[e];
    for (let g = 0; g < 3; g++) {
      const i = 3 * e + g, x = model.gpX[i], y = model.gpY[i];
      let sv = 0, top = -Infinity, topMaterial: Material | null = null;
      for (const geom of geoms) {
        for (const [lo, hi] of verticalIntervals(geom.px, geom.py, x)) {
          if (hi > top) { top = hi; topMaterial = geom.material; }
          if (hi > y) sv += weightOver(geom.material, x, Math.max(lo, y), hi);
        }
      }
      const g0 = options.originalGroundLevel;
      if (g0 !== undefined && topMaterial && g0 > top) sv += weightOver(topMaterial, x, top, g0);
      const svEff = Math.min(0, -sv + model.gpU[i]);
      const phi = model.gpPhi[i];
      // a given K0 is the soils'; rigid materials stay elastic
      const k0 = rigid ? nu / (1 - nu) : options.k0 ?? (phi > 0 ? 1 - Math.sin(phi) : nu / (1 - nu));
      out[4 * i] = k0 * svEff;
      out[4 * i + 1] = svEff;
      out[4 * i + 3] = k0 * svEff;
    }
  }
  return out;
}

/**
 * The model for the strength reduction with its initial stresses: built
 * as `buildFeModel`, then with the K0 field or the stresses at the end of
 * the construction stages before the last (see above). `trialOptions` are
 * those of the strength reduction's trials (flow rule, solver).
 */
export function prepareFeModel(
  slope: Slope,
  options: FeModelOptions & InitialStressOptions,
  trialOptions: SrmOptions,
): { model: FeModel; warnings: string[] } {
  const warnings: string[] = [];
  const k0 = options.initialStress === "k0";
  const stageOf = (name: string) => options.materialStages?.[name] ?? 0;
  const names = [...new Set(slope.materialGeometries.map((g) => g.material.name))];
  const stages = [...new Set(names.map(stageOf))].sort((a, b) => a - b);
  const k0Options = { k0: options.k0, originalGroundLevel: options.originalGroundLevel };
  if (stages.length <= 1) {
    const model = buildFeModel(slope, options);
    return { model: k0 ? withInitialStress(model, k0Stress(model, slope, k0Options)) : model, warnings };
  }
  let sigma: Float64Array | null = null;
  for (let s = 0; s + 1 < stages.length; s++) {
    const inactive = names.filter((n) => stageOf(n) > stages[s]);
    let model = buildFeModel(slope, { ...options, inactiveMaterials: inactive, withoutReinforcement: true });
    if (s === 0 && k0) sigma = k0Stress(model, slope, { ...k0Options, inactive: new Set(inactive) });
    if (sigma) model = withInitialStress(model, sigma);
    let r = runTrial(model, 1, null, trialOptions);
    // Newton and BFGS keep no state from a trial that fails; the viscoplastic
    // iteration's last state shows how far the stage got.
    if (!r.converged && r.solver !== "viscoplastic") r = runTrial(model, 1, null, { ...trialOptions, solver: "viscoplastic" });
    if (!r.converged) {
      warnings.push(`Construction stage ${s + 1} of ${stages.length} did not reach equilibrium at F = 1: the slope fails while it is built; the later stages start from its last state.`);
    }
    sigma = Float64Array.from(r.state.stress);
    // a material not yet built carries no stress into the next stage
    for (let e = 0; e < model.elementCount; e++) if (model.elInactive[e]) sigma.fill(0, 12 * e, 12 * e + 12);
  }
  const model = buildFeModel(slope, options);
  if (model.bars.count > 0) warnings.push("The reinforcement acts from the last construction stage on.");
  return { model: withInitialStress(model, sigma!), warnings };
}
