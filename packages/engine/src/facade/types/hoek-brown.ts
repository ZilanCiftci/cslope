/** Facade shim of types/hoek-brown.ts (see facade/internal.ts). */
import { wasm } from "../internal";
import type { HoekBrownParameters } from "../../types/hoek-brown";

export function hoekBrownParameters(ucs: number, gsi: number, mi: number, disturbance = 0): HoekBrownParameters {
  return wasm().hoek_brown_parameters(ucs, gsi, mi, disturbance);
}

export function hoekBrownOf(model: { ucs: number; gsi: number; mi: number; disturbance?: number; mb?: number; s?: number; a?: number }): HoekBrownParameters {
  return wasm().hoek_brown_of(model);
}

export function instantaneousAtSigma3(p: HoekBrownParameters, s3: number): { cohesion: number; frictionAngle: number } {
  return wasm().instantaneous_at_sigma3(p, s3);
}

export function instantaneousAtNormalStress(p: HoekBrownParameters, sn: number): { cohesion: number; frictionAngle: number } {
  return wasm().instantaneous_at_normal_stress(p, sn);
}
