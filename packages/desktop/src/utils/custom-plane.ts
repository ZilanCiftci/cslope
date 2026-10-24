import { getCircleLineIntersections, getSurfaceLine, isPointInPolygon } from "@cslope/engine";
import { surfaceYAtX } from "../features/view/surface";

type Pt = [number, number];

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A starting circle for a custom search plane that cuts through the slope:
 * the centre above the middle of the slope face, the radius reaching a
 * little below the toe (but not below the model's base).
 */
export function defaultCustomCircle(coordinates: Pt[]): {
  cx: number;
  cy: number;
  radius: number;
} {
  if (coordinates.length < 3) return { cx: 0, cy: 0, radius: 10 };
  const xs = coordinates.map((c) => c[0]);
  const ys = coordinates.map((c) => c[1]);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const width = xMax - xMin;
  if (!(width > 0)) return { cx: 0, cy: 0, radius: 10 };

  // Ground surface sampled across the model.
  const n = 100;
  const ground: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = xMin + (width * i) / n;
    const y = surfaceYAtX(coordinates, x);
    if (y !== null) ground.push([x, y]);
  }
  if (ground.length === 0) return { cx: 0, cy: 0, radius: 10 };
  const gMax = Math.max(...ground.map((g) => g[1]));
  const gMin = Math.min(...ground.map((g) => g[1]));
  const relief = gMax - gMin;
  const height = relief > 1e-6 ? relief : Math.max(width * 0.2, 1);

  // Middle of the slope face: where the ground is halfway between its
  // lowest and highest level (the model's centre on flat ground).
  const midLevel = (gMax + gMin) / 2;
  let cx = (xMin + xMax) / 2;
  if (relief > 1e-6) {
    for (let i = 1; i < ground.length; i++) {
      const [x0, y0] = ground[i - 1];
      const [x1, y1] = ground[i];
      if (y0 !== y1 && (y0 - midLevel) * (y1 - midLevel) <= 0) {
        cx = x0 + ((midLevel - y0) / (y1 - y0)) * (x1 - x0);
        break;
      }
    }
  }

  const cy = gMax + 0.5 * height;
  const bottom = Math.max(gMin - 0.25 * height, yMin + 0.05 * (gMax - yMin));
  const radius = Math.max(cy - bottom, 0.5);
  return { cx: round1(cx), cy: round1(cy), radius: round1(radius) };
}

/**
 * Where a prescribed circle enters and leaves the ground, as the analysis
 * takes them: of the circle's crossings with the ground surface on its
 * lower half (by x), the first where the lower arc goes from air into the
 * soil and the next where it comes out again. Null when there is no such
 * pair (the analysis then has no surface for the circle). A right-to-left
 * model (`mirrored`) is analysed mirrored, so its crossings are taken from
 * the right.
 */
export function circleEntryExit(
  coordinates: readonly Pt[],
  cx: number,
  cy: number,
  radius: number,
  mirrored = false,
): [Pt, Pt] | null {
  if (mirrored) {
    const ends = circleEntryExit(
      coordinates.map(([x, y]) => [-x, y] as Pt),
      -cx,
      cy,
      radius,
    );
    return ends && [[-ends[0][0], ends[0][1]], [-ends[1][0], ends[1][1]]];
  }
  if (coordinates.length < 3 || !(radius > 0)) return null;
  const px = coordinates.map((c) => c[0]);
  const py = coordinates.map((c) => c[1]);
  let surface: { x: number[]; y: number[] };
  try {
    surface = getSurfaceLine(px, py);
  } catch {
    return null;
  }
  const tol = 1e-9 * Math.max(1, radius);
  const all = getCircleLineIntersections(cx, cy, radius, surface.x, surface.y).sort((a, b) => a[0] - b[0]);
  const crossings = all
    .filter((p, i) => i === 0 || Math.abs(p[0] - all[i - 1][0]) > 1e-9 || Math.abs(p[1] - all[i - 1][1]) > 1e-9)
    .filter((p) => p[1] <= cy + tol);
  if (crossings.length < 2) return null;
  const eps = 1e-6 * Math.max(1, radius);
  const arcInSoil = (x: number): boolean => {
    const term = radius ** 2 - (x - cx) ** 2;
    if (term < 0) return false;
    return isPointInPolygon(x, cy - Math.sqrt(term), px, py);
  };
  for (let i = 0; i < crossings.length - 1; i++) {
    const [ex] = crossings[i];
    if (arcInSoil(ex - eps) || !arcInSoil(ex + eps)) continue;
    for (let j = i + 1; j < crossings.length; j++) {
      if (!arcInSoil(crossings[j][0] + eps)) return [crossings[i], crossings[j]];
    }
    return null;
  }
  return null;
}
