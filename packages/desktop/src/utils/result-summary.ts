// Text helpers for the result summary.
import type { CustomSurfaceResult } from "@cslope/engine";

/**
 * Number of analysed surfaces and how many of them have FOS below 1.0,
 * e.g. "1388 (12 below 1.0)". The largest FOS of the search says little
 * (small surfaces in cohesive soil reach any value), the share below 1.0
 * shows how widespread failure is.
 */
export function surfaceCountText(result: { allSurfaces: { fos: number }[] }): string {
  const n = result.allSurfaces.length;
  const below = result.allSurfaces.filter((s) => s.fos < 1).length;
  return below > 0 ? `${n} (${below} below 1.0)` : `${n}`;
}

/**
 * The warning for a Morgenstern-Price solution accepted at the closest
 * pair of moment and force factors: no λ satisfies both, so the factor of
 * safety meets moment equilibrium and force equilibrium only within the gap.
 */
export function equilibriumGapText(gap: number): string {
  return `No complete equilibrium: force equilibrium met within ${gap.toFixed(3)} (closest λ)`;
}

/**
 * The closest-pair warning for a surface, or null when it has complete
 * equilibrium. The engine marks such a Morgenstern-Price surface as not
 * converged (`converged: false`, `closestPair: true`) with its gap.
 */
export function closestPairWarning(
  surface: { closestPair?: boolean; equilibriumGap?: number } | null | undefined,
): string | null {
  if (!surface || (!surface.closestPair && surface.equilibriumGap == null)) return null;
  return surface.equilibriumGap != null
    ? equilibriumGapText(surface.equilibriumGap)
    : "No complete equilibrium: moment and force factors never met (closest λ)";
}

/**
 * The note for trial surfaces left out of the search because their
 * solution did not converge, e.g. "453 surfaces were discarded because
 * they did not reach equilibrium".
 */
export function nonConvergedText(count: number): string {
  return count === 1
    ? "1 surface was discarded because it did not reach equilibrium"
    : `${count} surfaces were discarded because they did not reach equilibrium`;
}

/**
 * The note for trial surfaces left out because they are smaller than the
 * minimum slip area or shallower than the minimum slip depth, e.g. "12
 * surfaces smaller than the minimum slip area were skipped".
 */
export function discardedBySizeText(count: number): string {
  return count === 1
    ? "1 surface smaller than the minimum slip area or depth was skipped"
    : `${count} surfaces smaller than the minimum slip area or depth were skipped`;
}

/** Tooltip for {@link discardedBySizeText}. */
export const DISCARDED_BY_SIZE_TITLE =
  "The minimum slip area and minimum slip depth set in the analysis options leave small surfaces out of the search. A small local failure, such as a low cut at the toe, can be among the skipped surfaces. Set both to 0 (no limit, the default) to include them.";

/** Tooltip for {@link nonConvergedText}. */
export const NON_CONVERGED_TITLE =
  "For these trial surfaces the method found no factor of safety that satisfies equilibrium within the iteration limits, so they are left out of the minimum. A few are normal; many can point to a search range that reaches unrealistic surfaces.";

/** The name of a custom search plane in the result, by its place in the result's list. */
export function customSurfaceName(index: number): string {
  return `Custom surface ${index + 1}`;
}

/** What a custom search plane is, as far as the result tells: its circle or polyline. */
export function customSurfaceGeometryText(c: CustomSurfaceResult): string {
  const s = c.surface;
  const fmt = (v: number) => v.toFixed(2);
  if (s && c.kind === "circle") return `circle, center (${fmt(s.cx)}, ${fmt(s.cy)}) m, radius ${fmt(s.radius)} m`;
  if (s?.points) return `non-circular, ${s.points.length} points`;
  return c.kind === "circle" ? "circle" : "non-circular";
}

/** The factor of safety of a custom search plane ("F = 1.234"), or why it has none. */
export function customSurfaceValueText(c: CustomSurfaceResult): string {
  return c.surface ? `F = ${c.surface.fos.toFixed(3)}` : `no solution: ${c.reason ?? "no factor of safety"}`;
}
