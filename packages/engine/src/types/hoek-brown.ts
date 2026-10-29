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
  const D = disturbance;
  return {
    ucs,
    mb: mi * Math.exp((gsi - 100) / (28 - 14 * D)),
    s: Math.exp((gsi - 100) / (9 - 3 * D)),
    a: 0.5 + (Math.exp(-gsi / 15) - Math.exp(-20 / 3)) / 6,
  };
}

/** The envelope at σ3 (compression positive): σn, τ and the slope k. */
function atSigma3(p: HoekBrownParameters, s3: number): { sn: number; tau: number; k: number } {
  const base = Math.max(1e-12, (p.mb * s3) / p.ucs + p.s);
  const s1 = s3 + p.ucs * base ** p.a;
  const k = 1 + p.a * p.mb * base ** (p.a - 1);
  return { sn: (s1 + s3) / 2 - ((s1 - s3) / 2) * ((k - 1) / (k + 1)), tau: ((s1 - s3) * Math.sqrt(k)) / (k + 1), k };
}

const MAX_PHI = (89.9 * Math.PI) / 180;

/** Instantaneous c (kPa) and φ (°) of the envelope at σ3 (compression positive). */
export function instantaneousAtSigma3(p: HoekBrownParameters, s3: number): { cohesion: number; frictionAngle: number } {
  const e = atSigma3(p, Math.max(s3, 0));
  const phi = Math.min(MAX_PHI, Math.asin((e.k - 1) / (e.k + 1)));
  return { cohesion: Math.max(0, e.tau - e.sn * Math.tan(phi)), frictionAngle: (phi * 180) / Math.PI };
}

/** Instantaneous c (kPa) and φ (°) of the envelope at the normal stress σn (compression positive). */
export function instantaneousAtNormalStress(p: HoekBrownParameters, sn: number): { cohesion: number; frictionAngle: number } {
  let lo = 0;
  if (!(sn > atSigma3(p, lo).sn)) return instantaneousAtSigma3(p, lo);
  let hi = Math.max(1, Math.abs(sn));
  while (atSigma3(p, hi).sn < sn) hi *= 2;
  for (let k = 0; k < 100 && hi - lo > 1e-10 * (1 + Math.abs(hi)); k++) {
    const m = (lo + hi) / 2;
    if (atSigma3(p, m).sn < sn) lo = m;
    else hi = m;
  }
  return instantaneousAtSigma3(p, (lo + hi) / 2);
}
