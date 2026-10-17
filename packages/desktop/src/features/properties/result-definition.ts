import {
  oppositeDirectionDefinition,
  type AnalysisResult,
  type SlopeDefinition,
} from "@cslope/engine";
import { buildSlopeDTOFromModel } from "../../store/helpers";
import type { ModelEntry, ModelOrientation } from "../../store/types";

/**
 * The definition a result's surfaces were found in, with the direction of
 * sliding: the model's own, or the opposite one when the search of both
 * directions found it lower (its slices must be rebuilt in that direction).
 */
export function resultDefinition(
  model: ModelEntry,
  result: AnalysisResult,
): { slopeDef: SlopeDefinition; orientation: ModelOrientation } {
  const canonical = buildSlopeDTOFromModel(model);
  const own: ModelOrientation = canonical.orientation === "rtl" ? "rtl" : "ltr";
  if (result.slidingDirection && result.slidingDirection !== own) {
    return {
      slopeDef: oppositeDirectionDefinition(canonical),
      orientation: result.slidingDirection,
    };
  }
  return { slopeDef: canonical, orientation: own };
}
