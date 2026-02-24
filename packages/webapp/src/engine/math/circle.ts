/**
 * Circle geometry calculations.
 *
 * Mirrors Python: math_utils.get_circle_y_coordinate_at_x,
 * math_utils.get_circle_line_intersections,
 * utilities.circle_radius_from_abcd, utilities.circle_centre,
 * utilities.generate_circle_coordinates,
 * utilities.get_circle_polygon_intersection
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
  return cy - Math.sqrt(radius * radius - (x - cx) * (x - cx));
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
 * Get the intersection points of a circle and a polygon boundary.
 * Pure-math implementation (no Shapely).
 *
 * @param cx - Circle center x
 * @param cy - Circle center y
 * @param radius - Circle radius
 * @param x - x-coordinates of the polygon/polyline
 * @param y - y-coordinates of the polygon/polyline
 * @returns Sorted, deduplicated intersection points
 */
export function getCirclePolygonIntersection(
  cx: number,
  cy: number,
  radius: number,
  x: number[],
  y: number[],
): [number, number][] {
  const tolerance = 1e-9;
  const intersectionPoints: [number, number][] = [];

  for (let ii = 0; ii < x.length - 1; ii++) {
    const x1 = x[ii],
      y1 = y[ii];
    const x2 = x[ii + 1],
      y2 = y[ii + 1];

    if (x1 === x2 && y1 === y2) continue;

    // Handle vertical lines
    if (Math.abs(x2 - x1) < tolerance) {
      const dx = x1 - cx;
      if (Math.abs(dx) > radius) continue;
      const disc = radius * radius - dx * dx;
      if (disc < 0) continue;
      const sqrtDisc = Math.sqrt(disc);
      const yi1 = cy + sqrtDisc;
      const yi2 = cy - sqrtDisc;

      const yMin = Math.min(y1, y2);
      const yMax = Math.max(y1, y2);
      if (yMin - tolerance <= yi1 && yi1 <= yMax + tolerance) {
        intersectionPoints.push([x1, yi1]);
      }
      if (
        Math.abs(sqrtDisc) > tolerance &&
        yMin - tolerance <= yi2 &&
        yi2 <= yMax + tolerance
      ) {
        intersectionPoints.push([x1, yi2]);
      }
      continue;
    }

    // Non-vertical line: y = m * x + b
    const m = (y2 - y1) / (x2 - x1);
    const b = y1 - m * x1;

    const A = 1 + m * m;
    const B = 2 * (m * b - m * cy - cx);
    const C = cx * cx + (b - cy) * (b - cy) - radius * radius;
    const discriminant = B * B - 4 * A * C;

    if (discriminant < -tolerance) continue;

    const xMin = Math.min(x1, x2);
    const xMax = Math.max(x1, x2);

    if (Math.abs(discriminant) <= tolerance) {
      // Tangent
      const xi = -B / (2 * A);
      const yi = m * xi + b;
      if (xMin - tolerance <= xi && xi <= xMax + tolerance) {
        intersectionPoints.push([xi, yi]);
      }
    } else {
      const sqrtD = Math.sqrt(discriminant);
      const xi1 = (-B + sqrtD) / (2 * A);
      const yi1 = m * xi1 + b;
      const xi2 = (-B - sqrtD) / (2 * A);
      const yi2 = m * xi2 + b;

      if (xMin - tolerance <= xi1 && xi1 <= xMax + tolerance) {
        intersectionPoints.push([xi1, yi1]);
      }
      if (xMin - tolerance <= xi2 && xi2 <= xMax + tolerance) {
        intersectionPoints.push([xi2, yi2]);
      }
    }
  }

  // Deduplicate
  const unique: [number, number][] = [];
  for (const pt of intersectionPoints) {
    let isDuplicate = false;
    for (const u of unique) {
      if (
        Math.abs(pt[0] - u[0]) < tolerance &&
        Math.abs(pt[1] - u[1]) < tolerance
      ) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) unique.push(pt);
  }

  // Sort by x
  unique.sort((a, b) => a[0] - b[0]);
  return unique;
}

/**
 * Calculate circle radius from intersecting chord property.
 * a * b = c * d  →  R = (C + c²) / (2c)
 */
export function circleRadiusFromAbcd(cToE: number, C: number): number {
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
  for (let i = 0; i < numPoints; i++) {
    const angle = ((1 + (i * 178) / (numPoints - 1)) * Math.PI) / 180;
    x.push(Math.round((cx - Math.cos(angle) * radius) * 1000) / 1000);
    y.push(Math.round((cy - Math.sin(angle) * radius) * 1000) / 1000);
  }
  return [x, y];
}
