// Fixtures for the types ports (types/*.ts): the JSON the app produces
// (definitions, options, results) for serde round trips, and inputs and
// outputs of strength resolution, design strength, validation, Hoek-Brown,
// materials, loads and partial factors. Run under Node:
//   cd packages/engine && bunx vitest run --config vitest.fixtures.config.ts types
import { writeFixture } from "./write";
import { PROBLEMS } from "../../../engine/src/verification/problems";
import { RELIABILITY_CASES } from "../../../engine/src/verification/reliability-cases";
import { verificationOptions } from "../../../engine/src/verification/cases";
import {
  DEFAULT_ANALYSIS_OPTIONS,
  DEFAULT_FEM_SETTINGS,
  EC7_DA3_FACTORS,
  swedishPartialFactors,
  type AnalysisResult,
  type SliceData,
} from "../../../engine/src/types/analysis";
import {
  resolveStrength,
  designStrength,
  resolveUnitWeight,
  suctionStrength,
  needsLayerTop,
  shansepSu,
  shearNormalAt,
  interpolateFunction,
  type StrengthContext,
} from "../../../engine/src/types/strength";
import {
  MATERIAL_MODEL_LABELS,
  isCombinedDepthModel,
  suctionAngle,
  supportsAnisotropy,
  supportsSuctionStrength,
  type MaterialModel,
} from "../../../engine/src/types/material-models";
import { validateMaterialModel } from "../../../engine/src/types/validation";
import { hoekBrownOf, hoekBrownParameters, instantaneousAtNormalStress, instantaneousAtSigma3 } from "../../../engine/src/types/hoek-brown";
import { Material } from "../../../engine/src/types/material";
import { Udl, LineLoad } from "../../../engine/src/types/loads";
import { materialModelOf, withMaterialModel, type SlopeDefinition, type SlopeMaterialDefinition } from "../../../engine/src/types/slope-definition";
import { BENCHMARK_MODELS } from "../../../desktop/src/store/benchmarks";
import { buildSlopeDTOFromModel } from "../../../desktop/src/store/helpers";
import { createDefaultModel } from "../../../desktop/src/features/properties/sections/material-forms/model-defaults";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const R = rng(31);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(R() * xs.length)];
const attempt = <T>(f: () => T) => {
  try {
    return { ok: f() };
  } catch (e) {
    return { error: (e as Error).message, range: e instanceof RangeError };
  }
};

/** Every definition the app or the verification produces. */
function definitions(): { id: string; definition: SlopeDefinition }[] {
  const out = PROBLEMS.map((p) => ({ id: p.id, definition: p.definition }));
  RELIABILITY_CASES.forEach((c, i) => out.push({ id: `reliability-${i}`, definition: c.definition }));
  BENCHMARK_MODELS.forEach((m, i) => out.push({ id: `app-${i}-${m.name}`, definition: buildSlopeDTOFromModel(m) }));
  return out;
}

const KINDS = Object.keys(MATERIAL_MODEL_LABELS) as (keyof typeof MATERIAL_MODEL_LABELS)[];
const FN: [number, number][] = [[-45, 0.82], [0, 1], [60, 1.5]];

