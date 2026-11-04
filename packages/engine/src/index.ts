/**
 * @cslope/engine — slope stability engine: the Rust engine as WebAssembly
 * (packages/engine-rs) behind its TypeScript API.
 *
 * Barrel export of all public types, classes, and functions. Start the
 * engine once before calling it (ARCHITECTURE.md §3.2):
 *
 *   await initEngine();             // Node and Bun: reads the wasm from disk
 *   await initEngine(bytes);        // a browser's main thread
 *   initEngineSync(engineModule()); // a worker, given the compiled module
 *
 * Objects the engine returns are copies (snapshots): changing them does not
 * change the engine's model.
 */

// ── The engine ────────────────────────────────────────────────────
export { initEngine, initEngineSync, engineModule, isEngineReady, type WasmSource } from "./engine";

// ── Types ─────────────────────────────────────────────────────────
export { Material } from "./types/material";
export type { MaterialParams } from "./types/material";

export { Udl, LineLoad } from "./types/loads";
export type { UdlParams, UdlDirection, UdlExcessPorePressure, LineLoadParams } from "./types/loads";

export type {
  AnalysisMethod,
  IntersliceFunctionType,
  PorePressureHead,
  SearchMethod,
  PartialFactors,
  SafetyClass,
  SwedishFactorBasis,
  AnalysisOptions,
  AnalysisResult,
  AnalysisWarning,
  AnalysisWarningCode,
  AnalysisLimits,
  SlipSurfaceResult,
  SliceData,
  WaterTableInput,
  CustomPlaneKind,
  CustomPlaneRef,
  CustomSurfaceResult,
  SurfaceRejection,
} from "./types/analysis";
export { DEFAULT_ANALYSIS_OPTIONS, EC7_DA3_FACTORS, DEFAULT_FEM_SETTINGS, SAFETY_CLASS_GAMMA_D, swedishPartialFactors } from "./types/analysis";
export type { FemAnalysisSettings, FemResultSummary } from "./types/analysis";

export type {
  GeometryWithMaterial,
  SlipSurface,
  Slice,
  SliceSolverState,
} from "./types/geometry";

export type { SlopeDefinition, SlopeMaterialDefinition } from "./types/slope-definition";
export { materialModelOf, withMaterialModel } from "./types/slope-definition";

export type {
  Reinforcement,
  ReinforcementDirection,
  ReinforcementApplication,
  PileForceDirection,
  PileForceLocation,
  ReinforcementPullout,
  ReinforcementForce,
  Pile,
} from "./types/reinforcement";

// Material model types
export type {
  MaterialModel,
  MaterialModelKind,
  MaterialModelBase,
  MohrCoulombModel,
  UndrainedModel,
  UndrainedAnisotropy,
  HighStrengthModel,
  ImpenetrableModel,
  SpatialMohrCoulombModel,
  AnisotropicFunctionModel,
  StrengthFromDepthModel,
  StrengthFromDatumModel,
  LimeCementColumnModel,
  HoekBrownModel,
  ShansepModel,
  ShearNormalModel,
  TableSpline,
  DepthReference,
  UnsaturatedStrength,
} from "./types/material-models";
export { MATERIAL_MODEL_LABELS, isCombinedDepthModel, supportsAnisotropy, supportsSuctionStrength, suctionAngle } from "./types/material-models";
export { hoekBrownOf, hoekBrownParameters, instantaneousAtNormalStress, instantaneousAtSigma3, type HoekBrownParameters } from "./types/hoek-brown";

// Strength resolution
export {
  resolveStrength,
  suctionStrength,
  resolveUnitWeight,
  needsLayerTop,
  interpolateFunction,
} from "./types/strength";
export type { ResolvedStrength, StrengthContext } from "./types/strength";

// Validation
export { validateMaterialModel } from "./types/validation";

export {
  DEFAULT_SLICES,
  DEFAULT_ITERATIONS,
  FOS_TOLERANCE,
  MAX_FOS_ITERATIONS,
  DEFAULT_METHOD,
  FOS_LIMIT,
  MP_OUTER_ITERATIONS,
  MP_LAMBDA_STEP_LIMIT,
  MP_MAX_EXTRAPOLATION_ITERS,
  MALPHA_ZERO_GUARD,
  MATERIAL_EPSILON,
  POLYGON_INTERSECTION_TOLERANCE,
  SLICE_DEDUP_TOLERANCE,
  WATER_UNIT_WEIGHT,
  SLICES_RANGE,
  ITERATIONS_RANGE,
  REFINED_ITERATIONS_RANGE,
  UNIT_WEIGHT_RANGE,
  FRICTION_ANGLE_RANGE,
} from "./types/constants";

// ── Math ──────────────────────────────────────────────────────────
export {
  calculatePolygonArea,
  isPointInPolygon,
  clipPolygonHalfplane,
  clipPolygonVertical,
} from "./math/polygon";

