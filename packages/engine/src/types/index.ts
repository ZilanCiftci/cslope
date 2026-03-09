/**
 * Barrel export for all engine types and constants.
 */

// Domain types
export { Material } from "./material";
export type { MaterialParams, MaterialType } from "./material";

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
} from "./material-models";
export { MATERIAL_MODEL_LABELS } from "./material-models";

// Strength resolution
export { resolveStrength, interpolateFunction } from "./strength";
export type { ResolvedStrength, StrengthContext } from "./strength";

// Validation
export { validateMaterialModel } from "./validation";

export { Udl, LineLoad } from "./loads";
export type { UdlParams, LineLoadParams } from "./loads";

export type {
  AnalysisMethod,
  IntersliceFunctionType,
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

// Slope definition DTO
export type { SlopeDefinition } from "./slope-definition";

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
