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
