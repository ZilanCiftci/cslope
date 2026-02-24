/**
 * Polygon area and point-in-polygon calculations.
 */

/**
 * Calculate the area of a polygon using the Shoelace formula.
 *
 * @param x - x-coordinates of the polygon vertices
 * @param y - y-coordinates of the polygon vertices
 * @returns Area of the polygon (always positive)
 */
export function calculatePolygonArea(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0.0;

  let area = 0.0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += x[i] * y[j];
    area -= x[j] * y[i];
  }
  return Math.abs(area) / 2.0;
}

/**
 * Determine if a point (px, py) is inside a polygon using ray casting.
 *
 * @param px - x-coordinate of the point
 * @param py - y-coordinate of the point
 * @param polyX - x-coordinates of the polygon vertices
 * @param polyY - y-coordinates of the polygon vertices
 * @returns true if the point is inside the polygon
 */
export function isPointInPolygon(
  px: number,
  py: number,
  polyX: number[],
  polyY: number[],
): boolean {
  const n = polyX.length;
  let inside = false;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (
      polyY[i] > py !== polyY[j] > py &&
      px <
        ((polyX[j] - polyX[i]) * (py - polyY[i])) /
          (polyY[j] - polyY[i] + 1e-15) +
          polyX[i]
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Clip a polygon by a half-plane ax + by + c >= 0 (Sutherland–Hodgman).
 *
 * @returns Clipped polygon as [x[], y[]]
 */
export function clipPolygonHalfplane(
  px: number[],
  py: number[],
  a: number,
  b: number,
  c: number,
): [number[], number[]] {
  const n = px.length;
  if (n === 0) return [[], []];

  const outX: number[] = [];
  const outY: number[] = [];

  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    const p1x = px[i],
      p1y = py[i];
    const p2x = px[k],
      p2y = py[k];

    const d1 = a * p1x + b * p1y + c;
    const d2 = a * p2x + b * p2y + c;

    const in1 = d1 >= -1e-12;
    const in2 = d2 >= -1e-12;

    if (in1) {
      if (in2) {
        // Both inside
        outX.push(p2x);
        outY.push(p2y);
      } else {
        // Leaving boundary: add intersection
        const dx = p2x - p1x;
        const dy = p2y - p1y;
        const denom = a * dx + b * dy;
        if (Math.abs(denom) > 1e-14) {
          const t = -d1 / denom;
          outX.push(p1x + t * dx);
          outY.push(p1y + t * dy);
        }
      }
    } else {
      if (in2) {
        // Entering boundary: add intersection then vertex
        const dx = p2x - p1x;
        const dy = p2y - p1y;
        const denom = a * dx + b * dy;
        if (Math.abs(denom) > 1e-14) {
          const t = -d1 / denom;
          outX.push(p1x + t * dx);
          outY.push(p1y + t * dy);
        }
        outX.push(p2x);
        outY.push(p2y);
      }
    }
  }

  return [outX, outY];
}

/**
 * Clip a polygon to a vertical strip [xMin, xMax].
 *
 * @returns Clipped polygon as [x[], y[]]
 */
export function clipPolygonVertical(
  polyX: number[],
  polyY: number[],
  xMin: number,
  xMax: number,
): [number[], number[]] {
  // Clip against xMin: x >= xMin  →  1·x + 0·y - xMin >= 0
  let [rx, ry] = clipPolygonHalfplane(polyX, polyY, 1.0, 0.0, -xMin);
  // Clip against xMax: x <= xMax  →  -1·x + 0·y + xMax >= 0
  if (rx.length > 0) {
    [rx, ry] = clipPolygonHalfplane(rx, ry, -1.0, 0.0, xMax);
  }
  return [rx, ry];
}
