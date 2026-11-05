/**
 * Parallel evaluation of the trial surfaces of one analysis: a coordinator
 * runs the search (EvaluatorPool) and evaluators evaluate its batches
 * (serveEvaluator), over any message channel (webEndpoint for the
 * browser's ports and workers).
 */

export { EvaluatorPool, type EvaluatorPoolOptions } from "./pool";
export { buildAnalysisSlope, serveEvaluator } from "./evaluator";
export {
  applyEvaluatedPlane,
  planeWithoutSlices,
  webEndpoint,
  type CoordinatorEndpoint,
  type Endpoint,
  type EvaluatorEndpoint,
  type FromEvaluator,
  type MessageTarget,
  type ToEvaluator,
} from "./protocol";
