/**
 * The infinite-slope factor of safety of the ground surface where it lies in
 * a purely frictional soil (c′ = 0 at the surface, φ′ > 0).
 *
 * A slab of vanishing depth sliding parallel to a face inclined at β has
 * F = tan φ′ / tan β, whatever its depth, when the soil above the slip plane
 * is dry or submerged in still water (Duncan, Wright & Brandon 2014, Soil
 * Strength and Slope Stability, 2nd ed., § 6.2; a uniform surface load
 * changes the normal and shear stress alike). It is the limit of shallow
 * planar surfaces of the methods of slices and an upper bound of limit
 * analysis (with c = 0 the slab dissipates nothing). The searches miss it:
 * the methods of slices discard surfaces below the minimum slip area, and
 * a finite element mesh cannot represent a slab thinner than its elements
 * (on V052a, rockfill φ′ = 45° on a 30.9° face, F = 1.67 against 1.78 by
 * strength reduction and 1.88 in another program's verification manual).
 *
 * Implementation choices (not from the literature): the faces are the
 * segments of the ground surface line, each sampled at nine points; a
 * sample counts when the material just below it is Mohr–Coulomb (constant
 * or spatial) with c′ = 0 and φ′ > 0 at the surface (design values, partial
 * factors applied) and its water line lies below the surface there (a water
 * line above the ground is clipped to it, so still water over a face cannot
 * be told from seepage out of it, under which the factor would be lower and
 * depend on the flow). Faces steeper than 89.4° (dx < dy/100: steps and
 * walls) are skipped, as is a face that reinforcement or a pile reaches
 * (within 0.1 % of the model's extent), whose head or facing holds it. For
 * the methods of slices only faces dipping in the analysed direction and
 * within the search limits are checked (`slidingOnly`).
 */

import type { Slope } from "./slope";
import { isPointInPolygon } from "../math/polygon";
import { getYAtX } from "../math/interpolation";
import { designStrength } from "../types/strength";

/** Distance between segments ab and cd (zero when they cross). */
function segmentDistance(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const cross = (ox: number, oy: number, px: number, py: number, qx: number, qy: number) => (px - ox) * (qy - oy) - (py - oy) * (qx - ox);
  const d1 = cross(ax, ay, bx, by, cx, cy), d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay), d4 = cross(cx, cy, dx, dy, bx, by);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const toSeg = (px: number, py: number, sx: number, sy: number, ex: number, ey: number) => {
    const vx = ex - sx, vy = ey - sy, L2 = vx * vx + vy * vy;
    const t = L2 > 0 ? Math.min(1, Math.max(0, ((px - sx) * vx + (py - sy) * vy) / L2)) : 0;
    return Math.hypot(px - sx - t * vx, py - sy - t * vy);
  };
  return Math.min(toSeg(ax, ay, cx, cy, dx, dy), toSeg(bx, by, cx, cy, dx, dy), toSeg(cx, cy, ax, ay, bx, by), toSeg(dx, dy, ax, ay, bx, by));
}

export interface SurfaceSlide {
  /** tan φ′ / tan β of the face. */
  factorOfSafety: number;
  /** The face: its ends on the ground surface. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  material: string;
  /** Friction angle (design value) and the face's inclination, degrees. */
  frictionAngle: number;
  inclination: number;
}

/**
 * The face of the ground surface with the lowest infinite-slope factor, or
 * null when no face is in a frictional soil. Coordinates in model space (a
 * mirrored slope's x mirrored back). `slidingOnly`: only faces dipping
 * towards +x (the canonical sliding direction) between the entry and exit
 * limits, as the methods of slices search.
 */
export function frictionalSurfaceSlide(slope: Slope, slidingOnly = false): SurfaceSlide | null {
  const line = slope.surfaceLineXY;
  if (!line) return null;
  const { x: sx, y: sy } = line;
  const ext = slope.externalBoundaryXY;
  const xMin = Math.min(...ext.x), xMax = Math.max(...ext.x);
  const span = Math.max(xMax - xMin, Math.max(...ext.y) - Math.min(...ext.y));
  const eps = 1e-6 * span;
  const [entryLeft, , , exitRight] = slope.limits;
  const limited = slidingOnly && exitRight > entryLeft;
  const held = [...slope.reinforcements, ...slope.piles];
  let best: SurfaceSlide | null = null;
  for (let i = 0; i + 1 < sx.length; i++) {
    const x1 = sx[i], y1 = sy[i], x2 = sx[i + 1], y2 = sy[i + 1];
    const dx = Math.abs(x2 - x1), dy = Math.abs(y2 - y1);
    if (dx <= eps || dy <= eps || dx < dy / 100) continue;
    if (slidingOnly && (y2 - y1) * (x2 - x1) > 0) continue;
    if (held.some((r) => segmentDistance(x1, y1, x2, y2, r.x1, r.y1, r.x2, r.y2) <= 1e-3 * span)) continue;
    for (let k = 0; k < 9; k++) {
      const t = (k + 0.5) / 9, x = x1 + t * (x2 - x1), y = y1 + t * (y2 - y1);
      if (limited && (x < entryLeft || x > exitRight)) continue;
      const g = slope.materialGeometries.find((q) => isPointInPolygon(x, y - eps, q.px, q.py));
      if (!g) continue;
      const m = g.material, kind = m.model.kind;
      if (kind !== "mohr-coulomb" && kind !== "spatial-mohr-coulomb") continue;
      const st = m.getStrength({ yBottom: y, x, yGround: y, alpha: 0 });
      const d = designStrength(kind, st, slope.partialFactors);
      if (d.undrained || d.cohesion > 0 || !(d.tanPhi > 0) || (st.isCombined && Number.isFinite(d.cohesionUndrained))) continue;
      const wl = slope.getWaterLineForMaterial(m);
      const yw = wl ? getYAtX(wl.x, wl.y, x) : NaN;
      if (Number.isFinite(yw) && yw >= y) continue;
      const F = (d.tanPhi * dx) / dy;
      if (!best || F < best.factorOfSafety) {
        const mx = (v: number) => (slope.mirrored ? xMin + xMax - v : v);
        best = {
          factorOfSafety: F, x1: mx(x1), y1, x2: mx(x2), y2, material: m.name,
          frictionAngle: (Math.atan(d.tanPhi) * 180) / Math.PI, inclination: (Math.atan(dy / dx) * 180) / Math.PI,
        };
      }
      break;
    }
  }
  return best;
}

/** The warning text when the face's factor is below an analysis' factor of safety `F`. */
export function surfaceSlideMessage(s: SurfaceSlide, F: number): string {
  const f = (v: number) => v.toFixed(2);
  return `The ground surface from (${f(s.x1)}, ${f(s.y1)}) to (${f(s.x2)}, ${f(s.y2)}) in ${s.material} (c′ = 0, design φ′ = ${s.frictionAngle.toFixed(1)}°) is inclined at ${s.inclination.toFixed(1)}°: a shallow slide parallel to it has F = tan φ′/tan β = ${s.factorOfSafety.toFixed(3)}, below ${F.toFixed(3)}. The analysis cannot represent so thin a slide; the slope face governs.`;
}
