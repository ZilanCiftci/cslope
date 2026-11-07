/**
 * Every value of every analysis option control (the Options window and the
 * finite element and 3D settings), each as a patch of a model's options:
 * the cases the input hash must survive a save and reopen with
 * (features/project/input-hash.test.ts) and the golden corpus holds for the
 * Rust reader (scripts/project-corpus.ts).
 */
import type { AnalysisOptions } from "@cslope/engine";

type Patch = Partial<Record<keyof AnalysisOptions, unknown>>;

const fem = (over: Record<string, unknown>) => ({
  fem: {
    enabled: true,
    flowRule: "davis-b",
    youngsModulus: 100000,
    poissonsRatio: 0.3,
    dilationAngle: 0,
    elementSize: null,
    tensionCutoff: true,
    refinementLevels: 1,
    limitAnalysis: true,
    ...over,
  },
});

export const OPTION_VARIANTS: { name: string; patch: Patch }[] = [
  ...["Bishop", "Janbu", "Morgenstern-Price"].map((method) => ({ name: `method ${method}`, patch: { method } })),
  ...[true, false].map((v) => ({ name: `janbuCorrection ${v}`, patch: { janbuCorrection: v } })),
  ...["constant", "half-sine", "clipped-sine", "trapezoidal"].map((f) => ({ name: `intersliceFunction ${f}`, patch: { intersliceFunction: f } })),
  { name: "intersliceFunction data points", patch: { intersliceFunction: "data-point-specified", intersliceDataPoints: [[0, 0.2], [0.5, 1], [1, 0.2]] } },
  ...["vertical", "phreatic-correction"].map((h) => ({ name: `porePressureHead ${h}`, patch: { porePressureHead: h } })),
  { name: "slices, iterations, tolerance", patch: { slices: 50, iterations: 2000, refinedIterations: 0, tolerance: 0.005, maxIterations: 30, minFailureDist: 2 } },
  { name: "tension crack depth and water", patch: { tensionCrackDepth: 2, tensionCrackWater: 0.5 } },
  ...[true, false].map((v) => ({ name: `tensionCrackAuto ${v}`, patch: { tensionCrackAuto: v } })),
  { name: "tensionCrackAngle 60", patch: { tensionCrackAngle: 60 } },
  ...[true, false].map((v) => ({ name: `compositeSurfaces ${v}`, patch: { compositeSurfaces: v } })),
  ...[true, false].map((v) => ({ name: `compositeBase ${v}`, patch: { compositeBase: v } })),
  { name: "seismic loads", patch: { seismicHorizontal: 0.1, seismicVertical: -0.05 } },
  { name: "partial factors", patch: { partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3 } } },
  {
    name: "partial factors with a basis",
    patch: { partialFactors: { cu: 1.5, cohesion: 1.3, tanPhi: 1.3, variableLoad: 1.3, basis: { safetyClass: 3, etaCu: 1, etaDrained: 1, variableLoadBase: 1.3 } } },
  },
  { name: "partial factors off", patch: { partialFactors: null } },
  ...[true, false].map((v) => ({ name: `bothDirections ${v}`, patch: { bothDirections: v } })),
  ...[true, false].map((v) => ({ name: `nonCircularOptimization ${v}`, patch: { nonCircularOptimization: v } })),
  ...["circular", "block"].map((m) => ({ name: `searchMethod ${m}`, patch: { searchMethod: m } })),
  { name: "block angles", patch: { searchMethod: "block", blockActiveAngle: [40, 60], blockPassiveAngle: [20, 35] } },
  { name: "block angles automatic", patch: { searchMethod: "block", blockActiveAngle: null, blockPassiveAngle: null } },
  { name: "minimum slip depth and area", patch: { minSlipDepth: 1, minSlipArea: 2 } },
  { name: "minimum slip area off", patch: { minSlipArea: null } },
  ...["davis-b", "associated", "non-associated"].map((flowRule) => ({ name: `fem flowRule ${flowRule}`, patch: fem({ flowRule }) })),
  { name: "fem off", patch: fem({ enabled: false }) },
  ...["water-table", "seepage"].map((v) => ({ name: `fem porePressure ${v}`, patch: fem({ porePressure: v }) })),
  ...["viscoplastic", "newton"].map((v) => ({ name: `fem nonAssociatedSolver ${v}`, patch: fem({ flowRule: "non-associated", nonAssociatedSolver: v }) })),
  ...["increment", "equilibrium"].map((v) => ({ name: `fem convergence ${v}`, patch: fem({ convergence: v }) })),
  ...[true, false].map((v) => ({ name: `fem limitAnalysis ${v}`, patch: fem({ limitAnalysis: v }) })),
  ...["gravity", "k0"].map((v) => ({ name: `fem initialStress ${v}`, patch: fem({ initialStress: v }) })),
  { name: "fem K0 and ground level", patch: fem({ initialStress: "k0", k0: 0.6, originalGroundLevel: 12 }) },
  { name: "fem K0 and ground level unset", patch: fem({ initialStress: "k0", k0: null, originalGroundLevel: null }) },
  { name: "fem mesh", patch: fem({ elementSize: 1.5, refinementLevels: 3, tensionCutoff: false, dilationAngle: 5, youngsModulus: 50000, poissonsRatio: 0.35 }) },
  // material names that are array indices: JavaScript lists such keys first, in numeric order
  { name: "fem material stages", patch: fem({ materialStages: { "10": 2, "2": 1, "1": 0, Clay: 3 } }) },
  { name: "sgi3d", patch: { sgi3d: { enabled: true, length: 20, overstrongF2D: 1.2, excludeMaterials: ["10", "2"] } } },
  { name: "sgi3d off", patch: { sgi3d: { enabled: false, length: 15, overstrongF2D: null, excludeMaterials: [] } } },
];
