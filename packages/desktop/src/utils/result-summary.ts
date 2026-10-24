// Text helpers for the result summary.

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

/** Tooltip for {@link nonConvergedText}. */
export const NON_CONVERGED_TITLE =
  "For these trial surfaces the method found no factor of safety that satisfies equilibrium within the iteration limits, so they are left out of the minimum. A few are normal; many can point to a search range that reaches unrealistic surfaces.";
