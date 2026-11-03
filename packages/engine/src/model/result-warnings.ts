/**
 * Warnings on an analysed slope: input the regions do not use as drawn,
 * and conditions on the critical surface under which the factor of safety
 * of a method of slices is open to question.
 */

import type { AnalysisWarning, Slice } from "../types/index";
import type { SearchPlane, Slope } from "./slope";
import { janbuCorrectionFactor, solvedEffectiveNormals } from "./solvers";
import { frictionalSurfaceSlide, surfaceSlideMessage } from "./surface-slide";

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

const BISHOP_NON_CIRCULAR_MESSAGE =
  "Bishop's simplified method is defined for circular surfaces (Bishop 1955); on a non-circular surface (also the part of a composite circle along a firm base) its factor of safety depends on the moment axis. Use Spencer or Morgenstern-Price for them.";

/** m_α of a slice at the factor of safety F (as the solvers form it). */
function mAlpha(s: Slice, fos: number): number {
  // A combined-method slice in equilibrium with its undrained strength has
  // tan φ = 0 in the equation that was solved.
  const tanPhi = s.undrainedGoverns ? 0 : Math.tan(s.phi);
  return Math.cos(s.alpha) + (Math.sin(s.alpha) * tanPhi) / fos;
}

/**
 * Entry inclination (degrees) from which a Morgenstern–Price or Spencer
 * surface without complete equilibrium is put down to its steep entry.
 */
export const STEEP_ENTRY_LIMIT = 70;

/**
 * Inclination of a surface at its entry (degrees, positive descending
 * into the slope): at the crack bottom when cut, on a circle from the
 * centre, on a polyline its first segment.
 */
export function entryInclination(p: SearchPlane): number {
  if (p.points && p.points.length >= 2) {
    const [[x0, y0], [x1, y1]] = p.points;
    return (Math.atan2(y0 - y1, x1 - x0) * 180) / Math.PI;
  }
  const x = (p.crack ?? p.lc)[0];
  return (Math.asin(Math.max(-1, Math.min(1, (p.cx - x) / p.radius))) * 180) / Math.PI;
}

/**
 * Morgenstern–Price or Spencer found no complete equilibrium (no solution,
 * or only the closest pair) on surfaces whose entry is steeper than
 * STEEP_ENTRY_LIMIT: the cohesion along a nearly vertical base can only
 * hold the slice with tension at its base (a negative normal force), and
 * the moment and force factors then need not meet. A tension crack at a
 * limiting base inclination cuts that part off. Null when this does not
 * apply (another method, a crack angle already set, no steep entry).
 *
 * `planes` are the surfaces concerned: the critical one when it is a
 * closest pair, or those without a factor when no surface has one.
 */
export function steepEntryMessage(slope: Slope, planes: readonly SearchPlane[]): string | null {
  if (slope.method !== "Morgenstern-Price" || slope.tensionCrackAngle > 0) return null;
  const steep = planes.map(entryInclination).filter((a) => a >= STEEP_ENTRY_LIMIT);
  if (steep.length === 0) return null;
  const angle = Math.max(...steep).toFixed(0);
  const what =
    planes.length === 1
      ? `the surface enters the slope at ${angle}°`
      : `${steep.length} of the surfaces enter the slope at up to ${angle}°`;
  return `Moment and force equilibrium do not meet where ${what}: cohesion along a nearly vertical base can only hold it with tension at the base. A tension crack cutting off the steep part (Options › Crack at base angle, for example 60–70°) usually gives a solution.`;
}

/**
 * The critical surface enters steeper than STEEP_ENTRY_LIMIT and slices on
 * its descending (entry) part have N′ < 0 or a low m_α: every method then
 * relies on tension at the base there, and Bishop and Janbu still give a
 * factor (on a φ = 0 slope with a vertical upper face 0.460 with Bishop,
 * against 0.426 with the steep part cut off at 70°; with c′ = 15 kPa and
 * φ′ = 25° 2.211 against 2.227). Null when it does not apply.
 */