/** Models covering every branch of the resolvers. */
const SYNTHETIC: MaterialModel[] = [
  { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30 },
  { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30, cohesionRefDepth: 5, cohesionRateOfChange: 2 },
  { kind: "mohr-coulomb", unitWeight: 20, cohesion: 10, frictionAngle: 30, cFactor: 0.5, cohesionUndrained: 28 },
  { kind: "mohr-coulomb", unitWeight: 18, cohesion: 30, frictionAngle: 0, phiB: 15, maxSuction: 40 },
  { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 30, phiB: 10, cFactor: 0.1, cohesionUndrained: 40 },
  { kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30, cohesionRefDepth: -30, cohesionRateOfChange: 1, unitWeightSat: 20, ru: 0.2, bBar: 0.5, bBarLoad: true, drawdownStrength: { cohesion: 5, frictionAngle: 20 } },
  { kind: "undrained", unitWeight: 17, undrainedShearStrength: 20, anisotropy: FN },
  { kind: "undrained", unitWeight: 18, undrainedShearStrength: 20, suRefDepth: 0, suRateOfChange: 3, suMax: 35 },
  { kind: "undrained", unitWeight: 18, undrainedShearStrength: 50, suRefDepth: 0, suRateOfChange: -3, suMax: 30 },
  { kind: "undrained", unitWeight: 18, undrainedShearStrength: 25, phiB: 20 } as MaterialModel,
  { kind: "high-strength", unitWeight: 24 },
  { kind: "impenetrable", unitWeight: 25 },
  { kind: "spatial-mohr-coulomb", unitWeight: 20, dataPoints: [] },
  { kind: "spatial-mohr-coulomb", unitWeight: 20, dataPoints: [[0, 0, 10, 20, 18], [10, 0, 30, 40, 22], [5, 10, 50, 60, 0]] },
  { kind: "spatial-mohr-coulomb", unitWeight: 20, dataPoints: [[0, 0, 10, 20, 18], [10, 0, 30, 40, 22]], interpolation: "nearest" },
  { kind: "spatial-mohr-coulomb", unitWeight: 20, dataPoints: [[0, 0, 10, 20, 18], [10, 0, 30, 95, 22], [3, -4, -5, 10, 19]], interpolation: "linear" },
  { kind: "spatial-mohr-coulomb", unitWeight: 20, dataPoints: [[0, 0, 10, 20, 0], [10, 0, 30, 40, -1]], interpolation: "cubic" } as unknown as MaterialModel,
  { kind: "anisotropic-function", unitWeight: 19, cohesion: 20, frictionAngle: 25, modifierFunction: [[0, 1], [45, 0.8], [90, 0.5]] },
  { kind: "anisotropic-function", unitWeight: 19, cohesion: 20, frictionAngle: 40, modifierFunction: [[90, 4], [-90, 4]], phiB: 20 },
  { kind: "anisotropic-function", unitWeight: 19, cohesion: 20, frictionAngle: 40, modifierFunction: [] },
  { kind: "s-f-depth", unitWeight: 18, suRef: 20, depthRef: 0, rate: 4 },
  { kind: "s-f-depth", unitWeight: 16, suRef: 10, depthRef: 0, rate: 1.5, depthReference: "layer-top", anisotropy: FN },
  { kind: "s-f-depth", unitWeight: 16, suRef: 30, depthRef: 2, rate: -2, suMax: 18, depthReference: "ground" },
  { kind: "s-f-depth", unitWeight: 18, suRef: 30, depthRef: 0, rate: 1, drainedCohesion: 3, drainedFrictionAngle: 30, drainedCohesionRate: 0.5, phiB: 10, anisotropy: FN },
  { kind: "s-f-depth", unitWeight: 18, suRef: 30, depthRef: 0, rate: 0, phiB: 10 },
  { kind: "s-f-datum", unitWeight: 17, suRef: 10, yRef: 0, rate: 2, suMax: 13, anisotropy: FN },
  { kind: "s-f-datum", unitWeight: 18, suRef: 40, yRef: 10, rate: -4, suMax: 30 },
  { kind: "lime-cement-columns", unitWeight: 16, soilSu: 10, suRefDepth: 0, suRateOfChange: 2, columnSu: 100, areaRatio: 0.25, suMax: 15 },
  { kind: "lime-cement-columns", unitWeight: 16, soilSu: 20, columnSu: 150, areaRatio: 0.2, columnCohesion: 30, columnFrictionAngle: 30 },
  { kind: "lime-cement-columns", unitWeight: 16, soilSu: 20, columnSu: 150, areaRatio: 1.3, columnCohesion: 30, columnFrictionAngle: 30, suRateOfChange: -1, suMax: 25 },
  { kind: "hoek-brown", unitWeight: 25, ucs: 10000, gsi: 20, mi: 10 },
  { kind: "hoek-brown", unitWeight: 25, ucs: 20000, gsi: 40, mi: 15, disturbance: 0.3 },
  { kind: "hoek-brown", unitWeight: 25, ucs: 20000, gsi: 100, mi: 1, mb: 0.045, s: 1e-6 },
  { kind: "hoek-brown", unitWeight: 25, ucs: 20000, gsi: 100, mi: 1, mb: 1.2, s: 0.01, a: 0.6 },
  { kind: "shansep", unitWeight: 18, ratio: 0.25, ocr: 4, exponent: 0.8 },
  { kind: "shansep", unitWeight: 18, ratio: 0.25 },
  { kind: "shansep", unitWeight: 18, ratio: 0.25, exponent: 1, ocrByElevation: [[0, 1], [10, 3]], anisotropy: FN },
  { kind: "shansep", unitWeight: 18, ratio: 0.25, exponent: 1, ocrByElevation: [[0, 1], [4, 2.2], [10, 3]], spline: { startSlope: 0.1 } },
  { kind: "shansep", unitWeight: 18, ratio: 0.25, suByStress: [[0, 10], [100, 30]] },
  { kind: "shansep", unitWeight: 18, ratio: 0.25, suByStress: [[0, 10], [40, 18], [100, 30]], spline: {} },
  { kind: "shansep", unitWeight: 18, ratio: 0.3, pop: 25, suMin: 8 },
  { kind: "shansep", unitWeight: 18, ratio: 0.3, yieldStress: 60, exponent: 0.9 },
  { kind: "shansep", unitWeight: 18, ratio: 0.3, yieldStress: 60, pop: 10 },
  { kind: "shear-normal", unitWeight: 19, points: [[0, 5], [50, 35], [200, 100]] },
  { kind: "shear-normal", unitWeight: 19, points: [[0, 0], [50, 10], [100, 60]] },
  { kind: "shear-normal", unitWeight: 19, points: [[0, 0], [100, 60], [200, 50]] },
  { kind: "shear-normal", unitWeight: 19, points: [[0, 0], [10, 10], [30, 25], [100, 45]], spline: {} },
  { kind: "shear-normal", unitWeight: 19, points: [[20, 7]] },
  { kind: "shear-normal", unitWeight: 19, points: [] },
  { kind: "mohr-coulomb", unitWeight: 18, cohesion: 0, frictionAngle: 32, aboveWater: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 25 } },
  { kind: "granite", unitWeight: 18 } as unknown as MaterialModel,
];

