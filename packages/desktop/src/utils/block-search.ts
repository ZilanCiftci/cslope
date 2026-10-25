/** Helpers for block search objects (one point, a line or a window). */

/** What an object of n points is. */
export function blockObjectKind(n: number): string {
  if (n === 0) return "empty";
  if (n === 1) return "point";
  if (n === 2) return "line";
  return "window";
}

/** Whether a window (three or more points) encloses an area. */
function hasArea(points: [number, number][]): boolean {
  let area = 0;
  for (let k = 0, j = points.length - 1; k < points.length; j = k++) {
    area += points[j][0] * points[k][1] - points[k][0] * points[j][1];
  }
  return Math.abs(area) > 1e-12;
}

/** Why the object cannot be used, or null. */
export function blockObjectProblem(points: [number, number][]): string | null {
  if (points.length === 2 && points[0][0] === points[1][0] && points[0][1] === points[1][1]) {
    return "The two ends of the line coincide.";
  }
  if (points.length >= 3 && !hasArea(points)) return "The window has no area.";
  return null;
}
