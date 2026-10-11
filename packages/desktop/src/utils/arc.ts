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

/** A slip surface as results carry it: a circle, or a polyline. */
export interface DrawableSurface {
  cx: number;
  cy: number;
  radius: number;
  entryPoint: [number, number];
  exitPoint: [number, number];
  /** Non-circular surface from entry to exit. */
  points?: [number, number][];
}

/** Points along the surface from entry to exit. */
export function surfacePoints(surf: DrawableSurface): [number, number][] {
  if (surf.points && surf.points.length >= 2) return surf.points;
  return circleArcPoints(surf.cx, surf.cy, surf.radius, surf.entryPoint, surf.exitPoint);
}

/** y of the surface at x (its lower arc for a circle), or null. */
export function surfaceBaseYAt(surf: DrawableSurface, x: number): number | null {
  if (surf.points && surf.points.length >= 2) {
    const pts = surf.points;
    const lo = Math.min(pts[0][0], pts[pts.length - 1][0]);
    const hi = Math.max(pts[0][0], pts[pts.length - 1][0]);
    if (x < lo - 1e-9 || x > hi + 1e-9) return null;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      if ((x - ax) * (x - bx) <= 0) {
        return bx === ax ? Math.min(ay, by) : ay + ((x - ax) / (bx - ax)) * (by - ay);
      }
    }
    return null;
  }
  const dx = x - surf.cx;
  if (Math.abs(dx) > surf.radius) return null;
  return surf.cy - Math.sqrt(surf.radius * surf.radius - dx * dx);
}

/** Whether two results describe the same surface. */
export function sameSurface(a: DrawableSurface, b: DrawableSurface): boolean {
  if (a.points || b.points) {
    return (
      !!a.points &&
      !!b.points &&
      a.points.length === b.points.length &&
      a.points.every((p, i) => p[0] === b.points![i][0] && p[1] === b.points![i][1])
    );
  }
  return a.cx === b.cx && a.cy === b.cy && a.radius === b.radius;
}
