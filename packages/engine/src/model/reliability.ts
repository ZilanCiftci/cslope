/**
 * Probabilistic (reliability) analysis.
 *
 * Material parameters are random variables (mean = the model value,
 * standard deviation given). Two methods:
 *
 * - Taylor series (TSPM, Duncan 2000; US Army Corps of Engineers): F at the
 *   most likely values and at mean ± σ of each variable in turn;
 *   σF = √Σ(ΔFᵢ/2)² (with correlation terms), COV = σF/F, lognormal
 *   reliability index β = ln(F/√(1+COV²))/√ln(1+COV²) and Pf = Φ(−β). The
 *   critical surface can be searched again for every evaluation.
 * - Monte Carlo on the critical surface at the mean values (Slide2's
 *   "Global Minimum" method; its "Overall Slope" method repeats the search
 *   for every sample, which is not done here): sampled parameters (normal
 *   or lognormal, truncated, optionally correlated), Pf = share of samples
 *   with F < 1.
 */

import type { AnalysisOptions } from "../types/analysis";
import type { SlopeDefinition } from "../types/slope-definition";
import type { Material } from "../types/material";
import { buildSlope } from "./build-slope";
import { analyseSlope } from "./solvers";
import type { Slope } from "./slope";
import { getDomainX, mirrorPoint, mirrorX, resolveOrientation } from "./canonical";

export interface RandomVariable {
  /** Index of the material in the definition's materials. */
  material: number;
  /** Field of the material model, e.g. "cohesion", "frictionAngle", "unitWeight", "undrainedShearStrength". */
  field: string;
  /** Standard deviation (same unit as the field). */
  sd: number;
  /** Default "normal". */
  distribution?: "normal" | "lognormal";
  /** Truncation of sampled values (Monte Carlo). Default: ≥ 0 for strength and unit weight, φ < 90°. */
  min?: number;
  max?: number;
}

export interface ReliabilityOptions {
  method: "taylor" | "monte-carlo";
  /** Taylor series: search the critical surface again for each evaluation. Default true. */
  search?: boolean;
  /** Monte Carlo: number of samples (default 1000) and random seed (default 1). */
  samples?: number;
  seed?: number;
  /** Correlation coefficients between variables (indices into the list). */
  correlations?: { a: number; b: number; rho: number }[];
  /** Called with the progress 0–1. */
  onProgress?: (progress: number) => void;
}

export interface TaylorTerm {
  variable: number;
  mean: number;
  sd: number;
  /** F with the variable at mean + σ and mean − σ. */
  fPlus: number;
  fMinus: number;
}

export interface CriticalSurface {
  cx: number;
  cy: number;
  radius: number;
  lc: [number, number];
  rc: [number, number];
  points?: [number, number][];
}

export interface ReliabilityResult {
  method: "taylor" | "monte-carlo";
  /** F at the most likely (mean) values. */
  fos: number;
  /** Mean and standard deviation of F (Taylor: F at the means and σF). */
  meanFOS: number;
  sdFOS: number;
  cov: number;
  /** Lognormal reliability index and its probability of failure Φ(−β). */
  betaLognormal: number;
  pfLognormal: number;
  /** Normal reliability index (μF − 1)/σF. */
  betaNormal: number;
  /** Monte Carlo: share of samples with F < 1. */
  pf?: number;
  /** Monte Carlo: the sampled F (failed evaluations left out). */
  samples?: number[];
  /** Taylor series: F at mean ± σ of each variable. */
  terms?: TaylorTerm[];
  /** Critical surface at the mean values (canonical coordinates). */
  surface: CriticalSurface;
  /** Evaluations without a FOS. */
  failed: number;
}

/** Fields that cannot be negative (strengths and unit weights); rates and reference levels can. */
const NON_NEGATIVE = new Set(["cohesion", "frictionAngle", "undrainedShearStrength", "suRef", "cohesionUndrained", "unitWeight"]);

