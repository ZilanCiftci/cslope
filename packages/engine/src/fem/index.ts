export { meshDomain, pointInPolygon, type MeshInput, type TriMesh } from "./mesh";
export { SparseCholesky, nestedDissection } from "./sparse";
export {
  buildFeModel,
  solveElastic,
  gaussStrains,
  type FeModel,
  type FeModelOptions,
  type FeMaterialParameters,
} from "./model";
export {
  strengthReduction,
  davisB,
  type FlowRule,
  type SrmOptions,
  type SrmResult,
  type SrmTrial,
} from "./srm";
export { analyzeFem, type FemAnalysisOptions, type FemAnalysisResult, type FemMeshView, type FemLevel } from "./analysis";
export { zzIndicator, dissipationIndicator, dorflerMark, refinedSizeField } from "./adapt";
export { returnMap } from "./newton";
export { lowerBound, lowerBoundProblem, type LowerBoundOptions, type LowerBoundResult } from "./lower-bound";
export { upperBound, upperBoundProblem, type UpperBoundOptions, type UpperBoundResult } from "./upper-bound";
export { adaptiveBounds, boundGapIndicator, type AdaptiveBoundsOptions, type AdaptiveBoundsResult, type AdaptiveBoundsLevel, type BoundGap } from "./bound-adapt";
