/**
 * Implemented by the Rust engine (packages/engine-rs) through WebAssembly (see facade/internal.ts).
 */
import { wasm } from "../facade/internal";
/**
 * The generalised Hoek–Brown criterion for rock masses (Hoek, Carranza-
 * Torres & Corkum 2002, Proc. NARMS-TAC, 267–273):
 *
 *   σ1′ = σ3′ + σci (mb σ3′/σci + s)^a,  compression positive,
 *   mb = mi exp((GSI − 100)/(28 − 14D)),  s = exp((GSI − 100)/(9 − 3D)),
 *   a = 1/2 + (e^(−GSI/15) − e^(−20/3))/6,
 *
 * and its instantaneous Mohr–Coulomb parameters: the tangent to the Mohr
 * envelope at a normal stress, from the slope k = dσ1/dσ3 = 1 + a mb
 * (mb σ3/σci + s)^(a−1) of the principal stress envelope (Balmer 1952,
 * Proc. ASTM 52, 1260–1271; Hoek et al. 2002, eq. 4–5):
 *
 *   σn = (σ1 + σ3)/2 − (σ1 − σ3)/2 · (k − 1)/(k + 1),
 *   τ = (σ1 − σ3) √k/(k + 1),  sin φi = (k − 1)/(k + 1),  ci = τ − σn tan φi.
 *
 * Implementation choices (not from the literature): in tension (σ3 < 0,
 * or σn below its value at σ3 = 0) the tangent at σ3 = 0 is used: towards
 * the tensile strength σt = −s σci/mb the envelope turns vertical (φi →
 * 90°), and that tangent as a Mohr–Coulomb material would have an
 * unbounded compressive strength; σn is inverted by bisection on σ3 ≥ 0
 * with an upper bound doubled until it is passed.
 */

export interface HoekBrownParameters {
  /** Uniaxial compressive strength of the intact rock σci (kPa). */
  ucs: number;
  mb: number;
  s: number;
  a: number;
}

/** mb, s and a of the generalised criterion from GSI, mi and the disturbance D. */
export function hoekBrownParameters(ucs: number, gsi: number, mi: number, disturbance = 0): HoekBrownParameters {
  return wasm().hoek_brown_parameters(ucs, gsi, mi, disturbance);
}

/** mb, s and a of a material: given directly, or from GSI, mi and D. */
export function hoekBrownOf(model: { ucs: number; gsi: number; mi: number; disturbance?: number; mb?: number; s?: number; a?: number }): HoekBrownParameters {
  return wasm().hoek_brown_of(model);
}

/** Instantaneous c (kPa) and φ (°) of the envelope at σ3 (compression positive). */
export function instantaneousAtSigma3(p: HoekBrownParameters, s3: number): { cohesion: number; frictionAngle: number } {
  return wasm().instantaneous_at_sigma3(p, s3);
}

/** Instantaneous c (kPa) and φ (°) of the envelope at the normal stress σn (compression positive). */
export function instantaneousAtNormalStress(p: HoekBrownParameters, sn: number): { cohesion: number; frictionAngle: number } {
  return wasm().instantaneous_at_normal_stress(p, sn);
}
