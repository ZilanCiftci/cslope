/**
 * Compute points along a circular arc passing through entry/exit points around a center.
 * Returns [x,y] tuples (used by canvas, plot, and PDF export).
 */
export function circleArcPoints(
  cx: number,
  cy: number,
  radius: number,
  entry: [number, number],
  exit: [number, number],
  nPoints = 60,
): [number, number][] {
  const startAngle = Math.atan2(entry[1] - cy, entry[0] - cx);
  let endAngle = Math.atan2(exit[1] - cy, exit[0] - cx);

  // Normalise so sweep is counterclockwise (positive)
  if (endAngle <= startAngle) {
    endAngle += 2 * Math.PI;
  }

  // Choose the arc that passes below the centre (failure surface)
  const midAngle = (startAngle + endAngle) / 2;
  const midY = cy + radius * Math.sin(midAngle);
  if (midY > cy) {
    endAngle -= 2 * Math.PI;
  }

  const pts: [number, number][] = [];
  for (let i = 0; i <= nPoints; i++) {
    const t = i / nPoints;
    const angle = startAngle + t * (endAngle - startAngle);
    pts.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return pts;
}