/** Models with errors for validation (shapes that deserialize in Rust). */
const INVALID: MaterialModel[] = [
  ...[
    { unitWeight: 0 }, { unitWeight: -1 }, { unitWeight: NaN }, { unitWeight: 500.1 }, { unitWeight: Infinity }, { unitWeightSat: 0 }, { unitWeightSat: 501 },
    { unitWeightSat: Infinity }, { cohesionRefDepth: NaN }, { cohesionUndrained: Infinity }, { cFactor: NaN }, { cohesion: -0.1 }, { cohesion: NaN },
    { frictionAngle: -1 }, { frictionAngle: 90 }, { cFactor: -1 }, { cohesion: 0, frictionAngle: 0 }, { cohesion: 0, frictionAngle: 0, cohesionRateOfChange: 0 },
    { cohesionUndrained: -1, cFactor: 1 }, { cFactor: 1 }, { ru: 1 }, { ru: -0.1 }, { bBar: 1.6 }, { phiB: 90 }, { phiB: -1 }, { phiB: NaN }, { phiB: 10, maxSuction: 0 },
    { unitWeight: -1, cohesion: -1, frictionAngle: 95, cFactor: -2 }, { drawdownStrength: { cohesion: -1, frictionAngle: 90 } },
    { aboveWater: { kind: "undrained", unitWeight: 0, undrainedShearStrength: -1 } },
    { aboveWater: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 1, aboveWater: { kind: "impenetrable", unitWeight: 18 } } },
  ].map((o) => ({ kind: "mohr-coulomb", unitWeight: 18, cohesion: 5, frictionAngle: 30, ...o }) as MaterialModel),
  ...[{ suRefDepth: NaN }, { suRateOfChange: NaN }, { undrainedShearStrength: -1 }, { undrainedShearStrength: NaN }, { suMax: 0 }, { suMax: NaN }, { suMax: -40, suRateOfChange: -1 }, { phiB: 20 }, { anisotropy: [[0, 1]] }, { anisotropy: [[0, 1], [45, -1]] }, { anisotropy: [[0, 1], [NaN, 1]] }, { anisotropy: [] }]
    .map((o) => ({ kind: "undrained", unitWeight: 18, undrainedShearStrength: 30, ...o }) as MaterialModel),
  ...[[], [[0, NaN, 1, 30, 18]], [[0, 0, -1, 30, 18]], [[0, 0, 1, -30, 18]], [[0, 0, 1, 30, 0]]].map((dataPoints) => ({ kind: "spatial-mohr-coulomb", unitWeight: 18, dataPoints }) as MaterialModel),
  ...[{ cohesion: -1 }, { frictionAngle: NaN }, { frictionAngle: 90 }, { modifierFunction: [[0, 1]] }, { modifierFunction: [[0, NaN], [10, 1]] }, { modifierFunction: [[0, -0.5], [10, 1]] }]
    .map((o) => ({ kind: "anisotropic-function", unitWeight: 18, cohesion: 5, frictionAngle: 30, modifierFunction: [[-90, 1], [90, 1]], ...o }) as MaterialModel),
  ...[{ suRef: -1 }, { depthRef: NaN }, { rate: Infinity }, { depthReference: "surface" }, { suMax: -5 }, { drainedCohesion: 2 }, { drainedCohesion: -1, drainedFrictionAngle: 30 }, { drainedCohesion: 1, drainedFrictionAngle: 90, drainedCohesionRate: NaN }, { phiB: 10 }, { phiB: 10, drainedCohesion: 2, drainedFrictionAngle: 30 }]
    .map((o) => ({ kind: "s-f-depth", unitWeight: 18, suRef: 20, depthRef: 0, rate: 2, ...o }) as MaterialModel),
  ...[{ suRef: NaN }, { yRef: NaN }, { rate: NaN }, { suMax: Infinity }].map((o) => ({ kind: "s-f-datum", unitWeight: 18, suRef: 20, yRef: 0, rate: 2, ...o }) as MaterialModel),
  ...[{ soilSu: -1 }, { columnSu: NaN }, { areaRatio: 1.01 }, { areaRatio: -0.01 }, { suRefDepth: Infinity }, { suRateOfChange: Infinity }, { columnCohesion: 10 }, { columnFrictionAngle: 30 }, { columnCohesion: -1, columnFrictionAngle: 30 }, { columnCohesion: 10, columnFrictionAngle: 90 }, { suMax: 0 }]
    .map((o) => ({ kind: "lime-cement-columns", unitWeight: 18, soilSu: 15, columnSu: 100, areaRatio: 0.2, ...o }) as MaterialModel),
  ...[{ ucs: 0 }, { gsi: 101 }, { mi: 0 }, { disturbance: 2 }, { mb: -1, s: 2 }, { mb: 1 }, { s: 0.5 }, { mb: 1, s: 0.5, a: 1.5 }]
    .map((o) => ({ kind: "hoek-brown", unitWeight: 25, ucs: 20000, gsi: 50, mi: 10, ...o }) as MaterialModel),
  ...[{ ratio: -1 }, { exponent: NaN }, { ocr: 0 }, { pop: -1 }, { yieldStress: NaN }, { pop: 10, yieldStress: 80 }, { suMin: -1 }, { ocrByElevation: [] }, { ocrByElevation: [[0, 1], [0, 2]] }, { suByStress: [[0, NaN]] }, { anisotropy: [[0, -1], [10, 1]] }]
    .map((o) => ({ kind: "shansep", unitWeight: 18, ratio: 0.25, ...o }) as MaterialModel),
  ...[[[0, 1]], [[0, 1], [NaN, 2]], [[0, 1], [0, 2]], [[0, -1], [10, 2]]].map((points) => ({ kind: "shear-normal", unitWeight: 18, points }) as MaterialModel),
];

