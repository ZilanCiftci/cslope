/** Facade shim of types/material-models.ts (see facade/internal.ts). */
import { wasm } from "../internal";

// Data: kept as TypeScript (read at module load; the consistency test
// compares it with the engine's).
export { MATERIAL_MODEL_LABELS } from "../../types/material-models";

export function supportsSuctionStrength(kind: string): kind is "mohr-coulomb" | "anisotropic-function" | "s-f-depth" {
  return wasm().supports_suction_strength(kind);
}

export function suctionAngle(model: { kind: string; phiB?: number; drainedCohesion?: number; drainedFrictionAngle?: number }): number {
  return wasm().suction_angle(model);
}

export function supportsAnisotropy(kind: string): kind is "undrained" | "s-f-depth" | "s-f-datum" | "shansep" {
  return wasm().supports_anisotropy(kind);
}

export function isCombinedDepthModel(model: { kind: string; drainedCohesion?: number; drainedFrictionAngle?: number }): boolean {
  return wasm().is_combined_depth_model(model);
}
