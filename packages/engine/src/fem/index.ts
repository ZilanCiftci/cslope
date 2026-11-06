export type { MeshInput, TriMesh } from "./mesh";
export {
  buildFeModel,
  solveElastic,
  type FeModel,
  type FeModelOptions,
  type FeMaterialParameters,
} from "./model";
export {
  strengthReduction,
  type FlowRule,
  type SrmOptions,
  type SrmResult,
  type SrmTrial,
} from "./srm";
export { analyzeFem, type FemAnalysisOptions, type FemAnalysisResult, type FemMeshView, type FemLevel } from "./analysis";
export { zzIndicator, dorflerMark, refinedSizeField } from "./adapt";
export { lowerBound, type LowerBoundOptions, type LowerBoundResult } from "./lower-bound";
export { upperBound, type UpperBoundOptions, type UpperBoundResult } from "./upper-bound";
export { adaptiveBounds, boundGapIndicator, type AdaptiveBoundsOptions, type AdaptiveBoundsResult, type AdaptiveBoundsLevel, type BoundGap } from "./bound-adapt";
