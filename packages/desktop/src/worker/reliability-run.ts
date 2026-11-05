import {
  analyseReliability,
  analyseReliabilityAsync,
  reliabilitySurfaceToModelSpace,
  type EvaluatorPool,
  type ReliabilityResult,
} from "@cslope/engine";
import type { ReliabilityRequest } from "./messages";

/**
 * Probabilistic analysis of a request in the model's own sliding
 * direction. The request carries the canonical definition, as a normal run
 * does, so it is analysed as it is; the surface is mapped back to model
 * coordinates.
 */
export function runReliabilityRequest(
  req: Omit<ReliabilityRequest, "type" | "id">,
  onProgress?: (progress: number) => void,
): ReliabilityResult {
  const result = analyseReliability(req.slope, req.options, req.variables, {
    ...req.reliability,
    onProgress,
  });
  result.surface = reliabilitySurfaceToModelSpace(result.surface, req.slope);
  return result;
}

/**
 * runReliabilityRequest with the searches' trial surfaces and the Monte
 * Carlo samples spread over the pool's evaluators: the same result.
 */
export async function runReliabilityRequestParallel(
  req: Omit<ReliabilityRequest, "type" | "id">,
  pool: EvaluatorPool,
  onProgress?: (progress: number) => void,
): Promise<ReliabilityResult> {
  const result = await analyseReliabilityAsync(
    req.slope,
    req.options,
    req.variables,
    { ...req.reliability, onProgress },
    pool.reliabilityRunner(),
  );
  result.surface = reliabilitySurfaceToModelSpace(result.surface, req.slope);
  return result;
}
