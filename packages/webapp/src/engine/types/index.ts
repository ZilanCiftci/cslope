/**
 * Barrel export for all engine types and constants.
 */

// Domain types
export { Material } from "./material";
export type { MaterialParams, MaterialType } from "./material";

export { Udl, LineLoad } from "./loads";
export type { UdlParams, LineLoadParams } from "./loads";

export type {
  AnalysisMethod,
  AnalysisOptions,
  AnalysisResult,
  AnalysisLimits,
  SlipSurfaceResult,
  SliceData,
  WaterTableInput,
} from "./analysis";
export { DEFAULT_ANALYSIS_OPTIONS } from "./analysis";

export type {
  GeometryWithMaterial,
  SlipSurface,
  Slice,
  SliceSolverState,
} from "./geometry";

// Constants
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
} from "./constants";
