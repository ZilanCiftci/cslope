/**
 * Block search: non-circular trial surfaces through block search objects.
 *
 * Each surface passes through one point of every object, the points
 * ordered by x as the base of the sliding block. From the two ends of the
 * base straight segments rise to the ground: the upslope (active) one at
 * the active angle, the downslope (passive) one at the passive angle. By
 * default these are the Coulomb wedge angles 45° + φ/2 and 45° − φ/2 of
 * the soil the segment cuts (Wright 1988, fig. 6; the block surfaces of
 * Edris & Wright 1987), otherwise drawn from the user's ranges, as
 * commercial block searches do. An object of one point is a fixed point,
 * of two a line (points uniform along it), of three or more a window
 * (points uniform within the polygon).
 *
 * `iterations` surfaces are drawn, then `refinedIterations` more around the
 * best ones in neighbourhoods that shrink level by level (each new point
 * within a fraction of its object's size of the old one). The draws are
 * seeded, so a search is repeatable. Only admissible surfaces are
 * analysed: entry and exit within the search limits, at least the minimum
 * failure distance apart, below the ground, inside the model and concave
 * (the rule of every non-circular surface in cSlope).
 */

import { isPointInPolygon } from "../math/index";
import { resolveStrength } from "../types/index";
import { rng } from "./property-helpers";
import type { Slope, SearchPlane } from "./slope";
import { defaultAxisPoint, isAdmissiblePolyline, type Pt } from "./surface";
import { rayToGround } from "./optimize";

/** Evaluates planes in place (sets fos, null when invalid). */
type Evaluate = (planes: SearchPlane[]) => void;

/** How one block surface was drawn: a point per object and the two angles (°). */
interface Gene {
  points: Pt[];
  active: number;
  passive: number;
}

/** Seed of the random draws: any fixed number makes the search repeatable. */
const SEED = 1987;
/** Draws per surface before a window gives up on a point inside it. */
const WINDOW_TRIES = 64;
/** Refinement levels; the neighbourhood halves from level to level. */
const LEVELS = 6;
/** Neighbourhood of the first level, as a fraction of each object's size. */
const FIRST_SCALE = 0.25;
/** Best surfaces refined at each level. */
const PARENTS = 5;
/** Block surfaces carried on to the non-circular optimisation. */
export const BLOCK_SEEDS = 3;

const genes = new WeakMap<SearchPlane, Gene>();

/** The block surfaces drawn by `blockSearch` (its own planes only). */
export function isBlockSurface(plane: SearchPlane): boolean {
  return genes.has(plane);
}

/**
 * Draw and evaluate the block surfaces of `slope`'s search objects.
 * Returns every evaluated surface (FOS null where invalid).
 */
