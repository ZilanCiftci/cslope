/**
 * Verification problems with published factors of safety: the types, the
 * helpers that build slope definitions, and the functions that analyse a
 * problem. The problems themselves are data, in problems.ts (deterministic)
 * and reliability-cases.ts (probabilistic).
 *
 * Imperial problems without water are entered in their own units (FOS is
 * dimensionless); problems with water are converted to SI because the
 * engine uses γw = 9.81 kN/m³ (62.4 pcf = 9.80 kN/m³, < 0.1 % difference).
 *
 * Used by the verification tests, the verification report and the website.
 */
import { buildSlope } from "../model/build-slope";
import { analyseSlope } from "../model/solvers";
import { toCanonicalSlopeDefinition } from "../model/canonical";
import type { Slope } from "../model/slope";
import type { SlopeDefinition } from "../types/slope-definition";
import type { MaterialModel } from "../types/material-models";
import type { AnalysisMethod, AnalysisOptions } from "../types/analysis";
import type { ReliabilityCaseData, ReliabilityQuantity } from "./reliability-cases";
import { PROBLEMS } from "./problems";
import { analyseReliability } from "../model/reliability";
import { referenceTolerance } from "./tolerance";

export type Pt = [number, number];

export interface VerificationCheck {
  method: AnalysisMethod;
  /** Method as named by the source, e.g. "Spencer" (M-P, constant f(x)). */
  label: string;
  published: number;
  /** Who published the value, e.g. "Duncan & Wright", "Commercial program A". */
  publishedBy: string;
  /**
   * Accepted relative deviation, e.g. 0.01 = 1 %. Not written per check:
   * it follows from the case and the reference (tolerance.ts).
   */
  tolerance: number;
  options?: Partial<AnalysisOptions>;
  note?: string;
  /**
   * Engine change this check depends on: the published value and the input
   * are right, but the check fails until that change lands.
   */
  pending?: string;
}

export interface VerificationCase {
  id: string;
  title: string;
  reference: string;
  /** Fixed (given) circle or critical-circle search. */
  surface: "fixed" | "search";
  units: "SI" | "imperial";
  description: string;
  definition: SlopeDefinition;
  checks: VerificationCheck[];
  notes?: string[];
  /** Input digitised from a figure (a surface, a water table); see tolerance.ts. */
  inputFromFigure?: boolean;
  /** Reference values read from a chart or a figure; see tolerance.ts. */
  referenceFromFigure?: boolean;
}

/** A check as written in the data, before its tolerance is worked out. */
export type RawCheck = Omit<VerificationCheck, "tolerance">;
/** A problem as written in the data (problems.ts). */
export type RawCase = Omit<VerificationCase, "checks"> & { checks: RawCheck[] };

export interface Layer {
  name: string;
  /** Elevation of the top of the layer (null for the top layer). */
  topY: number | null;
  model: MaterialModel;
}

// ── Helpers ──────────────────────────────────────────────────────────

export const mc = (c: number, phi: number, gamma: number): MaterialModel => ({
  kind: "mohr-coulomb",
  unitWeight: gamma,
  cohesion: c,
  frictionAngle: phi,
});

export const su = (
  s: number,
  gamma: number,
  refY = 0,
  rate = 0,
): MaterialModel => ({
  kind: "undrained",
  unitWeight: gamma,
  undrainedShearStrength: s,
  suRefDepth: refY,
  suRateOfChange: rate,
});

function groundY(g: Pt[], x: number): number {
  for (let i = 0; i < g.length - 1; i++) {
    const [a, ay] = g[i];
    const [b, by] = g[i + 1];
    if (x >= a && x <= b && b > a) return ay + ((x - a) / (b - a)) * (by - ay);
  }
  return -Infinity;
}

