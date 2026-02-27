/**
 * @cslope/engine — Pure-TypeScript slope stability engine.
 *
 * Barrel export of all public types, classes, and functions.
 */

// ── Types ─────────────────────────────────────────────────────────
export { Material } from "./types/material";
export type { MaterialParams, MaterialType } from "./types/material";

export { Udl, LineLoad } from "./types/loads";
export type { UdlParams, LineLoadParams } from "./types/loads";

export type {
  AnalysisMethod,
  IntersliceFunctionType,
  AnalysisOptions,
  AnalysisResult,
  AnalysisLimits,
  SlipSurfaceResult,
  SliceData,
  WaterTableInput,
} from "./types/analysis";
export { DEFAULT_ANALYSIS_OPTIONS } from "./types/analysis";

export type {
  GeometryWithMaterial,
  SlipSurface,
  Slice,
  SliceSolverState,
} from "./types/geometry";

export type { SlopeDefinition } from "./types/slope-definition";

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
  lineSegmentIntersection,
  createGeometryWithMaterial,
} from "./model/geometry-ops";

export { createSlice, getSlices } from "./model/slices";

export {
  generatePlanes,
  setEntryExitPlanes,
  addSingleEntryExitPlane,
  addSingleCircularPlane,
} from "./model/search";

export {
  analyseOrdinary,
  analyseBishop,
  analyseJanbu,
  analyseMorgensternPrice,
  analyseSlope,
} from "./model/solvers";

export { buildSlope } from "./model/build-slope";

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
} from "./model/canonical";
export type { SlopeOrientation } from "./model/canonical";
