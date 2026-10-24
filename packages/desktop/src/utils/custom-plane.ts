import { getCircleLineIntersections, getSurfaceLine, isPointInPolygon } from "@cslope/engine";
import { surfaceYAtX } from "../features/view/surface";
import type { ModelOrientation } from "../store/types";

type Pt = [number, number];

const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * A starting circle for a custom search plane that cuts through the slope:
 * the centre above the middle of the slope face, the radius reaching a
 * little below the toe (but not below the model's base). The slope face is
 * the one that falls in the sliding direction given by the orientation
 * (left to right: the ground drops as x increases; right to left: as x
 * decreases), so the circle is one the engine analyses.
 */
export function defaultCustomCircle(
  coordinates: Pt[],
  orientation: ModelOrientation = "ltr",
): {
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

  // A ground that only falls the other way has no face the engine would
  // analyse; then the face falling the other way is used, as before.
  const face =
    fallingFace(ground, orientation) ??
    fallingFace(ground, orientation === "ltr" ? "rtl" : "ltr");
  const toe = face ? face.toe : gMin;
  const relief = face ? face.top - face.toe : 0;
  const height = relief > 1e-6 ? relief : Math.max(width * 0.2, 1);
  // Middle of the slope face (the model's centre on flat ground).
  const cx = face && relief > 1e-6 ? face.mid : (xMin + xMax) / 2;

  const cy = gMax + 0.5 * height;
  const bottom = Math.max(toe - 0.25 * height, yMin + 0.05 * (gMax - yMin));
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

/**
 * The stretch of sampled ground that falls furthest in the sliding
 * direction: its crest and toe levels and the x where it passes halfway
 * between them. Level stretches (benches) do not end a stretch; a rise does.
 */
function fallingFace(
  ground: Pt[],
  orientation: ModelOrientation,
): { top: number; toe: number; mid: number } | null {
  // The ground in the order a sliding mass moves over it.
  const pts = orientation === "ltr" ? ground : [...ground].reverse();
  // Split the ground where it rises; each stretch runs from a local crest
  // down to the next low point.
  const runs: [number, number][] = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i][1] > pts[i - 1][1] + 1e-9) {
      runs.push([start, i - 1]);
      start = i;
    }
  }
  runs.push([start, pts.length - 1]);
  let s0 = -1;
  let s1 = -1;
  let bestDrop = 1e-6;
  for (const [a, b] of runs) {
    const drop = pts[a][1] - pts[b][1];
    if (drop > bestDrop) {
      [s0, s1] = [a, b];
      bestDrop = drop;
    }
  }
  if (s0 < 0) return null;
  const top = pts[s0][1];
  const toe = pts[s1][1];
  const level = (top + toe) / 2;
  let mid = (pts[s0][0] + pts[s1][0]) / 2;
  for (let i = s0 + 1; i <= s1; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (y0 !== y1 && (y0 - level) * (y1 - level) <= 0) {
      mid = x0 + ((level - y0) / (y1 - y0)) * (x1 - x0);
      break;
    }
  }
  return { top, toe, mid };
}
