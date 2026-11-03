/** Facade shim of types/strength.ts (see facade/internal.ts). */
import { testCall, wasm } from "../internal";
import type { MaterialModel, MaterialModelKind, TableSpline } from "../../types/material-models";
import type { PartialFactors } from "../../types/analysis";
import type { DesignStrength, ResolvedStrength, StrengthContext } from "../../types/strength";

export function needsLayerTop(model: MaterialModel): boolean {
  return wasm().needs_layer_top(model);
}

export function resolveStrength(model: MaterialModel, context: StrengthContext): ResolvedStrength {
  return wasm().resolve_strength(model, context);
}

export function suctionStrength(model: MaterialModel, suction: number): number {
  return wasm().suction_strength(model, suction);
}

export function resolveUnitWeight(model: MaterialModel, fallback: number, x: number, y: number): number {
  return wasm().resolve_unit_weight(model, fallback, x, y);
}

export function interpolateFunction(points: [number, number][], x: number): number {
  return wasm().interpolate_function(points, x);
}

// ── internal (testing build) ─────────────────────────────────────

export function designStrength(
  kind: MaterialModelKind | undefined,
  st: Pick<ResolvedStrength, "cohesion" | "frictionAngle" | "cohesionUndrained" | "isCombined" | "cohesionUndrainedPart" | "suctionStrength">,
  f: PartialFactors | null | undefined,
): DesignStrength {
  return testCall("types/strength::designStrength", [kind, st, f]);
}

export function shearNormalAt(model: { points: readonly [number, number][]; spline?: TableSpline }, sn: number): { cohesion: number; frictionAngle: number } {
  return testCall("types/strength::shearNormalAt", [model, sn]);
}

export function shansepSu(
  model: Extract<MaterialModel, { kind: "shansep" }>,
  context: Pick<StrengthContext, "yBottom" | "yGround" | "effectiveVerticalStress">,
): number {
  return testCall("types/strength::shansepSu", [model, context]);
}
