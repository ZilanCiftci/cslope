/**
 * Barrel export for all engine types and constants.
 */

// Domain types
export { Material } from "./material";
export type { MaterialParams } from "./material";

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
  HoekBrownModel,
  ShansepModel,
  ShearNormalModel,
  TableSpline,
  DepthReference,
  UndrainedAnisotropy,
  UnsaturatedStrength,
} from "./material-models";
export { MATERIAL_MODEL_LABELS, isCombinedDepthModel, supportsAnisotropy, supportsSuctionStrength, suctionAngle } from "./material-models";
export { hoekBrownOf, hoekBrownParameters, instantaneousAtNormalStress, instantaneousAtSigma3, type HoekBrownParameters } from "./hoek-brown";

// Strength resolution
export {
  resolveStrength,
  suctionStrength,
  resolveUnitWeight,
  needsLayerTop,
  interpolateFunction,
} from "./strength";
export type { ResolvedStrength, StrengthContext } from "./strength";

// Validation
export { validateMaterialModel } from "./validation";

export type {
  Reinforcement,
  ReinforcementDirection,
  ReinforcementApplication,
  PileForceDirection,
  PileForceLocation,
  ReinforcementPullout,
  ReinforcementForce,
  Pile,
} from "./reinforcement";

export { Udl, LineLoad } from "./loads";
export type { UdlParams, UdlDirection, UdlExcessPorePressure, LineLoadParams } from "./loads";

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
} from "./analysis";
export { DEFAULT_ANALYSIS_OPTIONS, EC7_DA3_FACTORS, DEFAULT_FEM_SETTINGS, SAFETY_CLASS_GAMMA_D, swedishPartialFactors } from "./analysis";
export type { FemAnalysisSettings, FemResultSummary } from "./analysis";

export type {
  GeometryWithMaterial,
  SlipSurface,
  Slice,
  SliceSolverState,
} from "./geometry";

// Slope definition DTO
export type { SlopeDefinition, SlopeMaterialDefinition } from "./slope-definition";
export { materialModelOf, withMaterialModel } from "./slope-definition";

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
export type { Sgi3dOptions, Sgi3dResult, Sgi3dSettings, Sgi3dSurface } from "./sgi3d";
