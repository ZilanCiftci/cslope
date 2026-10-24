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