export {
  getCircleYCoordinateAtX,
  getCircleLineIntersections,
  circleRadiusFromAbcd,
  circleCentre,
  generateCircleCoordinates,
} from "./math/circle";

export {
  getYAtX,
  getYAtXMany,
  getYAtXStrict,
  getLineBetweenPoints,
} from "./math/interpolation";

export { calculateAllLoads } from "./math/loads";
export type { UdlData, LineLoadData } from "./math/loads";

export {
  constantInterslice,
  halfsine,
  clippedSine,
  trapezoidal,
  dataPointSpecified,
  getIntersliceFunctionValue,
  midCoord,
  distPoints,
  extrapolateLambda,
  getPrecision,
  MATERIAL_COLORS,
} from "./math/helpers";

// ── Model ─────────────────────────────────────────────────────────
export { Slope } from "./model/slope";
export type { SearchPlane } from "./model/slope";

export {
  getSurfaceLine,
  splitPolygonByPolyline,
  polygonizeRegions,
  lineSegmentIntersection,
  createGeometryWithMaterial,
} from "./model/geometry-ops";
export type { RegionFace } from "./model/geometry-ops";

export { findCrackX, getSlices, rankineCrackDepth } from "./model/slices";
export { fitPolylineToGround, isAdmissiblePolyline } from "./model/surface";

export {
  generatePlanes,
  setEntryExitPlanes,
  addSingleEntryExitPlane,
  addSingleCircularPlane,
  isPlaneWithinExternalBoundary,
  selectEntryExit,
} from "./model/search";

export {
  analyseOrdinary,
  analyseBishop,
  analyseJanbu,
  analyseMorgensternPrice,
  analyseSlope,
  analyseSlopeAsync,
  analyseSlopeSteps,
  evaluatePlanes,
  restoreCriticalSlices,
  sliceDrivingMoment,
  sliceVerticalLoad,
  solvedEffectiveNormals,
} from "./model/solvers";
export { inParallel, runStepsAsync, runStepsSync, type AsyncEvaluate, type Evaluate, type PlaneSteps } from "./model/steps";

export { buildSlope } from "./model/build-slope";
export { waternetPorePressure, type Waternet } from "./model/waternet";
export { analysisWarnings, danglingBoundaryMessage, M_ALPHA_WARNING_LIMIT, steepEntryMessage } from "./model/result-warnings";
export {
  buildEnvelope,
  envelopeAt,
  pulloutBeyond,
  effectiveVerticalStress,
  itoMatsuiCoefficients,
  pileForce,
} from "./model/reinforcement";
export type { ReinforcementEnvelope } from "./model/reinforcement";
export {
  analyseReliability,
  analyseReliabilityAsync,
  monteCarloSampler,
  normalCdf,
  lognormalBeta,
  reliabilitySurfaceToModelSpace,
} from "./model/reliability";
export type {
  MonteCarloSampler,
  RandomVariable,
  ReliabilityOptions,
  ReliabilityResult,
  ReliabilityRunner,
  ReliabilityStep,
  TaylorTerm,
  CriticalSurface,
} from "./model/reliability";
export * from "./parallel/index";
export { runAnalysis, runAnalysisAsync, analysisResult, displayPoints, type AnalyseHook, type RunAnalysisHooks } from "./api/run-analysis";

export {
  mirrorX,
  mirrorPoint,
  mirrorPoints,
  getDomainX,
  inferOrientationFromCoordinates,
  resolveOrientation,
  mirrorLimits,
  toCanonicalSlopeDefinition,
  mapAnalysisResultToModelSpace,
  oppositeDirectionDefinition,
} from "./model/canonical";
export type { SlopeOrientation } from "./model/canonical";

// ── Finite elements ────────────────────────────────────────────
// Strength reduction (SRFEM) and lower- and upper-bound limit analysis.
// The bounds' conic programs are solved by Clarabel, linked into the engine.
export {
  analyzeFem,
  lowerBound,
  upperBound,
  adaptiveBounds,
  type FemAnalysisOptions,
  type FemAnalysisResult,
  type FemMeshView,
  type FemLevel,
  type FlowRule,
  type FeMaterialParameters,
  type LowerBoundOptions,
  type LowerBoundResult,
  type UpperBoundOptions,
  type UpperBoundResult,
  type AdaptiveBoundsOptions,
  type AdaptiveBoundsResult,
} from "./fem/index";
export { runFemSummary, runFemSummaryWithBounds } from "./fem/summary";
export type { FemStage } from "./fem/summary";

// ── Verification problems ──────────────────────────────────────
// Exported from "@cslope/engine/verification" (src/verification/index.ts),
// not from here: the problems cite their sources, and the app imports only
// this entry, so they stay out of the shipped bundle.
export type { Sgi3dOptions, Sgi3dResult, Sgi3dSettings, Sgi3dSurface } from "./types/sgi3d";
export { sgi3dFactorOfSafety } from "./model/sgi3d";
