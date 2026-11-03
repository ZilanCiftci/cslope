/**
 * Composite circular slip surfaces: a circle that reaches impenetrable
 * material (bedrock) follows its top instead of entering it, and,
 * optionally (compositeBase), the base of the model likewise, as commercial programs and the literature treat a circle on
 * a firm base (Duncan & Wright 2014, ch. 6: composite surfaces; the "lera
 * på fast botten" of Swedish practice). The part along the floor is a
 * straight-based polyline, analysed about the circle's centre with the
 * moment arms of its normal forces, as a non-circular surface.
 */

import type { GeometryWithMaterial } from "../types/index";
import type { Pt } from "./surface";

/**
 * The floor of the model: the base of the model and the impenetrable
 * regions stacked on it (bedrock), as a polyline from left to right.
 * A vertical step (the side of a rock step) is two points with the same x.
 */
export interface CompositeFloor {
  pts: Pt[];
  /**
   * The x ranges where the floor is the bare base of the model (no
   * impenetrable material on it); empty when the base is followed
   * (compositeBase). A circle below the floor there is not analysed.
   */
  bare: [number, number][];
}

/**
 * The lowest and highest y where the vertical line at x crosses the
 * polygon's boundary; null when it does not. x must not be a vertex (the
 * callers query just beside the vertices).
 */
function verticalRange(px: readonly number[], py: readonly number[], x: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const n = px.length;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const xa = px[i], xb = px[j];
    if (xa === xb) continue;
    if ((x - xa) * (x - xb) > 0) continue;
    const y = py[i] + ((x - xa) / (xb - xa)) * (py[j] - py[i]);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The floor of a model (see CompositeFloor). Null when the boundary is
 * degenerate, or when there is nothing to follow (no impenetrable material
 * on the base and the base itself is not followed).
 */
export function compositeFloor(
  boundary: { x: readonly number[]; y: readonly number[] },
  geometries: readonly GeometryWithMaterial[],
  /** Whether the bare base of the model is part of the floor. */
  followBase = true,
): CompositeFloor | null {
  const bx = boundary.x, by = boundary.y;
  if (bx.length < 3) return null;
  const x0 = Math.min(...bx), x1 = Math.max(...bx);
  if (!(x1 > x0)) return null;
  const rock = geometries.filter((g) => g.material.model.kind === "impenetrable");
  const delta = 1e-9 * (x1 - x0);
  const ys = [...by, ...rock.flatMap((g) => g.py)];
  const touch = 1e-6 * Math.max(1, Math.max(...ys) - Math.min(...ys));

  // The floor at x: from the base of the model up through the impenetrable
  // regions stacked on it (each starting where the one below ends). A lens
  // or a wall of impenetrable material with soil below it is no floor: a
  // circle below it stays a circle.
  const floorAt = (x: number): number => floorRock(x)[0];
  const floorRock = (x: number): [number, boolean] => {
    const b = verticalRange(bx, by, x);
    if (!b) return [Number.NaN, false];
    let top = b[0];
    const ranges = rock.map((g) => verticalRange(g.px, g.py, x)).filter((r): r is [number, number] => r !== null);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [lo, hi] of ranges) {
        if (lo <= top + touch && hi > top + touch) {
          top = hi;
          grew = true;
        }
      }
    }
    return [top, top > b[0]];
  };

  const xsSet = new Set<number>([x0, x1]);
  for (const x of bx) xsSet.add(x);
  for (const g of rock) for (const x of g.px) if (x > x0 && x < x1) xsSet.add(x);
  const xs = [...xsSet].sort((a, b) => a - b);

  const pts: Pt[] = [];
  const bare: [number, number][] = [];
  let rockAnywhere = false;
  const push = (x: number, y: number) => {
    if (!Number.isFinite(y)) return;
    const last = pts[pts.length - 1];
    if (last && Math.abs(last[0] - x) <= delta && Math.abs(last[1] - y) <= delta) return;
    pts.push([x, y]);
  };
  // Between the vertices every boundary is straight and the stack of
  // regions the same, so the floor is straight there.
  for (let k = 0; k + 1 < xs.length; k++) {
    const a = xs[k], b = xs[k + 1];
    if (b - a <= 2 * delta) continue;
    push(a, floorAt(a + delta));
    push(b, floorAt(b - delta));
    if (floorRock((a + b) / 2)[1]) rockAnywhere = true;
    else if (!followBase) {
      const last = bare[bare.length - 1];
      if (last && last[1] === a) last[1] = b;
      else bare.push([a, b]);
    }
  }
  if (!followBase && !rockAnywhere) return null;
  return pts.length >= 2 ? { pts, bare } : null;
}

/**
 * How far a circle may dip below the floor and still count as a circle
 * (tangent to it, to rounding): the same tolerance as the search's check
 * that a circle stays inside the model (search.ts), so that the circle the
 * search finds tangent to the base is analysed as a circle.
 */
export function floorDipTolerance(modelHeight: number): number {
  return 1e-6 * Math.max(1, modelHeight);
}

/**
 * Whether the circle (its lower arc between x0 and x1) goes below the
 * floor by more than `tol` where the floor is the bare base of the model
 * (not followed: the circle leaves the model there).
 */
export function circleBelowBareBase(
  floor: CompositeFloor,
  cx: number, cy: number, radius: number,
  x0: number, x1: number,
  tol: number,
): boolean {
  const arc = (x: number) => cy - Math.sqrt(Math.max(0, radius * radius - (x - cx) * (x - cx)));
  const p = floor.pts;
  for (const [u, v] of floor.bare) {
    for (let i = 0; i + 1 < p.length; i++) {
      const a = Math.max(u, x0, p[i][0]), b = Math.min(v, x1, p[i + 1][0]);
      if (!(b > a)) continue;
      // arc − floor is convex on a straight floor segment: its minimum by
      // golden-section search
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      const gap = (x: number) => arc(x) - (ay + ((x - ax) / (bx - ax)) * (by - ay));
      let lo = a, hi = b;
      const g = (Math.sqrt(5) - 1) / 2;
      for (let k = 0; k < 60 && hi - lo > 1e-12 * Math.max(1, radius); k++) {
        const m1 = hi - g * (hi - lo), m2 = lo + g * (hi - lo);
        if (gap(m1) < gap(m2)) hi = m2;
        else lo = m1;
      }
      if (Math.min(gap(a), gap(b), gap((lo + hi) / 2)) < -tol) return true;
    }
  }
  return false;
}

/** The floor's y at x from the given side of a step (NaN outside it). */
export function floorYAt(floor: CompositeFloor, x: number, side: "left" | "right" = "left"): number {
  const p = floor.pts;
  const n = p.length;
  if (n < 2 || x < p[0][0] || x > p[n - 1][0]) return Number.NaN;
  if (side === "right") {
    for (let i = n - 2; i >= 0; i--) {
      const [ax, ay] = p[i], [bx, by] = p[i + 1];
      if (x >= ax && x <= bx) return bx === ax ? by : ay + ((x - ax) / (bx - ax)) * (by - ay);
    }
    return p[n - 1][1];
  }
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1];
    if (x >= ax && x <= bx) return bx === ax ? ay : ay + ((x - ax) / (bx - ax)) * (by - ay);
  }
  return p[n - 1][1];
}
