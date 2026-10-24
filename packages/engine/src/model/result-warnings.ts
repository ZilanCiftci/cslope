/**
 * Warnings on an analysed slope: input the regions do not use as drawn,
 * and conditions on the critical surface under which the factor of safety
 * of a method of slices is open to question.
 */

import type { AnalysisWarning, Slice } from "../types/index";
import type { Slope } from "./slope";
import { janbuCorrectionFactor, solvedEffectiveNormals } from "./solvers";

/**
 * m_α below which a slice is reported. Whitman and Bailey (1967) found
 * that Bishop's method can give unrealistic normal forces, and a factor of
 * safety too high, where m_α = cos α (1 + tan α tan φ / F) on a slice is
 * less than about 0.2; Duncan and Wright (2014, ch. 6) recommend checking
 * m_α and treating such surfaces with caution. The same term is in the
 * normal force of every method here (Janbu, Morgenstern–Price).
 */
export const M_ALPHA_WARNING_LIMIT = 0.2;

/**
 * N′ below −NEGATIVE_NORMAL_TOLERANCE × the largest |N′| of the surface
 * counts as negative (a slice with N′ = 0 within rounding is not).
 */
const NEGATIVE_NORMAL_TOLERANCE = 1e-6;

/** m_α of a slice at the factor of safety F (as the solvers form it). */
function mAlpha(s: Slice, fos: number): number {
  // A combined-method slice in equilibrium with its undrained strength has
  // tan φ = 0 in the equation that was solved.
  const tanPhi = s.undrainedGoverns ? 0 : Math.tan(s.phi);
  return Math.cos(s.alpha) + (Math.sin(s.alpha) * tanPhi) / fos;
}

const slicesText = (n: number, verb: [string, string]) =>
  `${n} ${n === 1 ? "slice" : "slices"} of the critical surface ${n === 1 ? verb[0] : verb[1]}`;

/**
 * Warnings for an analysed slope (after analyseSlope):
 *
 * - "dangling-boundary": a material boundary with an end inside a region
 *   (off the outline and every other boundary after snapping) does not
 *   split it, so the layer it was meant to bound is not in the model.
 * - "negative-effective-normal": slices of the critical surface with
 *   N′ < 0 at the base. Tension at the base is not physical for soil; it
 *   usually means a tension crack is missing near the crest (Duncan and
 *   Wright 2014, ch. 6 and 14).
 * - "low-m-alpha": slices of the critical surface with m_α below
 *   M_ALPHA_WARNING_LIMIT (Whitman and Bailey 1967).
 *
 * Only the critical surface is checked. `effectiveNormals` are its base
 * N′ when the caller already has them (solvedEffectiveNormals); otherwise
 * they are solved here.
 */
export function analysisWarnings(
  slope: Slope,
  effectiveNormals?: readonly number[] | null,
): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  for (const i of slope.danglingBoundaries) {
    warnings.push({
      code: "dangling-boundary",
      message: `Material boundary ${i + 1} ends inside a region and does not split it; check its end points.`,
      boundaryIndex: i,
    });
  }

  const crit = slope.search.find((p) => p.fos != null);
  const slices = crit?.slices;
  if (!crit || !slices || slices.length === 0) return warnings;
  const fos = crit.fos!;

  const normals =
    effectiveNormals ?? solvedEffectiveNormals(slope, slices, fos, crit.lffArray);
  if (normals && normals.length > 0) {
    const scale = Math.max(...normals.map((n) => Math.abs(n)));
    const negative = normals.filter((n) => n < -NEGATIVE_NORMAL_TOLERANCE * scale).length;
    if (negative > 0) {
      warnings.push({
        code: "negative-effective-normal",
        message: `${slicesText(negative, ["has", "have"])} negative effective normal force (N′ < 0) at the base.`,
        count: negative,
      });
    }
  }

  // The factor the slices were solved at: Janbu's corrected factor is
  // f₀ times the one in the equations.
  const solvedFos =
    slope.method === "Janbu" && slope.janbuCorrection ? fos / janbuCorrectionFactor(slices) : fos;
  const lowMAlpha = slices.filter((s) => mAlpha(s, solvedFos) < M_ALPHA_WARNING_LIMIT).length;
  if (lowMAlpha > 0) {
    warnings.push({
      code: "low-m-alpha",
      message: `${slicesText(lowMAlpha, ["has", "have"])} m_α below ${M_ALPHA_WARNING_LIMIT} (steep base); the factor of safety may be unreliable.`,
      count: lowMAlpha,
    });
  }
  return warnings;
}
