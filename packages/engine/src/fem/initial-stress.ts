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
 *
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts and fem/_handles.ts).
 */
import { testCall } from "../facade/internal";
import type { FeModel, FeModelOptions } from "./model";
import type { SrmOptions } from "./srm";
import type { Slope } from "../model/slope";
import { dataOptions, feModelOf, modelHandle, sizeFieldHandle, slopeRef } from "../facade/fem/_handles";

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
  const o = { k0: options.k0, originalGroundLevel: options.originalGroundLevel, inactive: options.inactive ? [...options.inactive] : undefined };
  return testCall("fem/initial-stress::k0Stress", [modelHandle(model), slopeRef(slope), o]);
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
  const r = testCall<{ model: number; warnings: string[] }>("fem/initial-stress::prepareFeModel", [
    slopeRef(slope),
    dataOptions(options),
    dataOptions(trialOptions),
    sizeFieldHandle(options.sizeField),
  ]);
  return { model: feModelOf(r.model), warnings: r.warnings };
}