/** Slope from a ground line, a base elevation and horizontal layers. */
export function layered(
  ground: Pt[],
  baseY: number,
  layers: Layer[],
  extra: Partial<SlopeDefinition> = {},
): SlopeDefinition {
  const xs = ground.map((p) => p[0]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const regionAssignments = layers.map((layer, i) => {
    const bottom = i + 1 < layers.length ? layers[i + 1].topY! : baseY;
    const y = layer.topY === null ? bottom + 0.05 : (layer.topY + bottom) / 2;
    let x = x0;
    for (let k = 2; k <= 200; k++) {
      const xx = x0 + ((x1 - x0) * k) / 200;
      if (groundY(ground, xx) > y + 0.01) {
        x = xx;
        break;
      }
    }
    return { point: [x, y] as Pt, materialName: layer.name };
  });
  return {
    coordinates: [[x0, baseY], ...ground, [x1, baseY]],
    materials: layers.map((l) => ({
      name: l.name,
      unitWeight: l.model.unitWeight,
      frictionAngle: 0,
      cohesion: 0,
      model: l.model,
    })),
    materialBoundaries: layers.slice(1).map((l) => ({
      coordinates: [
        [x0 - 1, l.topY!],
        [x1 + 1, l.topY!],
      ] as Pt[],
      materialName: "",
    })),
    regionAssignments,
    ...extra,
  };
}

export const circle = (cx: number, cy: number, radius: number) => ({
  customSearchPlanes: [{ cx, cy, radius }],
  customPlanesOnly: true,
});

/** S = f(datum): Su = s at yRef, increasing by `rate` per unit depth. */
export const sfd = (s: number, yRef: number, rate: number, gamma: number): MaterialModel => ({
  kind: "s-f-datum",
  unitWeight: gamma,
  suRef: s,
  yRef,
  rate,
});

export const FT = 0.3048;
export const PSF = 0.04788026; // kPa
export const PCF = 0.15708746; // kN/m³
export const ft = (p: Pt[]): Pt[] => p.map(([x, y]) => [x * FT, y * FT]);

/**
 * Search settings for the verification runs. 1000 trial surfaces with 1000
 * refined around the best give the same minimum as 4000 + 2000 on the
 * circular problems (lower on some: the refinement matters more than the
 * first pass), in about half the time.
 */
export const VERIFICATION_OPTIONS: Partial<AnalysisOptions> = {
  slices: 50,
  iterations: 1000,
  refinedIterations: 1000,
  tolerance: 0.001,
};

/**
 * Non-circular optimisation ends in a different local minimum with fewer
 * trial surfaces, so it keeps the full search. The tolerance is the tight
 * one: with a looser tolerance the optimisation exploits the solver's slack
 * and lands a few tenths of a percent below the surface's true value
 * (Fredlund, Krahn & Pufahl 1981).
 */
export const NON_CIRCULAR_VERIFICATION_OPTIONS: Partial<AnalysisOptions> = {
  iterations: 4000,
  refinedIterations: 2000,
  tolerance: 0.001,
};

/**
 * The full search, for the published report and table and a weekly CI run
 * (CSLOPE_VERIFICATION_FULL=1): it catches an engine change after which the
 * shorter search misses the minimum.
 */
export const FULL_VERIFICATION_OPTIONS: Partial<AnalysisOptions> = {
  iterations: 4000,
  refinedIterations: 2000,
};

const fullSearch = () => (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CSLOPE_VERIFICATION_FULL === "1";

/** The analysis options of one verification run: the settings above, then the check's own. */
export function verificationOptions(method: AnalysisMethod, options: Partial<AnalysisOptions> = {}): Partial<AnalysisOptions> {
  return {
    method,
    ...VERIFICATION_OPTIONS,
    ...(fullSearch() ? FULL_VERIFICATION_OPTIONS : {}),
    ...(options.nonCircularOptimization ? NON_CIRCULAR_VERIFICATION_OPTIONS : {}),
    ...options,
  };
}

/** Run one check; returns the minimum FOS and the analysed slope. */
export function runVerification(
  definition: SlopeDefinition,
  method: AnalysisMethod,
  options: Partial<AnalysisOptions> = {},
): { fos: number | null; slope: Slope } {
  const slope = buildSlope(toCanonicalSlopeDefinition(definition));
  slope.updateAnalysisOptions(verificationOptions(method, options));
  return { fos: analyseSlope(slope), slope };
}

/** Every verification problem, each check with its tolerance (tolerance.ts). */
export const VERIFICATION_CASES: VerificationCase[] = PROBLEMS.map((c) => ({
  ...c,
  checks: c.checks.map((k) => ({ ...k, tolerance: referenceTolerance(c, k) })),
}));

export interface ReliabilityCheckResult {
  quantity: ReliabilityQuantity;
  published: number;
  publishedBy: string;
  tolerance: number;
  computed: number;
  /** Relative for the FOS, absolute for β and Pf. */
  pass: boolean;
}

/** Run the reliability checks of a probabilistic problem (Taylor series and Monte Carlo on its surface). */
export function runReliabilityCase(c: ReliabilityCaseData): ReliabilityCheckResult[] {
  const def = toCanonicalSlopeDefinition(c.definition);
  const options: Partial<AnalysisOptions> = {
    ...VERIFICATION_OPTIONS,
    ...c.options,
    ...(c.method === "Spencer"
      ? { method: "Morgenstern-Price", intersliceFunction: "constant" }
      : { method: c.method }),
  };
  const quantities = new Set(c.checks.map(([q]) => q));
  const correlations = c.correlations;
  const taylor = [...quantities].some((q) => q === "fos" || q.endsWith("-taylor"))
    ? analyseReliability(def, options, c.variables, { method: "taylor", search: false, correlations })
    : null;
  const mc = [...quantities].some((q) => q.endsWith("-mc"))
    ? analyseReliability(def, options, c.variables, { method: "monte-carlo", samples: c.samples, seed: c.seed, correlations })
    : null;
  const value = (q: ReliabilityQuantity): number => {
    switch (q) {
      case "fos": return taylor!.fos;
      case "beta-taylor": return taylor!.betaLognormal;
      case "pf-taylor": return taylor!.pfLognormal;
      case "beta-mc": return mc!.betaLognormal;
      case "pf-mc": return mc!.pf!;
    }
  };
  return c.checks.map(([quantity, published, publishedBy, tolerance]) => {
    const computed = value(quantity);
    const diff = quantity === "fos" ? Math.abs(computed - published) / published : Math.abs(computed - published);
    return { quantity, published, publishedBy, tolerance, computed, pass: diff <= tolerance + 1e-9 };
  });
}