/** Standard normal cumulative distribution (Abramowitz & Stegun 26.2.17). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Lognormal reliability index of a factor of safety with mean F and coefficient of variation COV. */
export function lognormalBeta(F: number, cov: number): number {
  if (!(cov > 0)) return F >= 1 ? Infinity : -Infinity;
  const s2 = Math.log(1 + cov * cov);
  return Math.log(F / Math.sqrt(1 + cov * cov)) / Math.sqrt(s2);
}

/** Deterministic random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  // Box–Muller
  let u = 0;
  while (u === 0) u = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

/** Lower triangular L with L·Lᵀ = C (C positive definite). */
function cholesky(c: number[][]): number[][] {
  const n = c.length;
  const l = c.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = c[i][j];
      for (let k = 0; k < j; k++) s -= l[i][k] * l[j][k];
      if (i === j) {
        if (!(s > 0)) throw new Error("The correlation matrix is not positive definite.");
        l[i][i] = Math.sqrt(s);
      } else {
        l[i][j] = s / l[j][j];
      }
    }
  }
  return l;
}

function correlationMatrix(n: number, correlations: ReliabilityOptions["correlations"]): number[][] {
  const c: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (const { a, b, rho } of correlations ?? []) {
    if (a === b || a < 0 || b < 0 || a >= n || b >= n || !(Math.abs(rho) < 1)) {
      throw new Error("Correlations need two different variables and |ρ| < 1.");
    }
    c[a][b] = rho;
    c[b][a] = rho;
  }
  return c;
}