export function steepEntryTensionMessage(slope: Slope, plane: SearchPlane, n: number): string | null {
  if (slope.tensionCrackAngle > 0 || n === 0) return null;
  const angle = entryInclination(plane);
  if (angle < STEEP_ENTRY_LIMIT) return null;
  return `The surface enters the slope at ${angle.toFixed(0)}° and ${n === 1 ? "a slice" : `${n} slices`} on its steep part rely on tension at the base (N′ < 0 or a low m_α), which soil cannot take; the factor of safety is then unreliable (higher or lower than with the steep part cut off). A tension crack cutting off the steep part (Options › Crack at base angle, for example 60–70°) removes it.`;
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
 * - "bishop-non-circular": Bishop's simplified method on a non-circular
 *   critical surface (a custom polyline or the non-circular optimisation).
 *   Bishop (1955) derived the method for a circle, on which the base
 *   normal forces pass through the centre. On a polyline the moment
 *   equation is taken about an axis point and the normal forces have
 *   moment arms (Fredlund and Krahn 1977); with no interslice shear,
 *   horizontal force equilibrium is not satisfied, so the factor depends
 *   on the axis. Spencer (1967) and Morgenstern and Price (1965) satisfy
 *   both and do not.
 * - "frictional-surface-slide": a face of the ground surface in soil with
 *   c′ = 0, dipping in the analysed direction within the search limits,
 *   whose infinite-slope factor tan φ′/tan β is below the critical
 *   surface's (surface-slide.ts); the search discards such thin slides.
 *
 * - "shallow-cohesionless-surface": the critical surface is a shallow
 *   slide, its base on average less than shallowDepthLimit (1 m, or a
 *   tenth of the ground relief around it when larger) below the ground,
 *   with at least half its base in cohesionless soil (c′ = 0, φ′ > 0, no
 *   undrained strength of a combined analysis): in a loose fill, a road bank's edge or a thin
 *   cohesionless layer the search finds such a slide before any deeper
 *   mechanism. Its factor may be the one sought; when the stability of
 *   the slope as a whole is, a minimum slip depth, sliding area or
 *   entry–exit distance (Options › Search) analyses the deeper surfaces.
 *   Not with "frictional-surface-slide", which already names the face.
 *
 * - "steep-entry-no-equilibrium": Morgenstern–Price or Spencer found no
 *   complete equilibrium on a surface entering steeper than
 *   STEEP_ENTRY_LIMIT (steepEntryMessage): the critical surface is a
 *   closest pair, or no surface has a factor at all.
 * - "steep-entry-tension": the critical surface enters steeper than
 *   STEEP_ENTRY_LIMIT and slices on its entry side rely on tension
 *   (N′ < 0 or low m_α), with any method (steepEntryTensionMessage).
 *
 * Only the critical surface is checked (all surfaces when none solved). `effectiveNormals` are its base
 * N′ when the caller already has them (solvedEffectiveNormals); otherwise
 * they are solved here.
 */
/** Warning text for a dangling boundary, numbered from 1 as the user knows it. */
export function danglingBoundaryMessage(n: number): string {
  return `Material boundary ${n} ends inside a region and does not split it; check its end points.`;
}

export function analysisWarnings(
  slope: Slope,
  effectiveNormals?: readonly number[] | null,
): AnalysisWarning[] {
  const warnings: AnalysisWarning[] = [];
  for (const i of slope.danglingBoundaries) {
    warnings.push({
      code: "dangling-boundary",
      message: danglingBoundaryMessage(i + 1),
      boundaryIndex: i,
    });
  }

  const crit = slope.search.find((p) => p.fos != null);
  if (crit && slope.method === "Bishop" && (crit.points || crit.composite)) {
    warnings.push({ code: "bishop-non-circular", message: BISHOP_NON_CIRCULAR_MESSAGE });
  }
  const slide = crit ? frictionalSurfaceSlide(slope, true) : null;
  const surfaceSlide = !!slide && slide.factorOfSafety < crit!.fos!;
  if (surfaceSlide) {
    warnings.push({ code: "frictional-surface-slide", message: surfaceSlideMessage(slide!, crit!.fos!) });
  }
  if (crit && crit.fos != null && !surfaceSlide && crit.slices && crit.slices.length > 0) {
    const shallow = shallowCohesionlessMessage(crit.slices, crit.fos, localRelief(slope, crit.slices));
    if (shallow) warnings.push({ code: "shallow-cohesionless-surface", message: shallow });
  }
  const steepEntry = crit
    ? crit.closestPair
      ? steepEntryMessage(slope, [crit])
      : null
    : steepEntryMessage(slope, slope.search.filter((p) => p.fos == null && p.converged === false && !p.belowMinSize));
  if (steepEntry) warnings.push({ code: "steep-entry-no-equilibrium", message: steepEntry });
  const slices = crit?.slices;
  if (!crit || !slices || slices.length === 0) return warnings;
  const fos = crit.fos!;

  const normals =
    effectiveNormals ?? solvedEffectiveNormals(slope, slices, fos, crit.lffArray);
  // Slices on the entry side (base descending into the slope) that rely
  // on tension at the base: N′ < 0 or a low m_α.
  const entryTension = new Set<number>();
  if (normals && normals.length > 0) {
    const scale = Math.max(...normals.map((n) => Math.abs(n)));
    const negative = normals.filter((n) => n < -NEGATIVE_NORMAL_TOLERANCE * scale).length;
    normals.forEach((n, i) => {
      if (n < -NEGATIVE_NORMAL_TOLERANCE * scale && slices[i]?.alpha > 0) entryTension.add(i);
    });
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
  slices.forEach((s, i) => {
    if (s.alpha > 0 && mAlpha(s, solvedFos) < M_ALPHA_WARNING_LIMIT) entryTension.add(i);
  });
  if (lowMAlpha > 0) {
    warnings.push({
      code: "low-m-alpha",
      message: `${slicesText(lowMAlpha, ["has", "have"])} m_α below ${M_ALPHA_WARNING_LIMIT} (steep base); the factor of safety may be unreliable.`,
      count: lowMAlpha,
    });
  }
  // Not with the Morgenstern–Price warning, which already names the entry.
  const tension = steepEntry ? null : steepEntryTensionMessage(slope, crit, entryTension.size);
  if (tension) warnings.push({ code: "steep-entry-tension", message: tension, count: entryTension.size });
  return warnings;
}

/**
 * The depth a critical surface's base must on average stay within to count
 * as shallow (m): 1 m, or a tenth of the ground relief around the surface
 * when larger.
 */
export function shallowDepthLimit(localRelief: number): number {
  return Math.max(1, 0.1 * localRelief);
}

/**
 * The ground relief around a surface: the range of the ground's height
 * over the surface's span and as far again on each side.
 */
function localRelief(slope: Slope, slices: readonly Slice[]): number {
  const g = slope.surfaceLineXY;
  if (!g || slices.length === 0) return 0;
  const a = slices[0].xLeft, b = slices[slices.length - 1].xRight, w = b - a;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < g.x.length; i++) {
    if (g.x[i] < a - w || g.x[i] > b + w) continue;
    lo = Math.min(lo, g.y[i]); hi = Math.max(hi, g.y[i]);
  }
  for (const s of slices) { lo = Math.min(lo, s.yTop); hi = Math.max(hi, s.yTop); }
  return hi > lo ? hi - lo : 0;
}

/** A slice base in cohesionless soil: c′ = 0 with friction, and no undrained strength of a combined analysis. */
const cohesionless = (s: Slice) => s.cohesion <= 0 && s.frictionAngle > 0 && !(s.cohesionUndrained > 0);

/**
 * The warning text when the critical surface, of these slices, is a
 * shallow slide mostly in cohesionless soil (see analysisWarnings), else
 * null. Its depth is the base's mean depth below the ground, weighted by
 * base length, so that a long thin surface counts with a deeper part.
 */
export function shallowCohesionlessMessage(slices: readonly Slice[], fos: number, relief: number): string | null {
  let base = 0, loose = 0, mean = 0, deepest = 0;
  let name: string | undefined;
  for (const s of slices) {
    const d = s.yTop - s.yBottom;
    base += s.baseLength; mean += d * s.baseLength; deepest = Math.max(deepest, d);
    if (cohesionless(s)) { loose += s.baseLength; name ??= s.baseMaterial?.name; }
  }
  if (!(base > 0)) return null;
  mean /= base;
  if (mean >= shallowDepthLimit(relief) || loose < 0.5 * base) return null;
  return (
    `The critical surface (F = ${fos.toFixed(3)}) is a shallow slide, on average ${mean.toFixed(2)} m and at most ${deepest.toFixed(2)} m below the ground, ` +
    `with ${Math.round((100 * loose) / base)} % of its base in cohesionless soil${name ? ` (${name})` : ""}. ` +
    "If the stability of the slope as a whole is sought, set a minimum slip depth, sliding area or entry–exit distance (Options › Search) to analyse the deeper surfaces."
  );
}
