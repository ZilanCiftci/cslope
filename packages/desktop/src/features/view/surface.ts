/**
 * Canonical surface-Y-at-X interpolation.
 *
 * Single implementation replacing the previous duplicates in
 * `canvas/helpers.ts` (`surfaceYAtXFromCoordinates`) and
 * `pdf/pdf-helpers.ts` (`surfaceYAtX`).
 */

type Coord = [number, number];

/**
 * Interpolate the highest surface Y coordinate at a given X from a
 * coordinate polyline (external boundary).
 *
 * Walks every segment in order, treating the polyline as closed
 * (last→first wraps). Returns `null` when X falls outside all segments
 * or the coordinate list is empty.
 */
export function surfaceYAtX(coordinates: Coord[], x: number): number | null {
  let bestY: number | null = null;
  for (let i = 0; i < coordinates.length; i++) {
    const [x0, y0] = coordinates[i];
    const [x1, y1] = coordinates[(i + 1) % coordinates.length];
    if ((x0 <= x && x <= x1) || (x1 <= x && x <= x0)) {
      if (x1 === x0) continue;
      const t = (x - x0) / (x1 - x0);
      const y = y0 + t * (y1 - y0);
      if (bestY === null || y > bestY) bestY = y;
    }
  }
  return bestY;
}
