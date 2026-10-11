import {
  analyseReliability,
  reliabilitySurfaceToModelSpace,
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