function contexts(n: number): StrengthContext[] {
  const out: StrengthContext[] = [
    { yBottom: 0, x: 0, yGround: 10, alpha: 0 },
    { yBottom: 3, x: 5, yGround: 10, alpha: 0.3, suction: 20, effectiveVerticalStress: 100 },
    { yBottom: -4, x: 2, yGround: 8, yLayerTop: 2, alpha: -0.7, suction: 80 },
  ];
  while (out.length < n) {
    const yGround = pick([0, 8, 10, 25]);
    const c: StrengthContext = { yBottom: yGround - (R() * 40 - 5), x: R() * 40 - 10, yGround, alpha: R() * 3 - 1.5 };
    if (R() < 0.4) c.yLayerTop = c.yBottom + R() * 6;
    if (R() < 0.4) c.suction = pick([0, 5, 15, 80, -3]);
    if (R() < 0.4) c.effectiveVerticalStress = pick([0, 12.5, 45, 300, -10]);
    out.push(c);
  }
  return out;
}

const FACTORS = [null, EC7_DA3_FACTORS, swedishPartialFactors({ safetyClass: 2, etaCu: 1.1, etaDrained: 1, variableLoadBase: 1.4 })];

function collectModels(defs: { definition: SlopeDefinition }[]): MaterialModel[] {
  const seen = new Set<string>(), out: MaterialModel[] = [];
  const add = (m: MaterialModel | undefined) => {
    if (!m) return;
    const key = JSON.stringify(m);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  for (const { definition } of defs) for (const m of definition.materials) add(m.model);
  for (const k of KINDS) add(createDefaultModel(k));
  for (const m of SYNTHETIC) add(m);
  return out;
}

/** A synthetic result with every optional field, as the worker posts it. */
function results(): AnalysisResult[] {
  const mat = new Material({ name: "Clay", color: "#abc", model: { kind: "undrained", unitWeight: 17, undrainedShearStrength: 25, anisotropy: FN } });
  const sand = new Material({ name: "Sand", cohesion: 0, frictionAngle: 34, unitWeight: 19 });
  const slice = (i: number, m: Material): SliceData => ({
    x: i + 0.5, xLeft: i, xRight: i + 1, width: 1, yTop: 10 - i * 0.3, yBottom: 2 + i * 0.1, height: 8 - i * 0.4, area: 8 - i * 0.4, alpha: -0.4 + i * 0.07,
    baseLength: 1.08, weight: 150.25 - i, surfaceLoad: i === 0 ? 20 : 0, cohesion: 25, frictionAngle: 0, normalForce: 140.5 + i / 3, porePressure: i === 3 ? -4.2 : 9.81 * i, baseMaterial: m,
  });
  const full: AnalysisResult = {
    minFOS: 1.234567890123,
    maxFOS: 4.5,
    criticalSurface: {
      cx: 12.5, cy: 30.25, radius: 22.1, fos: 1.234567890123, entryPoint: [3, 10], exitPoint: [25, 2], converged: false, closestPair: true,
      lffArray: [[0, 1.2, 1.3, 0.1], [0.5, 1.25, 1.24, 0.01]], equilibriumGap: 0.003, points: [[3, 10], [10, 4], [25, 2]], composite: true,
      reinforcementForces: [{ index: 0, x: 8, y: 5, fx: 12.5, fy: -3, force: 12.9, passive: true }, { index: 1, pile: true, x: 15, y: 3, fx: 40, fy: 0, force: 40, passive: false }],
      crack: { x: 3, top: 11.5, bottom: 10 },
    },
    allSurfaces: [
      { cx: 12.5, cy: 30.25, radius: 22.1, fos: 1.234567890123, entryPoint: [3, 10], exitPoint: [25, 2], converged: true },
      { cx: 0, cy: 7, radius: 0, fos: 1.5, entryPoint: [2, 10], exitPoint: [24, 2], points: [[2, 10], [12, 1], [24, 2]], composite: true },
    ],
    criticalSlices: [0, 1, 2, 3].map((i) => slice(i, i < 2 ? mat : sand)),
    method: "Morgenstern-Price",
    criticalLffArray: [[0, 1.2, 1.3, 0.1]],
    criticalPushingMoment: 1234.5,
    criticalResistingMoment: 1524.1,
    criticalSlipVolume: 88.25,
    elapsedMs: 412.75,
    nonConvergedSurfaces: 3,
    splitFailureCount: 0,
    warnings: [
      { code: "dangling-boundary", message: "Boundary 2 does not divide the slope.", boundaryIndex: 1 },
      { code: "negative-effective-normal", message: "3 slices have a negative effective normal force.", count: 3 },
      { code: "low-m-alpha", message: "m-alpha is small." },
    ],
    discardedBySize: 17,
    slidingDirection: "rtl",
    otherDirectionMinFOS: null,
    fem: {
      factorOfSafety: 1.31, failedF: 1.32, flowRule: "davis-b", levels: [{ elements: 812, fos: 1.35 }, { elements: 2410, fos: 1.31 }], warnings: ["coarse mesh"], elapsedMs: 9123.5,
      x: [0, 1, 0.5], y: [0, 0, 1], triangles: [0, 1, 2], plasticShear: [0.01], shearIncrement: [0.002], displacement: [0, 0, 0.001, -0.002, 0.0005, 0],
      curve: [{ F: 1, displacement: 0.001 }, { F: 1.3, displacement: 0.05 }], piles: [{ pile: 0, maxAxialForce: 10, maxShearForce: 55.5, maxMoment: 120 }],
      bounds: { lower: 1.25, upper: null, elements: 2410, refinements: 2, elapsedMs: 60000, warnings: [], davis: { lower: 1.2, upper: 1.4 } },
    },
    sgi3d: {
      factorOfSafety: 1.6, f2dCritical: 1.23,
      critical: { cx: 12.5, cy: 30.25, radius: 22.1, f2d: 1.25, drivingMoment: 5000, endFaceArea: 40, endFaceMoment: 800, fp: 1.4, f3d: 1.6 },
      equation: "2-4", options: { length: 10, overstrongF2D: 1.5, excludeMaterials: ["Fill"] }, warnings: ["w"],
    },
    sgi3dError: "none",
    femError: "none",
  };
  const minimal: AnalysisResult = { minFOS: 0, maxFOS: 0, criticalSurface: null, allSurfaces: [], criticalSlices: [], method: "Bishop", elapsedMs: 1 };
  const nan: AnalysisResult = { ...minimal, minFOS: NaN, maxFOS: Infinity, otherDirectionMinFOS: 1.75, fem: { ...full.fem!, bounds: undefined, curve: undefined }, method: "Janbu" };
  return [full, minimal, nan];
}

it("exports the types fixtures", () => {
  const defs = definitions();
  writeFixture("types", "definitions", defs);

  // ── options ──
  const options = PROBLEMS.flatMap((p) => p.checks.map((c) => ({ ...DEFAULT_ANALYSIS_OPTIONS, ...verificationOptions(c.method, c.options) })));
  options.push(
    ...BENCHMARK_MODELS.map((m) => m.options),
    { ...DEFAULT_ANALYSIS_OPTIONS, fem: { ...DEFAULT_FEM_SETTINGS, enabled: true }, sgi3d: { enabled: true, length: 12, overstrongF2D: null, excludeMaterials: [] }, partialFactors: null, minSlipArea: null },
    {
      ...DEFAULT_ANALYSIS_OPTIONS,
      method: "Morgenstern-Price", janbuCorrection: true, intersliceFunction: "data-point-specified", intersliceDataPoints: [[0, 0.5], [1, 1]], porePressureHead: "phreatic-correction",
      tensionCrackAuto: true, tensionCrackAngle: 60, compositeSurfaces: false, compositeBase: true, seismicHorizontal: 0.1, seismicVertical: -0.05,
      partialFactors: swedishPartialFactors({ safetyClass: 3, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 }), bothDirections: true, nonCircularOptimization: true,
      searchMethod: "block", blockActiveAngle: [50, 70], blockPassiveAngle: null, minSlipDepth: 0.5, minSlipArea: 0,
      fem: { ...DEFAULT_FEM_SETTINGS, flowRule: "associated", elementSize: 1.5, porePressure: "seepage", nonAssociatedSolver: "newton", convergence: "equilibrium", initialStress: "k0", k0: null, originalGroundLevel: 12, materialStages: { Fill: 1, Clay: 0 } },
      sgi3d: { enabled: false, length: 8, cellSize: 0.1, overstrongF2D: 1.4, excludeMaterials: ["Fill", "Sand"] },
    },
  );
  writeFixture("types", "options", options);
  writeFixture("types", "results", results());

  // ── strength ──
  const models = collectModels(defs);
  const ctxs = contexts(40);
  const strength = models.map((model) => ({
    model,
    validate: validateMaterialModel(model),
    needsLayerTop: needsLayerTop(model),
    suctionAngle: suctionAngle(model),
    isCombinedDepthModel: isCombinedDepthModel(model),
    supportsAnisotropy: supportsAnisotropy(model.kind),
    supportsSuctionStrength: supportsSuctionStrength(model.kind),
    label: MATERIAL_MODEL_LABELS[model.kind] ?? null,
    at: ctxs.map((ctx) => {
      const r = attempt(() => resolveStrength(model, ctx));
      return {
        ctx,
        strength: r,
        design: "ok" in r ? FACTORS.map((f) => designStrength(model.kind, r.ok, f)) : null,
        unitWeight: resolveUnitWeight(model, model.unitWeight, ctx.x, ctx.yBottom),
        suction: suctionStrength(model, ctx.suction ?? 0),
        shansepSu: model.kind === "shansep" ? shansepSu(model, ctx) : null,
      };
    }),
  }));
  writeFixture("types", "strength", strength);
  writeFixture("types", "validation", INVALID.map((model) => ({ model, errors: validateMaterialModel(model) })));

  const shearNormal = SYNTHETIC.filter((m) => m.kind === "shear-normal").flatMap((m) =>
    [-50, 0, 5, 10, 20, 30, 50, 75, 100, 150, 200, 1000].map((sn) => ({ model: m, sn, out: shearNormalAt(m, sn) })),
  );
  const fnPoints: [number, number][][] = [[], [[1, 7]], [[0, 0], [10, 2]], [[10, 2], [0, 0]], [[0, 0], [5, 1], [5, 3], [10, 3]], [[0, 0], [NaN, 1], [10, 2]]];
  const fns = fnPoints.flatMap((pts) => [-5, 0, 3, 5, 5.0001, 10, 15, NaN].map((x) => ({ pts, x, out: interpolateFunction(pts, x) })));
  writeFixture("types", "functions", { shearNormal, fns });

  // ── Hoek-Brown ──
  const params = [];
  for (const ucs of [1000, 20000, 50000])
    for (const gsi of [0, 20, 45, 75, 100])
      for (const mi of [5, 12, 25])
        for (const d of [0, 0.5, 1]) params.push({ args: [ucs, gsi, mi, d], out: hoekBrownParameters(ucs, gsi, mi, d) });
  const hbModels = SYNTHETIC.filter((m) => m.kind === "hoek-brown");
  const inst = [...hbModels.map((m) => hoekBrownOf(m)), ...params.filter((_, i) => i % 7 === 0).map((p) => p.out)].map((p) => ({
    p,
    sigma3: [-100, 0, 0.5, 50, 300, 2000, 1e5].map((s3) => ({ s3, out: instantaneousAtSigma3(p, s3) })),
    sn: [-50, 0, 1, 44.6, 50, 1000, 25000, 1e6, NaN].map((sn) => ({ sn, out: instantaneousAtNormalStress(p, sn) })),
  }));
  writeFixture("types", "hoek_brown", { params, of: hbModels.map((m) => ({ model: m, out: hoekBrownOf(m) })), inst });

  // ── materials, loads, factors ──
  const materialParams = [
    {}, { name: "Clay" }, { name: "Sand", cohesion: -5, frictionAngle: 0, unitWeight: 0 }, { cohesion: 10, frictionAngle: 30, cohesionRefDepth: 5, cohesionRateOfChange: 2, cohesionUndrained: 20, cFactor: 0.5, color: "#fff" },
    { frictionAngle: -1 }, { frictionAngle: 91 }, { unitWeight: -1 }, { unitWeight: 501 }, { unitWeight: NaN }, { frictionAngle: NaN },
    { name: "M", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 50 } }, { model: { kind: "impenetrable", unitWeight: 600 } }, { unitWeight: 600, model: { kind: "high-strength", unitWeight: 24 } },
  ];
  const materials = materialParams.map((params) => ({ params, out: attempt(() => { const m = new Material(params as never); return { name: m.name, color: m.color, model: m.model, unitWeight: m.unitWeight }; }) }));
  const udls = [
    { magnitude: -5, x1: 2, x2: 8 }, { magnitude: 12, x1: 8, x2: 2, color: "green", direction: "normal" }, { magnitude: 3, x1: 0, x2: 1, direction: "vertical" },
    { magnitude: 10, x1: 0, x2: 4, excessPorePressure: [{ material: "Clay", ratio: 0.5 }, { material: "Silt", ratio: 1.5 }, { material: "Sand", ratio: 0 }, { material: "X", ratio: NaN }, { material: "Y", ratio: -1 }] },
  ].map((params) => ({ params, out: { ...new Udl(params as never) } }));
  const lineLoads = [{ magnitude: -10, x: 5 }, { magnitude: 10, x: 5, angle: 30, y: 4, color: "black" }, { magnitude: 1, x: 0, angle: NaN, y: Infinity }, { magnitude: 1, x: 0, angle: -90 }]
    .map((params) => ({ params, out: { ...new LineLoad(params as never) } }));
  const matDefs: SlopeMaterialDefinition[] = [
    { name: "a", model: { kind: "undrained", unitWeight: 18, undrainedShearStrength: 30 } },
    { name: "b", unitWeight: 19, cohesion: 5, frictionAngle: 28 },
    { name: "b2", unitWeight: 19, cohesion: 5, frictionAngle: 28, cohesionRefDepth: 3, cohesionRateOfChange: 1, cohesionUndrained: 30, color: "#123", depthRange: [0, 5], waterTableId: "w1" },
    { name: "c" },
    { name: "d", unitWeight: 18, cohesion: 5 },
    { name: "e", unitWeight: 0, cohesion: 0, frictionAngle: 0, model: { kind: "mohr-coulomb", unitWeight: 18, cohesion: 10, frictionAngle: 30 }, color: "#fff" },
  ];
  const definitionsOfMaterials = matDefs.map((m) => ({ m, of: attempt(() => materialModelOf(m)), with: attempt(() => withMaterialModel(m)) }));
  const swedish = [
    { safetyClass: 2, etaCu: 1.1, etaDrained: 1, variableLoadBase: 1.4 }, { safetyClass: 3, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 }, { safetyClass: 1, etaCu: 0.9, etaDrained: 1.2, variableLoadBase: 1.5 },
    { safetyClass: 4, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 }, { safetyClass: 1, etaCu: 0, etaDrained: 1, variableLoadBase: 1.3 }, { safetyClass: 1, etaCu: 1, etaDrained: NaN, variableLoadBase: 1.3 },
    { safetyClass: 2, etaCu: 1, etaDrained: 1, variableLoadBase: -1 }, { safetyClass: 2, etaCu: 1.0005, etaDrained: 0.7, variableLoadBase: 1.25 },
  ].map((basis) => ({ basis, out: attempt(() => swedishPartialFactors(basis as never)) }));
  writeFixture("types", "materials", { materials, udls, lineLoads, definitions: definitionsOfMaterials, swedish, defaults: { options: DEFAULT_ANALYSIS_OPTIONS, fem: DEFAULT_FEM_SETTINGS, ec7: EC7_DA3_FACTORS } });
});
