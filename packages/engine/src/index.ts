/**
 * @cslope/engine — Pure-TypeScript slope stability engine.
 *
 * Barrel export of all public types, classes, and functions.
 */

// ── Types ─────────────────────────────────────────────────────────
export { Material } from "./types/material";
export type { MaterialParams } from "./types/material";

export { Udl, LineLoad } from "./types/loads";
export type { UdlParams, LineLoadParams } from "./types/loads";

export type {
  AnalysisMethod,
  IntersliceFunctionType,
  PorePressureHead,
  PartialFactors,
  AnalysisOptions,
  AnalysisResult,
  AnalysisWarning,
  AnalysisWarningCode,
  AnalysisLimits,
  SlipSurfaceResult,
  SliceData,
  WaterTableInput,
} from "./types/analysis";
export { DEFAULT_ANALYSIS_OPTIONS, EC7_DA3_FACTORS } from "./types/analysis";

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
  HighStrengthModel,
  ImpenetrableModel,
  SpatialMohrCoulombModel,
  AnisotropicFunctionModel,
  StrengthFromDepthModel,
  StrengthFromDatumModel,
  LimeCementColumnModel,
  DepthReference,
} from "./types/material-models";
export { MATERIAL_MODEL_LABELS } from "./types/material-models";

// Strength resolution
export {
  resolveStrength,
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

export { createSlice, findCrackX, getSlices, rankineCrackDepth } from "./model/slices";

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
  sliceDrivingMoment,
  sliceVerticalLoad,
  solvedEffectiveNormals,
} from "./model/solvers";

export { buildSlope } from "./model/build-slope";
export { analysisWarnings, danglingBoundaryMessage, M_ALPHA_WARNING_LIMIT } from "./model/result-warnings";
export {
  buildEnvelope,
  envelopeAt,
  pulloutBeyond,
  effectiveVerticalStress,
  itoMatsuiCoefficients,
  pileForce,
} from "./model/reinforcement";
export type { ReinforcementEnvelope } from "./model/reinforcement";
export { analyseReliability, normalCdf, lognormalBeta, reliabilitySurfaceToModelSpace } from "./model/reliability";
export type {
  RandomVariable,
  ReliabilityOptions,
  ReliabilityResult,
  TaylorTerm,
  CriticalSurface,
} from "./model/reliability";

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

// ── Verification problems ──────────────────────────────────────
// Exported from "@cslope/engine/verification" (src/verification/index.ts),
// not from here: the problems cite their sources, and the app imports only
// this entry, so they stay out of the shipped bundle.
