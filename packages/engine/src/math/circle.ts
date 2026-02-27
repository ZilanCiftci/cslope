/**
 * Circle geometry calculations.
 */

/**
 * Get the y-coordinate on the bottom of a circle at a given x.
 *
 * @param cx - Circle center x
 * @param cy - Circle center y
 * @param radius - Circle radius
 * @param x - x-coordinate to query
 * @returns y-coordinate on the lower arc
 */
export function getCircleYCoordinateAtX(
  cx: number,
  cy: number,
  radius: number,
  x: number,
): number {
  return cy - Math.sqrt(Math.max(0, radius * radius - (x - cx) * (x - cx)));
}

/**
 * Get intersections between a circle and a polyline.
 *
 * @returns Array of [x, y] intersection points
 */
export function getCircleLineIntersections(
  cx: number,
  cy: number,
  r: number,
  px: number[],
  py: number[],
): [number, number][] {
  const intersections: [number, number][] = [];
  const r2 = r * r;

  for (let i = 0; i < px.length - 1; i++) {
    const x1 = px[i],
      y1 = py[i];
    const x2 = px[i + 1],
      y2 = py[i + 1];

    const dx = x2 - x1;
    const dy = y2 - y1;

    if (Math.abs(dx) < 1e-12 && Math.abs(dy) < 1e-12) continue;

    const a = dx * dx + dy * dy;
    const f1 = x1 - cx;
    const f2 = y1 - cy;
    const b = 2 * (dx * f1 + dy * f2);
    const c = f1 * f1 + f2 * f2 - r2;

    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) continue;

    const sqrtDisc = Math.sqrt(discriminant);
    const t1 = (-b + sqrtDisc) / (2 * a);
    const t2 = (-b - sqrtDisc) / (2 * a);

    if (t1 >= 0.0 && t1 <= 1.0) {
      intersections.push([x1 + t1 * dx, y1 + t1 * dy]);
    }
    if (discriminant > 1e-12 && t2 >= 0.0 && t2 <= 1.0) {
      intersections.push([x1 + t2 * dx, y1 + t2 * dy]);
    }
  }

  return intersections;
}

/**
 * Calculate circle radius from intersecting chord property.
 * a * b = c * d  →  R = (C + c²) / (2c)
 */
export function circleRadiusFromAbcd(cToE: number, C: number): number | null {
  if (Math.abs(cToE) < 1e-12) return null;
  return (C + cToE * cToE) / (2 * cToE);
}

/**
 * Calculate circle centre from chord intersection.
 */
export function circleCentre(
  beta: number,
  chordIntersection: [number, number],
  chordToCentre: number,
): [number, number] {
  const dy = Math.cos(beta) * chordToCentre;
  const dx = Math.sin(beta) * chordToCentre;
  return [chordIntersection[0] + dx, chordIntersection[1] + dy];
}

/**
 * Generate coordinates around the bottom half of a circle circumference.
 *
 * @param cx - Circle center x
 * @param cy - Circle center y
 * @param radius - Circle radius
 * @param numPoints - Number of points (default: 90)
 * @returns [x[], y[]] arrays
 */
export function generateCircleCoordinates(
  cx: number,
  cy: number,
  radius: number,
  numPoints: number = 90,
): [number[], number[]] {
  const x: number[] = [];
  const y: number[] = [];
  if (numPoints < 2) {
    const angle = Math.PI / 2;
    x.push(Math.round((cx - Math.cos(angle) * radius) * 1000) / 1000);
    y.push(Math.round((cy - Math.sin(angle) * radius) * 1000) / 1000);
    return [x, y];
  }
  for (let i = 0; i < numPoints; i++) {
    const angle = ((1 + (i * 178) / (numPoints - 1)) * Math.PI) / 180;
    x.push(Math.round((cx - Math.cos(angle) * radius) * 1000) / 1000);
    y.push(Math.round((cy - Math.sin(angle) * radius) * 1000) / 1000);
  }
  return [x, y];
}