export function blockSearch(slope: Slope, evaluate: Evaluate): SearchPlane[] {
  const objects = slope.blockSearchObjects;
  if (objects.length === 0) {
    throw new Error("Block search needs at least one search object: a point, a line or a window.");
  }
  const random = rng(SEED);
  const ground = slope.surfaceLineXY;
  if (!ground) return [];
  const span = Math.max(Math.max(...ground.x) - Math.min(...ground.x), 1e-9);

  const boxes = objects.map((o) => {
    const xs = o.map((p) => p[0]);
    const ys = o.map((p) => p[1]);
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  });
  const polygons = objects.map((o) => (o.length >= 3 ? { px: o.map((p) => p[0]), py: o.map((p) => p[1]) } : null));

  const inWindow = (k: number, x: number, y: number) => {
    const poly = polygons[k]!;
    return isPointInPolygon(x, y, poly.px, poly.py);
  };

  /** A point of object k: anywhere on it, or within `scale` of its size around `near`. */
  const drawPoint = (k: number, near?: Pt, scale = 1): Pt | null => {
    const o = objects[k];
    if (o.length === 1) return [o[0][0], o[0][1]];
    if (o.length === 2) {
      const [a, b] = o;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      let t = random();
      if (near) {
        const t0 = ((near[0] - a[0]) * dx + (near[1] - a[1]) * dy) / (dx * dx + dy * dy);
        t = Math.min(1, Math.max(0, t0 + scale * (2 * random() - 1)));
      }
      return [a[0] + t * dx, a[1] + t * dy];
    }
    const box = boxes[k];
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    for (let i = 0; i < WINDOW_TRIES; i++) {
      const x = near ? near[0] + scale * w * (2 * random() - 1) : box.x0 + w * random();
      const y = near ? near[1] + scale * h * (2 * random() - 1) : box.y0 + h * random();
      if (inWindow(k, x, y)) return [x, y];
    }
    return near ? [near[0], near[1]] : null;
  };

  const groundAt = (x: number) => slope.getExternalYIntersection(x);
  const factors = slope.partialFactors;
  /**
   * Friction angle (°, design value) of the soil halfway between (x, y)
   * and the ground above it: the soil the end segment mostly cuts.
   */
  const phiAbove = (x: number, y: number): number => {
    const g = groundAt(x);
    if (!Number.isFinite(g) || !(g > y)) return 0;
    const ym = (y + g) / 2;
    const m = slope.materialGeometries.find((geom) => isPointInPolygon(x, ym, geom.px, geom.py));
    if (!m) return 0;
    const r = resolveStrength(m.material.model, { yBottom: ym, x, yGround: g, alpha: 0 });
    const tanPhi = Math.tan((r.frictionAngle * Math.PI) / 180) / (factors?.tanPhi ?? 1);
    return (Math.atan(tanPhi) * 180) / Math.PI;
  };

  const activeRange = slope.blockActiveAngle;
  const passiveRange = slope.blockPassiveAngle;
  /** An angle from a range, or near `near` within `scale` of its width. */
  const drawAngle = (range: Readonly<[number, number]>, near?: number, scale = 1): number => {
    const [lo, hi] = range;
    if (near === undefined) return lo + (hi - lo) * random();
    return Math.min(hi, Math.max(lo, near + scale * (hi - lo) * (2 * random() - 1)));
  };

  const [entryL, entryR, exitL, exitR] = slope.limits;
  const minLength = Math.max(slope.minFailureDistance, 0);

  /** The surface of a gene, or null when it is not admissible. */
  const surfaceOf = (gene: Gene): Pt[] | null => {
    const base = [...gene.points].sort((p, q) => p[0] - q[0]);
    for (let i = 1; i < base.length; i++) {
      if (base[i][0] - base[i - 1][0] < 1e-9 * span) return null;
    }
    const first = base[0];
    const last = base[base.length - 1];
    if (!(first[1] < groundAt(first[0])) || !(last[1] < groundAt(last[0]))) return null;
    const ta = Math.tan((gene.active * Math.PI) / 180);
    const tp = Math.tan((gene.passive * Math.PI) / 180);
    const entry = rayToGround(ground, first[0], first[1], -1, ta);
    const exit = rayToGround(ground, last[0], last[1], 1, tp);
    if (!entry || !exit) return null;
    if (entry[0] < entryL - 1e-9 || entry[0] > entryR + 1e-9) return null;
    if (exit[0] < exitL - 1e-9 || exit[0] > exitR + 1e-9) return null;
    if (exit[0] - entry[0] <= minLength) return null;
    const points: Pt[] = [entry, ...base, exit];
    return isAdmissiblePolyline(slope, points) ? points : null;
  };

  const planeOf = (gene: Gene): SearchPlane | null => {
    const points = surfaceOf(gene);
    if (!points) return null;
    const [cx, cy] = defaultAxisPoint(points);
    const plane: SearchPlane = {
      lc: points[0],
      rc: points[points.length - 1],
      cx,
      cy,
      radius: 0,
      points,
      fos: null,
      slices: null,
    };
    genes.set(plane, gene);
    return plane;
  };

  /** A gene with the given points and angles from the ranges or the soil. */
  const geneOf = (points: Pt[], near?: Gene, scale = 1): Gene => {
    const sorted = [...points].sort((p, q) => p[0] - q[0]);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const active = activeRange ? drawAngle(activeRange, near?.active, scale) : 45 + phiAbove(first[0], first[1]) / 2;
    const passive = passiveRange ? drawAngle(passiveRange, near?.passive, scale) : 45 - phiAbove(last[0], last[1]) / 2;
    return { points, active, passive };
  };

  const all: SearchPlane[] = [];
  const keys = new Set<string>();
  const key = (g: Gene) => g.points.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join(";") + `|${g.active.toFixed(4)}|${g.passive.toFixed(4)}`;

  /** Draws `count` genes (from `make`), evaluates the admissible new ones. */
  const run = (count: number, make: () => Gene | null) => {
    const batch: SearchPlane[] = [];
    // Inadmissible draws count against the budget too, at most twice it,
    // so that objects outside the soil cannot loop for ever.
    for (let tries = 0; batch.length < count && tries < 2 * count; tries++) {
      const gene = make();
      if (!gene) continue;
      const k = key(gene);
      if (keys.has(k)) continue;
      keys.add(k);
      const plane = planeOf(gene);
      if (plane) batch.push(plane);
    }
    evaluate(batch);
    all.push(...batch);
  };

  // A fixed-point object with fixed angles gives one surface only.
  const fixed = objects.every((o) => o.length === 1) && !activeRange && !passiveRange;
  run(fixed ? 1 : slope.iterations, () => {
    const points: Pt[] = [];
    for (let k = 0; k < objects.length; k++) {
      const p = drawPoint(k);
      if (!p) return null;
      points.push(p);
    }
    return geneOf(points);
  });
  if (fixed) return all;

  // Refinement: around the best distinct surfaces, in shrinking neighbourhoods.
  const perLevel = Math.floor(slope.refinedIterations / LEVELS);
  for (let level = 0; level < LEVELS && perLevel > 0; level++) {
    const scale = FIRST_SCALE / 2 ** level;
    const parents = bestDistinct(all, PARENTS, span);
    if (parents.length === 0) break;
    const perParent = Math.max(1, Math.floor(perLevel / parents.length));
    for (const parent of parents) {
      const gene = genes.get(parent)!;
      run(perParent, () => {
        const points: Pt[] = [];
        for (let k = 0; k < objects.length; k++) {
          const p = drawPoint(k, gene.points[k], scale);
          if (!p) return null;
          points.push(p);
        }
        return geneOf(points, gene, scale);
      });
    }
  }
  return all;
}

/** The `count` best evaluated surfaces with clearly different entry or exit points. */
export function bestDistinct(planes: readonly SearchPlane[], count: number, span: number): SearchPlane[] {
  const solved = planes
    .filter((p) => p.fos != null && Number.isFinite(p.fos))
    .sort((a, b) => a.fos! - b.fos!);
  const chosen: SearchPlane[] = [];
  for (const p of solved) {
    if (chosen.length >= count) break;
    const distinct = chosen.every(
      (c) => Math.abs(c.lc[0] - p.lc[0]) > 0.01 * span || Math.abs(c.rc[0] - p.rc[0]) > 0.01 * span,
    );
    if (distinct) chosen.push(p);
  }
  return chosen;
}
