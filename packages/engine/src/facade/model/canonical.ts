/** Facade shim of model/canonical.ts (see facade/internal.ts). */
import { list, pt, shareUnchanged, wasm } from "../internal";
import type { AnalysisLimits, AnalysisResult } from "../../types/analysis";
import type { SlopeDefinition } from "../../types/slope-definition";
import type { SlopeOrientation } from "../../model/canonical";

export function mirrorX(x: number, xMin: number, xMax: number): number {
  return wasm().mirror_x(x, xMin, xMax);
}

export function mirrorPoint(point: [number, number], xMin: number, xMax: number): [number, number] {
  return pt(wasm().mirror_point(point[0], point[1], xMin, xMax));
}

export function mirrorPoints(points: [number, number][], xMin: number, xMax: number): [number, number][] {
  return wasm().mirror_points(points, xMin, xMax);
}

export function getDomainX(coordinates: [number, number][]): [number, number] {
  return pt(list(wasm().get_domain_x(coordinates)));
}

export function inferOrientationFromCoordinates(coordinates: [number, number][]): SlopeOrientation {
  return wasm().infer_orientation_from_coordinates(coordinates);
}

export function resolveOrientation(orientation: SlopeOrientation | undefined, coordinates: [number, number][]): SlopeOrientation {
  return wasm().resolve_orientation(orientation, coordinates);
}

export function mirrorLimits(limits: AnalysisLimits, xMin: number, xMax: number): AnalysisLimits {
  return wasm().mirror_limits(limits, xMin, xMax);
}

export function toCanonicalSlopeDefinition(slopeDefinition: SlopeDefinition, mirrorRange?: [number, number]): SlopeDefinition {
  return shareUnchanged(slopeDefinition, wasm().to_canonical_slope_definition(slopeDefinition, mirrorRange));
}

export function oppositeDirectionDefinition(canonical: SlopeDefinition): SlopeDefinition {
  return shareUnchanged(canonical, wasm().opposite_direction_definition(canonical));
}

export function mapAnalysisResultToModelSpace(analysisResult: AnalysisResult, canonicalSlopeDefinition: SlopeDefinition): AnalysisResult {
  return shareUnchanged(analysisResult, wasm().map_analysis_result_to_model_space(analysisResult, canonicalSlopeDefinition));
}