function modelValue(def: SlopeDefinition, v: RandomVariable): number {
  const m = def.materials[v.material];
  if (!m) throw new Error(`Random variable: no material ${v.material + 1}.`);
  const model = (m.model ?? {}) as unknown as Record<string, unknown>;
  const value = v.field === "unitWeight" ? (model.unitWeight ?? m.unitWeight) : model[v.field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Random variable: material "${m.name}" has no ${v.field}.`);
  }
  return value;
}

/** The definition with the variables at the given values. */
function definitionWith(def: SlopeDefinition, variables: RandomVariable[], values: number[]): SlopeDefinition {
  const materials = def.materials.map((m) => ({ ...m, model: m.model ? { ...m.model } : undefined }));
  variables.forEach((v, i) => {
    const m = materials[v.material];
    const model = m.model as unknown as Record<string, number> | undefined;
    if (v.field === "unitWeight") {
      // γsat keeps its difference to γ.
      const delta = values[i] - (model?.unitWeight ?? m.unitWeight);
      m.unitWeight = values[i];
      if (model) {
        model.unitWeight = values[i];
        if (typeof model.unitWeightSat === "number") model.unitWeightSat += delta;
      }
    } else if (model) {
      model[v.field] = values[i];
    }
  });
  return { ...def, materials };
}

/** Lowest FOS of a slope and its surface. */
function critical(slope: Slope): { fos: number; surface: CriticalSurface } | null {
  const fos = analyseSlope(slope);
  const best = slope.search.find((p) => p.fos != null);
  if (fos == null || !best) return null;
  return {
    fos,
    surface: { cx: best.cx, cy: best.cy, radius: best.radius, lc: best.lc, rc: best.rc, ...(best.points ? { points: best.points } : {}) },
  };
}

function build(def: SlopeDefinition, options: Partial<AnalysisOptions>): Slope {
  const slope = buildSlope(def);
  slope.updateAnalysisOptions(options);
  return slope;
}

/** The definition with only the given surface analysed. */
function onSurface(def: SlopeDefinition, s: CriticalSurface): SlopeDefinition {
  // The moment axis of a polyline is kept (an optimised surface uses its
  // seed circle's centre; the default axis would give another FOS).
  return s.points
    ? { ...def, customSurfaces: [{ points: s.points, axis: [s.cx, s.cy] }], customSearchPlanes: undefined, customPlanesOnly: true }
    : { ...def, customSearchPlanes: [{ cx: s.cx, cy: s.cy, radius: s.radius }], customSurfaces: undefined, customPlanesOnly: true };
}

/**
 * Reliability of a slope (canonical definition, analysis options as for
 * a normal run) for the given random variables.
 */
export function analyseReliability(
  def: SlopeDefinition,
  options: Partial<AnalysisOptions>,
  variables: RandomVariable[],
  ro: ReliabilityOptions,
): ReliabilityResult {
  if (variables.length === 0) throw new Error("Give at least one random variable.");
  for (const v of variables) {
    if (!(Number.isFinite(v.sd) && v.sd >= 0)) throw new Error("Standard deviations must be ≥ 0.");
  }
  const means = variables.map((v) => modelValue(def, v));
  const meanSlope = build(def, options);
  const atMean = critical(meanSlope);
  if (!atMean) throw new Error("No valid slip surface at the mean values.");
  // A material in no region would vary nothing.
  const used = new Set(meanSlope.materialGeometries.map((g) => g.material.name));
  for (const v of variables) {
    if (!used.has(def.materials[v.material].name)) {
      throw new Error(`Random variable: material "${def.materials[v.material].name}" is not used in the model.`);
    }
  }
  const F = atMean.fos;
  const corr = correlationMatrix(variables.length, ro.correlations);

  if (ro.method === "taylor") {
    const search = ro.search ?? true;
    const base = search ? def : onSurface(def, atMean.surface);
    let failed = 0;
    const evaluate = (values: number[]): number => {
      const r = critical(build(definitionWith(base, variables, values), options));
      if (!r) {
        failed++;
        return NaN;
      }
      return r.fos;
    };
    const terms: TaylorTerm[] = [];
    variables.forEach((v, i) => {
      if (NON_NEGATIVE.has(v.field) && means[i] - v.sd < 0) {
        throw new Error(
          `Mean − σ of ${v.field} (material ${v.material + 1}) is negative; use Monte Carlo, which truncates the samples.`,
        );
      }
      const plus = [...means];
      const minus = [...means];
      plus[i] += v.sd;
      minus[i] -= v.sd;
      terms.push({ variable: i, mean: means[i], sd: v.sd, fPlus: evaluate(plus), fMinus: evaluate(minus) });
      ro.onProgress?.((i + 1) / variables.length);
    });
    if (failed > 0) throw new Error(`${failed} evaluation(s) at mean ± σ found no slip surface.`);
    // σF² = Σᵢ Σⱼ ρᵢⱼ (ΔFᵢ/2)(ΔFⱼ/2), with signed ΔF = F⁺ − F⁻.
    const half = terms.map((t) => (t.fPlus - t.fMinus) / 2);
    let varF = 0;
    for (let i = 0; i < half.length; i++) for (let j = 0; j < half.length; j++) varF += corr[i][j] * half[i] * half[j];
    const sd = Math.sqrt(Math.max(0, varF));
    const cov = sd / F;
    const beta = lognormalBeta(F, cov);
    return {
      method: "taylor",
      fos: F,
      meanFOS: F,
      sdFOS: sd,
      cov,
      betaLognormal: beta,
      pfLognormal: normalCdf(-beta),
      betaNormal: sd > 0 ? (F - 1) / sd : F >= 1 ? Infinity : -Infinity,
      terms,
      surface: atMean.surface,
      failed: 0,
    };
  }

  // Monte Carlo on the critical surface at the means: the slope is built
  // once and only the materials change.
  const n = Math.max(10, Math.min(100000, Math.round(ro.samples ?? 1000)));
  const random = rng(ro.seed ?? 1);
  const L = cholesky(corr);
  const slope = build(onSurface(def, atMean.surface), options);
  if (slope.individualPlanes.length === 0) {
    throw new Error("The critical surface at the mean values could not be set up again for the samples.");
  }
  const materialsByIndex = def.materials.map((m) =>
    slope.materialGeometries.map((g) => g.material).find((mat) => mat.name === m.name) ?? null,
  );
  const baseModels = materialsByIndex.map((m) => (m ? { model: m.model, unitWeight: m.unitWeight } : null));
  const params = variables.map((v, i) => {
    const mean = means[i];
    const lognormal = v.distribution === "lognormal" && mean > 0;
    const s2 = lognormal ? Math.log(1 + (v.sd / mean) ** 2) : 0;
    return {
      lognormal,
      mu: lognormal ? Math.log(mean) - s2 / 2 : mean,
      sigma: lognormal ? Math.sqrt(s2) : v.sd,
      min: v.min ?? (NON_NEGATIVE.has(v.field) ? 0 : -Infinity),
      // φ below 90° (the samples skip the model validation).
      max: v.max ?? (v.field === "frictionAngle" ? 89.9 : Infinity),
    };
  });
  const samples: number[] = [];
  let failed = 0;
  const values = new Array<number>(variables.length);
  for (let k = 0; k < n; k++) {
    // Correlated standard normals; resampled until within the truncation.
    for (let attempt = 0; attempt < 100; attempt++) {
      const z = variables.map(() => gaussian(random));
      let ok = true;
      for (let i = 0; i < variables.length; i++) {
        let zi = 0;
        for (let j = 0; j <= i; j++) zi += L[i][j] * z[j];
        const p = params[i];
        values[i] = p.lognormal ? Math.exp(p.mu + p.sigma * zi) : p.mu + p.sigma * zi;
        if (values[i] < p.min || values[i] > p.max) ok = false;
      }
      if (ok) break;
      if (attempt === 99) values.forEach((x, i) => (values[i] = Math.min(params[i].max, Math.max(params[i].min, x))));
    }
    applyValues(materialsByIndex, baseModels, variables, values);
    slope.materialsChanged();
    const fos = analyseSlope(slope);
    if (fos == null || !Number.isFinite(fos)) failed++;
    else samples.push(fos);
    if ((k + 1) % 50 === 0) ro.onProgress?.((k + 1) / n);
  }
  applyValues(materialsByIndex, baseModels, variables, means);
  if (samples.length < 2) throw new Error("Too few Monte Carlo samples gave a FOS.");
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const sd = Math.sqrt(samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (samples.length - 1));
  const cov = sd / mean;
  const beta = lognormalBeta(mean, cov);
  return {
    method: "monte-carlo",
    fos: F,
    meanFOS: mean,
    sdFOS: sd,
    cov,
    betaLognormal: beta,
    pfLognormal: normalCdf(-beta),
    betaNormal: sd > 0 ? (mean - 1) / sd : mean >= 1 ? Infinity : -Infinity,
    pf: samples.filter((f) => f < 1).length / samples.length,
    samples,
    surface: atMean.surface,
    failed,
  };
}

/** Set the variables on the slope's materials (from their base models). */
function applyValues(
  materials: (Material | null)[],
  base: ({ model: Material["model"]; unitWeight: number } | null)[],
  variables: RandomVariable[],
  values: number[],
): void {
  const next = new Map<number, { model: Record<string, unknown>; unitWeight: number }>();
  variables.forEach((v, i) => {
    const b = base[v.material];
    if (!b || !materials[v.material]) return;
    const entry = next.get(v.material) ?? { model: { ...b.model }, unitWeight: b.unitWeight };
    if (v.field === "unitWeight") {
      const delta = values[i] - b.unitWeight;
      entry.unitWeight = values[i];
      entry.model.unitWeight = values[i];
      if (typeof b.model.unitWeightSat === "number") entry.model.unitWeightSat = b.model.unitWeightSat + delta;
    } else {
      entry.model[v.field] = values[i];
    }
    next.set(v.material, entry);
  });
  for (const [index, entry] of next) {
    const m = materials[index]! as { model: unknown; unitWeight: number };
    m.model = entry.model;
    m.unitWeight = entry.unitWeight;
  }
}

/**
 * The critical surface of a result in model coordinates. `def` is the
 * model definition whose canonical form was analysed (a right-to-left
 * model is mirrored back).
 */
export function reliabilitySurfaceToModelSpace(surface: CriticalSurface, def: SlopeDefinition): CriticalSurface {
  if (resolveOrientation(def.orientation, def.coordinates) !== "rtl") return surface;
  const [xMin, xMax] = getDomainX(def.coordinates);
  const m = (p: [number, number]) => mirrorPoint(p, xMin, xMax);
  return {
    cx: mirrorX(surface.cx, xMin, xMax),
    cy: surface.cy,
    radius: surface.radius,
    lc: m(surface.lc),
    rc: m(surface.rc),
    ...(surface.points ? { points: surface.points.map(m) } : {}),
  };
}
